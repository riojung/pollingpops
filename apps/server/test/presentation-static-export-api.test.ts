import Fastify, { type FastifyInstance, type InjectOptions } from "fastify";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository, type CreatorContext } from "@openround/db";
import {
  PresentationContentSchema,
  PRESENTATION_STATIC_EXPORT_LIMITS as limits,
  type PresentationContent,
} from "@openround/contracts";
import { presentationSharingFixture } from "../../../packages/db/test/support/presentation-sharing-conformance.js";
import { registerPresentationStaticExportRoutes } from "../src/presentation-static-export-routes.js";
import type { PresentationStaticRenderer } from "../src/presentation-static-export-service.js";
import { ConfigSchema } from "../src/config.js";
import type { StorageService } from "../src/storage.js";
const apps: FastifyInstance[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
const types = { pdf: "application/pdf", png: "image/png", html: "text/html" } as const;
const renderResult: PresentationStaticRenderer = async (input) => ({
  bytes: Buffer.from("SYNTHETIC_STATIC_BYTES"),
  contentType: types[input.format],
  extension: input.format,
});
async function fixture(options: { media?: boolean; deadlineMs?: number } = {}) {
  const repository = new MemoryRepository(),
    mediaId = options.media === false ? null : randomUUID(),
    f = await presentationSharingFixture(repository, "static-export", mediaId);
  const current = { actor: f.actor as CreatorContext | null, feature: true, admitted: true };
  const render = vi.fn<PresentationStaticRenderer>(renderResult),
    readImage = vi.fn<StorageService["readImage"]>(async () =>
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
  const app = Fastify({ logger: false });
  apps.push(app);
  const config = ConfigSchema.parse({
    NODE_ENV: "test",
    ALLOW_IN_MEMORY: "true",
    COMMUNITY_MODE: "false",
    LOG_LEVEL: "silent",
    WEB_ORIGIN: "http://localhost:3000",
    PUBLIC_API_URL: "http://localhost:4000",
  });
  const consumeAdmission = vi.fn(async () => current.admitted);
  const service = await registerPresentationStaticExportRoutes(app, {
    auth: {
      requireCreator: async (_request, reply) => {
        if (!current.actor)
          reply.code(401).send({ error: { code: "UNAUTHORIZED", message: "Sign in required" } });
        return current.actor;
      },
      creatorFromRequest: async () => current.actor,
    },
    repository,
    presentations: f.presentations,
    storage: { readImage },
    config,
    featureEnabled: async () => current.feature,
    consumeAdmission,
    render,
    deadlineMs: options.deadlineMs,
  });
  const request = (
    payload: InjectOptions["payload"] = { versionId: f.version.id, format: "pdf" },
    id = f.presentation.id,
  ) => app.inject({ method: "POST", url: `/v1/presentations/${id}/exports`, payload });
  const metadata = (versionId = f.version.id, id = f.presentation.id) =>
    app.inject({ url: `/v1/presentations/${id}/exports/source?versionId=${versionId}` });
  return {
    ...f,
    repository,
    mediaId,
    current,
    render,
    readImage,
    app,
    service,
    request,
    metadata,
    consumeAdmission,
  };
}
async function publish(f: Awaited<ReturnType<typeof fixture>>, content: PresentationContent) {
  const parent = (await f.presentations.getPresentation(f.actor.workspaceId, f.presentation.id))!;
  const next = PresentationContentSchema.parse(content),
    draftHash = createHash("sha256").update(JSON.stringify(next)).digest("hex");
  const saved = await f.presentations.updatePresentationDraft({
    workspaceId: f.actor.workspaceId,
    presentationId: f.presentation.id,
    draft: next,
    draftHash,
    expectedRevision: parent.draftRevision,
    mutationId: randomUUID(),
    editorId: f.actor.userId,
  });
  return f.presentations.publishPresentation(
    {
      id: randomUUID(),
      workspaceId: f.actor.workspaceId,
      presentationId: f.presentation.id,
      version:
        (await f.presentations.getPresentationVersion(
          f.actor.workspaceId,
          parent.currentVersionId!,
        ))!.version + 1,
      content: next,
      contentHash: draftHash,
      sourceDraftRevision: saved!.draftRevision,
      publishedAt: new Date(),
    },
    saved!.draftRevision,
  );
}
function slide(title: string, mediaId: string | null = null) {
  return {
    id: randomUUID(),
    kind: "content" as const,
    layout: "title_body" as const,
    textElements: [
      {
        id: randomUUID(),
        role: "title" as const,
        text: title,
        region: "top_center" as const,
        order: 0,
      },
    ],
    mediaId,
    mediaAlt: mediaId ? "Public diagram" : null,
    speakerNotes: "PRIVATE_STATIC_NOTES",
  };
}
describe("published Presentation static export API", () => {
  it("downloads the explicitly pinned publication through a safe projection without draft, share or report mutations", async () => {
    const f = await fixture(),
      old = f.version;
    await publish(f, { ...f.content, title: "Later publication", blocks: [slide("Later page")] });
    const before = await f.presentations.getPresentation(f.actor.workspaceId, f.presentation.id),
      history = await f.presentations.listPresentationHistory(
        f.actor.workspaceId,
        f.presentation.id,
      );
    const response = await f.request(
      { versionId: old.id.toUpperCase(), format: "pdf" },
      f.presentation.id.toUpperCase(),
    );
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers["content-type"]).toBe("application/pdf");
    expect(response.headers["content-disposition"]).toBe(
      'attachment; filename="polling-pops-presentation.pdf"',
    );
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    const input = f.render.mock.calls[0]![0];
    expect(input.review.versionId).toBe(old.id);
    expect(input.review.title).toBe(old.content.title);
    expect(JSON.stringify(input.review)).not.toMatch(
      /PRIVATE_|speakerNotes|correctValue|explanation|recoveryPack|branches|workspaceId|actorId/,
    );
    expect([...input.images.keys()]).toEqual([f.mediaId]);
    expect(input.signal).toBeInstanceOf(AbortSignal);
    expect(await f.presentations.getPresentation(f.actor.workspaceId, f.presentation.id)).toEqual(
      before,
    );
    expect(
      await f.presentations.listPresentationHistory(f.actor.workspaceId, f.presentation.id),
    ).toEqual(history);
    expect(
      await f.shares.listShares(f.actor.workspaceId, f.presentation.id, f.actor.userId),
    ).toEqual([]);
  });
  it("returns safe published page metadata and reads only the selected PNG page's frozen media", async () => {
    const f = await fixture(),
      secondMedia = randomUUID();
    await f.repository.createMediaAsset({
      id: secondMedia,
      workspaceId: f.actor.workspaceId,
      objectKey: `media/${f.actor.workspaceId}/${secondMedia}.png`,
      mimeType: "image/png",
      sizeBytes: 8,
      scanStatus: "clean",
      altText: "Second public diagram",
      createdAt: new Date(),
    });
    const second = await publish(f, {
      ...f.content,
      blocks: [f.content.blocks[0]!, slide("Published selection", secondMedia)],
    });
    const source = await f.metadata(second.id);
    expect(source.statusCode, source.body).toBe(200);
    expect(source.json()).toEqual({
      versionId: second.id,
      version: 2,
      title: f.content.title,
      pages: [
        { blockId: f.content.blocks[0]!.id, title: "Public title" },
        { blockId: second.content.blocks[1]!.id, title: "Published selection" },
      ],
    });
    expect(source.body).not.toMatch(/PRIVATE|correctValue|speakerNotes|mediaId/);
    f.repository.mediaAssets.get(f.mediaId!)!.scanStatus = "rejected";
    const response = await f.request({
      versionId: second.id,
      format: "png",
      blockId: second.content.blocks[1]!.id.toUpperCase(),
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers["content-type"]).toBe("image/png");
    expect(f.readImage).toHaveBeenCalledTimes(1);
    expect(f.readImage.mock.calls[0]![0].id).toBe(secondMedia);
    expect(f.render.mock.calls[0]![0].review.blocks.map((block) => block.id)).toEqual([
      second.content.blocks[1]!.id,
    ]);
  });
  it("rejects invalid formats, missing or unrelated pages, cross-source versions and denied feature or roles", async () => {
    const f = await fixture({ media: false });
    for (const body of [
      { versionId: f.version.id, format: "png" },
      { versionId: f.version.id, format: "html", blockId: f.content.blocks[0]!.id },
      { versionId: f.version.id, format: "pptx" },
      { versionId: f.version.id, format: "pdf", speakerNotes: true },
    ])
      expect((await f.request(body)).statusCode).toBe(422);
    expect(
      (await f.request({ versionId: f.version.id, format: "png", blockId: randomUUID() }))
        .statusCode,
    ).toBe(422);
    const other = await presentationSharingFixture(f.repository, "other-static");
    expect((await f.request({ versionId: other.version.id, format: "pdf" })).statusCode).toBe(404);
    f.current.feature = false;
    expect((await f.request()).statusCode).toBe(404);
    f.current.feature = true;
    f.repository.users.get(f.actor.userId)!.role = "viewer";
    expect((await f.request()).statusCode).toBe(403);
    expect((await f.metadata()).statusCode).toBe(403);
    expect(f.render).not.toHaveBeenCalled();
  });
  it.each(["cookie", "membership", "account", "source", "workspace", "feature"] as const)(
    "withholds generated bytes when %s access is revoked during rendering",
    async (kind) => {
      const f = await fixture({ media: false });
      f.render.mockImplementationOnce(async (input) => {
        if (kind === "cookie") f.current.actor = null;
        if (kind === "membership")
          f.repository.workspaceMembers.delete(`${f.actor.workspaceId}:${f.actor.userId}`);
        if (kind === "account") await f.repository.deleteAccount(f.actor.userId);
        if (kind === "source") {
          await f.presentations.archivePresentation(f.actor.workspaceId, f.presentation.id, true);
          await f.presentations.deletePresentation(f.actor.workspaceId, f.presentation.id);
        }
        if (kind === "workspace")
          await f.repository.claimWorkspaceMediaDeletion(f.actor.workspaceId);
        if (kind === "feature") f.current.feature = false;
        return renderResult(input);
      });
      const response = await f.request();
      expect(response.statusCode, response.body).toBe(404);
      expect(response.body).not.toContain("SYNTHETIC_STATIC_BYTES");
    },
  );
  it.each(["read", "render"] as const)(
    "withholds changed image bytes after async %s",
    async (phase) => {
      const f = await fixture();
      if (phase === "read")
        f.readImage.mockImplementationOnce(async () => {
          f.repository.mediaAssets.get(f.mediaId!)!.scanStatus = "rejected";
          return Buffer.alloc(8);
        });
      else
        f.render.mockImplementationOnce(async (input) => {
          f.repository.mediaAssets.get(f.mediaId!)!.objectKey = "media/replaced.png";
          return renderResult(input);
        });
      const response = await f.request();
      expect(response.statusCode, response.body).toBe(409);
      expect(response.json().error.code).toBe("EXPORT_MEDIA_UNAVAILABLE");
      expect(response.body).not.toContain("SYNTHETIC_STATIC_BYTES");
      if (phase === "read") expect(f.render).not.toHaveBeenCalled();
    },
  );
  it("rechecks images after the final async source authorization", async () => {
    const f = await fixture();
    let rendered = false;
    f.render.mockImplementationOnce(async (input) => {
      rendered = true;
      return renderResult(input);
    });
    const getVersion = f.presentations.getPresentationVersion.bind(f.presentations);
    vi.spyOn(f.presentations, "getPresentationVersion").mockImplementation(async (...args) => {
      const version = await getVersion(...args);
      if (rendered) f.repository.mediaAssets.get(f.mediaId!)!.scanStatus = "rejected";
      return version;
    });
    const response = await f.request();
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json().error.code).toBe("EXPORT_MEDIA_UNAVAILABLE");
    expect(response.body).not.toContain("SYNTHETIC_STATIC_BYTES");
  });
  it("enforces page and output budgets while allowing one PNG from a larger published deck", async () => {
    const f = await fixture({ media: false }),
      large = await publish(f, {
        ...f.content,
        blocks: Array.from({ length: 101 }, (_, i) => slide(`Page ${i + 1}`)),
      });
    const over = await f.request({ versionId: large.id, format: "html" });
    expect(over.statusCode).toBe(413);
    expect(over.json().error.code).toBe("EXPORT_LIMIT");
    expect(f.render).not.toHaveBeenCalled();
    expect(
      (
        await f.request({
          versionId: large.id,
          format: "png",
          blockId: large.content.blocks[100]!.id,
        })
      ).statusCode,
    ).toBe(200);
    f.render.mockImplementationOnce(async (input) => ({
      ...(await renderResult(input)),
      bytes: Buffer.alloc(limits.maxOutputBytes + 1),
    }));
    expect((await f.request()).statusCode).toBe(413);
  });
  it("checks image aggregate budgets before downloading any bytes", async () => {
    const f = await fixture({ media: false }),
      ids = Array.from({ length: 5 }, () => randomUUID());
    for (const id of ids)
      await f.repository.createMediaAsset({
        id,
        workspaceId: f.actor.workspaceId,
        objectKey: `media/${f.actor.workspaceId}/${id}.png`,
        mimeType: "image/png",
        sizeBytes: limits.maxImageBytes,
        scanStatus: "clean",
        altText: "Public",
        createdAt: new Date(),
      });
    const version = await publish(f, {
      ...f.content,
      blocks: ids.map((id, i) => slide(`Image ${i}`, id)),
    });
    const response = await f.request({ versionId: version.id, format: "pdf" });
    expect(response.statusCode).toBe(413);
    expect(f.readImage).not.toHaveBeenCalled();
    expect(f.render).not.toHaveBeenCalled();
  });
  it("returns a typed per-actor rate limit before starting export work", async () => {
    const f = await fixture();
    f.current.admitted = false;
    const response = await f.request();
    expect(response.statusCode).toBe(429);
    expect(response.json().error.code).toBe("EXPORT_RATE_LIMITED");
    expect(response.headers["retry-after"]).toBe("60");
    expect(f.render).not.toHaveBeenCalled();
    expect(f.readImage).not.toHaveBeenCalled();
  });
  it("retains both render slots after deadline abort until the actual renderer settles", async () => {
    const f = await fixture({ media: false, deadlineMs: 20 });
    const release: Array<() => void> = [],
      signals: AbortSignal[] = [];
    f.render.mockImplementation(
      (input) =>
        new Promise((resolve) => {
          signals.push(input.signal!);
          release.push(() => {
            void renderResult(input).then(resolve);
          });
        }),
    );
    const pending = [f.request(), f.request()];
    try {
      await vi.waitFor(() => expect(f.render).toHaveBeenCalledTimes(2));
      await vi.waitFor(() => expect(signals.every((signal) => signal.aborted)).toBe(true));
      const busy = await f.request();
      expect(busy.statusCode, busy.body).toBe(503);
      expect(busy.json().error.code).toBe("EXPORT_BUSY");
      expect(busy.headers["retry-after"]).toBe("1");
      expect(f.render).toHaveBeenCalledTimes(2);
    } finally {
      for (const done of release) done();
    }
    for (const response of await Promise.all(pending)) {
      expect(response.statusCode, response.body).toBe(504);
      expect(response.json().error.code).toBe("EXPORT_CANCELLED");
    }
    f.render.mockImplementation(renderResult);
    expect((await f.request()).statusCode).toBe(200);
  });
  it("does not release admission while an aborted uncancellable media read remains outstanding", async () => {
    const f = await fixture(),
      release: Array<() => void> = [];
    f.readImage.mockImplementation(
      () =>
        new Promise((resolve) => {
          release.push(() => resolve(Buffer.alloc(8)));
        }),
    );
    const controllers = [new AbortController(), new AbortController()];
    const pending = controllers.map((controller) =>
      f.service.export(
        f.actor,
        f.presentation.id,
        { versionId: f.version.id, format: "pdf" },
        { signal: controller.signal, reauthorize: async () => f.current.actor },
      ),
    );
    const settled = Promise.allSettled(pending);
    try {
      await vi.waitFor(() => expect(f.readImage).toHaveBeenCalledTimes(2));
      for (const controller of controllers) controller.abort();
      expect((await f.request()).statusCode).toBe(503);
      expect(f.readImage).toHaveBeenCalledTimes(2);
    } finally {
      for (const done of release) done();
    }
    for (const result of await settled)
      expect(result).toMatchObject({ status: "rejected", reason: { code: "EXPORT_CANCELLED" } });
    expect(f.render).not.toHaveBeenCalled();
  });
  it("does not start an export after a disconnect while admission was pending", async () => {
    const f = await fixture();
    let releaseAdmission!: () => void;
    f.consumeAdmission.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          releaseAdmission = () => resolve(true);
        }),
    );
    let closed!: Promise<unknown>;
    f.app.addHook("onRequest", async (_request, reply) => {
      closed = once(reply.raw, "close");
    });
    const origin = await f.app.listen({ host: "127.0.0.1", port: 0 });
    const request = httpRequest(`${origin}/v1/presentations/${f.presentation.id}/exports`, {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    request.on("error", () => undefined);
    const exportSpy = vi.spyOn(f.service, "export");
    request.end(JSON.stringify({ versionId: f.version.id, format: "pdf" }));
    await vi.waitFor(() => expect(f.consumeAdmission).toHaveBeenCalledOnce());
    request.destroy();
    await closed;
    releaseAdmission();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(exportSpy).not.toHaveBeenCalled();
    expect(f.readImage).not.toHaveBeenCalled();
    expect(f.render).not.toHaveBeenCalled();
  });
});
