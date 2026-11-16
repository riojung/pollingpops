import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { MemoryRepository, type PresentationRecord } from "@openround/db";
import {
  PresentationDraftSchema,
  PresentationQuestionSuggestionsJobSchema,
  presentationQuestionSuggestionsSourceDigest,
  presentationQuestionSuggestionSource,
  type PresentationQuestionSuggestionsJob,
  type PresentationSceneNode,
} from "@openround/contracts";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";
import { verifyEmailAndSignIn } from "./support/email-auth.js";
import { nativeSceneBlock } from "./support/presentation-native-scene.js";
import type { PresentationQuestionSuggestionsProvider } from "../src/presentation-question-suggestions-provider.js";

const workspaceId = "10000000-0000-4000-8000-00000000e012";
const originalText = "  Agree on a shared purpose before starting the project.  ";
const generated = {
  suggestions: [
    {
      kind: "discussion",
      prompt: "How could agreeing on a shared purpose affect your project?",
      citations: [{ locator: "body 1 paragraph 1", excerpt: "Agree on a shared purpose" }],
    },
    {
      kind: "reflection",
      prompt: "When have you agreed on a shared purpose before starting a project?",
      citations: [{ locator: "body 1 paragraph 1", excerpt: "before starting the project." }],
    },
  ],
};
const nodeId = "Selected:Title-Upper";
let app: FastifyInstance | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  await app?.close();
  app = undefined;
});

async function fixture(
  generate: PresentationQuestionSuggestionsProvider["generate"] | null = vi
    .fn()
    .mockResolvedValue(generated),
  modelName = "bounded-test",
) {
  const repository = new MemoryRepository({ initialWorkspaceId: workspaceId });
  const built = await buildApp(
    ConfigSchema.parse({
      NODE_ENV: "test",
      ALLOW_IN_MEMORY: "true",
      COMMUNITY_MODE: "false",
      FEATURE_UX_BETA: "true",
      UX_BETA_WORKSPACE_ALLOWLIST: workspaceId,
      FEATURE_PRESENTATIONS: "true",
      AUTH_DEBUG_MAGIC_LINKS: "true",
      LOG_LEVEL: "silent",
    }),
    {
      repository,
      cache: new MemorySessionCache(),
      mailer: {
        async sendAccountVerification() {},
        async sendSignInPin() {},
        async sendWorkspaceInvitation() {},
      },
      presentationAssistanceProvider: {
        providerName: "approved-test",
        modelName: "bounded-test",
        async generate() {
          return {};
        },
      },
      presentationQuestionSuggestionsProvider: generate
        ? { providerName: "approved-test", modelName, generate }
        : null,
    },
  );
  app = built.app;
  const email = `question-suggestions-${randomUUID()}@example.com`;
  const requested = await app.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: { email, segment: "education", acceptPolicies: true },
  });
  const token = new URL(requested.json<{ debugUrl: string }>().debugUrl).searchParams.get("token")!;
  const signedIn = await verifyEmailAndSignIn(app, `/v1/auth/verify?token=${token}`, email);
  const cookies = signedIn.headers["set-cookie"]!;
  const cookie = (Array.isArray(cookies) ? cookies[0]! : cookies).split(";")[0]!;
  const created = await app.inject({
    method: "POST",
    url: "/v1/presentations",
    headers: { cookie },
    payload: { title: "Existing project" },
  });
  expect(created.statusCode).toBe(201);
  const initial = created.json<{ presentation: PresentationRecord }>().presentation;
  const block = nativeSceneBlock([], "Shared purpose");
  (block.scene.nodes as PresentationSceneNode[]).push({
    id: "Source:Body",
    type: "text",
    role: "body",
    text: originalText,
    frame: { x: 7, y: 31, width: 86, height: 59 },
  });
  block.scene.nodes = block.scene.nodes.map((node) =>
    node.type === "text" && node.role === "title"
      ? { ...node, id: nodeId }
      : node.type === "connector"
        ? { ...node, from: { ...node.from, nodeId } }
        : node,
  );
  block.scene.readingOrder = block.scene.nodes.map((node) => node.id);
  const presentation = (await built.presentations.updatePresentationDraft({
    workspaceId,
    presentationId: initial.id,
    draft: PresentationDraftSchema.parse({ ...initial.draft, schemaVersion: 13, blocks: [block] }),
    expectedRevision: 0,
    mutationId: randomUUID(),
    editorId: initial.lastEditedBy!,
    draftHash: "initial-native-slide",
  }))!;
  const request = {
    schemaVersion: 1 as const,
    requestId: randomUUID(),
    presentationId: presentation.id,
    blockId: block.id,
    outputLanguage: "en" as const,
    expectedRevision: 1,
    sourceDigest: presentationQuestionSuggestionsSourceDigest(
      (() => {
        const value = presentationQuestionSuggestionSource(block);
        if (!value.supported) throw new Error("fixture source");
        return value.source;
      })(),
    ),
  };
  const post = (payload: unknown = request) =>
    app!.inject({
      method: "POST",
      url: "/v1/presentation-question-suggestions/jobs",
      headers: { cookie },
      payload: payload as object,
    });
  const get = () =>
    app!.inject({
      method: "GET",
      url: `/v1/presentation-question-suggestions/jobs/${request.requestId}?presentationId=${presentation.id}`,
      headers: { cookie },
    });
  const status = () =>
    app!.inject({
      method: "GET",
      url: `/v1/presentation-question-suggestions/status?presentationId=${presentation.id}`,
      headers: { cookie },
    });
  const apply = (job: PresentationQuestionSuggestionsJob, overrides: object = {}) =>
    app!.inject({
      method: "POST",
      url: `/v1/presentations/${presentation.id}/question-suggestions/insert`,
      headers: { cookie },
      payload: {
        schemaVersion: 1,
        jobId: job.id,
        proposalHash: job.proposalHash,
        blockId: block.id,
        suggestionId: job.proposal!.suggestions[0]!.id,
        sourceDigest: request.sourceDigest,
        reviewed: true,
        expectedRevision: 1,
        mutationId: randomUUID(),
        ...overrides,
      },
    });
  const edit = async (change: (draft: PresentationRecord["draft"]) => void) => {
    const current = (await built.presentations.getPresentation(workspaceId, presentation.id))!;
    const draft = structuredClone(current.draft);
    change(draft);
    return built.presentations.updatePresentationDraft({
      workspaceId,
      presentationId: current.id,
      draft: PresentationDraftSchema.parse(draft),
      expectedRevision: current.draftRevision,
      mutationId: randomUUID(),
      editorId: current.lastEditedBy!,
      draftHash: randomUUID(),
    });
  };
  return {
    ...built,
    repository,
    presentation,
    cookie,
    block,
    request,
    post,
    get,
    status,
    apply,
    edit,
  };
}
async function ready(f: Awaited<ReturnType<typeof fixture>>) {
  const created = await f.post();
  expect(created.statusCode, created.body).toBe(202);
  expect(await f.presentationQuestionSuggestionsWorker.runOnce()).toBe("completed");
  return PresentationQuestionSuggestionsJobSchema.parse(
    (await f.get()).json<{ job: PresentationQuestionSuggestionsJob }>().job,
  );
}

describe("Reviewed native question suggestions API", () => {
  it("does not generate until explicit admission, sends only selected wording and inserts exactly one normal opinion activity", async () => {
    const generate = vi.fn().mockResolvedValue(generated),
      f = await fixture(generate);
    expect(generate).not.toHaveBeenCalled();
    const before = structuredClone(f.presentation.draft);
    const job = await ready(f);
    expect(generate).toHaveBeenCalledExactlyOnceWith({
      title: "Shared purpose",
      sections: [{ locator: "body 1 paragraph 1", text: originalText }],
      outputLanguage: "en",
    });
    expect(job.proposal?.suggestions).toHaveLength(2);
    expect((await f.presentations.getPresentation(workspaceId, f.presentation.id))?.draft).toEqual(
      before,
    );
    expect((await f.apply(job, { reviewed: false })).statusCode).toBe(400);
    const accepted = await f.apply(job);
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(accepted.json()).toMatchObject({
      jobId: job.id,
      sourceBlockId: f.block.id,
      sourceDigest: f.request.sourceDigest,
    });
    const draft = accepted.json().presentation.draft;
    expect(draft.blocks).toHaveLength(2);
    expect(draft.blocks[0]).toEqual(before.blocks[0]);
    expect(draft.blocks[1]).toMatchObject({
      kind: "question",
      question: { type: "open_text", purpose: "opinion", basePoints: 0, confidence: "off" },
    });
    expect(draft.blocks[1]).not.toHaveProperty("provenance");
    expect((await f.status()).json().status).toMatchObject({
      used: 1,
      remaining: 2,
      active: 0,
      maxActiveJobs: 2,
    });
  });
  it("recovers exact admission and accepted mutation after later source edits and private expiry", async () => {
    const f = await fixture(),
      job = await ready(f),
      mutationId = randomUUID();
    const accepted = await f.apply(job, { mutationId });
    expect(accepted.statusCode).toBe(200);
    await f.edit((draft) => {
      const source = draft.blocks[0]!;
      if (source.kind === "content")
        source.scene!.nodes = source.scene!.nodes.map((node) =>
          node.type === "text" && node.role === "body"
            ? { ...node, text: "Later authored wording" }
            : node,
        );
    });
    expect((await f.post()).statusCode).toBe(200);
    await f.presentationQuestionSuggestions.jobs.purgeExpired(
      new Date(Date.now() + 25 * 60 * 60_000),
    );
    const replay = await f.apply(job, { mutationId });
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json()).toEqual(accepted.json());
    expect(
      (await f.presentations.getPresentation(workspaceId, f.presentation.id))?.draftRevision,
    ).toBe(3);
    expect((await f.apply(job, { expectedRevision: 3 })).statusCode).toBe(409);
  });
  it("rejects changed source/language before provider invocation while retaining exact admitted retries", async () => {
    const generate = vi.fn().mockResolvedValue(generated),
      f = await fixture(generate);
    expect((await f.post()).statusCode).toBe(202);
    await f.edit((draft) => {
      draft.schemaVersion = 16;
      const source = draft.blocks[0]!;
      if (source.kind === "content")
        source.scene = {
          ...source.scene!,
          schemaVersion: 7,
          nodes: source.scene!.nodes.map((node) =>
            node.type === "text" ? { ...node, lang: "fr" } : node,
          ),
        };
    });
    expect((await f.post()).statusCode).toBe(200);
    expect(await f.presentationQuestionSuggestionsWorker.runOnce()).toBe("failed");
    expect(generate).not.toHaveBeenCalled();
    expect((await f.get()).json().job.error.code).toBe("SOURCE_UNAVAILABLE");
    expect(
      (await f.post({ ...f.request, requestId: randomUUID(), expectedRevision: 2 })).statusCode,
    ).toBe(409);
  });
  it("fences changed proposal, suggestion and latest-source rebase without changing the deck", async () => {
    const f = await fixture(),
      job = await ready(f);
    expect((await f.apply(job, { proposalHash: "a".repeat(64) })).statusCode).toBe(409);
    expect((await f.apply(job, { suggestionId: randomUUID() })).statusCode).toBe(409);
    await f.edit((draft) => {
      const source = draft.blocks[0]!;
      if (source.kind === "content")
        source.scene!.readingOrder = [...source.scene!.readingOrder].reverse();
    });
    expect((await f.apply(job, { expectedRevision: 2 })).statusCode).toBe(409);
    expect(
      (await f.presentations.getPresentation(workspaceId, f.presentation.id))?.draft.blocks,
    ).toHaveLength(1);
  });
  it("fails closed when optional provider is absent and sanitizes provider failures", async () => {
    const disabled = await fixture(null);
    expect((await disabled.status()).json().status.enabled).toBe(false);
    expect((await disabled.post()).statusCode).toBe(503);
    await app!.close();
    app = undefined;
    const generate = vi.fn().mockRejectedValue(new Error("PRIVATE_PROVIDER_PROMPT_AND_SECRET")),
      f = await fixture(generate);
    expect((await f.post()).statusCode).toBe(202);
    expect(await f.presentationQuestionSuggestionsWorker.runOnce()).toBe("retry_scheduled");
    const output = (await f.get()).body;
    expect(output).not.toContain("PRIVATE_PROVIDER");
    expect(JSON.parse(output).job.error.code).toBe("PROVIDER_UNAVAILABLE");
  });
  it("rejects invented evidence as terminal invalid output", async () => {
    const invalid = structuredClone(generated);
    invalid.suggestions[0]!.citations[0]!.excerpt = "Not present in selected source";
    const f = await fixture(vi.fn().mockResolvedValue(invalid));
    expect((await f.post()).statusCode).toBe(202);
    expect(await f.presentationQuestionSuggestionsWorker.runOnce()).toBe("failed");
    expect((await f.get()).json().job.error.code).toBe("INVALID_OUTPUT");
  });
  it("bounds override providers by a deadline and retries no more than three claimed attempts", async () => {
    const generate = vi.fn().mockRejectedValue(new Error("PRIVATE transient provider failure")),
      f = await fixture(generate);
    expect((await f.post()).statusCode).toBe(202);
    const now = Date.now();
    expect(await f.presentationQuestionSuggestionsWorker.runOnce(new Date(now))).toBe(
      "retry_scheduled",
    );
    expect(await f.presentationQuestionSuggestionsWorker.runOnce(new Date(now + 5000))).toBe(
      "retry_scheduled",
    );
    expect(await f.presentationQuestionSuggestionsWorker.runOnce(new Date(now + 15000))).toBe(
      "failed",
    );
    expect(await f.presentationQuestionSuggestionsWorker.runOnce(new Date(now + 30000))).toBe(
      "idle",
    );
    expect(generate).toHaveBeenCalledTimes(3);
    expect((await f.get()).json().job.error.code).toBe("ATTEMPTS_EXHAUSTED");
    expect((await f.status()).json().status.used).toBe(1);
    await app!.close();
    app = undefined;
    const stalled = await fixture(vi.fn(() => new Promise<unknown>(() => {})));
    expect((await stalled.post()).statusCode).toBe(202);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const run = stalled.presentationQuestionSuggestionsWorker.runOnce();
    await vi.advanceTimersByTimeAsync(45000);
    expect(await run).toBe("retry_scheduled");
  });
  it("rechecks current editor authority before new generation and reviewed insertion", async () => {
    const f = await fixture(),
      job = await ready(f);
    const key = `${workspaceId}:${f.presentation.lastEditedBy}`;
    const member = f.repository.workspaceMembers.get(key)!;
    f.repository.workspaceMembers.set(key, { ...member, role: "viewer" });
    const user = f.repository.users.get(f.presentation.lastEditedBy!)!;
    f.repository.users.set(user.userId, { ...user, role: "viewer" });
    expect((await f.apply(job)).statusCode).toBe(403);
    expect((await f.post({ ...f.request, requestId: randomUUID() })).statusCode).toBe(403);
    expect(
      (await f.presentations.getPresentation(workspaceId, f.presentation.id))?.draft.blocks,
    ).toHaveLength(1);
  });
});
