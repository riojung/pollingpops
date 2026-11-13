import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PRESENTATION_MOTION_BACKGROUND_PRESETS,
  PRESENTATION_TEXT_ASSISTANCE_REVIEW_WARNING,
  PresentationContentSchema,
  type PresentationContent,
  type PresentationMotionBackground,
} from "@openround/contracts";
import {
  PostgresRepository,
  createPresentationAssignmentRepository,
  createPresentationSessionRepository,
} from "../src/index.js";
import { preparePostgresTestRuntime } from "./support/postgres-test-runtime.js";
import { presentationSharingFixture } from "./support/presentation-sharing-conformance.js";
import {
  advancedInteractionContent,
  expectAdvancedInteractionConformance,
} from "./support/presentation-advanced-interaction-conformance.js";
import { expectPresentationOpinionResponseConformance } from "./support/presentation-opinion-conformance.js";
import { expectPresentationTextConformance } from "./support/presentation-text-conformance.js";

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const runtimeUrl = process.env.TEST_DATABASE_URL;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function motionContent(motionBackground: PresentationMotionBackground = "aurora") {
  const original = advancedInteractionContent();
  return PresentationContentSchema.parse({
    ...original,
    schemaVersion: 17,
    sections: [{ id: randomUUID(), title: "Core", blockIds: original.blocks.map(({ id }) => id) }],
    spatial: {
      schemaVersion: 1,
      frames: [{ blockId: original.blocks[0]!.id, x: 0, y: 0, width: 1280, height: 720 }],
    },
    blocks: original.blocks.map((block) =>
      block.kind !== "content" || !block.scene
        ? block
        : {
            ...block,
            textAssistance: {
              schemaVersion: 1,
              nodeId: "title",
              role: "title",
              operation: "translate",
              sourceDigest: "a".repeat(64),
              outputDigest: "b".repeat(64),
              provider: "approved-test",
              model: "bounded-test",
              generatedAt: "2026-11-01T00:00:00.000Z",
              reviewWarning: PRESENTATION_TEXT_ASSISTANCE_REVIEW_WARNING,
              targetLanguage: "fr",
              sourceLanguage: "en",
            },
            scene: {
              ...block.scene,
              schemaVersion: 8,
              design: { theme: "ocean", font: "serif", spacing: "compact", motionBackground },
              nodes: block.scene.nodes.map((node) =>
                node.type === "text" ? { ...node, lang: "fr" } : node,
              ),
            },
          },
    ),
  });
}

describe.skipIf(!(adminUrl && runtimeUrl))("motion background Presentation PostgreSQL", () => {
  const database = `motion_${randomUUID().replaceAll("-", "")}`;
  let repository: PostgresRepository;
  let administrator: PostgresRepository;
  beforeAll(async () => {
    await preparePostgresTestRuntime(adminUrl!, runtimeUrl!);
    const cluster = new PostgresRepository(adminUrl!);
    try {
      await cluster.pool.query(`CREATE DATABASE "${database}"`);
    } finally {
      await cluster.close();
    }
    const admin = new URL(adminUrl!);
    const runtime = new URL(runtimeUrl!);
    admin.pathname = runtime.pathname = `/${database}`;
    administrator = new PostgresRepository(admin.toString());
    await administrator.migrate();
    await administrator.migrate();
    expect(
      (await administrator.pool.query("SELECT name FROM _openround_migrations WHERE version=107"))
        .rows,
    ).toEqual([{ name: "presentation_motion_backgrounds" }]);
    repository = new PostgresRepository(runtime.toString());
    await repository.initialize();
    expect(
      (
        await repository.pool.query(
          "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
        )
      ).rows[0],
    ).toEqual({ rolsuper: false, rolbypassrls: false });
  }, 60_000);
  afterAll(async () => {
    await repository?.close();
    await administrator?.close();
    const cluster = new PostgresRepository(adminUrl!);
    try {
      await cluster.pool.query(`DROP DATABASE IF EXISTS "${database}" WITH(FORCE)`);
    } finally {
      await cluster.close();
    }
  });

  async function fixture(content = motionContent()) {
    const source = await presentationSharingFixture(repository, "motion");
    for (const block of content.blocks)
      if (block.kind === "content")
        for (const node of block.scene?.nodes ?? [])
          if (node.type === "image")
            await repository.createMediaAsset({
              id: node.mediaId,
              workspaceId: source.actor.workspaceId,
              objectKey: `media/${source.actor.workspaceId}/${node.mediaId}.png`,
              mimeType: "image/png",
              sizeBytes: 10,
              scanStatus: "clean",
              altText: node.altText ?? "Example diagram",
              createdAt: source.now,
            });
    const saved = await source.presentations.updatePresentationDraft({
      workspaceId: source.actor.workspaceId,
      presentationId: source.presentation.id,
      draft: content,
      expectedRevision: 0,
      mutationId: randomUUID(),
      editorId: source.actor.userId,
      draftHash: hash(content),
    });
    expect(saved).toMatchObject({ draftSchemaVersion: 17, draft: content });
    const version = await source.presentations.publishPresentation(
      {
        ...source.version,
        id: randomUUID(),
        version: 2,
        sourceDraftRevision: 1,
        contentSchemaVersion: 17,
        content,
        contentHash: hash(content),
      },
      1,
    );
    return {
      ...source,
      content,
      version,
      legacyVersion: source.version,
      sessions: createPresentationSessionRepository(repository),
    };
  }

  it("writes all six presets to drafts/history/publications and retains frozen review and reading sources", async () => {
    for (const preset of PRESENTATION_MOTION_BACKGROUND_PRESETS) {
      const f = await fixture(motionContent(preset));
      expect(
        (await f.presentations.listPresentationHistory(f.actor.workspaceId, f.presentation.id))[0],
      ).toMatchObject({ draftSchemaVersion: 17, draft: f.content });
      expect(
        await f.presentations.getPresentationVersion(f.actor.workspaceId, f.version.id),
      ).toMatchObject({
        contentSchemaVersion: 17,
        content: f.content,
        contentHash: hash(f.content),
      });
      // The earlier immutable static publication keeps its original version and hash.
      expect(
        await f.presentations.getPresentationVersion(f.actor.workspaceId, f.legacyVersion.id),
      ).toEqual(f.legacyVersion);
      expect(JSON.stringify(f.legacyVersion.content)).not.toContain("motionBackground");
      const request = { ...f.request(), versionId: f.version.id };
      const share = (await f.shares.createShare(request)).share;
      expect(
        (await f.shares.getPublicShare(share.id, request.tokenHash, f.now))?.version.content,
      ).toEqual(f.content);
      const assignments = createPresentationAssignmentRepository(repository);
      const assignment = (
        await assignments.createAssignment({ ...request, requestId: randomUUID() })
      ).assignment;
      expect(
        (await assignments.getPublicAssignment(assignment.id, request.tokenHash, f.now))?.version
          .content,
      ).toEqual(f.content);
    }
  });

  it("preserves durable reveal, navigation, branch response and exact retry fences with scene8 and language", async () => {
    const f = await fixture();
    const result = await expectAdvancedInteractionConformance({
      repository: f.sessions,
      workspaceId: f.actor.workspaceId,
      presentationId: f.presentation.id,
      presentationVersionId: f.version.id,
      createdBy: f.actor.userId,
      content: f.content,
    });
    expect((await f.sessions.getSessionById(result.session.id))?.content).toEqual(f.content);
    expect(result.session.content.blocks[0]).toMatchObject({
      scene: { schemaVersion: 8, design: { motionBackground: "aurora" } },
    });
  });

  it("retains unscored poll/ranking formats and private moderated text response fences in motion snapshots", async () => {
    const f = await fixture();
    const input = {
      repository: f.sessions,
      workspaceId: f.actor.workspaceId,
      presentationId: f.presentation.id,
      presentationVersionId: f.version.id,
      createdBy: f.actor.userId,
      schemaVersion: 17 as const,
      additionalBlocks: f.content.blocks.filter((block) => block.kind === "content"),
    };
    await expectPresentationOpinionResponseConformance(input);
    await expectPresentationTextConformance(input);
  });

  it("rejects invalid raw SQL tokens, wrong scene/document/stored versions, private fields and hidden publications", async () => {
    const f = await fixture();
    const mutate = (edit: (content: PresentationContent) => void) => {
      const content = structuredClone(f.content);
      edit(content);
      return content;
    };
    const invalid = [
      ...["none", "Aurora", "url(https://example.com)", null, {}, 1].map((motionBackground) =>
        mutate((content) => {
          const block = content.blocks[0]!;
          if (block.kind !== "content" || !block.scene?.design) throw new Error("Expected design");
          Object.assign(block.scene.design, { motionBackground });
        }),
      ),
      ...[1, 2, 3, 4, 5, 6, 7, 9].map((schemaVersion) =>
        mutate((content) => {
          const block = content.blocks[0]!;
          if (block.kind === "content") Object.assign(block.scene!, { schemaVersion });
        }),
      ),
      mutate((content) => {
        Object.assign(content, { schemaVersion: 16 });
      }),
      mutate((content) => {
        Object.assign(content, { schemaVersion: 18 });
      }),
      mutate((content) => {
        const block = content.blocks[0]!;
        if (block.kind === "content") Object.assign(block.scene!, { speakerNotes: "PRIVATE" });
      }),
      mutate((content) => {
        const block = content.blocks[0]!;
        if (block.kind === "content") Object.assign(block.scene!.design!, { speed: 2 });
      }),
    ];
    for (const content of invalid)
      await expect(
        administrator.pool.query(
          "UPDATE presentations SET draft=$1::jsonb,draft_schema_version=$2 WHERE id=$3",
          [JSON.stringify(content), content.schemaVersion, f.presentation.id],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    for (const version of [16, 18])
      await expect(
        administrator.pool.query("UPDATE presentations SET draft_schema_version=$1 WHERE id=$2", [
          version,
          f.presentation.id,
        ]),
      ).rejects.toMatchObject({ code: "23514" });
    const hidden = mutate((content) => {
      Object.assign(content.blocks[0]!, { hidden: true });
    });
    const validate = async (content: unknown, published = true) =>
      (
        await administrator.pool.query<{ valid: boolean }>(
          "SELECT openround_presentation_motion_backgrounds_valid($1::jsonb,17,$2) AS valid",
          [JSON.stringify(content), published],
        )
      ).rows[0]!.valid;
    expect(await validate(f.content)).toBe(true);
    expect(await validate(hidden)).toBe(false);
    expect(await validate(hidden, false)).toBe(true);
    expect(
      (await f.presentations.getPresentation(f.actor.workspaceId, f.presentation.id))?.draft,
    ).toEqual(f.content);
  });
});
