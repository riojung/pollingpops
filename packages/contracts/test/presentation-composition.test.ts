import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PRESENTATION_COMPOSITION_SCENE_SCHEMA_VERSION,
  PresentationContentSchema,
  PresentationDraftMutationSchema,
  PresentationDraftSchema,
  PresentationLiveContentBlockSchema,
  PresentationSceneChartNodeSchema,
  PresentationSceneDraftSchema,
  PresentationSceneSchema,
  PresentationSceneTableNodeSchema,
  migratePresentationV1,
  presentationScenePaintedBounds,
  preparePresentationPublication,
  type PresentationScene,
  type PresentationSceneChartNode,
  type PresentationSceneTableNode,
} from "../src/index";

const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const frame = { x: 30, y: 30, width: 30, height: 30 };

function table(): PresentationSceneTableNode {
  return {
    id: "table",
    type: "table",
    frame: { ...frame },
    caption: "Quarterly results",
    headers: ["Quarter", "Result"],
    rows: [
      ["Q1", "12"],
      ["Q2", "18"],
    ],
  };
}

function chart(
  chartType: PresentationSceneChartNode["chartType"] = "bar",
): PresentationSceneChartNode {
  return {
    id: "chart",
    type: "chart",
    frame: { ...frame },
    chartType,
    title: "Quarterly results",
    summary: "Results increased from 12 to 18.",
    categories: ["Q1", "Q2"],
    series: [{ name: "Results", values: [12, 18] }],
  };
}

function scene(): PresentationScene {
  return {
    schemaVersion: PRESENTATION_COMPOSITION_SCENE_SCHEMA_VERSION,
    aspectRatio: "16:9",
    design: { theme: "midnight", font: "serif", spacing: "compact" },
    groups: [{ id: "information", nodeIds: ["table", "chart"] }],
    nodes: [
      {
        id: "title",
        type: "text",
        role: "title",
        text: "Evidence",
        frame: { x: 8, y: 8, width: 84, height: 20 },
        richText: { paragraphs: [{ kind: "paragraph", runs: [{ text: "Evidence", bold: true }] }] },
      },
      { ...table(), rotation: 15 },
      chart(),
      {
        id: "image",
        type: "image",
        frame: { ...frame },
        mediaId: uuid(2),
        altText: "Evidence",
        fit: "cover",
        focalPoint: { x: 25, y: 75 },
        rotation: -15,
      },
      {
        id: "connector",
        type: "connector",
        from: { nodeId: "table", anchor: "right" },
        to: { nodeId: "chart", anchor: "left" },
        label: "summarizes",
        color: "blue",
      },
    ],
    readingOrder: ["title", "table", "chart", "image", "connector"],
  };
}

function deck() {
  return {
    title: "Evidence",
    schemaVersion: 8,
    blocks: [
      {
        id: uuid(1),
        kind: "content",
        layout: "title_body",
        textElements: [],
        mediaId: null,
        mediaAlt: null,
        speakerNotes: "PRIVATE cue",
        citations: [{ locator: "PRIVATE source", excerpt: "PRIVATE excerpt" }],
        scene: scene(),
      },
    ],
  };
}

describe("bounded native information nodes", () => {
  it("round-trips tables and each deterministic chart kind without defaults", () => {
    expect(PresentationSceneTableNodeSchema.parse(table())).toStrictEqual(table());
    for (const type of ["bar", "line", "pie"] as const)
      expect(PresentationSceneChartNodeSchema.parse(chart(type))).toStrictEqual(chart(type));
    expect(PresentationSceneSchema.parse(scene())).toStrictEqual(scene());
    expect(PresentationSceneTableNodeSchema.parse(table())).not.toHaveProperty("rotation");
  });

  it("allows incomplete draft labels while publication requires all accessible information", () => {
    const input = scene();
    input.nodes = [
      input.nodes[0]!,
      { ...table(), caption: "", headers: ["", ""], rows: [["", ""]] },
      {
        ...chart(),
        title: "",
        summary: "",
        categories: ["", ""],
        series: [{ name: "", values: [0, 0] }],
      },
    ];
    delete input.groups;
    input.readingOrder = input.nodes.map(({ id }) => id);
    expect(PresentationSceneDraftSchema.parse(input)).toStrictEqual(input);
    const result = PresentationSceneSchema.safeParse(input);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map(({ path }) => path.join("."))).toEqual(
      expect.arrayContaining([
        "nodes.1.caption",
        "nodes.1.headers.0",
        "nodes.2.title",
        "nodes.2.summary",
        "nodes.2.categories.0",
        "nodes.2.series.0.name",
      ]),
    );
  });

  it("bounds rectangular plain-text tables and rejects executable or unknown fields", () => {
    const maximum = {
      ...table(),
      caption: "c".repeat(160),
      headers: Array.from({ length: 6 }, () => "h".repeat(120)),
      rows: Array.from({ length: 20 }, () => Array.from({ length: 6 }, () => "v".repeat(300))),
    };
    expect(PresentationSceneTableNodeSchema.safeParse(maximum).success).toBe(true);
    for (const patch of [
      { caption: "c".repeat(161) },
      { headers: [] },
      { headers: ["h".repeat(121)] },
      { headers: Array(7).fill("H") },
      { rows: [] },
      { rows: Array.from({ length: 21 }, () => ["Q", "1"]) },
      { rows: [["mismatched"]] },
      { rows: [["v".repeat(301), "1"]] },
      { rows: [["bad\u0000control", "1"]] },
      { html: "<script>alert(1)</script>" },
      { sourceUrl: "https://example.com/data" },
      { formulas: ["=IMPORTXML()"] },
    ])
      expect(PresentationSceneTableNodeSchema.safeParse({ ...table(), ...patch }).success).toBe(
        false,
      );
    // Formula-looking strings and markup remain literal text, never executable data.
    expect(
      PresentationSceneTableNodeSchema.parse({
        ...table(),
        rows: [["=SUM(A1)", "<script>literal</script>"]],
      }).rows[0],
    ).toEqual(["=SUM(A1)", "<script>literal</script>"]);
  });

  it("bounds inline chart data, requires matching lengths and closes configuration", () => {
    const maximum = {
      ...chart(),
      title: "t".repeat(160),
      summary: "s".repeat(800),
      categories: Array.from({ length: 20 }, () => "c".repeat(80)),
      series: Array.from({ length: 4 }, () => ({
        name: "n".repeat(80),
        values: Array(20).fill(1e12),
      })),
    };
    expect(PresentationSceneChartNodeSchema.safeParse(maximum).success).toBe(true);
    for (const patch of [
      { title: "t".repeat(161) },
      { summary: "s".repeat(801) },
      { chartType: "scatter" },
      { categories: [] },
      { categories: Array(21).fill("C") },
      { categories: ["c".repeat(81)] },
      { categories: ["C\u0000"] },
      { series: [] },
      { series: Array.from({ length: 5 }, () => ({ name: "N", values: [1, 2] })) },
      { series: [{ name: "n".repeat(81), values: [1, 2] }] },
      { series: [{ name: "N", values: [1] }] },
      { series: [{ name: "N", values: [1, 2], color: "red" }] },
      { script: "alert(1)" },
      { dataUrl: "https://example.com/data" },
    ])
      expect(PresentationSceneChartNodeSchema.safeParse({ ...chart(), ...patch }).success).toBe(
        false,
      );
    for (const value of [NaN, Infinity, -Infinity, 1e12 + 1, -1e12 - 1, "1", null])
      expect(
        PresentationSceneChartNodeSchema.safeParse({
          ...chart(),
          series: [{ name: "N", values: [value, 1] }],
        }).success,
      ).toBe(false);
    expect(
      PresentationSceneChartNodeSchema.safeParse({
        ...chart(),
        series: [{ name: "N", values: [-1e12, 1e12] }],
      }).success,
    ).toBe(true);
  });

  it("requires exactly one nonnegative pie series with a positive total", () => {
    for (const series of [
      [{ name: "N", values: [0, 0] }],
      [{ name: "N", values: [-1, 2] }],
      [
        { name: "N", values: [1, 2] },
        { name: "M", values: [3, 4] },
      ],
    ])
      expect(PresentationSceneChartNodeSchema.safeParse({ ...chart("pie"), series }).success).toBe(
        false,
      );
    expect(
      PresentationSceneChartNodeSchema.safeParse({
        ...chart("pie"),
        series: [{ name: "N", values: [0, 1e12] }],
      }).success,
    ).toBe(true);
  });

  it("includes all inline cells in the unchanged scene byte budget", () => {
    const input = scene();
    const large = {
      ...table(),
      headers: Array(6).fill("Header"),
      rows: Array.from({ length: 20 }, () => Array(6).fill("界".repeat(300))),
    };
    input.nodes = [input.nodes[0]!, large, { ...large, id: "second-table" }];
    delete input.groups;
    input.readingOrder = input.nodes.map(({ id }) => id);
    expect(() => PresentationSceneDraftSchema.parse(input)).toThrow("128 KiB");
  });
});

describe("flat group and painted rotation contracts", () => {
  it("admits only disjoint existing framed members and independent group IDs", () => {
    for (const groups of [
      [{ id: "g", nodeIds: ["table"] }],
      [{ id: "g", nodeIds: ["table", "table"] }],
      [{ id: "g", nodeIds: ["table", "missing"] }],
      [{ id: "g", nodeIds: ["table", "connector"] }],
      [{ id: "table", nodeIds: ["table", "chart"] }],
      [{ id: "g", nodeIds: ["table", "chart"], nodes: [] }],
      [
        { id: "g", nodeIds: ["table", "chart"] },
        { id: "g", nodeIds: ["title", "image"] },
      ],
      [
        { id: "g", nodeIds: ["table", "chart"] },
        { id: "h", nodeIds: ["chart", "image"] },
      ],
      [
        { id: "g", nodeIds: ["table", "h"] },
        { id: "h", nodeIds: ["title", "image"] },
      ],
      Array.from({ length: 26 }, (_, index) => ({ id: `g${index}`, nodeIds: ["table", "chart"] })),
    ])
      expect(PresentationSceneDraftSchema.safeParse({ ...scene(), groups }).success).toBe(false);
    const input = scene();
    input.groups = [
      { id: "g", nodeIds: ["title", "image"] },
      { id: "h", nodeIds: ["table", "chart"] },
    ];
    expect(PresentationSceneDraftSchema.parse(input)).toStrictEqual(input);
    expect(PresentationSceneDraftSchema.parse({ ...input, groups: [] }).groups).toEqual([]);
  });

  it("rotates in the physical 16:9 plane and rejects painted overflow", () => {
    const bounds = presentationScenePaintedBounds({ x: 40, y: 40, width: 20, height: 20 }, 90);
    expect(bounds.width).toBeCloseTo(11.25);
    expect(bounds.height).toBeCloseTo(320 / 9);
    for (const rotation of [-180, -90, -15, 0, 15, 90, 180])
      expect(PresentationSceneTableNodeSchema.safeParse({ ...table(), rotation }).success).toBe(
        true,
      );
    for (const rotation of [NaN, Infinity, -Infinity, -180.001, 180.001, "90", null])
      expect(PresentationSceneTableNodeSchema.safeParse({ ...table(), rotation }).success).toBe(
        false,
      );
    expect(
      PresentationSceneTableNodeSchema.safeParse({
        ...table(),
        frame: { x: 0, y: 0, width: 40, height: 10 },
        rotation: 45,
      }).success,
    ).toBe(false);
    expect(
      PresentationSceneTableNodeSchema.safeParse({
        ...table(),
        frame: { x: 0, y: 0, width: 100, height: 100 },
        rotation: 180,
      }).success,
    ).toBe(true);
    expect(presentationScenePaintedBounds(frame)).toStrictEqual(frame);
  });

  it.each([1, 2, 3] as const)(
    "requires scene4 for every newly persisted field under old scene%s",
    (schemaVersion) => {
      const plain = scene();
      plain.schemaVersion = schemaVersion;
      plain.nodes = [plain.nodes[0]!];
      if (schemaVersion === 1 && plain.nodes[0]!.type === "text") delete plain.nodes[0]!.richText;
      if (schemaVersion < 3) delete plain.design;
      delete plain.groups;
      plain.readingOrder = ["title"];
      expect(PresentationSceneDraftSchema.safeParse(plain).success).toBe(true);
      for (const groups of [[], undefined])
        expect(PresentationSceneDraftSchema.safeParse({ ...plain, groups }).success).toBe(false);
      for (const rotation of [0, undefined])
        expect(
          PresentationSceneDraftSchema.safeParse({
            ...plain,
            nodes: [{ ...plain.nodes[0]!, rotation }],
          }).success,
        ).toBe(false);
      for (const node of [table(), chart()])
        expect(
          PresentationSceneDraftSchema.safeParse({
            ...plain,
            nodes: [...plain.nodes, node],
            readingOrder: ["title", node.id],
          }).success,
        ).toBe(false);
    },
  );
});

describe("composed Presentation document8", () => {
  it.each([1, 2, 3] as const)(
    "retains valid older scene%s under document8 without adding composition defaults",
    (schemaVersion) => {
      const older = scene();
      older.schemaVersion = schemaVersion;
      delete older.groups;
      older.nodes = older.nodes
        .filter((node) => node.type === "text" || node.type === "image")
        .map((node) => {
          const { rotation: _rotation, ...retained } = node;
          void _rotation;
          if (retained.type === "text" && schemaVersion === 1) delete retained.richText;
          if (retained.type === "image" && schemaVersion < 3) {
            delete retained.fit;
            delete retained.focalPoint;
          }
          return retained;
        });
      if (schemaVersion < 3) delete older.design;
      older.readingOrder = older.nodes.map(({ id }) => id);
      const input = deck();
      input.blocks[0]!.scene = older;
      const content = PresentationContentSchema.parse(input);
      expect(content.schemaVersion).toBe(8);
      const block = content.blocks[0]!;
      if (block.kind !== "content") throw new Error("Expected content");
      expect(block.scene).toStrictEqual(older);
    },
  );

  it("round-trips document8 with envelope2 and omits private block metadata from audience content", () => {
    const input = PresentationDraftSchema.parse(deck());
    expect(migratePresentationV1(input)).toBe(input);
    const content = PresentationContentSchema.parse(input);
    expect(
      PresentationDraftMutationSchema.parse({
        draft: input,
        expectedRevision: 0,
        mutationId: uuid(3),
        schemaVersion: 2,
      }).draft,
    ).toEqual(input);
    const first = content.blocks[0]!;
    if (first.kind !== "content") throw new Error("Expected content slide");
    const { speakerNotes: _notes, citations: _citations, ...block } = first;
    void [_notes, _citations];
    expect(PresentationLiveContentBlockSchema.parse(block).scene).toEqual(scene());
    expect(JSON.stringify(PresentationLiveContentBlockSchema.parse(block))).not.toContain(
      "PRIVATE",
    );
    expect(createHash("sha256").update(JSON.stringify(content)).digest("hex")).toBe(
      createHash("sha256")
        .update(JSON.stringify(PresentationContentSchema.parse(content)))
        .digest("hex"),
    );
  });

  it.each([2, 3, 4, 5, 6, 7])(
    "rejects scene4 under older document%s even with new fields omitted",
    (schemaVersion) => {
      const input = deck();
      input.schemaVersion = schemaVersion;
      const plain = input.blocks[0]!.scene;
      delete plain.groups;
      plain.nodes = [plain.nodes[0]!];
      plain.readingOrder = ["title"];
      expect(PresentationDraftSchema.safeParse(input).success).toBe(false);
      expect(PresentationContentSchema.safeParse(input).success).toBe(false);
    },
  );

  it("retains document8 with old scenes and hidden information only in the complete draft", () => {
    const input = deck();
    const hidden = { ...input.blocks[0]!, id: uuid(4), hidden: true as const };
    const invalidTable = hidden.scene.nodes.find((node) => node.type === "table")!;
    if (invalidTable.type === "table") invalidTable.caption = "";
    const draft = PresentationDraftSchema.parse({ ...deck(), blocks: [...deck().blocks, hidden] });
    const visible = preparePresentationPublication(draft);
    expect(visible.schemaVersion).toBe(8);
    expect(PresentationContentSchema.parse(visible).blocks).toHaveLength(1);
    expect(PresentationContentSchema.safeParse(draft).success).toBe(false);
    expect(PresentationDraftSchema.parse({ ...deck(), schemaVersion: 8 }).schemaVersion).toBe(8);
    for (const schema of [PresentationDraftSchema, PresentationContentSchema]) {
      const opinionDocumentVersion = schema.parse({ ...deck(), schemaVersion: 9 });
      expect(opinionDocumentVersion.schemaVersion).toBe(9);
      expect(opinionDocumentVersion.blocks[0]).toMatchObject({ scene: { schemaVersion: 4 } });
      expect(schema.safeParse({ ...deck(), schemaVersion: 10 }).success).toBe(false);
    }
    expect(PresentationSceneDraftSchema.safeParse({ ...scene(), schemaVersion: 5 }).success).toBe(
      false,
    );
  });
});
