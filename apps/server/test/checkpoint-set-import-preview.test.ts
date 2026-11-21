import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import {
  RecoveryPackContentSchema,
  recoveryPackContentHash,
  type CheckpointSetImportPreviewResponse,
  type CheckpointSetImportRequest,
  type CheckpointSetImportUnavailableReason,
  type QuizDraft,
} from "@openround/contracts";
import { createPlatformRepository, MemoryRepository } from "@openround/db";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";
import { hashToken } from "../src/security.js";
import { checkpointSetCsv, openRoundJson } from "../src/portability.js";
import { exportQtiPackage } from "../src/qti.js";

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
const bulk: CheckpointSetImportRequest = {
  format: "bulk",
  encoding: "text",
  data: "Review the procedure\n* Complete the check\n- Skip the check",
  title: "Structured import",
};

function expectUnavailable(
  response: { statusCode: number; json: () => unknown },
  unavailableReason: CheckpointSetImportUnavailableReason,
  actor: { userId: string; workspaceId: string },
) {
  expect(response.statusCode).toBe(402);
  expect(response.json()).toMatchObject({
    error: {
      code: "ENTITLEMENT_LIMIT",
      message: "Checkpoint-set import is unavailable for this workspace",
      details: {
        unavailableReason,
        creationContext: { actorId: actor.userId, workspaceId: actor.workspaceId },
      },
    },
  });
}

async function fixture(community = true) {
  const workspaceId = randomUUID(),
    repository = new MemoryRepository({ initialWorkspaceId: workspaceId });
  const config = ConfigSchema.parse({
    NODE_ENV: "test",
    ALLOW_IN_MEMORY: "true",
    COMMUNITY_MODE: String(community),
    FEATURE_ROUND_CLIENT_PROTOCOL: "true",
    CORE_PARITY_WORKSPACE_ALLOWLIST: workspaceId,
    LOG_LEVEL: "silent",
  });
  const { app } = await buildApp(config, { repository, cache: new MemorySessionCache() });
  apps.push(app);
  const now = new Date(),
    tokenHash = randomUUID();
  await repository.createMagicToken({
    id: randomUUID(),
    tokenHash,
    email: `${randomUUID()}@example.test`,
    segment: "workplace",
    policyVersion: "test",
    expiresAt: new Date(now.getTime() + 60_000),
    consumedAt: null,
  });
  const actor = (await repository.consumeMagicToken(tokenHash, now))!;
  const token = randomUUID();
  await repository.createCreatorSession({
    id: randomUUID(),
    userId: actor.userId,
    tokenHash: hashToken(token),
    activeWorkspaceId: actor.workspaceId,
    expiresAt: new Date(now.getTime() + 60 * 60_000),
    createdAt: now,
  });
  const headers = { cookie: `${config.COOKIE_NAME}=${token}` };
  const preview = async (input: CheckpointSetImportRequest = bulk) => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/quizzes/import/preview",
      headers,
      payload: input,
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json<CheckpointSetImportPreviewResponse>();
  };
  const confirm = (
    review: CheckpointSetImportPreviewResponse,
    input: CheckpointSetImportRequest = bulk,
    idempotencyKey = randomUUID(),
  ) =>
    app.inject({
      method: "POST",
      url: "/v1/quizzes/import/confirm",
      headers,
      payload: {
        ...input,
        previewFingerprint: review.previewFingerprint,
        creationContext: review.creationContext,
        idempotencyKey,
      },
    });
  const account = async () => {
    const response = await app.inject({ url: "/v1/auth/me", headers });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    return response.json();
  };
  return { app, repository, actor, config, headers, preview, confirm, account };
}

function completeDraft(): QuizDraft {
  return {
    title: "Portable review",
    description: "",
    questions: [
      {
        id: randomUUID(),
        type: "single_select",
        prompt: "Choose a complete procedure",
        choices: [
          { id: randomUUID(), label: "Complete the check", isCorrect: true },
          { id: randomUUID(), label: "Skip the check", isCorrect: false },
        ],
        timeLimitSeconds: 20,
        basePoints: 1000,
        explanation: "",
        mediaId: null,
        mediaAlt: null,
      },
    ],
  };
}

describe("structured Round import preview and confirmation", () => {
  it("previews JSON, CSV, bulk and QTI without creating drafts or using authoring jobs", async () => {
    const f = await fixture(),
      draft = completeDraft();
    const qti = await exportQtiPackage(draft);
    expect(qti.archive).toBeTruthy();
    const inputs: CheckpointSetImportRequest[] = [
      { format: "openround_json", encoding: "text", data: openRoundJson(draft) },
      { format: "csv", encoding: "text", data: checkpointSetCsv(draft) },
      bulk,
      { format: "qti3", encoding: "base64", data: qti.archive!.toString("base64") },
    ];
    for (const input of inputs) {
      const review = await f.preview(input);
      expect(review).toMatchObject({
        draft: { questions: [expect.anything()] },
        validation: { errors: [], importedCheckpoints: 1 },
        creationContext: { actorId: f.actor.userId, workspaceId: f.actor.workspaceId },
        sourceDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        previewFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
      expect((await f.preview(input)).previewFingerprint).toBe(review.previewFingerprint);
    }
    expect(await f.repository.listQuizzes(f.actor.workspaceId)).toEqual([]);
    expect(f.repository.quizDraftHistory.size).toBe(0);
    expect(await f.repository.countAuthoringJobsSince(f.actor.workspaceId, new Date(0))).toBe(0);
  });

  it("shows bounded errors and warnings and never confirms invalid or partially parsed input", async () => {
    const f = await fixture();
    const input = { ...bulk, data: `${bulk.data}\n\nInvalid second checkpoint` };
    const review = await f.preview(input);
    expect(review).toMatchObject({
      draft: null,
      validation: {
        importedCheckpoints: 1,
        errors: [{ code: "INVALID_BULK_BLOCK", row: 2 }],
        warnings: [{ code: "PRESENTATION_DEFAULTED" }],
      },
    });
    const confirmed = await f.confirm(review, input);
    expect(confirmed.statusCode).toBe(422);
    expect(confirmed.json()).toMatchObject({ error: { code: "IMPORT_VALIDATION_FAILED" } });
    const legacy = await f.app.inject({
      method: "POST",
      url: "/v1/quizzes/import",
      headers: f.headers,
      payload: input,
    });
    expect(legacy.statusCode).toBe(422);
    expect(await f.repository.listQuizzes(f.actor.workspaceId)).toEqual([]);
    const malformed = await f.app.inject({
      method: "POST",
      url: "/v1/quizzes/import/preview",
      headers: f.headers,
      payload: { format: "qti3", data: "not a ZIP", encoding: "text" },
    });
    expect(malformed.statusCode).toBe(400);
    const rawDraft = await f.app.inject({
      method: "POST",
      url: "/v1/quizzes/import/confirm",
      headers: f.headers,
      payload: {
        ...bulk,
        previewFingerprint: review.previewFingerprint,
        creationContext: review.creationContext,
        idempotencyKey: randomUUID(),
        draft: completeDraft(),
      },
    });
    expect(rawDraft.statusCode).toBe(400);
  });

  it("binds source/title/encoding and current actor/workspace without accepting a client draft", async () => {
    const f = await fixture(),
      review = await f.preview();
    for (const input of [
      { ...bulk, title: "Changed after preview" },
      { ...bulk, data: `${bulk.data}\n- Another choice` },
    ]) {
      const response = await f.confirm(review, input);
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ error: { code: "IMPORT_PREVIEW_STALE" } });
    }
    for (const creationContext of [
      { ...review.creationContext, actorId: randomUUID() },
      { ...review.creationContext, workspaceId: randomUUID() },
    ]) {
      const response = await f.app.inject({
        method: "POST",
        url: "/v1/quizzes/import/confirm",
        headers: f.headers,
        payload: {
          ...bulk,
          previewFingerprint: review.previewFingerprint,
          creationContext,
          idempotencyKey: randomUUID(),
        },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ error: { code: "IMPORT_CONTEXT_CHANGED" } });
    }
    const encoding = await f.confirm(review, { ...bulk, encoding: "base64" });
    expect(encoding.statusCode).toBe(400);
    expect(await f.repository.listQuizzes(f.actor.workspaceId)).toEqual([]);
  });

  it("recovers a lost success acknowledgement exactly once and rejects consumed keys with changed bodies", async () => {
    const f = await fixture(),
      review = await f.preview(),
      key = randomUUID();
    expect(await f.account()).toMatchObject({
      entitlements: { plan: "team", csvExport: true },
      csvExportUnavailableReason: null,
      checkpointSetImportUnavailableReason: null,
    });
    const results = await Promise.all(
      Array.from({ length: 4 }, () => f.confirm(review, bulk, key)),
    );
    expect(results.filter((response) => response.statusCode === 201)).toHaveLength(1);
    expect(results.every((response) => [200, 201].includes(response.statusCode))).toBe(true);
    const id = results[0]!.json().quiz.id;
    expect(new Set(results.map((response) => response.json().quiz.id)).size).toBe(1);
    await f.repository.updateQuizDraft({
      workspaceId: f.actor.workspaceId,
      quizId: id,
      draft: { ...results[0]!.json().quiz.draft, title: "Edited after import" },
      expectedRevision: 0,
      mutationId: randomUUID(),
      editorId: f.actor.userId,
      schemaVersion: 1,
      draftHash: "b".repeat(64),
    });
    const recovered = await f.confirm(review, bulk, key);
    expect(recovered.statusCode).toBe(200);
    expect(recovered.json()).toMatchObject({
      quiz: { id, draftRevision: 1, title: "Edited after import" },
      replayed: true,
    });
    const changed = await f.confirm(review, { ...bulk, title: "Different request" }, key);
    expect(changed.statusCode).toBe(409);
    expect(changed.json()).toMatchObject({ error: { code: "IDEMPOTENCY_CONFLICT" } });
    expect(await f.repository.listQuizzes(f.actor.workspaceId)).toHaveLength(1);
    expect(await f.repository.listQuizDraftHistory(f.actor.workspaceId, id, 20)).toHaveLength(2);
  });

  it("revalidates current writer authority but recovers committed imports after feature or entitlement rollback", async () => {
    const f = await fixture(),
      review = await f.preview(),
      key = randomUUID();
    expect((await f.confirm(review, bulk, key)).statusCode).toBe(201);
    const extended = completeDraft();
    const question = extended.questions[0]!;
    if (question.type !== "single_select") throw new Error("Expected single select fixture");
    extended.questions = [
      {
        ...question,
        type: "poll",
        purpose: "opinion",
        confidence: "off",
        basePoints: 0,
        maxSelections: 2,
        choices: question.choices.map((choice) => ({ ...choice, isCorrect: false })),
      },
    ];
    const extendedInput: CheckpointSetImportRequest = {
      format: "openround_json",
      encoding: "text",
      data: openRoundJson(extended),
    };
    const extendedReview = await f.preview(extendedInput);
    const extendedKey = randomUUID();
    const extendedCreated = await f.confirm(extendedReview, extendedInput, extendedKey);
    expect(extendedCreated.statusCode).toBe(201);
    const extendedId = extendedCreated.json().quiz.id;
    f.config.FEATURE_ROUND_CLIENT_PROTOCOL = false;
    const newer = await f.preview();
    expect(newer.sourceDigest).toBe(review.sourceDigest);
    expect(newer.previewFingerprint).not.toBe(review.previewFingerprint);
    const unavailable = await f.preview(extendedInput);
    expect(unavailable).toMatchObject({
      draft: null,
      validation: { errors: [{ code: "ROUND_RESPONSE_UNAVAILABLE" }] },
    });
    expect(unavailable.sourceDigest).toBe(extendedReview.sourceDigest);
    expect(unavailable.previewFingerprint).not.toBe(extendedReview.previewFingerprint);
    expect((await f.confirm(unavailable, extendedInput)).statusCode).toBe(422);
    const extendedRecovered = await f.confirm(extendedReview, extendedInput, extendedKey);
    expect(extendedRecovered.statusCode).toBe(200);
    expect(extendedRecovered.json()).toMatchObject({ quiz: { id: extendedId }, replayed: true });
    const stale = await f.confirm(review);
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: { code: "IMPORT_PREVIEW_STALE" } });
    expect((await f.confirm(review, bulk, key)).statusCode).toBe(200);
    f.config.COMMUNITY_MODE = false;
    expect((await f.confirm(review, bulk, key)).statusCode).toBe(200);
    expectUnavailable(await f.confirm(newer), "plan_limit", f.actor);
    expect(await f.repository.listQuizzes(f.actor.workspaceId)).toHaveLength(2);
  });

  it("uses effective workspace availability for import when it differs from the plan", async () => {
    const f = await fixture(false);
    const policy = createPlatformRepository(f.repository);
    expect(await f.account()).toMatchObject({
      entitlements: { plan: "free", csvExport: false },
      csvExportUnavailableReason: "plan_limit",
      checkpointSetImportUnavailableReason: "plan_limit",
    });
    const deniedPolicy = await policy.saveFeaturePolicy({
      expectedRevision: 0,
      features: { csvExport: { enabled: false, plans: ["free"] } },
    });
    expect(await f.account()).toMatchObject({
      entitlements: { plan: "free", csvExport: false },
      csvExportUnavailableReason: "operator_policy",
      checkpointSetImportUnavailableReason: "operator_policy",
    });
    expectUnavailable(
      await f.app.inject({
        method: "POST",
        url: "/v1/quizzes/import/preview",
        headers: f.headers,
        payload: bulk,
      }),
      "operator_policy",
      f.actor,
    );
    await policy.saveFeaturePolicy({
      expectedRevision: deniedPolicy.revision,
      features: { csvExport: { enabled: true, plans: ["free"] } },
    });
    expect(await f.account()).toMatchObject({
      entitlements: { plan: "free", csvExport: true },
      csvExportUnavailableReason: null,
      checkpointSetImportUnavailableReason: null,
    });
    const review = await f.preview();
    // Existing clients can still confirm a preview issued before denial reasons were added.
    expect(review.previewFingerprint).toBe(
      createHash("sha256")
        .update(
          JSON.stringify({
            protocol: "round-structured-import-preview-v1",
            source: {
              format: bulk.format,
              data: bulk.data,
              encoding: bulk.encoding,
              title: bulk.title,
            },
            creationContext: review.creationContext,
            authority: { importEnabled: true, roundClientProtocol: true },
          }),
        )
        .digest("hex"),
    );
    const key = randomUUID();
    const created = await f.confirm(review, bulk, key);
    expect(created.statusCode, created.body).toBe(201);
    const { quiz } = created.json<{ quiz: { id: string } }>();

    await f.repository.setPlan(f.actor.workspaceId, "pro");
    expect(await f.account()).toMatchObject({
      entitlements: { plan: "pro", csvExport: false },
      csvExportUnavailableReason: "operator_policy",
      checkpointSetImportUnavailableReason: "operator_policy",
    });
    for (const denied of [
      await f.app.inject({
        method: "POST",
        url: "/v1/quizzes/import/preview",
        headers: f.headers,
        payload: bulk,
      }),
      await f.confirm(review),
      await f.app.inject({
        method: "POST",
        url: "/v1/quizzes/import",
        headers: f.headers,
        payload: bulk,
      }),
    ]) {
      expectUnavailable(denied, "operator_policy", f.actor);
    }

    const recovered = await f.confirm(review, bulk, key);
    expect(recovered.statusCode).toBe(200);
    expect(recovered.json()).toMatchObject({ quiz: { id: quiz.id }, replayed: true });
    expect(await f.repository.listQuizzes(f.actor.workspaceId)).toHaveLength(1);
  });

  it("keeps validation authoritative when the source was previewed before private media vanished", async () => {
    const f = await fixture(),
      mediaId = randomUUID(),
      draft = completeDraft(),
      recheckId = randomUUID();
    await f.repository.createMediaAsset({
      id: mediaId,
      workspaceId: f.actor.workspaceId,
      objectKey: `media/${f.actor.workspaceId}/${mediaId}.png`,
      mimeType: "image/png",
      sizeBytes: 10,
      scanStatus: "clean",
      altText: "Evidence chart",
      createdAt: new Date(),
    });
    const content = RecoveryPackContentSchema.parse({
      schemaVersion: 1,
      title: "Process review",
      description: "",
      diagnostic: {
        ...draft.questions[0],
        purpose: "diagnostic",
        confidence: "required",
        conceptKeys: ["process"],
        linkedRecheckQuestionId: recheckId,
        mediaId,
        mediaAlt: "Evidence chart",
      },
      recheck: {
        ...draft.questions[0],
        id: recheckId,
        prompt: "Which check applies in the transfer scenario?",
        purpose: "practice",
        delivery: "recheck",
        conceptKeys: ["process"],
        linkedRecheckQuestionId: null,
      },
      delayedProbe: null,
      interventions: [
        {
          id: randomUUID(),
          title: "Review the procedure",
          body: "Complete each check.",
          citations: [],
        },
      ],
      conceptKeys: ["process"],
      misconceptionKeys: [],
      citations: [],
    });
    draft.questions = [content.diagnostic, content.recheck];
    draft.recoveryPackInsertions = [
      {
        id: randomUUID(),
        packId: randomUUID(),
        packVersionId: randomUUID(),
        packVersion: 1,
        contentHash: recoveryPackContentHash(content),
        diagnosticQuestionId: content.diagnostic.id,
        recheckQuestionId: content.recheck.id,
        originalContent: content,
      },
    ];
    const input: CheckpointSetImportRequest = {
      format: "openround_json",
      encoding: "text",
      data: openRoundJson(draft),
    };
    const review = await f.preview(input);
    expect(review.validation.errors).toEqual([]);
    f.repository.mediaAssets.delete(mediaId);
    const failed = await f.confirm(review, input);
    expect(failed.statusCode).toBe(422);
    expect(failed.json()).toMatchObject({
      error: { code: "IMPORT_VALIDATION_FAILED" },
      validation: { errors: [{ code: "RECOVERY_PACK_MEDIA_UNAVAILABLE" }] },
    });
    expect(await f.repository.listQuizzes(f.actor.workspaceId)).toEqual([]);
  });

  it("returns stable unavailable targets after archive and deletion and enforces hosted entitlement", async () => {
    const f = await fixture(),
      review = await f.preview(),
      key = randomUUID();
    const created = await f.confirm(review, bulk, key),
      id = created.json().quiz.id;
    await f.repository.archiveQuiz(f.actor.workspaceId, id, true);
    for (const deleted of [false, true]) {
      if (deleted) expect(await f.repository.deleteQuiz(f.actor.workspaceId, id)).toBe("deleted");
      const retry = await f.confirm(review, bulk, key);
      expect(retry.statusCode).toBe(409);
      expect(retry.json()).toMatchObject({ error: { code: "IMPORT_TARGET_UNAVAILABLE" } });
    }
    const hosted = await fixture(false);
    const denied = await hosted.app.inject({
      method: "POST",
      url: "/v1/quizzes/import/preview",
      headers: hosted.headers,
      payload: bulk,
    });
    expectUnavailable(denied, "plan_limit", hosted.actor);
  });
});
