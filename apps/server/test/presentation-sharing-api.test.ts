import Fastify, { type FastifyInstance } from "fastify";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository } from "@openround/db";
import { PresentationContentSchema } from "@openround/contracts";
import { presentationSharingFixture } from "../../../packages/db/test/support/presentation-sharing-conformance.js";
import { registerPresentationSharingRoutes } from "../src/presentation-sharing-routes.js";
import { ConfigSchema } from "../src/config.js";
import { projectPresentationReview } from "../src/presentation-sharing-projection.js";
const apps: FastifyInstance[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
async function fixture() {
  const repository = new MemoryRepository(),
    mediaId = randomUUID(),
    f = await presentationSharingFixture(repository, "api-share", mediaId);
  const enabled = { value: true };
  const readImage = vi.fn(async () => Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const config = ConfigSchema.parse({
    NODE_ENV: "test",
    ALLOW_IN_MEMORY: "true",
    COMMUNITY_MODE: "false",
    LOG_LEVEL: "silent",
    WEB_ORIGIN: "http://localhost:3000",
    PUBLIC_API_URL: "http://localhost:4000",
  });
  const app = Fastify({ logger: false });
  apps.push(app);
  await registerPresentationSharingRoutes(app, {
    auth: { requireCreator: async () => f.actor },
    repository,
    shares: f.shares,
    storage: { readImage },
    config,
    consumeAdmission: async () => true,
    featureEnabled: async () => enabled.value,
  });
  const input = {
    requestId: randomUUID(),
    versionId: f.version.id,
    expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    token: randomBytes(32).toString("base64url"),
  };
  const create = (payload = input) =>
    app.inject({ method: "POST", url: `/v1/presentations/${f.presentation.id}/shares`, payload });
  const read = (id: string, token = input.token) =>
    app.inject({
      method: "GET",
      url: `/v1/shared-presentations/${id}`,
      headers: { authorization: `Bearer ${token}` },
    });
  return { ...f, repository, app, enabled, readImage, mediaId, input, create, read };
}
describe("private Presentation review APIs", () => {
  it("returns typed410 only for an unaccepted expired request and preserves accepted expired receipt recovery", async () => {
    const f = await fixture(),
      original = { ...f.input, expiresAt: new Date(Date.now() + 86_400_000).toISOString() };
    const accepted = await f.create(original);
    expect(accepted.statusCode, accepted.body).toBe(201);
    const known = accepted.json();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.parse(original.expiresAt) + 1));
    const retry = await f.create(original);
    expect(retry.statusCode, retry.body).toBe(200);
    expect(retry.json()).toEqual({ ...known, replayed: true });
    const unaccepted = {
      ...original,
      requestId: randomUUID(),
      token: randomBytes(32).toString("base64url"),
    };
    const expired = await f.create(unaccepted);
    expect(expired.statusCode, expired.body).toBe(410);
    expect(expired.json()).toEqual({
      error: {
        code: "PRESENTATION_SHARE_REQUEST_EXPIRED",
        message: expect.stringContaining("expired before it was accepted"),
      },
    });
    expect((await f.create({ ...original, token: unaccepted.token })).statusCode).toBe(409);
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: `/v1/presentations/${randomUUID()}/shares`,
          payload: unaccepted,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await f.app.inject({ url: `/v1/presentations/${f.presentation.id}/shares` })).json().shares,
    ).toHaveLength(1);
    expect((await f.read(known.share.id)).statusCode).toBe(404);
  });
  it("bounds concurrent image reads and returns retryable busy responses without weakening revocation", async () => {
    const f = await fixture(),
      created = (await f.create()).json(),
      waitingInput = {
        ...f.input,
        requestId: randomUUID(),
        token: randomBytes(32).toString("base64url"),
      },
      waitingShare = (await f.create(waitingInput)).json();
    let release: () => void = () => undefined,
      active = 0,
      peak = 0;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.readImage.mockImplementation(async () => {
      active++;
      peak = Math.max(peak, active);
      try {
        await gate;
        return Buffer.alloc(8);
      } finally {
        active--;
      }
    });
    const image = (id = created.share.id, token = f.input.token) =>
      f.app.inject({
        url: `/v1/shared-presentations/${id}/media/${f.mediaId}`,
        headers: { authorization: `Bearer ${token}` },
      });
    const admitted = Array.from({ length: 4 }, () => image());
    await vi.waitFor(() => expect(f.readImage).toHaveBeenCalledTimes(4));
    const busy = await Promise.all([image(), image(waitingShare.share.id, waitingInput.token)]);
    for (const response of busy) {
      expect(response.statusCode, response.body).toBe(503);
      expect(response.headers["retry-after"]).toBe("1");
      expect(response.headers["cache-control"]).toContain("no-store");
    }
    expect(peak).toBe(4);
    expect(f.readImage).toHaveBeenCalledTimes(4);
    await f.shares.revokeShare(
      f.actor.workspaceId,
      f.presentation.id,
      waitingShare.share.id,
      f.actor.userId,
      new Date(),
    );
    release();
    for (const response of await Promise.all(admitted))
      expect(response.statusCode, response.body).toBe(200);
    expect((await image()).statusCode).toBe(200);
    expect((await image(waitingShare.share.id, waitingInput.token)).statusCode).toBe(404);
    expect(f.readImage).toHaveBeenCalledTimes(5);
    expect(peak).toBe(4);
  });
  it("canonicalizes route and request UUID variants for exact retry, access, listing and revocation", async () => {
    const f = await fixture();
    const created = await f.app.inject({
      method: "POST",
      url: `/v1/presentations/${f.presentation.id.toUpperCase()}/shares`,
      payload: {
        ...f.input,
        versionId: f.input.versionId.toUpperCase(),
        requestId: f.input.requestId.toUpperCase(),
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const first = created.json(),
      retry = await f.create();
    expect(retry.statusCode, retry.body).toBe(200);
    expect(retry.json()).toEqual({ ...first, replayed: true });
    const publicId = first.share.id.toUpperCase(),
      headers = { authorization: `Bearer ${f.input.token}` };
    expect((await f.read(publicId)).statusCode).toBe(200);
    expect(
      (await f.app.inject({ url: `/v1/shared-presentations/${publicId}/access`, headers }))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await f.app.inject({ url: `/v1/presentations/${f.presentation.id.toUpperCase()}/shares` })
      ).json().shares,
    ).toHaveLength(1);
    expect(
      (
        await f.app.inject({
          method: "DELETE",
          url: `/v1/presentations/${f.presentation.id.toUpperCase()}/shares/${publicId}`,
        })
      ).statusCode,
    ).toBe(204);
    expect((await f.read(first.share.id)).statusCode).toBe(404);
  });
  it("pins old publication, recovers the exact lost create acknowledgement and omits private authoring fields", async () => {
    const f = await fixture(),
      first = await f.create();
    expect(first.statusCode, first.body).toBe(201);
    const created = first.json();
    const retry = await f.create();
    expect(retry.statusCode, retry.body).toBe(200);
    expect(retry.json()).toEqual({ ...created, replayed: true });
    expect(new URL(created.url).hash).toBe(`#token=${f.input.token}`);
    const read = await f.read(created.share.id);
    expect(read.statusCode, read.body).toBe(200);
    expect(read.headers["cache-control"]).toContain("no-store");
    expect(read.headers["x-robots-tag"]).toContain("noindex");
    expect(read.headers["referrer-policy"]).toBe("no-referrer");
    const fullRead = vi.spyOn(f.shares, "getPublicShare");
    const access = await f.app.inject({
      url: `/v1/shared-presentations/${created.share.id}/access`,
      headers: { authorization: `Bearer ${f.input.token}` },
    });
    expect(access.statusCode, access.body).toBe(200);
    expect(access.json()).toEqual({ versionId: f.version.id, expiresAt: f.input.expiresAt });
    expect(fullRead).not.toHaveBeenCalled();
    expect(read.body).not.toMatch(
      /PRIVATE_|speakerNotes|correctValue|tolerance|explanation|recoveryPack|branches|workspaceId|actorId|tokenHash|intentHash|objectKey|score/,
    );
    const newer = PresentationContentSchema.parse({
      ...f.content,
      title: "A later published version",
    });
    await f.presentations.updatePresentationDraft({
      workspaceId: f.actor.workspaceId,
      presentationId: f.presentation.id,
      draft: newer,
      draftHash: createHash("sha256").update(JSON.stringify(newer)).digest("hex"),
      expectedRevision: 0,
      mutationId: randomUUID(),
      editorId: f.actor.userId,
    });
    await f.presentations.publishPresentation(
      {
        id: randomUUID(),
        workspaceId: f.actor.workspaceId,
        presentationId: f.presentation.id,
        version: 2,
        content: newer,
        contentHash: createHash("sha256").update(JSON.stringify(newer)).digest("hex"),
        sourceDraftRevision: 1,
        publishedAt: new Date(),
      },
      1,
    );
    expect((await f.read(created.share.id)).json().title).toBe(f.content.title);
    expect(
      (await f.create({ ...f.input, token: randomBytes(32).toString("base64url") })).statusCode,
    ).toBe(409);
    const listing = await f.app.inject({ url: `/v1/presentations/${f.presentation.id}/shares` });
    expect(listing.body).not.toMatch(/token|intentHash/);
    expect(listing.json().shares).toHaveLength(1);
  });
  it("authorizes only projected scanned assets and rechecks revocation after reading bytes", async () => {
    const f = await fixture(),
      created = (await f.create()).json(),
      id = created.share.id;
    const media = () =>
      f.app.inject({
        url: `/v1/shared-presentations/${id}/media/${f.mediaId}`,
        headers: { authorization: `Bearer ${f.input.token}` },
      });
    const allowed = await media();
    expect(allowed.statusCode, allowed.body).toBe(200);
    expect(allowed.headers["content-type"]).toBe("image/png");
    expect(allowed.headers["cache-control"]).toContain("no-store");
    expect(
      (
        await f.app.inject({
          url: `/v1/shared-presentations/${id}/media/${randomUUID()}`,
          headers: { authorization: `Bearer ${f.input.token}` },
        })
      ).statusCode,
    ).toBe(404);
    f.readImage.mockImplementationOnce(async () => {
      await f.shares.revokeShare(
        f.actor.workspaceId,
        f.presentation.id,
        id,
        f.actor.userId,
        new Date(),
      );
      return Buffer.alloc(8);
    });
    const revokedDuringRead = await media();
    expect(revokedDuringRead.statusCode, revokedDuringRead.body).toBe(404);
    expect(revokedDuringRead.headers["content-type"]).toContain("application/json");
    expect((await f.read(id)).statusCode).toBe(404);
    expect(
      (
        await f.app.inject({
          url: `/v1/shared-presentations/${id}/access`,
          headers: { authorization: `Bearer ${f.input.token}` },
        })
      ).statusCode,
    ).toBe(404);
    expect((await media()).statusCode).toBe(404);
  });
  it("uses generic failures for credentials, feature policy and departed publishers, and permits explicit revocation while disabled", async () => {
    const f = await fixture(),
      created = (await f.create()).json(),
      id = created.share.id;
    expect((await f.read(id, randomBytes(32).toString("base64url"))).statusCode).toBe(404);
    expect((await f.app.inject({ url: `/v1/shared-presentations/${id}` })).statusCode).toBe(404);
    f.enabled.value = false;
    expect((await f.read(id)).statusCode).toBe(404);
    expect((await f.create({ ...f.input, requestId: randomUUID() })).statusCode).toBe(404);
    expect(
      (
        await f.app.inject({
          method: "DELETE",
          url: `/v1/presentations/${f.presentation.id}/shares/${id}`,
        })
      ).statusCode,
    ).toBe(204);
    f.enabled.value = true;
    f.repository.users.get(f.actor.userId)!.role = "viewer";
    expect((await f.read(id)).statusCode).toBe(404);
  });
  it("allowlists authored advanced audience text with viewer-local interactions while excluding branches", async () => {
    const f = await fixture();
    const block = f.content.blocks[0]!;
    if (block.kind !== "content") throw new Error("Expected slide");
    const q = f.content.blocks[1]!;
    if (q.kind !== "question") throw new Error("Expected question");
    const frame = { x: 5, y: 30, width: 10, height: 10 };
    const target = { ...block, id: randomUUID() };
    const advanced = PresentationContentSchema.parse({
      ...f.content,
      schemaVersion: 13,
      blocks: [
        {
          ...block,
          textElements: [],
          mediaId: null,
          mediaAlt: null,
          scene: {
            schemaVersion: 6,
            aspectRatio: "16:9",
            nodes: [
              {
                id: "title",
                type: "text",
                role: "title",
                text: "Advanced public",
                frame: { x: 0, y: 0, width: 100, height: 20 },
              },
              {
                id: "image",
                type: "image",
                mediaId: f.mediaId,
                altText: "Public image",
                frame: { x: 0, y: 20, width: 100, height: 80 },
              },
              {
                id: "broadcast",
                type: "reveal",
                scope: "broadcast",
                label: "Show",
                body: "PUBLIC_BROADCAST_BODY",
                frame,
              },
              {
                id: "hotspot",
                type: "hotspot",
                imageNodeId: "image",
                scope: "local",
                label: "Inspect",
                detailTitle: "Public detail",
                body: "PUBLIC_HOTSPOT_BODY",
                frame,
              },
              {
                id: "dialog",
                type: "dialog",
                scope: "local",
                label: "Read",
                detailTitle: "Public dialog",
                body: "PUBLIC_DIALOG_BODY",
                frame,
              },
              { id: "navigation", type: "navigation", label: "Go", targetBlockId: q.id, frame },
            ],
            readingOrder: ["title", "image", "broadcast", "hotspot", "dialog", "navigation"],
          },
        },
        {
          ...q,
          branches: [
            {
              id: randomUUID(),
              label: "PRIVATE_BRANCH_LABEL",
              condition: { kind: "correct_share", minPercent: 50, minResponses: 1 },
              targetBlockId: target.id,
            },
          ],
        },
        target,
      ],
    });
    const projected = projectPresentationReview(
      { ...f.version, content: advanced },
      { expiresAt: new Date(f.input.expiresAt) },
    );
    expect(JSON.stringify(projected)).not.toMatch(
      /PRIVATE_|branches|speakerNotes|correctValue|explanation/,
    );
    expect(JSON.stringify(projected)).toContain("PUBLIC_BROADCAST_BODY");
    expect(JSON.stringify(projected)).toContain("PUBLIC_HOTSPOT_BODY");
  });
});
