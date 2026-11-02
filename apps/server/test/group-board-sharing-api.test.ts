import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import {
  CANVAS_SCHEMA_VERSION,
  CanvasBoardSharingSchema,
  CanvasBoardViewSchema,
  IdeaBoardCreateSchema,
  type ProductFeatureKey,
  type ProductFeatureRules,
} from "@openround/contracts";
import {
  MemoryRepository,
  createIdeaBoardRepository,
  createPlatformRepository,
  memoryIdeaBoardCanvasSource,
} from "@openround/db";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";
import type { BoardInvitationMail } from "../src/mailer.js";
import { signInFromVerificationResponse } from "./support/email-auth.js";

const apps: FastifyInstance[] = [];
const webOrigin = "http://localhost:3000";
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function signIn(app: FastifyInstance, email: string) {
  const registration = await app.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: { email, segment: "workplace", acceptPolicies: true },
  });
  const response = await signInFromVerificationResponse(app, registration, email);
  const headers = { cookie: String(response.headers["set-cookie"]).split(";")[0]! };
  const me = await app.inject({ url: "/v1/auth/me", headers });
  expect(me.statusCode, me.body).toBe(200);
  return { headers, ...me.json<{ creator: { userId: string; workspaceId: string } }>().creator };
}

async function fixture() {
  const repository = new MemoryRepository();
  const mail: Array<{ email: string; invitation: BoardInvitationMail }> = [];
  const built = await buildApp(
    ConfigSchema.parse({
      NODE_ENV: "test",
      ALLOW_IN_MEMORY: "true",
      COMMUNITY_MODE: "false",
      BUSINESS_PLATFORM_ENABLED: "true",
      WEB_ORIGIN: webOrigin,
      PUBLIC_API_URL: "http://localhost:4000",
      LOG_LEVEL: "silent",
    }),
    {
      repository,
      cache: new MemorySessionCache(),
      mailer: {
        sendAccountVerification: async () => {},
        sendSignInPin: async () => {},
        sendWorkspaceInvitation: async () => {},
        sendOrganizationInvitation: async () => {},
        sendBoardInvitation: async (email, invitation) => {
          mail.push({ email, invitation: structuredClone(invitation) });
        },
      },
    },
  );
  apps.push(built.app);
  const owner = await signIn(built.app, "group-board-owner@example.test");
  const outsider = await signIn(built.app, "group-board-outsider@example.test");
  const platform = createPlatformRepository(repository);
  const features: ProductFeatureRules = Object.fromEntries(
    [
      "workspaceShell",
      "uxBeta",
      "groups",
      "ideaBoards",
      "canvasBoards",
      "canvasBoardSharing",
      "canvasBoardRealtime",
    ].map((key) => [key, { enabled: true, plans: ["free", "pro", "team"] }]),
  );
  await platform.saveFeaturePolicy({ expectedRevision: 0, features });
  const organization = await platform.createOrganization({
    actorId: owner.userId,
    name: "Board sharing team",
    accountType: "organization",
    licenseUnit: "user",
  });
  await platform.applySubscriptionSnapshot({
    organizationId: organization.id,
    customerId: null,
    subscriptionId: null,
    status: "active",
    licenseQuantity: 1,
    licenseUnit: "user",
    offerId: null,
    paidThrough: null,
    graceUntil: null,
    legacyPlan: "team",
  });
  const workspaceId = (
    await platform.getOrganizationUserLicenses(organization.id, owner.userId)
  ).assignments.find((assignment) => assignment.userId === owner.userId)!.workspaceId;
  const selected = await built.app.inject({
    method: "POST",
    url: `/v1/workspaces/${workspaceId}/select`,
    headers: owner.headers,
  });
  expect(selected.statusCode, selected.body).toBe(200);
  const me = await built.app.inject({ url: "/v1/auth/me", headers: owner.headers });
  expect(me.json().creator.workspaceId).toBe(workspaceId);
  const disable = async (key: ProductFeatureKey) => {
    const policy = (await platform.getFeaturePolicy())!;
    await platform.saveFeaturePolicy({
      expectedRevision: policy.revision,
      features: { ...policy.features, [key]: { enabled: false, plans: ["free", "pro", "team"] } },
    });
  };
  return { ...built, repository, owner, outsider, workspaceId, mail, disable };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function group(f: Fixture, foreign = false) {
  const response = await f.app.inject({
    method: "POST",
    url: "/v1/groups",
    headers: (foreign ? f.outsider : f.owner).headers,
    payload: { name: foreign ? "Foreign facilitators" : "Selected facilitators" },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ group: { id: string } }>().group;
}
async function ideaBoard(f: Fixture, foreign = false) {
  const response = await f.app.inject({
    method: "POST",
    url: "/v1/idea-boards",
    headers: (foreign ? f.outsider : f.owner).headers,
    payload: { title: "Guided planning workshop", idempotencyKey: randomUUID() },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ board: { id: string; title: string } }>().board;
}
async function detail(f: Fixture, groupId: string) {
  const response = await f.app.inject({ url: `/v1/groups/${groupId}`, headers: f.owner.headers });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<{
    group: {
      artifacts: Array<Record<string, unknown>>;
      canvasBoards: Array<Record<string, unknown>>;
    };
  }>().group;
}

describe("real-app board group sharing and guest invitation wiring", () => {
  it("shares Canvas groups atomically, curates metadata, and retains revocation across retries and feature changes", async () => {
    const f = await fixture(),
      selected = await group(f),
      foreign = await group(f, true);
    const created = await f.app.inject({
      method: "POST",
      url: "/v1/canvas-boards",
      headers: f.owner.headers,
      payload: {
        schemaVersion: CANVAS_SCHEMA_VERSION,
        workspaceId: f.workspaceId,
        title: "Group canvas",
        boardType: "team",
        operationId: randomUUID(),
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const board = CanvasBoardViewSchema.parse(created.json().board);
    const sharing = async () => {
      const response = await f.app.inject({
        url: `/v1/canvas-boards/${board.id}/sharing`,
        headers: f.owner.headers,
      });
      expect(response.statusCode, response.body).toBe(200);
      return CanvasBoardSharingSchema.parse(response.json());
    };
    const post = (payload: Record<string, unknown>, headers = f.owner.headers) =>
      f.app.inject({
        method: "POST",
        url: `/v1/canvas-boards/${board.id}/group-grants`,
        headers,
        payload,
      });
    const rejected = await post({
      operationId: randomUUID(),
      groupIds: [selected.id, foreign.id],
      role: "editor",
    });
    expect(rejected.statusCode, rejected.body).toBe(404);
    expect((await sharing()).groups).toEqual([]);
    const intent = { operationId: randomUUID(), groupIds: [selected.id], role: "editor" };
    const accepted = await post(intent);
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(CanvasBoardSharingSchema.parse(accepted.json()).groups).toEqual([
      expect.objectContaining({ groupId: selected.id, role: "editor", memberCount: 1 }),
    ]);
    expect((await sharing()).availableGroups.map(({ id }) => id)).toContain(selected.id);
    const listed = await detail(f, selected.id);
    expect(listed.canvasBoards).toEqual([
      expect.objectContaining({
        id: board.id,
        status: "active",
        objects: [],
        grants: [],
        invitations: [],
      }),
    ]);
    expect(listed.canvasBoards[0]).not.toHaveProperty("sourceBoard");
    const before = await f.app.inject({
      url: `/v1/canvas-boards/${board.id}`,
      headers: f.owner.headers,
    });
    expect((await post(intent)).statusCode).toBe(200);
    const after = await f.app.inject({
      url: `/v1/canvas-boards/${board.id}`,
      headers: f.owner.headers,
    });
    expect(after.json().board.canvasSeq).toBe(before.json().board.canvasSeq);
    expect((await post({ ...intent, role: "viewer" })).statusCode).toBe(409);
    expect(
      (await post({ ...intent, operationId: randomUUID() }, f.outsider.headers)).statusCode,
    ).toBe(404);
    const revokeIntent = { operationId: randomUUID() };
    const revoke = () =>
      f.app.inject({
        method: "DELETE",
        url: `/v1/canvas-boards/${board.id}/group-grants/${selected.id}`,
        headers: f.owner.headers,
        payload: revokeIntent,
      });
    const revoked = await revoke();
    expect(revoked.statusCode, revoked.body).toBe(200);
    expect(CanvasBoardSharingSchema.parse(revoked.json()).groups).toEqual([]);
    const revokedSequence = (
      await f.app.inject({ url: `/v1/canvas-boards/${board.id}`, headers: f.owner.headers })
    ).json().board.canvasSeq;
    expect((await revoke()).statusCode).toBe(200);
    expect(
      (
        await f.app.inject({ url: `/v1/canvas-boards/${board.id}`, headers: f.owner.headers })
      ).json().board.canvasSeq,
    ).toBe(revokedSequence);
    expect((await post(intent)).statusCode).toBe(200);
    expect((await sharing()).groups).toEqual([]);
    expect((await detail(f, selected.id)).canvasBoards).toEqual([]);
    await f.disable("groups");
    expect((await post({ ...intent, operationId: randomUUID() })).statusCode).toBe(404);
    expect(
      (
        await f.app.inject({
          url: `/v1/canvas-boards/${board.id}/sharing`,
          headers: f.owner.headers,
        })
      ).statusCode,
    ).toBe(404);
  });

  it("curates legacy Idea Boards only in their workspace and excludes expired or disabled boards without allowing scheduling", async () => {
    const f = await fixture(),
      selected = await group(f),
      board = await ideaBoard(f),
      foreign = await ideaBoard(f, true);
    const add = (artifactId: string) =>
      f.app.inject({
        method: "POST",
        url: `/v1/groups/${selected.id}/artifacts`,
        headers: f.owner.headers,
        payload: { artifactType: "idea_board", artifactId },
      });
    const added = await add(board.id);
    expect(added.statusCode, added.body).toBe(201);
    expect((await detail(f, selected.id)).artifacts).toEqual([
      expect.objectContaining({
        artifactType: "idea_board",
        artifactId: board.id,
        title: board.title,
        status: "draft",
        editHref: `/boards/${board.id}`,
        hostHref: `/boards/${board.id}`,
        assignHref: null,
      }),
    ]);
    expect((await add(foreign.id)).statusCode).toBe(404);
    const scheduled = await f.app.inject({
      method: "POST",
      url: `/v1/groups/${selected.id}/schedule`,
      headers: f.owner.headers,
      payload: {
        artifactType: "idea_board",
        artifactId: board.id,
        kind: "live_session",
        scheduledFor: new Date(Date.now() + 60_000).toISOString(),
      },
    });
    expect(scheduled.statusCode, scheduled.body).toBe(400);
    // Retained group metadata can outlive a board's deadline. Seed that historical
    // state through the real repository, then exercise fresh HTTP projection/admission.
    const past = new Date(Date.now() - 3 * 86_400_000);
    const expired = await createIdeaBoardRepository(f.repository).create(
      f.workspaceId,
      randomUUID(),
      IdeaBoardCreateSchema.parse({ title: "Expired retained workshop" }),
      randomUUID(),
      {
        participantLimit: 10,
        closesAt: new Date(past.getTime() + 86_400_000).toISOString(),
        expiresAt: new Date(past.getTime() + 2 * 86_400_000).toISOString(),
      },
      past,
    );
    await f.groups.addArtifact({
      id: randomUUID(),
      workspaceId: f.workspaceId,
      groupId: selected.id,
      artifactType: "idea_board",
      artifactId: expired.id,
      addedBy: f.owner.userId,
      createdAt: past,
    });
    expect((await add(expired.id)).statusCode).toBe(404);
    expect((await detail(f, selected.id)).artifacts.map((artifact) => artifact.artifactId)).toEqual(
      [board.id],
    );
    expect(
      (await f.app.inject({ url: `/v1/groups/${selected.id}`, headers: f.outsider.headers }))
        .statusCode,
    ).toBe(404);
    await f.disable("ideaBoards");
    expect((await detail(f, selected.id)).artifacts).toEqual([]);
    expect((await add(board.id)).statusCode).toBe(404);
  });

  it("dispatches external guest email through buildApp once without recipient accounts, sessions, or guest admission", async () => {
    const f = await fixture(),
      board = await ideaBoard(f);
    const emails = ["external-one@example.test", "external-two@example.test"];
    const usersBefore = f.repository.users.size,
      sessionsBefore = f.repository.creatorSessions.size;
    expect([...f.repository.users.values()].some((user) => emails.includes(user.email))).toBe(
      false,
    );
    expect(memoryIdeaBoardCanvasSource(f.repository, board.id)!.guests).toEqual([]);
    const payload = {
      operationId: randomUUID(),
      emails: [" External-One@Example.test ", ...emails],
    };
    const post = (input = payload, headers = f.owner.headers) =>
      f.app.inject({
        method: "POST",
        url: `/v1/idea-boards/${board.id}/invitations`,
        headers,
        payload: input,
      });
    const response = await post();
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      complete: true,
      results: emails.map((email) => ({ email, status: "sent" })),
    });
    expect(f.mail.map(({ email }) => email)).toEqual(emails);
    for (const { invitation } of f.mail) {
      expect(invitation).toMatchObject({
        kind: "idea_board",
        title: board.title,
        url: `${webOrigin}/board/${board.id}`,
      });
      expect(new URL(invitation.url).search + new URL(invitation.url).hash).toBe("");
    }
    const repeated = await post({ operationId: payload.operationId, emails: emails.toReversed() });
    expect(repeated.statusCode, repeated.body).toBe(200);
    expect(repeated.json().batchId).toBe(response.json().batchId);
    expect(f.mail).toHaveLength(2);
    expect(f.repository.users.size).toBe(usersBefore);
    expect(f.repository.creatorSessions.size).toBe(sessionsBefore);
    expect(memoryIdeaBoardCanvasSource(f.repository, board.id)!.guests).toEqual([]);
    const blocked = await post({ ...payload, operationId: randomUUID() }, f.outsider.headers);
    expect(blocked.statusCode, blocked.body).toBe(403);
    expect(f.mail).toHaveLength(2);
  });

  it("lets a separately licensed Canvas facilitator invite source-workshop guests without gaining workspace access", async () => {
    const f = await fixture();
    const platform = createPlatformRepository(f.repository);
    const organization = (await platform.getOrganizationForWorkspace(f.workspaceId))!;
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
    const facilitatorEmail = "separate-board-facilitator@example.test";
    const facilitator = await signIn(f.app, facilitatorEmail);
    await platform.setOrganizationMember({
      organizationId: organization.id,
      actorId: f.owner.userId,
      userId: facilitator.userId,
      role: "member",
    });
    await platform.assignOrganizationUserLicense(
      organization.id,
      f.owner.userId,
      facilitator.userId,
      true,
    );
    const homeWorkspaceId = (
      await platform.getOrganizationUserLicenses(organization.id, f.owner.userId)
    ).assignments.find((assignment) => assignment.userId === facilitator.userId)!.workspaceId;
    expect(homeWorkspaceId).not.toBe(f.workspaceId);
    const selected = await f.app.inject({
      method: "POST",
      url: `/v1/workspaces/${homeWorkspaceId}/select`,
      headers: facilitator.headers,
    });
    expect(selected.statusCode, selected.body).toBe(200);
    const source = await ideaBoard(f);
    const created = await f.app.inject({
      method: "POST",
      url: "/v1/canvas-boards",
      headers: f.owner.headers,
      payload: {
        schemaVersion: CANVAS_SCHEMA_VERSION,
        workspaceId: f.workspaceId,
        title: "Board-scoped facilitation",
        boardType: "workshop",
        sourceBoardId: source.id,
        operationId: randomUUID(),
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const canvas = CanvasBoardViewSchema.parse(created.json().board);
    const invitation = await f.app.inject({
      method: "POST",
      url: `/v1/canvas-boards/${canvas.id}/invitations`,
      headers: f.owner.headers,
      payload: { email: facilitatorEmail, role: "editor", operationId: randomUUID() },
    });
    expect(invitation.statusCode, invitation.body).toBe(201);
    const accepted = await f.app.inject({
      method: "POST",
      url: `/v1/canvas-boards/invitations/${invitation.json().invitation.id}/accept`,
      headers: facilitator.headers,
      payload: {},
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    const promoted = await f.app.inject({
      method: "POST",
      url: `/v1/canvas-boards/${canvas.id}/commands`,
      headers: f.owner.headers,
      payload: {
        schemaVersion: CANVAS_SCHEMA_VERSION,
        operationId: randomUUID(),
        command: { type: "grant", userId: facilitator.userId, role: "facilitator" },
      },
    });
    expect(promoted.statusCode, promoted.body).toBe(200);
    const scoped = await f.app.inject({
      url: `/v1/canvas-boards/${canvas.id}`,
      headers: facilitator.headers,
    });
    expect(scoped.statusCode, scoped.body).toBe(200);
    expect(scoped.json().board).toMatchObject({
      workspaceId: f.workspaceId,
      role: "facilitator",
      capabilities: { facilitate: true, share: true },
    });
    const moderator = await f.app.inject({
      url: `/v1/idea-boards/${source.id}`,
      headers: facilitator.headers,
    });
    expect(moderator.statusCode, moderator.body).toBe(404);
    expect(f.repository.workspaceMembers.has(`${f.workspaceId}:${facilitator.userId}`)).toBe(false);
    const membershipsBefore = f.repository.workspaceMembers.size;
    const inviteGuests = () =>
      f.app.inject({
        method: "POST",
        url: `/v1/idea-boards/${source.id}/invitations`,
        headers: facilitator.headers,
        payload: { operationId: randomUUID(), emails: ["external-facilitated@example.test"] },
      });
    const delivered = await inviteGuests();
    expect(delivered.statusCode, delivered.body).toBe(200);
    expect(delivered.json()).toMatchObject({
      complete: true,
      results: [{ email: "external-facilitated@example.test", status: "sent" }],
    });
    expect(f.mail).toHaveLength(1);
    expect(f.mail[0]!.invitation).toMatchObject({
      kind: "idea_board",
      url: `${webOrigin}/board/${source.id}`,
    });
    expect(f.repository.workspaceMembers.size).toBe(membershipsBefore);
    expect(f.repository.workspaceMembers.has(`${f.workspaceId}:${facilitator.userId}`)).toBe(false);
    expect(memoryIdeaBoardCanvasSource(f.repository, source.id)!.guests).toEqual([]);
    const home = await f.app.inject({ url: "/v1/auth/me", headers: facilitator.headers });
    expect(home.json().creator.workspaceId).toBe(homeWorkspaceId);
    const revoked = await f.app.inject({
      method: "DELETE",
      url: `/v1/canvas-boards/${canvas.id}/grants/${facilitator.userId}`,
      headers: f.owner.headers,
    });
    expect(revoked.statusCode, revoked.body).toBe(204);
    const blocked = await inviteGuests();
    expect(blocked.statusCode, blocked.body).toBe(403);
    expect(f.mail).toHaveLength(1);
    expect(memoryIdeaBoardCanvasSource(f.repository, source.id)!.guests).toEqual([]);
  });
});
