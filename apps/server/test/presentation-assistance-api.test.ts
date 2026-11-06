import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { MemoryRepository } from "@openround/db";
import {
  PresentationAssistanceJobSchema,
  PresentationDraftSchema,
  type PresentationAssistanceJob,
} from "@openround/contracts";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";
import { verifyEmailAndSignIn } from "./support/email-auth.js";
import type { PresentationAssistanceProvider } from "../src/presentation-assistance-provider.js";

const workspaceId = "10000000-0000-4000-8000-000000000006";
const outline =
  "Agree on a shared purpose before starting the project.\nChoose an owner for every agreed action.\nReview progress together at the next meeting.";
const rawOutput = {
  slides: [
    {
      title: "Purpose",
      body: "Agree on the purpose.",
      citations: [{ locator: "outline line 1", excerpt: "Agree on a shared purpose" }],
    },
    {
      title: "Ownership",
      body: "Choose the owners.",
      citations: [{ locator: "outline line 2", excerpt: "Choose an owner" }],
    },
    {
      title: "Review",
      body: "Review progress together.",
      citations: [{ locator: "outline line 3", excerpt: "Review progress together" }],
    },
  ],
};
let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});
async function fixture(
  generate: PresentationAssistanceProvider["generate"] | null = vi
    .fn()
    .mockResolvedValue(rawOutput),
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
      presentationAssistanceProvider: generate
        ? { providerName: "approved-test", modelName, generate }
        : null,
    },
  );
  app = built.app;
  const email = `assistance-${randomUUID()}@example.com`;
  const requested = await app.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: { email, segment: "education", acceptPolicies: true },
  });
  const token = new URL(requested.json<{ debugUrl: string }>().debugUrl).searchParams.get("token")!;
  const verified = await verifyEmailAndSignIn(app, `/v1/auth/verify?token=${token}`, email);
  const setCookie = verified.headers["set-cookie"]!;
  const cookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(";")[0]!;
  const created = await app.inject({
    method: "POST",
    url: "/v1/presentations",
    headers: { cookie },
    payload: { title: "Existing project", description: "Preserve this description" },
  });
  expect(created.statusCode).toBe(201);
  const presentation = created.json<{
    presentation: { id: string; draftRevision: number; draft: { blocks: Array<{ id: string }> } };
  }>().presentation;
  const request = {
    schemaVersion: 1 as const,
    requestId: randomUUID(),
    presentationId: presentation.id,
    sourceName: "Project outline",
    outline,
    slideCount: 3,
  };
  const post = (payload: unknown = request) =>
    app!.inject({
      method: "POST",
      url: "/v1/presentation-assistance/jobs",
      headers: { cookie },
      payload: payload as object,
    });
  const get = () =>
    app!.inject({
      method: "GET",
      url: `/v1/presentation-assistance/jobs/${request.requestId}?presentationId=${presentation.id}`,
      headers: { cookie },
    });
  return { ...built, repository, cookie, presentation, request, post, get };
}

describe("Presentation outline assistance API", () => {
  it("refuses unsupported provider identities before spending an allowance", async () => {
    const generate = vi.fn(),
      f = await fixture(generate, "m".repeat(121));
    expect((await f.post()).statusCode).toBe(503);
    const status = await app!.inject({
      method: "GET",
      url: `/v1/presentation-assistance/status?presentationId=${f.presentation.id}`,
      headers: { cookie: f.cookie },
    });
    expect(status.json()).toMatchObject({ status: { enabled: false, used: 0, remaining: 3 } });
    expect(generate).not.toHaveBeenCalled();
  });
  it("shows the unchanged free allowance and stores nothing when the provider is disabled", async () => {
    const f = await fixture(null);
    const status = await app!.inject({
      method: "GET",
      url: `/v1/presentation-assistance/status?presentationId=${f.presentation.id}`,
      headers: { cookie: f.cookie },
    });
    expect(status.json()).toMatchObject({
      status: { enabled: false, monthlyLimit: 3, used: 0, remaining: 3, maxActiveJobs: 2 },
    });
    expect((await f.post()).statusCode).toBe(503);
    expect((await f.get()).statusCode).toBe(404);
    expect(f.repository.authoringJobs.size).toBe(0);
  });

  it("deduplicates generation and inserts only explicitly reviewed selected native slides with exact apply receipts", async () => {
    const generate = vi.fn().mockResolvedValue(rawOutput),
      f = await fixture(generate);
    const queued = await f.post();
    expect(queued.statusCode).toBe(202);
    expect(queued.body).not.toContain(outline);
    expect((await f.post()).statusCode).toBe(200);
    const caseEquivalent = await f.post({
      ...f.request,
      requestId: f.request.requestId.toUpperCase(),
      presentationId: f.presentation.id.toUpperCase(),
    });
    expect(caseEquivalent.statusCode).toBe(200);
    expect(caseEquivalent.json().job.id).toBe(f.request.requestId);
    const upperRead = await app!.inject({
      method: "GET",
      url: `/v1/presentation-assistance/jobs/${f.request.requestId.toUpperCase()}?presentationId=${f.presentation.id.toUpperCase()}`,
      headers: { cookie: f.cookie },
    });
    expect(upperRead.statusCode).toBe(200);
    expect(upperRead.json().job.id).toBe(f.request.requestId);
    expect((await f.post({ ...f.request, outline: `${outline} Changed source.` })).statusCode).toBe(
      409,
    );
    const original = await f.presentations.getPresentation(workspaceId, f.presentation.id);
    expect(await f.presentationAssistanceWorker.runOnce()).toBe("completed");
    expect(generate).toHaveBeenCalledOnce();
    expect(generate).toHaveBeenCalledWith({
      sourceName: f.request.sourceName,
      outline,
      slideCount: 3,
    });
    expect(await f.presentations.getPresentation(workspaceId, f.presentation.id)).toEqual(original);
    const reviewed = await f.get(),
      job = PresentationAssistanceJobSchema.parse(
        reviewed.json<{ job: PresentationAssistanceJob }>().job,
      );
    expect(job.proposal!.reviewWarning).toContain("Claims are unverified");
    const input = {
      schemaVersion: 1,
      jobId: job.id,
      proposalHash: job.proposalHash,
      selectedSlideIds: job.proposal!.slides.slice(0, 2).map(({ id }) => id),
      reviewed: true,
      expectedRevision: 0,
      mutationId: randomUUID(),
      afterBlockId: f.presentation.draft.blocks[0]!.id,
    };
    const insert = (payload: unknown = input) =>
      app!.inject({
        method: "POST",
        url: `/v1/presentations/${f.presentation.id}/blocks/assistance-proposals`,
        headers: { cookie: f.cookie },
        payload: payload as object,
      });
    expect((await insert({ ...input, reviewed: false })).statusCode).toBe(400);
    expect((await insert({ ...input, proposalHash: "a".repeat(64) })).statusCode).toBe(409);
    expect((await insert({ ...input, selectedSlideIds: [randomUUID()] })).statusCode).toBe(422);
    const applied = await insert();
    expect(applied.statusCode, applied.body).toBe(200);
    const result = applied.json<{
      presentation: {
        id: string;
        status: string;
        currentVersionId: null;
        draftRevision: number;
        draft: unknown;
      };
      insertedBlockIds: string[];
    }>();
    expect(result.presentation).toMatchObject({
      id: f.presentation.id,
      status: "draft",
      currentVersionId: null,
      draftRevision: 1,
    });
    const draft = PresentationDraftSchema.parse(result.presentation.draft);
    expect(draft.description).toBe("Preserve this description");
    expect(draft.blocks).toHaveLength(2);
    expect(draft.blocks[0]).toMatchObject({
      kind: "content",
      textElements: [],
      scene: {
        schemaVersion: 6,
        nodes: [
          { type: "text", role: "title", text: "Purpose" },
          { type: "text", role: "body" },
        ],
      },
      citations: rawOutput.slides[0]!.citations,
      sourceDisclosure: { conversionNotes: [job.proposal!.reviewWarning] },
    });
    const replay = await insert();
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(result);
    const upperReplay = await insert({
      ...input,
      jobId: input.jobId.toUpperCase(),
      selectedSlideIds: input.selectedSlideIds.map((id) => id.toUpperCase()),
      mutationId: input.mutationId.toUpperCase(),
      afterBlockId: input.afterBlockId.toUpperCase(),
    });
    expect(upperReplay.statusCode).toBe(200);
    expect(upperReplay.json()).toEqual(result);
    expect(
      (await insert({ ...input, selectedSlideIds: [job.proposal!.slides[2]!.id] })).statusCode,
    ).toBe(409);
    expect(
      (await f.presentations.getPresentation(workspaceId, f.presentation.id))?.draftRevision,
    ).toBe(1);
    expect(f.repository.authoringJobs.size).toBe(0);
    const status = await app!.inject({
      method: "GET",
      url: `/v1/presentation-assistance/status?presentationId=${f.presentation.id}`,
      headers: { cookie: f.cookie },
    });
    expect(status.json()).toMatchObject({ status: { used: 1, remaining: 2, active: 0 } });
    await f.presentations.updatePresentationDraft({
      workspaceId,
      presentationId: f.presentation.id,
      draft: { ...draft, description: "A later edit after insertion" },
      expectedRevision: 1,
      mutationId: randomUUID(),
      draftHash: "later-edit-after-assistance",
      editorId: original!.lastEditedBy!,
    });
    await f.presentationAssistance.jobs.purgeExpired(new Date(Date.now() + 25 * 60 * 60_000));
    const recovered = await insert();
    expect(recovered.statusCode).toBe(200);
    expect(recovered.json<{ insertedBlockIds: string[] }>().insertedBlockIds).toEqual(
      result.insertedBlockIds,
    );
    expect(
      recovered.json<{ presentation: { draftRevision: number } }>().presentation.draftRevision,
    ).toBe(1);
    expect(
      (await f.presentations.getPresentation(workspaceId, f.presentation.id))?.draftRevision,
    ).toBe(2);
  });

  it("preserves the draft on invalid evidence and reports only a static error", async () => {
    const generate = vi.fn().mockResolvedValue({
      slides: rawOutput.slides.map((slide) => ({
        ...slide,
        citations: [{ locator: "invented page", excerpt: "PRIVATE rejected provider text" }],
      })),
    });
    const f = await fixture(generate);
    const before = await f.presentations.getPresentation(workspaceId, f.presentation.id);
    await f.post();
    expect(await f.presentationAssistanceWorker.runOnce()).toBe("failed");
    const response = await f.get();
    expect(response.json()).toMatchObject({
      job: { status: "failed", error: { code: "INVALID_OUTPUT" }, proposal: null },
    });
    expect(response.body).not.toContain("PRIVATE");
    expect(await f.presentations.getPresentation(workspaceId, f.presentation.id)).toEqual(before);
  });

  it("rechecks current editor authority before accepting in-flight generation and exposing proposals", async () => {
    let started!: () => void, release!: (value: unknown) => void;
    const began = new Promise<void>((resolve) => {
      started = resolve;
    });
    const generated = new Promise<unknown>((resolve) => {
      release = resolve;
    });
    const f = await fixture(async () => {
      started();
      return generated;
    });
    await f.post();
    const running = f.presentationAssistanceWorker.runOnce();
    await began;
    const actor = [...f.repository.users.values()][0]!;
    actor.role = "viewer";
    f.repository.workspaceMembers.get(`${workspaceId}:${actor.userId}`)!.role = "viewer";
    release(rawOutput);
    expect(["failed", "superseded"]).toContain(await running);
    expect((await f.get()).statusCode).toBe(403);
    expect((await f.post()).statusCode).toBe(403);
    expect(
      (await f.presentations.getPresentation(workspaceId, f.presentation.id))?.draftRevision,
    ).toBe(0);
  });

  it("retries unavailable providers at most three times while preserving the draft", async () => {
    const generate = vi.fn().mockRejectedValue(new Error("PRIVATE provider source/secret")),
      f = await fixture(generate);
    const before = await f.presentations.getPresentation(workspaceId, f.presentation.id);
    await f.post();
    const now = new Date();
    expect(await f.presentationAssistanceWorker.runOnce(now)).toBe("retry_scheduled");
    expect(await f.presentationAssistanceWorker.runOnce(new Date(now.getTime() + 10_000))).toBe(
      "retry_scheduled",
    );
    expect(await f.presentationAssistanceWorker.runOnce(new Date(now.getTime() + 30_000))).toBe(
      "failed",
    );
    expect(await f.presentationAssistanceWorker.runOnce(new Date(now.getTime() + 60_000))).toBe(
      "idle",
    );
    expect(generate).toHaveBeenCalledTimes(3);
    const job = await f.get();
    expect(job.json()).toMatchObject({ job: { status: "failed", attempts: 3 } });
    expect(job.body).not.toContain("PRIVATE");
    expect(await f.presentations.getPresentation(workspaceId, f.presentation.id)).toEqual(before);
  });

  it("rejects stale revision and unavailable targets without changing the current deck", async () => {
    const f = await fixture();
    await f.post();
    await f.presentationAssistanceWorker.runOnce();
    const job = (await f.get()).json<{ job: PresentationAssistanceJob }>().job;
    const current = (await f.presentations.getPresentation(workspaceId, f.presentation.id))!;
    await f.presentations.updatePresentationDraft({
      workspaceId,
      presentationId: current.id,
      draft: { ...current.draft, description: "A later edit" },
      expectedRevision: 0,
      mutationId: randomUUID(),
      draftHash: "later-author-edit",
      editorId: current.lastEditedBy!,
    });
    const before = await f.presentations.getPresentation(workspaceId, current.id);
    const response = await app!.inject({
      method: "POST",
      url: `/v1/presentations/${current.id}/blocks/assistance-proposals`,
      headers: { cookie: f.cookie },
      payload: {
        schemaVersion: 1,
        jobId: job.id,
        proposalHash: job.proposalHash,
        selectedSlideIds: [job.proposal!.slides[0]!.id],
        reviewed: true,
        expectedRevision: 0,
        mutationId: randomUUID(),
        afterBlockId: null,
      },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: "STALE_DRAFT" } });
    expect(await f.presentations.getPresentation(workspaceId, current.id)).toEqual(before);
    expect(
      (
        await app!.inject({
          method: "GET",
          url: `/v1/presentation-assistance/jobs/${job.id}?presentationId=${randomUUID()}`,
          headers: { cookie: f.cookie },
        })
      ).statusCode,
    ).toBe(404);
  });

  it("fences expiry that happens after reviewing the job but before the draft commit", async () => {
    const f = await fixture();
    await f.post();
    await f.presentationAssistanceWorker.runOnce();
    const job = (await f.get()).json<{ job: PresentationAssistanceJob }>().job;
    const update = f.presentations.updatePresentationDraft.bind(f.presentations);
    vi.spyOn(f.presentations, "updatePresentationDraft").mockImplementationOnce(async (input) => {
      await f.presentationAssistance.jobs.purgeExpired(new Date(Date.now() + 25 * 60 * 60_000));
      return update(input);
    });
    const before = await f.presentations.getPresentation(workspaceId, f.presentation.id);
    const response = await app!.inject({
      method: "POST",
      url: `/v1/presentations/${f.presentation.id}/blocks/assistance-proposals`,
      headers: { cookie: f.cookie },
      payload: {
        schemaVersion: 1,
        jobId: job.id,
        proposalHash: job.proposalHash,
        selectedSlideIds: [job.proposal!.slides[0]!.id],
        reviewed: true,
        expectedRevision: 0,
        mutationId: randomUUID(),
        afterBlockId: null,
      },
    });
    expect(response.statusCode, response.body).toBe(409);
    expect(await f.presentations.getPresentation(workspaceId, f.presentation.id)).toEqual(before);
  });

  it("expires sources before generation and respects the shared monthly allowance and active cap", async () => {
    const generate = vi.fn().mockResolvedValue(rawOutput),
      f = await fixture(generate);
    await f.post();
    expect((await f.post({ ...f.request, requestId: randomUUID() })).statusCode).toBe(202);
    expect((await f.post({ ...f.request, requestId: randomUUID() })).statusCode).toBe(429);
    expect(
      await f.presentationAssistanceWorker.runOnce(new Date(Date.now() + 24 * 60 * 60_000 + 1_000)),
    ).toBe("idle");
    expect(generate).not.toHaveBeenCalled();
    expect((await f.post({ ...f.request, requestId: randomUUID() })).statusCode).toBe(202);
    expect((await f.post({ ...f.request, requestId: randomUUID() })).statusCode).toBe(429);
  });
});
