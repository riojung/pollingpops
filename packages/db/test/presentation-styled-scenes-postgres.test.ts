import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PresentationContentSchema, type PresentationContent } from "@openround/contracts";
import { PostgresRepository, createPresentationAssignmentRepository } from "../src/index.js";
import { preparePostgresTestRuntime } from "./support/postgres-test-runtime.js";
import { expectAdvancedInteractionConformance } from "./support/presentation-advanced-interaction-conformance.js";
import {
  persistStyledPresentation,
  styledPresentationContent,
  styledContentHash,
} from "./support/presentation-styled-scene-conformance.js";

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const runtimeUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!(adminUrl && runtimeUrl))("styled native Presentation PostgreSQL", () => {
  const database = `styled_${randomUUID().replaceAll("-", "")}`;
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
      (await administrator.pool.query("SELECT name FROM _openround_migrations WHERE version=108"))
        .rows,
    ).toEqual([{ name: "presentation_styled_scenes" }]);
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

  async function valid(content: unknown, published = true, storedVersion = 18) {
    return (
      await administrator.pool.query<{ valid: boolean }>(
        "SELECT openround_presentation_styled_scenes_valid($1::jsonb,$2,$3) AS valid",
        [JSON.stringify(content), storedVersion, published],
      )
    ).rows[0]!.valid;
  }

  it("saves all named palettes through drafts/history/publications and private reading/share sources without rewriting legacy versions", async () => {
    for (const palette of [
      "default",
      "ink",
      "clay",
      "coral",
      "forest",
      "cobalt",
      "rose",
      "sand",
    ] as const) {
      const f = await persistStyledPresentation(repository, styledPresentationContent(palette));
      expect(
        (await f.presentations.listPresentationHistory(f.actor.workspaceId, f.presentation.id))[0],
      ).toMatchObject({ draftSchemaVersion: 18, draft: f.content });
      expect(
        await f.presentations.getPresentationVersion(f.actor.workspaceId, f.version.id),
      ).toMatchObject({
        contentSchemaVersion: 18,
        content: f.content,
        contentHash: styledContentHash(f.content),
      });
      expect(
        await f.presentations.getPresentationVersion(f.actor.workspaceId, f.legacyVersion.id),
      ).toEqual(f.legacyVersion);
      const request = { ...f.request(), versionId: f.version.id };
      const share = (await f.shares.createShare(request)).share;
      expect(
        (await f.shares.getPublicShare(share.id, request.tokenHash, f.now))?.version.content,
      ).toEqual(f.content);
      const assignments = createPresentationAssignmentRepository(repository);
      const assignment = (await assignments.createAssignment(request)).assignment;
      expect(
        (await assignments.getPublicAssignment(assignment.id, request.tokenHash, f.now))?.version
          .content,
      ).toEqual(f.content);
    }
  });

  it("retains original styled bytes through durable navigation, shared reveal and response transactions", async () => {
    const f = await persistStyledPresentation(repository);
    const result = await expectAdvancedInteractionConformance({
      repository: f.sessions,
      workspaceId: f.actor.workspaceId,
      presentationId: f.presentation.id,
      presentationVersionId: f.version.id,
      createdBy: f.actor.userId,
      content: f.content,
    });
    expect((await f.sessions.getSessionById(result.session.id))?.content).toEqual(f.content);
    const frozen = (
      await administrator.pool.query(
        "SELECT content_snapshot FROM presentation_live_sessions WHERE id=$1",
        [result.session.id],
      )
    ).rows[0]!.content_snapshot;
    expect(frozen).toEqual(f.content);
    const corrupt = structuredClone(f.content);
    const block = corrupt.blocks[0]!;
    if (block.kind !== "content") throw new Error("Expected content");
    Object.assign(block.scene!.design!, { palette: "url(evil)" });
    await expect(
      administrator.pool.query(
        "UPDATE presentation_live_sessions SET content_snapshot=$1::jsonb WHERE id=$2",
        [JSON.stringify(corrupt), result.session.id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    expect((await f.sessions.getSessionById(result.session.id))?.content).toEqual(f.content);
  });

  it("accepts boundary style values and rejects strict invalid fields, wrong floors and unknown future versions in raw writes", async () => {
    const f = await persistStyledPresentation(repository);
    const mutate = (edit: (content: PresentationContent) => void) => {
      const content = structuredClone(f.content);
      edit(content);
      return content;
    };
    const text = (content: PresentationContent) => {
      const block = content.blocks[0]!;
      if (block.kind !== "content") throw new Error("Expected content");
      return block.scene!.nodes[0]!;
    };
    const decoration = (content: PresentationContent) => {
      const block = content.blocks[0]!;
      if (block.kind !== "content") throw new Error("Expected content");
      return block.scene!.nodes.at(-1)!;
    };
    for (const typography of [
      {},
      { size: 12, weight: 400, align: "left", font: "sans", color: "text", leading: 0.85 },
      { size: 144, weight: 900, align: "right", font: "mono", color: "background", leading: 1.8 },
      { size: 48.5, weight: 500, align: "center", font: "serif", color: "muted", leading: 1.2 },
      { weight: 600, color: "accent" },
      { weight: 800, color: "accentText" },
    ]) {
      const content = mutate((value) => {
        Object.assign(text(value), { typography });
      });
      expect(PresentationContentSchema.safeParse(content).success).toBe(true);
      expect(await valid(content)).toBe(true);
    }
    for (const appearance of [
      {},
      { fill: "surface", stroke: "none", strokeWidth: 0 },
      { fill: "none", stroke: "accent", strokeWidth: 6 },
      { fill: "accentText", stroke: "accentText", strokeWidth: 1.5 },
      { fill: "background", stroke: "text" },
      { fill: "muted", stroke: "muted" },
      { fill: "accent", stroke: "background" },
    ])
      expect(
        await valid(
          mutate((content) => {
            Object.assign(decoration(content), { appearance });
          }),
        ),
      ).toBe(true);

    const invalid: PresentationContent[] = [
      ...[null, "url(evil)", [], "Default", 1].map((palette) =>
        mutate((content) => {
          const block = content.blocks[0]!;
          if (block.kind === "content") Object.assign(block.scene!.design!, { palette });
        }),
      ),
      ...[
        null,
        [],
        "large",
        { size: 11.9 },
        { size: 144.1 },
        { size: "24" },
        { size: null },
        { weight: 450 },
        { weight: "700" },
        { align: "justify" },
        { font: "url(evil)" },
        { color: "#fff" },
        { leading: 0.84 },
        { leading: 1.81 },
        { leading: null },
        { padding: 2 },
      ].map((typography) =>
        mutate((content) => {
          Object.assign(text(content), { typography });
        }),
      ),
      ...[
        null,
        [],
        { fill: "#fff" },
        { stroke: "surface" },
        { strokeWidth: -0.1 },
        { strokeWidth: 6.1 },
        { strokeWidth: "1" },
        { opacity: 0.5 },
      ].map((appearance) =>
        mutate((content) => {
          Object.assign(decoration(content), { appearance });
        }),
      ),
      ...[null, "true", 1].map((decorative) =>
        mutate((content) => {
          Object.assign(decoration(content), { decorative });
        }),
      ),
      mutate((content) => {
        Object.assign(text(content), { appearance: {} });
      }),
      mutate((content) => {
        Object.assign(decoration(content), { typography: {} });
      }),
      mutate((content) => {
        Object.assign(content, { schemaVersion: 17 });
      }),
      mutate((content) => {
        Object.assign(content, { schemaVersion: 19 });
      }),
      ...[1, 2, 3, 4, 5, 6, 7, 8, 10].map((schemaVersion) =>
        mutate((content) => {
          const block = content.blocks[0]!;
          if (block.kind === "content") Object.assign(block.scene!, { schemaVersion });
        }),
      ),
    ];
    for (const content of invalid) {
      expect(await valid(content, false, content.schemaVersion)).toBe(false);
      await expect(
        administrator.pool.query(
          "UPDATE presentations SET draft=$1::jsonb,draft_schema_version=$2 WHERE id=$3",
          [JSON.stringify(content), content.schemaVersion, f.presentation.id],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    }
    for (const storedVersion of [17, 19])
      expect(await valid(f.content, false, storedVersion)).toBe(false);
    expect(
      (await f.presentations.getPresentation(f.actor.workspaceId, f.presentation.id))?.draft,
    ).toEqual(f.content);
  });

  it("rejects missing or null scene versions on motion-only payloads disguised as legacy document2", async () => {
    const f = await persistStyledPresentation(repository);
    for (const schemaVersion of [undefined, null]) {
      const scene = {
        ...(schemaVersion === undefined ? {} : { schemaVersion }),
        aspectRatio: "16:9",
        design: { theme: "paper", font: "sans", spacing: "relaxed", motionBackground: "waves" },
        nodes: [
          {
            id: "title",
            type: "text",
            role: "title",
            text: "Legacy motion bypass",
            frame: { x: 7, y: 7, width: 86, height: 20 },
          },
        ],
        readingOrder: ["title"],
      };
      const legacy = {
        schemaVersion: 2,
        title: "Legacy motion bypass",
        description: "",
        experiencePreset: { id: "focus", version: 1 },
        blocks: [
          {
            id: randomUUID(),
            kind: "content",
            layout: "title_body",
            textElements: [],
            mediaId: null,
            mediaAlt: null,
            speakerNotes: "",
            scene,
          },
        ],
      };
      expect(
        (
          await administrator.pool.query(
            "SELECT openround_presentation_motion_scene_design_valid($1::jsonb) valid",
            [JSON.stringify(scene)],
          )
        ).rows[0]!.valid,
      ).toBe(false);
      expect(
        (
          await administrator.pool.query(
            "SELECT openround_presentation_motion_backgrounds_valid($1::jsonb,2,false) valid",
            [JSON.stringify(legacy)],
          )
        ).rows[0]!.valid,
      ).toBe(false);
      await expect(
        administrator.pool.query(
          "UPDATE presentations SET draft=$1::jsonb,draft_schema_version=2 WHERE id=$2",
          [JSON.stringify(legacy), f.presentation.id],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    }
    expect(
      (await f.presentations.getPresentation(f.actor.workspaceId, f.presentation.id))?.draft,
    ).toEqual(f.content);
  });

  it("keeps publication meaning, hidden-state, provenance, frame and full-byte-budget checks before projection", async () => {
    const content = styledPresentationContent();
    expect(await valid(content)).toBe(true);
    const mutate = (edit: (value: PresentationContent) => void) => {
      const value = structuredClone(content);
      edit(value);
      return value;
    };
    const hidden = mutate((value) => {
      Object.assign(value.blocks[0]!, { hidden: true });
    });
    expect(await valid(hidden)).toBe(false);
    expect(await valid(hidden, false)).toBe(true);
    const invalid = [
      mutate((value) => {
        const block = value.blocks[0]!;
        if (block.kind === "content")
          Object.assign(block.scene!.nodes[0]!, { frame: { x: 90, y: 5, width: 20, height: 10 } });
      }),
      mutate((value) => {
        const block = value.blocks[0]!;
        if (block.kind === "content") block.scene!.readingOrder.pop();
      }),
      mutate((value) => {
        const block = value.blocks[0]!;
        if (block.kind === "content")
          Object.assign(block.scene!.nodes.at(-1)!, { decorative: false });
      }),
      mutate((value) => {
        const block = value.blocks[0]!;
        if (block.kind === "content") Object.assign(block.scene!, { speakerNotes: "PRIVATE" });
      }),
      mutate((value) => {
        const block = value.blocks[0]!;
        if (block.kind === "content") {
          const title = block.scene!.nodes[0]!;
          Object.assign(title, { text: "" });
          block.scene!.nodes = [title, block.scene!.nodes.at(-1)!];
          block.scene!.readingOrder = block.scene!.nodes.map((node) => node.id);
        }
      }),
      mutate((value) => {
        const block = value.blocks[0]!;
        if (block.kind === "content") {
          for (let index = 0; index < 33; index++) {
            const id = `body-${index}`;
            block.scene!.nodes.push({
              id,
              type: "text",
              role: "body",
              text: "x".repeat(4_000),
              frame: { x: 5, y: 5, width: 50, height: 50 },
            });
            block.scene!.readingOrder.push(id);
          }
        }
      }),
      mutate((value) => {
        Object.assign(value, { description: "x".repeat(3_145_729) });
      }),
    ];
    for (const value of invalid) expect(await valid(value)).toBe(false);
    const badProvenance = mutate((value) => {
      const block = value.blocks[0]!;
      if (block.kind === "content")
        Object.assign(block.textAssistance!, { targetLanguage: "invalid" });
    });
    expect(
      (
        await administrator.pool.query(
          "SELECT openround_presentation_text_assistance_valid($1::jsonb,18) valid",
          [JSON.stringify(badProvenance)],
        )
      ).rows[0]!.valid,
    ).toBe(false);
    const badSpatial = mutate((value) => {
      value.spatial!.frames[0]!.blockId = randomUUID();
    });
    expect(
      (
        await administrator.pool.query(
          "SELECT openround_presentation_spatial_valid($1::jsonb,18,true) valid",
          [JSON.stringify(badSpatial)],
        )
      ).rows[0]!.valid,
    ).toBe(false);
  });
});
