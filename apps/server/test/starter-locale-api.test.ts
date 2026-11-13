import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { supportedLocales, type StarterSummary } from "@openround/contracts";
import { MemoryRepository } from "@openround/db";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";
import { STARTER_CONTENT_VERSION, surveyCreationCopy } from "../src/starter-localization.js";
import { instantiateStarter, instantiateSurveyStarter } from "../src/starters.js";
import { signInFromVerificationResponse } from "./support/email-auth.js";

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});
async function fixture() {
  const workspaceId = randomUUID();
  const repository = new MemoryRepository({ initialWorkspaceId: workspaceId, initialPlan: "pro" });
  const built = await buildApp(
    ConfigSchema.parse({
      NODE_ENV: "test",
      ALLOW_IN_MEMORY: "true",
      COMMUNITY_MODE: "false",
      WEB_ORIGIN: "http://localhost:3000",
      PUBLIC_API_URL: "http://localhost:4000",
      LOG_LEVEL: "silent",
      FEATURE_UX_BETA: "true",
      UX_BETA_WORKSPACE_ALLOWLIST: workspaceId,
      FEATURE_AUDIENCE_SCOPES: "true",
      FEATURE_FEEDBACK_ROOMS: "true",
      FEATURE_SURVEYS: "true",
      CORE_PARITY_WORKSPACE_ALLOWLIST: workspaceId,
    }),
    { repository, cache: new MemorySessionCache() },
  );
  app = built.app;
  const email = "starter-locale@example.com";
  const registration = await app.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: { email, segment: "workplace", acceptPolicies: true },
  });
  const signedIn = await signInFromVerificationResponse(app, registration, email);
  const headers = { cookie: String(signedIn.headers["set-cookie"]).split(";")[0]! };
  return { app, repository, workspaceId, headers };
}

describe("explicit starter creation languages", () => {
  it("agrees across Round lists, previews and creation in all ten locales and freezes published content", async () => {
    const { app, headers, repository, workspaceId } = await fixture();
    let koreanId = "";
    for (const locale of supportedLocales) {
      const listed = await app.inject({
        method: "GET",
        url: `/v1/starters?locale=${locale}`,
        headers,
      });
      expect(listed.statusCode, listed.body).toBe(200);
      expect(listed.json()).toMatchObject({
        contentLocale: locale,
        contentVersion: STARTER_CONTENT_VERSION,
      });
      const summary = listed
        .json<{ starters: StarterSummary[] }>()
        .starters.find((entry) => entry.id === "misconception-check")!;
      const preview = await app.inject({
        method: "GET",
        url: `/v1/starters/misconception-check?locale=${locale}`,
        headers,
      });
      expect(preview.statusCode, preview.body).toBe(200);
      const created = await app.inject({
        method: "POST",
        url: "/v1/starters/misconception-check/use",
        headers,
        payload: { locale },
      });
      expect(created.statusCode, created.body).toBe(201);
      const quiz = created.json().quiz;
      expect(quiz.draft.title).toBe(summary.title);
      expect(quiz.draft.questions[0].prompt).toBe(summary.previewPrompt);
      expect(
        preview.json().draft.questions.map((question: { prompt: string }) => question.prompt),
      ).toEqual(quiz.draft.questions.map((question: { prompt: string }) => question.prompt));
      expect(quiz.draft.questions[0].linkedRecheckQuestionId).toBe(quiz.draft.questions[1].id);
      expect(
        repository.audits.find(
          (entry) => entry.targetId === quiz.id && entry.action === "starter.use",
        )?.metadata,
      ).toMatchObject({
        starterVersion: 1,
        contentLocale: locale,
        contentVersion: STARTER_CONTENT_VERSION,
      });
      if (locale === "ko-KR") koreanId = quiz.id;
    }
    const legacy = await app.inject({
      method: "POST",
      url: "/v1/starters/exit-ticket/use",
      headers,
    });
    expect(legacy.statusCode, legacy.body).toBe(201);
    expect(legacy.json().quiz.draft.title).toBe("Exit ticket");
    const published = await app.inject({
      method: "POST",
      url: `/v1/quizzes/${koreanId}/publish`,
      headers,
      payload: { expectedDraftRevision: 0 },
    });
    expect(published.statusCode, published.body).toBe(200);
    const version = published.json().version;
    const original = structuredClone(await repository.getQuiz(workspaceId, koreanId));
    await app.inject({
      method: "PUT",
      url: "/v1/account/locale",
      headers,
      payload: { locale: "fr-FR" },
    });
    await app.inject({ method: "GET", url: "/v1/starters?locale=fr-FR", headers });
    expect(await repository.getQuiz(workspaceId, koreanId)).toEqual(original);
    expect(await repository.getQuizVersion(workspaceId, version.id)).toMatchObject({
      content: version.content,
      contentHash: version.contentHash,
      contentSchemaVersion: version.contentSchemaVersion,
    });
    expect(version.content.title).toBe(instantiateStarter("misconception-check", "ko-KR").title);
  });

  it("creates localized Surveys with immutable retries, explicit copy suffixes and English compatibility", async () => {
    const { app, headers } = await fixture();
    for (const locale of supportedLocales) {
      const listed = await app.inject({
        method: "GET",
        url: `/v1/surveys/templates?locale=${locale}`,
        headers,
      });
      expect(listed.statusCode, listed.body).toBe(200);
      expect(listed.json().templates).toHaveLength(6);
      expect(
        listed
          .json()
          .templates.map((entry: StarterSummary) => entry.id)
          .sort(),
      ).toEqual([
        "community-planning",
        "event-feedback",
        "learning-needs",
        "onboarding-experience",
        "service-experience",
        "team-collaboration",
      ]);
      const payload = { idempotencyKey: randomUUID(), templateId: "team-collaboration", locale };
      const created = await app.inject({ method: "POST", url: "/v1/surveys", headers, payload });
      expect(created.statusCode, created.body).toBe(201);
      const survey = created.json().survey;
      const summary = listed
        .json<{ templates: StarterSummary[] }>()
        .templates.find((entry) => entry.id === "team-collaboration")!;
      expect(survey.draft.title).toBe(summary.title);
      expect(survey.draft.items[0].question.prompt).toBe(summary.previewPrompt);
      expect(survey.draft.description).toBe(surveyCreationCopy(locale).description);
      const blank = await app.inject({
        method: "POST",
        url: "/v1/surveys",
        headers,
        payload: { idempotencyKey: randomUUID(), locale },
      });
      expect(blank.json().survey.draft.title).toBe(surveyCreationCopy(locale).title);
      const retry = await app.inject({ method: "POST", url: "/v1/surveys", headers, payload });
      expect(retry.json()).toEqual(created.json());
      const changed = await app.inject({
        method: "POST",
        url: "/v1/surveys",
        headers,
        payload: { ...payload, locale: locale === "fr-FR" ? "ko-KR" : "fr-FR" },
      });
      expect(changed.statusCode, changed.body).toBe(409);
      expect(changed.json().error.code).toBe("IDEMPOTENCY_CONFLICT");
    }
    const payload = { idempotencyKey: randomUUID(), templateId: "training-feedback" };
    const original = await app.inject({ method: "POST", url: "/v1/surveys", headers, payload });
    const english = await app.inject({
      method: "POST",
      url: "/v1/surveys",
      headers,
      payload: { ...payload, locale: "en-CA" },
    });
    expect(english.json()).toEqual(original.json());
    const source = original.json().survey;
    const published = await app.inject({
      method: "POST",
      url: `/v1/surveys/${source.id}/publish`,
      headers,
      payload: { idempotencyKey: randomUUID(), expectedRevision: 0 },
    });
    expect(published.statusCode, published.body).toBe(200);
    const before = await app.inject({ method: "GET", url: `/v1/surveys/${source.id}`, headers });
    await app.inject({
      method: "PUT",
      url: "/v1/account/locale",
      headers,
      payload: { locale: "ko-KR" },
    });
    const copied = await app.inject({
      method: "POST",
      url: "/v1/surveys",
      headers,
      payload: { idempotencyKey: randomUUID(), sourceId: source.id, locale: "ko-KR" },
    });
    expect(copied.statusCode, copied.body).toBe(201);
    const draft = copied.json().survey.draft;
    expect(draft.title).toBe(`${source.draft.title} (사본)`);
    expect(draft.description).toBe(source.draft.description);
    expect(
      draft.items.map((item: { question: { prompt: string } }) => item.question.prompt),
    ).toEqual(
      source.draft.items.map((item: { question: { prompt: string } }) => item.question.prompt),
    );
    expect(
      (await app.inject({ method: "GET", url: `/v1/surveys/${source.id}`, headers })).json(),
    ).toEqual(before.json());
  });

  it("previews enhanced Survey questionnaires without writes and creates matching optional items in every locale", async () => {
    const { app, headers, repository } = await fixture();
    const withoutIds = (value: unknown) =>
      JSON.parse(
        JSON.stringify(value).replace(
          /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/giu,
          "<id>",
        ),
      );
    expect(
      (await app.inject({ method: "GET", url: "/v1/surveys/templates/event-feedback" })).statusCode,
    ).toBe(401);
    for (const locale of supportedLocales) {
      for (const id of [
        "project-kickoff",
        "event-feedback",
        "onboarding-experience",
        "service-experience",
        "learning-needs",
      ] as const) {
        const auditCount = repository.audits.length;
        const preview = await app.inject({
          method: "GET",
          url: `/v1/surveys/templates/${id}?locale=${locale}`,
          headers,
        });
        expect(preview.statusCode, preview.body).toBe(200);
        const projected = preview.json();
        expect(projected).toMatchObject({
          contentLocale: locale,
          contentVersion: STARTER_CONTENT_VERSION,
          guide: { minutes: 5 },
        });
        expect(projected.draft).toEqual(instantiateSurveyStarter(id, locale));
        expect(
          (
            await app.inject({
              method: "GET",
              url: `/v1/surveys/templates/${id}?locale=${locale}`,
              headers,
            })
          ).json(),
        ).toEqual(projected);
        expect(repository.audits).toHaveLength(auditCount);
        const payload = { idempotencyKey: randomUUID(), templateId: id, locale };
        const created = await app.inject({ method: "POST", url: "/v1/surveys", headers, payload });
        expect(created.statusCode, created.body).toBe(201);
        expect(withoutIds(created.json().survey.draft)).toEqual(withoutIds(projected.draft));
        expect(created.json().survey.draft.guide).toBeUndefined();
        expect(
          (await app.inject({ method: "POST", url: "/v1/surveys", headers, payload })).json(),
        ).toEqual(created.json());
        const cloned = await app.inject({
          method: "POST",
          url: "/v1/surveys",
          headers,
          payload: {
            idempotencyKey: randomUUID(),
            sourceId: created.json().survey.id,
            locale: "en-CA",
          },
        });
        expect(cloned.statusCode, cloned.body).toBe(201);
        const sourceDraft = created.json().survey.draft;
        const copyDraft = cloned.json().survey.draft;
        expect(copyDraft.title).toBe(`${sourceDraft.title} (copy)`);
        expect(withoutIds({ ...copyDraft, title: sourceDraft.title })).toEqual(
          withoutIds(sourceDraft),
        );
      }
      const round = await app.inject({
        method: "GET",
        url: `/v1/starters/source-evaluation?locale=${locale}`,
        headers,
      });
      expect(round.json().draft.questions).toHaveLength(6);
      expect(round.json().guide).toMatchObject({ minutes: 15 });
      expect(repository.audits.at(-1)?.action).toBe("survey.created");
    }
    expect(
      (await app.inject({ method: "GET", url: "/v1/surveys/templates/source-evaluation", headers }))
        .statusCode,
    ).toBe(422);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/surveys/templates/event-feedback?locale=fr-CA",
          headers,
        })
      ).statusCode,
    ).toBe(400);
  });

  it("rejects unknown, unsupported and ambiguous locale inputs before creating content", async () => {
    const { app, headers, repository } = await fixture();
    for (const url of [
      "/v1/starters?locale=fr-CA",
      "/v1/starters?locale=ko-KR&locale=fr-FR",
      "/v1/starters/exit-ticket?locale=unknown",
      "/v1/starters?extra=true",
      "/v1/surveys/templates?locale=unknown",
    ]) {
      expect((await app.inject({ method: "GET", url, headers })).statusCode, url).toBe(400);
    }
    for (const payload of [
      { locale: "unknown" },
      { locale: ["ko-KR"] },
      { locale: "fr-FR", extra: true },
    ]) {
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/v1/starters/exit-ticket/use",
            headers,
            payload,
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/v1/surveys",
            headers,
            payload: { idempotencyKey: randomUUID(), ...payload },
          })
        ).statusCode,
      ).toBe(400);
    }
    expect(
      repository.audits.filter(
        (entry) => entry.action === "starter.use" || entry.action === "survey.created",
      ),
    ).toHaveLength(0);
  });
});
