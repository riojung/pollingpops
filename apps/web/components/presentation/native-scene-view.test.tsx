import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createNativeContentBlock } from "../../lib/presentation-native-scene";
import { type PresentationScene } from "@openround/contracts";
import { ContentSlideView } from "./content-slide-view";
import { NativeSceneEditor } from "./native-scene-editor";
import { NativeSceneView } from "./native-scene-view";

function nativeSceneFixture(): PresentationScene {
  return {
    schemaVersion: 1,
    aspectRatio: "16:9",
    nodes: [
      {
        id: "title",
        type: "text",
        role: "title",
        text: "Native workflow",
        frame: { x: 8, y: 8, width: 84, height: 20 },
      },
      {
        id: "shape",
        type: "shape",
        shape: "diamond",
        color: "blue",
        label: "Decision",
        frame: { x: 40, y: 40, width: 25, height: 30 },
      },
      {
        id: "body",
        type: "text",
        role: "body",
        text: "Start here",
        frame: { x: 8, y: 40, width: 25, height: 20 },
      },
      {
        id: "edge",
        type: "connector",
        from: { nodeId: "body", anchor: "right" },
        to: { nodeId: "shape", anchor: "left" },
        label: "Continue",
        color: "blue",
      },
    ],
    readingOrder: ["title", "body", "shape", "edge"],
  };
}

describe("production native scene rendering", () => {
  it.each(["preview", "live", "editor"] as const)(
    "dispatches %s to the same public renderer with independent reading/stacking order",
    (variant) => {
      const block = {
        ...createNativeContentBlock(),
        scene: nativeSceneFixture(),
        speakerNotes: "private-author-cue",
      };
      const markup = renderToStaticMarkup(<ContentSlideView block={block} variant={variant} />);
      expect(markup).toContain('data-native-scene="true"');
      expect(markup.indexOf('data-node-id="body"')).toBeLessThan(
        markup.indexOf('data-node-id="shape"'),
      );
      expect(markup).toContain("z-index:3");
      expect(markup).toContain(
        'data-frame="{&quot;x&quot;:8,&quot;y&quot;:40,&quot;width&quot;:25,&quot;height&quot;:20}"',
      );
      expect(markup).toContain("M528 450 L640 495");
      expect(markup).not.toContain("private-author-cue");
      expect(markup).not.toContain("<textarea");
    },
  );

  it("passes only authorized media references to its supplied image renderer", () => {
    const scene = nativeSceneFixture();
    scene.nodes.push({
      id: "image",
      type: "image",
      mediaId: "11111111-1111-4111-8111-111111111111",
      altText: "Workflow evidence",
      frame: { x: 70, y: 40, width: 20, height: 30 },
    });
    scene.readingOrder.push("image");
    const references: unknown[] = [];
    const markup = renderToStaticMarkup(
      <NativeSceneView
        scene={scene}
        renderImage={(id, altText) => {
          references.push([id, altText]);
          return <img alt={altText ?? ""} src="/authorized-image" />;
        }}
      />,
    );
    expect(references).toEqual([["11111111-1111-4111-8111-111111111111", "Workflow evidence"]]);
    expect(markup).toContain('src="/authorized-image"');
    const unavailable = renderToStaticMarkup(<NativeSceneView scene={scene} />);
    expect(unavailable).toContain("Image unavailable");
    expect(unavailable).not.toContain("11111111-1111-4111-8111-111111111111");
  });

  it("keeps labels readable on the dark shape palette", () => {
    const scene = nativeSceneFixture();
    const shape = scene.nodes.find((node) => node.type === "shape")!;
    if (shape.type === "shape") shape.color = "black";
    expect(renderToStaticMarkup(<NativeSceneView scene={scene} />)).toContain("color:#ffffff");
  });

  it("escapes native text and exposes keyboard frame controls only in the editor", () => {
    const scene = nativeSceneFixture();
    const title = scene.nodes[0]!;
    if (title.type === "text") title.text = "<script>unsafe()</script>";
    const markup = renderToStaticMarkup(
      <NativeSceneView scene={scene} onSelect={() => {}} onFrameChange={() => {}} />,
    );
    expect(markup).toContain("&lt;script&gt;unsafe()&lt;/script&gt;");
    expect(markup).not.toContain("<script>");
    expect(markup).toContain("Use arrow keys to nudge.");
    expect(markup).toContain("Use arrow keys to change size.");
    expect(renderToStaticMarkup(<NativeSceneView scene={scene} />)).not.toContain("<button");
  });

  it("exposes complete native authoring controls while requiring a description before upload", () => {
    const markup = renderToStaticMarkup(
      <NativeSceneEditor
        scene={nativeSceneFixture()}
        onChange={() => {}}
        renderImage={() => null}
        uploadsEnabled
        mediaState="idle"
        onUploadImage={() => {}}
      />,
    );
    for (const label of [
      "Native slide title",
      "Add native text",
      "Add native shape",
      "Add native connector",
      "Object width (%)",
      "Read object earlier",
      "Read object later",
      "Delete object",
    ])
      expect(markup).toContain(label);
    expect(markup).toMatch(/aria-label="Add native image"[^>]*disabled=""/);
  });
});
