import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CanvasBoardMutationV4Schema,
  CanvasObjectCreateSchema,
  IdeaBoardCanvasSchema,
  IdeaBoardRichContentSchema,
  IdeaBoardSubmitSchema,
  ideaBoardRichContent,
} from "../src/index.js";

const box = () => ({ id: randomUUID(), x: 20, y: 20, width: 100, height: 80 });
const scene = (
  objects: unknown[] = [{ ...box(), type: "sticky", text: "A spatial proposal" }],
) => ({
  schemaVersion: 1,
  x: -500,
  y: 250,
  width: 600,
  height: 400,
  objects,
});

describe("private workshop canvas content", () => {
  it("supports native V4 content types and styles without shared-scene authority", () => {
    const frameId = randomUUID(),
      nodeId = randomUUID(),
      mediaId = randomUUID();
    const objects = [
      { ...box(), id: frameId, type: "frame", width: 500, height: 300 },
      { ...box(), id: nodeId, type: "sticky", parentId: frameId, text: "On-canvas text" },
      {
        ...box(),
        type: "text",
        fontFamily: "serif",
        fontWeight: "bold",
        fontStyle: "italic",
        textDecoration: "underline",
        textAlign: "center",
      },
      { ...box(), type: "rect", shapeVariant: "star", color: "mint", opacity: 0.5 },
      ...["ellipse", "diamond", "parallelogram"].map((type) => ({ ...box(), type })),
      {
        ...box(),
        type: "pen",
        points: [
          [20, 20],
          [100, 80],
        ],
      },
      {
        ...box(),
        type: "connector",
        from: { objectId: nodeId, x: 60, y: 60 },
        to: { objectId: null, x: 200, y: 160 },
        routing: "elbow",
        lineStyle: "dashed",
        startMarker: "arrow",
        lineColor: "blue",
      },
      { ...box(), type: "link", url: "https://example.test/proposal" },
      { ...box(), type: "image", mediaId, altText: "Proposed layout" },
    ];
    const canvas = IdeaBoardCanvasSchema.parse(scene(objects));
    expect(canvas.objects).toHaveLength(11);
    for (const object of canvas.objects) {
      expect(object).not.toHaveProperty("visibility");
      expect(object).not.toHaveProperty("version");
      expect(object).not.toHaveProperty("idea");
      expect(CanvasObjectCreateSchema.parse({ ...object, visibility: "published" })).toMatchObject(
        object,
      );
    }
    expect(
      IdeaBoardRichContentSchema.parse({ canvas, attachments: [{ mediaId, alt: "Layout" }] })
        .canvas,
    ).toEqual(canvas);
  });

  it("keeps V4 normalization order and defaults and legacy idea envelopes unchanged", () => {
    const input = {
      id: randomUUID(),
      type: "rect",
      x: 10,
      y: 20,
      width: 220,
      height: 140,
      text: "Cafe\u0301",
    };
    const operationId = randomUUID();
    expect(
      JSON.stringify(
        CanvasBoardMutationV4Schema.parse({
          schemaVersion: 4,
          operationId,
          command: { type: "batch", operations: [{ type: "create", object: input }] },
        }),
      ),
    ).toBe(
      JSON.stringify({
        schemaVersion: 4,
        operationId,
        command: {
          type: "batch",
          operations: [
            {
              type: "create",
              object: {
                id: input.id,
                x: 10,
                y: 20,
                width: 220,
                height: 140,
                rotation: 0,
                zIndex: 0,
                color: "yellow",
                text: "Café",
                fontSize: 16,
                fontFamily: "sans",
                fontWeight: "normal",
                fontStyle: "normal",
                textDecoration: "none",
                textAlign: "left",
                strokeWidth: 2,
                opacity: 1,
                parentId: null,
                geometricGroupId: null,
                locked: false,
                visibility: "team",
                type: "rect",
                shapeVariant: "rectangle",
              },
            },
          ],
        },
      }),
    );
    const idempotencyKey = randomUUID();
    expect(IdeaBoardSubmitSchema.parse({ body: "Legacy proposal", idempotencyKey })).toEqual({
      schemaVersion: 1,
      body: "Legacy proposal",
      idempotencyKey,
    });
    expect(
      ideaBoardRichContent(
        IdeaBoardRichContentSchema.parse({ attachments: [], links: [], sketch: null }),
      ),
    ).toEqual({});
    expect(IdeaBoardSubmitSchema.safeParse({ idempotencyKey, canvas: scene() }).success).toBe(
      false,
    );
  });

  it("rejects publication, embedded projections, invalid geometry and unsupported content", () => {
    const object = { ...box(), type: "sticky" };
    for (const extra of [
      { visibility: "published" },
      { version: 1 },
      { idea: {} },
      { type: "idea_ref", ideaId: randomUUID() },
      { x: -1 },
      { x: Infinity },
      { x: 590 },
      { rotation: 45, x: 0, y: 0 },
      { width: 0 },
      { type: "link", url: "javascript:alert(1)" },
      {
        type: "pen",
        points: [
          [10, 10],
          [601, 20],
        ],
      },
      {
        type: "connector",
        from: { objectId: null, x: 0, y: 0 },
        to: { objectId: null, x: 601, y: 0 },
      },
    ])
      expect(IdeaBoardCanvasSchema.safeParse(scene([{ ...object, ...extra }])).success).toBe(false);
    for (const extra of [
      { schemaVersion: 2 },
      { x: -100_001 },
      { y: NaN },
      { width: 10_001 },
      { objects: [] },
      { objects: Array.from({ length: 33 }, () => ({ ...box(), type: "text" })) },
    ])
      expect(IdeaBoardCanvasSchema.safeParse({ ...scene(), ...extra }).success).toBe(false);
    expect(IdeaBoardCanvasSchema.safeParse(scene([object, object])).success).toBe(false);
    expect(
      IdeaBoardCanvasSchema.safeParse(
        scene(
          Array.from({ length: 9 }, () => ({
            ...box(),
            type: "pen",
            points: Array.from({ length: 128 }, () => [20, 20]),
          })),
        ),
      ).success,
    ).toBe(false);
    expect(
      IdeaBoardCanvasSchema.safeParse(
        scene(
          Array.from({ length: 9 }, () => ({ ...box(), type: "text", text: "😀".repeat(1_000) })),
        ),
      ).success,
    ).toBe(false);
  });

  it("rejects external references, frame cycles, mismatched groups and undeclared images", () => {
    const a = { ...box(), type: "frame" },
      b = { ...box(), type: "frame" };
    const groupId = randomUUID();
    const connector = {
      ...box(),
      type: "connector",
      from: { objectId: randomUUID(), x: 20, y: 20 },
      to: { objectId: null, x: 100, y: 100 },
    };
    for (const objects of [
      [{ ...a, parentId: randomUUID() }],
      [{ ...a, parentId: a.id }],
      [
        { ...a, parentId: b.id },
        { ...b, parentId: a.id },
      ],
      [
        { ...a, type: "text" },
        { ...b, parentId: a.id },
      ],
      [connector],
      [{ ...connector, from: { ...connector.from, objectId: connector.id } }],
      [
        a,
        { ...box(), type: "text", geometricGroupId: groupId, parentId: a.id },
        { ...box(), type: "text", geometricGroupId: groupId },
      ],
    ])
      expect(IdeaBoardCanvasSchema.safeParse(scene(objects)).success).toBe(false);
    const canvas = scene([
      { ...box(), type: "image", mediaId: randomUUID(), altText: "Private image" },
    ]);
    expect(IdeaBoardRichContentSchema.safeParse({ canvas }).success).toBe(false);
    const sketch = {
      schemaVersion: 1,
      width: 1000,
      height: 600,
      elements: [
        {
          id: randomUUID(),
          type: "text",
          x: 10,
          y: 20,
          text: "Legacy",
          color: "ink",
          strokeWidth: 2,
          fontSize: 16,
        },
      ],
    };
    expect(IdeaBoardRichContentSchema.safeParse({ canvas: scene(), sketch }).success).toBe(false);
    expect(
      IdeaBoardRichContentSchema.safeParse({ canvas: scene(), sketch: { ...sketch, elements: [] } })
        .success,
    ).toBe(true);
    expect(ideaBoardRichContent(IdeaBoardRichContentSchema.parse({ sketch }))).toHaveProperty(
      "sketch",
    );
  });
});
