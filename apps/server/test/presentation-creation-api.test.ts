import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRepository } from "@openround/db";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";
import { verifyEmailAndSignIn } from "./support/email-auth.js";

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});
async function fixture() {
  const workspaceId = "10000000-0000-4000-8000-000000000001";
  const repository = new MemoryRepository({ initialWorkspaceId: workspaceId });
  const built = await buildApp(
    ConfigSchema.parse({
      NODE_ENV: "test",
      ALLOW_IN_MEMORY: "true",
      COMMUNITY_MODE: "false",
      FEATURE_UX_BETA: "true",
      UX_BETA_WORKSPACE_ALLOWLIST: workspaceId,
      FEATURE_PRESENTATIONS: "true",
      AUTH_DEBUG_MAGIC_LINKS: "true",
      LOG_LEVEL: "silent",
    }),
    { repository, cache: new MemorySessionCache() },
  );
  app = built.app;
  const email = `creation-${randomUUID()}@example.com`;
  const magic = await app.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: { email, segment: "education", acceptPolicies: true },
  });
  const token = new URL(magic.json<{ debugUrl: string }>().debugUrl).searchParams.get("token")!;
  const verified = await verifyEmailAndSignIn(app, `/v1/auth/verify?token=${token}`, email);
  const setCookie = verified.headers["set-cookie"]!;
  const cookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(";")[0]!;
  const actor = [...repository.users.values()].find((user) => user.email === email)!;
  const request = {
    title: "Outline draft",
    initialSlide: "native" as const,
    creationRequestId: randomUUID(),
    creationContext: { actorId: actor.userId, workspaceId },
  };
  const post = (payload: unknown = request, url = "/v1/presentations/outline-drafts") =>
    app!.inject({
      method: "POST",
      url,
      headers: { cookie, "content-type": "application/json" },
      payload: JSON.stringify(payload),
    });
  return { ...built, repository, actor, request, post, cookie, workspaceId };
}
describe("stable presentation creation API", () => {
  it("creates once, recovers current edits with 200 and records no extra audit or allowance", async () => {
    const f = await fixture();
    const created = await f.post();
    expect(created.statusCode).toBe(201);
    const presentation = created.json().presentation;
    expect(presentation).toMatchObject({
      draftRevision: 0,
      status: "draft",
      currentVersionId: null,
      draft: { schemaVersion: 7, blocks: [{ kind: "content", scene: { schemaVersion: 3 } }] },
    });
    expect(created.headers["cache-control"]).toContain("no-store");
    const saved = await app!.inject({
      method: "PUT",
      url: `/v1/presentations/${presentation.id}/draft`,
      headers: { cookie: f.cookie },
      payload: {
        draft: { ...presentation.draft, title: "Manual title" },
        expectedRevision: 0,
        mutationId: randomUUID(),
        schemaVersion: 2,
      },
    });
    expect(saved.statusCode).toBe(200);
    const replay = await f.post({
      ...f.request,
      title: " Outline draft ",
      creationRequestId: f.request.creationRequestId.toUpperCase(),
      creationContext: {
        actorId: f.actor.userId.toUpperCase(),
        workspaceId: f.workspaceId.toUpperCase(),
      },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({
      presentation: { id: presentation.id, draftRevision: 1, title: "Manual title" },
    });
    expect(await f.presentations.listPresentations(f.workspaceId)).toHaveLength(1);
    expect(
      await f.presentations.listPresentationHistory(f.workspaceId, presentation.id),
    ).toHaveLength(2);
    expect(
      f.repository.audits.filter((audit) => audit.action === "presentation.create"),
    ).toHaveLength(1);
    expect(await f.repository.countAuthoringJobsSince(f.workspaceId, new Date(0))).toBe(0);
    expect((await f.post({ ...f.request, description: "Changed intent" })).statusCode).toBe(409);
  });
  it("rejects incomplete dedicated creation and stale contexts before any mutation", async () => {
    const f = await fixture();
    for (const payload of [
      { title: "Unkeyed" },
      { ...f.request, initialSlide: "classic" },
      { ...f.request, outline: "Do not store source during creation" },
    ])
      expect((await f.post(payload)).statusCode).toBe(400);
    for (const creationContext of [
      { ...f.request.creationContext, actorId: randomUUID() },
      { ...f.request.creationContext, workspaceId: randomUUID() },
    ])
      expect((await f.post({ ...f.request, creationContext })).statusCode).toBe(409);
    expect(await f.presentations.listPresentations(f.workspaceId)).toEqual([]);
  });
  it("preserves unkeyed creation and supports explicit stable keys on the original endpoint", async () => {
    const f = await fixture();
    const first = await f.post({ title: "Ordinary" }, "/v1/presentations"),
      second = await f.post({ title: "Ordinary" }, "/v1/presentations");
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(first.json().presentation.id).not.toBe(second.json().presentation.id);
    expect((await f.post(f.request, "/v1/presentations")).statusCode).toBe(201);
    expect((await f.post()).statusCode).toBe(200);
    expect(
      (
        await f.post(
          { title: "Missing context", creationRequestId: randomUUID() },
          "/v1/presentations",
        )
      ).statusCode,
    ).toBe(400);
  });
  it("returns 410 for deleted targets and rechecks current role on a replay", async () => {
    const f = await fixture();
    const created = await f.post(),
      id = created.json().presentation.id as string;
    await f.presentations.archivePresentation(f.workspaceId, id, true);
    expect((await f.post()).json().presentation.status).toBe("archived");
    expect(await f.presentations.deletePresentation(f.workspaceId, id)).toBe("deleted");
    expect((await f.post()).statusCode).toBe(410);
    const member = f.repository.workspaceMembers.get(`${f.workspaceId}:${f.actor.userId}`)!;
    member.role = "viewer";
    expect((await f.post()).statusCode).toBe(403);
    expect(await f.presentations.listPresentations(f.workspaceId, true)).toEqual([]);
  });
});
