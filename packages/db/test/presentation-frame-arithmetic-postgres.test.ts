import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PresentationContentSchema,
  type PresentationContent,
  type PresentationSceneFrame,
} from "@openround/contracts";
import { PostgresRepository } from "../src/index.js";
import { discoverMigrations, runMigrations } from "../src/migrations.js";
import { preparePostgresTestRuntime } from "./support/postgres-test-runtime.js";
import { advancedInteractionContent } from "./support/presentation-advanced-interaction-conformance.js";
import { interactionDocument } from "./support/presentation-interaction-fixture.js";
import {
  persistStyledPresentation,
  styledContentHash,
  styledPresentationContent,
} from "./support/presentation-styled-scene-conformance.js";

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const runtimeUrl = process.env.TEST_DATABASE_URL;
const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), "../migrations");

function scene(content: PresentationContent) {
  const block = content.blocks[0]!;
  if (block.kind !== "content" || !block.scene) throw new Error("Expected styled native scene");
  return block.scene;
}

function dataContent() {
  const content = styledPresentationContent();
  scene(content).nodes.push(
    {
      id: "table",
      type: "table",
      caption: "Comparison",
      headers: ["Item", "Count"],
      rows: [["Example", "2"]],
      frame: { x: 10, y: 20, width: 40, height: 30 },
    },
    {
      id: "chart",
      type: "chart",
      chartType: "bar",
      title: "Responses",
      summary: "Two responses chose the example",
      categories: ["Example"],
      series: [{ name: "Responses", values: [2] }],
      frame: { x: 55, y: 20, width: 40, height: 30 },
    },
  );
  scene(content).readingOrder.push("table", "chart");
  return PresentationContentSchema.parse(content);
}

function setDataFrames(content: PresentationContent, frame: PresentationSceneFrame) {
  for (const node of scene(content).nodes)
    if (node.type === "table" || node.type === "chart") node.frame = { ...frame };
}

describe.skipIf(!(adminUrl && runtimeUrl))("Presentation frame arithmetic PostgreSQL", () => {
  const database = `frame_arithmetic_${randomUUID().replaceAll("-", "")}`;
  let administrator: PostgresRepository;
  let repository: PostgresRepository;

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
    const baseline = await mkdtemp(join(tmpdir(), "openround-frame-baseline-"));
    try {
      for (const migration of await discoverMigrations(migrationsDirectory))
        if (migration.version <= 108)
          await writeFile(join(baseline, migration.fileName), migration.sql);
      await runMigrations(administrator.pool, baseline);
    } finally {
      await rm(baseline, { recursive: true, force: true });
    }
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

  async function advancedValid(content: PresentationContent, published = true) {
    return (
      await administrator.pool.query<{ valid: boolean }>(
        "SELECT openround_presentation_advanced_interactions_valid($1::jsonb,18,$2) AS valid",
        [JSON.stringify(content), published],
      )
    ).rows[0]!.valid;
  }

  it("repairs migration108 edge-frame saves without rewriting drafts, history or frozen versions", async () => {
    const f = await persistStyledPresentation(repository, dataContent());
    const content = structuredClone(f.content);
    const origin = 0.1 + 0.2;
    const extent = 100 - origin;
    setDataFrames(content, { x: origin, y: origin, width: extent, height: extent });
    expect(PresentationContentSchema.safeParse(content).success).toBe(true);
    expect(origin + extent).toBe(100);
    expect(await advancedValid(content, false)).toBe(false);

    const save = {
      workspaceId: f.actor.workspaceId,
      presentationId: f.presentation.id,
      draft: content,
      expectedRevision: 1,
      mutationId: randomUUID(),
      editorId: f.actor.userId,
      draftHash: styledContentHash(content),
    };
    await expect(f.presentations.updatePresentationDraft(save)).rejects.toMatchObject({
      code: "23514",
      constraint: "presentations_advanced_interactions_check",
    });
    const before = {
      draft: await f.presentations.getPresentation(f.actor.workspaceId, f.presentation.id),
      history: await f.presentations.listPresentationHistory(
        f.actor.workspaceId,
        f.presentation.id,
      ),
      version: await f.presentations.getPresentationVersion(f.actor.workspaceId, f.version.id),
    };
    await administrator.migrate();
    await administrator.migrate();
    expect(
      (await administrator.pool.query("SELECT name FROM _openround_migrations WHERE version=109"))
        .rows,
    ).toEqual([{ name: "presentation_frame_arithmetic" }]);
    expect({
      draft: await f.presentations.getPresentation(f.actor.workspaceId, f.presentation.id),
      history: await f.presentations.listPresentationHistory(
        f.actor.workspaceId,
        f.presentation.id,
      ),
      version: await f.presentations.getPresentationVersion(f.actor.workspaceId, f.version.id),
    }).toEqual(before);
    expect(await advancedValid(content)).toBe(true);

    // The rejected mutation wrote no receipt; its exact retry now persists every original byte.
    expect(await f.presentations.updatePresentationDraft(save)).toMatchObject({
      draftRevision: 2,
      draftSchemaVersion: 18,
      draft: content,
    });
    const history = (
      await f.presentations.listPresentationHistory(f.actor.workspaceId, f.presentation.id)
    )[0]!;
    expect(history).toMatchObject({ draft: content, draftSchemaVersion: 18 });
    expect(styledContentHash(history.draft)).toBe(styledContentHash(content));
    const published = await f.presentations.publishPresentation(
      {
        ...f.version,
        id: randomUUID(),
        version: 3,
        sourceDraftRevision: 2,
        content,
        contentHash: styledContentHash(content),
      },
      2,
    );
    expect(
      await f.presentations.getPresentationVersion(f.actor.workspaceId, published.id),
    ).toMatchObject({ content, contentHash: styledContentHash(content) });
    expect(await f.presentations.getPresentationVersion(f.actor.workspaceId, f.version.id)).toEqual(
      before.version,
    );
  });

  it("persists table and chart moves/resizes at binary64 right and bottom edges", async () => {
    const f = await persistStyledPresentation(repository, dataContent());
    const origin = 0.1 + 0.2;
    const smallExtent = 10 + Number.EPSILON * 8;
    const frames: PresentationSceneFrame[] = [
      { x: origin, y: 20, width: 100 - origin, height: 30 },
      { x: 10, y: origin, width: 40, height: 100 - origin },
      { x: 100 - smallExtent, y: 100 - smallExtent, width: smallExtent, height: smallExtent },
    ];
    for (const [index, frame] of frames.entries()) {
      const content = structuredClone(f.content);
      setDataFrames(content, frame);
      expect(PresentationContentSchema.safeParse(content).success).toBe(true);
      expect(await advancedValid(content)).toBe(true);
      expect(
        await f.presentations.updatePresentationDraft({
          workspaceId: f.actor.workspaceId,
          presentationId: f.presentation.id,
          draft: content,
          expectedRevision: index + 1,
          mutationId: randomUUID(),
          editorId: f.actor.userId,
          draftHash: styledContentHash(content),
        }),
      ).toMatchObject({ draftRevision: index + 2, draft: content });
      expect(
        (await f.presentations.getPresentation(f.actor.workspaceId, f.presentation.id))?.draft,
      ).toEqual(content);
    }
  });

  it("matches hotspot edge arithmetic and retains invalid geometry and advanced-target guards", async () => {
    const content = dataContent();
    const hotspot = scene(content).nodes.find((node) => node.type === "hotspot")!;
    if (hotspot.type !== "hotspot") throw new Error("Expected hotspot");
    hotspot.frame = { x: 10.300000000000004, y: 20.300000000000004, width: 59.7, height: 69.7 };
    expect(PresentationContentSchema.safeParse(content).success).toBe(true);
    expect(await advancedValid(content)).toBe(true);

    const corruptions: Array<(value: PresentationContent) => void> = [
      (value) => setDataFrames(value, { x: 90, y: 20, width: 10.000000000001, height: 30 }),
      (value) => setDataFrames(value, { x: 10, y: 90, width: 40, height: 10.000000000001 }),
      (value) => setDataFrames(value, { x: -0.000000000001, y: 20, width: 40, height: 30 }),
      (value) => setDataFrames(value, { x: 10, y: -0.000000000001, width: 40, height: 30 }),
      (value) => setDataFrames(value, { x: 10, y: 20, width: 0.999999999999, height: 30 }),
      (value) => setDataFrames(value, { x: 10, y: 20, width: 40, height: 0.999999999999 }),
      (value) => setDataFrames(value, { x: 0, y: 0, width: 100.000000000001, height: 30 }),
      (value) => setDataFrames(value, { x: 0, y: 0, width: 40, height: 100.000000000001 }),
      (value) => {
        const node = scene(value).nodes.find((entry) => entry.type === "hotspot")!;
        if (node.type === "hotspot") node.frame.width += 0.000000000001;
      },
      (value) => {
        const node = scene(value).nodes.find((entry) => entry.type === "hotspot")!;
        if (node.type === "hotspot") node.imageNodeId = "title";
      },
      (value) => {
        const node = scene(value).nodes.find((entry) => entry.type === "navigation")!;
        if (node.type === "navigation") node.targetBlockId = randomUUID();
      },
      (value) => {
        const node = scene(value).nodes.find((entry) => entry.type === "navigation")!;
        if (node.type === "navigation") node.targetBlockId = value.blocks[0]!.id;
      },
      (value) => {
        const block = value.blocks[1]!;
        if (block.kind === "question") block.branches![0]!.targetBlockId = value.blocks[0]!.id;
      },
    ];
    for (const corrupt of corruptions) {
      const invalid = structuredClone(content);
      corrupt(invalid);
      expect(PresentationContentSchema.safeParse(invalid).success).toBe(false);
      expect(await advancedValid(invalid)).toBe(false);
    }
  });

  it("retains scene5 local interactions and scene6 hotspot validation", async () => {
    const local = PresentationContentSchema.parse(interactionDocument());
    expect(scene(local).schemaVersion).toBe(5);
    const origin = 0.1 + 0.2;
    for (const node of scene(local).nodes)
      if (node.type === "table" || node.type === "chart") {
        node.rotation = 0;
        node.frame = { x: origin, y: origin, width: 100 - origin, height: 100 - origin };
      }
    const advanced = advancedInteractionContent();
    expect(scene(advanced).schemaVersion).toBe(6);
    const hotspot = scene(advanced).nodes.find((node) => node.type === "hotspot")!;
    if (hotspot.type !== "hotspot") throw new Error("Expected hotspot");
    hotspot.frame = { x: 10.300000000000004, y: 20.300000000000004, width: 59.7, height: 69.7 };
    const valid = async (content: PresentationContent) =>
      (
        await administrator.pool.query<{ valid: boolean }>(
          `SELECT openround_presentation_interactions_valid($1::jsonb,$2,true)
            AND openround_presentation_advanced_interactions_valid($1::jsonb,$2,true) AS valid`,
          [JSON.stringify(content), content.schemaVersion],
        )
      ).rows[0]!.valid;
    for (const content of [local, advanced]) {
      expect(PresentationContentSchema.safeParse(content).success).toBe(true);
      expect(await valid(content)).toBe(true);
    }
    const link = scene(local).nodes.find((node) => node.type === "link")!;
    if (link.type !== "link") throw new Error("Expected link");
    link.href = "javascript:alert(1)";
    expect(await valid(local)).toBe(false);
    hotspot.imageNodeId = "missing";
    expect(await valid(advanced)).toBe(false);
  });
});
