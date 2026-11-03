import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PresentationDraftSchema, type PresentationDraft } from "@openround/contracts";
import {
  MemoryRepository,
  type MemoryPresentationRepository,
  type CreatorContext,
} from "@openround/db";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";
import { verifyEmailAndSignIn } from "./support/email-auth.js";
import { nativeSceneBlock } from "./support/presentation-native-scene.js";

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
  it("saves exact retries, publishes immutable scenes and delivers authorized role projections through completion", async () => {
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
    const draft = PresentationDraftSchema.parse({
      title: "Native content-only deck",
      schemaVersion: 4,
      blocks: [
        nativeSceneBlock(mediaIds.slice(0, 2)),
        nativeSceneBlock(mediaIds.slice(2), "Native next steps"),
      ],
    });
    const firstBlock = draft.blocks[0]!;
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
      draftSchemaVersion: 4,
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
    expect(version).toMatchObject({ contentSchemaVersion: 4, content: draft });
    const republished = await target.inject({
      method: "POST",
      url: `/v1/presentations/${id}/publish`,
      headers: { cookie },
      payload: { expectedDraftRevision: 1 },
    });
    expect(republished.json().version).toEqual(version);
    const laterDraft = structuredClone(draft);
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
    expect(await built.presentations.getPresentationVersion(workspaceId, version.id)).toMatchObject(
      { content: draft, contentHash: version.contentHash },
    );
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
