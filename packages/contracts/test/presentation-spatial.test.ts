import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PresentationDraftSchema,
  PresentationContentSchema,
  PresentationSpatialFrameSchema,
  PresentationSpatialLayoutSchema,
  PresentationSpatialSnapshotSchema,
  preparePresentationPublication,
  resolvePresentationSpatialFrames,
  presentationSpatialBounds,
  migratePresentationV1,
} from "../src/index.js";
const slide = (hidden = false) => ({
  id: randomUUID(),
  kind: "content",
  layout: "title_body",
  textElements: [
    { id: "title", role: "title", text: "Authored title", region: "top_center", order: 0 },
  ],
  mediaId: null,
  mediaAlt: null,
  speakerNotes: "PRIVATE notes",
  ...(hidden ? { hidden: true } : {}),
});
const frame = (blockId: string = randomUUID()) => ({
  blockId,
  x: 0,
  y: 0,
  width: 1280,
  height: 720,
});
const deck = () => ({ schemaVersion: 14, title: "Spatial story", blocks: [slide(), slide()] });
describe("bounded Presentation spatial metadata", () => {
  it("opts into document14 without changing historical wire/defaults or scene6", () => {
    const source = deck();
    for (const schema of [PresentationDraftSchema, PresentationContentSchema]) {
      const parsed = schema.parse(source);
      expect(parsed.schemaVersion).toBe(14);
      expect(parsed).not.toHaveProperty("spatial");
      expect(schema.safeParse({ ...source, schemaVersion: 17 }).success).toBe(false);
      expect(
        schema.safeParse(migratePresentationV1({ ...source, schemaVersion: 17 })).success,
      ).toBe(false);
      const enabled = {
        ...source,
        spatial: { schemaVersion: 1, frames: [frame(source.blocks[0]!.id)] },
      };
      expect(schema.parse(enabled).spatial).toEqual(enabled.spatial);
      expect(schema.safeParse({ ...enabled, schemaVersion: 13 }).success).toBe(false);
    }
    const legacy = PresentationDraftSchema.parse({ title: "Legacy", blocks: source.blocks });
    expect(legacy.schemaVersion).toBe(2);
    const bytes = JSON.stringify(legacy),
      hash = createHash("sha256").update(bytes).digest("hex");
    resolvePresentationSpatialFrames(legacy);
    expect(JSON.stringify(legacy)).toBe(bytes);
    expect(
      createHash("sha256")
        .update(JSON.stringify(PresentationDraftSchema.parse(legacy)))
        .digest("hex"),
    ).toBe(hash);
    const native = {
      ...source.blocks[0]!,
      textElements: [],
      scene: {
        schemaVersion: 6,
        aspectRatio: "16:9",
        nodes: [
          {
            id: "title",
            type: "text",
            role: "title",
            text: "Spatial scene",
            frame: { x: 0, y: 0, width: 100, height: 20 },
          },
          {
            id: "reveal",
            type: "reveal",
            scope: "broadcast",
            label: "Show",
            body: "Private until broadcast",
            frame: { x: 0, y: 0, width: 50, height: 20 },
          },
        ],
        readingOrder: ["title", "reveal"],
      },
    };
    expect(
      PresentationContentSchema.parse({ ...source, blocks: [native] }).blocks[0],
    ).toMatchObject({ scene: { schemaVersion: 6 } });
  });
  it("bounds integer16:9 frames and rejects private or unsupported geometry fields", () => {
    expect(
      PresentationSpatialFrameSchema.parse({
        ...frame(),
        x: 16800,
        y: 18200,
        width: 3200,
        height: 1800,
      }),
    ).toMatchObject({ x: 16800, height: 1800 });
    for (const change of [
      { x: -1 },
      { y: 20000 },
      { width: 319 },
      { height: 179 },
      { width: 3201 },
      { height: 1801 },
      { x: 0.5 },
      { width: 1281 },
      { x: Infinity },
      { y: NaN },
      { title: "Private future title" },
      { rotation: 5 },
      { body: "Private" },
    ])
      expect(PresentationSpatialFrameSchema.safeParse({ ...frame(), ...change }).success).toBe(
        false,
      );
    expect(
      PresentationSpatialLayoutSchema.safeParse({ schemaVersion: 2, frames: [] }).success,
    ).toBe(false);
  });
  it("requires unique existing UUID references while allowing sparse layouts and draft hidden frames", () => {
    const source = deck(),
      known = source.blocks[0]!.id;
    const value = {
      ...source,
      spatial: { schemaVersion: 1, frames: [frame(known.toUpperCase())] },
    };
    expect(PresentationDraftSchema.safeParse(value).success).toBe(true);
    expect(
      PresentationDraftSchema.safeParse({
        ...value,
        spatial: { schemaVersion: 1, frames: [frame(known), frame(known.toUpperCase())] },
      }).success,
    ).toBe(false);
    expect(
      PresentationDraftSchema.safeParse({
        ...value,
        spatial: { schemaVersion: 1, frames: [frame()] },
      }).success,
    ).toBe(false);
    expect(
      PresentationSpatialLayoutSchema.safeParse({
        schemaVersion: 1,
        frames: Array.from({ length: 201 }, () => frame()),
      }).success,
    ).toBe(false);
    const hidden = slide(true);
    const draft = PresentationDraftSchema.parse({
      ...value,
      blocks: [...source.blocks, hidden],
      spatial: {
        schemaVersion: 1,
        frames: [frame(known), { ...frame(hidden.id), x: 18000, y: 18000 }],
      },
    });
    const published = PresentationContentSchema.parse(preparePresentationPublication(draft));
    expect(published.spatial?.frames).toEqual([frame(known)]);
    expect(resolvePresentationSpatialFrames(published)).toHaveLength(2);
    expect(presentationSpatialBounds(resolvePresentationSpatialFrames(published))).toEqual({
      x: 0,
      y: 0,
      width: 2880,
      height: 720,
    });
  });
  it("resolves all200 canonical frames with deterministic fallback and authored UUID spelling without writes", () => {
    const source = {
      blocks: Array.from({ length: 200 }, () => ({ id: randomUUID().toUpperCase() })),
      spatial: { schemaVersion: 1 as const, frames: [] as ReturnType<typeof frame>[] },
    };
    source.spatial.frames.push({ ...frame(source.blocks[1]!.id.toLowerCase()), x: 2500, y: 1000 });
    const before = JSON.stringify(source),
      result = resolvePresentationSpatialFrames(source);
    expect(result).toHaveLength(200);
    expect(result[1]).toEqual({ ...source.spatial.frames[0], blockId: source.blocks[1]!.id });
    expect(result[12]).toEqual({
      blockId: source.blocks[12]!.id,
      x: 0,
      y: 960,
      width: 1280,
      height: 720,
    });
    expect(result[199]).toEqual({
      blockId: source.blocks[199]!.id,
      x: 11200,
      y: 15360,
      width: 1280,
      height: 720,
    });
    expect(result.every((value) => PresentationSpatialFrameSchema.safeParse(value).success)).toBe(
      true,
    );
    expect(JSON.stringify(source)).toBe(before);
    expect(presentationSpatialBounds([])).toBeNull();
    result[1]!.x = 0;
    expect(source.spatial.frames[0]!.x).toBe(2500);
  });
  it("admits only ordered geometry and ordinals into the audience snapshot", () => {
    const source = deck();
    const frames = resolvePresentationSpatialFrames(source).map(
      ({ x, y, width, height }, blockIndex) => ({ blockIndex, x, y, width, height }),
    );
    const value = { schemaVersion: 1, frames };
    expect(PresentationSpatialSnapshotSchema.parse(value)).toEqual(value);
    for (const change of [
      { blockId: randomUUID() },
      { title: "Future title" },
      { kind: "question" },
      { sectionId: randomUUID() },
      { scene: {} },
      { speakerNotes: "PRIVATE" },
      { nodeId: "planning" },
    ])
      expect(
        PresentationSpatialSnapshotSchema.safeParse({
          ...value,
          frames: [{ ...frames[0], ...change }],
        }).success,
      ).toBe(false);
    expect(
      PresentationSpatialSnapshotSchema.safeParse({ ...value, frames: [...frames].reverse() })
        .success,
    ).toBe(false);
    expect(
      PresentationSpatialSnapshotSchema.safeParse({ ...value, frames: [frames[0], frames[0]] })
        .success,
    ).toBe(false);
    expect(JSON.stringify(PresentationSpatialSnapshotSchema.parse(value))).not.toMatch(
      /PRIVATE|Authored|blockId|scene|question|notes/i,
    );
  });
});
