import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CanvasBoardCreateSchema, CanvasObjectCreateSchema } from "../src/canvas-boards";
import { CanvasBoardCreateV2Schema } from "../src/canvas-boards-v2";
import { CANVAS_TEMPLATES, CANVAS_TEMPLATE_IDS } from "../src/canvas-template-catalog";
import { instantiateCanvasTemplate } from "../src/canvas-template-factory";

describe("original canvas starters", () => {
  it("has a bounded, explicit English catalog covering the intended activities", () => {
    expect(CANVAS_TEMPLATES.map((template) => template.id)).toEqual([...CANVAS_TEMPLATE_IDS]);
    expect(new Set(CANVAS_TEMPLATE_IDS).size).toBe(8);
    expect(new Set(CANVAS_TEMPLATES.map((template) => template.category))).toEqual(
      new Set(["brainstorm", "retro", "project", "decision", "learning"]),
    );
    for (const template of CANVAS_TEMPLATES) {
      expect(template.language).toBe("en");
      expect(template.title.length).toBeLessThanOrEqual(160);
      expect(template.prompt.length).toBeLessThanOrEqual(2000);
      expect(template.sections.length).toBeGreaterThanOrEqual(3);
    }
  });
  it.each(CANVAS_TEMPLATE_IDS)("creates valid, editable scaffold with fresh IDs for %s", (id) => {
    const first = instantiateCanvasTemplate(id, randomUUID);
    const second = instantiateCanvasTemplate(id, randomUUID);
    expect(first.length).toBeLessThanOrEqual(40);
    expect(new Set(first.map((object) => object.id)).size).toBe(first.length);
    expect(first.some((object) => second.some((other) => object.id === other.id))).toBe(false);
    const frames = new Set(
      first.filter((object) => object.type === "frame").map((object) => object.id),
    );
    for (const object of first) {
      expect(CanvasObjectCreateSchema.parse(object)).toEqual(object);
      expect(
        id === "flow-to-action"
          ? ["frame", "text", "rect", "diamond", "parallelogram", "connector"]
          : ["frame", "text", "sticky"],
      ).toContain(object.type);
      expect(object.visibility).toBe("published");
      expect(object.locked).toBe(false);
      if (object.parentId) expect(frames.has(object.parentId)).toBe(true);
      expect(object).not.toHaveProperty("ideaId");
      expect(object).not.toHaveProperty("mediaId");
      expect(object).not.toHaveProperty("url");
      if (object.type === "sticky") expect(object.text.endsWith("?")).toBe(true);
    }
  });
  it("rejects an invalid template or broken ID allocator before returning any objects", () => {
    expect(() => instantiateCanvasTemplate("unknown" as never, randomUUID)).toThrow("Unknown");
    expect(() => instantiateCanvasTemplate("possibility-map", () => "not-an-id")).toThrow();
    const id = randomUUID();
    expect(() => instantiateCanvasTemplate("possibility-map", () => id)).toThrow("unique");
  });
  it("keeps the original flowchart V3-only with fresh internal links and authored choices", () => {
    const input = {
      schemaVersion: 3,
      workspaceId: randomUUID(),
      operationId: randomUUID(),
      title: "Flow",
      boardType: "team",
      templateId: "flow-to-action",
    };
    expect(CanvasBoardCreateSchema.safeParse(input).success).toBe(true);
    expect(CanvasBoardCreateV2Schema.safeParse({ ...input, schemaVersion: 2 }).success).toBe(false);
    const objects = instantiateCanvasTemplate("flow-to-action", randomUUID);
    const ids = new Set(objects.map((object) => object.id));
    const arrows = objects.filter((object) => object.type === "connector");
    expect(arrows).toHaveLength(4);
    expect(arrows.map((object) => object.text)).toEqual(["Read", "Check", "Yes", "Not yet"]);
    expect(objects.some((object) => object.type === "diamond")).toBe(true);
    expect(objects.some((object) => object.type === "parallelogram")).toBe(true);
    for (const arrow of arrows) {
      expect(ids.has(arrow.from.objectId!)).toBe(true);
      expect(ids.has(arrow.to.objectId!)).toBe(true);
    }
  });
});
