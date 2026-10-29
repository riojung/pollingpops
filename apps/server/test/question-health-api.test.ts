import { signInFromVerificationResponse } from "./support/email-auth.js";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { QuestionHealthResultSchema } from "@openround/contracts";
import { MemoryRepository } from "@openround/db";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";

let app: FastifyInstance | undefined;
let repository: MemoryRepository | undefined;
let workspaceId: string | undefined;

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

async function build(questionHealthEnabled: boolean, allowlisted = true) {
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
      FEATURE_QUESTION_HEALTH: String(questionHealthEnabled),
      EVIDENCE_FEATURES_WORKSPACE_ALLOWLIST: allowlisted ? workspaceId : "",
    }),
    { repository, cache: new MemorySessionCache() },
  );
  app = built.app;
  return built.app;
}

afterEach(async () => {
  if (app) await app.close();
  app = undefined;
  repository = undefined;
  workspaceId = undefined;
});

describe("Question Health draft route", () => {
  it("fails closed when disabled without making the existing draft unreadable", async () => {
    const target = await build(false);
    const cookie = await signIn(target, "question-health-disabled@example.com");
    const created = await target.inject({
      method: "POST",
      url: "/v1/quizzes",
      headers: { cookie },
      payload: { title: "Existing draft", description: "" },
    });
    const quizId = created.json<{ quiz: { id: string } }>().quiz.id;

    const hidden = await target.inject({
      method: "GET",
      url: `/v1/quizzes/${quizId}/question-health`,
      headers: { cookie },
    });
    const readable = await target.inject({
      method: "GET",
      url: `/v1/quizzes/${quizId}`,
      headers: { cookie },
    });

    expect(hidden.statusCode).toBe(404);
    expect(hidden.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
    expect(readable.statusCode).toBe(200);
  });

  it("evaluates only the allowlisted creator's current draft and fences the result by revision", async () => {
    const target = await build(true);
    const cookie = await signIn(target, "question-health-enabled@example.com");
    const account = await target.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } });
    expect(account.json()).toMatchObject({ productFeatures: { questionHealth: true } });
    const created = await target.inject({
      method: "POST",
      url: "/v1/quizzes",
      headers: { cookie },
      payload: { title: "Question Health draft", description: "" },
    });
    const quizId = created.json<{ quiz: { id: string } }>().quiz.id;
    const draft = {
      title: "Question Health draft",
      description: "",
      questions: [
        {
          id: randomUUID(),
          type: "single_select",
          prompt: "Which option should be chosen?",
          purpose: "diagnostic",
          confidence: "off",
          delivery: "main",
          conceptKeys: ["safe.choice"],
          linkedRecheckQuestionId: null,
          choices: [
            { id: randomUUID(), label: "The correct answer", isCorrect: true },
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

    const first = await target.inject({
      method: "GET",
      url: `/v1/quizzes/${quizId}/question-health`,
      headers: { cookie },
    });
    const repeated = await target.inject({
      method: "GET",
      url: `/v1/quizzes/${quizId}/question-health`,
      headers: { cookie },
    });
    const result = QuestionHealthResultSchema.parse(first.json());
    expect(first.statusCode).toBe(200);
    expect(first.headers["cache-control"]).toBe("private, no-store");
    expect(first.headers.etag).toBe('"draft-1"');
    expect(result).toMatchObject({ quizId, draftRevision: 1, evaluatedQuestionCount: 1 });
    expect(result.findings.map((finding) => finding.ruleId)).toEqual(
      expect.arrayContaining(["question.missing_explanation", "question.missing_citation"]),
    );
    expect(repeated.json()).toEqual(first.json());

    const citationFinding = result.findings.find(
      (finding) => finding.ruleId === "question.missing_citation",
    )!;
    const dismissalUrl = `/v1/quizzes/${quizId}/question-health/dismissals/${encodeURIComponent(citationFinding.id)}`;
    const dismissed = await target.inject({
      method: "PUT",
      url: dismissalUrl,
      headers: { cookie },
      payload: {
        draftRevision: result.draftRevision,
        ruleVersion: citationFinding.ruleVersion,
        rulesetVersion: citationFinding.rulesetVersion,
        contentHash: citationFinding.contentHash,
        reason: "intentional_choice",
      },
    });
    expect(dismissed.statusCode).toBe(200);
    expect(repository?.audits).toContainEqual(
      expect.objectContaining({
        action: "question_health.dismissal.create",
        targetType: "question_health_dismissal",
        targetId: citationFinding.id,
      }),
    );
    const afterDismissal = QuestionHealthResultSchema.parse(
      (
        await target.inject({
          method: "GET",
          url: `/v1/quizzes/${quizId}/question-health`,
          headers: { cookie },
        })
      ).json(),
    );
    expect(afterDismissal.dismissals).toMatchObject([
      { findingId: citationFinding.id, reason: "intentional_choice" },
    ]);

    const reopened = await target.inject({
      method: "DELETE",
      url: dismissalUrl,
      headers: { cookie },
      payload: {
        draftRevision: result.draftRevision,
        ruleVersion: citationFinding.ruleVersion,
        rulesetVersion: citationFinding.rulesetVersion,
        contentHash: citationFinding.contentHash,
      },
    });
    expect(reopened.statusCode).toBe(200);
    expect(reopened.json()).toEqual({ removed: true });
    expect(repository?.audits).toContainEqual(
      expect.objectContaining({
        action: "question_health.dismissal.delete",
        targetType: "question_health_dismissal",
        targetId: citationFinding.id,
      }),
    );

    const dismissedAgain = await target.inject({
      method: "PUT",
      url: dismissalUrl,
      headers: { cookie },
      payload: {
        draftRevision: result.draftRevision,
        ruleVersion: citationFinding.ruleVersion,
        rulesetVersion: citationFinding.rulesetVersion,
        contentHash: citationFinding.contentHash,
        reason: "intentional_choice",
      },
    });
    expect(dismissedAgain.statusCode).toBe(200);

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
    const afterEditResponse = await target.inject({
      method: "GET",
      url: `/v1/quizzes/${quizId}/question-health`,
      headers: { cookie },
    });
    const afterEdit = QuestionHealthResultSchema.parse(afterEditResponse.json());
    const oldCitation = result.findings.find(
      (finding) => finding.ruleId === "question.missing_citation",
    );
    const newCitation = afterEdit.findings.find(
      (finding) => finding.ruleId === "question.missing_citation",
    );
    expect(afterEdit.draftRevision).toBe(2);
    expect(afterEditResponse.headers.etag).toBe('"draft-2"');
    expect(newCitation?.id).toBe(oldCitation?.id);
    expect(newCitation?.contentHash).not.toBe(oldCitation?.contentHash);
    expect(afterEdit.dismissals).toEqual([]);

    const staleDismissal = await target.inject({
      method: "DELETE",
      url: dismissalUrl,
      headers: { cookie },
      payload: {
        draftRevision: result.draftRevision,
        ruleVersion: citationFinding.ruleVersion,
        rulesetVersion: citationFinding.rulesetVersion,
        contentHash: citationFinding.contentHash,
      },
    });
    expect(staleDismissal.statusCode).toBe(409);
  });

  it.each([
    { switchName: "deployment flag", enabled: false, allowlisted: true },
    { switchName: "workspace allowlist", enabled: true, allowlisted: false },
  ])(
    "keeps existing dismissals readable and reopenable after the $switchName is disabled",
    async ({ enabled, allowlisted }) => {
      const target = await build(true);
      const email = `question-health-toggle-${enabled}-${allowlisted}@example.com`;
      const cookie = await signIn(target, email);
      const created = await target.inject({
        method: "POST",
        url: "/v1/quizzes",
        headers: { cookie },
        payload: { title: "Toggle test", description: "" },
      });
      const quizId = created.json<{ quiz: { id: string } }>().quiz.id;
      const draft = {
        title: "Toggle test",
        description: "",
        questions: [
          {
            id: randomUUID(),
            type: "single_select",
            prompt: "Which option should be chosen?",
            purpose: "diagnostic",
            confidence: "off",
            delivery: "main",
            conceptKeys: ["safe.choice"],
            linkedRecheckQuestionId: null,
            choices: [
              { id: randomUUID(), label: "The correct answer", isCorrect: true },
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
      const result = QuestionHealthResultSchema.parse(
        (
          await target.inject({
            method: "GET",
            url: `/v1/quizzes/${quizId}/question-health`,
            headers: { cookie },
          })
        ).json(),
      );
      const finding = result.findings.find(
        (candidate) => candidate.ruleId === "question.missing_citation",
      )!;
      const dismissalUrl = `/v1/quizzes/${quizId}/question-health/dismissals/${encodeURIComponent(finding.id)}`;
      const identity = {
        draftRevision: result.draftRevision,
        ruleVersion: finding.ruleVersion,
        rulesetVersion: finding.rulesetVersion,
        contentHash: finding.contentHash,
      };
      const dismissed = await target.inject({
        method: "PUT",
        url: dismissalUrl,
        headers: { cookie },
        payload: { ...identity, reason: "intentional_choice" },
      });
      expect(dismissed.statusCode).toBe(200);

      await target.close();
      app = undefined;
      const disabled = await build(enabled, allowlisted);
      const disabledCookie = await signIn(disabled, email);
      const getUrl = `/v1/quizzes/${quizId}/question-health`;
      const afterDisable = await disabled.inject({
        method: "GET",
        url: getUrl,
        headers: { cookie: disabledCookie },
      });
      expect(afterDisable.statusCode).toBe(200);
      const preserved = QuestionHealthResultSchema.parse(afterDisable.json());
      expect(preserved.findings.map((item) => item.id)).toEqual([finding.id]);
      expect(preserved.dismissals).toMatchObject([
        { findingId: finding.id, reason: "intentional_choice" },
      ]);

      const blockedCreation = await disabled.inject({
        method: "PUT",
        url: dismissalUrl,
        headers: { cookie: disabledCookie },
        payload: { ...identity, reason: "false_positive" },
      });
      expect(blockedCreation.statusCode).toBe(404);

      const staleRemoval = await disabled.inject({
        method: "DELETE",
        url: dismissalUrl,
        headers: { cookie: disabledCookie },
        payload: { ...identity, draftRevision: identity.draftRevision + 1 },
      });
      expect(staleRemoval.statusCode).toBe(409);

      const reopened = await disabled.inject({
        method: "DELETE",
        url: dismissalUrl,
        headers: { cookie: disabledCookie },
        payload: identity,
      });
      expect(reopened.statusCode).toBe(200);
      expect(reopened.json()).toEqual({ removed: true });
      const afterReopen = await disabled.inject({
        method: "GET",
        url: getUrl,
        headers: { cookie: disabledCookie },
      });
      expect(afterReopen.statusCode).toBe(404);
    },
  );

  it("keeps an unchanged dismissal readable and reopenable beyond the findings cap", async () => {
    const target = await build(true);
    const email = "question-health-cap@example.com";
    const cookie = await signIn(target, email);
    const created = await target.inject({
      method: "POST",
      url: "/v1/quizzes",
      headers: { cookie },
      payload: { title: "Capped findings", description: "" },
    });
    const quizId = created.json<{ quiz: { id: string } }>().quiz.id;
    const targetQuestion = {
      id: randomUUID(),
      type: "single_select",
      prompt: "Which option should be chosen?",
      purpose: "diagnostic",
      confidence: "off",
      delivery: "main",
      conceptKeys: ["safe.choice"],
      linkedRecheckQuestionId: null,
      choices: [
        { id: randomUUID(), label: "The correct answer", isCorrect: true },
        { id: randomUUID(), label: "A distractor", isCorrect: false },
      ],
      timeLimitSeconds: 30,
      basePoints: 1_000,
      explanation: "",
      mediaId: null,
      mediaAlt: null,
    };
    const firstDraft = {
      title: "Capped findings",
      description: "",
      questions: [targetQuestion],
    };
    const firstSave = await target.inject({
      method: "PATCH",
      url: `/v1/quizzes/${quizId}`,
      headers: { cookie },
      payload: { draft: firstDraft, expectedDraftRevision: 0 },
    });
    expect(firstSave.statusCode).toBe(200);
    const firstReview = QuestionHealthResultSchema.parse(
      (
        await target.inject({
          method: "GET",
          url: `/v1/quizzes/${quizId}/question-health`,
          headers: { cookie },
        })
      ).json(),
    );
    const savedFinding = firstReview.findings.find(
      (finding) => finding.ruleId === "question.missing_citation",
    )!;
    const dismissalUrl = `/v1/quizzes/${quizId}/question-health/dismissals/${encodeURIComponent(savedFinding.id)}`;
    const identity = {
      draftRevision: firstReview.draftRevision,
      ruleVersion: savedFinding.ruleVersion,
      rulesetVersion: savedFinding.rulesetVersion,
      contentHash: savedFinding.contentHash,
    };
    expect(
      (
        await target.inject({
          method: "PUT",
          url: dismissalUrl,
          headers: { cookie },
          payload: { ...identity, reason: "intentional_choice" },
        })
      ).statusCode,
    ).toBe(200);

    const earlierQuestions = Array.from({ length: 145 }, (_, index) => ({
      ...targetQuestion,
      id: randomUUID(),
      prompt: `Earlier question ${index + 1}`,
      choices: Array.from({ length: 6 }, (_, choiceIndex) => ({
        id: randomUUID(),
        label: `Option ${choiceIndex + 1}`,
        isCorrect: choiceIndex === 0,
      })),
    }));
    const secondSave = await target.inject({
      method: "PATCH",
      url: `/v1/quizzes/${quizId}`,
      headers: { cookie },
      payload: {
        draft: { ...firstDraft, questions: [...earlierQuestions, targetQuestion] },
        expectedDraftRevision: 1,
      },
    });
    expect(secondSave.statusCode).toBe(200);
    const afterInsertion = QuestionHealthResultSchema.parse(
      (
        await target.inject({
          method: "GET",
          url: `/v1/quizzes/${quizId}/question-health`,
          headers: { cookie },
        })
      ).json(),
    );
    expect(afterInsertion.findings).toHaveLength(1_000);
    expect(afterInsertion.findingsTruncated).toBe(true);
    expect(afterInsertion.findings.some((finding) => finding.id === savedFinding.id)).toBe(true);
    expect(afterInsertion.dismissals).toMatchObject([{ findingId: savedFinding.id }]);

    await target.close();
    app = undefined;
    const disabled = await build(false);
    const disabledCookie = await signIn(disabled, email);
    const disabledReview = await disabled.inject({
      method: "GET",
      url: `/v1/quizzes/${quizId}/question-health`,
      headers: { cookie: disabledCookie },
    });
    expect(disabledReview.statusCode).toBe(200);
    expect(QuestionHealthResultSchema.parse(disabledReview.json()).findings).toMatchObject([
      { id: savedFinding.id, contentHash: savedFinding.contentHash },
    ]);
    const reopened = await disabled.inject({
      method: "DELETE",
      url: dismissalUrl,
      headers: { cookie: disabledCookie },
      payload: { ...identity, draftRevision: 2 },
    });
    expect(reopened.statusCode).toBe(200);
    expect(reopened.json()).toEqual({ removed: true });
  });
});
