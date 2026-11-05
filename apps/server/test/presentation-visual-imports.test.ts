import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository } from "@openround/db";
import { PresentationContentSchema, type PresentationVisualImportJob } from "@openround/contracts";
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
  vi.spyOn(converter, "presentationVisualConversionAvailable").mockReturnValue(true);
  const repository = new MemoryRepository({ initialWorkspaceId: workspaceId });
  const built = await buildApp(
    ConfigSchema.parse({
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
    }),
    {
      repository,
      cache: new MemorySessionCache(),
      scanner: { scan: async () => ({ clean: true, signature: null }) },
    },
  );
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
  return { ...built, repository, id, base, payload, cookie, worker, write, render, create };
}

describe("Presentation visual import", () => {
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
  });

  it("requires fidelity/reading review, fences canceled jobs, and rejects viewers and foreign presentation scopes", async () => {
    const f = await fixture();
    const created = await f.create();
    const id = created.json<{ job: PresentationVisualImportJob }>().job.id;
    const wrongScope = await f.app.inject({
      url: `/v1/presentations/${randomUUID()}/visual-imports/${id}`,
      headers: { cookie: f.cookie },
    });
    expect(wrongScope.statusCode).toBe(404);
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
    expect((await f.create()).statusCode).toBe(403);
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
    const mismatch = await f.app.inject({
      method: "POST",
      url: f.base,
      headers: { cookie: f.cookie },
      payload: { ...f.payload, files: [{ ...f.payload.files[0]!, name: "different.png" }] },
    });
    expect(mismatch.statusCode).toBe(409);
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
