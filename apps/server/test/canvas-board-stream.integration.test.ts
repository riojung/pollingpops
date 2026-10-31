import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { connect as connectTcp } from "node:net";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import {
  createIdeaBoardRepository,
  createPlatformRepository,
  MemoryRepository,
} from "@openround/db";
import { IdeaBoardCreateSchema } from "@openround/contracts";
import { buildApp } from "../src/app.js";
import { ConfigSchema } from "../src/config.js";
import { MemorySessionCache } from "../src/cache.js";
import { signInFromVerificationResponse } from "./support/email-auth.js";

const webOrigin = "http://127.0.0.1:3400";
const apps: FastifyInstance[] = [];
const controllers = new Set<AbortController>();
afterEach(async () => {
  for (const controller of controllers) controller.abort();
  controllers.clear();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function within<T>(
  promise: Promise<T>,
  milliseconds = 4_000,
  operation = "TCP canvas stream",
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${operation} did not complete promptly`)),
          milliseconds,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function signIn(app: FastifyInstance, email: string) {
  const registration = await app.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: { email, segment: "workplace", acceptPolicies: true },
  });
  const response = await signInFromVerificationResponse(app, registration, email);
  const cookie = String(response.headers["set-cookie"]).split(";")[0]!;
  const me = await app.inject({ url: "/v1/auth/me", headers: { cookie } });
  return {
    headers: { cookie },
    ...me.json<{ creator: { userId: string; workspaceId: string } }>().creator,
  };
}

async function fixture(readiness?: () => Promise<void>) {
  const repository = new MemoryRepository();
  const config = ConfigSchema.parse({
    NODE_ENV: "test",
    ALLOW_IN_MEMORY: "true",
    BUSINESS_PLATFORM_ENABLED: "true",
    LOG_LEVEL: "silent",
    WEB_ORIGIN: webOrigin,
    PUBLIC_API_URL: "http://127.0.0.1:4400",
  });
  const mailer = {
    sendAccountVerification: async () => {},
    sendSignInPin: async () => {},
    sendWorkspaceInvitation: async () => {},
  };
  const built = await buildApp(config, {
    repository,
    cache: new MemorySessionCache(),
    mailer,
    ...(readiness ? { readiness } : {}),
  });
  apps.push(built.app);
  const owner = await signIn(built.app, "stream-owner@example.com");
  const editor = await signIn(built.app, "stream-editor@example.com");
  const platform = createPlatformRepository(repository);
  await platform.saveFeaturePolicy({
    expectedRevision: 0,
    features: {
      ideaBoards: { enabled: true, plans: ["free", "pro", "team"] },
      canvasBoards: { enabled: true, plans: ["free", "pro", "team"] },
      canvasBoardSharing: { enabled: true, plans: ["free", "pro", "team"] },
      canvasBoardRealtime: { enabled: true, plans: ["free", "pro", "team"] },
    },
  });
  const organization = await platform.createOrganization({
    name: "Transport test",
    actorId: owner.userId,
    accountType: "organization",
    licenseUnit: "user",
  });
  await platform.applySubscriptionSnapshot({
    organizationId: organization.id,
    customerId: null,
    subscriptionId: null,
    status: "active",
    licenseQuantity: 2,
    licenseUnit: "user",
    offerId: null,
    paidThrough: null,
    graceUntil: null,
    legacyPlan: "team",
  });
  await platform.setOrganizationMember({
    organizationId: organization.id,
    actorId: owner.userId,
    userId: editor.userId,
    role: "member",
  });
  await platform.assignOrganizationUserLicense(organization.id, owner.userId, editor.userId, true);
  const workspaceId = (
    await platform.getOrganizationUserLicenses(organization.id, owner.userId)
  ).assignments.find((assignment) => assignment.userId === owner.userId)!.workspaceId;
  const url = await built.app.listen({ host: "127.0.0.1", port: 0 });
  return { ...built, repository, config, mailer, platform, owner, editor, workspaceId, url };
}

async function create(f: Awaited<ReturnType<typeof fixture>>) {
  const response = await f.app.inject({
    method: "POST",
    url: "/v1/canvas-boards",
    headers: f.owner.headers,
    payload: {
      workspaceId: f.workspaceId,
      title: "Transport board",
      boardType: "team",
      operationId: randomUUID(),
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().board as { id: string };
}

async function stream(url: string, headers: Record<string, string>) {
  const controller = new AbortController();
  controllers.add(controller);
  const response = await within(
    fetch(url, { headers: { origin: webOrigin, ...headers }, signal: controller.signal }),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("access-control-allow-origin")).toBe(webOrigin);
  expect(response.headers.get("access-control-allow-credentials")).toBe("true");
  expect(response.headers.get("content-type")).toContain("application/x-ndjson");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("x-accel-buffering")).toBe("no");
  expect(response.headers.get("connection")).toBe("close");
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  const seen: Array<Record<string, unknown>> = [];
  async function next(type: string) {
    return within(
      (async () => {
        while (true) {
          const newline = pending.indexOf("\n");
          if (newline >= 0) {
            const event = JSON.parse(pending.slice(0, newline)) as Record<string, unknown>;
            pending = pending.slice(newline + 1);
            seen.push(event);
            if (event.type === type) return event;
            continue;
          }
          const chunk = await reader.read();
          if (chunk.done) throw new Error("Canvas stream ended before expected event");
          pending += decoder.decode(chunk.value, { stream: true });
        }
      })(),
    );
  }
  return { response, reader, controller, next, seen };
}

describe("canvas fetch streams over real HTTP", () => {
  it("fans metadata to independent API nodes with CORS and revokes both open editor streams", async () => {
    const f = await fixture(),
      board = await create(f);
    const invited = await f.app.inject({
      method: "POST",
      url: `/v1/canvas-boards/${board.id}/invitations`,
      headers: f.owner.headers,
      payload: { email: "stream-editor@example.com", role: "editor", operationId: randomUUID() },
    });
    expect(invited.statusCode, invited.body).toBe(201);
    const accepted = await f.app.inject({
      method: "POST",
      url: `/v1/canvas-boards/invitations/${invited.json().invitation.id}/accept`,
      headers: f.editor.headers,
      payload: {},
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    const peer = await buildApp(f.config, {
      repository: f.repository,
      cache: new MemorySessionCache(),
      mailer: f.mailer,
    });
    apps.push(peer.app);
    const peerUrl = await peer.app.listen({ host: "127.0.0.1", port: 0 });
    const first = await stream(`${f.url}/v1/canvas-boards/${board.id}/events`, f.editor.headers);
    const second = await stream(`${peerUrl}/v1/canvas-boards/${board.id}/events`, f.editor.headers);
    await first.next("canvas.ready");
    await second.next("canvas.ready");
    const mutation = await f.app.inject({
      method: "POST",
      url: `/v1/canvas-boards/${board.id}/commands`,
      headers: f.owner.headers,
      payload: {
        schemaVersion: 1,
        operationId: randomUUID(),
        command: {
          type: "batch",
          operations: [
            {
              type: "create",
              object: {
                id: randomUUID(),
                type: "sticky",
                text: "Board text stays outside the stream",
                x: 0,
                y: 0,
                width: 200,
                height: 150,
              },
            },
          ],
        },
      },
    });
    expect(mutation.statusCode, mutation.body).toBe(200);
    const [one, two] = await Promise.all([
      first.next("canvas.changed"),
      second.next("canvas.changed"),
    ]);
    expect(one.canvasSeq).toBe(mutation.json().board.canvasSeq);
    expect(two.canvasSeq).toBe(one.canvasSeq);
    expect(JSON.stringify([...first.seen, ...second.seen])).not.toContain(
      "Board text stays outside the stream",
    );
    const revoked = await peer.app.inject({
      method: "DELETE",
      url: `/v1/canvas-boards/${board.id}/grants/${f.editor.userId}`,
      headers: f.owner.headers,
    });
    expect(revoked.statusCode, revoked.body).toBe(204);
    await Promise.all([first.next("access.revoked"), second.next("access.revoked")]);
    expect((await within(first.reader.read())).done).toBe(true);
    expect((await within(second.reader.read())).done).toBe(true);
  }, 15_000);

  it("delivers guest Bearer updates and expires the subscription without creator cookies", async () => {
    const f = await fixture();
    const legacy = createIdeaBoardRepository(f.repository);
    const sourceId = randomUUID(),
      now = Date.now();
    const source = await legacy.create(
      f.workspaceId,
      sourceId,
      IdeaBoardCreateSchema.parse({ title: "Short retained workshop" }),
      randomUUID(),
      {
        participantLimit: 10,
        closesAt: new Date(now + 1_500).toISOString(),
        expiresAt: new Date(now + 2_700).toISOString(),
      },
      () => new Date(),
    );
    const canvas = await f.canvasBoards.create(
      { userId: f.owner.userId },
      {
        schemaVersion: 1,
        workspaceId: f.workspaceId,
        title: source.title,
        boardType: "workshop",
        sourceBoardId: sourceId,
        operationId: randomUUID(),
      },
    );
    await legacy.hostCommand(
      f.workspaceId,
      sourceId,
      { type: "collect" },
      source.revision,
      randomUUID(),
      () => new Date(),
    );
    const guest = { authorization: `Bearer ${randomBytes(32).toString("hex")}` };
    const joined = await f.app.inject({
      method: "POST",
      url: `/v1/idea-boards/${sourceId}/join`,
      headers: guest,
      payload: {},
    });
    expect(joined.statusCode, joined.body).toBe(200);
    const preflight = await fetch(`${f.url}/v1/canvas-boards/workshop/${sourceId}/guest/events`, {
      method: "OPTIONS",
      headers: {
        origin: webOrigin,
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-headers")).toContain("authorization");
    const client = await stream(
      `${f.url}/v1/canvas-boards/workshop/${sourceId}/guest/events`,
      guest,
    );
    expect((await client.next("canvas.ready")).boardId).toBe(canvas.id);
    const changed = await f.canvasBoards.command({ userId: f.owner.userId }, canvas.id, {
      schemaVersion: 1,
      operationId: randomUUID(),
      command: {
        type: "batch",
        operations: [
          {
            type: "create",
            object: {
              id: randomUUID(),
              type: "text",
              text: "Private team instruction",
              x: 1,
              y: 1,
              width: 200,
              height: 100,
              rotation: 0,
              zIndex: 0,
              color: "white",
              locked: false,
              parentId: null,
              visibility: "team",
            },
          },
        ],
      },
    });
    expect((await client.next("canvas.changed")).canvasSeq).toBe(changed.board.canvasSeq);
    await client.next("access.revoked");
    expect((await within(client.reader.read())).done).toBe(true);
    expect(JSON.stringify(client.seen)).not.toContain("Private team instruction");
  }, 12_000);

  it("honors AbortSignal and closes active HTTP streams during app shutdown", async () => {
    const f = await fixture(),
      board = await create(f);
    const first = await stream(`${f.url}/v1/canvas-boards/${board.id}/events`, f.owner.headers);
    await first.next("canvas.ready");
    const pending = first.reader.read();
    first.controller.abort();
    await expect(within(pending, 4_000, "Aborted canvas read")).rejects.toMatchObject({
      name: "AbortError",
    });
    const active = await stream(`${f.url}/v1/canvas-boards/${board.id}/events`, f.owner.headers);
    await active.next("canvas.ready");
    await within(f.app.close(), 2_000, "Canvas server shutdown");
    expect((await within(active.reader.read(), 4_000, "Closed canvas read")).done).toBe(true);
  }, 10_000);

  it("closes unused TCP connections while allowing an active HTTP request to finish", async () => {
    let release!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const f = await fixture(async () => {
      entered();
      await pending;
    });
    const request = fetch(`${f.url}/health/ready`);
    await within(ready);
    const accepted = once(f.app.server, "connection");
    const socket = connectTcp({ host: "127.0.0.1", port: Number(new URL(f.url).port) });
    try {
      await within(Promise.all([once(socket, "connect"), accepted]));
      const closed = once(socket, "close");
      let finished = false;
      const closing = f.app.close().then(() => {
        finished = true;
      });
      expect((await within(closed))[0]).toBe(false);
      expect(finished).toBe(false);
      release();
      const response = await within(request);
      expect(response.status).toBe(200);
      expect(response.headers.get("connection")).toBe("close");
      expect(await response.json()).toMatchObject({ status: "ready" });
      await within(closing, 2_000, "Canvas server shutdown with unused TCP connection");
    } finally {
      release();
      socket.destroy();
    }
  });

  it("treats an active realtime policy pause as reconnect for both team and guest while authorized refresh remains available", async () => {
    const f = await fixture(),
      board = await create(f);
    const legacy = createIdeaBoardRepository(f.repository);
    const sourceId = randomUUID(),
      now = Date.now();
    const source = await legacy.create(
      f.workspaceId,
      sourceId,
      IdeaBoardCreateSchema.parse({ title: "Paused live workshop" }),
      randomUUID(),
      {
        participantLimit: 10,
        closesAt: new Date(now + 60_000).toISOString(),
        expiresAt: new Date(now + 120_000).toISOString(),
      },
      () => new Date(),
    );
    await f.canvasBoards.create(
      { userId: f.owner.userId },
      {
        schemaVersion: 1,
        workspaceId: f.workspaceId,
        title: source.title,
        boardType: "workshop",
        sourceBoardId: sourceId,
        operationId: randomUUID(),
      },
    );
    await legacy.hostCommand(
      f.workspaceId,
      sourceId,
      { type: "collect" },
      source.revision,
      randomUUID(),
      () => new Date(),
    );
    const guest = { authorization: `Bearer ${randomBytes(32).toString("hex")}` };
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: `/v1/idea-boards/${sourceId}/join`,
          headers: guest,
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
    const team = await stream(`${f.url}/v1/canvas-boards/${board.id}/events`, f.owner.headers);
    const audience = await stream(
      `${f.url}/v1/canvas-boards/workshop/${sourceId}/guest/events`,
      guest,
    );
    await team.next("canvas.ready");
    await audience.next("canvas.ready");
    await f.platform.saveFeaturePolicy({
      expectedRevision: 1,
      features: {
        ideaBoards: { enabled: true, plans: ["free", "pro", "team"] },
        canvasBoards: { enabled: true, plans: ["free", "pro", "team"] },
        canvasBoardSharing: { enabled: true, plans: ["free", "pro", "team"] },
        canvasBoardRealtime: { enabled: false, plans: ["free", "pro", "team"] },
      },
    });
    await Promise.all([team.next("reconnect"), audience.next("reconnect")]);
    expect(team.seen.some((event) => event.type === "access.revoked")).toBe(false);
    expect(audience.seen.some((event) => event.type === "access.revoked")).toBe(false);
    expect((await within(team.reader.read())).done).toBe(true);
    expect((await within(audience.reader.read())).done).toBe(true);
    expect(
      (await f.app.inject({ url: `/v1/canvas-boards/${board.id}`, headers: f.owner.headers }))
        .statusCode,
    ).toBe(200);
    expect(
      (await f.app.inject({ url: `/v1/canvas-boards/workshop/${sourceId}/guest`, headers: guest }))
        .statusCode,
    ).toBe(200);
  }, 10_000);
});
