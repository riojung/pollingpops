import { signInFromVerificationResponse } from "./support/email-auth.js";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type {
  PresentationDraft,
  PresentationRecoveryPackUpdatePreview,
  RecoveryPackDraft,
} from "@openround/contracts";
import {
  createPresentationRepository,
  createRecoveryPackRepository,
  MemoryRepository,
  type PresentationRecord,
  type RecoveryPackVersionRecord,
} from "@openround/db";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";
import { PRESENTATION_PACK_INSERTION_DRAFT_LIMIT } from "../src/draft-limits.js";
import { recoveryPackHash, recoveryPackQuestions } from "../src/recovery-pack-copies.js";

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function packDraft(): RecoveryPackDraft {
  const question = (prompt: string) => ({
    id: randomUUID(),
    type: "single_select" as const,
    prompt,
    purpose: "diagnostic" as const,
    confidence: "optional" as const,
    delivery: "main" as const,
    conceptKeys: ["evidence"],
    linkedRecheckQuestionId: null as string | null,
    timeLimitSeconds: 30,
    basePoints: 100,
    explanation: "PRIVATE rationale",
    mediaId: null,
    mediaAlt: null,
    choices: [
      { id: randomUUID(), label: "Observation", isCorrect: true },
      { id: randomUUID(), label: "Assumption", isCorrect: false },
    ],
  });
  const recheck = {
    ...question("Apply the idea to another scenario"),
    delivery: "recheck" as const,
  };
  return {
    schemaVersion: 1,
    title: "Evidence Pack",
    description: "",
    diagnostic: {
      ...question("Which signal supports the conclusion?"),
      linkedRecheckQuestionId: recheck.id,
    },
    recheck,
    delayedProbe: question("PRIVATE delayed probe"),
    interventions: [
      { id: randomUUID(), title: "PRIVATE intervention", body: "PRIVATE card body", citations: [] },
    ],
    conceptKeys: ["evidence"],
    misconceptionKeys: [],
    citations: [],
  };
}

async function setup(
  options: {
    repository?: MemoryRepository;
    workspaceId?: string;
    packs?: boolean;
    presentations?: boolean;
    allowlisted?: boolean;
    uxAllowlisted?: boolean;
  } = {},
) {
  const workspaceId = options.workspaceId ?? randomUUID();
  const repository =
    options.repository ?? new MemoryRepository({ initialWorkspaceId: workspaceId });
  const { app } = await buildApp(
    ConfigSchema.parse({
      NODE_ENV: "test",
      ALLOW_IN_MEMORY: "true",
      COMMUNITY_MODE: "false",
      WEB_ORIGIN: "http://localhost:3000",
      PUBLIC_API_URL: "http://localhost:4000",
      LOG_LEVEL: "silent",
      FEATURE_UX_BETA: "true",
      UX_BETA_WORKSPACE_ALLOWLIST: options.uxAllowlisted === false ? "" : workspaceId,
      FEATURE_PRESENTATIONS: String(options.presentations ?? true),
      FEATURE_PRESENTATION_REALTIME: "true",
      FEATURE_RECOVERY_PACKS: String(options.packs ?? true),
      EVIDENCE_FEATURES_WORKSPACE_ALLOWLIST: options.allowlisted === false ? "" : workspaceId,
    }),
    { repository, cache: new MemorySessionCache() },
  );
  apps.push(app);
  const magic = await app.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: {
      email: "presentation-pack-author@example.com",
      segment: "workplace",
      acceptPolicies: true,
    },
  });
  const verified = await signInFromVerificationResponse(
    app,
    magic,
    "presentation-pack-author@example.com",
  );
  const cookies = verified.headers["set-cookie"]!;
  const cookie = (Array.isArray(cookies) ? cookies[0]! : cookies).split(";")[0]!;
  return { app, repository, workspaceId, cookie };
}

async function material(app: FastifyInstance, cookie: string, content = packDraft()) {
  const createdPack = await app.inject({
    method: "POST",
    url: "/v1/recovery-packs",
    headers: { cookie },
    payload: { draft: content },
  });
  expect(createdPack.statusCode, createdPack.body).toBe(201);
  const packId = createdPack.json().pack.id as string;
  const published = await app.inject({
    method: "POST",
    url: `/v1/recovery-packs/${packId}/publish`,
    headers: { cookie },
    payload: { expectedDraftRevision: 0 },
  });
  expect(published.statusCode, published.body).toBe(200);
  const version = published.json<{ version: RecoveryPackVersionRecord }>().version;
  const created = await app.inject({
    method: "POST",
    url: "/v1/presentations",
    headers: { cookie },
    payload: { title: "Pack Presentation" },
  });
  expect(created.statusCode, created.body).toBe(201);
  const presentation = created.json<{ presentation: PresentationRecord }>().presentation;
  const saved = await save(app, cookie, presentation, { ...presentation.draft, blocks: [] });
  expect(saved.statusCode, saved.body).toBe(200);
  return {
    packId,
    version,
    presentation: saved.json<{ presentation: PresentationRecord }>().presentation,
  };
}

function save(
  app: FastifyInstance,
  cookie: string,
  presentation: PresentationRecord,
  draft: PresentationDraft,
) {
  return app.inject({
    method: "PUT",
    url: `/v1/presentations/${presentation.id}/draft`,
    headers: { cookie },
    payload: {
      schemaVersion: 2,
      expectedRevision: presentation.draftRevision,
      mutationId: randomUUID(),
      draft,
    },
  });
}

function insert(app: FastifyInstance, cookie: string, id: string, input: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: `/v1/presentations/${id}/recovery-packs/insert`,
    headers: { cookie },
    payload: input,
  });
}

async function updateFixture() {
  const initial = await setup();
  const { app, cookie, repository, workspaceId } = initial;
  const source = await material(app, cookie);
  const inserted = await insert(app, cookie, source.presentation.id, {
    packVersionId: source.version.id,
    expectedRevision: source.presentation.draftRevision,
    mutationId: randomUUID(),
  });
  expect(inserted.statusCode, inserted.body).toBe(200);
  const presentation = inserted.json<{ presentation: PresentationRecord }>().presentation;
  const insertionId = presentation.draft.recoveryPackInsertions![0]!.id;
  const packs = createRecoveryPackRepository(repository);
  const publishNext = async (edit: (draft: RecoveryPackDraft) => void) => {
    const current = (await packs.getRecoveryPack(workspaceId, source.packId))!;
    const draft = structuredClone(current.draft);
    edit(draft);
    const saved = await app.inject({
      method: "PUT",
      url: `/v1/recovery-packs/${source.packId}/draft`,
      headers: { cookie },
      payload: { draft, expectedRevision: current.draftRevision, mutationId: randomUUID() },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    const published = await app.inject({
      method: "POST",
      url: `/v1/recovery-packs/${source.packId}/publish`,
      headers: { cookie },
      payload: { expectedDraftRevision: saved.json().pack.draftRevision },
    });
    expect(published.statusCode, published.body).toBe(200);
    return published.json<{ version: RecoveryPackVersionRecord }>().version;
  };
  const review = async () => {
    const response = await app.inject({
      method: "POST",
      url: `/v1/presentations/${presentation.id}/recovery-packs/update-review`,
      headers: { cookie },
      payload: { insertionId },
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json<{ review: PresentationRecoveryPackUpdatePreview }>().review;
  };
  const apply = (input: Record<string, unknown>, target = { app, cookie }) =>
    target.app.inject({
      method: "POST",
      url: `/v1/presentations/${presentation.id}/recovery-packs/update`,
      headers: { cookie: target.cookie },
      payload: input,
    });
  const requestFor = (preview: PresentationRecoveryPackUpdatePreview) => ({
    insertionId,
    packVersionId: preview.latestVersionId,
    expectedRevision: preview.draftRevision,
    mutationId: randomUUID(),
    choices: [],
  });
  const saveLocal = async (edit: (draft: PresentationDraft) => void) => {
    const read = await app.inject({
      method: "GET",
      url: `/v1/presentations/${presentation.id}`,
      headers: { cookie },
    });
    const current = read.json<{ presentation: PresentationRecord }>().presentation;
    const draft = structuredClone(current.draft);
    edit(draft);
    const result = await save(app, cookie, current, draft);
    expect(result.statusCode, result.body).toBe(200);
    return result.json<{ presentation: PresentationRecord }>().presentation;
  };
  return {
    ...initial,
    ...source,
    presentation,
    insertionId,
    publishNext,
    review,
    apply,
    requestFor,
    saveLocal,
  };
}

describe("Recovery Pack Presentation insertion", () => {
  it("freezes the complete baseline and remaps the pair, then publishes without leaking private references", async () => {
    const { app, cookie } = await setup();
    const { version, presentation } = await material(app, cookie);
    const inserted = await insert(app, cookie, presentation.id, {
      packVersionId: version.id,
      expectedRevision: 1,
      mutationId: randomUUID(),
    });
    expect(inserted.statusCode, inserted.body).toBe(200);
    const result = inserted.json<{
      presentation: PresentationRecord;
      insertedBlockIds: string[];
    }>();
    expect(result.presentation.draftSchemaVersion).toBe(3);
    expect(result.presentation.draft.schemaVersion).toBe(3);
    expect(result.presentation.draft.blocks.map((block) => block.id)).toEqual(
      result.insertedBlockIds,
    );
    const [diagnostic, recheck] = result.presentation.draft.blocks;
    if (diagnostic?.kind !== "question" || recheck?.kind !== "question")
      throw new Error("Missing copied pair");
    expect(diagnostic.question.id).not.toBe(version.content.diagnostic.id);
    expect(diagnostic.question.linkedRecheckQuestionId).toBe(recheck.question.id);
    expect(diagnostic.question.recoveryPackSource).toMatchObject({
      packVersionId: version.id,
      role: "diagnostic",
      sourceItemId: version.content.diagnostic.id,
    });
    expect(result.presentation.draft.recoveryPackInsertions?.[0]?.originalContent).toEqual(
      version.content,
    );
    const published = await app.inject({
      method: "POST",
      url: `/v1/presentations/${presentation.id}/publish`,
      headers: { cookie },
      payload: { expectedDraftRevision: 2 },
    });
    expect(published.statusCode, published.body).toBe(200);
    expect(published.json().version.contentSchemaVersion).toBe(3);
    const hosted = await app.inject({
      method: "POST",
      url: "/v1/presentation-sessions",
      headers: { cookie },
      payload: { presentationId: presentation.id },
    });
    expect(hosted.statusCode, hosted.body).toBe(201);
    const session = hosted.json().snapshot;
    const joined = await app.inject({
      method: "POST",
      url: "/v1/presentation-sessions/join",
      payload: { code: session.code, nickname: "Learner" },
    });
    expect(joined.statusCode).toBe(201);
    const opened = await app.inject({
      method: "POST",
      url: `/v1/presentation-sessions/${session.id}/advance`,
      headers: { cookie },
      payload: { expectedRevision: session.revision },
    });
    expect(opened.statusCode, opened.body).toBe(200);
    const participant = await app.inject({
      method: "GET",
      url: `/v1/presentation-sessions/${session.id}/participant`,
      headers: { authorization: `Bearer ${joined.json().participantToken}` },
    });
    expect(participant.statusCode).toBe(200);
    for (const body of [opened.body, participant.body]) {
      for (const privateField of [
        "PRIVATE",
        "recoveryPackSource",
        "recoveryPackInsertions",
        "originalContent",
        "delayedProbe",
        "isCorrect",
        "explanation",
        "sourceCitations",
      ])
        expect(body).not.toContain(privateField);
    }
  });

  it("replays exactly once after concurrent edits and source deletion, rejecting changed intent", async () => {
    const { app, cookie } = await setup();
    const { packId, version, presentation } = await material(app, cookie);
    const input = {
      packVersionId: version.id,
      expectedRevision: 1,
      mutationId: randomUUID(),
      afterBlockId: null,
    };
    const [first, duplicate] = await Promise.all([
      insert(app, cookie, presentation.id, input),
      insert(app, cookie, presentation.id, input),
    ]);
    expect(first.statusCode, first.body).toBe(200);
    expect(duplicate.statusCode, duplicate.body).toBe(200);
    expect(first.json()).toEqual(duplicate.json());
    const result = first.json<{ presentation: PresentationRecord }>().presentation;
    const edited = await save(app, cookie, result, { ...result.draft, title: "Later edit" });
    expect(edited.statusCode).toBe(200);
    const deleted = await app.inject({
      method: "DELETE",
      url: `/v1/recovery-packs/${packId}`,
      headers: { cookie },
    });
    expect(deleted.statusCode).toBe(204);
    const replay = await insert(app, cookie, presentation.id, input);
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json()).toEqual(first.json());
    const read = await app.inject({
      method: "GET",
      url: `/v1/presentations/${presentation.id}`,
      headers: { cookie },
    });
    expect(read.json().presentation).toMatchObject({
      draftRevision: 3,
      draft: {
        title: "Later edit",
        recoveryPackInsertions: [{ originalContent: version.content }],
      },
    });
    const changed = await insert(app, cookie, presentation.id, {
      ...input,
      afterBlockId: randomUUID(),
    });
    expect(changed.statusCode).toBe(409);
    const stale = await insert(app, cookie, presentation.id, {
      ...input,
      mutationId: randomUUID(),
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("STALE_DRAFT");
  });

  it("inserts after the requested block, and rejects absent anchors without saving", async () => {
    const { app, cookie } = await setup();
    const { version, presentation } = await material(app, cookie);
    const first = await insert(app, cookie, presentation.id, {
      packVersionId: version.id,
      expectedRevision: 1,
      mutationId: randomUUID(),
    });
    const blocks = first.json().presentation.draft.blocks;
    const invalid = await insert(app, cookie, presentation.id, {
      packVersionId: version.id,
      expectedRevision: 2,
      mutationId: randomUUID(),
      afterBlockId: randomUUID(),
    });
    expect(invalid.statusCode).toBe(422);
    const inserted = await insert(app, cookie, presentation.id, {
      packVersionId: version.id,
      expectedRevision: 2,
      mutationId: randomUUID(),
      afterBlockId: blocks[1].id,
    });
    expect(inserted.statusCode, inserted.body).toBe(200);
    expect(inserted.json().presentation.draftRevision).toBe(3);
    expect(
      inserted.json().presentation.draft.blocks.map((block: { id: string }) => block.id),
    ).toEqual([
      ...blocks.map((block: { id: string }) => block.id),
      ...inserted.json().insertedBlockIds,
    ]);
  });

  it("rejects tampered frozen evidence through normal saves while allowing local question edits", async () => {
    const { app, cookie } = await setup();
    const { version, presentation } = await material(app, cookie);
    const inserted = await insert(app, cookie, presentation.id, {
      packVersionId: version.id,
      expectedRevision: 1,
      mutationId: randomUUID(),
    });
    const result = inserted.json<{ presentation: PresentationRecord }>().presentation;
    const tampered = structuredClone(result.draft);
    tampered.recoveryPackInsertions![0]!.originalContent.interventions[0]!.body =
      "Altered evidence";
    expect((await save(app, cookie, result, tampered)).statusCode).toBe(400);
    const edited = structuredClone(result.draft);
    const block = edited.blocks[0]!;
    if (block.kind === "question") block.question.prompt = "Locally revised diagnostic";
    const saved = await save(app, cookie, result, edited);
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json().presentation.draft.recoveryPackInsertions[0].originalContent).toEqual(
      version.content,
    );
  });

  it("validates probe-only media at publish and never authorizes it through live media routes", async () => {
    const { app, cookie, repository, workspaceId } = await setup();
    const mediaId = randomUUID();
    await repository.createMediaAsset({
      id: mediaId,
      workspaceId,
      objectKey: `media/${workspaceId}/${mediaId}.png`,
      mimeType: "image/png",
      sizeBytes: 10,
      scanStatus: "clean",
      altText: "Probe diagram",
      createdAt: new Date(),
    });
    const content = packDraft();
    content.delayedProbe!.mediaId = mediaId;
    content.delayedProbe!.mediaAlt = "Probe diagram";
    const { version, presentation } = await material(app, cookie, content);
    const inserted = await insert(app, cookie, presentation.id, {
      packVersionId: version.id,
      expectedRevision: 1,
      mutationId: randomUUID(),
    });
    expect(inserted.statusCode, inserted.body).toBe(200);
    repository.mediaAssets.get(mediaId)!.scanStatus = "rejected";
    const blocked = await app.inject({
      method: "POST",
      url: `/v1/presentations/${presentation.id}/publish`,
      headers: { cookie },
      payload: { expectedDraftRevision: 2 },
    });
    expect(blocked.statusCode, blocked.body).toBe(422);
    expect(blocked.json().validation.issues[0].path).toBe(
      "recoveryPackInsertions.0.originalContent.delayedProbe.mediaId",
    );
    repository.mediaAssets.get(mediaId)!.scanStatus = "clean";
    const published = await app.inject({
      method: "POST",
      url: `/v1/presentations/${presentation.id}/publish`,
      headers: { cookie },
      payload: { expectedDraftRevision: 2 },
    });
    expect(published.statusCode, published.body).toBe(200);
    const hosted = await app.inject({
      method: "POST",
      url: "/v1/presentation-sessions",
      headers: { cookie },
      payload: { presentationId: presentation.id },
    });
    const session = hosted.json().snapshot;
    const joined = await app.inject({
      method: "POST",
      url: "/v1/presentation-sessions/join",
      payload: { code: session.code, nickname: "Learner" },
    });
    await app.inject({
      method: "POST",
      url: `/v1/presentation-sessions/${session.id}/advance`,
      headers: { cookie },
      payload: { expectedRevision: 0 },
    });
    for (const request of [
      { url: `/v1/presentation-sessions/${session.id}/host-media/${mediaId}`, headers: { cookie } },
      {
        url: `/v1/presentation-sessions/${session.id}/media/${mediaId}`,
        headers: { authorization: `Bearer ${joined.json().participantToken}` },
      },
    ]) {
      const response = await app.inject({ method: "GET", ...request });
      expect(response.statusCode, response.body).toBe(404);
    }
  });

  it.each([
    { packs: false },
    { presentations: false },
    { allowlisted: false },
    { uxAllowlisted: false },
  ])(
    "replays accepted insertion receipts after rollout pauses without overwriting later edits: %j",
    async (flags) => {
      const initial = await setup();
      const { packId, version, presentation } = await material(initial.app, initial.cookie);
      const input = {
        packVersionId: version.id,
        expectedRevision: presentation.draftRevision,
        mutationId: randomUUID(),
        afterBlockId: null,
      };
      const accepted = await insert(initial.app, initial.cookie, presentation.id, input);
      expect(accepted.statusCode, accepted.body).toBe(200);
      const acknowledgement = accepted.json<{
        presentation: PresentationRecord;
        insertedBlockIds: string[];
      }>();
      const { app, cookie } = await setup({
        repository: initial.repository,
        workspaceId: initial.workspaceId,
        ...flags,
      });
      // The client did not receive the accepted acknowledgement before the rollout paused.
      const retry = await insert(app, cookie, presentation.id, input);
      expect(retry.statusCode, retry.body).toBe(200);
      expect(retry.json()).toEqual(acknowledgement);
      const blocked = await insert(app, cookie, presentation.id, {
        ...input,
        expectedRevision: acknowledgement.presentation.draftRevision,
        mutationId: randomUUID(),
      });
      expect(blocked.statusCode, blocked.body).toBe(404);
      expect(blocked.json().error.message).toContain("not enabled");

      const draft = structuredClone(acknowledgement.presentation.draft);
      draft.title = "Later local title";
      const diagnostic = draft.blocks[0]!;
      if (diagnostic.kind !== "question") throw new Error("Expected an inserted question");
      diagnostic.question.prompt = "Later local wording";
      const edited = await save(initial.app, initial.cookie, acknowledgement.presentation, draft);
      expect(edited.statusCode, edited.body).toBe(200);
      const latest = edited.json<{ presentation: PresentationRecord }>().presentation;
      const deleted = await initial.app.inject({
        method: "DELETE",
        url: `/v1/recovery-packs/${packId}`,
        headers: { cookie: initial.cookie },
      });
      expect(deleted.statusCode, deleted.body).toBe(204);

      const replay = await insert(app, cookie, presentation.id, input);
      expect(replay.statusCode, replay.body).toBe(200);
      expect(replay.json()).toEqual(acknowledgement);
      expect(replay.json().insertedBlockIds).toEqual(acknowledgement.insertedBlockIds);
      const changed = await insert(app, cookie, presentation.id, {
        ...input,
        afterBlockId: randomUUID(),
      });
      expect(changed.statusCode, changed.body).toBe(409);
      expect(changed.json().error.code).toBe("CONFLICT");
      const fresh = await insert(app, cookie, presentation.id, {
        ...input,
        expectedRevision: latest.draftRevision,
        mutationId: randomUUID(),
      });
      expect(fresh.statusCode, fresh.body).toBe(404);
      expect(fresh.json().error.message).toContain("not enabled");
      const stale = await insert(app, cookie, presentation.id, {
        ...input,
        mutationId: randomUUID(),
      });
      expect(stale.statusCode, stale.body).toBe(409);
      expect(stale.json().error.code).toBe("STALE_DRAFT");

      const read = await app.inject({
        method: "GET",
        url: `/v1/presentations/${presentation.id}`,
        headers: { cookie },
      });
      expect(read.statusCode, read.body).toBe(200);
      expect(read.json().presentation.draftRevision).toBe(latest.draftRevision);
      expect(latest.draftRevision).toBe(acknowledgement.presentation.draftRevision + 1);
      expect(read.json().presentation.draft).toEqual(latest.draft);
      expect(
        read.json().presentation.draft.blocks.map((block: { id: string }) => block.id),
      ).toEqual(acknowledgement.insertedBlockIds);
      expect(read.json().presentation.draft.recoveryPackInsertions).toHaveLength(1);
      expect(read.json().presentation.draft.recoveryPackInsertions[0].originalContent).toEqual(
        version.content,
      );
    },
  );

  it("denies cross-workspace sources and viewer mutations", async () => {
    const { app, cookie, repository, workspaceId } = await setup();
    const { version, presentation } = await material(app, cookie);
    const input = { packVersionId: version.id, expectedRevision: 1, mutationId: randomUUID() };
    const packs = createRecoveryPackRepository(repository);
    const foreignId = randomUUID();
    const source = (await packs.getRecoveryPack(workspaceId, version.packId))!;
    const foreignWorkspace = randomUUID();
    const foreignPackId = randomUUID();
    await packs.createRecoveryPack({
      ...source,
      id: foreignPackId,
      workspaceId: foreignWorkspace,
      currentVersionId: null,
      draftRevision: 0,
    });
    await packs.publishRecoveryPack(
      { ...version, id: foreignId, packId: foreignPackId, workspaceId: foreignWorkspace },
      0,
    );
    expect(await packs.getRecoveryPackVersion(foreignWorkspace, foreignId)).not.toBeNull();
    // An inaccessible or absent version is indistinguishable to a tenant-scoped caller.
    expect(
      (await insert(app, cookie, presentation.id, { ...input, packVersionId: foreignId }))
        .statusCode,
    ).toBe(404);
    const membership = [...repository.workspaceMembers.values()].find(
      (member) => member.workspaceId === workspaceId,
    )!;
    membership.role = "viewer";
    repository.users.get(membership.userId)!.role = "viewer";
    expect((await insert(app, cookie, presentation.id, input)).statusCode).toBe(403);
  });

  it("preserves Pack item provenance when importing published Round questions", async () => {
    const { app, cookie, repository, workspaceId } = await setup();
    repository.plans.set(workspaceId, "pro");
    const { version, presentation } = await material(app, cookie);
    const round = await app.inject({
      method: "POST",
      url: "/v1/quizzes",
      headers: { cookie },
      payload: { title: "Source Round" },
    });
    const quizId = round.json().quiz.id;
    const inserted = await app.inject({
      method: "POST",
      url: "/v1/recovery-packs/insert",
      headers: { cookie },
      payload: { quizId, packVersionId: version.id, expectedRevision: 0, mutationId: randomUUID() },
    });
    expect(inserted.statusCode, inserted.body).toBe(200);
    const published = await app.inject({
      method: "POST",
      url: `/v1/quizzes/${quizId}/publish`,
      headers: { cookie },
      payload: { expectedDraftRevision: 1 },
    });
    expect(published.statusCode, published.body).toBe(200);
    const imported = await app.inject({
      method: "POST",
      url: `/v1/presentations/${presentation.id}/blocks/import`,
      headers: { cookie },
      payload: {
        sourceQuizVersionId: published.json().version.id,
        questionIds: [inserted.json().quiz.draft.questions[0].id],
        expectedRevision: 1,
        mutationId: randomUUID(),
      },
    });
    expect(imported.statusCode, imported.body).toBe(200);
    expect(imported.json().presentation.draft.schemaVersion).toBe(2);
    expect(imported.json().presentation.draft.blocks[0].question.recoveryPackSource).toMatchObject({
      packVersionId: version.id,
    });
  });

  it("bounds multibyte baselines below the normal draft-save body limit without writing a rejected insertion", async () => {
    const { app, cookie, repository, workspaceId } = await setup();
    const content = packDraft();
    const citation = {
      sourceName: "漢".repeat(200),
      sourceDigest: "a".repeat(64),
      locator: "漢".repeat(120),
      excerpt: "漢".repeat(500),
    };
    const citations = Array.from({ length: 5 }, () => ({ ...citation }));
    content.citations = Array.from({ length: 20 }, () => ({ ...citation }));
    content.interventions = Array.from({ length: 5 }, () => ({
      id: randomUUID(),
      title: "Evidence",
      body: "漢".repeat(2_000),
      citations,
    }));
    for (const question of [content.diagnostic, content.recheck, content.delayedProbe!]) {
      question.explanation = "漢".repeat(1_000);
      question.sourceCitations = citations;
    }
    const { version, presentation } = await material(app, cookie, content);
    const draftWithInsertions = (count: number): PresentationDraft => {
      const draft: PresentationDraft = {
        ...presentation.draft,
        schemaVersion: 3,
        blocks: [],
        recoveryPackInsertions: [],
      };
      for (let index = 0; index < count; index += 1) {
        const mutationId = randomUUID();
        const questions = recoveryPackQuestions(version, mutationId);
        draft.blocks.push(
          ...questions.map((question) => ({
            id: randomUUID(),
            kind: "question" as const,
            question,
          })),
        );
        draft.recoveryPackInsertions!.push({
          id: mutationId,
          packId: version.packId,
          packVersionId: version.id,
          packVersion: version.version,
          contentHash: version.contentHash,
          diagnosticQuestionId: questions[0]!.id,
          recheckQuestionId: questions[1]!.id,
          originalContent: version.content,
        });
      }
      return draft;
    };
    // Fixed-width UUIDs make every additional frozen insertion the same size.
    // Seed the penultimate size once instead of repeatedly parsing growing RPC responses.
    const single = JSON.stringify(draftWithInsertions(1));
    const double = JSON.stringify(draftWithInsertions(2));
    const singleBytes = Buffer.byteLength(single, "utf8");
    const insertionBytes = Buffer.byteLength(double, "utf8") - singleBytes;
    const insertionCharacters = double.length - single.length;
    const lastAcceptedCount =
      1 + Math.floor((PRESENTATION_PACK_INSERTION_DRAFT_LIMIT - singleBytes) / insertionBytes);
    expect(lastAcceptedCount).toBeGreaterThan(1);
    const seededDraft = draftWithInsertions(lastAcceptedCount - 1);
    const seeded = await createPresentationRepository(repository).updatePresentationDraft({
      workspaceId,
      presentationId: presentation.id,
      draft: seededDraft,
      expectedRevision: presentation.draftRevision,
      mutationId: randomUUID(),
      editorId: presentation.lastEditedBy!,
      draftHash: recoveryPackHash(seededDraft),
    });
    expect(seeded).not.toBeNull();
    const accepted = await insert(app, cookie, presentation.id, {
      packVersionId: version.id,
      expectedRevision: seeded!.draftRevision,
      mutationId: randomUUID(),
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    const current = accepted.json<{ presentation: PresentationRecord }>().presentation;
    const acceptedJson = JSON.stringify(current.draft);
    const acceptedBytes = Buffer.byteLength(acceptedJson, "utf8");
    expect(current.draft.recoveryPackInsertions).toHaveLength(lastAcceptedCount);
    expect(acceptedBytes).toBe(singleBytes + (lastAcceptedCount - 1) * insertionBytes);
    expect(acceptedBytes).toBeLessThanOrEqual(PRESENTATION_PACK_INSERTION_DRAFT_LIMIT);
    expect(acceptedBytes + insertionBytes).toBeGreaterThan(PRESENTATION_PACK_INSERTION_DRAFT_LIMIT);
    // A character-count limit would incorrectly accept the next multibyte baseline.
    expect(acceptedJson.length + insertionCharacters).toBeLessThanOrEqual(
      PRESENTATION_PACK_INSERTION_DRAFT_LIMIT,
    );
    const rejected = await insert(app, cookie, presentation.id, {
      packVersionId: version.id,
      expectedRevision: current.draftRevision,
      mutationId: randomUUID(),
    });
    expect(rejected.statusCode, rejected.body).toBe(422);
    expect(rejected.json().error.message).toContain("too large to safely edit");
    const read = await app.inject({
      method: "GET",
      url: `/v1/presentations/${presentation.id}`,
      headers: { cookie },
    });
    expect(read.json().presentation.draftRevision).toBe(current.draftRevision);
    expect(read.json().presentation.draft).toEqual(current.draft);
    const edited = await save(app, cookie, current, { ...current.draft, title: "Still editable" });
    expect(edited.statusCode, edited.body).toBe(200);
  });
});

describe("Recovery Pack Presentation update review", () => {
  it("reviews and updates only the draft, retaining block IDs and immutable evidence, with idempotent undo", async () => {
    const f = await updateFixture();
    const published = await f.app.inject({
      method: "POST",
      url: `/v1/presentations/${f.presentation.id}/publish`,
      headers: { cookie: f.cookie },
      payload: { expectedDraftRevision: f.presentation.draftRevision },
    });
    expect(published.statusCode, published.body).toBe(200);
    const latest = await f.publishNext((draft) => {
      draft.diagnostic.prompt = "Updated diagnostic with a clearer scenario";
      draft.interventions[0]!.body = "Updated intervention context";
    });
    const preview = await f.review();
    expect(preview).toMatchObject({
      presentationId: f.presentation.id,
      draftRevision: 2,
      baselineVersion: 1,
      latestVersion: 2,
      contextChanged: true,
    });
    expect(preview.items.map((item) => item.status)).toEqual(["source_changed", "unchanged"]);
    const request = f.requestFor(preview);
    const applied = await f.apply(request);
    expect(applied.statusCode, applied.body).toBe(200);
    const updated = applied.json<{ presentation: PresentationRecord }>().presentation;
    expect(applied.json().undo).toEqual({ sourceRevision: 2, appliedRevision: 3 });
    expect(updated.draft.blocks.map((block) => block.id)).toEqual(
      f.presentation.draft.blocks.map((block) => block.id),
    );
    expect(updated.draft.blocks[0]).toMatchObject({
      kind: "question",
      question: {
        prompt: latest.content.diagnostic.prompt,
        recoveryPackSource: { packVersionId: latest.id },
      },
    });
    expect(updated.draft.blocks[1]).toEqual(f.presentation.draft.blocks[1]);
    expect(updated.draft.recoveryPackInsertions![0]).toMatchObject({
      packVersionId: f.version.id,
      originalContent: f.version.content,
      updateBaseline: { packVersionId: latest.id, content: latest.content },
    });
    const frozen = await createPresentationRepository(f.repository).getPresentationVersion(
      f.workspaceId,
      published.json().version.id,
    );
    expect(frozen?.content).toEqual(f.presentation.draft);
    const undoRequest = {
      method: "POST" as const,
      url: `/v1/presentations/${f.presentation.id}/history/2/restore`,
      headers: { cookie: f.cookie },
      payload: { expectedRevision: 3, mutationId: randomUUID() },
    };
    const undone = await f.app.inject(undoRequest);
    expect(undone.statusCode, undone.body).toBe(200);
    expect(undone.json().presentation.draft).toEqual(f.presentation.draft);
    expect(undone.json().presentation.draftRevision).toBe(4);
    expect((await f.app.inject(undoRequest)).json()).toEqual(undone.json());
    expect(
      (await f.apply({ ...request, expectedRevision: 4, mutationId: randomUUID() })).statusCode,
    ).toBe(200);
  });

  it("requires explicit conflict choices, preserves local edits, and restores a deleted recheck", async () => {
    const f = await updateFixture();
    await f.saveLocal((draft) => {
      const diagnostic = draft.blocks[0]!;
      if (diagnostic.kind === "question") diagnostic.question.prompt = "Local diagnostic revision";
      draft.blocks.splice(1, 1);
    });
    const latest = await f.publishNext((draft) => {
      draft.diagnostic.prompt = "Source diagnostic revision";
      draft.recheck.prompt = "Source recheck revision";
    });
    const preview = await f.review();
    expect(preview.items.map((item) => item.status)).toEqual(["conflict", "conflict"]);
    const request = f.requestFor(preview);
    const missing = await f.apply(request);
    expect(missing.statusCode).toBe(409);
    expect(missing.body).not.toContain("Round");
    const choices = [
      { role: "diagnostic", action: "keep_local" },
      { role: "recheck", action: "use_latest" },
    ];
    const applied = await f.apply({ ...request, choices });
    expect(applied.statusCode, applied.body).toBe(200);
    expect(applied.json().presentation.draft.blocks).toMatchObject([
      { question: { prompt: "Local diagnostic revision" } },
      {
        question: {
          prompt: latest.content.recheck.prompt,
          id: f.presentation.draft.recoveryPackInsertions![0]!.recheckQuestionId,
        },
      },
    ]);
  });

  it("accepts context-only changes without rewriting local questions", async () => {
    const f = await updateFixture();
    const local = await f.saveLocal((draft) => {
      const block = draft.blocks[0]!;
      if (block.kind === "question") block.question.prompt = "Deliberate local wording";
    });
    const latest = await f.publishNext((draft) => {
      draft.interventions[0]!.body = "A new contrast explanation";
    });
    const preview = await f.review();
    expect(preview.items.map((item) => item.status)).toEqual(["local_changed", "unchanged"]);
    const applied = await f.apply(f.requestFor(preview));
    expect(applied.statusCode, applied.body).toBe(200);
    expect(applied.json().presentation.draft.blocks).toEqual(local.draft.blocks);
    expect(
      applied.json().presentation.draft.recoveryPackInsertions[0].updateBaseline.content,
    ).toEqual(latest.content);
    expect((await f.review()).baselineVersionId).toBe(latest.id);
    expect((await f.apply({ ...f.requestFor(await f.review()) })).statusCode).toBe(409);
  });

  it("applies the exact reviewed version despite a newer publish and fences stale local changes", async () => {
    const f = await updateFixture();
    const reviewed = await f.publishNext((draft) => {
      draft.diagnostic.prompt = "Reviewed version";
    });
    const preview = await f.review();
    await f.publishNext((draft) => {
      draft.diagnostic.prompt = "Unreviewed later version";
    });
    const applied = await f.apply(f.requestFor(preview));
    expect(applied.statusCode, applied.body).toBe(200);
    expect(applied.json().presentation.draft.blocks[0].question.prompt).toBe(
      reviewed.content.diagnostic.prompt,
    );
    const nextPreview = await f.review();
    await f.saveLocal((draft) => {
      draft.title = "A concurrent author edit";
    });
    const stale = await f.apply(f.requestFor(nextPreview));
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("STALE_DRAFT");
  });

  it("replays concurrent submissions and recovers lost acknowledgements after later edits and source deletion", async () => {
    const f = await updateFixture();
    await f.publishNext((draft) => {
      draft.diagnostic.prompt = "New source wording";
    });
    const request = f.requestFor(await f.review());
    const [first, duplicate] = await Promise.all([f.apply(request), f.apply(request)]);
    expect(first.statusCode, first.body).toBe(200);
    expect(duplicate.json()).toEqual(first.json());
    const later = await f.saveLocal((draft) => {
      draft.title = "Later local title";
    });
    const deleted = await f.app.inject({
      method: "DELETE",
      url: `/v1/recovery-packs/${f.packId}`,
      headers: { cookie: f.cookie },
    });
    expect(deleted.statusCode).toBe(204);
    const replay = await f.apply(request);
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json()).toEqual(first.json());
    expect(
      (await f.apply({ ...request, choices: [{ role: "diagnostic", action: "keep_local" }] }))
        .statusCode,
    ).toBe(409);
    const read = await f.app.inject({
      method: "GET",
      url: `/v1/presentations/${f.presentation.id}`,
      headers: { cookie: f.cookie },
    });
    expect(read.json().presentation.draftRevision).toBe(later.draftRevision);
    expect(read.json().presentation.draft.title).toBe("Later local title");
  });

  it.each([{ packs: false }, { presentations: false }, { allowlisted: false }])(
    "preserves comparisons, accepted receipt retries and undo while blocking new updates after pause: %j",
    async (flags) => {
      const f = await updateFixture();
      await f.publishNext((draft) => {
        draft.diagnostic.prompt = "Latest source wording";
      });
      const request = f.requestFor(await f.review());
      const applied = await f.apply(request);
      expect(applied.statusCode, applied.body).toBe(200);
      const paused = await setup({
        repository: f.repository,
        workspaceId: f.workspaceId,
        ...flags,
      });
      const review = await paused.app.inject({
        method: "POST",
        url: `/v1/presentations/${f.presentation.id}/recovery-packs/update-review`,
        headers: { cookie: paused.cookie },
        payload: { insertionId: f.insertionId },
      });
      expect(review.statusCode, review.body).toBe(200);
      expect((await f.apply(request, paused)).json()).toEqual(applied.json());
      const blocked = await f.apply(
        { ...request, expectedRevision: 3, mutationId: randomUUID() },
        paused,
      );
      expect(blocked.statusCode).toBe(404);
      const undo = await paused.app.inject({
        method: "POST",
        url: `/v1/presentations/${f.presentation.id}/history/2/restore`,
        headers: { cookie: paused.cookie },
        payload: { expectedRevision: 3, mutationId: randomUUID() },
      });
      expect(undo.statusCode, undo.body).toBe(200);
      expect(undo.json().presentation.draft).toEqual(f.presentation.draft);
    },
  );

  it("denies cross-workspace source versions and destination reads, and viewer mutations", async () => {
    const f = await updateFixture();
    await f.publishNext((draft) => {
      draft.diagnostic.prompt = "Source update";
    });
    const request = f.requestFor(await f.review());
    const packs = createRecoveryPackRepository(f.repository);
    const source = (await packs.getRecoveryPack(f.workspaceId, f.packId))!;
    const foreignWorkspace = randomUUID();
    const foreignPackId = randomUUID();
    const foreignVersionId = randomUUID();
    await packs.createRecoveryPack({
      ...source,
      id: foreignPackId,
      workspaceId: foreignWorkspace,
      currentVersionId: null,
      draftRevision: 0,
    });
    await packs.publishRecoveryPack(
      { ...f.version, id: foreignVersionId, packId: foreignPackId, workspaceId: foreignWorkspace },
      0,
    );
    expect(await packs.getRecoveryPackVersion(foreignWorkspace, foreignVersionId)).not.toBeNull();
    expect((await f.apply({ ...request, packVersionId: foreignVersionId })).statusCode).toBe(404);
    const foreignPresentation = await createPresentationRepository(f.repository).createPresentation(
      { ...f.presentation, id: randomUUID(), workspaceId: foreignWorkspace },
    );
    const read = await f.app.inject({
      method: "POST",
      url: `/v1/presentations/${foreignPresentation.id}/recovery-packs/update-review`,
      headers: { cookie: f.cookie },
      payload: { insertionId: f.insertionId },
    });
    expect(read.statusCode).toBe(404);
    const membership = [...f.repository.workspaceMembers.values()].find(
      (member) => member.workspaceId === f.workspaceId,
    )!;
    membership.role = "viewer";
    f.repository.users.get(membership.userId)!.role = "viewer";
    const preview = await f.review();
    expect(preview.latestVersion).toBe(2);
    expect((await f.apply(request)).statusCode).toBe(403);
  });
});
