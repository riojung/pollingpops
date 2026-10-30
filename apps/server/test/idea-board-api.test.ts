import { signInFromVerificationResponse, requestPinAndSignIn } from "./support/email-auth.js";
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
import { mediaFinalizationObjectKey, StorageService } from "../src/storage.js";

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
  const verified = await signInFromVerificationResponse(app, magic, email);
  return { cookie: String(verified.headers["set-cookie"]).split(";")[0]! };
}
async function fixture(
  enabled = true,
  plan: "free" | "pro" = "free",
  configureCache?: (cache: MemorySessionCache) => void,
  mediaEnabled = false,
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
    FEATURE_MEDIA_UPLOADS: String(mediaEnabled),
    ...(mediaEnabled
      ? {
          S3_ENDPOINT: "http://127.0.0.1:9000",
          S3_ACCESS_KEY_ID: "test-access",
          S3_SECRET_ACCESS_KEY: "test-secret",
        }
      : {}),
  });
  const cache = new MemorySessionCache();
  configureCache?.(cache);
  const { app } = await buildApp(config, {
    repository,
    cache,
    scanner: mediaEnabled ? { scan: async () => ({ clean: true, signature: null }) } : null,
  });
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
  expect(accepted.headers["set-cookie"]).toBeUndefined();
  const acceptedSignIn = await requestPinAndSignIn(app, `board-${role}@example.com`);
  expect(accepted.statusCode, accepted.body).toBe(200);
  return { cookie: String(acceptedSignIn.headers["set-cookie"]).split(";")[0]! };
}

describe("independent idea board APIs", () => {
  it.each(["userId", "workspaceId"] as const)(
    "rejects stale guided setup %s before looking up receipts or creating workshops",
    async (field) => {
      const { app, headers } = await fixture();
      const account = await app.inject({ method: "GET", url: "/v1/auth/me", headers });
      expect(account.statusCode, account.body).toBe(200);
      const current = account.json().creator as { userId: string; workspaceId: string };
      const setupContext = { userId: current.userId, workspaceId: current.workspaceId };
      const payload = {
        schemaVersion: 1,
        title: "Original starter workshop",
        description: "Edited setup prompt",
        idempotencyKey: randomUUID(),
      };
      const receipt = vi.spyOn(IdeaBoardRepository.prototype, "getCreation");
      const create = vi.spyOn(IdeaBoardRepository.prototype, "create");
      const stale = await app.inject({
        method: "POST",
        url: "/v1/idea-boards",
        headers,
        payload: { ...payload, setupContext: { ...setupContext, [field]: randomUUID() } },
      });
      expect(stale.statusCode, stale.body).toBe(409);
      expect(stale.json().error.code).toBe("SETUP_CONTEXT_CHANGED");
      expect(receipt).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
      const restored = await app.inject({
        method: "POST",
        url: "/v1/idea-boards",
        headers,
        payload: { ...payload, setupContext },
      });
      expect(restored.statusCode, restored.body).toBe(201);
      const id = restored.json().board.id;
      const legacyReplay = await app.inject({
        method: "POST",
        url: "/v1/idea-boards",
        headers,
        payload,
      });
      expect(legacyReplay.statusCode, legacyReplay.body).toBe(201);
      expect(legacyReplay.json().board.id).toBe(id);
      const guardedReplay = await app.inject({
        method: "POST",
        url: "/v1/idea-boards",
        headers,
        payload: { ...payload, setupContext },
      });
      expect(guardedReplay.statusCode, guardedReplay.body).toBe(201);
      expect(guardedReplay.json().board.id).toBe(id);
      const listed = await app.inject({ method: "GET", url: "/v1/idea-boards", headers });
      expect(listed.json().boards.map((board: { id: string }) => board.id)).toEqual([id]);
      const calls = receipt.mock.calls.length;
      const other = await signIn(app, `other-setup-${randomUUID()}@example.com`);
      const anotherIdentity = await app.inject({
        method: "POST",
        url: "/v1/idea-boards",
        headers: other,
        payload: { ...payload, setupContext },
      });
      expect(anotherIdentity.statusCode, anotherIdentity.body).toBe(409);
      expect(anotherIdentity.json().error.code).toBe("SETUP_CONTEXT_CHANGED");
      expect(receipt.mock.calls).toHaveLength(calls);
      expect(create.mock.calls).toHaveLength(3);
    },
  );

  it("searches retained titles before pagination, including boards beyond the initial page", async () => {
    const { app, headers } = await fixture();
    const created: Array<{ id: string; title: string }> = [];
    for (let index = 0; index < 52; index++) {
      const { board } = await createBoard(app, headers, { title: `Search board ${randomUUID()}` });
      created.push({ id: board.id, title: board.title });
    }
    await createBoard(app, headers, { title: "Different workshop" });
    const initial = await app.inject({ method: "GET", url: "/v1/idea-boards?limit=50", headers });
    expect(initial.statusCode, initial.body).toBe(200);
    expect(initial.json().boards).toHaveLength(50);
    const visible = new Set(initial.json().boards.map((board: { id: string }) => board.id));
    const later = created.find((board) => !visible.has(board.id))!;
    expect(later).toBeDefined();
    const found = await app.inject({
      method: "GET",
      url: `/v1/idea-boards?limit=1&search=${encodeURIComponent(`  ${later.title.toUpperCase()}  `)}`,
      headers,
    });
    expect(found.statusCode, found.body).toBe(200);
    expect(found.json().boards.map((board: { id: string }) => board.id)).toEqual([later.id]);
    expect(found.json().nextCursor).toBeNull();
    const firstMatch = await app.inject({
      method: "GET",
      url: "/v1/idea-boards?limit=1&search=search%20board",
      headers,
    });
    expect(firstMatch.statusCode, firstMatch.body).toBe(200);
    const nextMatch = await app.inject({
      method: "GET",
      url: `/v1/idea-boards?limit=1&search=search%20board&cursor=${firstMatch.json().nextCursor}`,
      headers,
    });
    expect(nextMatch.statusCode, nextMatch.body).toBe(200);
    expect([firstMatch.json().boards[0].id, nextMatch.json().boards[0].id]).toEqual(
      created
        .map((board) => board.id)
        .sort()
        .slice(0, 2),
    );
    const invalid = await app.inject({
      method: "GET",
      url: `/v1/idea-boards?search=${"x".repeat(161)}`,
      headers,
    });
    expect(invalid.statusCode).toBe(400);
    const anonymous = await app.inject({ method: "GET", url: "/v1/idea-boards?search=search" });
    expect(anonymous.statusCode).toBe(401);
  });

  it("reports image availability on guest responses and refuses uploads without storage and scanning", async () => {
    const { app, headers } = await fixture();
    const { board } = await createBoard(app, headers);
    await host(app, board.id, headers, { type: "collect" });
    const guest = guestHeaders();
    expect((await join(app, board.id, guest)).imageUploadsAvailable).toBe(false);
    const unavailable = await app.inject({
      method: "POST",
      url: `/v1/idea-boards/${board.id}/media`,
      headers: guest,
      payload: {
        fileName: "diagram.png",
        mimeType: "image/png",
        sizeBytes: 8,
        altText: "A diagram",
      },
    });
    expect(unavailable.statusCode, unavailable.body).toBe(503);
    expect(unavailable.json().error.code).toBe("DEPENDENCY_UNAVAILABLE");
    const submitted = await app.inject({
      method: "POST",
      url: `/v1/idea-boards/${board.id}/ideas`,
      headers: guest,
      payload: { body: "A text idea", idempotencyKey: randomUUID() },
    });
    expect(submitted.statusCode, submitted.body).toBe(200);
    expect(submitted.json().imageUploadsAvailable).toBe(false);
    const resumed = await app.inject({
      method: "GET",
      url: `/v1/idea-boards/${board.id}/guest`,
      headers: guest,
    });
    expect(resumed.json().imageUploadsAvailable).toBe(false);
  });

  it("keeps image tickets, completion, and binary delivery scoped to the board, author, and moderation state", async () => {
    const { app, headers, repository, workspaceId } = await fixture(true, "free", undefined, true);
    vi.spyOn(StorageService.prototype, "finalize").mockImplementation(async (asset, token) => ({
      scanStatus: "clean",
      objectKey: mediaFinalizationObjectKey(asset, token),
    }));
    vi.spyOn(StorageService.prototype, "commitFinalizationCandidate").mockResolvedValue();
    vi.spyOn(StorageService.prototype, "cleanupFinalization").mockResolvedValue();
    const read = vi
      .spyOn(StorageService.prototype, "readImage")
      .mockResolvedValue(Buffer.from("private scanned image"));
    const signedDownload = vi.spyOn(StorageService.prototype, "createDownloadUrl");
    const { board } = await createBoard(app, headers);
    await host(app, board.id, headers, { type: "collect" });
    const author = guestHeaders(),
      other = guestHeaders();
    expect((await join(app, board.id, author)).imageUploadsAvailable).toBe(true);
    await join(app, board.id, other);
    const uploadPayload = {
      fileName: "diagram.png",
      mimeType: "image/png",
      sizeBytes: 8,
      altText: "A useful diagram",
    };
    const deniedTicket = await app.inject({
      method: "POST",
      url: `/v1/idea-boards/${board.id}/media`,
      headers: guestHeaders(),
      payload: uploadPayload,
    });
    expect(deniedTicket.statusCode, deniedTicket.body).toBe(401);
    const ticket = await app.inject({
      method: "POST",
      url: `/v1/idea-boards/${board.id}/media`,
      headers: author,
      payload: uploadPayload,
    });
    expect(ticket.statusCode, ticket.body).toBe(201);
    const mediaId = ticket.json().mediaId as string;
    expect(ticket.json()).toMatchObject({
      scanStatus: "pending",
      expiresInSeconds: 600,
      uploadUrl: expect.stringContaining("quarantine/"),
    });
    const completeUrl = `/v1/idea-boards/${board.id}/media/${mediaId}/complete`;
    const contentUrl = `/v1/idea-boards/${board.id}/media/${mediaId}/content`;
    const wrongOwner = await app.inject({ method: "POST", url: completeUrl, headers: other });
    expect(wrongOwner.statusCode, wrongOwner.body).toBe(404);
    const incomplete = await app.inject({ method: "GET", url: contentUrl, headers: author });
    expect(incomplete.statusCode, incomplete.body).toBe(404);
    const complete = await app.inject({ method: "POST", url: completeUrl, headers: author });
    expect(complete.statusCode, complete.body).toBe(200);
    expect(complete.json()).toEqual({
      media: { id: mediaId, scanStatus: "clean", altText: uploadPayload.altText },
    });
    const preview = await app.inject({ method: "GET", url: contentUrl, headers: author });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.body).toBe("private scanned image");
    expect(preview.headers).toMatchObject({
      "content-type": "image/png",
      "cache-control": "private, no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    });
    const privatePreview = await app.inject({ method: "GET", url: contentUrl, headers: other });
    expect(privatePreview.statusCode, privatePreview.body).toBe(404);
    const submitted = await app.inject({
      method: "POST",
      url: `/v1/idea-boards/${board.id}/ideas`,
      headers: author,
      payload: {
        body: "Diagram proposal",
        attachments: [{ mediaId, alt: "A useful diagram" }],
        idempotencyKey: randomUUID(),
      },
    });
    expect(submitted.statusCode, submitted.body).toBe(200);
    const ideaId = submitted.json().receipt.ideaId as string;
    const moderatorView = await app.inject({ method: "GET", url: contentUrl, headers });
    expect(moderatorView.statusCode, moderatorView.body).toBe(200);
    const pending = await app.inject({ method: "GET", url: contentUrl, headers: other });
    expect(pending.statusCode, pending.body).toBe(404);
    await host(app, board.id, headers, { type: "moderate", ideaId, status: "approved" });
    const hidden = await app.inject({ method: "GET", url: contentUrl, headers: other });
    expect(hidden.statusCode, hidden.body).toBe(404);
    await host(app, board.id, headers, { type: "visibility", visible: true });
    const visible = await app.inject({ method: "GET", url: contentUrl, headers: other });
    expect(visible.statusCode, visible.body).toBe(200);
    expect(signedDownload).not.toHaveBeenCalled();

    const unrelatedId = randomUUID();
    await repository.createMediaAsset({
      id: unrelatedId,
      workspaceId,
      objectKey: `media/${workspaceId}/${unrelatedId}.png`,
      mimeType: "image/png",
      sizeBytes: 8,
      altText: "Creator private image",
      scanStatus: "clean",
      createdAt: new Date(),
    });
    for (const path of [
      `/v1/idea-boards/${board.id}/media/${unrelatedId}/content`,
      `/v1/idea-boards/${board.id}/media/${unrelatedId}/complete`,
    ]) {
      const response = await app.inject({
        method: path.endsWith("complete") ? "POST" : "GET",
        url: path,
        headers: author,
      });
      expect(response.statusCode, response.body).toBe(404);
    }
    read.mockImplementationOnce(async () => {
      await host(app, board.id, headers, { type: "moderate", ideaId, status: "removed" });
      return Buffer.from("removed private image");
    });
    const removedDuringRead = await app.inject({ method: "GET", url: contentUrl, headers: other });
    expect(removedDuringRead.statusCode, removedDuringRead.body).toBe(404);
    expect(removedDuringRead.body).not.toContain("removed private image");
  });

  it("keeps historical image reads available when new uploads pause and rechecks expiry after storage", async () => {
    const { app, headers, repository } = await fixture(true, "free", undefined, true);
    vi.spyOn(StorageService.prototype, "finalize").mockImplementation(async (asset, token) => ({
      scanStatus: "clean",
      objectKey: mediaFinalizationObjectKey(asset, token),
    }));
    vi.spyOn(StorageService.prototype, "commitFinalizationCandidate").mockResolvedValue();
    vi.spyOn(StorageService.prototype, "cleanupFinalization").mockResolvedValue();
    const read = vi
      .spyOn(StorageService.prototype, "readImage")
      .mockResolvedValue(Buffer.from("private image"));
    const { board } = await createBoard(app, headers, {
      moderationEnabled: false,
      ideasVisible: true,
    });
    await host(app, board.id, headers, { type: "collect" });
    const author = guestHeaders();
    await join(app, board.id, author);
    const ticket = await app.inject({
      method: "POST",
      url: `/v1/idea-boards/${board.id}/media`,
      headers: author,
      payload: { fileName: "diagram.png", mimeType: "image/png", sizeBytes: 8, altText: "Diagram" },
    });
    expect(ticket.statusCode, ticket.body).toBe(201);
    const mediaId = ticket.json().mediaId as string;
    const complete = await app.inject({
      method: "POST",
      url: `/v1/idea-boards/${board.id}/media/${mediaId}/complete`,
      headers: author,
    });
    expect(complete.statusCode, complete.body).toBe(200);
    const idea = await app.inject({
      method: "POST",
      url: `/v1/idea-boards/${board.id}/ideas`,
      headers: author,
      payload: {
        body: "Image idea",
        attachments: [{ mediaId, alt: "Diagram" }],
        idempotencyKey: randomUUID(),
      },
    });
    expect(idea.statusCode, idea.body).toBe(200);
    const operational = await repository.getOperationalFeatures();
    vi.spyOn(repository, "getOperationalFeatures").mockResolvedValue({
      ...operational,
      mediaUploads: false,
    });
    const contentUrl = `/v1/idea-boards/${board.id}/media/${mediaId}/content`;
    const historical = await app.inject({ method: "GET", url: contentUrl, headers: author });
    expect(historical.statusCode, historical.body).toBe(200);
    const resumed = await app.inject({
      method: "GET",
      url: `/v1/idea-boards/${board.id}/guest`,
      headers: author,
    });
    expect(resumed.json().imageUploadsAvailable).toBe(false);
    vi.useFakeTimers({ toFake: ["Date"] });
    read.mockImplementationOnce(async () => {
      vi.setSystemTime(Date.parse(board.expiresAt) + 1);
      return Buffer.from("expired image");
    });
    const expired = await app.inject({ method: "GET", url: contentUrl, headers: author });
    expect(expired.statusCode, expired.body).toBe(404);
    expect(expired.body).not.toContain("expired image");
  });

  it("blocks generic creator media routes from signing or finalizing private board uploads", async () => {
    const { app, headers, repository, workspaceId } = await fixture(true, "free", undefined, true);
    const finalize = vi
      .spyOn(StorageService.prototype, "finalize")
      .mockImplementation(async (asset, token) => ({
        scanStatus: "clean",
        objectKey: mediaFinalizationObjectKey(asset, token),
      }));
    vi.spyOn(StorageService.prototype, "commitFinalizationCandidate").mockResolvedValue();
    vi.spyOn(StorageService.prototype, "cleanupFinalization").mockResolvedValue();
    const signed = vi
      .spyOn(StorageService.prototype, "createDownloadUrl")
      .mockResolvedValue("https://storage.example.test/ordinary-image");
    const { board } = await createBoard(app, headers);
    await host(app, board.id, headers, { type: "collect" });
    const author = guestHeaders();
    await join(app, board.id, author);
    const viewer = await member(app, headers, "viewer");
    const ticket = await app.inject({
      method: "POST",
      url: `/v1/idea-boards/${board.id}/media`,
      headers: author,
      payload: {
        fileName: "diagram.png",
        mimeType: "image/png",
        sizeBytes: 8,
        altText: "Private diagram",
      },
    });
    expect(ticket.statusCode, ticket.body).toBe(201);
    const mediaId = ticket.json().mediaId as string;
    const generic = async (imageId: string, owner: Headers, method: "GET" | "POST") =>
      app.inject({
        method,
        url: `/v1/media/${imageId}${method === "POST" ? "/complete" : ""}`,
        headers: owner,
      });
    for (const method of ["GET", "POST"] as const) {
      const response = await generic(mediaId, headers, method);
      expect(response.statusCode, response.body).toBe(404);
    }
    expect(finalize).not.toHaveBeenCalled();
    const completed = await app.inject({
      method: "POST",
      url: `/v1/idea-boards/${board.id}/media/${mediaId}/complete`,
      headers: author,
    });
    expect(completed.statusCode, completed.body).toBe(200);
    expect(finalize).toHaveBeenCalledOnce();
    for (const owner of [headers, viewer]) {
      const response = await generic(mediaId, owner, "GET");
      expect(response.statusCode, response.body).toBe(404);
    }
    const completeBypass = await generic(mediaId, headers, "POST");
    expect(completeBypass.statusCode, completeBypass.body).toBe(404);
    expect(finalize).toHaveBeenCalledOnce();
    expect(signed).not.toHaveBeenCalled();

    const ordinaryId = randomUUID();
    await repository.createMediaAsset({
      id: ordinaryId,
      workspaceId,
      objectKey: `media/${workspaceId}/${ordinaryId}.png`,
      mimeType: "image/png",
      sizeBytes: 8,
      altText: "Ordinary creator image",
      scanStatus: "clean",
      createdAt: new Date(),
    });
    for (const method of ["GET", "POST"] as const) {
      const response = await generic(ordinaryId, headers, method);
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json().downloadUrl).toBe("https://storage.example.test/ordinary-image");
    }
    expect(signed).toHaveBeenCalledTimes(2);
    const deleted = await app.inject({
      method: "DELETE",
      url: `/v1/idea-boards/${board.id}`,
      headers,
    });
    expect(deleted.statusCode, deleted.body).toBe(204);
    for (const method of ["GET", "POST"] as const) {
      const response = await generic(mediaId, headers, method);
      expect(response.statusCode, response.body).toBe(404);
    }
    expect(signed).toHaveBeenCalledTimes(2);
  });

  it("reauthorizes image access after the final asset lookup waits beyond board expiry", async () => {
    const { app, headers, repository } = await fixture(true, "free", undefined, true);
    vi.spyOn(StorageService.prototype, "finalize").mockImplementation(async (asset, token) => ({
      scanStatus: "clean",
      objectKey: mediaFinalizationObjectKey(asset, token),
    }));
    vi.spyOn(StorageService.prototype, "commitFinalizationCandidate").mockResolvedValue();
    vi.spyOn(StorageService.prototype, "cleanupFinalization").mockResolvedValue();
    const { board } = await createBoard(app, headers);
    await host(app, board.id, headers, { type: "collect" });
    const author = guestHeaders();
    await join(app, board.id, author);
    const ticket = await app.inject({
      method: "POST",
      url: `/v1/idea-boards/${board.id}/media`,
      headers: author,
      payload: {
        fileName: "private.png",
        mimeType: "image/png",
        sizeBytes: 8,
        altText: "Private image",
      },
    });
    expect(ticket.statusCode, ticket.body).toBe(201);
    const mediaId = ticket.json().mediaId as string;
    const complete = await app.inject({
      method: "POST",
      url: `/v1/idea-boards/${board.id}/media/${mediaId}/complete`,
      headers: author,
    });
    expect(complete.statusCode, complete.body).toBe(200);
    let storageFinished = false;
    vi.spyOn(StorageService.prototype, "readImage").mockImplementationOnce(async () => {
      storageFinished = true;
      return Buffer.from("PRIVATE IMAGE AFTER METADATA WAIT");
    });
    let signalStarted!: () => void;
    let releaseRead!: () => void;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const original = repository.getMediaAsset.bind(repository);
    vi.spyOn(repository, "getMediaAsset").mockImplementation(async (...args) => {
      const asset = await original(...args);
      if (storageFinished) {
        signalStarted();
        await release;
      }
      return asset;
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    const reading = app.inject({
      method: "GET",
      url: `/v1/idea-boards/${board.id}/media/${mediaId}/content`,
      headers: author,
    });
    await started;
    vi.setSystemTime(Date.parse(board.expiresAt) + 1);
    releaseRead();
    const response = await reading;
    expect(response.statusCode, response.body).toBe(404);
    expect(response.body).not.toContain("PRIVATE IMAGE AFTER METADATA WAIT");
  });

  it("rechecks retained content after a delayed image availability read crosses board expiry", async () => {
    const { app, headers, repository } = await fixture(true, "free", undefined, true);
    const { board } = await createBoard(app, headers);
    await host(app, board.id, headers, { type: "collect" });
    const author = guestHeaders();
    await join(app, board.id, author);
    const submitted = await app.inject({
      method: "POST",
      url: `/v1/idea-boards/${board.id}/ideas`,
      headers: author,
      payload: { body: "Private retained content", idempotencyKey: randomUUID() },
    });
    expect(submitted.statusCode, submitted.body).toBe(200);
    const operational = await repository.getOperationalFeatures();
    let signalStarted!: () => void;
    let releaseRead!: () => void;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    vi.spyOn(repository, "getOperationalFeatures").mockImplementationOnce(async () => {
      signalStarted();
      await release;
      return operational;
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    const reading = app.inject({
      method: "GET",
      url: `/v1/idea-boards/${board.id}/guest`,
      headers: author,
    });
    await started;
    vi.setSystemTime(Date.parse(board.expiresAt) + 1);
    releaseRead();
    const response = await reading;
    expect(response.statusCode, response.body).toBe(404);
    expect(response.body).not.toContain("Private retained content");
  });

  it.each(["demoted", "removed"] as const)(
    "reauthorizes an editor %s during a deferred private image read",
    async (change) => {
      const { app, headers, repository, workspaceId } = await fixture(
        true,
        "free",
        undefined,
        true,
      );
      vi.spyOn(StorageService.prototype, "finalize").mockImplementation(async (asset, token) => ({
        scanStatus: "clean",
        objectKey: mediaFinalizationObjectKey(asset, token),
      }));
      vi.spyOn(StorageService.prototype, "commitFinalizationCandidate").mockResolvedValue();
      vi.spyOn(StorageService.prototype, "cleanupFinalization").mockResolvedValue();
      const { board } = await createBoard(app, headers);
      await host(app, board.id, headers, { type: "collect" });
      const author = guestHeaders();
      await join(app, board.id, author);
      const editor = await member(app, headers, "editor");
      const profile = await app.inject({ method: "GET", url: "/v1/auth/me", headers: editor });
      const editorId = profile.json().creator.userId as string;
      const ticket = await app.inject({
        method: "POST",
        url: `/v1/idea-boards/${board.id}/media`,
        headers: author,
        payload: {
          fileName: "private.png",
          mimeType: "image/png",
          sizeBytes: 8,
          altText: "Pending private image",
        },
      });
      expect(ticket.statusCode, ticket.body).toBe(201);
      const mediaId = ticket.json().mediaId as string;
      const complete = await app.inject({
        method: "POST",
        url: `/v1/idea-boards/${board.id}/media/${mediaId}/complete`,
        headers: author,
      });
      expect(complete.statusCode, complete.body).toBe(200);
      const submitted = await app.inject({
        method: "POST",
        url: `/v1/idea-boards/${board.id}/ideas`,
        headers: author,
        payload: {
          body: "Private pending proposal",
          attachments: [{ mediaId, alt: "Pending private image" }],
          idempotencyKey: randomUUID(),
        },
      });
      expect(submitted.statusCode, submitted.body).toBe(200);
      let signalStarted!: () => void;
      let releaseRead!: () => void;
      const started = new Promise<void>((resolve) => {
        signalStarted = resolve;
      });
      const release = new Promise<void>((resolve) => {
        releaseRead = resolve;
      });
      vi.spyOn(StorageService.prototype, "readImage").mockImplementationOnce(async () => {
        signalStarted();
        await release;
        return Buffer.from("PRIVATE IMAGE AFTER REVOCATION");
      });
      const reading = app.inject({
        method: "GET",
        url: `/v1/idea-boards/${board.id}/media/${mediaId}/content`,
        headers: editor,
      });
      await started;
      if (change === "demoted")
        expect(
          await repository.updateWorkspaceMemberRole(workspaceId, editorId, "viewer"),
        ).not.toBeNull();
      else expect(await repository.removeWorkspaceMember(workspaceId, editorId)).toBe(true);
      releaseRead();
      const response = await reading;
      expect(response.statusCode, response.body).toBe(change === "demoted" ? 404 : 401);
      expect(response.body).not.toContain("PRIVATE IMAGE AFTER REVOCATION");
      expect(response.headers["content-type"]).not.toContain("image/");
    },
  );

  it("allocates a server board ID and replays exact and concurrent creation retries", async () => {
    const { app, headers } = await fixture();
    const payload = { title: "Concurrent priorities", idempotencyKey: randomUUID() };
    const responses = await Promise.all(
      Array.from({ length: 3 }, () =>
        app.inject({ method: "POST", url: "/v1/idea-boards", headers, payload }),
      ),
    );
    for (const response of responses) expect(response.statusCode, response.body).toBe(201);
    const board = IdeaBoardViewSchema.parse(responses[0]!.json().board);
    expect(board.id).not.toBe(payload.idempotencyKey);
    for (const response of responses) expect(response.json().board).toEqual(board);
    const retry = await app.inject({ method: "POST", url: "/v1/idea-boards", headers, payload });
    expect(retry.statusCode, retry.body).toBe(201);
    expect(retry.json().board).toEqual(board);
    const listed = await app.inject({ method: "GET", url: "/v1/idea-boards", headers });
    expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.json().boards.map((entry: { id: string }) => entry.id)).toEqual([board.id]);
  });

  describe.each(["delete", "retention purge"] as const)("after %s", (removal) => {
    it.each(["same workspace", "another workspace"] as const)(
      "keeps an old guest link unavailable when its UUID is reused as a creation key in %s",
      async (scope) => {
        vi.useFakeTimers({ toFake: ["Date"] });
        const { app, headers, repository, config, workspaceId } = await fixture();
        const { board } = await createBoard(app, headers, { title: "Original board" });
        await host(app, board.id, headers, { type: "collect" });
        const originalGuest = guestHeaders();
        await join(app, board.id, originalGuest);
        if (removal === "delete") {
          const deleted = await app.inject({
            method: "DELETE",
            url: `/v1/idea-boards/${board.id}`,
            headers,
          });
          expect(deleted.statusCode, deleted.body).toBe(204);
        } else {
          vi.setSystemTime(new Date(board.expiresAt));
          expect(await repository.purgeExpired(new Date())).toContain(board.id);
        }
        const replacementEmail =
          scope === "same workspace" ? "board-owner@example.com" : "replacement-owner@example.com";
        vi.advanceTimersByTime(61_000);
        const replacementHeaders = await signIn(app, replacementEmail);
        const replacementOwner = [...repository.users.values()].find(
          (user) => user.email === replacementEmail,
        )!;
        if (scope === "another workspace") {
          expect(replacementOwner.workspaceId).not.toBe(workspaceId);
          config.CORE_PARITY_WORKSPACE_ALLOWLIST.push(replacementOwner.workspaceId);
        } else expect(replacementOwner.workspaceId).toBe(workspaceId);
        const { board: replacement } = await createBoard(app, replacementHeaders, {
          title: "Replacement board",
          idempotencyKey: board.id,
        });
        expect(replacement.id).not.toBe(board.id);
        await host(app, replacement.id, replacementHeaders, { type: "collect" });
        await join(app, replacement.id, guestHeaders());
        const publicReplacement = await app.inject({
          method: "GET",
          url: `/v1/idea-boards/${replacement.id}/public`,
        });
        expect(publicReplacement.statusCode, publicReplacement.body).toBe(200);
        expect(publicReplacement.json().board.title).toBe("Replacement board");
        for (const request of [
          { method: "GET" as const, url: `/v1/idea-boards/${board.id}/public` },
          {
            method: "GET" as const,
            url: `/v1/idea-boards/${board.id}/guest`,
            headers: originalGuest,
          },
          {
            method: "POST" as const,
            url: `/v1/idea-boards/${board.id}/join`,
            headers: guestHeaders(),
            payload: {},
          },
        ]) {
          const response = await app.inject(request);
          expect(response.statusCode, response.body).toBe(404);
          expect(response.json().error.code).toBe("NOT_FOUND");
          expect(response.body).not.toContain("Replacement board");
        }
      },
    );
  });

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
      payload: { body: "x".repeat(70_000), idempotencyKey: randomUUID() },
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
    expect(limited.headers["retry-after"]).toBe("60");
    expect(limited.json().error.retryAfterSeconds).toBe(60);
    limitedPrefix = "idea-board-guest:";
    const credentialLimited = await app.inject({
      method: "GET",
      url: `/v1/idea-boards/${board.id}/guest`,
      headers: guest,
    });
    expect(credentialLimited.statusCode).toBe(429);
    expect(credentialLimited.headers["retry-after"]).toBe("60");
    expect(credentialLimited.json().error.retryAfterSeconds).toBe(60);
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
