import { signInFromVerificationResponse } from "./support/email-auth.js";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import {
  QuestionHealthResultSchema,
  QuestionHealthRevisionAppliedSchema,
  QuestionHealthRevisionPreviewSchema,
  QuestionHealthRevisionUndoneSchema,
} from "@openround/contracts";
import { MemoryRepository } from "@openround/db";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";

let app: FastifyInstance | undefined;
let repository: MemoryRepository | undefined;
let workspaceId: string | undefined;

async function build(
  enabled: boolean,
  allowlisted = true,
  otherAllowlistedWorkspaceIds: string[] = [],
) {
  workspaceId ??= randomUUID();
  repository ??= new MemoryRepository({ initialWorkspaceId: workspaceId });
  const built = await buildApp(
    ConfigSchema.parse({
      NODE_ENV: "test",
      ALLOW_IN_MEMORY: "true",
      COMMUNITY_MODE: "false",
      WEB_ORIGIN: "http://localhost:3000",
      PUBLIC_API_URL: "http://localhost:4000",
      LOG_LEVEL: "silent",
      TEST_INITIAL_WORKSPACE_ID: workspaceId,
      FEATURE_QUESTION_HEALTH: String(enabled),
      EVIDENCE_FEATURES_WORKSPACE_ALLOWLIST: allowlisted
        ? [workspaceId, ...otherAllowlistedWorkspaceIds].join(",")
        : "",
    }),
    { repository, cache: new MemorySessionCache() },
  );
  app = built.app;
  return built.app;
}

async function signIn(target: FastifyInstance, email: string) {
  const magic = await target.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: { email, segment: "workplace", acceptPolicies: true },
  });
  const verified = await signInFromVerificationResponse(target, magic, email);
  const setCookie = verified.headers["set-cookie"]!;
  return (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(";")[0]!;
}

async function createRound(target: FastifyInstance, cookie: string) {
  const created = await target.inject({
    method: "POST",
    url: "/v1/quizzes",
    headers: { cookie },
    payload: { title: "Question Health revision", description: "" },
  });
  expect(created.statusCode).toBe(201);
  const quizId = created.json<{ quiz: { id: string } }>().quiz.id;
  const draft = {
    title: "Question Health revision",
    description: "",
    questions: [
      {
        id: randomUUID(),
        type: "single_select",
        prompt: "Which option is correct?",
        purpose: "diagnostic",
        confidence: "off",
        delivery: "main",
        conceptKeys: ["revision.safety"],
        linkedRecheckQuestionId: null,
        choices: [
          { id: randomUUID(), label: "The correct option", isCorrect: true },
          { id: randomUUID(), label: "A distractor", isCorrect: false },
        ],
        timeLimitSeconds: 30,
        basePoints: 1_000,
        explanation: "",
        mediaId: null,
        mediaAlt: null,
      },
    ],
  };
  const saved = await target.inject({
    method: "PATCH",
    url: `/v1/quizzes/${quizId}`,
    headers: { cookie },
    payload: { draft, expectedDraftRevision: 0 },
  });
  expect(saved.statusCode).toBe(200);
  expect(saved.json()).toMatchObject({ quiz: { draftRevision: 1 } });
  return { quizId, draft };
}

async function explanationFinding(target: FastifyInstance, cookie: string, quizId: string) {
  const response = await target.inject({
    method: "GET",
    url: `/v1/quizzes/${quizId}/question-health`,
    headers: { cookie },
  });
  expect(response.statusCode).toBe(200);
  const result = QuestionHealthResultSchema.parse(response.json());
  const finding = result.findings.find(
    (candidate) => candidate.ruleId === "question.missing_explanation",
  );
  expect(finding).toBeDefined();
  return { result, finding: finding! };
}

afterEach(async () => {
  if (app) await app.close();
  app = undefined;
  repository = undefined;
  workspaceId = undefined;
});

describe("Question Health approved draft revisions", () => {
  it("previews without writing, applies once despite retries, and undoes without changing the published version", async () => {
    const target = await build(true);
    const cookie = await signIn(target, "question-health-apply@example.com");
    const { quizId, draft } = await createRound(target, cookie);
    const published = await target.inject({
      method: "POST",
      url: `/v1/quizzes/${quizId}/publish`,
      headers: { cookie },
      payload: { expectedDraftRevision: 1 },
    });
    expect(published.statusCode).toBe(200);
    const version = published.json<{ version: { id: string; content: unknown } }>().version;
    const { result, finding } = await explanationFinding(target, cookie, quizId);
    const url = `/v1/quizzes/${quizId}/question-health/findings/${encodeURIComponent(finding.id)}`;
    const input = {
      draftRevision: result.draftRevision,
      ruleVersion: finding.ruleVersion,
      rulesetVersion: finding.rulesetVersion,
      contentHash: finding.contentHash,
      action: { kind: "set_explanation", value: "The first option is correct." },
    };

    const preview = await target.inject({
      method: "POST",
      url: `${url}/preview`,
      headers: { cookie },
      payload: input,
    });
    expect(preview.statusCode).toBe(200);
    const diff = QuestionHealthRevisionPreviewSchema.parse(preview.json());
    expect(diff).toMatchObject({
      findingId: finding.id,
      draftRevision: 1,
      contentHash: finding.contentHash,
      changes: [
        {
          fieldPath: "questions.0.explanation",
          before: "",
          after: "The first option is correct.",
        },
      ],
    });
    const afterPreview = await target.inject({
      method: "GET",
      url: `/v1/quizzes/${quizId}`,
      headers: { cookie },
    });
    expect(afterPreview.json()).toMatchObject({ quiz: { draftRevision: 1, draft } });

    const mutationId = randomUUID();
    const applyRequest = () =>
      target.inject({
        method: "POST",
        url: `${url}/apply`,
        headers: { cookie },
        payload: { ...input, mutationId },
      });
    const [applied, replay] = await Promise.all([applyRequest(), applyRequest()]);
    expect(applied.statusCode).toBe(200);
    expect(replay.statusCode).toBe(200);
    const application = QuestionHealthRevisionAppliedSchema.parse(applied.json());
    expect(application).toMatchObject({
      appliedRevision: 2,
      changes: diff.changes,
      quiz: { draftRevision: 2, draft: { questions: [{ explanation: input.action.value }] } },
    });
    expect(application.quiz.currentVersionId).toBe(version.id);
    expect(QuestionHealthRevisionAppliedSchema.parse(replay.json())).toMatchObject({
      applicationId: application.applicationId,
      appliedRevision: 2,
    });
    expect(
      repository!.audits.filter(
        (audit) =>
          audit.action === "question_health.application.apply" &&
          audit.targetId === application.applicationId,
      ),
    ).toHaveLength(1);
    const conflictingRetry = await target.inject({
      method: "POST",
      url: `${url}/apply`,
      headers: { cookie },
      payload: {
        ...input,
        action: { kind: "set_explanation", value: "A different explanation." },
        mutationId,
      },
    });
    expect(conflictingRetry.statusCode).toBe(409);
    const staleNewAttempt = await target.inject({
      method: "POST",
      url: `${url}/apply`,
      headers: { cookie },
      payload: { ...input, mutationId: randomUUID() },
    });
    expect(staleNewAttempt.statusCode).toBe(409);

    const currentVersion = await repository!.getQuizVersion(workspaceId!, version.id);
    expect(currentVersion?.content).toEqual(version.content);
    const undoMutationId = randomUUID();
    const undoRequest = () =>
      target.inject({
        method: "POST",
        url: `/v1/quizzes/${quizId}/question-health/applications/${application.applicationId}/undo`,
        headers: { cookie },
        payload: { expectedRevision: 2, mutationId: undoMutationId },
      });
    const [undone, undoReplay] = await Promise.all([undoRequest(), undoRequest()]);
    expect(undone.statusCode).toBe(200);
    expect(undoReplay.statusCode).toBe(200);
    const restored = QuestionHealthRevisionUndoneSchema.parse(undone.json());
    expect(restored.quiz).toMatchObject({ draftRevision: 3, draft });
    expect(restored.quiz.currentVersionId).toBe(version.id);
    expect(QuestionHealthRevisionUndoneSchema.parse(undoReplay.json()).quiz.draftRevision).toBe(3);
    expect((await repository!.getQuizVersion(workspaceId!, version.id))?.content).toEqual(
      version.content,
    );
    expect(
      repository!.audits.filter(
        (audit) =>
          audit.action === "question_health.application.undo" &&
          audit.targetId === application.applicationId,
      ),
    ).toHaveLength(1);

    const laterEdit = await target.inject({
      method: "PATCH",
      url: `/v1/quizzes/${quizId}`,
      headers: { cookie },
      payload: {
        draft: { ...restored.quiz.draft, title: "Edited after undo" },
        expectedDraftRevision: 3,
      },
    });
    expect(laterEdit.statusCode).toBe(200);
    const lateUndoRetry = await undoRequest();
    expect(lateUndoRetry.statusCode).toBe(200);
    expect(QuestionHealthRevisionUndoneSchema.parse(lateUndoRetry.json()).quiz).toMatchObject({
      draftRevision: 4,
      draft: { title: "Edited after undo" },
    });
    expect(
      repository!.audits.filter(
        (audit) =>
          audit.action === "question_health.application.undo" &&
          audit.targetId === application.applicationId,
      ),
    ).toHaveLength(1);
  });

  it("rejects a stale finding and refuses undo after another edit", async () => {
    const target = await build(true);
    const cookie = await signIn(target, "question-health-stale@example.com");
    const { quizId, draft } = await createRound(target, cookie);
    const { result, finding } = await explanationFinding(target, cookie, quizId);
    const url = `/v1/quizzes/${quizId}/question-health/findings/${encodeURIComponent(finding.id)}`;
    const input = {
      draftRevision: result.draftRevision,
      ruleVersion: finding.ruleVersion,
      rulesetVersion: finding.rulesetVersion,
      contentHash: finding.contentHash,
      action: { kind: "set_explanation", value: "The first option is correct." },
    };
    const edited = await target.inject({
      method: "PATCH",
      url: `/v1/quizzes/${quizId}`,
      headers: { cookie },
      payload: {
        draft: { ...draft, questions: [{ ...draft.questions[0], prompt: "A changed prompt?" }] },
        expectedDraftRevision: 1,
      },
    });
    expect(edited.statusCode).toBe(200);
    for (const operation of ["preview", "apply"]) {
      const response = await target.inject({
        method: "POST",
        url: `${url}/${operation}`,
        headers: { cookie },
        payload: operation === "apply" ? { ...input, mutationId: randomUUID() } : input,
      });
      expect(response.statusCode).toBe(409);
    }

    const refreshed = await explanationFinding(target, cookie, quizId);
    const applied = await target.inject({
      method: "POST",
      url: `${url}/apply`,
      headers: { cookie },
      payload: {
        ...input,
        draftRevision: refreshed.result.draftRevision,
        contentHash: refreshed.finding.contentHash,
        mutationId: randomUUID(),
      },
    });
    expect(applied.statusCode).toBe(200);
    const application = QuestionHealthRevisionAppliedSchema.parse(applied.json());
    const otherEdit = await target.inject({
      method: "PATCH",
      url: `/v1/quizzes/${quizId}`,
      headers: { cookie },
      payload: {
        draft: { ...application.quiz.draft, title: "Another facilitator edit" },
        expectedDraftRevision: application.appliedRevision,
      },
    });
    expect(otherEdit.statusCode).toBe(200);
    const blockedUndo = await target.inject({
      method: "POST",
      url: `/v1/quizzes/${quizId}/question-health/applications/${application.applicationId}/undo`,
      headers: { cookie },
      payload: { expectedRevision: application.appliedRevision, mutationId: randomUUID() },
    });
    expect(blockedUndo.statusCode).toBe(409);
    const current = await target.inject({
      method: "GET",
      url: `/v1/quizzes/${quizId}`,
      headers: { cookie },
    });
    expect(current.json()).toMatchObject({
      quiz: { draftRevision: application.appliedRevision + 1, title: "Another facilitator edit" },
    });
  });

  it.each([
    { switchName: "deployment flag", enabled: false, allowlisted: true },
    { switchName: "workspace allowlist", enabled: true, allowlisted: false },
  ])(
    "blocks new changes after the $switchName is disabled but still allows an existing application to be undone",
    async ({ enabled, allowlisted }) => {
      const target = await build(true);
      const email = `question-health-apply-toggle-${enabled}-${allowlisted}@example.com`;
      const cookie = await signIn(target, email);
      const { quizId } = await createRound(target, cookie);
      const { result, finding } = await explanationFinding(target, cookie, quizId);
      const url = `/v1/quizzes/${quizId}/question-health/findings/${encodeURIComponent(finding.id)}`;
      const input = {
        draftRevision: result.draftRevision,
        ruleVersion: finding.ruleVersion,
        rulesetVersion: finding.rulesetVersion,
        contentHash: finding.contentHash,
        action: { kind: "set_explanation", value: "The first option is correct." },
      };
      const applied = await target.inject({
        method: "POST",
        url: `${url}/apply`,
        headers: { cookie },
        payload: { ...input, mutationId: randomUUID() },
      });
      expect(applied.statusCode).toBe(200);
      const application = QuestionHealthRevisionAppliedSchema.parse(applied.json());

      await target.close();
      app = undefined;
      const disabled = await build(enabled, allowlisted);
      const disabledCookie = await signIn(disabled, email);
      const readable = await disabled.inject({
        method: "GET",
        url: `/v1/quizzes/${quizId}`,
        headers: { cookie: disabledCookie },
      });
      expect(readable.statusCode).toBe(200);
      expect(readable.json()).toMatchObject({ quiz: { draftRevision: 2 } });
      const blockedPreview = await disabled.inject({
        method: "POST",
        url: `${url}/preview`,
        headers: { cookie: disabledCookie },
        payload: input,
      });
      expect(blockedPreview.statusCode).toBe(404);
      const blockedApply = await disabled.inject({
        method: "POST",
        url: `${url}/apply`,
        headers: { cookie: disabledCookie },
        payload: { ...input, mutationId: randomUUID() },
      });
      expect(blockedApply.statusCode).toBe(404);
      const undone = await disabled.inject({
        method: "POST",
        url: `/v1/quizzes/${quizId}/question-health/applications/${application.applicationId}/undo`,
        headers: { cookie: disabledCookie },
        payload: { expectedRevision: 2, mutationId: randomUUID() },
      });
      expect(undone.statusCode).toBe(200);
      expect(QuestionHealthRevisionUndoneSchema.parse(undone.json()).quiz.draftRevision).toBe(3);
    },
  );

  it("denies viewer edits while keeping the saved Round readable", async () => {
    const target = await build(true);
    const email = "question-health-viewer@example.com";
    const cookie = await signIn(target, email);
    const { quizId } = await createRound(target, cookie);
    const { result, finding } = await explanationFinding(target, cookie, quizId);
    const url = `/v1/quizzes/${quizId}/question-health/findings/${encodeURIComponent(finding.id)}`;
    const input = {
      draftRevision: result.draftRevision,
      ruleVersion: finding.ruleVersion,
      rulesetVersion: finding.rulesetVersion,
      contentHash: finding.contentHash,
      action: { kind: "set_explanation", value: "The first option is correct." },
      mutationId: randomUUID(),
    };
    const applied = await target.inject({
      method: "POST",
      url: `${url}/apply`,
      headers: { cookie },
      payload: input,
    });
    expect(applied.statusCode).toBe(200);
    const application = QuestionHealthRevisionAppliedSchema.parse(applied.json());
    const user = [...repository!.users.values()].find((candidate) => candidate.email === email)!;
    user.role = "viewer";

    const readable = await target.inject({
      method: "GET",
      url: `/v1/quizzes/${quizId}`,
      headers: { cookie },
    });
    expect(readable.statusCode).toBe(200);
    const blockedApply = await target.inject({
      method: "POST",
      url: `${url}/apply`,
      headers: { cookie },
      payload: input,
    });
    expect(blockedApply.statusCode).toBe(403);
    const blockedUndo = await target.inject({
      method: "POST",
      url: `/v1/quizzes/${quizId}/question-health/applications/${application.applicationId}/undo`,
      headers: { cookie },
      payload: { expectedRevision: application.appliedRevision, mutationId: randomUUID() },
    });
    expect(blockedUndo.statusCode).toBe(403);
    expect((await repository!.getQuiz(workspaceId!, quizId))?.draftRevision).toBe(2);
  });

  it("does not expose another workspace's finding or application, even when both workspaces are enabled", async () => {
    const target = await build(true);
    const ownerCookie = await signIn(target, "question-health-owner@example.com");
    const { quizId } = await createRound(target, ownerCookie);
    const { result, finding } = await explanationFinding(target, ownerCookie, quizId);
    const url = `/v1/quizzes/${quizId}/question-health/findings/${encodeURIComponent(finding.id)}`;
    const input = {
      draftRevision: result.draftRevision,
      ruleVersion: finding.ruleVersion,
      rulesetVersion: finding.rulesetVersion,
      contentHash: finding.contentHash,
      action: { kind: "set_explanation", value: "The first option is correct." },
    };
    const applied = await target.inject({
      method: "POST",
      url: `${url}/apply`,
      headers: { cookie: ownerCookie },
      payload: { ...input, mutationId: randomUUID() },
    });
    expect(applied.statusCode).toBe(200);
    const application = QuestionHealthRevisionAppliedSchema.parse(applied.json());

    const intruderEmail = "question-health-other-workspace@example.com";
    const intruderCookie = await signIn(target, intruderEmail);
    const intruderAccount = await target.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { cookie: intruderCookie },
    });
    const intruderWorkspaceId = intruderAccount.json<{ creator: { workspaceId: string } }>().creator
      .workspaceId;
    expect(intruderWorkspaceId).not.toBe(workspaceId);
    await target.close();
    app = undefined;
    const enabledForBoth = await build(true, true, [intruderWorkspaceId]);
    const enabledIntruderCookie = await signIn(enabledForBoth, intruderEmail);
    const enabledAccount = await enabledForBoth.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { cookie: enabledIntruderCookie },
    });
    expect(enabledAccount.json()).toMatchObject({ productFeatures: { questionHealth: true } });

    const preview = await enabledForBoth.inject({
      method: "POST",
      url: `${url}/preview`,
      headers: { cookie: enabledIntruderCookie },
      payload: input,
    });
    expect(preview.statusCode).toBe(404);
    const apply = await enabledForBoth.inject({
      method: "POST",
      url: `${url}/apply`,
      headers: { cookie: enabledIntruderCookie },
      payload: { ...input, mutationId: randomUUID() },
    });
    expect(apply.statusCode).toBe(404);
    const undo = await enabledForBoth.inject({
      method: "POST",
      url: `/v1/quizzes/${quizId}/question-health/applications/${application.applicationId}/undo`,
      headers: { cookie: enabledIntruderCookie },
      payload: { expectedRevision: application.appliedRevision, mutationId: randomUUID() },
    });
    expect(undo.statusCode).toBe(404);
    expect((await repository!.getQuiz(workspaceId!, quizId))?.draftRevision).toBe(2);
  });

  it("rejects an action that does not match the finding's field without modifying the draft", async () => {
    const target = await build(true);
    const cookie = await signIn(target, "question-health-action@example.com");
    const { quizId } = await createRound(target, cookie);
    const { result, finding } = await explanationFinding(target, cookie, quizId);
    const url = `/v1/quizzes/${quizId}/question-health/findings/${encodeURIComponent(finding.id)}`;
    const incompatible = {
      draftRevision: result.draftRevision,
      ruleVersion: finding.ruleVersion,
      rulesetVersion: finding.rulesetVersion,
      contentHash: finding.contentHash,
      action: { kind: "set_choice_label", value: "A rewritten choice" },
    };
    for (const operation of ["preview", "apply"]) {
      const response = await target.inject({
        method: "POST",
        url: `${url}/${operation}`,
        headers: { cookie },
        payload:
          operation === "apply" ? { ...incompatible, mutationId: randomUUID() } : incompatible,
      });
      expect(response.statusCode).toBe(422);
    }
    expect((await repository!.getQuiz(workspaceId!, quizId))?.draftRevision).toBe(1);
  });

  it("rejects an authored edit that leaves the flagged problem unresolved", async () => {
    const target = await build(true);
    const cookie = await signIn(target, "question-health-unresolved@example.com");
    const { quizId, draft } = await createRound(target, cookie);
    const duplicateDraft = {
      ...draft,
      questions: [
        {
          ...draft.questions[0],
          choices: [
            draft.questions[0]!.choices[0]!,
            { ...draft.questions[0]!.choices[1]!, label: "The correct option" },
          ],
        },
      ],
    };
    const edited = await target.inject({
      method: "PATCH",
      url: `/v1/quizzes/${quizId}`,
      headers: { cookie },
      payload: { draft: duplicateDraft, expectedDraftRevision: 1 },
    });
    expect(edited.statusCode).toBe(200);
    const reviewed = QuestionHealthResultSchema.parse(
      (
        await target.inject({
          method: "GET",
          url: `/v1/quizzes/${quizId}/question-health`,
          headers: { cookie },
        })
      ).json(),
    );
    const finding = reviewed.findings.find((item) => item.ruleId === "choice.duplicate")!;
    const url = `/v1/quizzes/${quizId}/question-health/findings/${encodeURIComponent(finding.id)}`;
    const input = {
      draftRevision: reviewed.draftRevision,
      ruleVersion: finding.ruleVersion,
      rulesetVersion: finding.rulesetVersion,
      contentHash: finding.contentHash,
      action: { kind: "set_choice_label", value: "THE CORRECT OPTION" },
    };
    for (const operation of ["preview", "apply"]) {
      const response = await target.inject({
        method: "POST",
        url: `${url}/${operation}`,
        headers: { cookie },
        payload: operation === "apply" ? { ...input, mutationId: randomUUID() } : input,
      });
      expect(response.statusCode).toBe(422);
    }
    expect((await repository!.getQuiz(workspaceId!, quizId))?.draftRevision).toBe(2);
  });
});
