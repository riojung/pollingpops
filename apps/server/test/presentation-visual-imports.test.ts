import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository, createPlatformRepository } from "@openround/db";
import {
  PresentationContentSchema,
  resolvePresentationSpatialFrames,
  type PresentationVisualImportJob,
  type PresentationVisualImportUnavailableReason,
} from "@openround/contracts";
import { buildApp } from "../src/app.js";
import { ConfigSchema } from "../src/config.js";
import { MemorySessionCache } from "../src/cache.js";
import { mediaFinalizationObjectKey } from "../src/storage.js";
import { PresentationVisualImportWorker } from "../src/presentation-visual-import-worker.js";
import * as converter from "../src/presentation-visual-converter.js";
import { verifyEmailAndSignIn } from "./support/email-auth.js";

const workspaceId = "10000000-0000-4000-8000-000000000001";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
  vi.restoreAllMocks();
});

async function fixture() {
  const conversionAvailable = vi
    .spyOn(converter, "presentationVisualConversionAvailable")
    .mockReturnValue(true);
  const repository = new MemoryRepository({ initialWorkspaceId: workspaceId });
  const config = ConfigSchema.parse({
    NODE_ENV: "test",
    ALLOW_IN_MEMORY: "true",
    COMMUNITY_MODE: "false",
    WEB_ORIGIN: "http://localhost:3000",
    PUBLIC_API_URL: "http://localhost:4000",
    FEATURE_UX_BETA: "true",
    UX_BETA_WORKSPACE_ALLOWLIST: workspaceId,
    FEATURE_PRESENTATIONS: "true",
    FEATURE_MEDIA_UPLOADS: "true",
    S3_ENDPOINT: "http://127.0.0.1:9000",
    S3_PUBLIC_ENDPOINT: "http://127.0.0.1:9000",
    S3_BUCKET: "test-imports",
    S3_ACCESS_KEY_ID: "test-access",
    S3_SECRET_ACCESS_KEY: "test-secret",
    LOG_LEVEL: "silent",
  });
  const scan = vi.fn(async () => ({ clean: true, signature: null }));
  const built = await buildApp(config, {
    repository,
    cache: new MemorySessionCache(),
    scanner: { scan },
  });
  app = built.app;
  const magic = await app.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: { email: "visual-import@example.test", segment: "workplace", acceptPolicies: true },
  });
  const token = new URL(magic.json<{ debugUrl: string }>().debugUrl).searchParams.get("token")!;
  const signed = await verifyEmailAndSignIn(
    app,
    `/v1/auth/verify?token=${token}`,
    "visual-import@example.test",
  );
  const setCookie = signed.headers["set-cookie"]!;
  const cookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(";")[0]!;
  const created = await app.inject({
    method: "POST",
    url: "/v1/presentations",
    headers: { cookie },
    payload: { title: "Visual deck" },
  });
  expect(created.statusCode).toBe(201);
  const id = created.json<{ presentation: { id: string } }>().presentation.id;
  const base = `/v1/presentations/${id}/visual-imports`;
  const payload = {
    requestId: randomUUID(),
    files: [{ name: "page.png", mimeType: "image/png", base64: png.toString("base64") }],
    retainOriginal: false,
  };
  const write = vi.spyOn(built.storage, "writeVisualImportPage").mockResolvedValue(undefined);
  vi.spyOn(built.storage, "finalize").mockImplementation(async (asset, claim) => ({
    scanStatus: "clean",
    objectKey: mediaFinalizationObjectKey(asset, claim),
  }));
  vi.spyOn(built.storage, "commitFinalizationCandidate").mockResolvedValue(undefined);
  vi.spyOn(built.storage, "cleanupFinalization").mockResolvedValue(undefined);
  vi.spyOn(built.storage, "createDownloadUrl").mockResolvedValue(
    "https://media.example.test/private-preview",
  );
  const render = vi.fn(async () => ({
    pages: [1, 2].map((pageNumber) => ({
      pageNumber,
      width: 1,
      height: 1,
      png,
      extractedText: `Extracted page ${pageNumber}`,
    })),
    warnings: [],
  }));
  const worker = new PresentationVisualImportWorker(
    repository,
    built.storage,
    app.log,
    built.metrics,
    render,
  );
  const create = () => app!.inject({ method: "POST", url: base, headers: { cookie }, payload });
  return {
    ...built,
    repository,
    config,
    conversionAvailable,
    scan,
    id,
    base,
    payload,
    cookie,
    worker,
    write,
    render,
    create,
  };
}

describe("Presentation visual import", () => {
  it.each(["replace", "sparse-replace", "append"] as const)(
    "preserves document14 spatial layout and exact retries when importing pages (%s)",
    async (scenario) => {
      const f = await fixture();
      const initial = (await f.presentations.getPresentation(workspaceId, f.id))!;
      const owner = [...f.repository.workspaceMembers.values()].find(
        (member) => member.workspaceId === workspaceId,
      )!;
      const starterId = initial.draft.blocks[0]!.id;
      const frame = {
        blockId: starterId.toUpperCase(),
        x: 6400,
        y: 4800,
        width: 640,
        height: 360,
      };
      const spatial = {
        schemaVersion: 1 as const,
        frames: scenario === "sparse-replace" ? [] : [frame],
      };
      const sectionId = randomUUID();
      await f.presentations.updatePresentationDraft({
        workspaceId,
        presentationId: f.id,
        expectedRevision: 0,
        mutationId: randomUUID(),
        editorId: owner.userId,
        draftHash: "a".repeat(64),
        draft: {
          ...initial.draft,
          schemaVersion: 14,
          blocks: initial.draft.blocks.map((block) =>
            block.kind === "content" && scenario === "append"
              ? {
                  ...block,
                  textElements: [
                    {
                      id: "existing-title",
                      role: "title" as const,
                      text: "Keep this existing slide",
                      region: "top_center" as const,
                      order: 0,
                    },
                  ],
                }
              : block,
          ),
          sections: [{ id: sectionId, title: "Imported chapter", blockIds: [starterId] }],
          spatial,
        },
      });
      const created = await f.create();
      expect(created.statusCode, created.body).toBe(202);
      const jobId = created.json<{ job: PresentationVisualImportJob }>().job.id;
      expect(await f.worker.runOnce()).toBe("completed");
      const input = {
        expectedRevision: 1,
        mutationId: randomUUID(),
        afterBlockId: starterId,
        fidelityAccepted: true,
        pages: [
          {
            pageNumber: 1,
            title: "Reviewed page",
            alternativeText: "Diagram",
            accessibleText: "Reading order",
            readingOrderReviewed: true,
          },
        ],
      };
      const insert = () =>
        f.app.inject({
          method: "POST",
          url: `${f.base}/${jobId}/insert`,
          headers: { cookie: f.cookie },
          payload: input,
        });
      const inserted = await insert();
      expect(inserted.statusCode, inserted.body).toBe(200);
      const result = inserted.json<{
        presentation: { draftRevision: number; draft: unknown };
        insertedBlockIds: string[];
      }>();
      const content = PresentationContentSchema.parse(result.presentation.draft);
      expect(content.schemaVersion).toBe(14);
      expect(result.presentation.draftRevision).toBe(2);
      expect(content.blocks.map((block) => block.id)).toEqual([
        ...(scenario === "append" ? [starterId] : []),
        ...result.insertedBlockIds,
      ]);
      expect(content.spatial).toEqual(
        scenario === "replace"
          ? { ...spatial, frames: [{ ...frame, blockId: result.insertedBlockIds[0] }] }
          : spatial,
      );
      expect(content.sections).toEqual([
        {
          id: sectionId,
          title: "Imported chapter",
          blockIds: scenario === "append" ? [starterId] : result.insertedBlockIds,
        },
      ]);
      const resolved = resolvePresentationSpatialFrames(content);
      expect(resolved.map((frame) => frame.blockId)).toEqual(
        content.blocks.map((block) => block.id),
      );
      expect(resolved.at(-1)).toMatchObject({ width: 1280, height: 720 });
      expect((await insert()).json()).toEqual(inserted.json());
      expect((await f.presentations.getPresentation(workspaceId, f.id))?.draftRevision).toBe(2);
      const published = await f.app.inject({
        method: "POST",
        url: `/v1/presentations/${f.id}/publish`,
        headers: { cookie: f.cookie },
        payload: { expectedDraftRevision: 2 },
      });
      expect(published.statusCode, published.body).toBe(200);
    },
  );

  it("preserves a v12 starter section when visual import replaces the empty slide", async () => {
    const f = await fixture();
    const initial = (await f.presentations.getPresentation(workspaceId, f.id))!;
    const owner = [...f.repository.workspaceMembers.values()].find(
      (member) => member.workspaceId === workspaceId,
    )!;
    const sectionId = randomUUID();
    await f.presentations.updatePresentationDraft({
      workspaceId,
      presentationId: f.id,
      expectedRevision: 0,
      mutationId: randomUUID(),
      editorId: owner.userId,
      draftHash: "e".repeat(64),
      draft: {
        ...initial.draft,
        schemaVersion: 12,
        sections: [
          {
            id: sectionId,
            title: "Imported chapter",
            blockIds: [initial.draft.blocks[0]!.id],
          },
        ],
      },
    });
    const created = await f.create();
    const jobId = created.json<{ job: PresentationVisualImportJob }>().job.id;
    expect(await f.worker.runOnce()).toBe("completed");
    const input = {
      expectedRevision: 1,
      mutationId: randomUUID(),
      afterBlockId: initial.draft.blocks[0]!.id,
      fidelityAccepted: true,
      pages: [
        {
          pageNumber: 1,
          title: "Page",
          alternativeText: "Diagram",
          accessibleText: "Reading order",
          readingOrderReviewed: true,
        },
      ],
    };
    const insert = () =>
      f.app.inject({
        method: "POST",
        url: `${f.base}/${jobId}/insert`,
        headers: { cookie: f.cookie },
        payload: input,
      });
    const inserted = await insert();
    expect(inserted.statusCode, inserted.body).toBe(200);
    const result = inserted.json<{
      presentation: { draft: unknown };
      insertedBlockIds: string[];
    }>();
    const content = PresentationContentSchema.parse(result.presentation.draft);
    expect(content.schemaVersion).toBe(12);
    expect(content.sections).toEqual([
      { id: sectionId, title: "Imported chapter", blockIds: result.insertedBlockIds },
    ]);
    expect(content.blocks.map((block) => block.id)).toEqual(result.insertedBlockIds);
    expect((await insert()).json()).toEqual(inserted.json());
  });

  it("converts privately, selects/reorders reviewed pairs, publishes and recovers exact insert retries", async () => {
    const f = await fixture();
    const created = await f.create();
    expect(created.statusCode, created.body).toBe(202);
    const jobId = created.json<{ job: PresentationVisualImportJob }>().job.id;
    expect((await f.create()).json<{ job: PresentationVisualImportJob }>().job.id).toBe(jobId);
    expect(await f.worker.runOnce()).toBe("completed");
    expect(f.write).toHaveBeenCalledTimes(2);
    const ready = await f.app.inject({ url: `${f.base}/${jobId}`, headers: { cookie: f.cookie } });
    const job = ready.json<{ job: PresentationVisualImportJob }>().job;
    expect(job).toMatchObject({ status: "ready", pageCount: 2, retainOriginal: false });
    expect(ready.body).not.toContain(f.payload.files[0]!.base64);
    expect(ready.body).not.toContain("objectKey");
    await f.repository.updateOperationalFeatures({ mediaUploads: false }, "test-pause-media");
    const preview = await f.app.inject({
      url: `${f.base}/${jobId}/pages/2`,
      headers: { cookie: f.cookie },
    });
    expect(preview.statusCode).toBe(200);
    expect((await f.app.inject({ url: `${f.base}/${jobId}/pages/2` })).statusCode).toBe(401);
    const input = {
      expectedRevision: 0,
      mutationId: randomUUID(),
      afterBlockId: (await f.presentations.getPresentation(workspaceId, f.id))!.draft.blocks[0]!.id,
      fidelityAccepted: true,
      pages: [2, 1].map((pageNumber) => ({
        pageNumber,
        title: `Reviewed ${pageNumber}`,
        alternativeText: `Diagram ${pageNumber}`,
        accessibleText: `Meaning and reading order ${pageNumber}`,
        readingOrderReviewed: true,
      })),
    };
    const insert = () =>
      f.app.inject({
        method: "POST",
        url: `${f.base}/${jobId}/insert`,
        headers: { cookie: f.cookie },
        payload: input,
      });
    const inserted = await insert();
    expect(inserted.statusCode, inserted.body).toBe(200);
    const record = inserted.json<{
      presentation: { draftRevision: number; draft: unknown };
      insertedBlockIds: string[];
    }>();
    expect(record.insertedBlockIds).toHaveLength(4);
    expect(record.presentation.draftRevision).toBe(1);
    const content = PresentationContentSchema.parse(record.presentation.draft);
    expect(content.schemaVersion).toBe(4);
    expect(
      content.blocks
        .filter((block) => block.kind === "content")
        .map((block) =>
          block.scene?.nodes.find((node) => node.type === "text" && node.role === "title"),
        ),
    ).toMatchObject([
      { text: "Reviewed 2" },
      { text: "Reviewed 2" },
      { text: "Reviewed 1" },
      { text: "Reviewed 1" },
    ]);
    expect((await insert()).json()).toEqual(inserted.json());
    const changed = await f.app.inject({
      method: "POST",
      url: `${f.base}/${jobId}/insert`,
      headers: { cookie: f.cookie },
      payload: { ...input, pages: input.pages.slice(0, 1) },
    });
    expect(changed.statusCode).toBe(409);
    const revision = await f.app.inject({
      url: `/v1/presentations/${f.id}`,
      headers: { cookie: f.cookie },
    });
    expect(
      revision.json<{ presentation: { draftRevision: number } }>().presentation.draftRevision,
    ).toBe(1);
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: `/v1/presentations/${f.id}/publish`,
          headers: { cookie: f.cookie },
          payload: { expectedDraftRevision: 1 },
        })
      ).statusCode,
    ).toBe(200);
    await f.presentationVisualImports.imports.cancel(workspaceId, f.id, jobId);
    await f.presentationVisualImports.imports.purgeExpired(new Date(Date.now() + 25 * 60 * 60_000));
    const owner = [...f.repository.workspaceMembers.values()].find(
      (member) => member.workspaceId === workspaceId,
    )!;
    await f.presentations.updatePresentationDraft({
      workspaceId,
      presentationId: f.id,
      draft: { ...content, title: "Later edits", blocks: [] },
      expectedRevision: 1,
      mutationId: randomUUID(),
      editorId: owner.userId,
      draftHash: "f".repeat(64),
    });
    f.config.FEATURE_PRESENTATIONS = false;
    const recovered = await insert();
    expect(recovered.statusCode, recovered.body).toBe(200);
    expect(
      recovered.json<{
        presentation: { draftRevision: number; draft: unknown };
        insertedBlockIds: string[];
      }>(),
    ).toMatchObject({
      presentation: { draftRevision: 1, draft: record.presentation.draft },
      insertedBlockIds: record.insertedBlockIds,
    });
    expect((await f.presentations.getPresentation(workspaceId, f.id))?.draftRevision).toBe(2);
    expect((await f.presentations.getPresentation(workspaceId, f.id))?.draft.blocks).toEqual([]);
    const freshInsert = await f.app.inject({
      method: "POST",
      url: `${f.base}/${jobId}/insert`,
      headers: { cookie: f.cookie },
      payload: { ...input, expectedRevision: 2, mutationId: randomUUID() },
    });
    expect(freshInsert.statusCode).toBe(403);
    expect(freshInsert.json()).toMatchObject({ error: { code: "FEATURE_UNAVAILABLE" } });
    expect(freshInsert.json().error).not.toHaveProperty("details");
  });

  it("requires fidelity/reading review, fences canceled jobs, and rejects viewers and foreign presentation scopes", async () => {
    const f = await fixture();
    const created = await f.create();
    const id = created.json<{ job: PresentationVisualImportJob }>().job.id;
    const headers = { cookie: f.cookie };
    const otherPresentation = `/v1/presentations/${randomUUID()}/visual-imports`;
    expect((await f.app.inject({ url: otherPresentation, headers })).statusCode).toBe(404);
    expect((await f.app.inject({ url: `${otherPresentation}/${id}`, headers })).statusCode).toBe(
      404,
    );
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: `${f.base}/${id}/insert`,
          headers: { cookie: f.cookie },
          payload: {
            expectedRevision: 0,
            mutationId: randomUUID(),
            pages: [
              {
                pageNumber: 1,
                title: "Page",
                alternativeText: "Diagram",
                accessibleText: "Meaning",
              },
            ],
          },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await f.app.inject({
          method: "DELETE",
          url: `${f.base}/${id}`,
          headers: { cookie: f.cookie },
        })
      ).statusCode,
    ).toBe(200);
    expect(await f.worker.runOnce()).toBe("idle");
    expect(f.render).not.toHaveBeenCalled();
    const owner = [...f.repository.workspaceMembers.values()].find(
      (member) => member.workspaceId === workspaceId,
    )!;
    owner.role = "viewer";
    f.repository.users.get(owner.userId)!.role = "viewer";
    const viewerRead = await f.app.inject({ url: f.base, headers });
    expect(viewerRead.statusCode).toBe(200);
    const viewerCreate = await f.create();
    expect(viewerCreate.statusCode).toBe(403);
    expect(viewerCreate.json()).toMatchObject({ error: { code: "UNAUTHORIZED" } });
    expect(viewerCreate.json().error).not.toHaveProperty("details");
    expect(
      (
        await f.app.inject({
          method: "DELETE",
          url: `${f.base}/${id}`,
          headers: { cookie: f.cookie },
        })
      ).statusCode,
    ).toBe(403);
  });

  it("does not reserve media or retain duplicate jobs when conversion fails", async () => {
    const f = await fixture();
    f.render.mockRejectedValueOnce(new converter.PresentationVisualConversionError("encrypted"));
    const created = await f.create();
    const id = created.json<{ job: PresentationVisualImportJob }>().job.id;
    expect(await f.worker.runOnce()).toBe("failed");
    expect(f.write).not.toHaveBeenCalled();
    const response = await f.app.inject({ url: `${f.base}/${id}`, headers: { cookie: f.cookie } });
    expect(response.json()).toMatchObject({
      job: { status: "failed", error: { code: "encrypted" }, pages: [] },
    });
    expect((await f.create()).json<{ job: PresentationVisualImportJob }>().job.id).toBe(id);
  });

  it("fences a cancellation arriving between preview and draft commit", async () => {
    const f = await fixture();
    const id = (await f.create()).json<{ job: PresentationVisualImportJob }>().job.id;
    expect(await f.worker.runOnce()).toBe("completed");
    const update = f.presentations.updatePresentationDraft.bind(f.presentations);
    vi.spyOn(f.presentations, "updatePresentationDraft").mockImplementationOnce(async (input) => {
      await f.presentationVisualImports.imports.cancel(workspaceId, f.id, id);
      return update(input);
    });
    const response = await f.app.inject({
      method: "POST",
      url: `${f.base}/${id}/insert`,
      headers: { cookie: f.cookie },
      payload: {
        expectedRevision: 0,
        mutationId: randomUUID(),
        afterBlockId: null,
        fidelityAccepted: true,
        pages: [
          {
            pageNumber: 1,
            title: "Reviewed",
            alternativeText: "Diagram",
            accessibleText: "Author-reviewed meaning",
            readingOrderReviewed: true,
          },
        ],
      },
    });
    expect(response.statusCode, response.body).toBe(409);
    expect((await f.presentations.getPresentation(workspaceId, f.id))?.draftRevision).toBe(0);
  });

  it("recovers creation receipts when new conversion work is unavailable", async () => {
    const f = await fixture();
    const id = (await f.create()).json<{ job: PresentationVisualImportJob }>().job.id;
    vi.spyOn(f.storage, "mediaUploadsEnabled", "get").mockReturnValue(false);
    const replay = await f.create();
    expect(replay.statusCode).toBe(202);
    expect(replay.json<{ job: PresentationVisualImportJob }>().job.id).toBe(id);
    const fresh = await f.app.inject({
      method: "POST",
      url: f.base,
      headers: { cookie: f.cookie },
      payload: { ...f.payload, requestId: randomUUID() },
    });
    expect(fresh.statusCode).toBe(503);
    expect(fresh.json()).toMatchObject({
      error: { details: { unavailableReason: "deployment_unavailable" } },
    });
    const mismatch = await f.app.inject({
      method: "POST",
      url: f.base,
      headers: { cookie: f.cookie },
      payload: { ...f.payload, files: [{ ...f.payload.files[0]!, name: "different.png" }] },
    });
    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.json().error).not.toHaveProperty("details");
  });

  it("reports the first unavailable reason for new uploads and retains private jobs", async () => {
    const f = await fixture();
    const headers = { cookie: f.cookie };
    const read = () => f.app.inject({ url: f.base, headers });
    const fresh = () =>
      f.app.inject({
        method: "POST",
        url: f.base,
        headers,
        payload: { ...f.payload, requestId: randomUUID() },
      });
    const initial = await read();
    expect(initial.statusCode).toBe(200);
    expect(initial.headers["cache-control"]).toBe("private, no-store");
    const initialStatus = initial.json();
    expect(initialStatus).toMatchObject({ available: true, jobs: [], limits: { maxPages: 40 } });
    expect(initialStatus).not.toHaveProperty("unavailableReason");

    const accepted = await f.create();
    expect(accepted.statusCode).toBe(202);
    const { job } = accepted.json<{ job: PresentationVisualImportJob }>();
    const expectUnavailable = async (
      unavailableReason: PresentationVisualImportUnavailableReason,
      status: number,
      code: string,
    ) => {
      const listed = await read();
      expect(listed.statusCode).toBe(200);
      expect(listed.headers["cache-control"]).toBe("private, no-store");
      expect(listed.json()).toEqual({
        ...initialStatus,
        available: false,
        unavailableReason,
        jobs: [job],
      });
      const rejected = await fresh();
      expect(rejected.statusCode).toBe(status);
      expect(rejected.json()).toMatchObject({ error: { code, details: { unavailableReason } } });
    };

    const platform = createPlatformRepository(f.repository);
    const denied = await platform.saveFeaturePolicy({
      expectedRevision: 0,
      features: { presentations: { enabled: false, plans: [] } },
    });
    f.config.FEATURE_PRESENTATIONS = false;
    await f.presentations.archivePresentation(workspaceId, f.id, true);
    f.conversionAvailable.mockReturnValue(false);
    await f.repository.updateOperationalFeatures({ mediaUploads: false }, "test-pause-media");

    await expectUnavailable("operator_policy", 403, "FEATURE_UNAVAILABLE");
    const replay = await f.create();
    expect(replay.statusCode).toBe(202);
    expect(replay.json()).toEqual({ job });

    await platform.saveFeaturePolicy({ expectedRevision: denied.revision, features: {} });
    await expectUnavailable("rollout_unavailable", 403, "FEATURE_UNAVAILABLE");
    f.config.FEATURE_PRESENTATIONS = true;
    await expectUnavailable("presentation_archived", 409, "CONFLICT");
    await f.presentations.archivePresentation(workspaceId, f.id, false);
    await expectUnavailable("deployment_unavailable", 503, "DEPENDENCY_UNAVAILABLE");
    f.conversionAvailable.mockReturnValue(true);
    await expectUnavailable("media_uploads_paused", 503, "DEPENDENCY_UNAVAILABLE");
    expect(f.scan).toHaveBeenCalledTimes(1);

    await f.repository.updateOperationalFeatures({ mediaUploads: true }, "test-resume-media");
    expect((await read()).json()).toEqual({ ...initialStatus, jobs: [job] });
    f.scan.mockRejectedValueOnce(new Error("temporary scanner failure"));
    const scanFailure = await fresh();
    expect(scanFailure.statusCode).toBe(503);
    expect(scanFailure.json()).toMatchObject({
      error: {
        code: "DEPENDENCY_UNAVAILABLE",
        message: "The source security scan is temporarily unavailable",
      },
    });
    expect(scanFailure.json().error).not.toHaveProperty("details");
    expect((await read()).json()).toEqual({ ...initialStatus, jobs: [job] });
  });

  it("accepts the full review-envelope byte budget before validating selected page ownership", async () => {
    const f = await fixture();
    const id = (await f.create()).json<{ job: PresentationVisualImportJob }>().job.id;
    expect(await f.worker.runOnce()).toBe("completed");
    const payload = {
      expectedRevision: 0,
      mutationId: randomUUID(),
      afterBlockId: null,
      fidelityAccepted: true,
      pages: Array.from({ length: 40 }, (_, index) => ({
        pageNumber: index + 1,
        title: "Reviewed page",
        alternativeText: "Diagram",
        accessibleText: "界".repeat(3000),
        readingOrderReviewed: true,
      })),
    };
    expect(Buffer.byteLength(JSON.stringify(payload))).toBeGreaterThan(128 * 1024);
    const response = await f.app.inject({
      method: "POST",
      url: `${f.base}/${id}/insert`,
      headers: { cookie: f.cookie },
      payload,
    });
    expect(response.statusCode, response.body).toBe(422);
    expect(response.json()).toMatchObject({
      error: { message: "Select pages from this conversion preview" },
    });
    expect((await f.presentations.getPresentation(workspaceId, f.id))?.draftRevision).toBe(0);
  });

  it("rejects oversized review envelopes with a recovery message instead of an internal error", async () => {
    const f = await fixture();
    const response = await f.app.inject({
      method: "POST",
      url: `${f.base}/${randomUUID()}/insert`,
      headers: { cookie: f.cookie },
      payload: { text: "x".repeat(1_000_001) },
    });
    expect(response.statusCode).toBe(413);
    expect(response.json()).toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        message:
          "The request is too large. Use a smaller file or split files into smaller batches.",
      },
    });
    expect((await f.presentations.getPresentation(workspaceId, f.id))?.draftRevision).toBe(0);
  });

  it("owns every object before writing and stops publishing after cancellation", async () => {
    const f = await fixture();
    const id = (await f.create()).json<{ job: PresentationVisualImportJob }>().job.id;
    f.write.mockImplementationOnce(async (asset) => {
      expect(f.repository.mediaAssets.has(asset.id)).toBe(true);
      expect(
        (await f.repository.listMediaReferences(workspaceId, asset.id)).some(
          (reference) => reference.ownerType === "presentation_visual_import",
        ),
      ).toBe(true);
      await f.presentationVisualImports.imports.cancel(workspaceId, f.id, id);
    });
    expect(await f.worker.runOnce()).toBe("superseded");
    expect(f.write).toHaveBeenCalledTimes(1);
    expect(f.repository.mediaAssets.size).toBe(2);
    expect((await f.presentationVisualImports.imports.get(workspaceId, f.id, id))?.status).toBe(
      "canceled",
    );
    expect((await f.presentations.getPresentation(workspaceId, f.id))?.draftRevision).toBe(0);
  });
});
