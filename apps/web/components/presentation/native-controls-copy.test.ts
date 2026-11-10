import { describe, expect, it } from "vitest";
import { supportedLocales, type PresentationSceneNode } from "@openround/contracts";
import {
  nativeControlNodeLabel,
  nativeControlsCopy,
  nativeControlsCopyKeys,
} from "./native-controls-copy";
import { createNativeContentBlock } from "../../lib/presentation-native-scene";

describe("native controls system copy", () => {
  it.each(supportedLocales)("covers every key and preserves interpolation in %s", (locale) => {
    const copy = nativeControlsCopy(locale);
    for (const key of nativeControlsCopyKeys) {
      expect(copy(key).trim(), key).not.toBe("");
      expect(
        copy(key)
          .match(/\{\w+\}/g)
          ?.sort() ?? [],
        key,
      ).toEqual(key.match(/\{\w+\}/g)?.sort() ?? []);
    }
    expect(copy("Move {name}. Use arrow keys to nudge.", { name: "Original English" })).toContain(
      "Original English",
    );
    expect(
      copy("Resize group {number}. Use arrow keys to change size.", { number: 2 }),
    ).not.toMatch(/\{\w+\}/);
    if (locale !== "en-CA") {
      expect(copy("Selected object controls")).not.toBe("Selected object controls");
      expect(copy("Slide font")).not.toBe("Slide font");
      expect(
        copy(
          "This image change exceeds the slide’s limits. Shorten some text or remove an object, then try again.",
        ),
      ).not.toContain("This image change");
    }
  });
  it("localizes generated type names and leaves authored identical English fallbacks intact", () => {
    const frame = { x: 10, y: 30, width: 40, height: 30 };
    const nodes: PresentationSceneNode[] = [
      { id: "body", type: "text", role: "body", text: "Body text", frame },
      {
        id: "image",
        type: "image",
        mediaId: "11111111-1111-4111-8111-111111111111",
        altText: "Image",
        frame,
      },
      {
        id: "shape",
        type: "shape",
        shape: "rounded_rectangle",
        label: "rounded rectangle shape",
        color: "blue",
        frame,
      },
      { id: "table", type: "table", caption: "Data table", headers: ["A"], rows: [["1"]], frame },
      {
        id: "chart",
        type: "chart",
        title: "bar chart",
        summary: "",
        chartType: "bar",
        categories: ["A"],
        series: [{ name: "Count", values: [1] }],
        frame,
      },
    ];
    const before = structuredClone(nodes);
    for (const node of nodes) {
      let authored: string | null;
      switch (node.type) {
        case "text":
          authored = node.text;
          break;
        case "image":
          authored = node.altText;
          break;
        case "shape":
          authored = node.label;
          break;
        case "table":
          authored = node.caption;
          break;
        case "chart":
          authored = node.title;
          break;
        default:
          throw new Error(`Unexpected authored-label fixture: ${node.type}`);
      }
      expect(nativeControlNodeLabel("ko-KR", node)).toEqual({ text: authored, language: "" });
    }
    const shape = nodes[2]!;
    if (shape.type !== "shape") throw new Error("shape fixture");
    expect(nativeControlNodeLabel("ko-KR", { ...shape, label: "" })).toEqual({
      text: "둥근 사각형 도형",
      language: "ko-KR",
    });
    const title = createNativeContentBlock().scene!.nodes[0]!;
    expect(nativeControlNodeLabel("ko-KR", title)).toEqual({
      text: "슬라이드 제목",
      language: "ko-KR",
    });
    expect(nodes).toEqual(before);
  });
  it("preserves known authored text language without assigning it to generated labels", () => {
    const body: Extract<PresentationSceneNode, { type: "text" }> = {
      id: "fr-body",
      type: "text",
      role: "body",
      text: "Texte original",
      lang: "fr",
      frame: { x: 8, y: 35, width: 40, height: 30 },
    };
    const before = structuredClone(body);
    expect(nativeControlNodeLabel("ko-KR", body)).toEqual({
      text: "Texte original",
      language: "fr",
    });
    expect(
      nativeControlNodeLabel("ko-KR", { ...body, lang: "es", text: "Texto original" }),
    ).toEqual({ text: "Texto original", language: "es" });
    const { lang: _language, ...unmarked } = body;
    void _language;
    expect(nativeControlNodeLabel("ko-KR", unmarked)).toEqual({
      text: "Texte original",
      language: "",
    });
    expect(nativeControlNodeLabel("ko-KR", { ...body, text: "" })).toEqual({
      text: "본문 텍스트",
      language: "ko-KR",
    });
    expect(nativeControlNodeLabel("ko-KR", { ...body, role: "title" })).toEqual({
      text: "슬라이드 제목",
      language: "ko-KR",
    });
    expect(body).toEqual(before);
  });
});
