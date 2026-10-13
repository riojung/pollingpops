import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { MemoryRepository } from "@openround/db";
import { buildApp } from "../src/app.js";
import { ConfigSchema } from "../src/config.js";
import { MemorySessionCache } from "../src/cache.js";

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});
async function signIn(target: FastifyInstance) {
  const magic = await target.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: { email: `${randomUUID()}@example.com`, segment: "workplace", acceptPolicies: true },
  });
  const token = new URL(magic.json().debugUrl).searchParams.get("token");
  const verified = await target.inject({ url: `/v1/auth/verify?token=${token}` });
  return String(verified.headers["set-cookie"]).split(";")[0]!;
}
async function fixture() {
  const workspaceId = randomUUID();
  const built = await buildApp(
    ConfigSchema.parse({
      NODE_ENV: "test",
      ALLOW_IN_MEMORY: "true",
      COMMUNITY_MODE: "false",
      WEB_ORIGIN: "http://localhost:3000",
      PUBLIC_API_URL: "http://localhost:4000",
      LOG_LEVEL: "silent",
      FEATURE_UX_BETA: "true",
      FEATURE_WORKSPACE_SHELL: "true",
      UX_BETA_WORKSPACE_ALLOWLIST: workspaceId,
      FEATURE_PRESENTATIONS: "true",
      FEATURE_AUDIENCE_SCOPES: "true",
      FEATURE_FEEDBACK_ROOMS: "true",
      FEATURE_SURVEYS: "true",
      CORE_PARITY_WORKSPACE_ALLOWLIST: workspaceId,
    }),
    {
      repository: new MemoryRepository({ initialWorkspaceId: workspaceId }),
      cache: new MemorySessionCache(),
    },
  );
  app = built.app;
  const cookie = await signIn(app);
  return { app, cookie, repository: built.repository, workspaceId };
}
describe("scoped folder API", () => {
  it("preserves another editor's current tags during a folder-only Round move and supports explicit clearing", async () => {
    const { app, cookie, repository, workspaceId } = await fixture();
    const folder = (
      await app.inject({
        method: "POST",
        url: "/v1/folders",
        headers: { cookie },
        payload: { name: "Destination" },
      })
    ).json().folder;
    const quiz = (
      await app.inject({
        method: "POST",
        url: "/v1/quizzes",
        headers: { cookie },
        payload: { title: "Concurrent tag edits", description: "" },
      })
    ).json().quiz;
    const staleRound = (
      await app.inject({ url: `/v1/quizzes/${quiz.id}`, headers: { cookie } })
    ).json().quiz;
    const invitation = await app.inject({
      method: "POST",
      url: "/v1/workspace/invitations",
      headers: { cookie },
      payload: { email: `${randomUUID()}@example.com`, role: "editor" },
    });
    const token = new URL(invitation.json().debugUrl).searchParams.get("token");
    const accepted = await app.inject({
      method: "POST",
      url: "/v1/invitations/accept",
      payload: { token, acceptPolicies: true },
    });
    const editorCookie = String(accepted.headers["set-cookie"]).split(";")[0]!;
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/v1/quizzes/${quiz.id}/organization`,
          headers: { cookie: editorCookie },
          payload: { folderId: null, tags: ["Updated by editor"] },
        })
      ).statusCode,
    ).toBe(200);
    expect(staleRound.tags).toEqual([]);
    const moved = await app.inject({
      method: "PATCH",
      url: `/v1/quizzes/${quiz.id}/organization`,
      headers: { cookie },
      payload: { folderId: folder.id },
    });
    expect(moved.statusCode, moved.body).toBe(200);
    expect(moved.json()).toMatchObject({
      quiz: { folderId: folder.id, tags: ["Updated by editor"] },
    });
    expect(await repository.getQuiz(workspaceId, quiz.id)).toMatchObject({
      folderId: folder.id,
      tags: ["Updated by editor"],
    });
    expect(
      (await repository.listAuditEvents(workspaceId, null, 100)).filter(
        (event) => event.action === "quiz.organize" && event.targetId === quiz.id,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metadata: { folderId: folder.id, tags: ["Updated by editor"] },
        }),
      ]),
    );
    const cleared = await app.inject({
      method: "PATCH",
      url: `/v1/quizzes/${quiz.id}/organization`,
      headers: { cookie },
      payload: { folderId: folder.id, tags: [] },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json()).toMatchObject({ quiz: { folderId: folder.id, tags: [] } });
  });
  it("scopes libraries and atomically moves, orders, renames and promotes folders while keeping content", async () => {
    const { app, cookie } = await fixture();
    const create = async (name: string, artifactType = "round", parentId: string | null = null) => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/folders",
        headers: { cookie },
        payload: { name, artifactType, parentId },
      });
      expect(response.statusCode, response.body).toBe(201);
      return response.json().folder;
    };
    const parent = await create("Training");
    const child = await create("Safety", "round", parent.id);
    const second = await create("Later");
    const presentation = await create("Training", "presentation");
    await create("Training", "survey");
    expect(
      (await app.inject({ url: "/v1/folders", headers: { cookie } })).json().folders,
    ).toHaveLength(3);
    expect(
      (
        await app.inject({ url: "/v1/folders?artifactType=presentation", headers: { cookie } })
      ).json().folders,
    ).toMatchObject([{ id: presentation.id }]);
    expect(
      (await app.inject({ url: "/v1/folders?artifactType=bad", headers: { cookie } })).statusCode,
    ).toBe(400);
    const patch = (id: string, payload: object) =>
      app.inject({ method: "PATCH", url: `/v1/folders/${id}`, headers: { cookie }, payload });
    expect((await patch(parent.id, {})).statusCode).toBe(400);
    expect((await patch(parent.id, { parentId: child.id })).statusCode).toBe(409);
    expect((await patch(child.id, { parentId: presentation.id })).statusCode).toBe(404);
    expect((await patch(second.id, { position: 0, name: "First" })).json()).toMatchObject({
      folder: { position: 0, name: "First" },
    });
    expect((await patch(child.id, { parentId: second.id })).json()).toMatchObject({
      folder: { parentId: second.id, position: 0 },
    });
    await patch(child.id, { parentId: parent.id });
    const created = await app.inject({
      method: "POST",
      url: "/v1/quizzes",
      headers: { cookie },
      payload: { title: "Preserved Round", description: "" },
    });
    const quiz = created.json().quiz;
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/v1/quizzes/${quiz.id}/organization`,
          headers: { cookie },
          payload: { folderId: presentation.id, tags: [] },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/v1/quizzes/${quiz.id}/organization`,
          headers: { cookie },
          payload: { folderId: parent.id, tags: ["Keep"] },
        })
      ).statusCode,
    ).toBe(200);
    const collision = await create("Safety");
    expect(
      (await app.inject({ method: "DELETE", url: `/v1/folders/${parent.id}`, headers: { cookie } }))
        .statusCode,
    ).toBe(409);
    await app.inject({ method: "DELETE", url: `/v1/folders/${collision.id}`, headers: { cookie } });
    expect(
      (await app.inject({ method: "DELETE", url: `/v1/folders/${parent.id}`, headers: { cookie } }))
        .statusCode,
    ).toBe(204);
    expect(
      (await app.inject({ url: "/v1/folders", headers: { cookie } })).json().folders,
    ).toMatchObject([
      { id: second.id, position: 0 },
      { id: child.id, position: 1, parentId: null },
    ]);
    expect(
      (await app.inject({ url: `/v1/quizzes/${quiz.id}`, headers: { cookie } })).json(),
    ).toMatchObject({ quiz: { title: "Preserved Round", folderId: null, tags: ["Keep"] } });
  });
  it("allows owner/editor management, limits viewers to reads and hides other workspaces", async () => {
    const { app, cookie } = await fixture();
    const folder = (
      await app.inject({
        method: "POST",
        url: "/v1/folders",
        headers: { cookie },
        payload: { name: "Private" },
      })
    ).json().folder;
    expect((await app.inject({ url: "/v1/folders" })).statusCode).toBe(401);
    for (const role of ["editor", "viewer"] as const) {
      const invitation = await app.inject({
        method: "POST",
        url: "/v1/workspace/invitations",
        headers: { cookie },
        payload: { email: `${randomUUID()}@example.com`, role },
      });
      const token = new URL(invitation.json().debugUrl).searchParams.get("token");
      const accepted = await app.inject({
        method: "POST",
        url: "/v1/invitations/accept",
        payload: { token, acceptPolicies: true },
      });
      const memberCookie = String(accepted.headers["set-cookie"]).split(";")[0]!;
      expect(
        (await app.inject({ url: "/v1/folders", headers: { cookie: memberCookie } })).statusCode,
      ).toBe(200);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/v1/folders",
            headers: { cookie: memberCookie },
            payload: { name: role },
          })
        ).statusCode,
      ).toBe(role === "editor" ? 201 : 403);
      expect(
        (
          await app.inject({
            method: "PATCH",
            url: `/v1/folders/${folder.id}`,
            headers: { cookie: memberCookie },
            payload: { name: `${role} renamed` },
          })
        ).statusCode,
      ).toBe(role === "editor" ? 200 : 403);
      expect(
        (
          await app.inject({
            method: "DELETE",
            url: `/v1/folders/${folder.id}`,
            headers: { cookie: memberCookie },
          })
        ).statusCode,
      ).toBe(role === "editor" ? 204 : 403);
    }
    const outsider = await signIn(app);
    expect(
      (await app.inject({ url: "/v1/folders", headers: { cookie: outsider } })).json(),
    ).toEqual({ folders: [] });
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/v1/folders/${folder.id}`,
          headers: { cookie: outsider },
          payload: { name: "Intrusion" },
        })
      ).statusCode,
    ).toBe(404);
  });
});
