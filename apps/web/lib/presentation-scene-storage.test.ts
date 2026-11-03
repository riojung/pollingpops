import { describe, expect, it } from "vitest";
import {
  boundPrototypeFrame,
  createPresentationSceneWorkspace,
  parsePresentationSceneWorkspace,
  PRESENTATION_SCENE_WORKSPACE_MAX_BYTES,
  serializePresentationSceneWorkspace,
} from "./presentation-scene-storage";
import { presentationSceneFixtures } from "./presentation-scene-fixtures";

describe("isolated Presentation scene workspace", () => {
  it("restores edits, reading order, image references and the selected task without changing fixtures", () => {
    const original = JSON.stringify(presentationSceneFixtures);
    const workspace = createPresentationSceneWorkspace();
    workspace.activeFixtureId = "product-demo";
    workspace.decks[1]!.activeSlideId = workspace.decks[1]!.slides[2]!.id;
    const slide = workspace.decks[0]!.slides[0]!;
    const title = slide.nodes.find((node) => node.type === "text" && node.role === "title")!;
    if (title.type !== "text") throw new Error("Expected title");
    title.text = "Edited local pitch";
    title.frame.x = 8;
    slide.speakerNotes = "Private to this working fixture";
    slide.readingOrder.reverse();
    expect(parsePresentationSceneWorkspace(serializePresentationSceneWorkspace(workspace))).toEqual(
      workspace,
    );
    expect(JSON.stringify(presentationSceneFixtures)).toBe(original);
  });

  it.each(["{broken", "null", "[]", '{"schemaVersion":2}'])(
    "rejects corrupt or unsupported data %s",
    (raw) => {
      expect(() => parsePresentationSceneWorkspace(raw)).toThrow();
    },
  );

  it("rejects private media even though the adapter can retain its opaque reference", () => {
    const workspace = createPresentationSceneWorkspace();
    const image = workspace.decks[0]!.slides[0]!.nodes.find((node) => node.type === "image")!;
    if (image.type !== "image") throw new Error("Expected image");
    image.asset = { kind: "legacy_private_media", mediaId: "00000000-0000-4000-8000-000000000001" };
    expect(() => serializePresentationSceneWorkspace(workspace)).toThrow("bundled prototype");
  });

  it("rejects repeated decks and mismatched slide identity instead of guessing a restore target", () => {
    const workspace = createPresentationSceneWorkspace();
    workspace.decks[1] = structuredClone(workspace.decks[0]!);
    expect(() => serializePresentationSceneWorkspace(workspace)).toThrow("bundled task decks");
    const changed = createPresentationSceneWorkspace();
    changed.decks[0]!.slides[0]!.id = "another-slide";
    expect(() => serializePresentationSceneWorkspace(changed)).toThrow("bundled prototype");
  });

  it("checks UTF-8 storage bytes before parsing a large multibyte payload", () => {
    const raw = JSON.stringify("界".repeat(Math.ceil(PRESENTATION_SCENE_WORKSPACE_MAX_BYTES / 2)));
    expect(raw.length).toBeLessThan(PRESENTATION_SCENE_WORKSPACE_MAX_BYTES);
    expect(() => parsePresentationSceneWorkspace(raw)).toThrow("size limit");
  });

  it("keeps movement inside the fixed slide without changing the requested size", () => {
    expect(boundPrototypeFrame({ x: 97, y: -10, width: 20, height: 12 })).toEqual({
      x: 80,
      y: 0,
      width: 20,
      height: 12,
    });
    expect(boundPrototypeFrame({ x: Infinity, y: NaN, width: 0, height: 101 })).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 100,
    });
  });
});
