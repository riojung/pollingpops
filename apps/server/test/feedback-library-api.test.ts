import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  MemoryRepository,
  createFeedbackRepository,
  feedbackCursor,
  parseFeedbackCursor,
} from "@openround/db";
import { buildApp } from "../src/app.js";
import { ConfigSchema } from "../src/config.js";
import { MemorySessionCache } from "../src/cache.js";

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});
async function signIn(target: FastifyInstance, email: string) {
  const requested = await target.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: { email, segment: "workplace", acceptPolicies: true },
  });
  const token = new URL(requested.json().debugUrl).searchParams.get("token");
  const verified = await target.inject({ url: `/v1/auth/verify?token=${token}` });
  return { cookie: String(verified.headers["set-cookie"]).split(";")[0]! };
}
async function fixture() {
  const workspaceId = randomUUID();
  const adminToken = "test-feedback-admin-token-not-a-production-secret";
  const config = ConfigSchema.parse({
    NODE_ENV: "test",
    ALLOW_IN_MEMORY: "true",
    COMMUNITY_MODE: "false",
    WEB_ORIGIN: "http://localhost:3000",
    PUBLIC_API_URL: "http://localhost:4000",
    LOG_LEVEL: "silent",
    ADMIN_TOKEN: adminToken,
    FEATURE_UX_BETA: "true",
    FEATURE_WORKSPACE_SHELL: "true",
    UX_BETA_WORKSPACE_ALLOWLIST: workspaceId,
    FEATURE_AUDIENCE_SCOPES: "true",
    FEATURE_FEEDBACK_ROOMS: "true",
    FEATURE_SURVEYS: "true",
    CORE_PARITY_WORKSPACE_ALLOWLIST: workspaceId,
  });
  const built = await buildApp(config, {
    repository: new MemoryRepository({ initialWorkspaceId: workspaceId }),
    cache: new MemorySessionCache(),
  });
  app = built.app;
  const headers = await signIn(app, "feedback-owner@example.com");
  return { app, headers, adminToken, repository: built.repository, workspaceId };
}
describe("feedback and Survey Library APIs", () => {
  it("does not charge concurrent new-key retries more than once", async () => {
    const { app, repository, headers, adminToken } = await fixture();
    const feedback = createFeedbackRepository(repository);
    const originalFind = feedback.find.bind(feedback);
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let arrived = 0;
    const find = vi.spyOn(feedback, "find").mockImplementation(async (...args) => {
      const prior = await originalFind(...args);
      if (++arrived === 10) release();
      await barrier;
      return prior;
    });
    const input = {
      idempotencyKey: randomUUID(),
      category: "bug",
      message: "Synthetic concurrent feedback retry",
      page: "/library",
    };
    const retries = await Promise.all(
      Array.from({ length: 10 }, () =>
        app.inject({ method: "POST", url: "/v1/feedback", headers, payload: input }),
      ),
    );
    find.mockRestore();
    expect(retries.every((row) => row.statusCode === 201 || row.statusCode === 200)).toBe(true);
    expect(new Set(retries.map((row) => row.json().feedbackId)).size).toBe(1);
    for (let index = 0; index < 4; index++) {
      const result = await app.inject({
        method: "POST",
        url: "/v1/feedback",
        headers,
        payload: { ...input, idempotencyKey: randomUUID() },
      });
      expect(result.statusCode, result.body).toBe(201);
    }
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/feedback",
          headers,
          payload: { ...input, idempotencyKey: randomUUID() },
        })
      ).statusCode,
    ).toBe(429);
    expect(
      (await app.inject({ method: "POST", url: "/v1/feedback", headers, payload: input }))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          url: "/v1/admin/feedback",
          headers: { authorization: `Bearer ${adminToken}` },
        })
      ).json().feedback,
    ).toHaveLength(5);
  });
  it("returns newest reports with opaque chronological cursors and rejects malformed cursors", async () => {
    const { app, repository, headers, workspaceId, adminToken } = await fixture();
    const account = await app.inject({ url: "/v1/auth/me", headers });
    expect(account.statusCode).toBe(200);
    const userId = account.json().creator.userId;
    const feedback = createFeedbackRepository(repository);
    const now = new Date();
    const rows = [];
    for (let index = 0; index < 4; index++)
      rows.push(
        await feedback.submit(
          workspaceId,
          userId,
          {
            idempotencyKey: randomUUID(),
            category: "idea",
            message: "Synthetic chronological feedback",
            page: "/library",
            allowContact: false,
          },
          new Date(now.getTime() - (3 - index) * 1000),
        ),
      );
    const admin = { authorization: `Bearer ${adminToken}` };
    const first = await app.inject({ url: "/v1/admin/feedback?limit=2", headers: admin });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().feedback.map((row: { id: string }) => row.id)).toEqual([
      rows[3]!.id,
      rows[2]!.id,
    ]);
    expect(parseFeedbackCursor(first.json().nextCursor)).toEqual({
      id: rows[2]!.id,
      createdAt: rows[2]!.createdAt,
    });
    const second = await app.inject({
      url: `/v1/admin/feedback?limit=2&cursor=${first.json().nextCursor}`,
      headers: admin,
    });
    expect(second.json().feedback.map((row: { id: string }) => row.id)).toEqual([
      rows[1]!.id,
      rows[0]!.id,
    ]);
    expect(second.json().nextCursor).toBeNull();
    const legacy = await app.inject({
      url: `/v1/admin/feedback?cursor=${rows[2]!.id}`,
      headers: admin,
    });
    expect(legacy.json().feedback.map((row: { id: string }) => row.id)).toEqual([
      rows[1]!.id,
      rows[0]!.id,
    ]);
    for (const cursor of [
      "not-a-cursor",
      randomUUID(),
      Buffer.from(
        JSON.stringify({ schemaVersion: 2, id: rows[2]!.id, createdAt: now.toISOString() }),
      ).toString("base64url"),
    ])
      expect(
        (await app.inject({ url: `/v1/admin/feedback?cursor=${cursor}`, headers: admin })).json()
          .error.code,
      ).toBe("INVALID_CURSOR");
    expect(feedbackCursor(rows[2]!)).toBe(first.json().nextCursor);
  });
  it("saves private feedback, preserves exact retries after limits, and restricts triage to administrators", async () => {
    const { app, headers, adminToken } = await fixture();
    const input = {
      idempotencyKey: randomUUID(),
      category: "bug",
      message: "The survey search did not return my draft.",
      page: "/surveys/private-id?token=secret",
      allowContact: false,
    };
    expect(
      (await app.inject({ method: "POST", url: "/v1/feedback", payload: input })).statusCode,
    ).toBe(401);
    const first = await app.inject({
      method: "POST",
      url: "/v1/feedback",
      headers,
      payload: input,
    });
    expect(first.statusCode, first.body).toBe(201);
    const results = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        app.inject({
          method: "POST",
          url: "/v1/feedback",
          headers,
          payload: { ...input, idempotencyKey: randomUUID(), allowContact: index === 0 },
        }),
      ),
    );
    expect(results.every((result) => result.statusCode === 201)).toBe(true);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/feedback",
          headers,
          payload: { ...input, idempotencyKey: randomUUID() },
        })
      ).statusCode,
    ).toBe(429);
    const retry = await app.inject({
      method: "POST",
      url: "/v1/feedback",
      headers,
      payload: input,
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toEqual(first.json());
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/feedback",
          headers,
          payload: { ...input, message: "Different feedback on the same retry key." },
        })
      ).statusCode,
    ).toBe(409);
    expect((await app.inject({ url: "/v1/admin/feedback", headers })).statusCode).toBe(401);
    const triage = await app.inject({
      url: "/v1/admin/feedback",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(triage.statusCode, triage.body).toBe(200);
    const rows = triage.json().feedback;
    expect(rows).toHaveLength(5);
    expect(rows.find((row: { id: string }) => row.id === first.json().feedbackId)).toMatchObject({
      page: "/surveys/:id",
      contactEmail: null,
    });
    expect(
      rows.filter(
        (row: { contactEmail: string | null }) => row.contactEmail === "feedback-owner@example.com",
      ),
    ).toHaveLength(1);
    expect(triage.body).not.toContain("secret");
    expect(triage.body).not.toContain("idempotencyKey");
    const page = await app.inject({
      url: "/v1/admin/feedback?limit=2",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const next = await app.inject({
      url: `/v1/admin/feedback?limit=2&cursor=${page.json().nextCursor}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(
      next
        .json()
        .feedback.every(
          (row: { id: string }) =>
            !page.json().feedback.some((previous: { id: string }) => previous.id === row.id),
        ),
    ).toBe(true);
  });
  it("rejects invalid feedback and cross-origin submissions without saving them", async () => {
    const { app, headers, adminToken } = await fixture();
    const input = {
      idempotencyKey: randomUUID(),
      category: "bug",
      message: "Synthetic issue report",
      page: "/library",
      allowContact: false,
    };
    for (const message of ["short", "x".repeat(4001), "invalid\u202econtrol"])
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/v1/feedback",
            headers,
            payload: { ...input, message },
          })
        ).statusCode,
      ).toBe(422);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/feedback",
          headers: { ...headers, origin: "https://untrusted.example" },
          payload: input,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          url: "/v1/admin/feedback",
          headers: { authorization: `Bearer ${adminToken}` },
        })
      ).json().feedback,
    ).toEqual([]);
  });
  it("organizes and favorites Surveys with revision fences and cross-workspace isolation", async () => {
    const { app, headers } = await fixture();
    const created = await app.inject({
      method: "POST",
      url: "/v1/surveys",
      headers,
      payload: { idempotencyKey: randomUUID(), title: "Library Survey" },
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().survey.id;
    const folder = await app.inject({
      method: "POST",
      url: "/v1/folders",
      headers,
      payload: { name: "Survey folder" },
    });
    expect(folder.statusCode, folder.body).toBe(201);
    const input = {
      folderId: folder.json().folder.id,
      expectedRevision: 0,
      idempotencyKey: randomUUID(),
    };
    const moved = await app.inject({
      method: "PATCH",
      url: `/v1/surveys/${id}/organization`,
      headers,
      payload: input,
    });
    expect(moved.statusCode, moved.body).toBe(200);
    expect(moved.json().survey).toMatchObject({ revision: 1, folderId: input.folderId });
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/v1/surveys/${id}/organization`,
          headers,
          payload: input,
        })
      ).json(),
    ).toEqual(moved.json());
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/v1/surveys/${id}/organization`,
          headers,
          payload: { ...input, idempotencyKey: randomUUID() },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/v1/library/favorites/survey/${id}`,
          headers,
          payload: { favorite: true },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ url: "/v1/library/favorites", headers })).json().favorites,
    ).toMatchObject([{ artifactType: "survey", artifactId: id }]);
    const foreign = await signIn(app, "other-feedback-workspace@example.com");
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/v1/surveys/${id}/organization`,
          headers: foreign,
          payload: { ...input, idempotencyKey: randomUUID() },
        })
      ).statusCode,
    ).toBe(404);
  });
});
