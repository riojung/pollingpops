import { verifyEmailAndSignIn } from "./support/email-auth.js";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MemoryRepository,
  createPlatformRepository,
  createPresentationRepository,
} from "@openround/db";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  if (app) await app.close();
  app = undefined;
  vi.restoreAllMocks();
});

async function fixture() {
  const workspaceId = randomUUID();
  const repository = new MemoryRepository({ initialWorkspaceId: workspaceId });
  const built = await buildApp(
    ConfigSchema.parse({
      NODE_ENV: "test",
      ALLOW_IN_MEMORY: "true",
      COMMUNITY_MODE: "false",
      FEATURE_UX_BETA: "true",
      UX_BETA_WORKSPACE_ALLOWLIST: workspaceId,
      FEATURE_PRESENTATIONS: "true",
      LOG_LEVEL: "silent",
    }),
    { repository, cache: new MemorySessionCache() },
  );
  app = built.app;
  const magic = await app.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: {
      email: "publication-telemetry@example.test",
      segment: "workplace",
      acceptPolicies: true,
    },
  });
  const token = new URL(magic.json<{ debugUrl: string }>().debugUrl).searchParams.get("token")!;
  const verified = await verifyEmailAndSignIn(
    app,
    `/v1/auth/verify?token=${token}`,
    "publication-telemetry@example.test",
  );
  const setCookie = verified.headers["set-cookie"]!;
  const cookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(";")[0]!;
  const policyRead = vi.spyOn(createPlatformRepository(repository), "getFeaturePolicy");
  const failedTelemetryPolicyRead = vi.fn(async () => {
    throw new Error("Telemetry policy unavailable");
  });
  return { ...built, repository, workspaceId, cookie, policyRead, failedTelemetryPolicyRead };
}

function question() {
  return {
    id: randomUUID(),
    type: "single_select",
    prompt: "Which state was persisted?",
    choices: [
      { id: randomUUID(), label: "Published", isCorrect: true },
      { id: randomUUID(), label: "Draft", isCorrect: false },
    ],
    purpose: "diagnostic",
    confidence: "optional",
    delivery: "main",
    conceptKeys: [],
    linkedRecheckQuestionId: null,
    timeLimitSeconds: 20,
    basePoints: 1000,
    explanation: "Publication remains authoritative when telemetry is unavailable.",
    mediaId: null,
    mediaAlt: null,
  };
}

describe("publication telemetry failure isolation", () => {
  it("returns the published Round and retains its audit when only the telemetry policy read fails", async () => {
    const f = await fixture();
    const created = await f.app.inject({
      method: "POST",
      url: "/v1/quizzes",
      headers: { cookie: f.cookie },
      payload: { title: "Publication telemetry", description: "" },
    });
    expect(created.statusCode).toBe(201);
    const quizId = created.json<{ quiz: { id: string } }>().quiz.id;
    const saved = await f.app.inject({
      method: "PATCH",
      url: `/v1/quizzes/${quizId}`,
      headers: { cookie: f.cookie },
      payload: {
        expectedDraftRevision: 0,
        draft: { title: "Publication telemetry", description: "", questions: [question()] },
      },
    });
    expect(saved.statusCode).toBe(200);
    const publish = f.repository.publishQuiz.bind(f.repository);
    vi.spyOn(f.repository, "publishQuiz").mockImplementation(async (...args) => {
      const version = await publish(...args);
      f.policyRead.mockImplementationOnce(f.failedTelemetryPolicyRead);
      return version;
    });

    const published = await f.app.inject({
      method: "POST",
      url: `/v1/quizzes/${quizId}/publish`,
      headers: { cookie: f.cookie },
      payload: { expectedDraftRevision: 1 },
    });

    expect(f.failedTelemetryPolicyRead).toHaveBeenCalledOnce();
    expect(published.statusCode).toBe(200);
    expect(published.headers.etag).toBe('"draft-1"');
    const version = published.json<{ version: { id: string; sourceDraftRevision: number } }>()
      .version;
    expect(version.sourceDraftRevision).toBe(1);
    expect(await f.repository.getQuiz(f.workspaceId, quizId)).toMatchObject({
      status: "published",
      currentVersionId: version.id,
    });
    expect(f.repository.audits).toContainEqual(
      expect.objectContaining({
        action: "quiz.publish",
        targetId: version.id,
        requestId: published.headers["x-request-id"],
      }),
    );
    await f.productEvents.drain();
    expect(f.repository.productEvents.filter((event) => event.name === "round_published")).toEqual(
      [],
    );
  });

  it("returns the published Presentation and writes its audit when only the telemetry policy read fails", async () => {
    const f = await fixture();
    const created = await f.app.inject({
      method: "POST",
      url: "/v1/presentations",
      headers: { cookie: f.cookie },
      payload: { title: "Publication telemetry", description: "" },
    });
    expect(created.statusCode).toBe(201);
    const presentationId = created.json<{ presentation: { id: string } }>().presentation.id;
    const saved = await f.app.inject({
      method: "PUT",
      url: `/v1/presentations/${presentationId}/draft`,
      headers: { cookie: f.cookie },
      payload: {
        expectedRevision: 0,
        mutationId: randomUUID(),
        schemaVersion: 2,
        draft: {
          title: "Publication telemetry",
          description: "",
          experiencePreset: { id: "focus", version: 1 },
          schemaVersion: 2,
          blocks: [{ id: randomUUID(), kind: "question", question: question() }],
        },
      },
    });
    expect(saved.statusCode).toBe(200);
    const presentations = createPresentationRepository(f.repository);
    const publish = presentations.publishPresentation.bind(presentations);
    vi.spyOn(presentations, "publishPresentation").mockImplementation(async (...args) => {
      const version = await publish(...args);
      f.policyRead.mockImplementationOnce(f.failedTelemetryPolicyRead);
      return version;
    });

    const published = await f.app.inject({
      method: "POST",
      url: `/v1/presentations/${presentationId}/publish`,
      headers: { cookie: f.cookie },
      payload: { expectedDraftRevision: 1 },
    });

    expect(f.failedTelemetryPolicyRead).toHaveBeenCalledOnce();
    expect(published.statusCode).toBe(200);
    expect(published.headers.etag).toBe('"draft-1"');
    const version = published.json<{ version: { id: string; sourceDraftRevision: number } }>()
      .version;
    expect(version.sourceDraftRevision).toBe(1);
    expect(published.json()).toMatchObject({ presentation: { status: "published" } });
    expect(await presentations.getPresentation(f.workspaceId, presentationId)).toMatchObject({
      status: "published",
      currentVersionId: version.id,
    });
    expect(f.repository.audits).toContainEqual(
      expect.objectContaining({
        action: "presentation.publish",
        targetId: version.id,
        requestId: published.headers["x-request-id"],
      }),
    );
    await f.productEvents.drain();
    expect(f.repository.productEvents.filter((event) => event.name === "round_published")).toEqual(
      [],
    );
  });
});
