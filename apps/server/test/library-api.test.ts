import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRepository } from "@openround/db";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";

let app: FastifyInstance | undefined;
const BETA_WORKSPACE_ID = "10000000-0000-4000-8000-000000000005";

async function signIn(target: FastifyInstance, email: string) {
  const magic = await target.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: { email, segment: "workplace", acceptPolicies: true },
  });
  const token = new URL(magic.json<{ debugUrl: string }>().debugUrl).searchParams.get("token")!;
  const verified = await target.inject({ method: "GET", url: `/v1/auth/verify?token=${token}` });
  const setCookie = verified.headers["set-cookie"]!;
  return (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(";")[0]!;
}

afterEach(async () => {
  if (app) await app.close();
  app = undefined;
});

describe("Library metadata API", () => {
  it("permanently deletes archived content and removes its favorites", async () => {
    const built = await buildApp(
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        COMMUNITY_MODE: "false",
        WEB_ORIGIN: "http://localhost:3000",
        PUBLIC_API_URL: "http://localhost:4000",
        FEATURE_UX_BETA: "true",
        UX_BETA_WORKSPACE_ALLOWLIST: BETA_WORKSPACE_ID,
        FEATURE_WORKSPACE_SHELL: "true",
        FEATURE_PRESENTATIONS: "true",
        LOG_LEVEL: "silent",
      }),
      {
        repository: new MemoryRepository({ initialWorkspaceId: BETA_WORKSPACE_ID }),
        cache: new MemorySessionCache(),
      },
    );
    app = built.app;
    const cookie = await signIn(app, "library-delete-owner@example.com");

    for (const [artifactType, endpoint, field] of [
      ["round", "quizzes", "quiz"],
      ["presentation", "presentations", "presentation"],
    ] as const) {
      const created = await app.inject({
        method: "POST",
        url: `/v1/${endpoint}`,
        headers: { cookie },
        payload: { title: "Archived workshop", description: "" },
      });
      expect(created.statusCode).toBe(201);
      const id = created.json<Record<typeof field, { id: string }>>()[field].id;
      const active = await app.inject({
        method: "DELETE",
        url: `/v1/${endpoint}/${id}`,
        headers: { cookie },
      });
      expect(active.statusCode).toBe(409);
      expect(active.json()).toMatchObject({ error: { code: "ARTIFACT_NOT_ARCHIVED" } });

      const favorite = await app.inject({
        method: "PUT",
        url: `/v1/library/favorites/${artifactType}/${id}`,
        headers: { cookie },
        payload: { favorite: true },
      });
      expect(favorite.statusCode).toBe(200);
      const archived = await app.inject({
        method: "POST",
        url: `/v1/${endpoint}/${id}/archive`,
        headers: { cookie },
        payload: { archived: true },
      });
      expect(archived.statusCode).toBe(200);
      const deleted = await app.inject({
        method: "DELETE",
        url: `/v1/${endpoint}/${id}`,
        headers: { cookie },
      });
      expect(deleted.statusCode).toBe(204);
      const missing = await app.inject({
        method: "GET",
        url: `/v1/${endpoint}/${id}`,
        headers: { cookie },
      });
      expect(missing.statusCode).toBe(404);
    }

    const favorites = await app.inject({
      method: "GET",
      url: "/v1/library/favorites",
      headers: { cookie },
    });
    expect(favorites.json()).toEqual({ favorites: [] });
  });

  it("favorites both artifact types and organizes, archives, and restores Presentations", async () => {
    const built = await buildApp(
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        COMMUNITY_MODE: "false",
        WEB_ORIGIN: "http://localhost:3000",
        PUBLIC_API_URL: "http://localhost:4000",
        FEATURE_UX_BETA: "true",
        UX_BETA_WORKSPACE_ALLOWLIST: BETA_WORKSPACE_ID,
        FEATURE_WORKSPACE_SHELL: "true",
        FEATURE_PRESENTATIONS: "true",
        LOG_LEVEL: "silent",
      }),
      {
        repository: new MemoryRepository({ initialWorkspaceId: BETA_WORKSPACE_ID }),
        cache: new MemorySessionCache(),
      },
    );
    app = built.app;
    const cookie = await signIn(app, "library-owner@example.com");

    const round = await app.inject({
      method: "POST",
      url: "/v1/quizzes",
      headers: { cookie },
      payload: { title: "Recovery readiness", description: "" },
    });
    const roundId = round.json<{ quiz: { id: string } }>().quiz.id;
    const presentation = await app.inject({
      method: "POST",
      url: "/v1/presentations",
      headers: { cookie },
      payload: { title: "Safety briefing", description: "" },
    });
    const presentationId = presentation.json<{ presentation: { id: string } }>().presentation.id;

    for (const [artifactType, artifactId] of [
      ["round", roundId],
      ["presentation", presentationId],
    ] as const) {
      const favorited = await app.inject({
        method: "PUT",
        url: `/v1/library/favorites/${artifactType}/${artifactId}`,
        headers: { cookie },
        payload: { favorite: true },
      });
      expect(favorited.statusCode).toBe(200);
      expect(favorited.json()).toMatchObject({
        favorite: { artifactType, artifactId },
      });
    }

    const favorites = await app.inject({
      method: "GET",
      url: "/v1/library/favorites",
      headers: { cookie },
    });
    expect(favorites.statusCode).toBe(200);
    expect(favorites.headers["cache-control"]).toContain("no-store");
    expect(favorites.json<{ favorites: unknown[] }>().favorites).toHaveLength(2);

    const folder = await app.inject({
      method: "POST",
      url: "/v1/folders",
      headers: { cookie },
      payload: { name: "Leadership sessions", artifactType: "presentation" },
    });
    const folderId = folder.json<{ folder: { id: string } }>().folder.id;
    const organized = await app.inject({
      method: "PATCH",
      url: `/v1/presentations/${presentationId}/organization`,
      headers: { cookie },
      payload: { folderId },
    });
    expect(organized.statusCode).toBe(200);
    expect(organized.json()).toMatchObject({ presentation: { folderId } });

    const archived = await app.inject({
      method: "POST",
      url: `/v1/presentations/${presentationId}/archive`,
      headers: { cookie },
      payload: { archived: true },
    });
    expect(archived.json()).toMatchObject({ presentation: { status: "archived" } });
    const restored = await app.inject({
      method: "POST",
      url: `/v1/presentations/${presentationId}/archive`,
      headers: { cookie },
      payload: { archived: false },
    });
    expect(restored.json()).toMatchObject({ presentation: { status: "draft" } });

    const outsiderCookie = await signIn(app, "library-outsider@example.com");
    const hidden = await app.inject({
      method: "PUT",
      url: `/v1/library/favorites/presentation/${presentationId}`,
      headers: { cookie: outsiderCookie },
      payload: { favorite: true },
    });
    expect(hidden.statusCode).toBe(404);
  });
});
