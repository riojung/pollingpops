import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LibraryItemsResponseSchema } from "@openround/contracts";
import {
  LibraryDiscoveryAuthorizationError,
  LibraryDiscoveryCursorError,
  MemoryRepository,
  type CreatorContext,
  type LibraryDiscoveryRepository,
} from "@openround/db";
import type { AuthService } from "../src/auth.js";
import { registerLibraryDiscoveryRoutes } from "../src/library-discovery-routes.js";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";
import { signInFromVerificationResponse } from "./support/email-auth.js";

let app: FastifyInstance;
afterEach(async () => {
  await app?.close();
});
const creator: CreatorContext = {
  userId: "10000000-0000-4000-8000-000000000001",
  workspaceId: "10000000-0000-4000-8000-000000000002",
  email: "library@example.test",
  locale: "en-CA",
  localePreferenceSet: true,
  segment: "workplace",
  role: "viewer",
  plan: "free",
};
const empty = {
  items: [],
  nextCursor: null,
  facets: {
    kinds: { round: 0, presentation: 0, survey: 0 },
    statuses: { draft: 0, published: 0, archived: 0 },
    total: 0,
  },
};

async function setup() {
  app = Fastify();
  const state = {
    creator: creator as CreatorContext | null,
    workspace: true,
  };
  const auth: Pick<AuthService, "requireCreator"> = {
    requireCreator: vi.fn(async (_request, reply) => {
      if (!state.creator) {
        reply.code(401).send({ error: { code: "UNAUTHORIZED" } });
        return null;
      }
      return state.creator;
    }),
  };
  const discovery: LibraryDiscoveryRepository = { list: vi.fn(async () => structuredClone(empty)) };
  await registerLibraryDiscoveryRoutes(app, {
    discovery,
    auth,
    workspaceEnabled: () => state.workspace,
  });
  return { state, auth, discovery };
}

describe("Library discovery API boundary", () => {
  it("keeps retained content, full search, facets and cursors readable when creation is paused", async () => {
    const workspaceId = randomUUID();
    const config = ConfigSchema.parse({
      NODE_ENV: "test",
      ALLOW_IN_MEMORY: "true",
      COMMUNITY_MODE: "false",
      WEB_ORIGIN: "http://localhost:3000",
      PUBLIC_API_URL: "http://localhost:4000",
      FEATURE_UX_BETA: "true",
      UX_BETA_WORKSPACE_ALLOWLIST: workspaceId,
      CORE_PARITY_WORKSPACE_ALLOWLIST: workspaceId,
      FEATURE_PRESENTATIONS: "true",
      FEATURE_AUDIENCE_SCOPES: "true",
      FEATURE_FEEDBACK_ROOMS: "true",
      FEATURE_SURVEYS: "true",
      LOG_LEVEL: "silent",
    });
    const built = await buildApp(config, {
      repository: new MemoryRepository({ initialWorkspaceId: workspaceId }),
      cache: new MemorySessionCache(),
      mailer: {
        sendAccountVerification: async () => undefined,
        sendSignInPin: async () => undefined,
        sendWorkspaceInvitation: async () => undefined,
      },
    });
    app = built.app;
    const email = "library-retained-owner@example.test";
    const registration = await app.inject({
      method: "POST",
      url: "/v1/auth/magic-link",
      payload: { email, segment: "workplace", acceptPolicies: true },
    });
    const signedIn = await signInFromVerificationResponse(app, registration, email);
    const cookies = signedIn.headers["set-cookie"]!;
    const headers = { cookie: (Array.isArray(cookies) ? cookies[0]! : cookies).split(";")[0]! };
    const retained: Array<{ kind: string; endpoint: string; id: string }> = [];
    for (const [kind, endpoint, field, title] of [
      ["round", "quizzes", "quiz", "Retained Alpha Round"],
      ["presentation", "presentations", "presentation", "Retained Beta Presentation"],
      ["survey", "surveys", "survey", "Retained Gamma Survey"],
    ] as const) {
      const created = await app.inject({
        method: "POST",
        url: `/v1/${endpoint}`,
        headers,
        payload:
          kind === "survey"
            ? { title, idempotencyKey: randomUUID() }
            : { title, description: "Retained metadata" },
      });
      expect(created.statusCode, created.body).toBe(201);
      retained.push({ kind, endpoint, id: created.json()[field].id });
    }
    const query = "q=Retained&sort=title_asc&limit=1";
    const beforePause = await app.inject({ url: `/v1/library/items?${query}`, headers });
    expect(beforePause.statusCode, beforePause.body).toBe(200);
    const first = LibraryItemsResponseSchema.parse(beforePause.json());
    expect(first.items.map((item) => item.artifactType)).toEqual(["round"]);
    expect(first.nextCursor).not.toBeNull();

    config.FEATURE_PRESENTATIONS = false;
    config.FEATURE_SURVEYS = false;
    for (const item of retained) {
      const list = await app.inject({ url: `/v1/${item.endpoint}`, headers });
      const detail = await app.inject({ url: `/v1/${item.endpoint}/${item.id}`, headers });
      expect(list.statusCode, list.body).toBe(200);
      expect(detail.statusCode, detail.body).toBe(200);
    }
    for (const endpoint of ["presentations", "surveys"]) {
      const created = await app.inject({
        method: "POST",
        url: `/v1/${endpoint}`,
        headers,
        payload:
          endpoint === "surveys"
            ? { title: "Paused", idempotencyKey: randomUUID() }
            : { title: "Paused", description: "" },
      });
      expect(created.statusCode, created.body).toBe(404);
    }

    const found = [...first.items];
    let cursor = first.nextCursor;
    while (cursor) {
      const response = await app.inject({
        url: `/v1/library/items?${query}&cursor=${cursor}`,
        headers,
      });
      expect(response.statusCode, response.body).toBe(200);
      const page = LibraryItemsResponseSchema.parse(response.json());
      expect(page.facets).toEqual({
        kinds: { round: 1, presentation: 1, survey: 1 },
        statuses: { draft: 3, published: 0, archived: 0 },
        total: 3,
      });
      found.push(...page.items);
      cursor = page.nextCursor;
    }
    expect(found.map((item) => ({ kind: item.artifactType, id: item.id }))).toEqual(
      retained.map(({ kind, id }) => ({ kind, id })),
    );
    for (const kind of ["presentation", "survey"]) {
      const response = await app.inject({
        url: `/v1/library/items?q=Retained&kind=${kind}`,
        headers,
      });
      expect(response.statusCode, response.body).toBe(200);
      const result = LibraryItemsResponseSchema.parse(response.json());
      expect(result.items.map((item) => item.artifactType)).toEqual([kind]);
      expect(result.facets.total).toBe(1);
      expect(result.facets.kinds).toEqual({ round: 1, presentation: 1, survey: 1 });
    }
  });

  it("accepts bounded filters and derives actor and active workspace from current auth", async () => {
    const { state, auth, discovery } = await setup();
    const result = await app.inject(
      "/v1/library/items?q=%20Needle%20&favorites=false&limit=100&folder=unfiled&sort=title_desc",
    );
    expect(result.statusCode).toBe(200);
    expect(LibraryItemsResponseSchema.safeParse(result.json()).success).toBe(true);
    expect(result.headers["cache-control"]).toBe("private, no-store");
    expect(result.headers.pragma).toBe("no-cache");
    expect(discovery.list).toHaveBeenLastCalledWith({
      userId: creator.userId,
      workspaceId: creator.workspaceId,
      allowedKinds: ["round", "presentation", "survey"],
      query: {
        q: "Needle",
        favorites: false,
        folder: "unfiled",
        kind: "all",
        status: "active",
        sort: "title_desc",
        limit: 100,
      },
    });
    state.creator = {
      ...creator,
      userId: "10000000-0000-4000-8000-000000000003",
      workspaceId: "10000000-0000-4000-8000-000000000004",
    };
    expect((await app.inject("/v1/library/items")).statusCode).toBe(200);
    expect(discovery.list).toHaveBeenLastCalledWith(
      expect.objectContaining({
        userId: state.creator.userId,
        workspaceId: state.creator.workspaceId,
        allowedKinds: ["round", "presentation", "survey"],
      }),
    );
    expect(auth.requireCreator).toHaveBeenCalledTimes(2);
  });

  it("rejects invalid query values and cannot select arbitrary workspace scope", async () => {
    const { discovery } = await setup();
    for (const query of [
      "limit=101",
      "limit=0",
      "favorites=0",
      "kind=board",
      "status=unknown",
      "cursor=bad%3D",
      "q=%00",
      `q=${"x".repeat(161)}`,
      `workspaceId=${creator.workspaceId}`,
      "favorites=true&favorites=false",
    ]) {
      const result = await app.inject(`/v1/library/items?${query}`);
      expect(result.statusCode).toBe(400);
      expect(result.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
      expect(result.headers["cache-control"]).toContain("no-store");
    }
    expect(discovery.list).not.toHaveBeenCalled();
  });

  it("checks current sign-in and workspace gate before discovery", async () => {
    const { state, auth, discovery } = await setup();
    state.workspace = false;
    expect((await app.inject("/v1/library/items")).statusCode).toBe(404);
    state.workspace = true;
    state.creator = null;
    expect((await app.inject("/v1/library/items")).statusCode).toBe(401);
    expect(auth.requireCreator).toHaveBeenCalledTimes(2);
    expect(discovery.list).not.toHaveBeenCalled();
  });

  it("returns explicit validation and current-authority errors from the repository", async () => {
    const { discovery } = await setup();
    vi.mocked(discovery.list).mockRejectedValueOnce(new LibraryDiscoveryCursorError());
    const invalid = await app.inject("/v1/library/items?cursor=YWJj");
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    vi.mocked(discovery.list).mockRejectedValueOnce(new LibraryDiscoveryAuthorizationError());
    const revoked = await app.inject("/v1/library/items");
    expect(revoked.statusCode).toBe(403);
    expect(revoked.json()).toMatchObject({ error: { code: "UNAUTHORIZED" } });
  });
});
