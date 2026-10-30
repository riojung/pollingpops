import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CanvasBoardViewSchema,
  type CanvasBoardCommand,
  type CanvasBoardView,
  type ProductFeatureRules,
} from "@openround/contracts";
import { createPlatformRepository, MemoryRepository } from "@openround/db";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";
import { mediaFinalizationObjectKey } from "../src/storage.js";
import { signInFromVerificationResponse } from "./support/email-auth.js";

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.restoreAllMocks();
});
const features: ProductFeatureRules = {
  ideaBoards: { enabled: true, plans: ["free", "pro", "team"] },
  canvasBoards: { enabled: true, plans: ["free", "pro", "team"] },
  canvasBoardSharing: { enabled: true, plans: ["free", "pro", "team"] },
  canvasBoardRealtime: { enabled: true, plans: ["free", "pro", "team"] },
};

async function signIn(app: FastifyInstance, email: string) {
  const registration = await app.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: { email, segment: "workplace", acceptPolicies: true },
  });
  const signedIn = await signInFromVerificationResponse(app, registration, email);
  const cookie = String(signedIn.headers["set-cookie"]).split(";")[0]!;
  const me = await app.inject({ url: "/v1/auth/me", headers: { cookie } });
  expect(me.statusCode, me.body).toBe(200);
  const { creator } = me.json<{ creator: { userId: string; workspaceId: string } }>();
  return { email, ...creator, headers: { cookie } };
}

async function fixture(mediaEnabled = false) {
  const repository = new MemoryRepository();
  const config = ConfigSchema.parse({
    NODE_ENV: "test",
    ALLOW_IN_MEMORY: "true",
    BUSINESS_PLATFORM_ENABLED: "true",
    LOG_LEVEL: "silent",
    FEATURE_MEDIA_UPLOADS: String(mediaEnabled),
    ...(mediaEnabled
      ? {
          S3_ENDPOINT: "http://127.0.0.1:9000",
          S3_ACCESS_KEY_ID: "test-access",
          S3_SECRET_ACCESS_KEY: "test-secret",
        }
      : {}),
  });
  const built = await buildApp(config, {
    repository,
    cache: new MemorySessionCache(),
    scanner: mediaEnabled ? { scan: async () => ({ clean: true, signature: null }) } : null,
    mailer: {
      sendAccountVerification: async () => {},
      sendSignInPin: async () => {},
      sendWorkspaceInvitation: async () => {},
    },
  });
  apps.push(built.app);
  const { app } = built;
  const owner = await signIn(app, "canvas-owner@example.com");
  const editor = await signIn(app, "canvas-editor@example.com");
  const billing = await signIn(app, "canvas-billing@example.com");
  const outsider = await signIn(app, "canvas-outsider@example.com");
  const platform = createPlatformRepository(repository);
  await platform.saveFeaturePolicy({ expectedRevision: 0, features: structuredClone(features) });
  const organization = await platform.createOrganization({
    name: "Canvas team",
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
  await platform.setOrganizationMember({
    organizationId: organization.id,
    actorId: owner.userId,
    userId: billing.userId,
    role: "billing",
  });
  const assignments = (await platform.getOrganizationUserLicenses(organization.id, owner.userId))
    .assignments;
  const workspaceId = assignments.find(
    (assignment) => assignment.userId === owner.userId,
  )!.workspaceId;
  return { ...built, platform, owner, editor, billing, outsider, organization, workspaceId };
}

async function create(f: Awaited<ReturnType<typeof fixture>>, extra: Record<string, unknown> = {}) {
  const response = await f.app.inject({
    method: "POST",
    url: "/v1/canvas-boards",
    headers: f.owner.headers,
    payload: {
      schemaVersion: 1,
      workspaceId: f.workspaceId,
      title: "Shared priorities",
      boardType: "team",
      operationId: randomUUID(),
      ...extra,
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return CanvasBoardViewSchema.parse(response.json().board);
}
async function invite(
  f: Awaited<ReturnType<typeof fixture>>,
  board: CanvasBoardView,
  email: string,
  role: "editor" | "viewer" | "facilitator",
) {
  const response = await f.app.inject({
    method: "POST",
    url: `/v1/canvas-boards/${board.id}/invitations`,
    headers: f.owner.headers,
    payload: { email, role, operationId: randomUUID() },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().invitation as { id: string };
}
async function accept(
  f: Awaited<ReturnType<typeof fixture>>,
  invitationId: string,
  headers: { cookie: string },
) {
  return f.app.inject({
    method: "POST",
    url: `/v1/canvas-boards/invitations/${invitationId}/accept`,
    headers,
    payload: {},
  });
}
async function command(
  f: Awaited<ReturnType<typeof fixture>>,
  board: CanvasBoardView,
  value: CanvasBoardCommand,
  headers = f.owner.headers,
  operationId = randomUUID(),
) {
  return f.app.inject({
    method: "POST",
    url: `/v1/canvas-boards/${board.id}/commands`,
    headers,
    payload: { schemaVersion: 1, operationId, command: value },
  });
}

describe("board-scoped canvas HTTP boundaries", () => {
  it.each(["canvas-policy", "session-creation"] as const)(
    "replays an accepted creation after a %s pause while rejecting new or changed requests",
    async (pause) => {
      const f = await fixture();
      const payload = {
        schemaVersion: 1,
        workspaceId: f.workspaceId,
        title: "Accepted canvas",
        boardType: "team",
        operationId: randomUUID(),
      };
      const first = await f.app.inject({
        method: "POST",
        url: "/v1/canvas-boards",
        headers: f.owner.headers,
        payload,
      });
      expect(first.statusCode, first.body).toBe(201);
      if (pause === "canvas-policy")
        await f.platform.saveFeaturePolicy({
          expectedRevision: 1,
          features: {
            ...structuredClone(features),
            canvasBoards: { enabled: false, plans: ["free", "pro", "team"] },
          },
        });
      else await f.repository.updateOperationalFeatures({ sessionCreation: false }, randomUUID());
      const retry = await f.app.inject({
        method: "POST",
        url: "/v1/canvas-boards",
        headers: f.owner.headers,
        payload,
      });
      expect(retry.statusCode, retry.body).toBe(201);
      expect(retry.json().board).toEqual(first.json().board);
      const mismatch = await f.app.inject({
        method: "POST",
        url: "/v1/canvas-boards",
        headers: f.owner.headers,
        payload: { ...payload, title: "Changed fingerprint" },
      });
      expect(mismatch.statusCode, mismatch.body).toBe(409);
      const fresh = await f.app.inject({
        method: "POST",
        url: "/v1/canvas-boards",
        headers: f.owner.headers,
        payload: { ...payload, operationId: randomUUID() },
      });
      expect(fresh.statusCode).toBe(pause === "canvas-policy" ? 404 : 403);
      const listed = await f.app.inject({
        url: "/v1/canvas-boards?scope=owned",
        headers: f.owner.headers,
      });
      expect(listed.json().boards).toHaveLength(1);
      await f.platform.assignOrganizationUserLicense(
        f.organization.id,
        f.owner.userId,
        f.owner.userId,
        false,
      );
      const unlicensed = await f.app.inject({
        method: "POST",
        url: "/v1/canvas-boards",
        headers: f.owner.headers,
        payload,
      });
      expect(unlicensed.statusCode).toBeGreaterThanOrEqual(400);
    },
  );

  it("cannot recreate a canvas deleted between an accepted-receipt lookup and its current projection", async () => {
    const f = await fixture();
    const payload = {
      schemaVersion: 1,
      workspaceId: f.workspaceId,
      title: "Deleted accepted canvas",
      boardType: "team",
      operationId: randomUUID(),
    };
    const first = await f.app.inject({
      method: "POST",
      url: "/v1/canvas-boards",
      headers: f.owner.headers,
      payload,
    });
    expect(first.statusCode, first.body).toBe(201);
    await f.repository.updateOperationalFeatures({ sessionCreation: false }, randomUUID());
    const getCreation = f.canvasBoards.getCreation.bind(f.canvasBoards);
    vi.spyOn(f.canvasBoards, "getCreation").mockImplementationOnce(async (...args) => {
      const previous = await getCreation(...args);
      if (previous) await f.canvasBoards.delete(f.owner, previous.id);
      return previous;
    });
    const retry = await f.app.inject({
      method: "POST",
      url: "/v1/canvas-boards",
      headers: f.owner.headers,
      payload,
    });
    expect(retry.statusCode, retry.body).toBe(404);
    expect(
      (
        await f.app.inject({ url: "/v1/canvas-boards?scope=owned", headers: f.owner.headers })
      ).json().boards,
    ).toEqual([]);
  });

  it("shares with a verified licensed colleague without granting workspace access, supports billing viewers and revokes grants", async () => {
    const f = await fixture(),
      board = await create(f);
    expect(
      (await f.app.inject({ url: `/v1/canvas-boards/${board.id}`, headers: f.editor.headers }))
        .statusCode,
    ).toBeGreaterThanOrEqual(403);
    const invitation = await invite(f, board, f.editor.email, "editor");
    expect((await accept(f, invitation.id, f.outsider.headers)).statusCode).toBeGreaterThanOrEqual(
      403,
    );
    const accepted = await accept(f, invitation.id, f.editor.headers);
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(accepted.json().board).toMatchObject({
      workspaceId: f.workspaceId,
      role: "editor",
      capabilities: { edit: true, share: false, facilitate: false },
    });
    expect(
      (await f.app.inject({ url: "/v1/auth/me", headers: f.editor.headers })).json().creator
        .workspaceId,
    ).toBe(f.editor.workspaceId);
    const shared = await f.app.inject({
      url: "/v1/canvas-boards?scope=shared",
      headers: f.editor.headers,
    });
    expect(shared.json().boards.map((item: { id: string }) => item.id)).toContain(board.id);
    const unrelated = await f.app.inject({
      url: `/v1/idea-boards/${randomUUID()}`,
      headers: f.editor.headers,
    });
    expect(unrelated.statusCode).toBe(404);
    const billingInvite = await invite(f, board, f.billing.email, "viewer");
    const billingAccepted = await accept(f, billingInvite.id, f.billing.headers);
    expect(billingAccepted.statusCode, billingAccepted.body).toBe(200);
    expect(billingAccepted.json().board.capabilities.edit).toBe(false);
    expect(
      (await command(f, board, { type: "archive" }, f.billing.headers)).statusCode,
    ).toBeGreaterThanOrEqual(403);
    const crossOrg = await f.app.inject({
      method: "POST",
      url: `/v1/canvas-boards/${board.id}/invitations`,
      headers: f.owner.headers,
      payload: { email: f.outsider.email, role: "viewer", operationId: randomUUID() },
    });
    expect(crossOrg.statusCode).toBeGreaterThanOrEqual(400);
    const revoked = await f.app.inject({
      method: "DELETE",
      url: `/v1/canvas-boards/${board.id}/grants/${f.editor.userId}`,
      headers: f.owner.headers,
    });
    expect(revoked.statusCode, revoked.body).toBe(204);
    expect(
      (await f.app.inject({ url: `/v1/canvas-boards/${board.id}`, headers: f.editor.headers }))
        .statusCode,
    ).toBeGreaterThanOrEqual(403);
  });

  it("returns 204 for a lost-response grant deletion retry while preserving board authorization", async () => {
    const f = await fixture(),
      board = await create(f);
    const invitation = await invite(f, board, f.editor.email, "editor");
    expect((await accept(f, invitation.id, f.editor.headers)).statusCode).toBe(200);
    const remove = (target: string, headers = f.owner.headers, id = board.id) =>
      f.app.inject({
        method: "DELETE",
        url: `/v1/canvas-boards/${id}/grants/${target}`,
        headers,
      });
    expect((await remove(f.billing.userId, f.editor.headers)).statusCode).toBe(403);
    expect((await remove(f.editor.userId, f.outsider.headers)).statusCode).toBe(404);
    expect((await remove(f.owner.userId)).statusCode).toBe(422);
    expect((await remove(f.editor.userId, f.owner.headers, randomUUID())).statusCode).toBe(404);
    // The first deletion commits even if its response never reaches the client.
    const first = await remove(f.editor.userId);
    expect(first.statusCode, first.body).toBe(204);
    const committed = await f.app.inject({
      url: `/v1/canvas-boards/${board.id}`,
      headers: f.owner.headers,
    });
    expect(committed.statusCode, committed.body).toBe(200);
    await f.platform.saveFeaturePolicy({
      expectedRevision: 1,
      features: {
        ...structuredClone(features),
        canvasBoards: { enabled: false, plans: ["free", "pro", "team"] },
        canvasBoardSharing: { enabled: false, plans: ["free", "pro", "team"] },
      },
    });
    const retry = await remove(f.editor.userId);
    expect(retry.statusCode, retry.body).toBe(204);
    expect(
      (
        await f.app.inject({ url: `/v1/canvas-boards/${board.id}`, headers: f.owner.headers })
      ).json(),
    ).toEqual(committed.json());
    expect(
      (await f.app.inject({ url: `/v1/canvas-boards/${board.id}`, headers: f.editor.headers }))
        .statusCode,
    ).toBe(404);
    await f.platform.assignOrganizationUserLicense(
      f.organization.id,
      f.owner.userId,
      f.owner.userId,
      false,
    );
    expect((await remove(f.editor.userId)).statusCode).toBe(404);
    await f.platform.assignOrganizationUserLicense(
      f.organization.id,
      f.owner.userId,
      f.owner.userId,
      true,
    );
    const deleted = await f.app.inject({
      method: "DELETE",
      url: `/v1/canvas-boards/${board.id}`,
      headers: f.owner.headers,
    });
    expect(deleted.statusCode, deleted.body).toBe(204);
    expect((await remove(f.editor.userId)).statusCode).toBe(404);
  });

  it("durably acknowledges exact retries and rejects stale same-object changes and somebody else's undo", async () => {
    const f = await fixture(),
      board = await create(f);
    const invitation = await invite(f, board, f.editor.email, "editor");
    expect((await accept(f, invitation.id, f.editor.headers)).statusCode).toBe(200);
    const objectId = randomUUID(),
      operationId = randomUUID();
    const mutation: CanvasBoardCommand = {
      type: "batch",
      operations: [
        {
          type: "create",
          object: {
            id: objectId,
            type: "sticky",
            x: 10,
            y: 20,
            width: 220,
            height: 160,
            text: "Original proposal",
            rotation: 0,
            zIndex: 0,
            color: "yellow",
            visibility: "team",
            locked: false,
            parentId: null,
          },
        },
      ],
    };
    const first = await command(f, board, mutation, f.editor.headers, operationId);
    expect(first.statusCode, first.body).toBe(200);
    const retry = await command(f, board, mutation, f.editor.headers, operationId);
    expect(retry.statusCode, retry.body).toBe(200);
    expect(retry.json().receipt).toEqual(first.json().receipt);
    const update: CanvasBoardCommand = {
      type: "batch",
      operations: [
        { type: "update", id: objectId, expectedVersion: 1, patch: { text: "Owner revision" } },
      ],
    };
    const updated = await command(f, board, update);
    expect(updated.statusCode, updated.body).toBe(200);
    const stale = await command(f, board, update, f.editor.headers);
    expect(stale.statusCode, stale.body).toBe(409);
    const foreignUndo = await command(f, board, { type: "undo", targetOperationId: operationId });
    expect(foreignUndo.statusCode).toBeGreaterThanOrEqual(400);
    const malformed = await f.app.inject({
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
                type: "html",
                html: "<iframe src='https://example.com'>",
              },
            },
          ],
        },
      },
    });
    expect(malformed.statusCode, malformed.body).toBe(400);
    const current = await f.app.inject({
      url: `/v1/canvas-boards/${board.id}`,
      headers: f.editor.headers,
    });
    expect(current.json().board.objects).toHaveLength(1);
    expect(current.json().board.objects[0].text).toBe("Owner revision");
    const telemetry = await f.metrics.render();
    expect(telemetry).toContain(
      'openround_canvas_operations_total{action="batch",outcome="conflict"} 1',
    );
    expect(telemetry).not.toContain("Original proposal");
    expect(telemetry).not.toContain("Owner revision");
  });

  it("invalidates a released creator seat and excludes removed members from ephemeral presence", async () => {
    const f = await fixture(),
      board = await create(f);
    const invitation = await invite(f, board, f.editor.email, "editor");
    expect((await accept(f, invitation.id, f.editor.headers)).statusCode).toBe(200);
    const sent = await f.app.inject({
      method: "PUT",
      url: `/v1/canvas-boards/${board.id}/presence`,
      headers: f.editor.headers,
      payload: { cursor: { x: 2, y: 3 } },
    });
    expect(sent.statusCode, sent.body).toBe(204);
    expect(
      (
        await f.app.inject({
          url: `/v1/canvas-boards/${board.id}/presence`,
          headers: f.owner.headers,
        })
      ).json().members,
    ).toHaveLength(1);
    await f.platform.assignOrganizationUserLicense(
      f.organization.id,
      f.owner.userId,
      f.editor.userId,
      false,
    );
    expect(
      (
        await command(
          f,
          board,
          { type: "batch", operations: [{ type: "delete", id: randomUUID(), expectedVersion: 1 }] },
          f.editor.headers,
        )
      ).statusCode,
    ).toBeGreaterThanOrEqual(400);
    await f.platform.removeOrganizationMember(f.organization.id, f.owner.userId, f.editor.userId);
    expect(
      (
        await f.app.inject({
          url: `/v1/canvas-boards/${board.id}/presence`,
          headers: f.owner.headers,
        })
      ).json().members,
    ).toEqual([]);
  });

  it("pauses new creates without losing authorized reads, revoke or delete", async () => {
    const f = await fixture(),
      board = await create(f);
    await f.platform.saveFeaturePolicy({
      expectedRevision: 1,
      features: {
        ...structuredClone(features),
        canvasBoards: { enabled: false, plans: ["free", "pro", "team"] },
      },
    });
    expect(
      (await f.app.inject({ url: `/v1/canvas-boards/${board.id}`, headers: f.owner.headers }))
        .statusCode,
    ).toBe(200);
    const paused = await f.app.inject({
      method: "POST",
      url: "/v1/canvas-boards",
      headers: f.owner.headers,
      payload: {
        workspaceId: f.workspaceId,
        title: "Paused",
        boardType: "team",
        operationId: randomUUID(),
      },
    });
    expect(paused.statusCode, paused.body).toBe(404);
    const deleted = await f.app.inject({
      method: "DELETE",
      url: `/v1/canvas-boards/${board.id}`,
      headers: f.owner.headers,
    });
    expect(deleted.statusCode, deleted.body).toBe(204);
  });

  it("keeps guided guest reads Bearer-scoped even when an owner cookie is supplied", async () => {
    const f = await fixture();
    const selected = await f.app.inject({
      method: "POST",
      url: `/v1/workspaces/${f.workspaceId}/select`,
      headers: f.owner.headers,
    });
    expect(selected.statusCode, selected.body).toBe(200);
    const source = await f.app.inject({
      method: "POST",
      url: "/v1/idea-boards",
      headers: f.owner.headers,
      payload: { title: "Guest workshop", idempotencyKey: randomUUID() },
    });
    expect(source.statusCode, source.body).toBe(201);
    const sourceId = source.json().board.id;
    const board = await create(f, { boardType: "workshop", sourceBoardId: sourceId });
    const opened = await command(f, board, {
      type: "workshop",
      expectedRevision: source.json().board.revision,
      command: { type: "collect" },
    });
    expect(opened.statusCode, opened.body).toBe(200);
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
    const submitted = await f.app.inject({
      method: "POST",
      url: `/v1/idea-boards/${sourceId}/ideas`,
      headers: guest,
      payload: { body: "Private pending workshop proposal", idempotencyKey: randomUUID() },
    });
    expect(submitted.statusCode, submitted.body).toBe(200);
    const other = {
      authorization: `Bearer ${randomBytes(32).toString("hex")}`,
      ...f.owner.headers,
    };
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: `/v1/idea-boards/${sourceId}/join`,
          headers: other,
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
    const projected = await f.app.inject({
      url: `/v1/canvas-boards/workshop/${sourceId}/guest`,
      headers: other,
    });
    expect(projected.statusCode, projected.body).toBe(200);
    expect(projected.body).not.toContain("Private pending workshop proposal");
    expect(
      (
        await f.app.inject({
          url: `/v1/canvas-boards/workshop/${sourceId}/guest`,
          headers: f.owner.headers,
        })
      ).statusCode,
    ).toBe(401);
  });

  it("honors a sharing pause before acceptance while retaining revoke controls", async () => {
    const f = await fixture(),
      board = await create(f);
    const editorInvite = await invite(f, board, f.editor.email, "editor");
    expect((await accept(f, editorInvite.id, f.editor.headers)).statusCode).toBe(200);
    const pending = await invite(f, board, f.billing.email, "viewer");
    await f.platform.saveFeaturePolicy({
      expectedRevision: 1,
      features: {
        ...structuredClone(features),
        canvasBoardSharing: { enabled: false, plans: ["free", "pro", "team"] },
      },
    });
    expect((await accept(f, pending.id, f.billing.headers)).statusCode).toBe(404);
    expect(
      (await f.app.inject({ url: `/v1/canvas-boards/${board.id}`, headers: f.billing.headers }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await f.app.inject({
          method: "DELETE",
          url: `/v1/canvas-boards/${board.id}/invitations/${pending.id}`,
          headers: f.owner.headers,
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await f.app.inject({
          method: "DELETE",
          url: `/v1/canvas-boards/${board.id}/grants/${f.editor.userId}`,
          headers: f.owner.headers,
        })
      ).statusCode,
    ).toBe(204);
  });

  it("clears ephemeral presence immediately when a grant or its canvas is deleted", async () => {
    const f = await fixture(),
      board = await create(f);
    const invitation = await invite(f, board, f.editor.email, "editor");
    expect((await accept(f, invitation.id, f.editor.headers)).statusCode).toBe(200);
    for (const actor of [f.owner, f.editor])
      expect(
        (
          await f.app.inject({
            method: "PUT",
            url: `/v1/canvas-boards/${board.id}/presence`,
            headers: actor.headers,
            payload: { cursor: null },
          })
        ).statusCode,
      ).toBe(204);
    expect(await f.cache.listCanvasPresence?.(board.id)).toHaveLength(2);
    expect(
      (
        await f.app.inject({
          method: "DELETE",
          url: `/v1/canvas-boards/${board.id}/grants/${f.editor.userId}`,
          headers: f.owner.headers,
        })
      ).statusCode,
    ).toBe(204);
    expect(await f.cache.listCanvasPresence?.(board.id)).toHaveLength(1);
    expect(
      (
        await f.app.inject({
          method: "DELETE",
          url: `/v1/canvas-boards/${board.id}`,
          headers: f.owner.headers,
        })
      ).statusCode,
    ).toBe(204);
    expect(await f.cache.listCanvasPresence?.(board.id)).toEqual([]);
  });

  it("rechecks shared facilitator media access after an asynchronous storage read", async () => {
    const f = await fixture(true);
    vi.spyOn(f.storage, "finalize").mockImplementation(async (asset, token) => ({
      scanStatus: "clean",
      objectKey: mediaFinalizationObjectKey(asset, token),
    }));
    vi.spyOn(f.storage, "commitFinalizationCandidate").mockResolvedValue();
    vi.spyOn(f.storage, "cleanupFinalization").mockResolvedValue();
    const read = vi
      .spyOn(f.storage, "readImage")
      .mockResolvedValue(Buffer.from("protected image bytes"));
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: `/v1/workspaces/${f.workspaceId}/select`,
          headers: f.owner.headers,
        })
      ).statusCode,
    ).toBe(200);
    const source = await f.app.inject({
      method: "POST",
      url: "/v1/idea-boards",
      headers: f.owner.headers,
      payload: { title: "Image workshop", idempotencyKey: randomUUID() },
    });
    const sourceId = source.json().board.id;
    const board = await create(f, { boardType: "workshop", sourceBoardId: sourceId });
    const opening = await command(f, board, {
      type: "workshop",
      expectedRevision: source.json().board.revision,
      command: { type: "collect" },
    });
    expect(opening.statusCode, opening.body).toBe(200);
    const invitation = await invite(f, board, f.editor.email, "facilitator");
    expect((await accept(f, invitation.id, f.editor.headers)).statusCode).toBe(200);
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
    const ticket = await f.app.inject({
      method: "POST",
      url: `/v1/idea-boards/${sourceId}/media`,
      headers: guest,
      payload: {
        fileName: "drawing.png",
        mimeType: "image/png",
        sizeBytes: 8,
        altText: "A drawing",
      },
    });
    expect(ticket.statusCode, ticket.body).toBe(201);
    const mediaId = ticket.json().mediaId;
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: `/v1/idea-boards/${sourceId}/media/${mediaId}/complete`,
          headers: guest,
        })
      ).statusCode,
    ).toBe(200);
    const submission = await f.app.inject({
      method: "POST",
      url: `/v1/idea-boards/${sourceId}/ideas`,
      headers: guest,
      payload: {
        body: "Image evidence",
        attachments: [{ mediaId, alt: "A drawing" }],
        idempotencyKey: randomUUID(),
      },
    });
    expect(submission.statusCode, submission.body).toBe(200);
    const url = `/v1/canvas-boards/${board.id}/media/${mediaId}`;
    const permitted = await f.app.inject({ url, headers: f.editor.headers });
    expect(permitted.statusCode, permitted.body).toBe(200);
    expect(permitted.headers).toMatchObject({
      "cache-control": "private, no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    });
    let entered!: () => void, release!: (bytes: Buffer<ArrayBuffer>) => void;
    const reading = new Promise<void>((resolve) => {
      entered = resolve;
    });
    read.mockImplementationOnce(async () => {
      entered();
      return new Promise<Buffer<ArrayBuffer>>((resolve) => {
        release = resolve;
      });
    });
    const pendingRead = f.app.inject({ url, headers: f.editor.headers });
    await reading;
    const revoke = await f.app.inject({
      method: "DELETE",
      url: `/v1/canvas-boards/${board.id}/grants/${f.editor.userId}`,
      headers: f.owner.headers,
    });
    expect(revoke.statusCode, revoke.body).toBe(204);
    release(Buffer.from("protected image bytes"));
    const denied = await pendingRead;
    expect(denied.statusCode, denied.body).toBe(404);
    expect(denied.body).not.toContain("protected image bytes");
  });
});
