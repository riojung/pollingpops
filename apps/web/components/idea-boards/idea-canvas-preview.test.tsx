import { isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  CanvasObjectSchema,
  type IdeaBoardCanvas,
  type IdeaBoardCanvasObject,
} from "@openround/contracts";
import { boardFixture, boardId } from "../../test-utils/idea-board";
import english from "../../lib/i18n/domains/idea-boards/en-CA";
import { IdeaContent } from "./idea-content";
import { ideaCanvasObjects, IdeaCanvasScene } from "./idea-canvas-preview";
import { CanvasSurface } from "../canvas-boards/canvas-surface";

vi.mock("../locale-provider", () => ({
  useLocale: () => ({ locale: "en-CA", t: (key: keyof typeof english) => english[key] ?? key }),
}));

const ids = Array.from(
  { length: 7 },
  (_, index) => `00000000-0000-4000-8000-${String(index + 20).padStart(12, "0")}`,
);
function local(input: Record<string, unknown>): IdeaBoardCanvasObject {
  const { visibility, version, idea, ...object } = CanvasObjectSchema.parse({
    ...input,
    version: 1,
  });
  void visibility;
  void version;
  void idea;
  return object as IdeaBoardCanvasObject;
}
const canvas: IdeaBoardCanvas = {
  schemaVersion: 1,
  x: 100,
  y: 200,
  width: 640,
  height: 320,
  objects: [
    local({ id: ids[0], type: "frame", text: "Local frame", x: 0, y: 0, width: 640, height: 320 }),
    local({
      id: ids[1],
      type: "sticky",
      text: "Native visual idea",
      x: 20,
      y: 50,
      width: 180,
      height: 100,
      parentId: ids[0],
      geometricGroupId: ids[6],
    }),
    local({
      id: ids[2],
      type: "connector",
      x: 200,
      y: 100,
      width: 60,
      height: 40,
      from: { objectId: ids[1], x: 200, y: 100 },
      to: { objectId: null, x: 260, y: 140 },
    }),
    local({
      id: ids[3],
      type: "image",
      mediaId: ids[5],
      altText: "Placed image",
      x: 300,
      y: 40,
      width: 180,
      height: 120,
    }),
    local({
      id: ids[4],
      type: "link",
      text: "Placed reference",
      url: "https://example.com/placed",
      x: 300,
      y: 180,
      width: 250,
      height: 100,
    }),
  ],
};

describe("native idea canvas rendering", () => {
  it("namespaces every relationship without changing the native composition", () => {
    const before = structuredClone(canvas);
    const objects = ideaCanvasObjects(canvas, "first-idea");
    const second = ideaCanvasObjects(canvas, "second-idea");
    expect(objects[1]).toMatchObject({
      id: `idea:first-idea:${ids[1]}`,
      parentId: `idea:first-idea:${ids[0]}`,
      geometricGroupId: `idea:first-idea:${ids[6]}`,
      x: 20,
      y: 50,
      width: 180,
      height: 100,
    });
    expect(objects[2]).toMatchObject({
      from: { objectId: objects[1]!.id },
      to: { objectId: null },
    });
    expect(second.every((object) => !objects.some((first) => first.id === object.id))).toBe(true);
    expect(canvas).toEqual(before);
  });

  it("never recurses into an injected protected reference", () => {
    const unsafe = {
      ...canvas,
      objects: [
        ...canvas.objects,
        { id: ids[6], type: "idea_ref", ideaId: boardFixture.ideas[0]!.id },
      ],
    } as unknown as IdeaBoardCanvas;
    expect(ideaCanvasObjects(unsafe, "idea")).toHaveLength(canvas.objects.length);
  });

  it("fits an inert native scene with idea media access and no child write callbacks", () => {
    const scene = IdeaCanvasScene({
      canvas,
      ideaId: "idea",
      boardId,
      width: 320,
      height: 160,
      guestToken: "ab".repeat(32),
      canvasId: ids[6],
      versionId: ids[0],
    });
    expect(scene.props.inert).toBe(true);
    expect(scene.props["aria-hidden"]).toBe("true");
    expect(isValidElement(scene.props.children)).toBe(true);
    const surface = scene.props.children as ReactElement<Parameters<typeof CanvasSurface>[0]>;
    expect(surface.type).toBe(CanvasSurface);
    expect(surface.props.viewport).toEqual({ x: 0, y: 0, zoom: 0.5 });
    expect(surface.props).toMatchObject({
      sourceBoardId: boardId,
      guestToken: "ab".repeat(32),
      canvasId: ids[6],
      versionId: ids[0],
    });
    expect(surface.props.isIdeaImage?.(surface.props.objects[3]!)).toBe(true);
    for (const key of [
      "canEdit",
      "canFacilitate",
      "onPatch",
      "onTransform",
      "onCommitText",
      "onCreatePen",
      "onCreateConnector",
    ])
      expect(surface.props).not.toHaveProperty(key);
  });

  it.each(["pending", "approved"] as const)(
    "previews %s native ideas and keeps only unplaced manifest content outside the scene",
    (status) => {
      const markup = renderToStaticMarkup(
        <IdeaContent
          boardId={boardId}
          guestToken={"ab".repeat(32)}
          idea={{
            ...boardFixture.ideas[0]!,
            status,
            canvas,
            attachments: [
              { mediaId: ids[5]!, alt: "Placed image" },
              { mediaId: ids[6]!, alt: "Unplaced image" },
            ],
            links: [
              {
                url: "https://example.com/placed",
                label: "Placed reference",
                imageMediaId: ids[6],
              },
              { url: "https://example.com/extra", label: "Unplaced reference" },
            ],
          }}
        />,
      );
      expect(markup).toContain("Native visual idea");
      expect(markup).toContain("Open idea canvas");
      expect(markup).toContain("5 canvas objects");
      expect(markup.match(/<figure\b/g)).toHaveLength(2);
      expect(markup).toContain("Unplaced image");
      expect(markup).toContain("Unplaced reference");
      expect(markup.match(/href="https:\/\/example.com\/placed"/g)).toHaveLength(1);
      expect(markup).not.toContain("abababab");
    },
  );

  it("does not render removed native content supplied by a stale caller", () => {
    expect(
      renderToStaticMarkup(
        <IdeaContent
          boardId={boardId}
          idea={{ ...boardFixture.ideas[0]!, status: "removed", canvas }}
        />,
      ),
    ).toBe("");
  });
});
