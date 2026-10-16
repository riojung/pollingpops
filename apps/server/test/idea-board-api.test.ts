import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  IdeaBoardGuestViewSchema,
  IdeaBoardViewSchema,
  type IdeaBoardHostCommand,
} from "@openround/contracts";
import { IdeaBoardRepository, MemoryRepository, createPlatformRepository } from "@openround/db";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";

let activeApp: FastifyInstance | undefined;
afterEach(async () => {
  await activeApp?.close();
  activeApp = undefined;
  vi.restoreAllMocks();
  vi.useRealTimers();
});
type Headers = Record<string, string>;
async function signIn(app: FastifyInstance, email = "board-owner@example.com") {
  const magic = await app.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: { email, segment: "workplace", acceptPolicies: true },
  });
  const token = new URL(magic.json().debugUrl).searchParams.get("token");
  const verified = await app.inject({ method: "GET", url: `/v1/auth/verify?token=${token}` });
  return { cookie: String(verified.headers["set-cookie"]).split(";")[0]! };
}
async function fixture(
  enabled = true,
  plan: "free" | "pro" = "free",
  configureCache?: (cache: MemorySessionCache) => void,
) {
  const workspaceId = randomUUID();
  const repository = new MemoryRepository({ initialWorkspaceId: workspaceId, initialPlan: plan });
  const config = ConfigSchema.parse({
    NODE_ENV: "test",
    ALLOW_IN_MEMORY: "true",
    LOG_LEVEL: "silent",
    WEB_ORIGIN: "http://localhost:3000",
    PUBLIC_API_URL: "http://localhost:4000",
    FEATURE_IDEA_BOARDS: String(enabled),
    CORE_PARITY_WORKSPACE_ALLOWLIST: workspaceId,
  });
  const cache = new MemorySessionCache();
  configureCache?.(cache);
  const { app } = await buildApp(config, { repository, cache });
  activeApp = app;
  return { app, repository, config, cache, workspaceId, headers: await signIn(app) };
}
async function createBoard(
  app: FastifyInstance,
  headers: Headers,
  input: Record<string, unknown> = {},
) {
  const payload = { title: "Next priorities", idempotencyKey: randomUUID(), ...input };
  const response = await app.inject({ method: "POST", url: "/v1/idea-boards", headers, payload });
  expect(response.statusCode, response.body).toBe(201);
  return { board: IdeaBoardViewSchema.parse(response.json().board), payload };
}
async function host(
  app: FastifyInstance,
  id: string,
  headers: Headers,
  command: IdeaBoardHostCommand,
) {
  const current = await app.inject({ method: "GET", url: `/v1/idea-boards/${id}`, headers });
  const payload = {
    idempotencyKey: randomUUID(),
    expectedRevision: current.json().board.revision,
    command,
  };
  const response = await app.inject({
    method: "POST",
    url: `/v1/idea-boards/${id}/commands`,
    headers,
    payload,
  });
  expect(response.statusCode, response.body).toBe(200);
  return { board: IdeaBoardViewSchema.parse(response.json().board), response, payload };
}
function guestHeaders(): Headers {
  return { authorization: `Bearer ${randomBytes(32).toString("hex")}` };
}
async function join(app: FastifyInstance, id: string, headers: Headers, alias?: string) {
  const response = await app.inject({
    method: "POST",
    url: `/v1/idea-boards/${id}/join`,
    headers,
    payload: alias ? { alias } : {},
  });
  expect(response.statusCode, response.body).toBe(200);
  return IdeaBoardGuestViewSchema.parse(response.json());
}
async function member(app: FastifyInstance, owner: Headers, role: "editor" | "viewer") {
  const invited = await app.inject({
    method: "POST",
    url: "/v1/workspace/invitations",
    headers: owner,
    payload: { email: `board-${role}@example.com`, role },
  });
  expect(invited.statusCode, invited.body).toBe(201);
  const token = new URL(invited.json().debugUrl).searchParams.get("token");
  const accepted = await app.inject({
    method: "POST",
    url: "/v1/invitations/accept",
    payload: { token, acceptPolicies: true },
  });
  expect(accepted.statusCode, accepted.body).toBe(200);
  return { cookie: String(accepted.headers["set-cookie"]).split(";")[0]! };
}

describe("independent idea board APIs", () => {
  it("preserves accepted creation and collect retries when rollout and launches pause", async () => {
    const { app, headers, config, repository } = await fixture(false);
    const blocked = await app.inject({
      method: "POST",
      url: "/v1/idea-boards",
      headers,
      payload: { title: "Blocked", idempotencyKey: randomUUID() },
    });
    expect(blocked.statusCode).toBe(404);
    config.FEATURE_IDEA_BOARDS = true;
    const { board, payload } = await createBoard(app, headers);
    config.FEATURE_IDEA_BOARDS = false;
    repository.operationalFeatures.sessionCreation = false;
    const retry = await app.inject({ method: "POST", url: "/v1/idea-boards", headers, payload });
    expect(retry.statusCode, retry.body).toBe(201);
    expect(retry.json().board).toEqual(board);
    const conflict = await app.inject({
      method: "POST",
      url: "/v1/idea-boards",
      headers,
      payload: { ...payload, title: "Changed" },
    });
    expect(conflict.statusCode).toBe(409);
    const collectInput = {
      idempotencyKey: randomUUID(),
      expectedRevision: board.revision,
      command: { type: "collect" },
    };
    const paused = await app.inject({
      method: "POST",
      url: `/v1/idea-boards/${board.id}/commands`,
      headers,
      payload: collectInput,
    });
    expect(paused.statusCode).toBe(404);
    config.FEATURE_IDEA_BOARDS = true;
    const operationalPaused = await app.inject({
      method: "POST",
      url: `/v1/idea-boards/${board.id}/commands`,
      headers,
      payload: collectInput,
    });
    expect(operationalPaused.statusCode).toBe(409);
    repository.operationalFeatures.sessionCreation = true;
    const opened = await app.inject({
      method: "POST",
      url: `/v1/idea-boards/${board.id}/commands`,
      headers,
      payload: collectInput,
    });
    expect(opened.statusCode, opened.body).toBe(200);
    config.FEATURE_IDEA_BOARDS = false;
    repository.operationalFeatures.sessionCreation = false;
    const openRetry = await app.inject({
      method: "POST",
      url: `/v1/idea-boards/${board.id}/commands`,
      headers,
      payload: collectInput,
    });
    expect(openRetry.statusCode, openRetry.body).toBe(200);
    expect(openRetry.json().receipt).toEqual(opened.json().receipt);
    expect(
      (await app.inject({ method: "GET", url: "/v1/idea-boards", headers })).json().boards,
    ).toHaveLength(1);
    await host(app, board.id, headers, { type: "close" });
    expect(
      (await app.inject({ method: "DELETE", url: `/v1/idea-boards/${board.id}`, headers }))
        .statusCode,
    ).toBe(204);
  });

  it("keeps pending ideas and ballots private, freezes grouping, and releases final counts after closure", async () => {
    const { app, headers } = await fixture();
    const { board } = await createBoard(app, headers);
    await host(app, board.id, headers, { type: "collect" });
    const first = guestHeaders();
    const second = guestHeaders();
    await join(app, board.id, first);
    await join(app, board.id, second);
    const publicInfo = await app.inject({
      method: "GET",
      url: `/v1/idea-boards/${board.id}/public`,
    });
    expect(publicInfo.statusCode).toBe(200);
    expect(publicInfo.json().board).not.toHaveProperty("ideas");
    const ideaPayload = { idempotencyKey: randomUUID(), body: "Reduce meeting load" };
    const submitted = await app.inject({
      method: "POST",
      url: `/v1/idea-boards/${board.id}/ideas`,
      headers: first,
      payload: ideaPayload,
    });
    expect(submitted.statusCode, submitted.body).toBe(200);
    const own = IdeaBoardGuestViewSchema.parse(submitted.json());
    const ideaId = own.ownIdeas[0]!.id;
    expect(own.ownIdeas[0]).toMatchObject({
      body: ideaPayload.body,
      status: "pending",
      alias: null,
    });
    expect(own.board.ideas).toEqual([]);
    const other = await app.inject({
      method: "GET",
      url: `/v1/idea-boards/${board.id}/guest`,
      headers: second,
    });
    expect(other.body).not.toContain(ideaPayload.body);
    expect(other.json().ownIdeas).toEqual([]);
    const staff = await app.inject({ method: "GET", url: `/v1/idea-boards/${board.id}`, headers });
    expect(staff.json().board.ideas[0].body).toBe(ideaPayload.body);
    await host(app, board.id, headers, { type: "moderate", ideaId, status: "approved" });
    const hidden = await app.inject({
      method: "GET",
      url: `/v1/idea-boards/${board.id}/guest`,
      headers: second,
    });
    expect(hidden.json().board.ideas).toEqual([]);
    const groupId = randomUUID();
    await host(app, board.id, headers, {
      type: "group.create",
      id: groupId,
      name: "Working habits",
    });
    await host(app, board.id, headers, { type: "idea.group", ideaId, groupId });
    const voting = await host(app, board.id, headers, { type: "start_voting" });
    expect(voting.board.ideas[0]).toMatchObject({ groupId, voteCount: null });
    const frozen = await app.inject({
      method: "POST",
      url: `/v1/idea-boards/${board.id}/commands`,
      headers,
      payload: {
        idempotencyKey: randomUUID(),
        expectedRevision: voting.board.revision,
        command: { type: "group.rename", groupId, name: "Changed" },
      },
    });
    expect(frozen.statusCode).toBe(422);
    const votePayload = { idempotencyKey: randomUUID(), expectedRevision: 0, ideaIds: [ideaId] };
    const voted = await app.inject({
      method: "PUT",
      url: `/v1/idea-boards/${board.id}/votes`,
      headers: first,
      payload: votePayload,
    });
    expect(voted.statusCode, voted.body).toBe(200);
    expect(voted.json()).toMatchObject({ revision: 1, votedIdeaIds: [ideaId] });
    expect(voted.json().board.ideas[0].voteCount).toBeNull();
    const replay = await app.inject({
      method: "PUT",
      url: `/v1/idea-boards/${board.id}/votes`,
      headers: first,
      payload: votePayload,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().receipt).toEqual(voted.json().receipt);
    const replacement = await app.inject({
      method: "PUT",
      url: `/v1/idea-boards/${board.id}/votes`,
      headers: first,
      payload: { idempotencyKey: randomUUID(), expectedRevision: 1, ideaIds: [] },
    });
    expect(replacement.statusCode).toBe(422);
    const staffBeforeClose = await app.inject({
      method: "GET",
      url: `/v1/idea-boards/${board.id}`,
      headers,
    });
    expect(staffBeforeClose.json().board.ideas[0].voteCount).toBeNull();
    expect(staffBeforeClose.body).not.toMatch(/"(?:guestId|tokenHash|workspaceId|votedIdeaIds)":/);
    const closed = await host(app, board.id, headers, { type: "close" });
    expect(closed.board.ideas[0]!.voteCount).toBe(1);
    const afterClose = await app.inject({
      method: "GET",
      url: `/v1/idea-boards/${board.id}/guest`,
      headers: first,
    });
    expect(afterClose.json().board.status).toBe("closed");
    expect(afterClose.json().board.ideas[0].voteCount).toBe(1);
    const lateIdea = await app.inject({
      method: "POST",
      url: `/v1/idea-boards/${board.id}/ideas`,
      headers: second,
      payload: { body: "Late", idempotencyKey: randomUUID() },
    });
    expect(lateIdea.statusCode).toBe(409);
  });

  it("separates workspace roles, tenants and guest credentials", async () => {
    const { app, headers, repository, workspaceId } = await fixture();
    const { board } = await createBoard(app, headers);
    await host(app, board.id, headers, { type: "collect" });
    const guest = guestHeaders();
    await join(app, board.id, guest);
    await app.inject({
      method: "POST",
      url: `/v1/idea-boards/${board.id}/ideas`,
      headers: guest,
      payload: { body: "Private pending suggestion", idempotencyKey: randomUUID() },
    });
    const viewer = await member(app, headers, "viewer");
    const viewed = await app.inject({
      method: "GET",
      url: `/v1/idea-boards/${board.id}`,
      headers: viewer,
    });
    expect(viewed.statusCode).toBe(200);
    expect(viewed.body).not.toContain("Private pending suggestion");
    expect(viewed.json().board.participantCount).toBeNull();
    const viewerList = await app.inject({ method: "GET", url: "/v1/idea-boards", headers: viewer });
    expect(viewerList.json().boards[0]).toMatchObject({ participantCount: null, totalIdeas: 0 });
    const denied = await app.inject({
      method: "POST",
      url: `/v1/idea-boards/${board.id}/commands`,
      headers: viewer,
      payload: { command: { type: "close" }, expectedRevision: 1, idempotencyKey: randomUUID() },
    });
    expect(denied.statusCode).toBe(403);
    const editor = await member(app, headers, "editor");
    const editing = await app.inject({
      method: "GET",
      url: `/v1/idea-boards/${board.id}`,
      headers: editor,
    });
    expect(editing.body).toContain("Private pending suggestion");
    const acceptedEdit = await host(app, board.id, editor, { type: "visibility", visible: true });
    const editorUser = [...repository.users.values()].find(
      (user) => user.email === "board-editor@example.com",
    )!;
    await repository.updateWorkspaceMemberRole(workspaceId, editorUser.userId, "viewer");
    const revokedRetry = await app.inject({
      method: "POST",
      url: `/v1/idea-boards/${board.id}/commands`,
      headers: editor,
      payload: acceptedEdit.payload,
    });
    expect(revokedRetry.statusCode).toBe(403);
    const revokedRead = await app.inject({
      method: "GET",
      url: `/v1/idea-boards/${board.id}`,
      headers: editor,
    });
    expect(revokedRead.body).not.toContain("Private pending suggestion");
    expect(
      (await app.inject({ method: "DELETE", url: `/v1/idea-boards/${board.id}`, headers: editor }))
        .statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ method: "GET", url: `/v1/idea-boards/${board.id}/guest`, headers }))
        .statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ method: "GET", url: `/v1/idea-boards/${board.id}`, headers: guest }))
        .statusCode,
    ).toBe(401);
    const foreign = await signIn(app, "other-board-owner@example.com");
    expect(
      (await app.inject({ method: "GET", url: `/v1/idea-boards/${board.id}`, headers: foreign }))
        .statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: "DELETE", url: `/v1/idea-boards/${board.id}`, headers: foreign }))
        .statusCode,
    ).toBe(404);
    const unjoined = guestHeaders();
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/idea-boards/${board.id}/guest`,
          headers: unjoined,
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ method: "DELETE", url: `/v1/idea-boards/${board.id}`, headers }))
        .statusCode,
    ).toBe(204);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/idea-boards/${board.id}/guest`,
          headers: guest,
        })
      ).statusCode,
    ).toBe(404);
  });

  it("requires explicit board aliases and never accepts an alias in anonymous mode", async () => {
    const { app, headers } = await fixture();
    const anonymous = await createBoard(app, headers);
    await host(app, anonymous.board.id, headers, { type: "collect" });
    const unexpectedAlias = await app.inject({
      method: "POST",
      url: `/v1/idea-boards/${anonymous.board.id}/join`,
      headers: guestHeaders(),
      payload: { alias: "Unexpected" },
    });
    expect(unexpectedAlias.statusCode).toBe(422);
    const named = await createBoard(app, headers, {
      identityMode: "alias",
      moderationEnabled: false,
      ideasVisible: true,
    });
    await host(app, named.board.id, headers, { type: "collect" });
    const guest = guestHeaders();
    const missingAlias = await app.inject({
      method: "POST",
      url: `/v1/idea-boards/${named.board.id}/join`,
      headers: guest,
      payload: {},
    });
    expect(missingAlias.statusCode).toBe(400);
    await join(app, named.board.id, guest, "Workshop Fox");
    const submitted = await app.inject({
      method: "POST",
      url: `/v1/idea-boards/${named.board.id}/ideas`,
      headers: guest,
      payload: { body: "Focus time", idempotencyKey: randomUUID() },
    });
    expect(submitted.statusCode, submitted.body).toBe(200);
    expect(submitted.json().board.ideas[0]).toMatchObject({
      alias: "Workshop Fox",
      status: "approved",
    });
    expect(submitted.body).not.toMatch(/"(?:guestId|tokenHash|workspaceId)":/);
  });

  it("blocks new restricted admissions while preserving a previously admitted bearer", async () => {
    const { app, headers, repository, workspaceId } = await fixture();
    const { board } = await createBoard(app, headers);
    await host(app, board.id, headers, { type: "collect" });
    const admitted = guestHeaders();
    await join(app, board.id, admitted);
    await createPlatformRepository(repository).setWorkspaceAdmissionRestriction(workspaceId, true);
    const denied = await app.inject({
      method: "POST",
      url: `/v1/idea-boards/${board.id}/join`,
      headers: guestHeaders(),
      payload: {},
    });
    expect(denied.statusCode, denied.body).toBe(403);
    expect(denied.json().error.code).toBe("ADMISSION_RESTRICTED");
    await join(app, board.id, admitted);
    const saved = await app.inject({
      method: "POST",
      url: `/v1/idea-boards/${board.id}/ideas`,
      headers: admitted,
      payload: { body: "Already admitted", idempotencyKey: randomUUID() },
    });
    expect(saved.statusCode, saved.body).toBe(200);
  });

  it("applies origin checks to every board write before mutations occur", async () => {
    const { app, headers } = await fixture();
    const { board } = await createBoard(app, headers);
    await host(app, board.id, headers, { type: "collect" });
    const guest = guestHeaders();
    await join(app, board.id, guest);
    const foreignOrigin = { origin: "https://untrusted.example" };
    const writes = [
      {
        method: "POST" as const,
        url: "/v1/idea-boards",
        headers,
        payload: { title: "Injected", idempotencyKey: randomUUID() },
      },
      {
        method: "POST" as const,
        url: `/v1/idea-boards/${board.id}/commands`,
        headers,
        payload: { command: { type: "close" }, expectedRevision: 1, idempotencyKey: randomUUID() },
      },
      {
        method: "POST" as const,
        url: `/v1/idea-boards/${board.id}/join`,
        headers: guestHeaders(),
        payload: {},
      },
      {
        method: "POST" as const,
        url: `/v1/idea-boards/${board.id}/ideas`,
        headers: guest,
        payload: { body: "Injected", idempotencyKey: randomUUID() },
      },
      {
        method: "PUT" as const,
        url: `/v1/idea-boards/${board.id}/votes`,
        headers: guest,
        payload: { ideaIds: [], expectedRevision: 0, idempotencyKey: randomUUID() },
      },
      { method: "DELETE" as const, url: `/v1/idea-boards/${board.id}`, headers },
    ];
    for (const write of writes) {
      const response = await app.inject({
        ...write,
        headers: { ...write.headers, ...foreignOrigin },
      });
      expect(response.statusCode, response.body).toBe(403);
      expect(response.json().error.message).toContain("origin");
    }
    const current = await app.inject({
      method: "GET",
      url: `/v1/idea-boards/${board.id}`,
      headers,
    });
    expect(current.json().board).toMatchObject({
      status: "collecting",
      participantCount: 1,
      totalIdeas: 0,
    });
  });

  it("bounds and sanitizes content, rejects foreign fields, and checks IP and bearer budgets", async () => {
    let limitedPrefix = "";
    const { app, headers } = await fixture(true, "free", (cache) => {
      vi.spyOn(cache, "consumeRateLimit").mockImplementation(
        async (key) => !limitedPrefix || !key.startsWith(limitedPrefix),
      );
    });
    const { board } = await createBoard(app, headers);
    await host(app, board.id, headers, { type: "collect" });
    const guest = guestHeaders();
    await join(app, board.id, guest);
    const extra = await app.inject({
      method: "POST",
      url: `/v1/idea-boards/${board.id}/ideas`,
      headers: guest,
      payload: { body: "Idea", guestId: randomUUID(), idempotencyKey: randomUUID() },
    });
    expect(extra.statusCode).toBe(400);
    const invalid = await app.inject({
      method: "POST",
      url: `/v1/idea-boards/${board.id}/ideas`,
      headers: guest,
      payload: { body: "<script>secret()</script>", idempotencyKey: randomUUID() },
    });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.body).not.toContain("secret()");
    const huge = await app.inject({
      method: "POST",
      url: `/v1/idea-boards/${board.id}/ideas`,
      headers: guest,
      payload: { body: "x".repeat(10_000), idempotencyKey: randomUUID() },
    });
    expect(huge.statusCode).toBe(413);
    const malformed = await app.inject({
      method: "POST",
      url: `/v1/idea-boards/${board.id}/ideas`,
      headers: { ...guest, "content-type": "application/json" },
      payload: '{"body":',
    });
    expect(malformed.statusCode).toBe(400);
    limitedPrefix = "idea-board-ip:";
    const limited = await app.inject({ method: "GET", url: `/v1/idea-boards/${board.id}/guest` });
    expect(limited.statusCode).toBe(429);
    limitedPrefix = "idea-board-guest:";
    const credentialLimited = await app.inject({
      method: "GET",
      url: `/v1/idea-boards/${board.id}/guest`,
      headers: guest,
    });
    expect(credentialLimited.statusCode).toBe(429);
  });

  it("does not return idea text when a guest read waits past retention", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { app, headers } = await fixture();
    const { board } = await createBoard(app, headers, {
      moderationEnabled: false,
      ideasVisible: true,
    });
    const guest = guestHeaders();
    await host(app, board.id, headers, { type: "collect" });
    await join(app, board.id, guest);
    const submitted = await app.inject({
      method: "POST",
      url: `/v1/idea-boards/${board.id}/ideas`,
      headers: guest,
      payload: { body: "SYNTHETIC EXPIRED IDEA", idempotencyKey: randomUUID() },
    });
    expect(submitted.statusCode, submitted.body).toBe(200);

    let enteredRead!: () => void;
    let releaseRead!: () => void;
    const entered = new Promise<void>((resolve) => {
      enteredRead = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const original = IdeaBoardRepository.prototype.getGuest;
    vi.spyOn(IdeaBoardRepository.prototype, "getGuest").mockImplementation(async function (
      this: IdeaBoardRepository,
      ...args
    ) {
      enteredRead();
      await gate;
      return original.apply(this, args);
    });
    const pending = app
      .inject({
        method: "GET",
        url: `/v1/idea-boards/${board.id}/guest`,
        headers: guest,
      })
      .then((response) => response);
    try {
      await entered;
      vi.setSystemTime(new Date(board.expiresAt));
      releaseRead();
      const response = await pending;
      expect(response.statusCode, response.body).toBe(404);
      expect(response.body).not.toContain("SYNTHETIC EXPIRED IDEA");
    } finally {
      releaseRead();
      await pending;
    }
  });

  it("freezes plan limits and keeps final boards readable only through retention", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { app, headers, repository, workspaceId } = await fixture(true, "pro");
    const { board, payload } = await createBoard(app, headers, { windowDays: 30 });
    expect(board.participantLimit).toBeLessThanOrEqual(250);
    const guest = guestHeaders();
    await host(app, board.id, headers, { type: "collect" });
    await join(app, board.id, guest);
    await repository.setPlan(workspaceId, "free");
    const retry = await app.inject({ method: "POST", url: "/v1/idea-boards", headers, payload });
    expect(retry.json().board.participantLimit).toBe(board.participantLimit);
    expect(retry.json().board.expiresAt).toBe(board.expiresAt);
    vi.setSystemTime(new Date(Date.parse(board.closesAt) + 1));
    const closed = await app.inject({
      method: "GET",
      url: `/v1/idea-boards/${board.id}/guest`,
      headers: guest,
    });
    expect(closed.statusCode, closed.body).toBe(200);
    expect(closed.json().board.status).toBe("closed");
    const late = await app.inject({
      method: "POST",
      url: `/v1/idea-boards/${board.id}/ideas`,
      headers: guest,
      payload: { body: "Too late", idempotencyKey: randomUUID() },
    });
    expect(late.statusCode).toBe(409);
    vi.setSystemTime(new Date(Date.parse(board.expiresAt) + 1));
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/idea-boards/${board.id}/guest`,
          headers: guest,
        })
      ).statusCode,
    ).toBe(404);
    const refreshed = await signIn(app);
    expect(
      (await app.inject({ method: "GET", url: `/v1/idea-boards/${board.id}`, headers: refreshed }))
        .statusCode,
    ).toBe(404);
  });
});
