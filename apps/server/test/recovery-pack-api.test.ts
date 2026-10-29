import { signInFromVerificationResponse } from "./support/email-auth.js";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  QuizDraftSchema,
  RecoveryPackJsonSchema,
  type QuizDraft,
  type RecoveryPackDraft,
} from "@openround/contracts";
import {
  createRecoveryPackRepository,
  MemoryRepository,
  type QuizRecord,
  type RecoveryPackRecord,
  type RecoveryPackVersionRecord,
} from "@openround/db";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";
import { openRoundJson } from "../src/portability.js";
import {
  extendedPackDestinationFormats,
  extendedPackDestinationQuestion,
} from "./fixtures/recovery-pack-extended-round.js";

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.restoreAllMocks();
});

function draft(): RecoveryPackDraft {
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
    explanation: "Explain the evidence.",
    mediaId: null,
    mediaAlt: null,
    choices: [
      { id: randomUUID(), label: "Observed evidence", isCorrect: true },
      { id: randomUUID(), label: "Assumption", isCorrect: false },
    ],
  });
  const recheck = {
    ...question("What evidence supports this different scenario?"),
    delivery: "recheck" as const,
  };
  return {
    schemaVersion: 1,
    title: "Evidence recovery",
    description: "",
    diagnostic: {
      ...question("Which signal supports the conclusion?"),
      linkedRecheckQuestionId: recheck.id,
    },
    interventions: [
      {
        id: randomUUID(),
        title: "Compare signals",
        body: "Contrast observation and assumption.",
        citations: [],
      },
    ],
    recheck,
    delayedProbe: question("What should be observed next week?"),
    conceptKeys: ["evidence"],
    misconceptionKeys: [],
    citations: [],
  };
}

function largeDraft(): RecoveryPackDraft {
  const content = draft();
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
    title: "Compare evidence",
    body: "漢".repeat(2_000),
    citations,
  }));
  for (const question of [content.diagnostic, content.recheck, content.delayedProbe!]) {
    question.explanation = "漢".repeat(1_000);
    question.sourceCitations = citations;
  }
  return content;
}

async function signIn(app: FastifyInstance, email = "pack-author@example.com") {
  const magic = await app.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: { email, segment: "workplace", acceptPolicies: true },
  });
  const verified = await signInFromVerificationResponse(app, magic, email);
  const cookies = verified.headers["set-cookie"]!;
  return (Array.isArray(cookies) ? cookies[0]! : cookies).split(";")[0]!;
}

async function setup(
  enabled = true,
  allowlisted = true,
  existing?: MemoryRepository,
  workspaceId = randomUUID(),
  roundProtocolEnabled = false,
  roundAllowlisted = true,
) {
  const repository = existing ?? new MemoryRepository({ initialWorkspaceId: workspaceId });
  const { app } = await buildApp(
    ConfigSchema.parse({
      NODE_ENV: "test",
      ALLOW_IN_MEMORY: "true",
      COMMUNITY_MODE: "false",
      WEB_ORIGIN: "http://localhost:3000",
      PUBLIC_API_URL: "http://localhost:4000",
      LOG_LEVEL: "silent",
      FEATURE_RECOVERY_PACKS: String(enabled),
      EVIDENCE_FEATURES_WORKSPACE_ALLOWLIST: allowlisted ? workspaceId : "",
      FEATURE_ROUND_CLIENT_PROTOCOL: String(roundProtocolEnabled),
      CORE_PARITY_WORKSPACE_ALLOWLIST: roundAllowlisted ? workspaceId : "",
    }),
    { repository, cache: new MemorySessionCache() },
  );
  apps.push(app);
  return { app, repository, workspaceId, cookie: await signIn(app) };
}

async function publish(app: FastifyInstance, cookie: string, content = draft()) {
  const created = await app.inject({
    method: "POST",
    url: "/v1/recovery-packs",
    headers: { cookie },
    payload: { draft: content },
  });
  expect(created.statusCode).toBe(201);
  const pack = created.json<{ pack: RecoveryPackRecord }>().pack;
  const published = await app.inject({
    method: "POST",
    url: `/v1/recovery-packs/${pack.id}/publish`,
    headers: { cookie },
    payload: { expectedDraftRevision: 0 },
  });
  expect(published.statusCode).toBe(200);
  return published.json<{ pack: RecoveryPackRecord; version: RecoveryPackVersionRecord }>();
}

describe("Recovery Pack API", () => {
  it.each(extendedPackDestinationFormats)(
    "inserts into an existing %s Round without downgrading its artifact, receipts, or history",
    async (type, schemaVersion) => {
      const { app, cookie, repository, workspaceId } = await setup(
        true,
        true,
        undefined,
        randomUUID(),
        true,
      );
      const headers = { cookie };
      const { pack, version } = await publish(app, cookie);
      const created = await app.inject({
        method: "POST",
        url: "/v1/quizzes",
        headers,
        payload: { title: "Extended destination" },
      });
      const quizId = created.json<{ quiz: QuizRecord }>().quiz.id;
      const originalDraft = QuizDraftSchema.parse({
        title: "Extended destination",
        description: "",
        questions: [extendedPackDestinationQuestion(type)],
      });
      const saved = await app.inject({
        method: "PATCH",
        url: `/v1/quizzes/${quizId}`,
        headers,
        payload: { draft: originalDraft, expectedDraftRevision: 0 },
      });
      expect(saved.statusCode).toBe(200);
      expect(saved.json()).toMatchObject({ quiz: { draftSchemaVersion: schemaVersion } });
      const published = await app.inject({
        method: "POST",
        url: `/v1/quizzes/${quizId}/publish`,
        headers,
        payload: {},
      });
      expect(published.statusCode).toBe(200);
      const publishedVersionId = (await repository.getQuiz(workspaceId, quizId))!.currentVersionId!;
      const payload = {
        quizId,
        packVersionId: version.id,
        expectedRevision: 1,
        mutationId: randomUUID(),
      };
      const request = {
        method: "POST" as const,
        url: "/v1/recovery-packs/insert",
        headers,
        payload,
      };
      const inserted = await app.inject(request);
      expect(inserted.statusCode).toBe(200);
      const quiz = inserted.json<{ quiz: QuizRecord }>().quiz;
      expect(quiz.draftSchemaVersion).toBe(schemaVersion);
      expect(quiz.draftRevision).toBe(2);
      expect(quiz.draft.questions).toHaveLength(3);
      expect(quiz.draft.questions[0]).toEqual(originalDraft.questions[0]);
      expect(quiz.draft.recoveryPackInsertions![0]!.originalContent).toEqual(version.content);
      expect(quiz.draft.questions[1]!.linkedRecheckQuestionId).toBe(quiz.draft.questions[2]!.id);
      expect((await repository.getQuizVersion(workspaceId, publishedVersionId))!.content).toEqual(
        originalDraft,
      );

      const laterDraft = { ...quiz.draft, title: "Unrelated later edit" };
      expect(
        (
          await app.inject({
            method: "PATCH",
            url: `/v1/quizzes/${quizId}`,
            headers,
            payload: { draft: laterDraft, expectedDraftRevision: 2 },
          })
        ).statusCode,
      ).toBe(200);
      const disabled = await setup(true, true, repository, workspaceId, false);
      const blocked = await disabled.app.inject({
        ...request,
        headers: { cookie: disabled.cookie },
        payload: { ...payload, expectedRevision: 3, mutationId: randomUUID() },
      });
      expect(blocked.statusCode).toBe(404);
      expect(blocked.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
      expect((await repository.getQuiz(workspaceId, quizId))!.draftRevision).toBe(3);
      await app.inject({ method: "DELETE", url: `/v1/recovery-packs/${pack.id}`, headers });
      const retry = await disabled.app.inject({ ...request, headers: { cookie: disabled.cookie } });
      expect(retry.statusCode).toBe(200);
      expect(retry.json()).toEqual(inserted.json());
      expect((await repository.getQuiz(workspaceId, quizId))!.draft).toEqual(laterDraft);

      const restored = await app.inject({
        method: "POST",
        url: `/v1/quizzes/${quizId}/history/1/restore`,
        headers,
        payload: { expectedRevision: 3, mutationId: randomUUID() },
      });
      expect(restored.statusCode).toBe(200);
      expect(restored.json()).toMatchObject({ quiz: { draftSchemaVersion: schemaVersion } });
      expect((await repository.getQuiz(workspaceId, quizId))!.draft).toEqual(originalDraft);
    },
  );

  it("blocks a fresh extended-Round insertion outside the protocol workspace allowlist", async () => {
    const { app, cookie, repository, workspaceId } = await setup(
      true,
      true,
      undefined,
      randomUUID(),
      true,
    );
    const { version } = await publish(app, cookie);
    const now = new Date();
    const quiz = await repository.createQuiz({
      id: randomUUID(),
      workspaceId,
      title: "Existing ranking",
      description: "",
      status: "draft",
      draft: {
        title: "Existing ranking",
        description: "",
        questions: [extendedPackDestinationQuestion("ranking")],
      },
      draftSchemaVersion: 3,
      currentVersionId: null,
      createdAt: now,
      updatedAt: now,
    });
    const unlisted = await setup(true, true, repository, workspaceId, true, false);
    const result = await unlisted.app.inject({
      method: "POST",
      url: "/v1/recovery-packs/insert",
      headers: { cookie: unlisted.cookie },
      payload: {
        quizId: quiz.id,
        packVersionId: version.id,
        expectedRevision: 0,
        mutationId: randomUUID(),
      },
    });
    expect(result.statusCode).toBe(404);
    expect((await repository.getQuiz(workspaceId, quiz.id))!.draft).toEqual(quiz.draft);
    expect((await repository.getQuiz(workspaceId, quiz.id))!.draftRevision).toBe(0);
  });

  it("rejects altered frozen baselines through both Round save APIs and native v3 import", async () => {
    const { app, cookie, repository, workspaceId } = await setup();
    repository.plans.set(workspaceId, "pro");
    const { version } = await publish(app, cookie);
    const created = await app.inject({
      method: "POST",
      url: "/v1/quizzes",
      headers: { cookie },
      payload: { title: "Frozen baseline Round" },
    });
    const quizId = created.json<{ quiz: { id: string } }>().quiz.id;
    const inserted = await app.inject({
      method: "POST",
      url: "/v1/recovery-packs/insert",
      headers: { cookie },
      payload: { quizId, packVersionId: version.id, expectedRevision: 0, mutationId: randomUUID() },
    });
    expect(inserted.statusCode).toBe(200);
    const originalDraft = inserted.json<{ quiz: { draft: QuizDraft } }>().quiz.draft;
    const exported = JSON.parse(openRoundJson(originalDraft)) as { checkpointSet: QuizDraft };
    const initialCount = (await repository.listQuizzes(workspaceId)).length;
    for (const role of ["intervention", "checkpoint"] as const) {
      const altered = structuredClone(originalDraft);
      const baseline = altered.recoveryPackInsertions![0]!.originalContent;
      if (role === "intervention") baseline.interventions[0]!.body = "Altered facilitator guidance";
      else baseline.recheck.prompt = "Altered recheck scenario";
      const legacy = await app.inject({
        method: "PATCH",
        url: `/v1/quizzes/${quizId}`,
        headers: { cookie },
        payload: { draft: altered, expectedDraftRevision: 1 },
      });
      expect(legacy.statusCode).toBe(400);
      const modern = await app.inject({
        method: "PUT",
        url: `/v1/quizzes/${quizId}/draft`,
        headers: { cookie },
        payload: {
          draft: altered,
          expectedRevision: 1,
          schemaVersion: 1,
          mutationId: randomUUID(),
        },
      });
      expect(modern.statusCode).toBe(400);
      const imported = await app.inject({
        method: "POST",
        url: "/v1/quizzes/import",
        headers: { cookie },
        payload: {
          format: "openround_json",
          data: JSON.stringify({ ...exported, checkpointSet: altered }),
        },
      });
      expect(imported.statusCode).toBe(422);
      const stored = await repository.getQuiz(workspaceId, quizId);
      expect(stored?.draftRevision).toBe(1);
      expect(stored?.draft).toEqual(originalDraft);
      expect((await repository.listQuizzes(workspaceId)).length).toBe(initialCount);
    }
  });

  it("accepts bounded multi-byte Packs and keeps inserted Rounds editable through both editor APIs", async () => {
    const { app, cookie } = await setup();
    const content = largeDraft();
    expect(Buffer.byteLength(JSON.stringify({ draft: content }), "utf8")).toBeGreaterThan(
      128 * 1024,
    );
    const { pack, version } = await publish(app, cookie, content);
    const saved = await app.inject({
      method: "PUT",
      url: `/v1/recovery-packs/${pack.id}/draft`,
      headers: { cookie },
      payload: {
        draft: { ...content, title: "Revised Pack" },
        expectedRevision: 0,
        mutationId: randomUUID(),
      },
    });
    expect(saved.statusCode).toBe(200);
    const imported = await app.inject({
      method: "POST",
      url: "/v1/recovery-packs/import",
      headers: { cookie },
      payload: { format: "openround-recovery-pack", schemaVersion: 1, content: version.content },
    });
    expect(imported.statusCode).toBe(201);
    const created = await app.inject({
      method: "POST",
      url: "/v1/quizzes",
      headers: { cookie },
      payload: { title: "Large Pack Round" },
    });
    const quizId = created.json<{ quiz: { id: string } }>().quiz.id;
    const inserted = await app.inject({
      method: "POST",
      url: "/v1/recovery-packs/insert",
      headers: { cookie },
      payload: { quizId, packVersionId: version.id, expectedRevision: 0, mutationId: randomUUID() },
    });
    expect(inserted.statusCode).toBe(200);
    const insertedDraft = inserted.json<{ quiz: { draft: unknown } }>().quiz.draft;
    expect(Buffer.byteLength(JSON.stringify(insertedDraft), "utf8")).toBeGreaterThan(128 * 1024);
    const legacySave = await app.inject({
      method: "PATCH",
      url: `/v1/quizzes/${quizId}`,
      headers: { cookie },
      payload: { draft: insertedDraft, expectedDraftRevision: 1 },
    });
    expect(legacySave.statusCode).toBe(200);
    const revision = legacySave.json<{ quiz: { draftRevision: number } }>().quiz.draftRevision;
    const modernSave = await app.inject({
      method: "PUT",
      url: `/v1/quizzes/${quizId}/draft`,
      headers: { cookie },
      payload: {
        draft: insertedDraft,
        expectedRevision: revision,
        schemaVersion: 1,
        mutationId: randomUUID(),
      },
    });
    expect(modernSave.statusCode).toBe(200);
  });

  it("rejects insertion that would exceed editable Round size without changing its revision", async () => {
    const { app, cookie, repository, workspaceId } = await setup();
    const { version } = await publish(app, cookie, largeDraft());
    const source = {
      ...version.content.diagnostic,
      id: randomUUID(),
      prompt: "漢".repeat(500),
      linkedRecheckQuestionId: null,
      choices: Array.from({ length: 6 }, (_, index) => ({
        id: randomUUID(),
        label: `${"漢".repeat(179)}${index}`,
        isCorrect: index === 0,
      })),
    };
    const count = Math.floor(3_420_000 / Buffer.byteLength(JSON.stringify(source), "utf8"));
    expect(count).toBeLessThan(199);
    const quizDraft = QuizDraftSchema.parse({
      title: "Near size limit",
      description: "",
      questions: Array.from({ length: count }, () => ({ ...source, id: randomUUID() })),
    });
    const size = Buffer.byteLength(JSON.stringify(quizDraft), "utf8");
    expect(size).toBeGreaterThan(3_300_000);
    expect(size).toBeLessThan(3_500_000);
    const now = new Date();
    const quiz = await repository.createQuiz({
      id: randomUUID(),
      workspaceId,
      title: quizDraft.title,
      description: "",
      status: "draft",
      draft: quizDraft,
      currentVersionId: null,
      createdAt: now,
      updatedAt: now,
    });
    const blocked = await app.inject({
      method: "POST",
      url: "/v1/recovery-packs/insert",
      headers: { cookie },
      payload: {
        quizId: quiz.id,
        packVersionId: version.id,
        expectedRevision: 0,
        mutationId: randomUUID(),
      },
    });
    expect(blocked.statusCode).toBe(422);
    expect(blocked.json<{ error: { message: string } }>().error.message).toContain(
      "too large to safely edit",
    );
    expect((await repository.getQuiz(workspaceId, quiz.id))?.draftRevision).toBe(0);
    expect(
      (await repository.getQuiz(workspaceId, quiz.id))?.draft.recoveryPackInsertions,
    ).toBeUndefined();
  });

  it("does not acknowledge publication or restore if a Pack is deleted after its initial read", async () => {
    const { app, cookie, repository, workspaceId } = await setup();
    const packs = createRecoveryPackRepository(repository);
    const { pack } = await publish(app, cookie);
    const originalPublish = packs.publishRecoveryPack.bind(packs);
    const publishing = vi
      .spyOn(packs, "publishRecoveryPack")
      .mockImplementation(async (input, revision) => {
        await packs.deleteRecoveryPack(workspaceId, pack.id);
        return originalPublish(input, revision);
      });
    const failedPublish = await app.inject({
      method: "POST",
      url: `/v1/recovery-packs/${pack.id}/publish`,
      headers: { cookie },
      payload: { expectedDraftRevision: 0 },
    });
    expect(failedPublish.statusCode).toBe(404);
    publishing.mockRestore();
    const replacement = (await publish(app, cookie)).pack;
    const originalUpdate = packs.updateRecoveryPackDraft.bind(packs);
    vi.spyOn(packs, "updateRecoveryPackDraft").mockImplementation(async (input) => {
      await packs.deleteRecoveryPack(workspaceId, replacement.id);
      return originalUpdate(input);
    });
    const failedRestore = await app.inject({
      method: "POST",
      url: `/v1/recovery-packs/${replacement.id}/restore`,
      headers: { cookie },
      payload: { expectedRevision: 0, historyRevision: 0, mutationId: randomUUID() },
    });
    expect(failedRestore.statusCode).toBe(404);
  });
  it("rejects over-capacity insertion without modifying the destination or recording a receipt", async () => {
    const { app, cookie, repository, workspaceId } = await setup();
    const { version } = await publish(app, cookie);
    const source = draft().diagnostic;
    const now = new Date();
    const quiz = await repository.createQuiz({
      id: randomUUID(),
      workspaceId,
      title: "Full Round",
      description: "",
      status: "draft",
      draft: {
        title: "Full Round",
        description: "",
        questions: Array.from({ length: 199 }, () => ({
          ...source,
          id: randomUUID(),
          linkedRecheckQuestionId: null,
        })),
      },
      currentVersionId: null,
      createdAt: now,
      updatedAt: now,
    });
    const blocked = await app.inject({
      method: "POST",
      url: "/v1/recovery-packs/insert",
      headers: { cookie },
      payload: {
        quizId: quiz.id,
        packVersionId: version.id,
        expectedRevision: 0,
        mutationId: randomUUID(),
      },
    });
    expect(blocked.statusCode).toBe(400);
    expect((await repository.getQuiz(workspaceId, quiz.id))?.draft.questions).toHaveLength(199);
    expect((await repository.getQuiz(workspaceId, quiz.id))?.draftRevision).toBe(0);
  });

  it("round-trips Pack-backed Round v3 JSON and explicitly rejects inaccessible frozen baseline media", async () => {
    const { app, cookie, repository, workspaceId } = await setup();
    repository.plans.set(workspaceId, "pro");
    const mediaId = randomUUID();
    await repository.createMediaAsset({
      id: mediaId,
      workspaceId,
      objectKey: `media/${workspaceId}/${mediaId}.png`,
      mimeType: "image/png",
      sizeBytes: 10,
      scanStatus: "clean",
      altText: "Evidence chart",
      createdAt: new Date(),
    });
    const content = draft();
    content.delayedProbe!.mediaId = mediaId;
    content.delayedProbe!.mediaAlt = "Evidence chart";
    const { version } = await publish(app, cookie, content);
    const created = await app.inject({
      method: "POST",
      url: "/v1/quizzes",
      headers: { cookie },
      payload: { title: "Portable Pack Round" },
    });
    const quizId = created.json<{ quiz: { id: string } }>().quiz.id;
    const inserted = await app.inject({
      method: "POST",
      url: "/v1/recovery-packs/insert",
      headers: { cookie },
      payload: { quizId, packVersionId: version.id, expectedRevision: 0, mutationId: randomUUID() },
    });
    const exported = openRoundJson(
      inserted.json<{ quiz: { draft: Parameters<typeof openRoundJson>[0] } }>().quiz.draft,
    );
    const imported = await app.inject({
      method: "POST",
      url: "/v1/quizzes/import",
      headers: { cookie },
      payload: { format: "openround_json", data: exported },
    });
    expect(imported.statusCode).toBe(201);
    const copied = imported.json<{ quiz: { draft: Parameters<typeof openRoundJson>[0] } }>().quiz
      .draft;
    expect(copied.recoveryPackInsertions![0]!.diagnosticQuestionId).toBe(copied.questions[0]!.id);
    expect(copied.recoveryPackInsertions![0]!.originalContent).toEqual(version.content);
    const stranger = await signIn(app, "pack-portability-stranger@example.com");
    const account = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { cookie: stranger },
    });
    const strangerWorkspace = account.json<{ creator: { workspaceId: string } }>().creator
      .workspaceId;
    repository.plans.set(strangerWorkspace, "pro");
    const blocked = await app.inject({
      method: "POST",
      url: "/v1/quizzes/import",
      headers: { cookie: stranger },
      payload: { format: "openround_json", data: exported },
    });
    expect(blocked.statusCode).toBe(422);
    expect(blocked.json()).toMatchObject({
      validation: { errors: [{ code: "RECOVERY_PACK_MEDIA_UNAVAILABLE" }] },
    });
    expect(await repository.listQuizzes(strangerWorkspace)).toEqual([]);
  });
  it("replays a no-op restore even after the selected history snapshot expires", async () => {
    const { app, cookie, repository, workspaceId } = await setup();
    const { pack } = await publish(app, cookie);
    const payload = { historyRevision: 0, expectedRevision: 0, mutationId: randomUUID() };
    const restore = () =>
      app.inject({
        method: "POST",
        url: `/v1/recovery-packs/${pack.id}/restore`,
        headers: { cookie },
        payload,
      });
    const restored = await restore();
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({ pack: { draftRevision: 0 } });
    const packs = createRecoveryPackRepository(repository);
    const snapshots = await packs.listRecoveryPackHistory(workspaceId, pack.id);
    expect(snapshots).toHaveLength(1);
    // Force history expiry independently of the fresh no-op mutation receipt.
    const history = (packs as { history?: Map<string, { createdAt: Date }> }).history!;
    for (const snapshot of history.values())
      snapshot.createdAt = new Date(Date.now() - 31 * 86_400_000);
    await repository.purgeExpired(new Date());
    expect(await packs.listRecoveryPackHistory(workspaceId, pack.id)).toEqual([]);
    expect((await restore()).json()).toEqual(restored.json());
  });

  it("returns validation errors for inaccessible media and refuses pending diagnostic/recheck/probe media publication", async () => {
    const { app, cookie, repository, workspaceId } = await setup();
    const missing = draft();
    missing.diagnostic.mediaId = randomUUID();
    missing.diagnostic.mediaAlt = "Missing chart";
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/recovery-packs",
          headers: { cookie },
          payload: { draft: missing },
        })
      ).statusCode,
    ).toBe(422);
    const mediaId = randomUUID();
    await repository.createMediaAsset({
      id: mediaId,
      workspaceId,
      objectKey: `media/${workspaceId}/${mediaId}.png`,
      mimeType: "image/png",
      sizeBytes: 10,
      scanStatus: "pending",
      altText: "Pending chart",
      createdAt: new Date(),
    });
    for (const role of ["diagnostic", "recheck", "delayedProbe"] as const) {
      const content = draft();
      content[role]!.mediaId = mediaId;
      content[role]!.mediaAlt = "Pending chart";
      const created = await app.inject({
        method: "POST",
        url: "/v1/recovery-packs",
        headers: { cookie },
        payload: { draft: content },
      });
      expect(created.statusCode).toBe(201);
      const packId = created.json<{ pack: { id: string } }>().pack.id;
      const blocked = await app.inject({
        method: "POST",
        url: `/v1/recovery-packs/${packId}/publish`,
        headers: { cookie },
        payload: { expectedDraftRevision: 0 },
      });
      expect(blocked.statusCode).toBe(422);
      expect(blocked.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    }
  });
  it("saves with revision fences, retries original receipts, restores, and preserves immutable published content", async () => {
    const { app, cookie } = await setup();
    const { pack, version } = await publish(app, cookie);
    const changed = { ...pack.draft, title: "Revised evidence recovery" };
    const payload = { draft: changed, expectedRevision: 0, mutationId: randomUUID() };
    const save = () =>
      app.inject({
        method: "PUT",
        url: `/v1/recovery-packs/${pack.id}/draft`,
        headers: { cookie },
        payload,
      });
    expect((await save()).json()).toMatchObject({
      pack: { draftRevision: 1, title: changed.title },
    });
    const next = await app.inject({
      method: "PUT",
      url: `/v1/recovery-packs/${pack.id}/draft`,
      headers: { cookie },
      payload: {
        draft: { ...changed, title: "Latest title" },
        expectedRevision: 1,
        mutationId: randomUUID(),
      },
    });
    expect(next.statusCode).toBe(200);
    expect((await save()).json()).toMatchObject({
      pack: { draftRevision: 1, title: changed.title },
    });
    const stale = await app.inject({
      method: "PUT",
      url: `/v1/recovery-packs/${pack.id}/draft`,
      headers: { cookie },
      payload: { ...payload, mutationId: randomUUID() },
    });
    expect(stale.statusCode).toBe(409);
    const reused = await app.inject({
      method: "PUT",
      url: `/v1/recovery-packs/${pack.id}/draft`,
      headers: { cookie },
      payload: { ...payload, draft: { ...changed, title: "Different request" } },
    });
    expect(reused.statusCode).toBe(409);
    const restored = await app.inject({
      method: "POST",
      url: `/v1/recovery-packs/${pack.id}/restore`,
      headers: { cookie },
      payload: { historyRevision: 0, expectedRevision: 2, mutationId: randomUUID() },
    });
    expect(restored.json()).toMatchObject({ pack: { draftRevision: 3, title: pack.title } });
    const republished = await app.inject({
      method: "POST",
      url: `/v1/recovery-packs/${pack.id}/publish`,
      headers: { cookie },
      payload: { expectedDraftRevision: 3 },
    });
    expect(republished.json()).toMatchObject({
      version: { id: version.id, version: 1 },
      pack: { publishedDraftRevision: 3 },
    });
    const old = await app.inject({
      method: "GET",
      url: `/v1/recovery-packs/versions/${version.id}`,
      headers: { cookie },
    });
    expect(old.json()).toMatchObject({ version: { content: { title: pack.title } } });
    expect(old.headers["cache-control"]).toBe("private, no-store");
  });

  it("inserts an independent linked pair, retains cards/probe baseline, and retries after edits/source deletion", async () => {
    const { app, cookie } = await setup();
    const { pack, version } = await publish(app, cookie);
    const created = await app.inject({
      method: "POST",
      url: "/v1/quizzes",
      headers: { cookie },
      payload: { title: "Target Round", description: "" },
    });
    const quizId = created.json<{ quiz: { id: string } }>().quiz.id;
    const payload = {
      quizId,
      packVersionId: version.id,
      expectedRevision: 0,
      mutationId: randomUUID(),
    };
    const insert = () =>
      app.inject({
        method: "POST",
        url: "/v1/recovery-packs/insert",
        headers: { cookie },
        payload,
      });
    const first = await insert();
    expect(first.statusCode).toBe(200);
    const quiz = first.json<{
      quiz: {
        draftRevision: number;
        draft: {
          questions: RecoveryPackDraft["diagnostic"][];
          recoveryPackInsertions: { originalContent: RecoveryPackDraft }[];
        };
      };
    }>().quiz;
    expect(quiz.draft.questions).toHaveLength(2);
    expect(quiz.draft.questions[0]!.id).not.toBe(pack.draft.diagnostic.id);
    expect(quiz.draft.questions[0]!.linkedRecheckQuestionId).toBe(quiz.draft.questions[1]!.id);
    expect(quiz.draft.questions[0]!.recoveryPackSource).toMatchObject({
      packVersionId: version.id,
      role: "diagnostic",
      artifactType: "recovery_pack",
    });
    expect(quiz.draft.recoveryPackInsertions[0]!.originalContent).toEqual(version.content);
    expect((await insert()).json()).toEqual(first.json());
    const edited = await app.inject({
      method: "PATCH",
      url: `/v1/quizzes/${quizId}`,
      headers: { cookie },
      payload: {
        draft: { ...quiz.draft, title: "Local edit", description: "" },
        expectedDraftRevision: 1,
        mutationId: randomUUID(),
      },
    });
    expect(edited.statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/v1/recovery-packs/${pack.id}`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(204);
    expect((await insert()).json()).toEqual(first.json());
    const current = await app.inject({
      method: "GET",
      url: `/v1/quizzes/${quizId}`,
      headers: { cookie },
    });
    expect(current.json()).toMatchObject({
      quiz: {
        draft: {
          title: "Local edit",
          questions: [{ recoveryPackSource: { packVersionId: version.id } }, {}],
          recoveryPackInsertions: [{ originalContent: { title: pack.title } }],
        },
      },
    });
  });

  it("requires both deployment flag and workspace allowlist without blocking existing reads/exports/deletion", async () => {
    const enabled = await setup();
    const { pack, version } = await publish(enabled.app, enabled.cookie);
    const disabled = await setup(false, true, enabled.repository, enabled.workspaceId);
    const headers = { cookie: disabled.cookie };
    expect(
      (await disabled.app.inject({ method: "GET", url: "/v1/auth/me", headers })).json(),
    ).toMatchObject({ productFeatures: { recoveryPacks: false } });
    expect(
      (await disabled.app.inject({ method: "GET", url: `/v1/recovery-packs/${pack.id}`, headers }))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await disabled.app.inject({
          method: "GET",
          url: `/v1/recovery-packs/${pack.id}/history`,
          headers,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await disabled.app.inject({
          method: "GET",
          url: `/v1/recovery-packs/versions/${version.id}/export`,
          headers,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await disabled.app.inject({
          method: "POST",
          url: "/v1/recovery-packs",
          headers,
          payload: { draft: draft() },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await disabled.app.inject({
          method: "POST",
          url: `/v1/recovery-packs/${pack.id}/publish`,
          headers,
          payload: { expectedDraftRevision: 0 },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await disabled.app.inject({
          method: "DELETE",
          url: `/v1/recovery-packs/${pack.id}`,
          headers,
        })
      ).statusCode,
    ).toBe(204);
    const notAllowlisted = await setup(true, false);
    expect(
      (
        await notAllowlisted.app.inject({
          method: "POST",
          url: "/v1/recovery-packs",
          headers: { cookie: notAllowlisted.cookie },
          payload: { draft: draft() },
        })
      ).statusCode,
    ).toBe(404);
  });

  it("denies unauthenticated/cross-workspace access and viewer mutations", async () => {
    const { app, cookie, repository, workspaceId } = await setup();
    const { pack, version } = await publish(app, cookie);
    expect(
      (await app.inject({ method: "GET", url: `/v1/recovery-packs/${pack.id}` })).statusCode,
    ).toBe(401);
    const stranger = await signIn(app, "pack-stranger@example.com");
    for (const url of [
      `/v1/recovery-packs/${pack.id}`,
      `/v1/recovery-packs/${pack.id}/history`,
      `/v1/recovery-packs/versions/${version.id}/export`,
    ])
      expect(
        (await app.inject({ method: "GET", url, headers: { cookie: stranger } })).statusCode,
      ).toBe(404);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/recovery-packs",
          headers: { cookie: stranger },
        })
      ).json(),
    ).toEqual({ packs: [] });
    const owner = [...repository.workspaceMembers.values()].find(
      (member) => member.workspaceId === workspaceId,
    )!;
    owner.role = "viewer";
    repository.users.get(owner.userId)!.role = "viewer";
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/recovery-packs",
          headers: { cookie },
          payload: { draft: draft() },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/v1/recovery-packs/${pack.id}`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/recovery-packs/${pack.id}`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(200);
  });

  it("imports lossless native JSON as an unpublished draft and rejects invalid publication", async () => {
    const { app, cookie } = await setup();
    const { version } = await publish(app, cookie);
    const exported = await app.inject({
      method: "GET",
      url: `/v1/recovery-packs/versions/${version.id}/export`,
      headers: { cookie },
    });
    const json = RecoveryPackJsonSchema.parse(exported.json());
    expect(json.content).toEqual(version.content);
    const imported = await app.inject({
      method: "POST",
      url: "/v1/recovery-packs/import",
      headers: { cookie },
      payload: json,
    });
    expect(imported.statusCode).toBe(201);
    expect(imported.json()).toMatchObject({
      pack: { currentVersionId: null, draft: version.content },
    });
    const incomplete = draft();
    incomplete.interventions = [];
    const created = await app.inject({
      method: "POST",
      url: "/v1/recovery-packs",
      headers: { cookie },
      payload: { draft: incomplete },
    });
    const id = created.json<{ pack: { id: string } }>().pack.id;
    const blocked = await app.inject({
      method: "POST",
      url: `/v1/recovery-packs/${id}/publish`,
      headers: { cookie },
      payload: { expectedDraftRevision: 0 },
    });
    expect(blocked.statusCode).toBe(422);
    expect(blocked.json()).toMatchObject({
      error: { details: { issues: [{ path: "interventions" }] } },
    });
  });
});
