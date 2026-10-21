import { verifyEmailAndSignIn } from "./support/email-auth.js";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  ApiErrorSchema,
  PresentationContentSchema,
  PresentationDraftSchema,
} from "@openround/contracts";
import {
  MemoryRepository,
  createPresentationRepository,
  createPresentationSessionRepository,
} from "@openround/db";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function fixture() {
  const workspaceId = randomUUID();
  const repository = new MemoryRepository({ initialWorkspaceId: workspaceId });
  const config = ConfigSchema.parse({
    NODE_ENV: "test",
    ALLOW_IN_MEMORY: "true",
    COMMUNITY_MODE: "false",
    FEATURE_UX_BETA: "true",
    UX_BETA_WORKSPACE_ALLOWLIST: workspaceId,
    FEATURE_PRESENTATIONS: "true",
    FEATURE_PRESENTATION_REALTIME: "true",
    EVIDENCE_FEATURES_WORKSPACE_ALLOWLIST: workspaceId,
    LOG_LEVEL: "silent",
  });
  const built = await buildApp(config, { repository, cache: new MemorySessionCache() });
  app = built.app;
  const magic = await app.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: { email: "protected-room@example.test", segment: "workplace", acceptPolicies: true },
  });
  const token = new URL(magic.json().debugUrl).searchParams.get("token")!;
  const verified = await verifyEmailAndSignIn(
    app,
    `/v1/auth/verify?token=${token}`,
    "protected-room@example.test",
  );
  const headers = { cookie: String(verified.headers["set-cookie"]).split(";")[0]! };
  const actor = (await app.inject({ method: "GET", url: "/v1/auth/me", headers })).json().creator;
  const now = new Date();
  const quizId = randomUUID();
  const quiz = {
    title: "Password admission fixture",
    description: "",
    questions: [
      {
        id: randomUUID(),
        type: "true_false" as const,
        prompt: "Admission is required?",
        choices: [
          { id: randomUUID(), label: "True", isCorrect: true },
          { id: randomUUID(), label: "False", isCorrect: false },
        ],
        timeLimitSeconds: 20,
        basePoints: 100,
        explanation: "",
        mediaId: null,
        mediaAlt: null,
      },
    ],
  };
  await repository.createQuiz({
    id: quizId,
    workspaceId,
    title: quiz.title,
    description: "",
    draft: quiz,
    status: "draft",
    currentVersionId: null,
    createdAt: now,
    updatedAt: now,
  });
  await repository.publishQuiz({
    id: randomUUID(),
    workspaceId,
    quizId,
    version: 1,
    content: quiz,
    contentHash: randomUUID(),
    publishedAt: now,
  });
  const presentationId = randomUUID();
  const presentations = createPresentationRepository(repository);
  const draft = PresentationDraftSchema.parse({
    title: quiz.title,
    description: "",
    schemaVersion: 2,
    experiencePreset: { id: "focus", version: 1 },
    blocks: [{ id: randomUUID(), kind: "question", question: quiz.questions[0] }],
  });
  await presentations.createPresentation({
    id: presentationId,
    workspaceId,
    title: draft.title,
    description: "",
    status: "draft",
    draft,
    draftRevision: 0,
    draftSchemaVersion: 2,
    currentVersionId: null,
    folderId: null,
    publishedDraftRevision: null,
    lastEditedBy: actor.userId,
    createdAt: now,
    updatedAt: now,
  });
  await presentations.publishPresentation(
    {
      id: randomUUID(),
      workspaceId,
      presentationId,
      version: 1,
      content: PresentationContentSchema.parse(draft),
      contentSchemaVersion: 1,
      contentHash: randomUUID(),
      sourceDraftRevision: 0,
      publishedAt: now,
    },
    0,
  );
  return { app, repository, workspaceId, headers, quizId, presentationId };
}

describe("protected live room HTTP admission", () => {
  it.each(["round", "presentation"] as const)(
    "enforces %s creation and admission without revealing room credentials",
    async (kind) => {
      const f = await fixture();
      const route = kind === "round" ? "/v1/sessions" : "/v1/presentation-sessions";
      const createInput =
        kind === "round"
          ? {
              quizId: f.quizId,
              settings: {
                audienceLimit: 20,
                scoringMode: "accuracy",
                resultVisibility: "private",
                allowLateJoin: true,
                nicknamePolicy: "custom",
              },
            }
          : { presentationId: f.presentationId };
      const password = " Private room password ";
      const denied = await f.app.inject({
        method: "POST",
        url: route,
        headers: f.headers,
        payload: { ...createInput, joinPassword: password },
      });
      expect(denied.statusCode, denied.body).toBe(402);
      expect(denied.json().error.code).toBe("ENTITLEMENT_LIMIT");
      const open = await f.app.inject({
        method: "POST",
        url: route,
        headers: f.headers,
        payload: createInput,
      });
      expect(open.statusCode, open.body).toBe(201);
      const openCode = open.json().code ?? open.json().snapshot.code;
      const openJoin = await f.app.inject({
        method: "POST",
        url: `${route}/join`,
        payload: { code: openCode, nickname: "Open learner" },
      });
      expect(openJoin.statusCode, openJoin.body).toBe(201);
      await f.repository.setPlan(f.workspaceId, "pro");
      const hosted = await f.app.inject({
        method: "POST",
        url: route,
        headers: f.headers,
        payload: { ...createInput, joinPassword: password },
      });
      expect(hosted.statusCode, hosted.body).toBe(201);
      const code = hosted.json().code ?? hosted.json().snapshot.code;
      const sessionId = hosted.json().sessionId ?? hosted.json().snapshot.sessionId;
      const preflight = await f.app.inject({
        method: "GET",
        url: `/v1/live-rooms/join/preflight?code=${code}`,
      });
      expect(preflight.json()).toMatchObject({ artifactType: kind, passwordRequired: true });
      for (const [supplied, expected] of [
        [undefined, "PASSWORD_REQUIRED"],
        [password.trim(), "INVALID_PASSWORD"],
      ] as const) {
        const deniedJoin = await f.app.inject({
          method: "POST",
          url: `${route}/join`,
          payload: {
            code,
            nickname: "New learner",
            ...(supplied === undefined ? {} : { password: supplied }),
          },
        });
        expect(deniedJoin.statusCode, deniedJoin.body).toBe(401);
        expect(ApiErrorSchema.parse(deniedJoin.json()).error.code).toBe(expected);
      }
      const participants =
        kind === "round"
          ? await f.repository.getParticipants(sessionId)
          : await createPresentationSessionRepository(f.repository).listParticipants(sessionId);
      expect(participants).toHaveLength(0);
      const admitted = await f.app.inject({
        method: "POST",
        url: `${route}/join`,
        payload: { code, nickname: "Admitted learner", password },
      });
      expect(admitted.statusCode, admitted.body).toBe(201);
      await f.repository.setPlan(f.workspaceId, "free");
      const stillProtected = await f.app.inject({
        method: "POST",
        url: `${route}/join`,
        payload: { code, nickname: "Next learner" },
      });
      expect(ApiErrorSchema.parse(stillProtected.json()).error.code).toBe("PASSWORD_REQUIRED");
      const recovered =
        kind === "round"
          ? await f.app.inject({
              method: "POST",
              url: `${route}/join`,
              payload: { code, resumeToken: admitted.json().participantToken },
            })
          : await f.app.inject({
              method: "GET",
              url: `${route}/${sessionId}/participant`,
              headers: { authorization: `Bearer ${admitted.json().participantToken}` },
            });
      expect(recovered.statusCode, recovered.body).toBe(kind === "round" ? 201 : 200);
      for (const response of [denied, open, openJoin, hosted, preflight, admitted, recovered]) {
        expect(response.body).not.toContain(password);
        expect(response.body).not.toContain("joinPasswordHash");
        expect(response.body).not.toContain("scrypt$");
      }
    },
  );
});
