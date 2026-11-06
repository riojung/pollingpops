import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PresentationContentSchema,
  resolvePresentationSpatialFrames,
  type PresentationContent,
} from "@openround/contracts";
import {
  PostgresRepository,
  createPresentationRepository,
  createPresentationSessionRepository,
} from "../src/index.js";
import {
  advancedInteractionContent,
  expectAdvancedInteractionConformance,
} from "./support/presentation-advanced-interaction-conformance.js";
import {
  createPresentationNavigationSession,
  expectPresentationNavigationConformance,
  presentationNavigationContent,
  presentationNavigationSlide,
} from "./support/presentation-navigation-conformance.js";
import { preparePostgresTestRuntime } from "./support/postgres-test-runtime.js";

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL,
  runtimeUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!(adminUrl && runtimeUrl))("spatial Presentation PostgreSQL", () => {
  const database = `spatial_${randomUUID().replaceAll("-", "")}`;
  let repository: PostgresRepository, runtimeDatabaseUrl: string;
  const reopened: PostgresRepository[] = [];
  beforeAll(async () => {
    await preparePostgresTestRuntime(adminUrl!, runtimeUrl!);
    const cluster = new PostgresRepository(adminUrl!);
    try {
      await cluster.pool.query(`CREATE DATABASE "${database}"`);
    } finally {
      await cluster.close();
    }
    const admin = new URL(adminUrl!),
      runtime = new URL(runtimeUrl!);
    admin.pathname = runtime.pathname = `/${database}`;
    runtimeDatabaseUrl = runtime.toString();
    const migration = new PostgresRepository(admin.toString());
    try {
      await migration.migrate();
      await migration.migrate();
      expect(
        (await migration.pool.query("SELECT name FROM _openround_migrations WHERE version=98"))
          .rows,
      ).toEqual([{ name: "presentation_spatial" }]);
    } finally {
      await migration.close();
    }
    repository = new PostgresRepository(runtimeDatabaseUrl);
    await repository.initialize();
    expect(
      (
        await repository.pool.query(
          "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
        )
      ).rows[0],
    ).toEqual({ rolsuper: false, rolbypassrls: false });
    expect(
      (
        await repository.pool.query(
          "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='presentation_live_sessions'::regclass",
        )
      ).rows[0],
    ).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });
  afterAll(async () => {
    await Promise.all(reopened.map((row) => row.close()));
    await repository?.close();
    const cluster = new PostgresRepository(adminUrl!);
    try {
      await cluster.pool.query(`DROP DATABASE IF EXISTS "${database}" WITH(FORCE)`);
    } finally {
      await cluster.close();
    }
  });
  function reopen() {
    const value = new PostgresRepository(runtimeDatabaseUrl);
    reopened.push(value);
    return createPresentationSessionRepository(value);
  }
  async function fixture(source: PresentationContent) {
    const now = new Date(),
      tokenHash = randomUUID();
    await repository.createMagicToken({
      id: randomUUID(),
      email: `spatial-${randomUUID()}@example.test`,
      segment: "education",
      tokenHash,
      policyVersion: "test",
      expiresAt: new Date(now.getTime() + 60000),
      consumedAt: null,
    });
    const actor = (await repository.consumeMagicToken(tokenHash, now))!;
    const content = PresentationContentSchema.parse({
      ...source,
      schemaVersion: 14,
      spatial: {
        schemaVersion: 1,
        frames: [
          { blockId: source.blocks[0]!.id.toUpperCase(), x: 320, y: 180, width: 1280, height: 720 },
        ],
      },
    });
    for (const block of content.blocks)
      if (block.kind === "content")
        for (const node of block.scene?.nodes ?? [])
          if (node.type === "image")
            await repository.createMediaAsset({
              id: node.mediaId,
              workspaceId: actor.workspaceId,
              objectKey: `media/${actor.workspaceId}/${node.mediaId}.png`,
              mimeType: "image/png",
              sizeBytes: 10,
              scanStatus: "clean",
              altText: node.altText ?? "Example diagram",
              createdAt: now,
            });
    const presentations = createPresentationRepository(repository);
    const presentation = await presentations.createPresentation({
      id: randomUUID(),
      workspaceId: actor.workspaceId,
      title: content.title,
      description: content.description,
      status: "draft",
      draft: content,
      draftRevision: 0,
      draftSchemaVersion: 14,
      currentVersionId: null,
      folderId: null,
      publishedDraftRevision: null,
      lastEditedBy: actor.userId,
      createdAt: now,
      updatedAt: now,
    });
    const contentHash = createHash("sha256").update(JSON.stringify(content)).digest("hex");
    const version = await presentations.publishPresentation(
      {
        id: randomUUID(),
        workspaceId: actor.workspaceId,
        presentationId: presentation.id,
        version: 1,
        content,
        contentSchemaVersion: 14,
        contentHash,
        sourceDraftRevision: 0,
        publishedAt: now,
      },
      0,
    );
    return {
      actor,
      content,
      contentHash,
      presentation,
      version,
      sessions: createPresentationSessionRepository(repository),
    };
  }
  it("keeps scene6 reveal, branch, response and exact receipt behavior under document14 and reload", async () => {
    const f = await fixture(advancedInteractionContent());
    const result = await expectAdvancedInteractionConformance({
      repository: f.sessions,
      workspaceId: f.actor.workspaceId,
      presentationId: f.presentation.id,
      presentationVersionId: f.version.id,
      createdBy: f.actor.userId,
      content: f.content,
      reopenRepository: reopen,
    });
    expect(result.session.content.spatial).toEqual(f.content.spatial);
    expect((await f.sessions.getSessionById(result.session.id))!.interactionState).toEqual(
      result.session.interactionState,
    );
  });
  it("retains original windows, canonical responses, revisits and concurrent navigation receipts under document14", async () => {
    const f = await fixture(presentationNavigationContent());
    await expectPresentationNavigationConformance({
      repository: f.sessions,
      workspaceId: f.actor.workspaceId,
      presentationId: f.presentation.id,
      presentationVersionId: f.version.id,
      createdBy: f.actor.userId,
      content: f.content,
      reopenRepository: reopen,
    });
  });
  it("guards raw spatial shapes, references, versions and frozen live layout while admitting additive fallback frames", async () => {
    const f = await fixture(presentationNavigationContent());
    const valid = async (value: unknown, version = 14, published = true) =>
      (
        await repository.pool.query(
          "SELECT openround_presentation_spatial_valid($1::jsonb,$2,$3) AS valid",
          [JSON.stringify(value), version, published],
        )
      ).rows[0]!.valid;
    expect(await valid(f.content)).toBe(true);
    expect(await valid({ ...f.content, spatial: undefined })).toBe(true);
    expect(await valid({ ...f.content, schemaVersion: 13, spatial: undefined }, 13)).toBe(true);
    expect(await valid(f.content, 13)).toBe(false);
    expect(await valid({ ...f.content, schemaVersion: 13 }, 13)).toBe(false);
    expect(await valid({ ...f.content, schemaVersion: 15 }, 15)).toBe(true);
    expect(await valid({ ...f.content, schemaVersion: 16 }, 16)).toBe(false);
    const original = f.content.spatial!.frames[0]!;
    const invalidLayouts = [
      null,
      { schemaVersion: 2, frames: [] },
      { schemaVersion: 1, frames: {} },
      ...[
        { x: -1 },
        { y: 19999 },
        { x: 0.5 },
        { width: 1281 },
        { width: 3201 },
        { height: 1801 },
        { x: "0" },
        { title: "PRIVATE" },
        { blockId: randomUUID() },
      ].map((change) => ({ schemaVersion: 1, frames: [{ ...original, ...change }] })),
      {
        schemaVersion: 1,
        frames: [original, { ...original, blockId: original.blockId.toLowerCase() }],
      },
      { schemaVersion: 1, frames: Array.from({ length: 201 }, () => original) },
    ];
    for (const spatial of invalidLayouts)
      expect(await valid({ ...f.content, spatial })).toBe(false);
    const hidden = {
      ...f.content,
      blocks: [{ ...f.content.blocks[0]!, hidden: true }, ...f.content.blocks.slice(1)],
    };
    expect(await valid(hidden, 14, false)).toBe(true);
    expect(await valid(hidden)).toBe(false);
    const { session } = await createPresentationNavigationSession({
      repository: f.sessions,
      workspaceId: f.actor.workspaceId,
      presentationId: f.presentation.id,
      presentationVersionId: f.version.id,
      createdBy: f.actor.userId,
      content: f.content,
    });
    const pairSource = presentationNavigationContent().blocks[1]!;
    if (pairSource.kind !== "question") throw new Error("Expected numeric checkpoint");
    const recheckId = randomUUID();
    pairSource.question.linkedRecheckQuestionId = recheckId;
    const paired = await fixture(
      PresentationContentSchema.parse({
        ...f.content,
        spatial: undefined,
        sections: [],
        blocks: [
          pairSource,
          {
            ...pairSource,
            id: randomUUID(),
            question: {
              ...pairSource.question,
              id: recheckId,
              prompt: "Linked recheck",
              purpose: "practice",
              delivery: "recheck",
              linkedRecheckQuestionId: null,
            },
          },
          presentationNavigationSlide("Detour"),
        ],
      }),
    );
    const pairedSession = (
      await createPresentationNavigationSession({
        repository: paired.sessions,
        workspaceId: paired.actor.workspaceId,
        presentationId: paired.presentation.id,
        presentationVersionId: paired.version.id,
        createdBy: paired.actor.userId,
        content: paired.content,
      })
    ).session;
    await paired.sessions.transitionSessionCommand({
      workspaceId: paired.actor.workspaceId,
      sessionId: pairedSession.id,
      expectedRevision: 0,
      commandId: randomUUID(),
      requestHash: "a".repeat(64),
      phase: "question_open",
      currentBlockIndex: 0,
      status: "active",
      event: { type: "question.launched", blockId: pairSource.id, blockIndex: 0 },
    });
    await paired.sessions.transitionSessionCommand({
      workspaceId: paired.actor.workspaceId,
      sessionId: pairedSession.id,
      expectedRevision: 1,
      commandId: randomUUID(),
      requestHash: "b".repeat(64),
      phase: "question_reveal",
      currentBlockIndex: 0,
      status: "active",
      event: { type: "question.revealed", blockId: pairSource.id, blockIndex: 0 },
    });
    const closedPair = (await paired.sessions.getSessionById(pairedSession.id))!;
    const client = await repository.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.workspace_id',$1,true)", [f.actor.workspaceId]);
      const reject = async (sql: string, values: unknown[]) => {
        await client.query("SAVEPOINT invalid_spatial");
        await expect(client.query(sql, values)).rejects.toMatchObject({ code: "23514" });
        await client.query("ROLLBACK TO SAVEPOINT invalid_spatial");
      };
      const invalid = JSON.stringify({
        ...f.content,
        spatial: { schemaVersion: 1, frames: [{ ...original, width: 1281 }] },
      });
      await reject("UPDATE presentations SET draft=$2::jsonb WHERE id=$1", [
        f.presentation.id,
        invalid,
      ]);
      await reject(
        "INSERT INTO presentation_draft_history(id,workspace_id,presentation_id,revision,draft,draft_schema_version,saved_by) VALUES($1,$2,$3,99,$4::jsonb,14,$5)",
        [randomUUID(), f.actor.workspaceId, f.presentation.id, invalid, f.actor.userId],
      );
      await reject(
        "INSERT INTO presentation_versions(id,workspace_id,presentation_id,version,content,content_schema_version,content_hash,source_draft_revision) VALUES($1,$2,$3,2,$4::jsonb,14,$5,0)",
        [randomUUID(), f.actor.workspaceId, f.presentation.id, invalid, randomUUID()],
      );
      for (const spatial of [
        undefined,
        { schemaVersion: 1, frames: [] },
        { schemaVersion: 1, frames: [{ ...original, x: 640 }] },
      ])
        await reject(
          "UPDATE presentation_live_sessions SET content_snapshot=$2::jsonb WHERE id=$1",
          [session.id, JSON.stringify({ ...f.content, spatial })],
        );
      const inserted = {
        ...f.content,
        blocks: [...f.content.blocks, presentationNavigationSlide("Live addition")],
      };
      await client.query(
        "UPDATE presentation_live_sessions SET content_snapshot=$2::jsonb WHERE id=$1",
        [session.id, JSON.stringify(inserted)],
      );
      expect(resolvePresentationSpatialFrames(inserted).at(-1)).toMatchObject({
        blockId: inserted.blocks.at(-1)!.id,
        x: 6400,
        y: 0,
      });
      await client.query("ROLLBACK");
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.workspace_id',$1,true)", [
        paired.actor.workspaceId,
      ]);
      await reject(
        "UPDATE presentation_live_sessions SET current_block_index=2,phase='content',revision=revision+1,navigation_state=$2::jsonb WHERE id=$1",
        [
          pairedSession.id,
          JSON.stringify({
            returnBlockId: pairSource.id,
            blocks: [
              ...closedPair.navigationState!.blocks,
              {
                blockId: paired.content.blocks[2]!.id,
                phase: "content",
                questionOpenedAt: null,
                questionClosesAt: null,
              },
            ],
          }),
        ],
      );
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    expect((await f.sessions.getSessionById(session.id))!.content.spatial).toEqual(
      f.content.spatial,
    );
    expect(
      (await createPresentationRepository(repository).getPresentationVersion(
        f.actor.workspaceId,
        f.version.id,
      ))!.contentHash,
    ).toBe(f.contentHash);
  });
});
