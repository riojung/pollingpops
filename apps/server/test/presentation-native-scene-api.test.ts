import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PresentationDraftSchema,
  preparePresentationPublication,
  type PresentationDraft,
} from "@openround/contracts";
import {
  MemoryRepository,
  type MemoryPresentationRepository,
  type CreatorContext,
} from "@openround/db";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";
import { verifyEmailAndSignIn } from "./support/email-auth.js";
import {
  designSceneBlock,
  nativeSceneBlock,
  richTextSceneBlock,
} from "./support/presentation-native-scene.js";

const workspaceId = "10000000-0000-4000-8000-00000000c004";
let app: FastifyInstance | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  await app?.close();
  app = undefined;
});

async function setup() {
  const repository = new MemoryRepository({ initialWorkspaceId: workspaceId });
  const built = await buildApp(
    ConfigSchema.parse({
      NODE_ENV: "test",
      ALLOW_IN_MEMORY: "true",
      COMMUNITY_MODE: "false",
      WEB_ORIGIN: "http://localhost:3000",
      PUBLIC_API_URL: "http://localhost:4000",
      FEATURE_UX_BETA: "true",
      FEATURE_PRESENTATIONS: "true",
      FEATURE_PRESENTATION_REALTIME: "true",
      FEATURE_PRESENTATION_COMPANION: "true",
      UX_BETA_WORKSPACE_ALLOWLIST: workspaceId,
      EVIDENCE_FEATURES_WORKSPACE_ALLOWLIST: workspaceId,
      LOG_LEVEL: "silent",
    }),
    { repository, cache: new MemorySessionCache() },
  );
  app = built.app;
  const email = "native-scene-presenter@example.com";
  const verification = await app.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: { email, segment: "workplace", acceptPolicies: true },
  });
  const token = new URL(verification.json<{ debugUrl: string }>().debugUrl).searchParams.get(
    "token",
  )!;
  const signedIn = await verifyEmailAndSignIn(app, `/v1/auth/verify?token=${token}`, email);
  const cookies = signedIn.headers["set-cookie"]!;
  const cookie = (Array.isArray(cookies) ? cookies[0]! : cookies).split(";")[0]!;
  const creator = (
    await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } })
  ).json<{ creator: CreatorContext }>().creator;
  return { ...built, repository, cookie, creator };
}

async function saveDraft(target: FastifyInstance, cookie: string, draft: PresentationDraft) {
  const created = await target.inject({
    method: "POST",
    url: "/v1/presentations",
    headers: { cookie },
    payload: { title: draft.title },
  });
  expect(created.statusCode).toBe(201);
  const id = created.json().presentation.id as string;
  const mutation = { schemaVersion: 2, draft, expectedRevision: 0, mutationId: randomUUID() };
  const saved = await target.inject({
    method: "PUT",
    url: `/v1/presentations/${id}/draft`,
    headers: { cookie },
    payload: mutation,
  });
  expect(saved.statusCode, saved.body).toBe(200);
  return { id, mutation };
}

function expectPublicScene(snapshot: unknown, scene: unknown) {
  expect(snapshot).toMatchObject({ currentBlock: { scene } });
  expect(JSON.stringify(snapshot)).not.toContain("PRIVATE");
  expect(JSON.stringify(snapshot)).not.toContain("downloadUrl");
}

describe("native Presentation scenes API", () => {
  it("creates a styled native starter atomically when requested while retaining classic API creation", async () => {
    const built = await setup();
    for (const initialSlide of ["native", "classic", undefined] as const) {
      const response = await built.app.inject({
        method: "POST",
        url: "/v1/presentations",
        headers: { cookie: built.cookie },
        payload: { title: "Blank creation", ...(initialSlide ? { initialSlide } : {}) },
      });
      expect(response.statusCode, response.body).toBe(201);
      const record = response.json().presentation;
      expect(record.draftRevision).toBe(0);
      expect(record.draft.schemaVersion).toBe(initialSlide === "native" ? 7 : 2);
      expect(record.draft.blocks).toHaveLength(1);
      const block = record.draft.blocks[0];
      if (initialSlide === "native") {
        expect(block.scene).toMatchObject({
          schemaVersion: 3,
          design: { theme: "paper", font: "sans", spacing: "relaxed" },
        });
        expect(block.textElements).toEqual([]);
        expect(
          block.scene.nodes.map((node: { type: string; role: string; text: string }) => ({
            type: node.type,
            role: node.role,
            text: node.text,
          })),
        ).toEqual([
          { type: "text", role: "title", text: "" },
          { type: "text", role: "body", text: "" },
        ]);
      } else {
        expect(block.scene).toBeUndefined();
        expect(block.textElements).toHaveLength(2);
      }
      expect((await built.presentations.getPresentation(workspaceId, record.id))?.draft).toEqual(
        record.draft,
      );
    }
  });

  it.each([4, 5, 6, 7] as const)(
    "saves exact retries and delivers immutable v%s scenes through completion",
    async (schemaVersion) => {
      const built = await setup();
      vi.spyOn(built.storage, "createDownloadUrl").mockImplementation(
        async (asset) => `https://storage.example.test/${asset.id}`,
      );
      const target = built.app;
      const { cookie } = built;
      const mediaIds = [randomUUID(), randomUUID(), randomUUID()];
      for (const id of mediaIds)
        await built.repository.createMediaAsset({
          id,
          workspaceId,
          objectKey: `native/${id}.png`,
          mimeType: "image/png",
          sizeBytes: 128,
          scanStatus: "clean",
          altText: "Source image description",
          createdAt: new Date(),
        });
      const hiddenMediaId = randomUUID();
      if (schemaVersion >= 6)
        await built.repository.createMediaAsset({
          id: hiddenMediaId,
          workspaceId,
          objectKey: `hidden/${hiddenMediaId}.png`,
          mimeType: "image/png",
          sizeBytes: 128,
          scanStatus: "pending",
          altText: "Pending hidden image",
          createdAt: new Date(),
        });
      const hidden = nativeSceneBlock([hiddenMediaId], "HIDDEN draft-only scene");
      const hiddenImage = hidden.scene.nodes.find((node) => node.type === "image")!;
      if (hiddenImage.type === "image") hiddenImage.altText = "";
      const sceneBlock =
        schemaVersion === 7
          ? designSceneBlock
          : schemaVersion >= 5
            ? richTextSceneBlock
            : nativeSceneBlock;
      const draft = PresentationDraftSchema.parse({
        title: "Native content-only deck",
        schemaVersion,
        blocks: [
          sceneBlock(mediaIds.slice(0, 2)),
          ...(schemaVersion >= 6 ? [{ ...hidden, hidden: true }] : []),
          sceneBlock(mediaIds.slice(2), "Native next steps"),
          ...(schemaVersion >= 6
            ? [
                {
                  id: randomUUID(),
                  kind: "content",
                  layout: "title_body",
                  hidden: true,
                  textElements: [
                    { id: "hidden-title", role: "title", text: "", region: "top_center", order: 0 },
                  ],
                  mediaId: null,
                  mediaAlt: null,
                  speakerNotes: "HIDDEN legacy notes",
                },
              ]
            : []),
        ],
      });
      const content = preparePresentationPublication(draft);
      const firstBlock = content.blocks[0]!;
      if (firstBlock.kind !== "content" || !firstBlock.scene)
        throw new Error("Expected native content");
      const originalScene = structuredClone(firstBlock.scene);
      const { id, mutation } = await saveDraft(target, cookie, draft);
      const retry = await target.inject({
        method: "PUT",
        url: `/v1/presentations/${id}/draft`,
        headers: { cookie },
        payload: mutation,
      });
      expect(retry.statusCode).toBe(200);
      expect(retry.json().presentation).toMatchObject({
        draftRevision: 1,
        draftSchemaVersion: schemaVersion,
        draft,
      });
      const different = structuredClone(draft);
      different.description = "Changed request under an accepted mutation identifier";
      const mismatch = await target.inject({
        method: "PUT",
        url: `/v1/presentations/${id}/draft`,
        headers: { cookie },
        payload: { ...mutation, draft: different },
      });
      expect(mismatch.statusCode).toBe(409);
      const published = await target.inject({
        method: "POST",
        url: `/v1/presentations/${id}/publish`,
        headers: { cookie },
        payload: { expectedDraftRevision: 1 },
      });
      expect(published.statusCode, published.body).toBe(200);
      const version = published.json().version;
      expect(version).toMatchObject({ contentSchemaVersion: schemaVersion, content });
      const republished = await target.inject({
        method: "POST",
        url: `/v1/presentations/${id}/publish`,
        headers: { cookie },
        payload: { expectedDraftRevision: 1 },
      });
      expect(republished.json().version).toEqual(version);
      expect(version.content.blocks).toHaveLength(2);
      expect(JSON.stringify(version.content)).not.toContain("HIDDEN");
      expect((await built.presentations.getPresentation(workspaceId, id))?.draft).toEqual(draft);
      const laterDraft = structuredClone(draft);
      if (schemaVersion >= 6)
        laterDraft.blocks = laterDraft.blocks.map((block) => {
          if (block.kind !== "content") return block;
          const { hidden: _hidden, ...shown } = block;
          void _hidden;
          return shown;
        });
      const laterBlock = laterDraft.blocks[0]!;
      if (laterBlock.kind !== "content" || !laterBlock.scene) throw new Error("Expected scene");
      const titleNode = laterBlock.scene.nodes.find((node) => node.type === "text")!;
      if (titleNode.type !== "text") throw new Error("Expected text");
      titleNode.text = "UNPUBLISHED changed title";
      const changed = await target.inject({
        method: "PUT",
        url: `/v1/presentations/${id}/draft`,
        headers: { cookie },
        payload: { ...mutation, expectedRevision: 1, mutationId: randomUUID(), draft: laterDraft },
      });
      expect(changed.statusCode).toBe(200);
      const hosted = await target.inject({
        method: "POST",
        url: "/v1/presentation-sessions",
        headers: { cookie },
        payload: { presentationId: id },
      });
      expect(hosted.statusCode, hosted.body).toBe(201);
      const { snapshot: lobby, controlToken } = hosted.json();
      const sessionId = lobby.sessionId as string;
      const joined = await target.inject({
        method: "POST",
        url: "/v1/presentation-sessions/join",
        payload: { code: lobby.code, nickname: "River" },
      });
      expect(joined.statusCode).toBe(201);
      const participantToken = joined.json().participantToken as string;
      const command = (expectedRevision: number) => ({
        sessionId,
        controlToken,
        action: "advance",
        commandId: randomUUID(),
        expectedRevision,
      });
      const advanced = await target.inject({
        method: "POST",
        url: `/v1/presentation-sessions/${sessionId}/command`,
        payload: command(0),
      });
      expect(advanced.statusCode, advanced.body).toBe(200);
      expectPublicScene(advanced.json().snapshot, originalScene);
      expect(advanced.json().snapshot.blockCount).toBe(2);
      expect(JSON.stringify(advanced.json().snapshot)).not.toContain("HIDDEN");
      const participant = await target.inject({
        method: "GET",
        url: `/v1/presentation-sessions/${sessionId}/participant`,
        headers: { authorization: `Bearer ${participantToken}` },
      });
      expectPublicScene(participant.json().snapshot, originalScene);
      const pass = await built.presentationService.createCompanionPass({
        workspaceId,
        userId: built.creator.userId,
        sessionId,
        requestId: randomUUID(),
      });
      for (const input of [
        { projection: "host" as const, sessionId, controlToken },
        { projection: "participant" as const, sessionId, participantToken },
        { projection: "companion" as const, sessionId, companionToken: pass.companionToken },
      ])
        expectPublicScene((await built.presentationService.sync(input)).snapshot, originalScene);
      for (const mediaId of mediaIds) {
        const asset = await target.inject({
          method: "GET",
          url: `/v1/presentation-sessions/${sessionId}/media/${mediaId}`,
          headers: { authorization: `Bearer ${participantToken}` },
        });
        expect(asset.statusCode, asset.body).toBe(mediaId === mediaIds[2] ? 404 : 200);
      }
      const unauthorized = await target.inject({
        method: "GET",
        url: `/v1/presentation-sessions/${sessionId}/media/${mediaIds[0]}`,
      });
      expect(unauthorized.statusCode).toBe(401);
      if (schemaVersion >= 6) {
        for (const path of ["media", "host-media"]) {
          const hiddenAccess = await target.inject({
            method: "GET",
            url: `/v1/presentation-sessions/${sessionId}/${path}/${hiddenMediaId}`,
            headers:
              path === "media" ? { authorization: `Bearer ${participantToken}` } : { cookie },
          });
          expect(hiddenAccess.statusCode, hiddenAccess.body).toBe(404);
        }
      }
      const hostMedia = await target.inject({
        method: "GET",
        url: `/v1/presentation-sessions/${sessionId}/host-media/${mediaIds[1]}`,
        headers: { cookie },
      });
      expect(hostMedia.statusCode).toBe(200);
      const second = await target.inject({
        method: "POST",
        url: `/v1/presentation-sessions/${sessionId}/command`,
        payload: command(1),
      });
      expect(second.statusCode).toBe(200);
      expect(second.json().snapshot.currentBlockIndex).toBe(1);
      const previousAsset = await target.inject({
        method: "GET",
        url: `/v1/presentation-sessions/${sessionId}/media/${mediaIds[0]}`,
        headers: { authorization: `Bearer ${participantToken}` },
      });
      expect(previousAsset.statusCode).toBe(404);
      const currentAsset = await target.inject({
        method: "GET",
        url: `/v1/presentation-sessions/${sessionId}/media/${mediaIds[2]}`,
        headers: { authorization: `Bearer ${participantToken}` },
      });
      expect(currentAsset.statusCode).toBe(200);
      const finished = await target.inject({
        method: "POST",
        url: `/v1/presentation-sessions/${sessionId}/command`,
        payload: command(2),
      });
      expect(finished.json()).toMatchObject({ snapshot: { phase: "finished" } });
      await built.presentationReportWorker.runUntilIdle();
      const report = await target.inject({
        method: "GET",
        url: `/v1/presentation-sessions/${sessionId}/report`,
        headers: { cookie },
      });
      expect(report.json()).toMatchObject({
        reportStatus: "ready",
        report: {
          leaderboard: [],
          responseCount: 0,
          evidence: [
            { title: "Native evidence", kind: "content" },
            { title: "Native next steps", kind: "content" },
          ],
        },
      });
      expect(JSON.stringify(report.json())).not.toContain("PRIVATE");
      expect(JSON.stringify(report.json())).not.toContain("UNPUBLISHED");
      expect(JSON.stringify(report.json())).not.toContain("HIDDEN");
      expect(
        await built.presentations.getPresentationVersion(workspaceId, version.id),
      ).toMatchObject({ content, contentHash: version.contentHash });
    },
  );

  it("maps visible publication errors to stable IDs and rejects an all-hidden deck", async () => {
    const built = await setup();
    const hidden = { ...nativeSceneBlock([], "HIDDEN first"), hidden: true };
    const visible = nativeSceneBlock([], "Visible needs a label");
    const shape = visible.scene.nodes.find((node) => node.type === "shape")!;
    if (shape.type === "shape") shape.label = "";
    const draft = PresentationDraftSchema.parse({
      title: "Visibility validation",
      schemaVersion: 6,
      blocks: [hidden, visible],
    });
    const { id } = await saveDraft(built.app, built.cookie, draft);
    const publish = (expectedDraftRevision: number) =>
      built.app.inject({
        method: "POST",
        url: `/v1/presentations/${id}/publish`,
        headers: { cookie: built.cookie },
        payload: { expectedDraftRevision },
      });
    const invalid = await publish(1);
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json().validation.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ blockId: visible.id, field: "label" })]),
    );
    expect(
      invalid
        .json()
        .validation.issues.some((issue: { blockId: string | null }) => issue.blockId === hidden.id),
    ).toBe(false);
    const allHidden = await built.app.inject({
      method: "PUT",
      url: `/v1/presentations/${id}/draft`,
      headers: { cookie: built.cookie },
      payload: {
        schemaVersion: 2,
        mutationId: randomUUID(),
        expectedRevision: 1,
        draft: { ...draft, blocks: draft.blocks.map((block) => ({ ...block, hidden: true })) },
      },
    });
    expect(allHidden.statusCode, allHidden.body).toBe(200);
    const empty = await publish(2);
    expect(empty.statusCode, empty.body).toBe(422);
    expect(empty.json().validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          blockId: null,
          message: "Show a slide or add an activity before publishing",
        }),
      ]),
    );
    expect(
      (await built.presentations.getPresentation(workspaceId, id))?.currentVersionId,
    ).toBeNull();
  });

  it("reports scene image scan, ownership and accessibility blockers at the image placement", async () => {
    const built = await setup();
    for (const status of [
      "pending",
      "rejected",
      "foreign",
      "missing",
      "missing-description",
    ] as const) {
      const mediaId = randomUUID();
      if (status !== "missing")
        await built.repository.createMediaAsset({
          id: mediaId,
          workspaceId: status === "foreign" ? randomUUID() : workspaceId,
          objectKey: `native/${mediaId}.png`,
          mimeType: "image/png",
          sizeBytes: 128,
          scanStatus: status === "pending" || status === "rejected" ? status : "clean",
          altText: "Source image description",
          createdAt: new Date(),
        });
      const block = nativeSceneBlock([mediaId]);
      if (status === "missing-description") {
        const image = block.scene.nodes.find((node) => node.type === "image")!;
        if (image.type === "image") image.altText = "";
      }
      const draft = PresentationDraftSchema.parse({
        title: "Native image validation",
        schemaVersion: 4,
        blocks: [block],
      });
      // Foreign/missing references cannot pass repository draft admission; simulate a retained
      // unavailable reference to verify publication also enforces the workspace boundary.
      const safeDraft =
        status === "foreign" || status === "missing"
          ? PresentationDraftSchema.parse({ ...draft, blocks: [nativeSceneBlock()] })
          : draft;
      const { id } = await saveDraft(built.app, built.cookie, safeDraft);
      if (status === "foreign" || status === "missing")
        (built.presentations as MemoryPresentationRepository).presentations.get(id)!.draft = draft;
      const published = await built.app.inject({
        method: "POST",
        url: `/v1/presentations/${id}/publish`,
        headers: { cookie: built.cookie },
        payload: { expectedDraftRevision: 1 },
      });
      expect(published.statusCode, published.body).toBe(422);
      expect(published.json().validation.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            blockId: block.id,
            path: `blocks.0.scene.nodes.1.${status === "missing-description" ? "altText" : "mediaId"}`,
          }),
        ]),
      );
      expect(
        (await built.presentations.getPresentation(workspaceId, id))?.currentVersionId,
      ).toBeNull();
    }
  });
});
