import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { MemoryRepository, type PresentationRecord } from "@openround/db";
import {
  PresentationDraftSchema,
  PresentationTextAssistanceJobSchema,
  presentationTextAssistanceSourceDigest,
  type PresentationTextAssistanceJob,
} from "@openround/contracts";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";
import { verifyEmailAndSignIn } from "./support/email-auth.js";
import { nativeSceneBlock } from "./support/presentation-native-scene.js";
import type { PresentationTextAssistanceProvider } from "../src/presentation-text-assistance-provider.js";

const workspaceId = "10000000-0000-4000-8000-00000000e012";
const originalText = "  Agree on a shared purpose before starting the project.  ";
const proposedText = "Agree on a shared purpose.";
const nodeId = "Selected:Title-Upper";
let app: FastifyInstance | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  await app?.close();
  app = undefined;
});

async function fixture(
  generate: PresentationTextAssistanceProvider["generate"] | null = vi
    .fn()
    .mockResolvedValue({ text: proposedText }),
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
      presentationTextAssistanceProvider: generate
        ? { providerName: "approved-test", modelName, generate }
        : null,
    },
  );
  app = built.app;
  const email = `text-assistance-${randomUUID()}@example.com`;
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
  const block = nativeSceneBlock([], originalText);
  block.scene.nodes = block.scene.nodes.map((node) =>
    node.type === "text"
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
    nodeId,
    operation: "shorten" as const,
    expectedRevision: 1,
    sourceDigest: presentationTextAssistanceSourceDigest(originalText),
  };
  const post = (payload: unknown = request) =>
    app!.inject({
      method: "POST",
      url: "/v1/presentation-text-assistance/jobs",
      headers: { cookie },
      payload: payload as object,
    });
  const get = () =>
    app!.inject({
      method: "GET",
      url: `/v1/presentation-text-assistance/jobs/${request.requestId}?presentationId=${presentation.id}`,
      headers: { cookie },
    });
  const status = () =>
    app!.inject({
      method: "GET",
      url: `/v1/presentation-text-assistance/status?presentationId=${presentation.id}`,
      headers: { cookie },
    });
  const apply = (job: PresentationTextAssistanceJob, overrides: object = {}) =>
    app!.inject({
      method: "POST",
      url: `/v1/presentations/${presentation.id}/text-assistance/apply`,
      headers: { cookie },
      payload: {
        schemaVersion: 1,
        jobId: job.id,
        proposalHash: job.proposalHash,
        blockId: block.id,
        nodeId,
        sourceDigest: request.sourceDigest,
        reviewed: true,
        expectedRevision: 1,
        mutationId: randomUUID(),
        ...(job.operation === "translate"
          ? { targetLanguage: job.targetLanguage, sourceLanguage: job.sourceLanguage }
          : {}),
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
  expect(await f.presentationTextAssistanceWorker.runOnce()).toBe("completed");
  return PresentationTextAssistanceJobSchema.parse(
    (await f.get()).json<{ job: PresentationTextAssistanceJob }>().job,
  );
}

describe("Reviewed native text assistance API", () => {
  it("translates only the selected text and requested target, preserves evidence, and recovers accepted language edits after expiry", async () => {
    const translated = "Convenez d’un objectif commun.";
    const generate = vi.fn().mockResolvedValue({ text: translated }),
      f = await fixture(generate);
    const request = {
      ...f.request,
      operation: "translate",
      targetLanguage: "fr",
      sourceLanguage: null,
    };
    expect((await f.post(request)).statusCode).toBe(202);
    expect(await f.presentationTextAssistanceWorker.runOnce()).toBe("completed");
    expect(generate).toHaveBeenCalledExactlyOnceWith({
      text: originalText,
      role: "title",
      operation: "translate",
      targetLanguage: "fr",
    });
    expect(JSON.stringify(generate.mock.calls)).not.toContain("sourceLanguage");
    const job = PresentationTextAssistanceJobSchema.parse((await f.get()).json().job);
    expect(job.proposal).toMatchObject({
      originalText,
      text: translated,
      targetLanguage: "fr",
      sourceLanguage: null,
    });
    expect((await f.apply(job, { targetLanguage: "de" })).statusCode).toBe(409);
    expect((await f.apply(job, { sourceLanguage: undefined })).statusCode).toBe(400);
    const mutationId = randomUUID();
    const response = await f.apply(job, { mutationId });
    expect(response.statusCode, response.body).toBe(200);
    const result = response.json();
    expect(result).toMatchObject({
      targetLanguage: "fr",
      sourceLanguage: null,
      presentation: {
        draft: {
          schemaVersion: 16,
          blocks: [
            {
              scene: { schemaVersion: 7 },
              textAssistance: {
                operation: "translate",
                targetLanguage: "fr",
                sourceLanguage: null,
              },
            },
          ],
        },
      },
    });
    const block = result.presentation.draft.blocks[0];
    expect(block.scene.nodes.find((node: { id: string }) => node.id === nodeId)).toMatchObject({
      text: translated,
      lang: "fr",
    });
    expect(block.citations).toEqual(f.block.citations);
    expect(block.sourceDisclosure).toEqual(f.block.sourceDisclosure);
    await f.edit((draft) => {
      const block = draft.blocks[0]!;
      if (block.kind === "content" && block.scene) {
        const node = block.scene.nodes.find((node) => node.id === nodeId)!;
        if (node.type === "text") node.lang = "de";
      }
    });
    await f.presentationTextAssistance.jobs.purgeExpired(new Date(Date.now() + 25 * 60 * 60_000));
    expect((await f.post(request)).statusCode).toBe(200);
    const replay = await f.apply(job, { mutationId });
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json()).toEqual(result);
  });
  it("binds the original language and rejects stale annotations even when wording is unchanged", async () => {
    const f = await fixture();
    await f.edit((draft) => {
      draft.schemaVersion = 16;
      const block = draft.blocks[0]!;
      if (block.kind === "content" && block.scene) {
        block.scene.schemaVersion = 7;
        const node = block.scene.nodes.find((node) => node.id === nodeId)!;
        if (node.type === "text") node.lang = "en";
      }
    });
    const request = {
      ...f.request,
      expectedRevision: 2,
      operation: "translate",
      sourceLanguage: "en",
      targetLanguage: "fr",
    };
    expect((await f.post({ ...request, sourceLanguage: null })).statusCode).toBe(409);
    expect((await f.post({ ...request, targetLanguage: "en" })).statusCode).toBe(400);
    expect((await f.post({ ...request, targetLanguage: "FR" })).statusCode).toBe(400);
    expect((await f.post(request)).statusCode).toBe(202);
    expect(await f.presentationTextAssistanceWorker.runOnce()).toBe("completed");
    const job = PresentationTextAssistanceJobSchema.parse((await f.get()).json().job);
    await f.edit((draft) => {
      const block = draft.blocks[0]!;
      if (block.kind === "content" && block.scene) {
        const node = block.scene.nodes.find((node) => node.id === nodeId)!;
        if (node.type === "text") node.lang = "de";
      }
    });
    const before = await f.presentations.getPresentation(workspaceId, f.presentation.id);
    expect((await f.apply(job, { expectedRevision: 3 })).statusCode).toBe(409);
    expect(await f.presentations.getPresentation(workspaceId, f.presentation.id)).toEqual(before);
    expect((await f.post(request)).statusCode).toBe(200);
  });
  it("accepts identical translated wording when applying a different language annotation", async () => {
    const f = await fixture(vi.fn().mockResolvedValue({ text: originalText }));
    expect(
      (
        await f.post({
          ...f.request,
          operation: "translate",
          targetLanguage: "ko",
          sourceLanguage: null,
        })
      ).statusCode,
    ).toBe(202);
    expect(await f.presentationTextAssistanceWorker.runOnce()).toBe("completed");
    const job = PresentationTextAssistanceJobSchema.parse((await f.get()).json().job);
    expect(job.proposal!.outputDigest).toBe(job.sourceDigest);
    const response = await f.apply(job);
    expect(response.statusCode, response.body).toBe(200);
    expect(
      response
        .json()
        .presentation.draft.blocks[0].scene.nodes.find(
          (node: { id: string }) => node.id === nodeId,
        ),
    ).toMatchObject({ text: originalText, lang: "ko" });
  });
  it("is optional and validates approved provider identities before spending the unchanged free allowance", async () => {
    const generate = vi.fn(),
      f = await fixture(generate, "x".repeat(121));
    expect((await f.status()).json()).toMatchObject({
      status: {
        enabled: false,
        monthlyLimit: 3,
        used: 0,
        remaining: 3,
        active: 0,
        maxActiveJobs: 2,
      },
    });
    expect((await f.post()).statusCode).toBe(503);
    expect((await f.get()).statusCode).toBe(404);
    expect(generate).not.toHaveBeenCalled();
  });
  it("generates only selected plaintext, preserves all provenance and scene state, and recovers the exact accepted receipt after expiry and later edits", async () => {
    const generate = vi.fn().mockResolvedValue({ text: proposedText }),
      f = await fixture(generate);
    const before = (await f.presentations.getPresentation(workspaceId, f.presentation.id))!;
    const job = await ready(f);
    expect(generate).toHaveBeenCalledExactlyOnceWith({
      text: originalText,
      role: "title",
      operation: "shorten",
    });
    expect(JSON.stringify(generate.mock.calls)).not.toContain("PRIVATE");
    expect((await f.presentations.getPresentation(workspaceId, f.presentation.id))!).toEqual(
      before,
    );
    expect((await f.post()).statusCode).toBe(200);
    expect((await f.apply(job, { reviewed: false })).statusCode).toBe(400);
    expect((await f.apply(job, { proposalHash: "a".repeat(64) })).statusCode).toBe(409);
    const mutationId = randomUUID();
    const accepted = await f.apply(job, {
      mutationId: mutationId.toUpperCase(),
      blockId: f.block.id.toUpperCase(),
      jobId: job.id.toUpperCase(),
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    const result = accepted.json();
    expect(result).toMatchObject({
      jobId: job.id,
      blockId: f.block.id,
      nodeId,
      proposalHash: job.proposalHash,
      sourceDigest: f.request.sourceDigest,
      outputDigest: presentationTextAssistanceSourceDigest(proposedText),
      presentation: { draftRevision: 2, draft: { schemaVersion: 15 } },
    });
    const expected = structuredClone(before.draft);
    expected.schemaVersion = 15;
    const expectedBlock = expected.blocks[0]!;
    if (expectedBlock.kind !== "content" || !expectedBlock.scene)
      throw new Error("Missing native block");
    const target = expectedBlock.scene.nodes.find((node) => node.id === nodeId)!;
    if (target.type !== "text") throw new Error("Missing text target");
    target.text = proposedText;
    const { originalText: original, text, blockId, ...metadata } = job.proposal!;
    expect({ original, text, blockId }).toEqual({
      original: originalText,
      text: proposedText,
      blockId: f.block.id,
    });
    expectedBlock.textAssistance = metadata;
    expect(result.presentation.draft).toEqual(expected);
    expect(expectedBlock.citations).toEqual(f.block.citations);
    expect(expectedBlock.sourceDisclosure).toEqual(f.block.sourceDisclosure);
    await f.edit((draft) => {
      draft.description = "Later author edit";
    });
    await f.presentationTextAssistance.jobs.purgeExpired(new Date(Date.now() + 25 * 60 * 60_000));
    const replay = await f.apply(job, { mutationId });
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json()).toEqual(result);
    expect(
      (await f.presentations.getPresentation(workspaceId, f.presentation.id))!.draft.description,
    ).toBe("Later author edit");
    expect((await f.apply(job, { mutationId, sourceDigest: "b".repeat(64) })).statusCode).toBe(409);
    expect((await f.status()).json()).toMatchObject({ status: { used: 1, remaining: 2 } });
  });
  it("normalizes UUIDs, keeps arbitrary node IDs case-sensitive, and recovers admitted retries after the target disappears", async () => {
    const f = await fixture();
    expect((await f.post({ ...f.request, nodeId: nodeId.toLowerCase() })).statusCode).toBe(422);
    expect(
      (
        await f.post({
          ...f.request,
          requestId: f.request.requestId.toUpperCase(),
          presentationId: f.request.presentationId.toUpperCase(),
          blockId: f.request.blockId.toUpperCase(),
        })
      ).statusCode,
    ).toBe(202);
    await f.edit((draft) => {
      const block = draft.blocks[0]!;
      if (block.kind === "content" && block.scene) {
        block.scene.nodes = block.scene.nodes.map((node) =>
          node.id === nodeId
            ? { ...node, id: "replacement-title" }
            : node.type === "connector"
              ? { ...node, from: { ...node.from, nodeId: "replacement-title" } }
              : node,
        );
        block.scene.readingOrder = block.scene.nodes.map((node) => node.id);
      }
    });
    expect((await f.post()).statusCode).toBe(200);
    expect((await f.post({ ...f.request, operation: "rewrite" })).statusCode).toBe(409);
    expect((await f.post({ ...f.request, requestId: randomUUID() })).statusCode).toBe(422);
    expect((await f.status()).json()).toMatchObject({ status: { used: 1 } });
  });
  it.each(["text", "role", "revision"])(
    "rejects a stale %s before applying and leaves the current deck intact",
    async (change) => {
      const f = await fixture(),
        job = await ready(f);
      await f.edit((draft) => {
        const block = draft.blocks[0]!;
        if (block.kind !== "content" || !block.scene) return;
        const node = block.scene.nodes.find((candidate) => candidate.id === nodeId)!;
        if (node.type !== "text") return;
        if (change === "text") node.text = "A later author edit";
        if (change === "role") {
          node.role = "body";
          block.scene.nodes.push({ ...node, id: "replacement-title", role: "title" });
          block.scene.readingOrder.push("replacement-title");
        }
        if (change === "revision") draft.description = "A later author edit";
      });
      const before = await f.presentations.getPresentation(workspaceId, f.presentation.id);
      const result = await f.apply(job, change === "revision" ? {} : { expectedRevision: 2 });
      expect(result.statusCode, result.body).toBe(409);
      expect(await f.presentations.getPresentation(workspaceId, f.presentation.id)).toEqual(before);
    },
  );
  it("rejects rich text and stale new admissions without consuming an allowance", async () => {
    const f = await fixture();
    expect((await f.post({ ...f.request, sourceDigest: "a".repeat(64) })).statusCode).toBe(409);
    expect((await f.post({ ...f.request, expectedRevision: 0 })).statusCode).toBe(409);
    await f.edit((draft) => {
      const block = draft.blocks[0]!;
      if (block.kind === "content" && block.scene) {
        block.scene.schemaVersion = 2;
        const node = block.scene.nodes.find((candidate) => candidate.id === nodeId)!;
        if (node.type === "text")
          node.richText = { paragraphs: [{ kind: "paragraph", runs: [{ text: originalText }] }] };
      }
    });
    expect((await f.post({ ...f.request, expectedRevision: 2 })).statusCode).toBe(422);
    expect((await f.status()).json()).toMatchObject({ status: { used: 0 } });
  });
  it("rewrites one plain body object while retaining its scene version and other text", async () => {
    const rewritten =
      "Before the project starts, take time together to agree on a shared purpose and make sure everyone understands it.";
    const generate = vi.fn().mockResolvedValue({ text: rewritten }),
      f = await fixture(generate);
    await f.edit((draft) => {
      const block = draft.blocks[0]!;
      if (block.kind !== "content" || !block.scene) throw new Error("Missing scene");
      const node = block.scene.nodes.find((candidate) => candidate.id === nodeId)!;
      if (node.type !== "text") throw new Error("Missing target");
      node.role = "body";
      block.scene.nodes.push({
        ...node,
        id: "unchanged-title",
        role: "title",
        text: "Other title",
      });
      block.scene.readingOrder.push("unchanged-title");
    });
    expect(
      (await f.post({ ...f.request, expectedRevision: 2, operation: "rewrite" })).statusCode,
    ).toBe(202);
    expect(await f.presentationTextAssistanceWorker.runOnce()).toBe("completed");
    expect(generate).toHaveBeenCalledExactlyOnceWith({
      text: originalText,
      role: "body",
      operation: "rewrite",
    });
    const job = (await f.get()).json<{ job: PresentationTextAssistanceJob }>().job;
    const response = await f.apply(job, { expectedRevision: 2 });
    expect(response.statusCode, response.body).toBe(200);
    const block = response.json().presentation.draft.blocks[0];
    expect(block.scene.schemaVersion).toBe(1);
    expect(block.scene.nodes.find((node: { id: string }) => node.id === nodeId).text).toBe(
      rewritten,
    );
    expect(
      block.scene.nodes.find((node: { id: string }) => node.id === "unchanged-title").text,
    ).toBe("Other title");
    expect(block.textAssistance).toMatchObject({ nodeId, role: "body", operation: "rewrite" });
  });
  it("fences expiry between reviewing and saving a proposal", async () => {
    const f = await fixture(),
      job = await ready(f);
    const save = f.presentations.updatePresentationDraft.bind(f.presentations);
    vi.spyOn(f.presentations, "updatePresentationDraft").mockImplementationOnce(async (input) => {
      await f.presentationTextAssistance.jobs.purgeExpired(new Date(Date.now() + 25 * 60 * 60_000));
      return save(input);
    });
    const before = await f.presentations.getPresentation(workspaceId, f.presentation.id);
    expect((await f.apply(job)).statusCode).toBe(409);
    expect(await f.presentations.getPresentation(workspaceId, f.presentation.id)).toEqual(before);
  });
  it("uses the shared outline/text active cap and authoring allowance, and erases expired text before generation", async () => {
    const generate = vi.fn().mockResolvedValue({ text: proposedText }),
      f = await fixture(generate);
    expect((await f.post()).statusCode).toBe(202);
    expect((await f.post({ ...f.request, requestId: randomUUID() })).statusCode).toBe(202);
    expect((await f.post({ ...f.request, requestId: randomUUID() })).statusCode).toBe(429);
    const outline = await app!.inject({
      method: "POST",
      url: "/v1/presentation-assistance/jobs",
      headers: { cookie: f.cookie },
      payload: {
        schemaVersion: 1,
        requestId: randomUUID(),
        presentationId: f.presentation.id,
        sourceName: "Outline",
        outline: "Agree on a shared purpose. Choose an owner. Review progress together.",
        slideCount: 3,
      },
    });
    expect(outline.statusCode).toBe(429);
    expect(
      (
        await app!.inject({
          method: "GET",
          url: `/v1/presentation-assistance/status?presentationId=${f.presentation.id}`,
          headers: { cookie: f.cookie },
        })
      ).json(),
    ).toMatchObject({ status: { used: 2, active: 2 } });
    expect(
      await f.presentationTextAssistanceWorker.runOnce(new Date(Date.now() + 25 * 60 * 60_000)),
    ).toBe("idle");
    expect(generate).not.toHaveBeenCalled();
    expect((await f.post({ ...f.request, requestId: randomUUID() })).statusCode).toBe(202);
    expect((await f.post({ ...f.request, requestId: randomUUID() })).statusCode).toBe(429);
  });
  it("bounds provider retries at three claims, sanitizes failures, and never changes the deck", async () => {
    const generate = vi.fn().mockRejectedValue(new Error("PRIVATE provider source/secret")),
      f = await fixture(generate);
    const before = await f.presentations.getPresentation(workspaceId, f.presentation.id);
    await f.post();
    const now = new Date();
    expect(await f.presentationTextAssistanceWorker.runOnce(now)).toBe("retry_scheduled");
    expect(await f.presentationTextAssistanceWorker.runOnce(new Date(now.getTime() + 10_000))).toBe(
      "retry_scheduled",
    );
    expect(await f.presentationTextAssistanceWorker.runOnce(new Date(now.getTime() + 30_000))).toBe(
      "failed",
    );
    expect(await f.presentationTextAssistanceWorker.runOnce(new Date(now.getTime() + 60_000))).toBe(
      "idle",
    );
    expect(generate).toHaveBeenCalledTimes(3);
    const response = await f.get();
    expect(response.json()).toMatchObject({
      job: { status: "failed", attempts: 3, proposal: null, error: { code: "ATTEMPTS_EXHAUSTED" } },
    });
    expect(response.body).not.toContain("PRIVATE");
    expect(await f.presentations.getPresentation(workspaceId, f.presentation.id)).toEqual(before);
  });
  it("fails invalid output with a static error", async () => {
    const f = await fixture(
      vi.fn().mockResolvedValue({ text: "PRIVATE provider wording", citations: ["unsupported"] }),
    );
    const before = await f.presentations.getPresentation(workspaceId, f.presentation.id);
    await f.post();
    expect(await f.presentationTextAssistanceWorker.runOnce()).toBe("failed");
    const response = await f.get();
    expect(response.json()).toMatchObject({
      job: { status: "failed", proposal: null, error: { code: "INVALID_OUTPUT" } },
    });
    expect(response.body).not.toContain("PRIVATE");
    expect(await f.presentations.getPresentation(workspaceId, f.presentation.id)).toEqual(before);
  });
  it("enforces the override provider deadline", async () => {
    let started!: () => void;
    const began = new Promise<void>((resolve) => {
      started = resolve;
    });
    const f = await fixture(async () => {
      started();
      return new Promise(() => {});
    });
    await f.post();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const running = f.presentationTextAssistanceWorker.runOnce();
    await began;
    await vi.advanceTimersByTimeAsync(45_001);
    expect(await running).toBe("retry_scheduled");
    expect((await f.get()).json()).toMatchObject({
      job: {
        status: "pending",
        attempts: 1,
        proposal: null,
        error: { code: "PROVIDER_UNAVAILABLE" },
      },
    });
  });
  it("rechecks current editor authority after generation and before exposing output", async () => {
    let started!: () => void, release!: (raw: unknown) => void;
    const began = new Promise<void>((resolve) => {
      started = resolve;
    });
    const output = new Promise<unknown>((resolve) => {
      release = resolve;
    });
    const f = await fixture(async () => {
      started();
      return output;
    });
    await f.post();
    const running = f.presentationTextAssistanceWorker.runOnce();
    await began;
    const actor = [...f.repository.users.values()][0]!;
    actor.role = "viewer";
    f.repository.workspaceMembers.get(`${workspaceId}:${actor.userId}`)!.role = "viewer";
    release({ text: proposedText });
    expect(["failed", "superseded"]).toContain(await running);
    expect((await f.get()).statusCode).toBe(403);
    expect((await f.post()).statusCode).toBe(403);
    expect(
      (await f.presentations.getPresentation(workspaceId, f.presentation.id))!.draftRevision,
    ).toBe(1);
  });
});
