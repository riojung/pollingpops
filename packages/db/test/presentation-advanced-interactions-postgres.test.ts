import { randomUUID, randomInt } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  PostgresRepository,
  createPresentationRepository,
  createPresentationSessionRepository,
  type PresentationSessionCommandInput,
} from "../src/index.js";
import {
  advancedInteractionContent,
  expectAdvancedInteractionConformance,
} from "./support/presentation-advanced-interaction-conformance.js";
import { preparePostgresTestRuntime } from "./support/postgres-test-runtime.js";
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL,
  runtimeUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!(adminUrl && runtimeUrl))("advanced Presentation PostgreSQL", () => {
  const database = `advanced_interactions_${randomUUID().replaceAll("-", "")}`;
  let repository: PostgresRepository;
  let runtimeDatabaseUrl: string;
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
        (await migration.pool.query("SELECT name FROM _openround_migrations WHERE version=96"))
          .rows,
      ).toEqual([{ name: "presentation_advanced_interactions" }]);
    } finally {
      await migration.close();
    }
    repository = new PostgresRepository(runtimeDatabaseUrl);
    await repository.initialize();
    const role = await repository.pool.query(
      "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
    );
    expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    expect(
      (
        await repository.pool.query(
          "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='presentation_live_sessions'::regclass",
        )
      ).rows[0],
    ).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });
  afterAll(async () => {
    await Promise.all(reopened.map((repo) => repo.close()));
    await repository?.close();
    const cluster = new PostgresRepository(adminUrl!);
    try {
      await cluster.pool.query(`DROP DATABASE IF EXISTS "${database}" WITH(FORCE)`);
    } finally {
      await cluster.close();
    }
  });
  async function fixture() {
    const now = new Date(),
      tokenHash = randomUUID();
    await repository.createMagicToken({
      id: randomUUID(),
      email: `advanced-${randomUUID()}@example.test`,
      segment: "education",
      tokenHash,
      policyVersion: "test",
      expiresAt: new Date(now.getTime() + 60000),
      consumedAt: null,
    });
    const actor = (await repository.consumeMagicToken(tokenHash, now))!;
    const content = advancedInteractionContent();
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
              altText: "Example diagram",
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
      draftSchemaVersion: 13,
      currentVersionId: null,
      folderId: null,
      publishedDraftRevision: null,
      lastEditedBy: actor.userId,
      createdAt: now,
      updatedAt: now,
    });
    const version = await presentations.publishPresentation(
      {
        id: randomUUID(),
        workspaceId: actor.workspaceId,
        presentationId: presentation.id,
        version: 1,
        content,
        contentSchemaVersion: 13,
        contentHash: createHash("sha256").update(JSON.stringify(content)).digest("hex"),
        sourceDraftRevision: 0,
        publishedAt: now,
      },
      0,
    );
    return {
      actor,
      content,
      presentation,
      version,
      now,
      sessions: createPresentationSessionRepository(repository),
    };
  }
  it("persists atomic reveals and answer branches through receipts, real responses and reload", async () => {
    const f = await fixture();
    const result = await expectAdvancedInteractionConformance({
      repository: f.sessions,
      workspaceId: f.actor.workspaceId,
      presentationId: f.presentation.id,
      presentationVersionId: f.version.id,
      createdBy: f.actor.userId,
      content: f.content,
      reopenRepository: () => {
        const repo = new PostgresRepository(runtimeDatabaseUrl);
        reopened.push(repo);
        return createPresentationSessionRepository(repo);
      },
    });
    const client = await repository.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.workspace_id',$1,true)", [f.actor.workspaceId]);
      await expect(
        client.query(
          "INSERT INTO presentation_session_timeline(id,workspace_id,session_id,sequence,event_type,block_index,block_id,occurred_at,navigation,branch) VALUES($1,$2,$3,$4,'navigation.branched',2,$5,$6,$7::jsonb,$8::jsonb)",
          [
            randomUUID(),
            f.actor.workspaceId,
            result.session.id,
            result.session.eventSeq + 1,
            result.content.blocks[2]!.id,
            new Date(),
            JSON.stringify(result.branch.event.navigation),
            JSON.stringify({ ...result.branch.event.branch, matchedResponses: 2 }),
          ],
        ),
      ).rejects.toMatchObject({
        code: "23514",
        message: expect.stringContaining("Branch condition"),
      });
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });
  it("guards raw scene targets, versions, reveal state transitions and private frozen content", async () => {
    const f = await fixture();
    const valid = async (value: unknown, version = 13, published = true) =>
      (
        await repository.pool.query(
          "SELECT openround_presentation_advanced_interactions_valid($1::jsonb,$2,$3) AS valid",
          [JSON.stringify(value), version, published],
        )
      ).rows[0]!.valid;
    expect(await valid(f.content)).toBe(true);
    expect(await valid(f.content, 12)).toBe(false);
    const wrong = structuredClone(f.content);
    wrong.schemaVersion = 12;
    expect(await valid(wrong, 12)).toBe(false);
    const invalidTarget = structuredClone(f.content);
    const block = invalidTarget.blocks[0]!;
    if (block.kind !== "content" || !block.scene) throw new Error("Expected scene");
    const hotspot = block.scene.nodes.find((node) => node.type === "hotspot")!;
    if (hotspot.type !== "hotspot") throw new Error("Expected hotspot");
    hotspot.imageNodeId = "missing";
    expect(await valid(invalidTarget)).toBe(false);
    const invalidBranch = structuredClone(f.content);
    const source = invalidBranch.blocks[1]!;
    if (source.kind !== "question") throw new Error("Expected source");
    source.branches![0]!.targetBlockId = invalidBranch.blocks[0]!.id;
    expect(await valid(invalidBranch)).toBe(false);
    const session = await f.sessions.createSession({
      id: randomUUID(),
      workspaceId: f.actor.workspaceId,
      presentationId: f.presentation.id,
      presentationVersionId: f.version.id,
      title: f.content.title,
      content: f.content,
      code: String(randomInt(1000000, 10000000)),
      status: "active",
      phase: "content",
      currentBlockIndex: 0,
      revision: 0,
      createdBy: f.actor.userId,
      createdAt: f.now,
      updatedAt: f.now,
      finishedAt: null,
      liveExpiresAt: new Date(f.now.getTime() + 3600000),
      retentionExpiresAt: new Date(f.now.getTime() + 86400000),
    });
    const client = await repository.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.workspace_id',$1,true)", [f.actor.workspaceId]);
      const reject = async (sql: string, params: unknown[]) => {
        await client.query("SAVEPOINT invalid_advanced");
        await expect(client.query(sql, params)).rejects.toMatchObject({ code: "23514" });
        await client.query("ROLLBACK TO SAVEPOINT invalid_advanced");
      };
      await reject(
        "UPDATE presentation_live_sessions SET interaction_state=$2::jsonb,revision=revision+1 WHERE id=$1",
        [
          session.id,
          JSON.stringify({
            reveals: [{ blockId: f.content.blocks[0]!.id, nodeId: "dialog", revealed: true }],
          }),
        ],
      );
      await reject(
        "UPDATE presentation_live_sessions SET interaction_state=$2::jsonb,revision=revision+1 WHERE id=$1",
        [
          session.id,
          JSON.stringify({
            reveals: [{ blockId: f.content.blocks[0]!.id, nodeId: "broadcast", revealed: false }],
          }),
        ],
      );
      const edited = structuredClone(f.content);
      const scene = edited.blocks[0]!;
      if (scene.kind !== "content" || !scene.scene) throw new Error("Expected scene");
      const reveal = scene.scene.nodes.find((node) => node.type === "reveal")!;
      if (reveal.type !== "reveal") throw new Error("Expected reveal");
      reveal.body = "Changed frozen secret";
      await reject("UPDATE presentation_live_sessions SET content_snapshot=$2::jsonb WHERE id=$1", [
        session.id,
        JSON.stringify(edited),
      ]);
      await reject(
        "UPDATE presentation_live_sessions SET phase='question_open',current_block_index=1,interaction_state=$2::jsonb,revision=revision+1 WHERE id=$1",
        [
          session.id,
          JSON.stringify({
            reveals: [{ blockId: f.content.blocks[0]!.id, nodeId: "broadcast", revealed: true }],
          }),
        ],
      );
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    const reveal = { blockId: f.content.blocks[0]!.id, nodeId: "broadcast", revealed: true };
    const command: PresentationSessionCommandInput = {
      workspaceId: f.actor.workspaceId,
      sessionId: session.id,
      expectedRevision: 0,
      commandId: randomUUID(),
      requestHash: "d".repeat(64),
      phase: "content",
      currentBlockIndex: 0,
      status: "active",
      interactionState: { reveals: [reveal] },
      event: {
        type: "scene.reveal_changed",
        blockId: reveal.blockId,
        blockIndex: 0,
        interaction: reveal,
      },
    };
    const race = await Promise.all([
      f.sessions.transitionSessionCommand(command),
      f.sessions.transitionSessionCommand(command),
    ]);
    expect(race.map((result) => result.status).sort()).toEqual(["accepted", "duplicate"]);
    const stored = (await f.sessions.getSessionById(session.id))!;
    expect(stored.navigationState).toEqual(session.navigationState);
    expect(stored.questionOpenedAt).toBeNull();
    expect(stored.interactionState).toEqual({ reveals: [reveal] });
    const raw = await repository.pool.connect();
    try {
      await raw.query("BEGIN");
      await raw.query("SELECT set_config('app.workspace_id',$1,true)", [f.actor.workspaceId]);
      await raw.query("SAVEPOINT repeated_reveal");
      await expect(
        raw.query(
          "INSERT INTO presentation_session_timeline(id,workspace_id,session_id,sequence,event_type,block_index,block_id,occurred_at,interaction) VALUES($1,$2,$3,$4,'scene.reveal_changed',0,$5,$6,$7::jsonb)",
          [
            randomUUID(),
            f.actor.workspaceId,
            session.id,
            stored.eventSeq + 1,
            reveal.blockId,
            new Date(),
            JSON.stringify(reveal),
          ],
        ),
      ).rejects.toMatchObject({
        code: "23514",
        message: expect.stringContaining("actual state change"),
      });
      await raw.query("ROLLBACK TO SAVEPOINT repeated_reveal");
      await expect(
        raw.query(
          "INSERT INTO presentation_session_command_receipts(id,workspace_id,session_id,command_id,expected_revision,resulting_revision,event_type,received_at,request_hash) VALUES($1,$2,$3,$4,0,1,'scene.reveal_changed',$5,NULL)",
          [randomUUID(), f.actor.workspaceId, session.id, randomUUID(), new Date()],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await raw.query("ROLLBACK");
    } finally {
      raw.release();
    }
    await expect(
      f.sessions.transitionSessionCommand({
        ...command,
        commandId: randomUUID(),
        expectedRevision: stored.revision,
      }),
    ).rejects.toThrow("already");
  });
});
