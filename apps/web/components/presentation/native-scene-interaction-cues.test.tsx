import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PresentationScene } from "@openround/contracts";
import { NativeSceneInteractionCues } from "./native-scene-interaction-cues";
import { NativeSceneView } from "./native-scene-view";

function fixture(): PresentationScene {
  return {
    schemaVersion: 6,
    aspectRatio: "16:9",
    nodes: [
      {
        id: "image",
        type: "image",
        mediaId: "11111111-1111-4111-8111-111111111111",
        altText: "Synthetic overview",
        frame: { x: 10, y: 35, width: 50, height: 50 },
      },
      {
        id: "hotspot",
        type: "hotspot",
        scope: "local",
        imageNodeId: "image",
        label: "Inspect reference",
        detailTitle: "Reference detail",
        body: "Audience evidence",
        frame: { x: 25, y: 45, width: 5, height: 8 },
      },
      {
        id: "reveal",
        type: "reveal",
        scope: "broadcast",
        label: "Open evidence",
        body: "Further audience evidence",
        frame: { x: 20, y: 10, width: 30, height: 20 },
        rotation: 12,
      },
    ],
    readingOrder: ["image", "reveal", "hotspot"],
  };
}

describe("passive creator interaction cues", () => {
  it("uses the authored coordinate plane and rotations without controls or covering labels", () => {
    const scene = fixture();
    const before = JSON.stringify(scene);
    const markup = renderToStaticMarkup(
      <NativeSceneInteractionCues scene={scene} selectedNodeIds={["hotspot"]} />,
    );
    expect(markup).toContain('viewBox="0 0 1600 900"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('focusable="false"');
    expect(markup).toContain('x="320" y="90" width="480" height="180"');
    expect(markup).toContain('transform="rotate(12 560 180)"');
    expect(markup).toContain('data-interaction-cue-image="image"');
    const connection = markup.match(/d="M([\d.]+) ([\d.]+) L([\d.]+) ([\d.]+)"/);
    expect(connection).not.toBeNull();
    const [fromX, fromY, toX, toY] = connection!.slice(1).map(Number);
    expect(fromX).toBeCloseTo(480, 5); // The trigger's right boundary, beyond its text.
    expect(fromY).toBeCloseTo(431.3076923, 5);
    expect(toX).toBe(960);
    expect(toY).toBe(315);
    expect(markup.indexOf('data-interaction-cue-node="reveal"')).toBeLessThan(
      markup.indexOf('data-interaction-cue-node="hotspot"'),
    );
    expect(markup).not.toMatch(/<button|<a\b|<text\b|tabindex/);
    expect(markup).not.toContain("Audience evidence");
    expect(JSON.stringify(scene)).toBe(before);
  });

  it("highlights only the last explicitly selected action and its valid image association", () => {
    const scene = fixture();
    const hotspot = renderToStaticMarkup(
      <NativeSceneInteractionCues scene={scene} selectedNodeIds={["reveal", "hotspot"]} />,
    );
    expect(hotspot).toMatch(/data-interaction-cue-node="hotspot" data-selected="true"/);
    const reveal = renderToStaticMarkup(
      <NativeSceneInteractionCues scene={scene} selectedNodeIds={["hotspot", "reveal"]} />,
    );
    expect(reveal).toMatch(/data-interaction-cue-node="reveal" data-selected="true"/);
    expect(reveal).not.toContain("data-interaction-cue-image");
    expect(reveal).not.toContain("data-interaction-cue-connection");
  });

  it.each(["missing", "outside", "rotated"])(
    "does not invent a connection for a %s hotspot association",
    (condition) => {
      const scene = fixture();
      const hotspot = scene.nodes[1]!;
      const image = scene.nodes[0]!;
      if (hotspot.type !== "hotspot" || image.type !== "image") throw new Error("Invalid fixture");
      if (condition === "missing") hotspot.imageNodeId = null;
      if (condition === "outside") hotspot.frame.x = 85;
      if (condition === "rotated") image.rotation = 5;
      const markup = renderToStaticMarkup(
        <NativeSceneInteractionCues scene={scene} selectedNodeIds={["hotspot"]} />,
      );
      expect(markup).toContain('data-interaction-cue-node="hotspot"');
      expect(markup).not.toContain("data-interaction-cue-image");
      expect(markup).not.toContain("data-interaction-cue-connection");
    },
  );

  it.each(["delivery", "preview", "inert editing", "thumbnail"])(
    "excludes creator overlays from %s even if a caller supplies one",
    (mode) => {
      const scene = fixture();
      const select = vi.fn();
      const markup = renderToStaticMarkup(
        <NativeSceneView
          scene={scene}
          interactionRuntime={mode === "delivery" ? { mode: "live_staff" } : { mode: "review" }}
          staticThumbnail={mode === "thumbnail"}
          interactionEditing={mode === "inert editing"}
          onSelect={mode === "thumbnail" ? select : undefined}
          editorOverlay={<NativeSceneInteractionCues scene={scene} selectedNodeIds={["hotspot"]} />}
        />,
      );
      expect(markup).not.toContain("data-native-interaction-cues");
      expect(select).not.toHaveBeenCalled();
    },
  );

  it("mounts the passive cues inside the editor plane above authored objects", () => {
    const scene = fixture();
    const markup = renderToStaticMarkup(
      <NativeSceneView
        scene={scene}
        onSelect={() => undefined}
        hideGeometryControls
        editorOverlay={<NativeSceneInteractionCues scene={scene} selectedNodeIds={["hotspot"]} />}
      />,
    );
    expect(markup).toContain('data-native-interaction-cues="true"');
    expect(markup).toContain("z-index:5");
    expect(markup.indexOf('data-node-id="hotspot"')).toBeLessThan(
      markup.indexOf('data-native-interaction-cues="true"'),
    );
    expect(markup.lastIndexOf("</svg>")).toBeLessThan(markup.indexOf("</article>"));
  });
});
