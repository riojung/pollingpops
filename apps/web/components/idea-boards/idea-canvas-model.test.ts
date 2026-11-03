import { describe, expect, it } from "vitest";
import {
  CanvasObjectSchema,
  IdeaBoardCanvasSchema,
  type CanvasObject,
  type CanvasObjectCreate,
} from "@openround/contracts";
import { emptyIdeaDraft, type IdeaDraft } from "./idea-composer";
import {
  arrangeIdeaCanvas,
  deleteIdeaCanvas,
  duplicateIdeaCanvas,
  groupIdeaCanvas,
  ideaCanvasDraft,
  ideaCanvasObject,
  importIdeaCanvasDraft,
  patchIdeaCanvas,
  serializeIdeaCanvas,
  transformIdeaCanvas,
} from "./idea-canvas-model";

const id = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
function note(index: number, extra: Record<string, unknown> = {}) {
  return CanvasObjectSchema.parse({
    id: id(index),
    type: "sticky",
    x: 0,
    y: 0,
    width: 220,
    height: 160,
    text: "A meaningful participant idea",
    version: 1,
    ...extra,
  });
}
function result(value: IdeaDraft, objects: CanvasObject[]) {
  const next = ideaCanvasDraft(value, objects);
  if (next.error) throw new Error(next.error);
  return next.draft;
}

describe("private idea canvas serialization", () => {
  it("round-trips native world placement, styles, frames, pen points and closed connector references", () => {
    const frame = note(1, {
      type: "frame",
      x: -400,
      y: 200,
      width: 800,
      height: 600,
      text: "Private frame",
    });
    const shape = note(2, {
      type: "rect",
      shapeVariant: "triangle",
      parentId: frame.id,
      x: -300,
      y: 300,
      rotation: 20,
      color: "teal",
      fontSize: 32,
      fontFamily: "serif",
      fontWeight: "bold",
      fontStyle: "italic",
      textDecoration: "underline",
      textAlign: "right",
      opacity: 0.6,
    });
    const pen = note(3, {
      type: "pen",
      text: "",
      parentId: frame.id,
      x: -200,
      y: 540,
      width: 200,
      height: 20,
      strokeWidth: 12,
      opacity: 0.35,
      points: [
        [-200, 540],
        [0, 560],
      ],
    });
    const connector = note(4, {
      type: "connector",
      text: "A route",
      x: -190,
      y: 420,
      width: 300,
      height: 200,
      routing: "elbow",
      from: { objectId: shape.id, anchor: "right", x: -80, y: 380 },
      to: { objectId: null, x: 110, y: 620 },
      endMarker: "arrow",
    });
    const original = [frame, shape, pen, connector];
    const snapshot = structuredClone(original);
    const draft = result(emptyIdeaDraft(), original);
    expect(draft.body).toBe(shape.text);
    expect(draft.sketch).toBeNull();
    expect(IdeaBoardCanvasSchema.safeParse(draft.canvas).success).toBe(true);
    const restored = importIdeaCanvasDraft(draft);
    for (const object of original) {
      expect(restored.find((item) => item.id === object.id)).toMatchObject({
        ...object,
        visibility: "team",
      });
    }
    expect(
      draft.canvas!.objects.every(
        (object) => !("visibility" in object) && !("version" in object) && !("idea" in object),
      ),
    ).toBe(true);
    expect(original).toEqual(snapshot);
  });
  it("derives canonical image/link manifests while keeping an independently edited title", () => {
    const mediaId = id(20);
    const image = note(1, {
      type: "image",
      text: "",
      x: 400,
      mediaId,
      altText: "Participant diagram",
    });
    const link = note(2, {
      type: "link",
      x: 700,
      url: "https://example.com/guide",
      text: "A source",
    });
    const value = {
      ...emptyIdeaDraft(),
      body: "Independent accessible title",
      attachments: [{ mediaId, alt: "Older description" }],
      links: [
        { url: link.type === "link" ? link.url : "", label: "A source", imageMediaId: mediaId },
      ],
    };
    const draft = result(value, [note(3), image, link]);
    expect(draft.body).toBe(value.body);
    expect(draft.attachments).toEqual([{ mediaId, alt: "Participant diagram" }]);
    expect(draft.links).toEqual([
      { url: "https://example.com/guide", label: "A source", imageMediaId: mediaId },
    ]);
    expect(result(draft, [note(3)]).attachments).toEqual([]);
    expect(result(draft, [note(3)]).links).toEqual([]);
  });
  it("imports every legacy content kind without dropping body, sketch geometry, images or links", () => {
    const value: IdeaDraft = {
      body: "Original private idea",
      attachments: [{ mediaId: id(30), alt: "Legacy image" }],
      links: [{ url: "https://example.com/legacy", label: "Legacy link", imageMediaId: id(30) }],
      sketch: {
        schemaVersion: 1,
        width: 1000,
        height: 600,
        elements: [
          {
            id: id(501),
            type: "rect",
            color: "blue",
            strokeWidth: 2,
            x: 10,
            y: 10,
            width: 100,
            height: 80,
          },
          {
            id: id(502),
            type: "ellipse",
            color: "red",
            strokeWidth: 4,
            x: 140,
            y: 10,
            width: 100,
            height: 80,
          },
          {
            id: id(503),
            type: "text",
            color: "ink",
            strokeWidth: 1,
            x: 10,
            y: 120,
            fontSize: 24,
            text: "Original drawing text",
          },
          {
            id: id(504),
            type: "line",
            color: "green",
            strokeWidth: 2,
            x1: 10,
            y1: 150,
            x2: 200,
            y2: 150,
          },
          {
            id: id(505),
            type: "arrow",
            color: "purple",
            strokeWidth: 4,
            x1: 10,
            y1: 180,
            x2: 200,
            y2: 200,
          },
          {
            id: id(506),
            type: "freehand",
            color: "orange",
            strokeWidth: 8,
            points: [
              [10, 250],
              [200, 260],
            ],
          },
        ],
      },
    };
    const original = structuredClone(value);
    let nextId = 100;
    const imported = importIdeaCanvasDraft(value, () => id(nextId++));
    expect(imported).toHaveLength(9);
    expect(imported.map((object) => object.type)).toEqual([
      "sticky",
      "rect",
      "ellipse",
      "text",
      "connector",
      "connector",
      "pen",
      "image",
      "link",
    ]);
    expect(imported.find((object) => object.id === id(503))?.text).toBe("Original drawing text");
    const draft = result(value, imported);
    expect(draft.canvas!.objects).toHaveLength(9);
    expect(draft.body).toBe(value.body);
    expect(draft.attachments).toEqual(value.attachments);
    expect(draft.links).toEqual(value.links);
    expect(value).toEqual(original);
  });
  it("never invents a title for an empty or shapes-only idea", () => {
    expect(importIdeaCanvasDraft(emptyIdeaDraft())).toEqual([]);
    const shape = note(1, { type: "rect", text: "", shapeVariant: "star" });
    expect(result(emptyIdeaDraft(), [shape]).body).toBe("");
    expect(
      importIdeaCanvasDraft({ ...emptyIdeaDraft(), body: "Kept independent title", canvas: null }),
    ).toEqual([]);
  });
  it("retains and reopens an oversized legacy import while reducing it to a valid native scene", () => {
    const value: IdeaDraft = {
      ...emptyIdeaDraft(),
      body: "Legacy title",
      attachments: Array.from({ length: 3 }, (_, index) => ({
        mediaId: id(300 + index),
        alt: `Image ${index}`,
      })),
      links: Array.from({ length: 3 }, (_, index) => ({ url: `https://example.com/${index}` })),
      sketch: {
        schemaVersion: 1,
        width: 1000,
        height: 600,
        elements: Array.from({ length: 32 }, (_, index) => ({
          id: id(500 + index),
          type: "rect" as const,
          color: "ink" as const,
          strokeWidth: 2 as const,
          x: index * 20,
          y: 20,
          width: 10,
          height: 10,
        })),
      },
    };
    let nextId = 100;
    const imported = importIdeaCanvasDraft(value, () => id(nextId++));
    expect(imported).toHaveLength(39);
    const edited = patchIdeaCanvas(imported, [imported[1]!.id], {
      text: "Kept while still over quota",
    })!;
    const retained = ideaCanvasDraft(value, edited, 39);
    expect(retained.error).toBe("limit");
    expect(retained.draft?.canvasDraft).toHaveLength(39);
    const reopened = importIdeaCanvasDraft(retained.draft!);
    expect(reopened[1]!.text).toBe("Kept while still over quota");
    const less = deleteIdeaCanvas(reopened, [reopened[2]!.id])!;
    const intermediate = ideaCanvasDraft(retained.draft!, less, 39);
    expect(intermediate.error).toBe("limit");
    expect(importIdeaCanvasDraft(intermediate.draft!)).toHaveLength(38);
    const reduced = deleteIdeaCanvas(
      less,
      less.slice(2, 8).map((object) => object.id),
    )!;
    const normalized = ideaCanvasDraft(intermediate.draft!, reduced, 39);
    expect(normalized.error).toBeNull();
    expect(normalized.draft?.canvas?.objects).toHaveLength(32);
    expect(normalized.draft).not.toHaveProperty("canvasDraft");
    expect(normalized.draft?.attachments).toEqual(value.attachments);
    expect(normalized.draft?.links).toEqual(value.links);
    const malformed = ideaCanvasDraft(
      retained.draft!,
      [{ ...edited[0]!, x: Number.NaN }, ...edited.slice(1)],
      39,
    );
    expect(malformed.draft).toBeNull();
  });
  it("rejects protected context, external references and invalid geometry before publishing parent state", () => {
    const value = emptyIdeaDraft();
    const protectedIdea = note(1, { type: "idea_ref", ideaId: id(30), text: "" });
    expect(() => ideaCanvasObject({ ...protectedIdea } as CanvasObjectCreate)).toThrow();
    expect(ideaCanvasDraft(value, [protectedIdea]).error).toBe("invalid");
    expect(ideaCanvasDraft(value, [note(2, { parentId: id(99) })]).error).toBe("invalid");
    const connector = note(3, {
      type: "connector",
      from: { objectId: id(99), x: 0, y: 0 },
      to: { objectId: null, x: 100, y: 100 },
    });
    expect(ideaCanvasDraft(value, [connector]).error).toBe("invalid");
    expect(ideaCanvasDraft(value, [note(1), note(2, { x: 12000 })]).error).toBe("invalid");
    expect(value).toEqual(emptyIdeaDraft());
  });
  it("enforces object, point, byte and attachment limits without truncation", () => {
    expect(
      ideaCanvasDraft(
        emptyIdeaDraft(),
        Array.from({ length: 33 }, (_, index) => note(index + 1)),
      ).error,
    ).toBe("limit");
    const pens = Array.from({ length: 9 }, (_, index) =>
      note(index + 1, {
        type: "pen",
        text: "",
        points: Array.from({ length: 128 }, (_, point) => [point, point]),
      }),
    );
    expect(ideaCanvasDraft(emptyIdeaDraft(), pens).error).toBe("limit");
    expect(
      ideaCanvasDraft(
        emptyIdeaDraft(),
        Array.from({ length: 20 }, (_, index) => note(index + 1, { text: "x".repeat(2000) })),
      ).error,
    ).toBe("limit");
    const images = Array.from({ length: 4 }, (_, index) =>
      note(index + 1, { type: "image", mediaId: id(index + 50), altText: "Image", text: "" }),
    );
    expect(ideaCanvasDraft(emptyIdeaDraft(), images).error).toBe("limit");
  });
});

describe("private scene operations", () => {
  it("rejects selection/mutations that target published context IDs", () => {
    const objects = [note(1)];
    for (const ids of [["context:" + id(1)], [id(1), id(99)]]) {
      expect(patchIdeaCanvas(objects, ids, { text: "Overwritten" })).toBeNull();
      expect(transformIdeaCanvas(objects, ids, { type: "move", dx: 20, dy: 20 })).toBeNull();
      expect(deleteIdeaCanvas(objects, ids)).toBeNull();
      expect(duplicateIdeaCanvas(objects, ids)).toBeNull();
      expect(groupIdeaCanvas(objects, ids)).toBeNull();
    }
    expect(objects[0]!.text).toBe("A meaningful participant idea");
  });
  it("moves grouped frame contents together, duplicates internal references and deletes dependent connectors", () => {
    const frame = note(1, { type: "frame", width: 600, height: 500 });
    const child = note(2, { parentId: frame.id, x: 20, y: 40 });
    const connector = note(3, {
      type: "connector",
      parentId: frame.id,
      from: { objectId: child.id, x: 20, y: 40 },
      to: { objectId: null, x: 400, y: 200 },
    });
    const moved = transformIdeaCanvas([frame, child, connector], [frame.id], {
      type: "move",
      dx: 50,
      dy: 30,
    })!;
    expect(moved.find((object) => object.id === child.id)).toMatchObject({ x: 70, y: 70 });
    let nextId = 100;
    const duplicated = duplicateIdeaCanvas(moved, [frame.id], () => id(nextId++))!;
    expect(duplicated).toHaveLength(6);
    expect(duplicated[4]!.parentId).toBe(duplicated[3]!.id);
    const route = duplicated[5]!;
    if (route.type !== "connector") throw new Error("Expected connector");
    expect(route.from.objectId).toBe(duplicated[4]!.id);
    expect(IdeaBoardCanvasSchema.safeParse(serializeIdeaCanvas(duplicated)).success).toBe(true);
    expect(
      deleteIdeaCanvas([frame, child, connector], [child.id])?.map((object) => object.id),
    ).toEqual([frame.id]);
  });
  it("preserves private geometry through conversion, alignment, grouping and lock guards", () => {
    const first = note(1, { type: "rect", shapeVariant: "triangle", x: 20, y: 40 });
    const second = note(2, { x: 300, y: 240 });
    const converted = patchIdeaCanvas([first, second], [first.id], { type: "ellipse" })!;
    expect(converted[0]!.type).toBe("ellipse");
    expect("shapeVariant" in converted[0]!).toBe(false);
    const aligned = arrangeIdeaCanvas(converted, [first.id, second.id], "top")!;
    expect(aligned.map((object) => object.y)).toEqual([40, 40]);
    const grouped = groupIdeaCanvas(aligned, [first.id, second.id])!;
    expect(grouped[0]!.geometricGroupId).toBe(grouped[1]!.geometricGroupId);
    const moved = transformIdeaCanvas(grouped, [first.id], { type: "move", dx: 15, dy: 10 })!;
    expect(moved.map((object) => object.y)).toEqual([50, 50]);
    const locked = patchIdeaCanvas(moved, [first.id], { locked: true }, true)!;
    expect(transformIdeaCanvas(locked, [second.id], { type: "move", dx: 1, dy: 1 })).toBeNull();
    expect(
      groupIdeaCanvas(moved, [first.id], true)?.every((object) => !object.geometricGroupId),
    ).toBe(true);
  });
});
