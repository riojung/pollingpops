import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { expect, vi } from "vitest";
import {
  CanvasBoardViewSchema,
  CanvasObjectCreateSchema,
  type CanvasBoardCommand,
  type CanvasBoardView,
  type CanvasFacilitationCommand,
  type ProductFeatureRules,
} from "@openround/contracts";
import { createPlatformRepository, MemoryRepository } from "@openround/db";
import { buildApp } from "../../src/app.js";
import { MemorySessionCache } from "../../src/cache.js";
import { ConfigSchema } from "../../src/config.js";
import { mediaFinalizationObjectKey } from "../../src/storage.js";
import { signInFromVerificationResponse } from "./email-auth.js";

const apps: FastifyInstance[] = [];
export async function closeCanvasFacilitationFixtures() {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.restoreAllMocks();
}
export const canvasFacilitationFeatures: ProductFeatureRules = {
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
export async function canvasFacilitationFixture(media = false) {
  const repository = new MemoryRepository();
  const config = ConfigSchema.parse({
    NODE_ENV: "test",
    ALLOW_IN_MEMORY: "true",
    BUSINESS_PLATFORM_ENABLED: "true",
    LOG_LEVEL: "silent",
    FEATURE_MEDIA_UPLOADS: String(media),
    ...(media
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
    scanner: media ? { scan: async () => ({ clean: true, signature: null }) } : null,
    mailer: {
      sendAccountVerification: async () => {},
      sendSignInPin: async () => {},
      sendWorkspaceInvitation: async () => {},
    },
  });
  apps.push(built.app);
  const owner = await signIn(built.app, "facilitation-owner@example.com");
  const editor = await signIn(built.app, "facilitation-editor@example.com");
  const billing = await signIn(built.app, "facilitation-billing@example.com");
  const outsider = await signIn(built.app, "facilitation-outsider@example.com");
  const platform = createPlatformRepository(repository);
  await platform.saveFeaturePolicy({
    expectedRevision: 0,
    features: structuredClone(canvasFacilitationFeatures),
  });
  const organization = await platform.createOrganization({
    name: "Synthetic facilitation team",
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
export type CanvasFacilitationFixture = Awaited<ReturnType<typeof canvasFacilitationFixture>>;
export type CanvasFixtureActor = CanvasFacilitationFixture["owner"];
export async function createFacilitationCanvas(
  f: CanvasFacilitationFixture,
  extra: Record<string, unknown> = {},
) {
  const response = await f.app.inject({
    method: "POST",
    url: "/v1/canvas-boards",
    headers: f.owner.headers,
    payload: {
      schemaVersion: 2,
      workspaceId: f.workspaceId,
      title: "Synthetic facilitation board",
      boardType: "team",
      operationId: randomUUID(),
      ...extra,
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return CanvasBoardViewSchema.parse(response.json().board);
}
export async function shareFacilitationCanvas(
  f: CanvasFacilitationFixture,
  board: CanvasBoardView,
  actor: CanvasFixtureActor,
  role: "editor" | "viewer" | "facilitator",
) {
  const invited = await f.app.inject({
    method: "POST",
    url: `/v1/canvas-boards/${board.id}/invitations`,
    headers: f.owner.headers,
    payload: { email: actor.email, role, operationId: randomUUID() },
  });
  expect(invited.statusCode, invited.body).toBe(201);
  const accepted = await f.app.inject({
    method: "POST",
    url: `/v1/canvas-boards/invitations/${invited.json().invitation.id}/accept`,
    headers: actor.headers,
    payload: {},
  });
  expect(accepted.statusCode, accepted.body).toBe(200);
}
export function canvasObjectCommand(
  f: CanvasFacilitationFixture,
  board: CanvasBoardView,
  command: CanvasBoardCommand,
  actor = f.owner,
  operationId = randomUUID(),
) {
  return f.app.inject({
    method: "POST",
    url: `/v1/canvas-boards/${board.id}/commands`,
    headers: actor.headers,
    payload: { schemaVersion: 2, operationId, command },
  });
}
export function facilitateCanvas(
  f: CanvasFacilitationFixture,
  board: CanvasBoardView,
  command: CanvasFacilitationCommand,
  actor = f.owner,
  operationId = randomUUID(),
) {
  return f.app.inject({
    method: "POST",
    url: `/v1/canvas-boards/${board.id}/facilitation/commands`,
    headers: actor.headers,
    payload: { schemaVersion: 1, operationId, command },
  });
}
export async function insertCanvasObjects(
  f: CanvasFacilitationFixture,
  board: CanvasBoardView,
  values: Record<string, unknown>[],
) {
  const objects = values.map((value) =>
    CanvasObjectCreateSchema.parse({
      id: randomUUID(),
      type: "sticky",
      x: 20,
      y: 20,
      width: 240,
      height: 180,
      text: "Synthetic note",
      ...value,
    }),
  );
  const response = await canvasObjectCommand(f, board, {
    type: "batch",
    operations: objects.map((object) => ({ type: "create", object })),
  });
  expect(response.statusCode, response.body).toBe(200);
  return CanvasBoardViewSchema.parse(response.json().board);
}
export async function createFacilitationWorkshop(
  f: CanvasFacilitationFixture,
  ideasVisible = false,
) {
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
    payload: {
      title: "Synthetic facilitation workshop",
      ideasVisible,
      idempotencyKey: randomUUID(),
    },
  });
  expect(source.statusCode, source.body).toBe(201);
  const sourceId = source.json().board.id as string;
  const board = await createFacilitationCanvas(f, {
    boardType: "workshop",
    sourceBoardId: sourceId,
  });
  const opening = await canvasObjectCommand(f, board, {
    type: "workshop",
    expectedRevision: source.json().board.revision,
    command: { type: "collect" },
  });
  expect(opening.statusCode, opening.body).toBe(200);
  const guest = { authorization: `Bearer ${randomBytes(32).toString("hex")}` };
  const joined = await f.app.inject({
    method: "POST",
    url: `/v1/idea-boards/${sourceId}/join`,
    headers: guest,
    payload: {},
  });
  expect(joined.statusCode, joined.body).toBe(200);
  return { board: CanvasBoardViewSchema.parse(opening.json().board), sourceId, guest };
}
export const syntheticCanvasPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP4sAAAAASUVORK5CYII=",
  "base64",
);
export function syntheticCanvasStorage(f: CanvasFacilitationFixture) {
  vi.spyOn(f.storage, "finalize").mockImplementation(async (asset, token) => ({
    scanStatus: "clean",
    objectKey: mediaFinalizationObjectKey(asset, token),
  }));
  vi.spyOn(f.storage, "commitFinalizationCandidate").mockResolvedValue();
  vi.spyOn(f.storage, "cleanupFinalization").mockResolvedValue();
  return vi.spyOn(f.storage, "readImage").mockResolvedValue(syntheticCanvasPng);
}
export async function insertFacilitationImage(
  f: CanvasFacilitationFixture,
  board: CanvasBoardView,
) {
  const requested = await f.app.inject({
    method: "POST",
    url: `/v1/canvas-boards/${board.id}/media`,
    headers: f.owner.headers,
    payload: {
      fileName: "synthetic.png",
      mimeType: "image/png",
      sizeBytes: syntheticCanvasPng.length,
      altText: "Synthetic diagram",
    },
  });
  expect(requested.statusCode, requested.body).toBe(201);
  const mediaId = requested.json().mediaId as string;
  const completed = await f.app.inject({
    method: "POST",
    url: `/v1/canvas-boards/${board.id}/media/${mediaId}/complete`,
    headers: f.owner.headers,
    payload: {},
  });
  expect(completed.statusCode, completed.body).toBe(200);
  const next = await insertCanvasObjects(f, board, [
    { type: "image", mediaId, altText: "Synthetic diagram", text: "" },
  ]);
  return {
    board: next,
    mediaId,
    object: next.objects.find((object) => object.type === "image" && object.mediaId === mediaId)!,
  };
}
export function delayedCanvasImageRead(read: ReturnType<typeof syntheticCanvasStorage>) {
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
  return { reading, release: () => release(syntheticCanvasPng) };
}
