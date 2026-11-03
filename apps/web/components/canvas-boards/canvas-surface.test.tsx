import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  CanvasObjectSchema,
  CANVAS_FILL_COLORS,
  CANVAS_STROKE_COLORS,
  CanvasShapeVariantSchema,
  canvasShapeVariantPath,
} from "@openround/contracts";
import english from "../../lib/i18n/domains/idea-boards/en-CA";
import { boardFixture } from "../../test-utils/idea-board";
import { CanvasSurface } from "./canvas-surface";
import { canvasObject } from "./canvas-test-fixtures";
vi.mock("../locale-provider", () => ({
  useLocale: () => ({ t: (key: keyof typeof english) => english[key] ?? key }),
}));
describe("canvas visual privacy and normalized content", () => {
  it("renders shared diagram paths, bounded plain labels and explicit arrow styles", () => {
    const connector = CanvasObjectSchema.parse({
      ...canvasObject,
      type: "connector",
      text: "Yes <script>bad()</script>",
      from: { objectId: null, x: 0, y: 0 },
      to: { objectId: null, x: 120, y: 60 },
      routing: "elbow",
      lineStyle: "dashed",
      lineColor: "blue",
      startMarker: "arrow",
      endMarker: "arrow",
    });
    const html = renderToStaticMarkup(
      <CanvasSurface
        objects={[connector]}
        viewport={{ x: 0, y: 0, zoom: 1 }}
        onViewport={() => undefined}
      />,
    );
    expect(html).toContain('d="M0 0 L60 0 L60 60 L120 60"');
    expect(html).toContain('stroke-dasharray="8 5"');
    expect(html).toContain("marker-start=");
    expect(html).toContain("marker-end=");
    expect(html).toContain("Yes &lt;script&gt;bad()&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    const shape = CanvasObjectSchema.parse({
      ...canvasObject,
      type: "diamond",
      width: 200,
      height: 100,
    });
    const diamond = renderToStaticMarkup(
      <CanvasSurface
        objects={[shape]}
        viewport={{ x: 0, y: 0, zoom: 1 }}
        onViewport={() => undefined}
      />,
    );
    expect(diamond).toContain('d="M100 0 L200 50 L100 100 L0 50 Z"');
    expect(diamond).toContain('<foreignObject x="50" y="25" width="100" height="50"');
  });
  it("omits connector routes and labels when an endpoint's guest idea is removed", () => {
    const removed = CanvasObjectSchema.parse({
      ...canvasObject,
      type: "idea_ref",
      text: "",
      ideaId: boardFixture.ideas[0]!.id,
      idea: { ...boardFixture.ideas[0], status: "removed", body: "Removed secret" },
    });
    const connector = CanvasObjectSchema.parse({
      ...canvasObject,
      id: "00000000-0000-4000-8000-000000000099",
      type: "connector",
      text: "Removed path label",
      from: { objectId: removed.id, x: 100, y: 100 },
      to: { objectId: null, x: 200, y: 200 },
    });
    const html = renderToStaticMarkup(
      <CanvasSurface
        objects={[removed, connector]}
        viewport={{ x: 0, y: 0, zoom: 1 }}
        onViewport={() => undefined}
      />,
    );
    expect(html).not.toContain("Removed secret");
    expect(html).not.toContain("Removed path label");
    expect(html).not.toContain(`canvas-object-${connector.id}`);
  });
  it("renders plain text without executing supplied markup", () => {
    const note = CanvasObjectSchema.parse({
      ...canvasObject,
      text: '<script>alert("unsafe")</script>',
    });
    const html = renderToStaticMarkup(
      <CanvasSurface
        objects={[note]}
        viewport={{ x: 0, y: 0, zoom: 1 }}
        onViewport={() => undefined}
      />,
    );
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain('data-testid="canvas-surface"');
  });
  it("does not draw pending or removed guest content from an otherwise valid snapshot", () => {
    const protectedObject = (status: "pending" | "removed" | "approved", index: number) =>
      CanvasObjectSchema.parse({
        ...canvasObject,
        id: "00000000-0000-4000-8000-00000000010" + index,
        type: "idea_ref",
        text: "",
        ideaId: boardFixture.ideas[0]!.id,
        idea: { ...boardFixture.ideas[0], status, body: status + " synthetic secret" },
      });
    const html = renderToStaticMarkup(
      <CanvasSurface
        objects={[
          protectedObject("pending", 1),
          protectedObject("removed", 2),
          protectedObject("approved", 3),
        ]}
        sourceBoardId={boardFixture.id}
        viewport={{ x: 0, y: 0, zoom: 1 }}
        onViewport={() => undefined}
      />,
    );
    expect(html).not.toContain("pending synthetic secret");
    expect(html).not.toContain("removed synthetic secret");
    expect(html).toContain("approved synthetic secret");
    expect(html).not.toContain("data-canvas-resize");
  });
});

describe("V4 canvas rendering", () => {
  it("renders the full bounded shape library with the same paths as export", () => {
    for (const shapeVariant of CanvasShapeVariantSchema.options) {
      const object = CanvasObjectSchema.parse({
        ...canvasObject,
        type: "rect",
        shapeVariant,
        color: "orange",
        fontSize: 24,
        fontFamily: "mono",
        fontWeight: "bold",
        fontStyle: "italic",
        textDecoration: "underline",
        textAlign: "center",
        strokeWidth: 6,
        opacity: 0.5,
      });
      const html = renderToStaticMarkup(
        <CanvasSurface
          objects={[object]}
          viewport={{ x: 0, y: 0, zoom: 1 }}
          onViewport={() => undefined}
        />,
      );
      if (shapeVariant !== "rectangle")
        expect(html).toContain(
          `d="${canvasShapeVariantPath(shapeVariant, object.width, object.height)}"`,
        );
      expect(html).toContain(`fill="${CANVAS_FILL_COLORS.orange}"`);
      expect(html).toContain('stroke-width="6"');
      expect(html).toContain('opacity="0.5"');
      expect(html).toContain("font-size:24px");
      expect(html).toContain("font-family:monospace");
      expect(html).toContain("text-decoration:underline");
      expect(html).toContain("text-align:center");
    }
  });
  it("renders every fill/stroke color and white text on black notes", () => {
    for (const color of Object.keys(CANVAS_FILL_COLORS) as (keyof typeof CANVAS_FILL_COLORS)[]) {
      const note = CanvasObjectSchema.parse({ ...canvasObject, color });
      const pen = CanvasObjectSchema.parse({
        ...canvasObject,
        id: "00000000-0000-4000-8000-000000000099",
        type: "pen",
        color,
        strokeWidth: 12,
        opacity: 0.35,
        points: [
          [0, 0],
          [100, 20],
        ],
      });
      const html = renderToStaticMarkup(
        <CanvasSurface
          objects={[note, pen]}
          viewport={{ x: 0, y: 0, zoom: 1 }}
          onViewport={() => undefined}
        />,
      );
      expect(html).toContain(`fill="${CANVAS_FILL_COLORS[color]}"`);
      expect(html).toContain(`stroke="var(--canvas-line-${color})"`);
      expect(html).toContain('stroke-width="12"');
      expect(html).toContain('opacity="0.35"');
      if (color === "black") expect(html).toContain("color:#ffffff");
    }
  });
  it("shows neither connector handles nor inline inputs to viewers or locked objects", () => {
    for (const props of [
      { canEdit: false, objects: [canvasObject] },
      { canEdit: true, objects: [{ ...canvasObject, locked: true }] },
    ]) {
      const html = renderToStaticMarkup(
        <CanvasSurface
          {...props}
          selectedIds={[canvasObject.id]}
          onCreateConnector={async () => true}
          onCommitText={async () => true}
          viewport={{ x: 0, y: 0, zoom: 1 }}
          onViewport={() => undefined}
        />,
      );
      expect(html).not.toContain("data-canvas-port");
      expect(html).not.toContain("<textarea");
    }
  });
});

const surfaceCss = readFileSync(new URL("./canvas.module.css", import.meta.url), "utf8");
const themeCss = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
function declarations(css: string, selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rule = css.match(new RegExp(`^${escaped}\\s*\\{([^}]+)\\}`, "m"))?.[1];
  if (!rule) throw new Error(`Missing CSS rule ${selector}`);
  return Object.fromEntries(
    [...rule.matchAll(/([\w-]+):\s*([^;]+);/g)].map((match) => [match[1]!, match[2]!.trim()]),
  );
}
function contrast(a: string, b: string) {
  const luminance = (hex: string) => {
    if (!/^#[\da-f]{6}$/i.test(hex)) throw new Error(`Expected an opaque RGB token: ${hex}`);
    const channels = [1, 3, 5].map((offset) => {
      const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
  };
  const first = luminance(a),
    second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}
function canvasTheme(mode: "light" | "dark") {
  const theme = declarations(themeCss, mode === "dark" ? 'html[data-color-mode="dark"]' : ":root");
  const tokens = {
    ...theme,
    ...declarations(surfaceCss, ".surface"),
    ...(mode === "dark"
      ? declarations(surfaceCss, ':global([data-color-mode="dark"]) .surface')
      : {}),
  };
  function resolve(value: string): string {
    const variable = value.match(/^var\((--[\w-]+)\)$/)?.[1];
    return variable ? resolve(tokens[variable]!) : value;
  }
  return { theme, tokens, resolve };
}

describe("canvas display ink", () => {
  const colors = Object.keys(CANVAS_FILL_COLORS) as (keyof typeof CANVAS_FILL_COLORS)[];

  it.each(["light", "dark"] as const)(
    "keeps all standalone color families and neutral lines visible on the %s canvas and panels",
    (mode) => {
      const { theme, tokens, resolve } = canvasTheme(mode);
      expect(declarations(surfaceCss, ".surface").background).toBe("var(--ui-canvas)");
      for (const color of [...colors, "neutral"]) {
        const ink = resolve(tokens[`--canvas-line-${color}`]!);
        for (const background of [
          "--ui-canvas",
          "--ui-surface",
          "--ui-surface-soft",
          "--ui-surface-raised",
        ]) {
          expect(
            contrast(ink, theme[background]!),
            `${color} on ${background}`,
          ).toBeGreaterThanOrEqual(3);
        }
        if (mode === "light" && color !== "neutral")
          expect(ink).toBe(CANVAS_STROKE_COLORS[color as keyof typeof CANVAS_STROKE_COLORS]);
      }
    },
  );

  it.each(colors)(
    "uses the same themed %s ink for saved pen strokes, connector routes/arrowheads and frame boundaries",
    (color) => {
      const pen = CanvasObjectSchema.parse({
        ...canvasObject,
        type: "pen",
        color,
        points: [
          [20, 30],
          [100, 80],
        ],
      });
      const connector = CanvasObjectSchema.parse({
        ...canvasObject,
        id: "00000000-0000-4000-8000-000000000098",
        type: "connector",
        lineColor: color,
        startMarker: "arrow",
        endMarker: "arrow",
        from: { objectId: null, x: 240, y: 80 },
        to: { objectId: null, x: 400, y: 80 },
      });
      const frame = CanvasObjectSchema.parse({
        ...canvasObject,
        id: "00000000-0000-4000-8000-000000000099",
        type: "frame",
        color,
      });
      const objects = [pen, connector, frame];
      const original = structuredClone(objects);
      const html = renderToStaticMarkup(
        <CanvasSurface
          objects={objects}
          viewport={{ x: 0, y: 0, zoom: 1 }}
          onViewport={() => undefined}
        />,
      );
      const ink = `var(--canvas-line-${color})`;
      expect(html).toContain(`<polyline points="20,30 100,80" fill="none" stroke="${ink}"`);
      expect(html).toContain(`d="M240 80 L400 80" fill="none" stroke="${ink}"`);
      expect(html).toContain(`fill="transparent" stroke="${ink}"`);
      const marker = [...html.matchAll(/<marker[^>]*id="([^"]+)"[^>]*>(.*?)<\/marker>/g)].find(
        (match) => match[1]!.endsWith(`-${color}`),
      );
      expect(marker?.[2]).toContain(`fill="${ink}"`);
      expect(html).toContain(`marker-start="url(#${marker![1]})"`);
      expect(html).toContain(`marker-end="url(#${marker![1]})"`);
      expect(objects).toEqual(original);
    },
  );

  it.each(["light", "dark"] as const)(
    "preserves chosen fills and a visible object boundary in %s mode",
    (mode) => {
      const { theme, tokens, resolve } = canvasTheme(mode);
      for (const color of colors) {
        const object = CanvasObjectSchema.parse({ ...canvasObject, color });
        const html = renderToStaticMarkup(
          <CanvasSurface
            objects={[object]}
            viewport={{ x: 0, y: 0, zoom: 1 }}
            onViewport={() => undefined}
          />,
        );
        const fill = CANVAS_FILL_COLORS[color];
        const border =
          color === "black" ? "var(--canvas-black-border)" : CANVAS_STROKE_COLORS[color];
        expect(html).toContain(`fill="${fill}" stroke="${border}"`);
        expect(
          Math.max(
            contrast(fill, theme["--ui-canvas"]!),
            contrast(resolve(border), theme["--ui-canvas"]!),
          ),
          `${color} boundary`,
        ).toBeGreaterThanOrEqual(3);
        if (color !== "black" || mode === "dark")
          expect(
            contrast(resolve(border), fill),
            `${color} border on its fill`,
          ).toBeGreaterThanOrEqual(3);
      }
      expect(
        contrast(resolve(tokens["--canvas-panel-border"]!), theme["--ui-surface-raised"]!),
      ).toBeGreaterThanOrEqual(3);
    },
  );

  it("themes default connector ink, labels and text-panel boundaries", () => {
    const connector = CanvasObjectSchema.parse({
      ...canvasObject,
      type: "connector",
      text: "Readable label",
      from: { objectId: null, x: 0, y: 0 },
      to: { objectId: null, x: 200, y: 0 },
    });
    const text = CanvasObjectSchema.parse({
      ...canvasObject,
      id: "00000000-0000-4000-8000-000000000099",
      type: "text",
    });
    const html = renderToStaticMarkup(
      <CanvasSurface
        objects={[connector, text]}
        viewport={{ x: 0, y: 0, zoom: 1 }}
        onViewport={() => undefined}
      />,
    );
    expect(html).toContain('d="M0 0 L200 0" fill="none" stroke="var(--canvas-line-neutral)"');
    expect(
      html.match(/fill="var\(--ui-surface-raised\)" stroke="var\(--canvas-panel-border\)"/g),
    ).toHaveLength(2);
    expect(html).toContain('fill="var(--ui-text-strong)"');
    for (const mode of ["light", "dark"] as const) {
      const { theme } = canvasTheme(mode);
      expect(
        contrast(theme["--ui-text-strong"]!, theme["--ui-surface-raised"]!),
      ).toBeGreaterThanOrEqual(4.5);
    }
    expect(connector).toMatchObject({ type: "connector", lineColor: "neutral" });
  });

  it("keeps selection handles and connector ports outlined against both themes", () => {
    for (const type of ["sticky", "pen"] as const) {
      const object = CanvasObjectSchema.parse({
        ...canvasObject,
        type,
        ...(type === "pen"
          ? {
              points: [
                [0, 0],
                [100, 80],
              ],
            }
          : {}),
      });
      const html = renderToStaticMarkup(
        <CanvasSurface
          objects={[object]}
          selectedIds={[object.id]}
          tool="select"
          canEdit
          onCreateConnector={async () => true}
          viewport={{ x: 0, y: 0, zoom: 1 }}
          onViewport={() => undefined}
        />,
      );
      const handle = html.match(/<rect data-canvas-resize="true"[^>]*>/)?.[0];
      expect(handle).toContain('fill="var(--ui-accent-ink)"');
      expect(handle).toContain('stroke="var(--ui-surface)" stroke-width="2"');
      if (type === "sticky") {
        expect(html.match(/data-canvas-port=/g)).toHaveLength(4);
        expect(html).toContain('fill="var(--ui-surface)" stroke="var(--ui-accent-ink)"');
      }
    }
    for (const mode of ["light", "dark"] as const) {
      const { theme } = canvasTheme(mode);
      for (const background of ["--ui-canvas", "--ui-surface"])
        expect(contrast(theme["--ui-accent-ink"]!, theme[background]!)).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("canvas text contrast and frame typography", () => {
  it.each(["light", "dark"] as const)(
    "keeps all text colors readable on the %s raised surface without changing persisted ink",
    (mode) => {
      const theme = declarations(
        themeCss,
        mode === "dark" ? 'html[data-color-mode="dark"]' : ":root",
      );
      const displayInk = {
        ...declarations(surfaceCss, ".surface"),
        ...(mode === "dark"
          ? declarations(surfaceCss, ':global([data-color-mode="dark"]) .surface')
          : {}),
      };
      for (const color of Object.keys(
        CANVAS_STROKE_COLORS,
      ) as (keyof typeof CANVAS_STROKE_COLORS)[]) {
        const object = CanvasObjectSchema.parse({ ...canvasObject, type: "text", color });
        const html = renderToStaticMarkup(
          <CanvasSurface
            objects={[object]}
            viewport={{ x: 0, y: 0, zoom: 1 }}
            onViewport={() => undefined}
          />,
        );
        expect(html).toContain(`color:var(--canvas-text-${color})`);
        expect(html).toContain('fill="var(--ui-surface-raised)"');
        const token = displayInk[`--canvas-text-${color}`]!;
        const ink = token === "var(--ui-text-strong)" ? theme["--ui-text-strong"]! : token;
        expect(contrast(ink, theme["--ui-surface-raised"]!)).toBeGreaterThanOrEqual(4.5);
        if (color === "white" || color === "black") expect(token).toBe("var(--ui-text-strong)");
        else
          expect(token).toBe(
            mode === "dark" ? CANVAS_FILL_COLORS[color] : CANVAS_STROKE_COLORS[color],
          );
        expect(object.color).toBe(color);
      }
    },
  );
  it("keeps inline editing on theme text and surface tokens", () => {
    const editor = declarations(surfaceCss, ".inlineEditor textarea");
    expect(editor.color).toBe("var(--ui-text-strong)");
    expect(editor.background).toBe("var(--ui-surface)");
    for (const selector of [":root", 'html[data-color-mode="dark"]']) {
      const theme = declarations(themeCss, selector);
      expect(contrast(theme["--ui-text-strong"]!, theme["--ui-surface"]!)).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });
  it.each([
    [10, 28],
    [16, 28],
    [48, 70],
    [96, 140],
  ])("allocates an unclipped frame title line at font size %s", (fontSize, height) => {
    const object = CanvasObjectSchema.parse({
      ...canvasObject,
      type: "frame",
      width: 600,
      height: 260,
      fontSize,
      text: "Frame title",
    });
    const html = renderToStaticMarkup(
      <CanvasSurface
        objects={[object]}
        viewport={{ x: 0, y: 0, zoom: 1 }}
        onViewport={() => undefined}
      />,
    );
    expect(html).toContain(`<foreignObject x="10" y="10" width="580" height="${height}">`);
    expect(html).toContain("line-height:1.45");
    expect(height).toBeGreaterThanOrEqual(fontSize! * 1.45);
  });
  it("bounds a large frame title viewport to the available frame height", () => {
    const object = CanvasObjectSchema.parse({
      ...canvasObject,
      type: "frame",
      height: 36,
      fontSize: 96,
    });
    const html = renderToStaticMarkup(
      <CanvasSurface
        objects={[object]}
        viewport={{ x: 0, y: 0, zoom: 1 }}
        onViewport={() => undefined}
      />,
    );
    expect(html).toContain('<foreignObject x="10" y="10" width="180" height="16">');
  });
});
