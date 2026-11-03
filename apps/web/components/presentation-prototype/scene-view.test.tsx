import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getPresentationSceneFixture } from "../../lib/presentation-scene-fixtures";
import { PresentationSceneView } from "./scene-view";

describe("Presentation scene prototype renderer", () => {
  it("uses semantic reading order independently of the visual positions or node array", () => {
    const scene = structuredClone(getPresentationSceneFixture("business-pitch")!.slides[0]!);
    scene.readingOrder.reverse();
    const markup = renderToStaticMarkup(<PresentationSceneView scene={scene} readingView />);
    const positions = scene.readingOrder.map((id) => markup.indexOf(`data-node-id="${id}"`));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(markup).not.toContain("Select and move");
  });

  it("does not expose or fetch a private media reference in a legacy-adapted scene", () => {
    const scene = structuredClone(getPresentationSceneFixture("business-pitch")!.slides[0]!);
    const image = scene.nodes.find((node) => node.type === "image")!;
    if (image.type !== "image") throw new Error("Expected image");
    image.asset = { kind: "legacy_private_media", mediaId: "00000000-0000-4000-8000-000000000001" };
    const markup = renderToStaticMarkup(<PresentationSceneView scene={scene} />);
    expect(markup).toContain("Private image unavailable");
    expect(markup).not.toContain(image.asset.mediaId);
    expect(markup).not.toContain("<img");
  });

  it("escapes authored text and exposes keyboard movement only in editor mode", () => {
    const scene = structuredClone(getPresentationSceneFixture("business-pitch")!.slides[0]!);
    const title = scene.nodes[0]!;
    if (title.type !== "text") throw new Error("Expected title");
    title.text = "<script>alert(1)</script>";
    const markup = renderToStaticMarkup(
      <PresentationSceneView scene={scene} onSelect={() => {}} />,
    );
    expect(markup).toContain("&lt;script&gt;");
    expect(markup).not.toContain("<script>");
    expect(markup).toContain("Use arrow keys; Shift moves five percent.");
  });
});
