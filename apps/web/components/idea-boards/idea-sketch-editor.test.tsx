import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import english from "../../lib/i18n/domains/idea-boards/en-CA";
import { IdeaSketchEditor } from "./idea-sketch-editor";
import { emptySketch, newSketchElement } from "./sketch-model";

const selection = vi.hoisted(() => ({ inject: false, id: "00000000-0000-4000-8000-000000000001" }));
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof ReactModule>();
  return {
    ...react,
    useState: <T,>(initial: T | (() => T)) => {
      if (initial === null && selection.inject) {
        selection.inject = false;
        return react.useState(selection.id);
      }
      return react.useState(initial);
    },
  };
});
vi.mock("../locale-provider", () => ({
  useLocale: () => ({
    t: (key: keyof typeof english, values: Record<string, string | number> = {}) =>
      english[key].replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? `{${name}}`)),
  }),
}));

describe("drawing inspector accessible labels", () => {
  it.each(["text", "rect"] as const)(
    "associates the selected %s controls with separate exact labels",
    (type) => {
      selection.inject = true;
      const sketch = {
        ...emptySketch(),
        elements: [newSketchElement(type, selection.id, "Your text")],
      };
      const markup = renderToStaticMarkup(
        <IdeaSketchEditor value={sketch} onSave={() => {}} onCancel={() => {}} />,
      );
      const labels =
        type === "text" ? ["Drawing text", "Text size", "Colour"] : ["Colour", "Line width"];
      for (const label of labels) {
        const match = markup.match(new RegExp(`<label for="([^"]+)">${label}</label>`));
        expect(match, label).not.toBeNull();
        expect(markup).toContain(`id="${match![1]}"`);
      }
      if (type === "text") {
        expect(markup).toMatch(/<textarea id="[^"]+"[^>]*>Your text<\/textarea>/);
        expect(markup).not.toMatch(/<label[^>]*>Drawing text[^<]*<textarea/);
      }
    },
  );
});
