import { verifyEmailAndSignIn } from "./support/email-auth.js";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { QuizDraft } from "@openround/contracts";
import type { JWTPayload } from "jose";
import type { FastifyInstance } from "fastify";
import type { LtiRegistrationRecord } from "@openround/db";
import { MemoryRepository } from "@openround/db";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";
import type { LtiJwtAdapter } from "../src/lti-service.js";

const CLAIM = "https://purl.imsglobal.org/spec/lti/claim";
const DL_CLAIM = "https://purl.imsglobal.org/spec/lti-dl/claim";

class FakeLtiJwtAdapter implements LtiJwtAdapter {
  payload: JWTPayload = {};

  async verify(_idToken: string, _registration: LtiRegistrationRecord) {
    return structuredClone(this.payload);
  }

  async sign() {
    return "signed-response";
  }

  async publicJwks() {
    return { keys: [{ kty: "RSA", kid: "test", n: "public", e: "AQAB" }] };
  }
}

async function signIn(app: FastifyInstance) {
  const requested = await app.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: { email: "lti-owner@example.edu", segment: "education", acceptPolicies: true },
  });
  const token = new URL(requested.json<{ debugUrl: string }>().debugUrl).searchParams.get("token")!;
  const verified = await verifyEmailAndSignIn(
    app,
    `/v1/auth/verify?token=${token}`,
    "lti-owner@example.edu",
  );
  const setCookie = verified.headers["set-cookie"]!;
  return (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(";")[0]!;
}

async function publishedQuiz(repository: MemoryRepository, workspaceId: string, title: string) {
  const quizId = randomUUID();
  const now = new Date();
  const draft: QuizDraft = {
    title,
    description: "LMS Deep Linking test",
    questions: [
      {
        id: randomUUID(),
        type: "numeric",
        prompt: "How many evidence sources were reviewed?",
        purpose: "diagnostic",
        confidence: "off",
        delivery: "main",
        conceptKeys: ["evidence"],
        linkedRecheckQuestionId: null,
        correctValue: "2",
        tolerance: "0",
        unit: null,
        timeLimitSeconds: 20,
        basePoints: 1_000,
        explanation: "The review used two evidence sources.",
        mediaId: null,
        mediaAlt: null,
      },
    ],
  };
  await repository.createQuiz({
    id: quizId,
    workspaceId,
    title,
    description: draft.description,
    status: "draft",
    draft,
    currentVersionId: null,
    folderId: null,
    tags: [],
    createdAt: now,
    updatedAt: now,
  });
  await repository.publishQuiz({
    id: randomUUID(),
    workspaceId,
    quizId,
    version: 1,
    content: draft,
    contentHash: randomUUID(),
    publishedAt: now,
  });
  return quizId;
}

describe("LTI HTTP protocol", () => {
  it("accepts cross-origin form posts only through one-time state and verified launch claims", async () => {
    const repository = new MemoryRepository();
    const jwt = new FakeLtiJwtAdapter();
    const adminToken = "lti-admin-token-123456789012";
    const built = await buildApp(
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        WEB_ORIGIN: "http://localhost:3000",
        PUBLIC_API_URL: "http://localhost:4000",
        LOG_LEVEL: "silent",
        ADMIN_TOKEN: adminToken,
        LTI_MODE: "tool",
        LTI_TOOL_PRIVATE_JWK: "{}",
      }),
      { repository, cache: new MemorySessionCache(), ltiJwtAdapter: jwt },
    );
    const app = built.app;
    try {
      const cookie = await signIn(app);
      const me = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } });
      const workspaceId = me.json<{ creator: { workspaceId: string } }>().creator.workspaceId;
      const capabilities = {
        oidc: false,
        managedSso: false,
        scim: false,
        lti: true,
        nrps: false,
        ags: false,
        auditExports: true,
        residencyControls: true,
      };
      expect(
        (
          await app.inject({
            method: "PUT",
            url: `/v1/admin/workspaces/${workspaceId}/institution-policy`,
            headers: { authorization: `Bearer ${adminToken}` },
            payload: {
              contractStatus: "pilot",
              identityRequirement: "optional",
              capabilities,
              k12Enabled: false,
            },
          })
        ).statusCode,
      ).toBe(200);
      const registered = await app.inject({
        method: "POST",
        url: `/v1/admin/workspaces/${workspaceId}/lti-registrations`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: "Example LMS",
          issuer: "https://lms.example.edu",
          clientId: "openround-client",
          deploymentId: "deployment-1",
          authorizationEndpoint: "https://lms.example.edu/oidc/auth",
          tokenEndpoint: "https://lms.example.edu/oauth/token",
          jwksUrl: "https://lms.example.edu/.well-known/jwks.json",
          deepLinkReturnOrigins: ["https://lms.example.edu"],
          status: "active",
        },
      });
      expect(registered.statusCode).toBe(201);

      const loginBody = new URLSearchParams({
        iss: "https://lms.example.edu",
        client_id: "openround-client",
        lti_deployment_id: "deployment-1",
        login_hint: "login-hint",
        lti_message_hint: "message-hint",
        target_link_uri: "http://localhost:4000/v1/lti/launch",
      });
      const login = await app.inject({
        method: "POST",
        url: "/v1/lti/login",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://lms.example.edu",
        },
        payload: loginBody.toString(),
      });
      expect(login.statusCode).toBe(302);
      const authorizationUrl = new URL(login.headers.location!);
      const state = authorizationUrl.searchParams.get("state")!;
      jwt.payload = {
        iss: "https://lms.example.edu",
        sub: "lti-instructor",
        aud: "openround-client",
        nonce: authorizationUrl.searchParams.get("nonce")!,
        [`${CLAIM}/deployment_id`]: "deployment-1",
        [`${CLAIM}/version`]: "1.3.0",
        [`${CLAIM}/message_type`]: "LtiDeepLinkingRequest",
        [`${CLAIM}/target_link_uri`]: "http://localhost:4000/v1/lti/launch",
        [`${CLAIM}/roles`]: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor"],
        [`${DL_CLAIM}/deep_linking_settings`]: {
          deep_link_return_url: "https://lms.example.edu/deep-links/return",
          accept_types: ["ltiResourceLink"],
          accept_presentation_document_targets: ["window"],
        },
      };
      const launchBody = new URLSearchParams({ state, id_token: "signed-platform-token" });
      const launch = await app.inject({
        method: "POST",
        url: "/v1/lti/launch",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://lms.example.edu",
        },
        payload: launchBody.toString(),
      });
      expect(launch.statusCode).toBe(302);
      expect(launch.headers.location).toMatch(/^http:\/\/localhost:3000\/lti\/link#token=/);
      const linkToken = new URL(launch.headers.location!).hash.slice("#token=".length);
      const bound = await app.inject({
        method: "POST",
        url: "/v1/lti/link",
        headers: { cookie },
        payload: { token: decodeURIComponent(linkToken) },
      });
      expect(bound.statusCode).toBe(200);
      const boundBody = bound.json<{
        launch: { id: string; messageType: string; role: string };
        destination: string;
      }>();
      expect(boundBody).toMatchObject({
        launch: { messageType: "LtiDeepLinkingRequest", role: "instructor" },
        destination: expect.stringMatching(/^\/lti\/select\?launchId=/),
      });

      const firstQuizId = await publishedQuiz(repository, workspaceId, "First selection");
      const retryQuizId = await publishedQuiz(repository, workspaceId, "Retry selection");
      const deepLink = await app.inject({
        method: "POST",
        url: `/v1/lti/launches/${boundBody.launch.id}/deep-link`,
        headers: { cookie },
        payload: { quizId: firstQuizId },
      });
      expect(deepLink.statusCode).toBe(200);
      expect(deepLink.json()).toMatchObject({
        returnUrl: "https://lms.example.edu/deep-links/return",
        jwt: "signed-response",
        quizId: firstQuizId,
      });
      const retry = await app.inject({
        method: "POST",
        url: `/v1/lti/launches/${boundBody.launch.id}/deep-link`,
        headers: { cookie },
        payload: { quizId: retryQuizId },
      });
      expect(retry.statusCode).toBe(200);
      expect(retry.json()).toEqual(deepLink.json());
      expect(
        (await repository.listAuditEvents(workspaceId, null, 1_000))
          .filter((event) => event.action === "lti.deep_link.create")
          .map((event) => event.targetId),
      ).toEqual([firstQuizId, firstQuizId]);

      const replay = await app.inject({
        method: "POST",
        url: "/v1/lti/launch",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://lms.example.edu",
        },
        payload: launchBody.toString(),
      });
      expect(replay.statusCode).toBe(400);
      expect(replay.json()).toMatchObject({ error: { code: "LTI_LAUNCH_INVALID" } });

      const jwks = await app.inject({ method: "GET", url: "/v1/lti/jwks" });
      expect(jwks.statusCode).toBe(200);
      expect(jwks.json()).toMatchObject({ keys: [{ kid: "test" }] });
    } finally {
      await app.close();
    }
  });
});
