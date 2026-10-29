import { signInFromVerificationResponse } from "./support/email-auth.js";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import {
  RecoveryPackContentSchema,
  type QuizDraft,
  type RecoveryPackUpdatePreview,
} from "@openround/contracts";
import {
  MemoryRepository,
  roundArtifactSchemaVersion,
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
  type ExtendedPackDestinationFormat,
} from "./fixtures/recovery-pack-extended-round.js";

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function signIn(app: FastifyInstance, email = "pack-update@example.com") {
  const magic = await app.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: {
      email,
      segment: "workplace",
      acceptPolicies: true,
    },
  });
  const result = await signInFromVerificationResponse(app, magic, email);
  const cookies = result.headers["set-cookie"]!;
  return (Array.isArray(cookies) ? cookies[0]! : cookies).split(";")[0]!;
}

async function application(
  repository: MemoryRepository,
  workspaceId: string,
  enabled = true,
  roundProtocolEnabled = false,
  roundAllowlisted = true,
) {
  const { app } = await buildApp(
    ConfigSchema.parse({
      NODE_ENV: "test",
      ALLOW_IN_MEMORY: "true",
      COMMUNITY_MODE: "false",
      LOG_LEVEL: "silent",
      WEB_ORIGIN: "http://localhost:3000",
      PUBLIC_API_URL: "http://localhost:4000",
      FEATURE_RECOVERY_PACKS: String(enabled),
      EVIDENCE_FEATURES_WORKSPACE_ALLOWLIST: workspaceId,
      FEATURE_ROUND_CLIENT_PROTOCOL: String(roundProtocolEnabled),
      CORE_PARITY_WORKSPACE_ALLOWLIST: roundAllowlisted ? workspaceId : "",
    }),
    { repository, cache: new MemorySessionCache() },
  );
  apps.push(app);
  return app;
}

function content() {
  const question = (prompt: string) => ({
    id: randomUUID(),
    type: "numeric" as const,
    prompt,
    purpose: "diagnostic" as const,
    confidence: "off" as const,
    delivery: "main" as const,
    conceptKeys: ["ratio"],
    linkedRecheckQuestionId: null as string | null,
    timeLimitSeconds: 30,
    basePoints: 100,
    explanation: "Divide the compared part by the reference.",
    mediaId: null,
    mediaAlt: null,
    correctValue: "0.5",
    tolerance: "0",
    unit: null,
  });
  const recheck = {
    ...question("What is the ratio in the different scenario?"),
    delivery: "recheck" as const,
  };
  return RecoveryPackContentSchema.parse({
    schemaVersion: 1,
    title: "Ratio recovery",
    description: "",
    diagnostic: { ...question("What is the ratio?"), linkedRecheckQuestionId: recheck.id },
    recheck,
    delayedProbe: question("What is the ratio one week later?"),
    interventions: [
      { id: randomUUID(), title: "Compare parts", body: "Use the reference part.", citations: [] },
    ],
    conceptKeys: ["ratio"],
    misconceptionKeys: [],
    citations: [],
  });
}

async function fixture(extendedType?: ExtendedPackDestinationFormat) {
  const workspaceId = randomUUID();
  const repository = new MemoryRepository({ initialWorkspaceId: workspaceId });
  const app = await application(repository, workspaceId, true, Boolean(extendedType));
  const cookie = await signIn(app);
  const headers = { cookie };
  const created = await app.inject({
    method: "POST",
    url: "/v1/recovery-packs",
    headers,
    payload: { draft: content() },
  });
  expect(created.statusCode).toBe(201);
  let pack = created.json<{ pack: RecoveryPackRecord }>().pack;
  const published = await app.inject({
    method: "POST",
    url: `/v1/recovery-packs/${pack.id}/publish`,
    headers,
    payload: { expectedDraftRevision: 0 },
  });
  expect(published.statusCode).toBe(200);
  const original = published.json<{ version: RecoveryPackVersionRecord }>().version;
  const round = await app.inject({
    method: "POST",
    url: "/v1/quizzes",
    headers,
    payload: { title: "Recovery destination" },
  });
  const quizId = round.json<{ quiz: QuizRecord }>().quiz.id;
  if (extendedType) {
    const saved = await app.inject({
      method: "PATCH",
      url: `/v1/quizzes/${quizId}`,
      headers,
      payload: {
        draft: {
          title: "Recovery destination",
          description: "",
          questions: [extendedPackDestinationQuestion(extendedType)],
        },
        expectedDraftRevision: 0,
      },
    });
    expect(saved.statusCode).toBe(200);
  }
  const inserted = await app.inject({
    method: "POST",
    url: "/v1/recovery-packs/insert",
    headers,
    payload: {
      quizId,
      packVersionId: original.id,
      expectedRevision: extendedType ? 1 : 0,
      mutationId: randomUUID(),
    },
  });
  expect(inserted.statusCode).toBe(200);
  const quiz = inserted.json<{ quiz: QuizRecord }>().quiz;
  const insertionId = quiz.draft.recoveryPackInsertions![0]!.id;
  const publishNext = async (edit: (draft: typeof pack.draft) => void) => {
    const next = structuredClone(pack.draft);
    edit(next);
    const saved = await app.inject({
      method: "PUT",
      url: `/v1/recovery-packs/${pack.id}/draft`,
      headers,
      payload: {
        draft: next,
        expectedRevision: pack.draftRevision,
        mutationId: randomUUID(),
      },
    });
    expect(saved.statusCode).toBe(200);
    pack = saved.json<{ pack: RecoveryPackRecord }>().pack;
    const result = await app.inject({
      method: "POST",
      url: `/v1/recovery-packs/${pack.id}/publish`,
      headers,
      payload: {
        expectedDraftRevision: pack.draftRevision,
      },
    });
    expect(result.statusCode).toBe(200);
    return result.json<{ version: RecoveryPackVersionRecord }>().version;
  };
  const review = async () => {
    const result = await app.inject({
      method: "POST",
      url: "/v1/recovery-packs/update-review",
      headers,
      payload: { quizId, insertionId },
    });
    expect(result.statusCode).toBe(200);
    return result.json<{ review: RecoveryPackUpdatePreview }>().review;
  };
  const saveLocal = async (edit: (draft: QuizDraft) => void) => {
    const current = (await repository.getQuiz(workspaceId, quizId))!;
    const next = structuredClone(current.draft);
    edit(next);
    const result = await app.inject({
      method: "PUT",
      url: `/v1/quizzes/${quizId}/draft`,
      headers,
      payload: {
        draft: next,
        expectedRevision: current.draftRevision,
        schemaVersion: roundArtifactSchemaVersion(next),
        mutationId: randomUUID(),
      },
    });
    expect(result.statusCode).toBe(200);
    return result.json<{ quiz: QuizRecord }>().quiz;
  };
  const requestFor = (preview: RecoveryPackUpdatePreview) => ({
    quizId,
    insertionId,
    packVersionId: preview.latestVersionId,
    expectedRevision: preview.draftRevision,
    mutationId: randomUUID(),
    choices: [],
  });
  return {
    app,
    repository,
    workspaceId,
    cookie,
    headers,
    quiz,
    original,
    insertionId,
    publishNext,
    review,
    saveLocal,
    requestFor,
  };
}

describe("Recovery Pack three-way update API", () => {
  it.each(extendedPackDestinationFormats)(
    "updates an existing %s Round and preserves its artifact, immutable evidence, and undo",
    async (type, schemaVersion) => {
      const f = await fixture(type);
      const publishedRound = await f.app.inject({
        method: "POST",
        url: `/v1/quizzes/${f.quiz.id}/publish`,
        headers: f.headers,
        payload: {},
      });
      expect(publishedRound.statusCode).toBe(200);
      const publishedVersionId = (await f.repository.getQuiz(f.workspaceId, f.quiz.id))!
        .currentVersionId!;
      const latest = await f.publishNext((draft) => {
        draft.diagnostic.prompt = "Updated evidence checkpoint";
      });
      const preview = await f.review();
      const payload = f.requestFor(preview);
      const request = {
        method: "POST" as const,
        url: "/v1/recovery-packs/update",
        headers: f.headers,
        payload,
      };
      const result = await f.app.inject(request);
      expect(result.statusCode).toBe(200);
      const { quiz, undo } = result.json<{
        quiz: QuizRecord;
        undo: { sourceRevision: number; appliedRevision: number };
      }>();
      expect(quiz.draftSchemaVersion).toBe(schemaVersion);
      expect(quiz.draftRevision).toBe(3);
      expect(undo).toEqual({ sourceRevision: 2, appliedRevision: 3 });
      expect(quiz.draft.questions[0]).toEqual(f.quiz.draft.questions[0]);
      expect(quiz.draft.questions[1]).toMatchObject({
        id: f.quiz.draft.questions[1]!.id,
        prompt: latest.content.diagnostic.prompt,
        recoveryPackSource: { packVersionId: latest.id },
      });
      expect(quiz.draft.recoveryPackInsertions![0]).toMatchObject({
        originalContent: f.original.content,
        updateBaseline: { content: latest.content, packVersionId: latest.id },
      });
      expect(
        (await f.repository.getQuizVersion(f.workspaceId, publishedVersionId))!.content,
      ).toEqual(f.quiz.draft);

      const disabled = await application(f.repository, f.workspaceId, true, false);
      const disabledHeaders = { cookie: await signIn(disabled) };
      const retry = await disabled.inject({ ...request, headers: disabledHeaders });
      expect(retry.statusCode).toBe(200);
      expect(retry.json()).toEqual(result.json());
      await f.publishNext((draft) => {
        draft.diagnostic.prompt = "New proposal after protocol rollback";
      });
      const newPayload = f.requestFor(await f.review());
      const blocked = await disabled.inject({
        ...request,
        headers: disabledHeaders,
        payload: newPayload,
      });
      expect(blocked.statusCode).toBe(404);
      expect(blocked.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
      expect((await f.repository.getQuiz(f.workspaceId, f.quiz.id))!.draftRevision).toBe(3);

      const later = await f.saveLocal((draft) => {
        draft.title = "Later unrelated Round edit";
      });
      expect((await disabled.inject({ ...request, headers: disabledHeaders })).json()).toEqual(
        result.json(),
      );
      expect((await f.repository.getQuiz(f.workspaceId, f.quiz.id))!.draft).toEqual(later.draft);
      expect(
        (
          await f.app.inject({
            method: "POST",
            url: `/v1/quizzes/${f.quiz.id}/history/${undo.sourceRevision}/restore`,
            headers: f.headers,
            payload: { expectedRevision: 4, mutationId: randomUUID() },
          })
        ).statusCode,
      ).toBe(200);
      const restored = (await f.repository.getQuiz(f.workspaceId, f.quiz.id))!;
      expect(restored.draftSchemaVersion).toBe(schemaVersion);
      expect(restored.draft).toEqual(f.quiz.draft);
    },
  );

  it("blocks a fresh extended-Round Pack update outside the protocol workspace allowlist", async () => {
    const f = await fixture("word_cloud");
    await f.publishNext((draft) => {
      draft.diagnostic.prompt = "Updated proposal";
    });
    const payload = f.requestFor(await f.review());
    const unlisted = await application(f.repository, f.workspaceId, true, true, false);
    const result = await unlisted.inject({
      method: "POST",
      url: "/v1/recovery-packs/update",
      headers: { cookie: await signIn(unlisted) },
      payload,
    });
    expect(result.statusCode).toBe(404);
    expect((await f.repository.getQuiz(f.workspaceId, f.quiz.id))!.draft).toEqual(f.quiz.draft);
    expect((await f.repository.getQuiz(f.workspaceId, f.quiz.id))!.draftRevision).toBe(2);
  });

  it("updates only the draft, preserves original evidence/IDs, and can undo idempotently", async () => {
    const f = await fixture();
    const publishedRound = await f.app.inject({
      method: "POST",
      url: `/v1/quizzes/${f.quiz.id}/publish`,
      headers: f.headers,
      payload: {},
    });
    expect(publishedRound.statusCode).toBe(200);
    const before = (await f.repository.getQuiz(f.workspaceId, f.quiz.id))!;
    const latest = await f.publishNext((draft) => {
      draft.diagnostic.prompt = "What is the ratio for this clearer diagram?";
      draft.interventions[0]!.body = "Compare two contrasting diagrams.";
    });
    const preview = await f.review();
    expect(preview).toMatchObject({
      draftRevision: 1,
      baselineVersion: 1,
      latestVersion: 2,
      contextChanged: true,
    });
    expect(preview.items.map((item) => item.status)).toEqual(["source_changed", "unchanged"]);
    const payload = f.requestFor(preview);
    const apply = await f.app.inject({
      method: "POST",
      url: "/v1/recovery-packs/update",
      headers: f.headers,
      payload,
    });
    expect(apply.statusCode).toBe(200);
    const { quiz, undo } = apply.json<{
      quiz: QuizRecord;
      undo: { sourceRevision: number; appliedRevision: number };
    }>();
    expect(undo).toEqual({ sourceRevision: 1, appliedRevision: 2 });
    expect(quiz.draft.questions[0]).toMatchObject({
      id: f.quiz.draft.questions[0]!.id,
      prompt: latest.content.diagnostic.prompt,
      recoveryPackSource: { packVersionId: latest.id },
    });
    expect(quiz.draft.questions[1]).toEqual(f.quiz.draft.questions[1]);
    expect(quiz.draft.recoveryPackInsertions![0]).toMatchObject({
      packVersionId: f.original.id,
      originalContent: f.original.content,
      updateBaseline: { packVersionId: latest.id, content: latest.content },
    });
    expect(
      (await f.repository.getQuizVersion(f.workspaceId, before.currentVersionId!))?.content,
    ).toEqual(before.draft);
    const restorePayload = { expectedRevision: undo.appliedRevision, mutationId: randomUUID() };
    const undoRequest = {
      method: "POST" as const,
      url: `/v1/quizzes/${quiz.id}/history/${undo.sourceRevision}/restore`,
      headers: f.headers,
      payload: restorePayload,
    };
    expect((await f.app.inject(undoRequest)).statusCode).toBe(200);
    expect((await f.app.inject(undoRequest)).statusCode).toBe(200);
    const restored = (await f.repository.getQuiz(f.workspaceId, quiz.id))!;
    expect(restored.draft).toEqual(f.quiz.draft);
    expect(restored.draftRevision).toBe(3);
    expect(
      (
        await f.app.inject({
          ...undoRequest,
          payload: { ...restorePayload, mutationId: randomUUID() },
        })
      ).statusCode,
    ).toBe(409);
  });

  it("requires explicit conflict choices and retains local provenance across subsequent reviews", async () => {
    const f = await fixture();
    await f.saveLocal((draft) => {
      draft.questions[0]!.prompt = "Locally adapted ratio question";
    });
    const latest = await f.publishNext((draft) => {
      draft.diagnostic.prompt = "Updated source ratio question";
      draft.recheck.prompt = "New contrasting source scenario";
    });
    const preview = await f.review();
    expect(preview.items.map((item) => item.status)).toEqual(["conflict", "source_changed"]);
    const payload = f.requestFor(preview);
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: "/v1/recovery-packs/update",
          headers: f.headers,
          payload,
        })
      ).statusCode,
    ).toBe(409);
    const applied = await f.app.inject({
      method: "POST",
      url: "/v1/recovery-packs/update",
      headers: f.headers,
      payload: {
        ...payload,
        choices: [{ role: "diagnostic", action: "keep_local" }],
      },
    });
    expect(applied.statusCode).toBe(200);
    const quiz = applied.json<{ quiz: QuizRecord }>().quiz;
    expect(quiz.draft.questions[0]).toMatchObject({
      prompt: "Locally adapted ratio question",
      recoveryPackSource: { packVersionId: f.original.id },
    });
    expect(quiz.draft.questions[1]).toMatchObject({
      prompt: latest.content.recheck.prompt,
      recoveryPackSource: { packVersionId: latest.id },
    });
    await f.publishNext((draft) => {
      draft.interventions[0]!.body = "Third version guidance";
    });
    expect((await f.review()).items.map((item) => item.status)).toEqual([
      "local_changed",
      "unchanged",
    ]);
  });

  it("never automatically restores a locally deleted question", async () => {
    const f = await fixture();
    await f.saveLocal((draft) => {
      draft.questions.pop();
    });
    await f.publishNext((draft) => {
      draft.recheck.prompt = "Revised distinct scenario";
    });
    const preview = await f.review();
    expect(preview.items[1]).toMatchObject({ status: "conflict", local: null });
    const result = await f.app.inject({
      method: "POST",
      url: "/v1/recovery-packs/update",
      headers: f.headers,
      payload: {
        ...f.requestFor(preview),
        choices: [{ role: "recheck", action: "keep_local" }],
      },
    });
    expect(result.statusCode).toBe(200);
    expect(result.json<{ quiz: QuizRecord }>().quiz.draft.questions).toHaveLength(1);
  });

  it("rejects an orphaned restore without saving and publishes an explicitly restored pair", async () => {
    const f = await fixture();
    const deleted = await f.saveLocal((draft) => {
      draft.questions.pop();
      draft.questions[0]!.linkedRecheckQuestionId = null;
      draft.questions[0]!.prompt = "Local diagnostic to preserve unless explicitly replaced";
    });
    await f.publishNext((draft) => {
      draft.recheck.prompt = "Updated source recheck scenario";
    });
    const preview = await f.review();
    expect(preview.items.map((item) => item.status)).toEqual(["local_changed", "conflict"]);
    const payload = f.requestFor(preview);
    const request = {
      method: "POST" as const,
      url: "/v1/recovery-packs/update",
      headers: f.headers,
    };
    const refused = await f.app.inject({
      ...request,
      payload: { ...payload, choices: [{ role: "recheck", action: "use_latest" }] },
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.message).toContain("Keeping the unlinked local diagnostic");
    expect((await f.repository.getQuiz(f.workspaceId, f.quiz.id))?.draft).toEqual(deleted.draft);
    expect((await f.repository.getQuiz(f.workspaceId, f.quiz.id))?.draftRevision).toBe(
      deleted.draftRevision,
    );
    const accepted = await f.app.inject({
      ...request,
      payload: {
        ...payload,
        mutationId: randomUUID(),
        choices: [
          { role: "diagnostic", action: "use_latest" },
          { role: "recheck", action: "use_latest" },
        ],
      },
    });
    expect(accepted.statusCode).toBe(200);
    const updated = accepted.json<{ quiz: QuizRecord }>().quiz;
    expect(updated.draft.questions[0]!.linkedRecheckQuestionId).toBe(
      updated.draft.questions[1]!.id,
    );
    const published = await f.app.inject({
      method: "POST",
      url: `/v1/quizzes/${f.quiz.id}/publish`,
      headers: f.headers,
      payload: {},
    });
    expect(published.statusCode).toBe(200);
  });

  it("resolves retries before source deletion and never overwrites later Round edits", async () => {
    const f = await fixture();
    await f.publishNext((draft) => {
      draft.diagnostic.prompt = "Reviewed second version";
    });
    const payload = f.requestFor(await f.review());
    const request = {
      method: "POST" as const,
      url: "/v1/recovery-packs/update",
      headers: f.headers,
      payload,
    };
    const applied = await f.app.inject(request);
    expect(applied.statusCode).toBe(200);
    const later = await f.saveLocal((draft) => {
      draft.title = "Later unrelated edit";
    });
    expect(
      (
        await f.app.inject({
          method: "DELETE",
          url: `/v1/recovery-packs/${f.original.packId}`,
          headers: f.headers,
        })
      ).statusCode,
    ).toBe(204);
    const retry = await f.app.inject(request);
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toEqual(applied.json());
    expect((await f.repository.getQuiz(f.workspaceId, f.quiz.id))?.draft).toEqual(later.draft);
    expect(
      (
        await f.app.inject({
          ...request,
          payload: { ...payload, choices: [{ role: "diagnostic", action: "keep_local" }] },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (await f.app.inject({ ...request, payload: { ...payload, mutationId: randomUUID() } }))
        .statusCode,
    ).toBe(409);
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: `/v1/quizzes/${f.quiz.id}/history/1/restore`,
          headers: f.headers,
          payload: { expectedRevision: 2, mutationId: randomUUID() },
        })
      ).statusCode,
    ).toBe(409);
  });

  it("pins the reviewed published version even if the source publishes again", async () => {
    const f = await fixture();
    const second = await f.publishNext((draft) => {
      draft.diagnostic.prompt = "Reviewed version two";
    });
    const payload = f.requestFor(await f.review());
    await f.publishNext((draft) => {
      draft.diagnostic.prompt = "Unreviewed version three";
    });
    const result = await f.app.inject({
      method: "POST",
      url: "/v1/recovery-packs/update",
      headers: f.headers,
      payload,
    });
    expect(result.statusCode).toBe(200);
    expect(result.json<{ quiz: QuizRecord }>().quiz.draft.questions[0]!.prompt).toBe(
      second.content.diagnostic.prompt,
    );
    expect((await f.review()).latestVersion).toBe(3);
  });

  it("reviews and accepts an earlier immutable version republished by the source", async () => {
    const f = await fixture();
    const second = await f.publishNext((draft) => {
      draft.diagnostic.prompt = "Published second version";
      draft.interventions[0]!.body = "Second version facilitator guidance";
    });
    const apply = (preview: RecoveryPackUpdatePreview) =>
      f.app.inject({
        method: "POST",
        url: "/v1/recovery-packs/update",
        headers: f.headers,
        payload: f.requestFor(preview),
      });
    expect((await apply(await f.review())).statusCode).toBe(200);
    const republished = await f.publishNext((draft) => {
      Object.assign(draft, structuredClone(f.original.content));
    });
    expect(republished.id).toBe(f.original.id);
    const preview = await f.review();
    expect(preview).toMatchObject({
      baselineVersionId: second.id,
      baselineVersion: 2,
      latestVersionId: f.original.id,
      latestVersion: 1,
      contextChanged: true,
    });
    expect(preview.items[0]!.status).toBe("source_changed");
    const result = await apply(preview);
    expect(result.statusCode).toBe(200);
    const updated = result.json<{ quiz: QuizRecord }>().quiz;
    expect(updated.draft.questions[0]!.prompt).toBe(f.original.content.diagnostic.prompt);
    expect(updated.draft.recoveryPackInsertions![0]).toMatchObject({
      packVersionId: f.original.id,
      originalContent: f.original.content,
      updateBaseline: { packVersionId: f.original.id, packVersion: 1 },
    });
    // The accepted rollback is not a new proposal on subsequent review.
    expect((await apply(await f.review())).statusCode).toBe(409);
  });

  it("keeps review/undo readable after disable but blocks new applies and unauthorized access", async () => {
    const f = await fixture();
    await f.publishNext((draft) => {
      draft.diagnostic.prompt = "Second version before disable";
    });
    const payload = f.requestFor(await f.review());
    const disabled = await application(f.repository, f.workspaceId, false);
    const request = {
      method: "POST" as const,
      url: "/v1/recovery-packs/update-review",
      headers: f.headers,
      payload: { quizId: f.quiz.id, insertionId: f.insertionId },
    };
    expect((await disabled.inject(request)).statusCode).toBe(200);
    expect(
      (await disabled.inject({ ...request, url: "/v1/recovery-packs/update", payload })).statusCode,
    ).toBe(404);
    expect((await f.app.inject({ ...request, headers: {} })).statusCode).toBe(401);
    const stranger = await signIn(f.app, "pack-update-stranger@example.com");
    expect((await f.app.inject({ ...request, headers: { cookie: stranger } })).statusCode).toBe(
      404,
    );
    const applied = await f.app.inject({ ...request, url: "/v1/recovery-packs/update", payload });
    expect(applied.statusCode).toBe(200);
    const undo = applied.json<{ undo: { sourceRevision: number; appliedRevision: number } }>().undo;
    expect(
      (
        await disabled.inject({
          method: "POST",
          url: `/v1/quizzes/${f.quiz.id}/history/${undo.sourceRevision}/restore`,
          headers: f.headers,
          payload: { expectedRevision: undo.appliedRevision, mutationId: randomUUID() },
        })
      ).statusCode,
    ).toBe(200);
    const owner = [...f.repository.workspaceMembers.values()].find(
      (member) => member.workspaceId === f.workspaceId,
    )!;
    owner.role = "viewer";
    f.repository.users.get(owner.userId)!.role = "viewer";
    expect((await f.app.inject(request)).statusCode).toBe(200);
    expect(
      (await f.app.inject({ ...request, url: "/v1/recovery-packs/update", payload })).statusCode,
    ).toBe(403);
  });

  it("allows only one concurrent update for a reviewed Round revision", async () => {
    const f = await fixture();
    await f.publishNext((draft) => {
      draft.diagnostic.prompt = "Concurrent reviewed update";
    });
    const payload = f.requestFor(await f.review());
    const results = await Promise.all(
      [payload, { ...payload, mutationId: randomUUID() }].map((input) =>
        f.app.inject({
          method: "POST",
          url: "/v1/recovery-packs/update",
          headers: f.headers,
          payload: input,
        }),
      ),
    );
    expect(results.map((result) => result.statusCode).sort()).toEqual([200, 409]);
    expect((await f.repository.getQuiz(f.workspaceId, f.quiz.id))?.draftRevision).toBe(2);
  });

  it("rejects an update that would consume the Round editor request headroom", async () => {
    const f = await fixture();
    const citation = {
      sourceName: "漢".repeat(200),
      sourceDigest: "a".repeat(64),
      locator: "漢".repeat(120),
      excerpt: "漢".repeat(500),
    };
    const largeRound = await f.saveLocal((draft) => {
      while (Buffer.byteLength(JSON.stringify(draft), "utf8") < 3_350_000) {
        draft.questions.push({
          id: randomUUID(),
          type: "single_select",
          prompt: "漢".repeat(500),
          explanation: "漢".repeat(1_000),
          purpose: "practice",
          delivery: "main",
          confidence: "off",
          conceptKeys: [],
          linkedRecheckQuestionId: null,
          timeLimitSeconds: 30,
          basePoints: 100,
          mediaId: null,
          mediaAlt: null,
          sourceCitations: Array.from({ length: 5 }, () => ({ ...citation })),
          choices: Array.from({ length: 6 }, (_, index) => ({
            id: randomUUID(),
            label: "漢".repeat(180),
            feedback: "漢".repeat(500),
            isCorrect: index === 0,
          })),
        });
      }
    });
    expect(largeRound.draft.questions.length).toBeLessThan(200);
    await f.publishNext((draft) => {
      draft.citations = Array.from({ length: 20 }, () => ({ ...citation }));
      draft.interventions = Array.from({ length: 5 }, () => ({
        id: randomUUID(),
        title: "Compare evidence",
        body: "漢".repeat(2_000),
        citations: Array.from({ length: 5 }, () => ({ ...citation })),
      }));
      for (const question of [draft.diagnostic, draft.recheck, draft.delayedProbe!]) {
        question.sourceCitations = Array.from({ length: 5 }, () => ({ ...citation }));
      }
    });
    const result = await f.app.inject({
      method: "POST",
      url: "/v1/recovery-packs/update",
      headers: f.headers,
      payload: f.requestFor(await f.review()),
    });
    expect(result.statusCode).toBe(422);
    expect((await f.repository.getQuiz(f.workspaceId, f.quiz.id))?.draft).toEqual(largeRound.draft);
    expect((await f.repository.getQuiz(f.workspaceId, f.quiz.id))?.draftRevision).toBe(2);
  });

  it("retains media present only in the accepted probe and rejects foreign-media native import", async () => {
    const f = await fixture();
    const mediaId = randomUUID();
    await f.repository.createMediaAsset({
      id: mediaId,
      workspaceId: f.workspaceId,
      objectKey: `media/${mediaId}.png`,
      mimeType: "image/png",
      sizeBytes: 128,
      scanStatus: "clean",
      altText: "Delayed probe diagram",
      createdAt: new Date(),
    });
    await f.publishNext((draft) => {
      draft.delayedProbe!.mediaId = mediaId;
      draft.delayedProbe!.mediaAlt = "Delayed probe diagram";
    });
    const result = await f.app.inject({
      method: "POST",
      url: "/v1/recovery-packs/update",
      headers: f.headers,
      payload: f.requestFor(await f.review()),
    });
    expect(result.statusCode).toBe(200);
    const updated = result.json<{ quiz: QuizRecord }>().quiz;
    expect(updated.draft.questions.every((question) => question.mediaId === null)).toBe(true);
    const nativeJson = openRoundJson(updated.draft);
    const sameWorkspace = await f.app.inject({
      method: "POST",
      url: "/v1/quizzes/import",
      headers: f.headers,
      payload: { format: "openround_json", data: nativeJson },
    });
    // Pro entitlement is orthogonal to baseline integrity.
    expect(sameWorkspace.statusCode).toBe(402);
    f.repository.plans.set(f.workspaceId, "pro");
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: "/v1/quizzes/import",
          headers: f.headers,
          payload: { format: "openround_json", data: nativeJson },
        })
      ).statusCode,
    ).toBe(201);
    const stranger = await signIn(f.app, "pack-media-stranger@example.com");
    const strangerWorkspace = [...f.repository.workspaceMembers.values()].find(
      (member) => member.workspaceId !== f.workspaceId,
    )!.workspaceId;
    f.repository.plans.set(strangerWorkspace, "pro");
    const foreign = await f.app.inject({
      method: "POST",
      url: "/v1/quizzes/import",
      headers: { cookie: stranger },
      payload: { format: "openround_json", data: nativeJson },
    });
    expect(foreign.statusCode).toBe(422);
    expect(foreign.json()).toMatchObject({
      validation: { errors: [{ code: "RECOVERY_PACK_MEDIA_UNAVAILABLE" }] },
    });
    expect(
      (
        await f.app.inject({
          method: "DELETE",
          url: `/v1/recovery-packs/${f.original.packId}`,
          headers: f.headers,
        })
      ).statusCode,
    ).toBe(204);
    expect(await f.repository.deleteMediaAsset(f.workspaceId, mediaId)).toBe(false);
    expect(
      (await f.repository.listMediaReferences(f.workspaceId, mediaId)).map(
        (edge) => edge.ownerType,
      ),
    ).toEqual(expect.arrayContaining(["quiz_draft", "quiz_history"]));
  });
});
