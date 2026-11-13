import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as fontkit from "fontkit";
import PDFDocument from "pdfkit";
import {
  createCanvas,
  loadImage,
  GlobalFonts,
  Path2D,
  type SKRSContext2D,
  type Image,
} from "@napi-rs/canvas";
import {
  PresentationReviewSchema,
  CANVAS_FILL_COLORS,
  CANVAS_STROKE_COLORS,
  canvasDiagramShapePath,
  canvasShapeVariantPath,
  resolveContentSlideFrames,
  contentSlideMediaFrame,
  isSafePresentationLink,
  type PresentationReviewBlock,
  type PresentationSceneNode,
  type PresentationSceneFrame,
  type PresentationRichTextParagraph,
  type PresentationRichTextRun,
} from "@openround/contracts";
import { inspectPresentationVisualImage } from "./presentation-visual-converter.js";
import { paintPresentationMotionPoster } from "./presentation-motion-poster.js";
import {
  PresentationStaticExportError,
  PRESENTATION_STATIC_RENDER_LIMITS as limits,
  PRESENTATION_STATIC_DISCLOSURE as disclosure,
  PRESENTATION_OFFLINE_DISCLOSURE as offlineDisclosure,
  type PresentationStaticRenderInput,
  type PresentationStaticRenderResult,
} from "./presentation-static-renderer-types.js";

const W = limits.width,
  H = limits.height;
const palettes = {
  paper: { background: "#fffdf7", text: "#172b4d", link: "#174d8c", border: "#a6b0ba" },
  midnight: { background: "#111b2e", text: "#f6f8ff", link: "#99d8ff", border: "#657796" },
  ocean: { background: "#eaf8fa", text: "#113945", link: "#145678", border: "#78aab2" },
  sunset: { background: "#fff0e5", text: "#522a20", link: "#873722", border: "#bc8f7b" },
};
type Palette = typeof palettes.paper;
type Scene = NonNullable<Extract<PresentationReviewBlock, { kind: "content" }>["scene"]>;
type Framed = Exclude<PresentationSceneNode, { type: "connector" }>;
type RenderImages = PresentationStaticRenderInput["images"] & {
  decoded: Map<string, Promise<Image>>;
};
type Style = {
  size: number;
  family: string;
  color: string;
  leading: number;
  bold?: boolean;
  italic?: boolean;
};
type Glyph = { text: string; bold?: boolean; italic?: boolean; href?: string };
const chartColors = ["#3676ac", "#2f805f", "#a85f20", "#8a61aa"];
const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });
const fontsDirectory = new URL("../assets/summary-fonts/", import.meta.url);
let fonts: { cjk: fontkit.Font; emoji: fontkit.Font } | undefined;
const checkedText = new Set<string>();
function assertText(text: string) {
  if (checkedText.has(text)) return;
  if (!fonts) {
    const cjk = fileURLToPath(new URL("NotoSansCJKjp-Regular.otf", fontsDirectory)),
      emoji = fileURLToPath(new URL("NotoEmoji.ttf", fontsDirectory));
    fonts = {
      cjk: fontkit.create(readFileSync(cjk)) as fontkit.Font,
      emoji: fontkit.create(readFileSync(emoji)) as fontkit.Font,
    };
    if (!GlobalFonts.has("StaticCJK") && !GlobalFonts.registerFromPath(cjk, "StaticCJK"))
      throw new PresentationStaticExportError("EXPORT_INVALID");
    if (!GlobalFonts.has("StaticEmoji") && !GlobalFonts.registerFromPath(emoji, "StaticEmoji"))
      throw new PresentationStaticExportError("EXPORT_INVALID");
  }
  for (const { segment } of graphemes.segment(text)) {
    if (
      ![fonts.cjk, fonts.emoji].some((font) =>
        [...segment].every((character) => {
          const code = character.codePointAt(0)!;
          return (
            [9, 10, 13, 0x200d, 0xfe0e, 0xfe0f].includes(code) ||
            (code >= 0xe0020 && code <= 0xe007f) ||
            font.hasGlyphForCodePoint(code)
          );
        }),
      )
    )
      throw new PresentationStaticExportError("EXPORT_INVALID");
  }
  checkedText.add(text);
}
function font(ctx: SKRSContext2D, style: Style, run?: Glyph) {
  ctx.font = `${run?.italic || style.italic ? "italic " : ""}${run?.bold || style.bold ? "700" : "400"} ${style.size}px ${style.family}, StaticCJK, StaticEmoji`;
}
function family(token: string | undefined) {
  return token === "serif" ? "serif" : token === "mono" ? "monospace" : "sans-serif";
}
function checkSize(bytes: Buffer) {
  if (bytes.byteLength > limits.outputBytes)
    throw new PresentationStaticExportError("EXPORT_LIMIT");
  return bytes;
}
function frame(value: PresentationSceneFrame) {
  return {
    x: (value.x * W) / 100,
    y: (value.y * H) / 100,
    width: (value.width * W) / 100,
    height: (value.height * H) / 100,
  };
}
function clip(ctx: SKRSContext2D, x: number, y: number, width: number, height: number) {
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();
}
function lineTokens(
  ctx: SKRSContext2D,
  runs: readonly PresentationRichTextRun[],
  width: number,
  style: Style,
): Glyph[][] {
  const lines: Glyph[][] = [[]];
  let used = 0;
  const add = (text: string, run: PresentationRichTextRun) => {
    if (!text) return;
    font(ctx, style, run);
    const measured = ctx.measureText(text).width;
    if (used + measured > width && used > 0) {
      lines.push([]);
      used = 0;
    }
    if (measured > width) {
      for (const { segment } of graphemes.segment(text)) {
        const size = ctx.measureText(segment).width;
        if (used + size > width && used > 0) {
          lines.push([]);
          used = 0;
        }
        lines.at(-1)!.push({ ...run, text: segment });
        used += size;
      }
    } else {
      lines.at(-1)!.push({ ...run, text });
      used += measured;
    }
  };
  for (const run of runs) {
    assertText(run.text);
    for (const token of run.text.replaceAll("\t", "    ").split(/(\n|\s+)/u)) {
      if (token.includes("\n")) {
        for (let i = 0; i < (token.match(/\n/g)?.length ?? 0); i++) {
          lines.push([]);
          used = 0;
        }
      } else add(token, run);
    }
  }
  return lines;
}
function paragraphs(
  ctx: SKRSContext2D,
  items: readonly PresentationRichTextParagraph[],
  x: number,
  y: number,
  width: number,
  height: number,
  style: Style,
  gap = style.size * 0.4,
): number {
  if (width <= 0 || height <= 0) return y;
  ctx.save();
  clip(ctx, x, y, width, height);
  ctx.textBaseline = "top";
  let cursor = y,
    number = 0;
  for (const paragraph of items) {
    if (cursor >= y + height) break;
    number = paragraph.kind === "numbered" ? number + 1 : 0;
    const marker =
      paragraph.kind === "bullet" ? "• " : paragraph.kind === "numbered" ? `${number}. ` : "";
    const indent = marker ? style.size * 1.5 : 0;
    if (marker) {
      font(ctx, style);
      ctx.fillStyle = style.color;
      ctx.fillText(marker, x, cursor);
    }
    for (const line of lineTokens(ctx, paragraph.runs, width - indent, style)) {
      if (cursor >= y + height) break;
      let left = x + indent;
      for (const run of line) {
        font(ctx, style, run);
        ctx.fillStyle = style.color;
        ctx.fillText(run.text, left, cursor);
        const advance = ctx.measureText(run.text).width;
        if (run.href) {
          ctx.beginPath();
          ctx.moveTo(left, cursor + style.size + 1);
          ctx.lineTo(left + advance, cursor + style.size + 1);
          ctx.lineWidth = 1;
          ctx.strokeStyle = style.color;
          ctx.stroke();
        }
        left += advance;
      }
      cursor += style.size * style.leading;
    }
    cursor += gap;
  }
  ctx.restore();
  return cursor;
}
function text(
  ctx: SKRSContext2D,
  value: string,
  x: number,
  y: number,
  width: number,
  height: number,
  style: Style,
) {
  return paragraphs(
    ctx,
    value.split("\n").map((line) => ({ kind: "paragraph", runs: [{ text: line }] })),
    x,
    y,
    width,
    height,
    style,
    0,
  );
}
function centeredText(
  ctx: SKRSContext2D,
  value: string,
  x: number,
  y: number,
  width: number,
  height: number,
  style: Style,
) {
  const lines = lineTokens(ctx, [{ text: value }], width, style);
  const lineHeight = style.size * style.leading;
  ctx.save();
  clip(ctx, x, y, width, height);
  ctx.textBaseline = "top";
  ctx.fillStyle = style.color;
  lines.forEach((line, index) => {
    font(ctx, style);
    const label = line.map((run) => run.text).join("");
    const measured = ctx.measureText(label).width;
    ctx.fillText(
      label,
      x + (width - measured) / 2,
      y + (height - lines.length * lineHeight) / 2 + index * lineHeight,
    );
  });
  ctx.restore();
}
function drawImage(
  ctx: SKRSContext2D,
  image: Image,
  rect: { x: number; y: number; width: number; height: number },
  fit: "contain" | "cover" = "contain",
  position = { x: 50, y: 50 },
) {
  const scale =
    fit === "cover"
      ? Math.max(rect.width / image.width, rect.height / image.height)
      : Math.min(rect.width / image.width, rect.height / image.height);
  const width = image.width * scale,
    height = image.height * scale;
  ctx.save();
  clip(ctx, rect.x, rect.y, rect.width, rect.height);
  ctx.drawImage(
    image,
    rect.x + ((rect.width - width) * position.x) / 100,
    rect.y + ((rect.height - height) * position.y) / 100,
    width,
    height,
  );
  ctx.restore();
}
function pngWithoutMetadata(input: Buffer): Buffer {
  // Framing and dimensions were checked first. Do not let libpng expand untrusted metadata.
  const parts = [input.subarray(0, 8)];
  for (let offset = 8; offset + 12 <= input.length;) {
    const length = input.readUInt32BE(offset),
      kind = input.toString("ascii", offset + 4, offset + 8);
    if (["IHDR", "PLTE", "tRNS", "IDAT", "IEND"].includes(kind))
      parts.push(input.subarray(offset, offset + length + 12));
    else if (kind.charCodeAt(0) >= 65 && kind.charCodeAt(0) <= 90)
      throw new PresentationStaticExportError("EXPORT_MEDIA_UNAVAILABLE");
    offset += length + 12;
  }
  return Buffer.concat(parts);
}
async function imageAt(images: RenderImages, id: string): Promise<Image> {
  const key = id.toLowerCase();
  let cached = images.decoded.get(key);
  if (!cached) {
    const value = images.get(key);
    if (!value) throw new PresentationStaticExportError("EXPORT_MEDIA_UNAVAILABLE");
    cached = loadImage(value.bytes).then(
      (image) => {
        if (!image.width || !image.height)
          throw new PresentationStaticExportError("EXPORT_MEDIA_UNAVAILABLE");
        return image;
      },
      () => {
        throw new PresentationStaticExportError("EXPORT_MEDIA_UNAVAILABLE");
      },
    );
    images.decoded.set(key, cached);
  }
  return cached;
}

function endpoint(
  scene: Scene,
  value: Extract<PresentationSceneNode, { type: "connector" }>["from"],
) {
  const node = scene.nodes.find((node) => node.id === value.nodeId);
  if (!node || node.type === "connector") throw new PresentationStaticExportError("EXPORT_INVALID");
  const r = frame(node.frame);
  let dx = value.anchor === "left" ? -r.width / 2 : value.anchor === "right" ? r.width / 2 : 0,
    dy = value.anchor === "top" ? -r.height / 2 : value.anchor === "bottom" ? r.height / 2 : 0;
  const angle = ((node.rotation ?? 0) * Math.PI) / 180;
  [dx, dy] = [
    dx * Math.cos(angle) - dy * Math.sin(angle),
    dx * Math.sin(angle) + dy * Math.cos(angle),
  ];
  return { x: r.x + r.width / 2 + dx, y: r.y + r.height / 2 + dy };
}
function connector(
  ctx: SKRSContext2D,
  scene: Scene,
  node: Extract<PresentationSceneNode, { type: "connector" }>,
) {
  const from = endpoint(scene, node.from),
    to = endpoint(scene, node.to),
    angle = Math.atan2(to.y - from.y, to.x - from.x);
  ctx.save();
  ctx.strokeStyle = CANVAS_STROKE_COLORS[node.color];
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.translate(to.x, to.y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-7, -4);
  ctx.lineTo(-7, 4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
function drawTable(
  ctx: SKRSContext2D,
  headers: string[],
  rows: string[][],
  x: number,
  y: number,
  width: number,
  height: number,
  palette: Palette,
  fam: string,
  size = 20,
) {
  const cellWidth = width / headers.length;
  let cursor = y;
  for (const [index, row] of [headers, ...rows].entries()) {
    if (cursor >= y + height) break;
    const style = { size, family: fam, color: palette.text, leading: 1.35, bold: index === 0 };
    const rowHeight =
      Math.max(
        ...row.map(
          (value) => lineTokens(ctx, [{ text: value }], Math.max(1, cellWidth - 12), style).length,
        ),
      ) *
        size *
        1.35 +
      12;
    for (let column = 0; column < headers.length; column++) {
      if (index === 0) {
        ctx.fillStyle = palette.border;
        ctx.globalAlpha = 0.15;
        ctx.fillRect(x + column * cellWidth, cursor, cellWidth, rowHeight);
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = palette.border;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + column * cellWidth, cursor, cellWidth, rowHeight);
      text(
        ctx,
        row[column] ?? "",
        x + column * cellWidth + 6,
        cursor + 6,
        cellWidth - 12,
        rowHeight - 12,
        style,
      );
    }
    cursor += rowHeight;
  }
}
function drawChart(
  ctx: SKRSContext2D,
  node: Extract<Framed, { type: "chart" }>,
  width: number,
  height: number,
  palette: Palette,
  fam: string,
  pad: number,
) {
  let top = text(ctx, node.title, pad, pad, width - pad * 2, height - pad, {
    size: 22,
    family: fam,
    color: palette.text,
    leading: 1.3,
    bold: true,
  });
  top =
    text(ctx, node.summary, pad, top + 6, width - pad * 2, Math.max(0, height - top), {
      size: 20,
      family: fam,
      color: palette.text,
      leading: 1.35,
    }) + 8;
  const sideBySide = width >= 600,
    plotWidth = sideBySide ? (width - pad * 2 - 16) / 2 : width - pad * 2;
  ctx.save();
  ctx.translate(pad, top);
  ctx.scale(plotWidth / 640, plotWidth / 640);
  if (node.chartType === "pie") {
    const values = node.series[0]!.values,
      total = values.reduce((sum, value) => sum + value, 0);
    let angle = -Math.PI / 2;
    values.forEach((value, index) => {
      if (value <= 0) return;
      const portion = value / total,
        end = angle + portion * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(320, 140);
      ctx.arc(320, 140, 112, angle, end);
      ctx.closePath();
      ctx.fillStyle = chartColors[index % 4]!;
      ctx.fill();
      if (portion >= 0.035) {
        ctx.fillStyle = "#fff";
        ctx.font = "700 14px StaticCJK";
        ctx.textAlign = "center";
        ctx.fillText(
          String(index + 1),
          320 + Math.cos((angle + end) / 2) * 78,
          144 + Math.sin((angle + end) / 2) * 78,
        );
      }
      angle = end;
    });
  } else {
    const values = node.series.flatMap((series) => series.values),
      min = Math.min(0, ...values),
      max = Math.max(0, ...values) || (min === 0 ? 1 : 0),
      range = max - min;
    const y = (value: number) => 20 + ((max - value) / range) * 210,
      group = 560 / node.categories.length,
      x = (index: number) => 60 + group * (index + 0.5),
      zero = y(0);
    ctx.font = "11px StaticCJK";
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "right";
    for (let index = 0; index < 5; index++) {
      const value = min + (range * index) / 4;
      ctx.strokeStyle = palette.border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(60, y(value));
      ctx.lineTo(620, y(value));
      ctx.stroke();
      ctx.fillStyle = palette.text;
      ctx.fillText(String(Number(value.toPrecision(3))), 53, y(value) + 4);
    }
    ctx.strokeStyle = palette.text;
    ctx.beginPath();
    ctx.moveTo(60, zero);
    ctx.lineTo(620, zero);
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.font = "12px StaticCJK";
    node.categories.forEach((_, index) => ctx.fillText(String(index + 1), x(index), 253));
    node.series.forEach((series, index) => {
      ctx.strokeStyle = chartColors[index]!;
      ctx.fillStyle = chartColors[index]!;
      ctx.lineWidth = 3;
      ctx.setLineDash([[], [9, 4], [3, 3], [10, 3, 2, 3]][index]!);
      if (node.chartType === "bar")
        series.values.forEach((value, category) => {
          const width = (group * 0.78) / node.series.length;
          ctx.fillRect(
            x(category) - group * 0.39 + width * index,
            Math.min(y(value), zero),
            Math.max(0.1, width - 1),
            Math.abs(y(value) - zero),
          );
        });
      else {
        ctx.beginPath();
        series.values.forEach((value, category) => {
          if (category === 0) ctx.moveTo(x(category), y(value));
          else ctx.lineTo(x(category), y(value));
        });
        ctx.stroke();
        ctx.setLineDash([]);
        series.values.forEach((value, category) => {
          ctx.beginPath();
          ctx.arc(x(category), y(value), index + 3, 0, Math.PI * 2);
          ctx.fill();
        });
      }
    });
  }
  ctx.restore();
  let legendTop = top + (plotWidth * 270) / 640 + 8;
  const legend =
    node.chartType === "pie" ? node.categories : node.series.map((series) => series.name);
  legend.forEach((label, index) => {
    if (legendTop >= height) return;
    ctx.fillStyle = chartColors[index % 4]!;
    ctx.fillRect(pad, legendTop + 5, 14, 14);
    legendTop =
      text(ctx, `${index + 1}. ${label}`, pad + 22, legendTop, plotWidth - 22, height - legendTop, {
        size: 18,
        family: fam,
        color: palette.text,
        leading: 1.3,
      }) + 4;
  });
  const rows = node.categories.map((category, index) => [
    `${index + 1}. ${category}`,
    ...node.series.map((series) => String(series.values[index])),
  ]);
  drawTable(
    ctx,
    ["Category", ...node.series.map((series) => series.name)],
    rows,
    sideBySide ? pad + plotWidth + 16 : pad,
    sideBySide ? top : legendTop + 20,
    plotWidth,
    height - (sideBySide ? top : legendTop + 20),
    palette,
    fam,
    18,
  );
}
async function drawNode(
  ctx: SKRSContext2D,
  node: Framed,
  scene: Scene,
  images: RenderImages,
  palette: Palette,
) {
  const r = frame(node.frame),
    pad = scene.design ? (scene.design.spacing === "compact" ? 5 : 10) : 6,
    fam = family(scene.design?.font);
  ctx.save();
  ctx.translate(r.x + r.width / 2, r.y + r.height / 2);
  ctx.rotate(((node.rotation ?? 0) * Math.PI) / 180);
  ctx.translate(-r.width / 2, -r.height / 2);
  clip(ctx, 0, 0, r.width, r.height);
  if (node.type === "table" || node.type === "chart") {
    ctx.fillStyle = palette.background;
    ctx.fillRect(0, 0, r.width, r.height);
  }
  if (node.type === "text") {
    const title = node.role === "title",
      size = title ? 48 : 26,
      leading = scene.design
        ? scene.design.spacing === "compact"
          ? title
            ? 1.04
            : 1.2
          : title
            ? 1.12
            : 1.45
        : title
          ? 1.08
          : 1.35;
    const items =
      node.richText?.paragraphs ??
      node.text
        .split("\n")
        .map((value) => ({ kind: "paragraph" as const, runs: [{ text: value }] }));
    paragraphs(
      ctx,
      items,
      pad,
      pad,
      r.width - pad * 2,
      r.height - pad * 2,
      { size, family: fam, color: palette.text, leading, bold: title },
      node.richText ? size * (scene.design?.spacing === "compact" ? 0.25 : 0.55) : 0,
    );
  } else if (node.type === "image")
    drawImage(
      ctx,
      await imageAt(images, node.mediaId),
      { x: 0, y: 0, width: r.width, height: r.height },
      node.fit ?? "contain",
      node.focalPoint ?? { x: 50, y: 50 },
    );
  else if (node.type === "shape") {
    ctx.save();
    ctx.scale(r.width / 160, r.height / 90);
    ctx.fillStyle = CANVAS_FILL_COLORS[node.color];
    ctx.strokeStyle = CANVAS_STROKE_COLORS[node.color];
    ctx.lineWidth = 2;
    if (node.shape === "ellipse") {
      ctx.beginPath();
      ctx.ellipse(80, 45, 78, 43, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      const path =
        node.shape === "diamond" || node.shape === "parallelogram"
          ? canvasDiagramShapePath(node.shape, 160, 90)
          : canvasShapeVariantPath(node.shape, 160, 90);
      const shape = new Path2D(path);
      ctx.fill(shape);
      ctx.stroke(shape);
    }
    ctx.restore();
    centeredText(ctx, node.label, r.width * 0.075, 0, r.width * 0.85, r.height, {
      size: 22,
      family: fam,
      color: node.color === "black" ? "#fff" : "#102a43",
      leading: 1.25,
    });
  } else if (node.type === "table") {
    const top = text(ctx, node.caption, pad, pad, r.width - pad * 2, r.height - pad * 2, {
      size: 20,
      family: fam,
      color: palette.text,
      leading: 1.35,
      bold: true,
    });
    drawTable(
      ctx,
      node.headers,
      node.rows,
      pad,
      top + 8,
      r.width - pad * 2,
      r.height - top - 8,
      palette,
      fam,
    );
  } else if (node.type === "chart") drawChart(ctx, node, r.width, r.height, palette, fam, pad);
  else {
    ctx.fillStyle = palette.background;
    ctx.fillRect(0, 0, r.width, r.height);
    ctx.strokeStyle = palette.border;
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, r.width - 2, r.height - 2);
    centeredText(ctx, node.label, 8, 4, r.width - 16, r.height - 8, {
      size: 20,
      family: fam,
      color: palette.link,
      leading: 1.3,
      bold: true,
    });
  }
  ctx.restore();
}
async function drawPage(block: PresentationReviewBlock, images: RenderImages) {
  assertText("");
  const canvas = createCanvas(W, H),
    ctx = canvas.getContext("2d");
  ctx.textBaseline = "top";
  const motionDesign = block.design?.motionBackground ? block.design : undefined,
    inheritedPalette = motionDesign ? palettes[motionDesign.theme] : undefined;
  if (block.kind === "content" && block.scene) {
    // Inheritance is a rendering view; do not upgrade or rewrite the published scene.
    const scene =
        block.scene.design || !motionDesign
          ? block.scene
          : { ...block.scene, design: motionDesign },
      palette = scene.design
        ? palettes[scene.design.theme]
        : { background: "#fff", text: "#102a43", link: "#145da0", border: "#cbd5e1" };
    ctx.fillStyle = palette.background;
    ctx.fillRect(0, 0, W, H);
    if (scene.design?.motionBackground) paintPresentationMotionPoster(ctx, scene.design, W, H);
    for (const node of scene.nodes) if (node.type === "connector") connector(ctx, scene, node);
    for (const node of scene.nodes)
      if (node.type !== "connector") await drawNode(ctx, node, scene, images, palette);
  } else if (block.kind === "content") {
    if (inheritedPalette) ctx.fillStyle = inheritedPalette.background;
    else {
      const gradient = ctx.createLinearGradient(0, 0, W, H);
      gradient.addColorStop(0, "#f8fbff");
      gradient.addColorStop(1, "#fff");
      ctx.fillStyle = gradient;
    }
    ctx.fillRect(0, 0, W, H);
    if (motionDesign) paintPresentationMotionPoster(ctx, motionDesign, W, H);
    const frames = resolveContentSlideFrames(block);
    for (const element of block.textElements) {
      const r = frame(frames[element.id]!);
      text(ctx, element.text, r.x + 8, r.y + 6, r.width - 16, r.height - 12, {
        size: element.role === "title" ? 46 : 23,
        family: family(motionDesign?.font),
        color: inheritedPalette?.text ?? (element.role === "title" ? "#102a43" : "#334e68"),
        leading: element.role === "title" ? 1.04 : 1.4,
        bold: element.role === "title",
      });
    }
    if (block.mediaId)
      drawImage(ctx, await imageAt(images, block.mediaId), frame(contentSlideMediaFrame));
  } else {
    ctx.fillStyle = inheritedPalette?.background ?? "#f8fbff";
    ctx.fillRect(0, 0, W, H);
    if (motionDesign) paintPresentationMotionPoster(ctx, motionDesign, W, H);
    text(ctx, "Activity preview - no submissions or results", 64, 34, 1152, 40, {
      size: 20,
      family: family(motionDesign?.font),
      color: inheritedPalette?.link ?? "#52616f",
      leading: 1.3,
    });
    const end = text(ctx, block.question.prompt, 64, 96, 1152, 220, {
      size: 42,
      family: family(motionDesign?.font),
      color: inheritedPalette?.text ?? "#102a43",
      leading: 1.2,
      bold: true,
    });
    const choices = block.question.choices ?? [];
    if (choices.length)
      text(
        ctx,
        choices.map((choice, index) => `${index + 1}. ${choice.label}`).join("\n"),
        64,
        end + 24,
        block.question.mediaId ? 700 : 1152,
        340,
        {
          size: 26,
          family: family(motionDesign?.font),
          color: inheritedPalette?.text ?? "#102a43",
          leading: 1.5,
        },
      );
    else if (block.question.rating)
      text(
        ctx,
        `${block.question.rating.minLabel ?? ""}  ${block.question.rating.min} - ${block.question.rating.max}  ${block.question.rating.maxLabel ?? ""}`,
        64,
        end + 24,
        1152,
        120,
        {
          size: 26,
          family: family(motionDesign?.font),
          color: inheritedPalette?.text ?? "#102a43",
          leading: 1.4,
        },
      );
    else
      text(
        ctx,
        block.question.type === "numeric"
          ? `Numeric response${block.question.unit ? ` (${block.question.unit})` : ""}`
          : "Open response",
        64,
        end + 24,
        1152,
        120,
        {
          size: 26,
          family: family(motionDesign?.font),
          color: inheritedPalette?.text ?? "#52616f",
          leading: 1.4,
        },
      );
    if (block.question.mediaId)
      drawImage(ctx, await imageAt(images, block.question.mediaId), {
        x: 850,
        y: 330,
        width: 350,
        height: 330,
      });
  }
  const bytes = canvas.toBuffer("image/png");
  // Release the native bitmap before rendering the next page in this job.
  canvas.width = canvas.height = 1;
  return bytes;
}
const escape = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
const externalNotice = " (leaves this file; may require internet access)";
function richRunsHtml(runs: readonly PresentationRichTextRun[], offline = false) {
  return runs
    .map((run) => {
      let value = escape(run.text);
      if (run.bold) value = `<strong>${value}</strong>`;
      if (run.italic) value = `<em>${value}</em>`;
      if (run.href && isSafePresentationLink(run.href))
        value = `<a href="${escape(run.href)}" rel="noopener noreferrer" referrerpolicy="no-referrer">${value}${offline ? `<span class="external-notice" lang="en">${externalNotice}</span>` : ""}</a>`;
      return value;
    })
    .join("");
}
function richHtml(items: readonly PresentationRichTextParagraph[], offline = false) {
  let html = "",
    list: "bullet" | "numbered" | undefined;
  for (const item of items) {
    if (list && item.kind !== list) {
      html += list === "bullet" ? "</ul>" : "</ol>";
      list = undefined;
    }
    if (item.kind !== "paragraph" && !list) {
      list = item.kind;
      html += list === "bullet" ? "<ul>" : "<ol>";
    }
    const content = richRunsHtml(item.runs, offline);
    html += item.kind === "paragraph" ? `<p>${content}</p>` : `<li>${content}</li>`;
  }
  return html + (list ? (list === "bullet" ? "</ul>" : "</ol>") : "");
}
function tableHtml(caption: string, headers: string[], rows: string[][]) {
  return `<table><caption>${escape(caption)}</caption><thead><tr>${headers.map((value) => `<th scope="col">${escape(value)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((value) => `<td>${escape(value)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}
function nodeLabel(node: PresentationSceneNode | undefined): string {
  if (!node) return "Object";
  if (node.type === "text") return node.text || (node.role === "title" ? "Title" : "Text");
  if (node.type === "image") return node.altText || "Image";
  if (node.type === "table") return node.caption || "Table";
  if (node.type === "chart") return node.title || "Chart";
  return node.label || node.type;
}
function semanticBlock(
  block: PresentationReviewBlock,
  images: RenderImages,
  selected: Set<string>,
  offline = false,
) {
  const image = (id: string, alt: string | null) => {
    const value = images.get(id.toLowerCase())!;
    return `<figure><img src="data:${value.contentType};base64,${value.bytes.toString("base64")}" alt="${escape(alt ?? "")}" loading="lazy"></figure>`;
  };
  if (block.kind === "question" && offline)
    return `<h3>Question preview: readable only</h3><p>${escape(block.question.prompt)}</p>${block.question.choices ? `<ol>${block.question.choices.map((choice) => `<li>${escape(choice.label)}</li>`).join("")}</ol>` : ""}${block.question.rating ? `<p>${escape(block.question.rating.minLabel ?? "")} ${block.question.rating.min} - ${block.question.rating.max} ${escape(block.question.rating.maxLabel ?? "")}</p>` : ""}${block.question.unit ? `<p>Unit: ${escape(block.question.unit)}</p>` : ""}${block.question.mediaId ? image(block.question.mediaId, block.question.mediaAlt) : ""}<p>No responses, submissions, answer keys, scoring, live results or completion tracking are included.</p>`;
  if (block.kind === "question")
    return `<h3>Activity preview</h3><p>${escape(block.question.prompt)}</p>${block.question.choices ? `<ol>${block.question.choices.map((choice) => `<li>${escape(choice.label)}</li>`).join("")}</ol>` : ""}${block.question.rating ? `<p>${escape(block.question.rating.minLabel ?? "")} ${block.question.rating.min} - ${block.question.rating.max} ${escape(block.question.rating.maxLabel ?? "")}</p>` : ""}${block.question.unit ? `<p>Unit: ${escape(block.question.unit)}</p>` : ""}${block.question.mediaId ? image(block.question.mediaId, block.question.mediaAlt) : ""}<p>No answer key, submissions or live results are included.</p>`;
  if (!block.scene)
    return (
      [...block.textElements]
        .sort((left, right) => left.order - right.order)
        .map((element) =>
          element.role === "title"
            ? `<h3>${escape(element.text)}</h3>`
            : `<p>${escape(element.text)}</p>`,
        )
        .join("") + (block.mediaId ? image(block.mediaId, block.mediaAlt) : "")
    );
  const nodes = new Map(block.scene.nodes.map((node) => [node.id, node]));
  return block.scene.readingOrder
    .map((id) => {
      const node = nodes.get(id)!;
      switch (node.type) {
        case "text": {
          const language = node.lang ? ` lang="${escape(node.lang)}"` : "";
          return node.richText
            ? node.role === "title"
              ? `<h3${language}>${node.richText.paragraphs.map((item) => richRunsHtml(item.runs, offline)).join("<br>")}</h3>`
              : language
                ? `<div${language}>${richHtml(node.richText.paragraphs, offline)}</div>`
                : richHtml(node.richText.paragraphs, offline)
            : node.role === "title"
              ? `<h3${language}>${escape(node.text)}</h3>`
              : `<p${language}>${escape(node.text)}</p>`;
        }
        case "image":
          return image(node.mediaId, node.altText);
        case "shape":
          return `<p>Shape (${escape(node.shape)}): ${escape(node.label)}</p>`;
        case "connector":
          return `<p>${escape(node.label || "Connection")}: ${escape(nodeLabel(nodes.get(node.from.nodeId)))} → ${escape(nodeLabel(nodes.get(node.to.nodeId)))}</p>`;
        case "table":
          return tableHtml(node.caption, node.headers, node.rows);
        case "chart":
          return `<h3>${escape(node.title)}</h3><p>${escape(node.summary)}</p>${tableHtml(
            `${node.title} - chart data`,
            ["Category", ...node.series.map((series) => series.name)],
            node.categories.map((category, index) => [
              category,
              ...node.series.map((series) => String(series.values[index])),
            ]),
          )}`;
        case "reveal":
          return offline
            ? `<details><summary>${escape(node.label)}</summary><p class="local-disclosure">${node.scope === "broadcast" ? "Published broadcast reveal content is a local disclosure in this file; it does not broadcast or synchronize." : "Local disclosure in this file; it does not synchronize or save state."}</p><p>${escape(node.body)}</p></details>`
            : `<section><h3>${escape(node.label)}</h3><p>${escape(node.body)}</p></section>`;
        case "hotspot":
        case "dialog":
          return offline
            ? `<details><summary>${escape(node.label)}</summary><p class="local-disclosure">Local disclosure in this file; it does not synchronize or save state.</p><h3>${escape(node.detailTitle)}</h3><p>${escape(node.body)}</p></details>`
            : `<section><h3>${escape(node.label)}</h3><h4>${escape(node.detailTitle)}</h4><p>${escape(node.body)}</p></section>`;
        case "link":
          return isSafePresentationLink(node.href)
            ? `<p><a href="${escape(node.href)}" rel="noopener noreferrer" referrerpolicy="no-referrer">${escape(node.label)}${offline ? `<span class="external-notice" lang="en">${externalNotice}</span>` : ""}</a></p>`
            : `<p>${escape(node.label)}</p>`;
        case "navigation":
          return node.targetBlockId && selected.has(node.targetBlockId.toLowerCase())
            ? `<p><a href="#page-${escape(node.targetBlockId.toLowerCase())}">${escape(node.label)}</a></p>`
            : `<p>${escape(node.label)} (${offline ? "target unavailable in this file" : "navigation control flattened"})</p>`;
      }
    })
    .join("");
}
function readablePageTitle(block: PresentationReviewBlock, index: number) {
  if (block.kind === "question")
    return { text: block.question.prompt.trim() || `Page ${index + 1}` };
  const title = block.scene?.nodes.find((node) => node.type === "text" && node.role === "title");
  if (title?.type === "text" && title.text.trim())
    return { text: title.text.trim(), lang: title.lang };
  return {
    text:
      block.textElements.find((element) => element.role === "title")?.text.trim() ||
      `Page ${index + 1}`,
  };
}
async function offlineHtml(
  review: PresentationStaticRenderInput["review"],
  blocks: PresentationReviewBlock[],
  images: RenderImages,
): Promise<PresentationStaticRenderResult> {
  const selected = new Set(blocks.map((block) => block.id.toLowerCase()));
  const pages = new Map(
    blocks.map((block, index) => [
      block.id.toLowerCase(),
      { block, index, title: readablePageTitle(block, index) },
    ]),
  );
  const pageLink = (id: string, label?: string) => {
    const page = pages.get(id.toLowerCase());
    if (!page) return "";
    const title = page.title.lang
      ? `<span lang="${escape(page.title.lang)}">${escape(page.title.text)}</span>`
      : escape(page.title.text);
    return `<a href="#page-${escape(page.block.id.toLowerCase())}">${label === undefined ? `Page ${page.index + 1}: ${title}` : escape(label)}</a>`;
  };
  const sections = review.sections
    .map((section, index) => ({
      ...section,
      anchor: `section-${index + 1}`,
      blockIds: section.blockIds.filter((id) => selected.has(id.toLowerCase())),
    }))
    .filter((section) => section.blockIds.length);
  const parts = [
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'"><title>${escape(review.title)}</title><style>body{font:18px/1.6 system-ui,sans-serif;color:#172b4d;background:#fffdf7;margin:0 auto;max-width:1100px;padding:24px}h1,h2,h3,h4{line-height:1.25;overflow-wrap:anywhere}p,li,td,th,summary,caption{overflow-wrap:anywhere;white-space:pre-wrap}a{color:#174d8c}a:focus-visible,summary:focus-visible{outline:3px solid #174d8c;outline-offset:4px}img{max-width:100%;height:auto}.snapshot{width:100%;border:1px solid #a6b0ba}article{border-top:2px solid #a6b0ba;margin-top:32px;padding-top:16px}table{border-collapse:collapse;width:100%;margin:16px 0}caption{text-align:left;font-weight:bold}th,td{text-align:left;vertical-align:top;border:1px solid #a6b0ba;padding:8px}figure{margin:16px 0}details{border:1px solid #a6b0ba;padding:12px;margin:16px 0}summary{cursor:pointer;font-weight:bold}.local-disclosure,.external-notice{font-size:.9em}nav li{margin:8px 0}@media print{article{break-before:page}.page-navigation{display:none}}</style></head><body><header><h1>${escape(review.title)}</h1><p>${escape(offlineDisclosure)}</p><p>This interactive readable companion works offline: open a labeled disclosure to read its details, or follow page, section and index links within the file. Disclosures are local to this file, including public content originally authored for broadcast reveal. They do not broadcast, synchronize or save state.</p><p>Questions are readable previews only: no responses, submissions, answer keys, scoring, live results or completion tracking. Visual snapshots preserve authored frames and may clip text; complete readable content follows each snapshot. External links leave this file and may require internet access.</p></header><nav id="presentation-index" aria-label="Presentation index"><h2>Presentation index</h2>${sections.length ? `<h3>Sections</h3><ul>${sections.map((section) => `<li><a href="#${section.anchor}">${escape(section.title)}</a></li>`).join("")}</ul>` : ""}<h3>Pages</h3><ol>${blocks.map((block) => `<li>${pageLink(block.id)}</li>`).join("")}</ol></nav>${sections.length ? `<section aria-label="Presentation sections">${sections.map((section) => `<section id="${section.anchor}"><h2>${escape(section.title)}</h2><ul>${section.blockIds.map((id) => `<li>${pageLink(id)}</li>`).join("")}</ul></section>`).join("")}</section>` : ""}<main>`,
  ];
  let length = Buffer.byteLength(parts[0]!);
  if (length > limits.outputBytes) throw new PresentationStaticExportError("EXPORT_LIMIT");
  for (const [index, block] of blocks.entries()) {
    const png = await drawPage(block, images);
    const navigation = `<nav class="page-navigation" aria-label="Navigation for page ${index + 1}"><ul>${index ? `<li>${pageLink(blocks[index - 1]!.id, "Previous page")}</li>` : ""}${index + 1 < blocks.length ? `<li>${pageLink(blocks[index + 1]!.id, "Next page")}</li>` : ""}<li><a href="#presentation-index">Presentation index</a></li>${sections
      .filter((section) =>
        section.blockIds.some((id) => id.toLowerCase() === block.id.toLowerCase()),
      )
      .map(
        (section) => `<li><a href="#${section.anchor}">Section: ${escape(section.title)}</a></li>`,
      )
      .join("")}</ul></nav>`;
    const part = `<article id="page-${escape(block.id.toLowerCase())}"><h2>Page ${index + 1}</h2>${navigation}<img class="snapshot" src="data:image/png;base64,${png.toString("base64")}" alt="" aria-hidden="true"><section aria-label="Readable content for page ${index + 1}">${semanticBlock(block, images, selected, true)}</section></article>`;
    length += Buffer.byteLength(part);
    if (length > limits.outputBytes) throw new PresentationStaticExportError("EXPORT_LIMIT");
    parts.push(part);
  }
  parts.push("</main></body></html>");
  return {
    bytes: checkSize(Buffer.from(parts.join(""))),
    contentType: "text/html",
    extension: "html",
  };
}
async function prepare(input: PresentationStaticRenderInput) {
  const parsed = PresentationReviewSchema.safeParse(input.review);
  if (!parsed.success) throw new PresentationStaticExportError("EXPORT_INVALID");
  const review = parsed.data,
    blocks = input.blockId
      ? review.blocks.filter((block) => block.id.toLowerCase() === input.blockId!.toLowerCase())
      : review.blocks;
  if (
    !["pdf", "png", "html", "offline_html"].includes(input.format) ||
    new Set(review.blocks.map((block) => block.id.toLowerCase())).size !== review.blocks.length
  )
    throw new PresentationStaticExportError("EXPORT_INVALID");
  if (
    (input.format === "png" && !input.blockId) ||
    (input.format === "offline_html" && input.blockId !== undefined) ||
    !blocks.length
  )
    throw new PresentationStaticExportError("EXPORT_INVALID");
  if (
    blocks.length > limits.pages ||
    input.images.size > limits.images ||
    Buffer.byteLength(JSON.stringify(review)) > limits.inputBytes
  )
    throw new PresentationStaticExportError("EXPORT_LIMIT");
  const images = new Map() as RenderImages;
  images.decoded = new Map();
  let total = 0,
    pixels = 0;
  for (const [id, value] of input.images) {
    if (images.has(id.toLowerCase())) throw new PresentationStaticExportError("EXPORT_INVALID");
    total += value.bytes.byteLength;
    if (value.bytes.byteLength > limits.imageBytes || total > limits.imageTotalBytes)
      throw new PresentationStaticExportError("EXPORT_LIMIT");
    let dimensions: { width: number; height: number };
    try {
      dimensions = inspectPresentationVisualImage(value.bytes, value.contentType);
    } catch (error) {
      throw new PresentationStaticExportError(
        error && typeof error === "object" && "code" in error && error.code === "limit"
          ? "EXPORT_LIMIT"
          : "EXPORT_MEDIA_UNAVAILABLE",
      );
    }
    pixels += dimensions.width * dimensions.height;
    if (
      dimensions.width * dimensions.height > limits.imagePixels ||
      pixels > limits.imageTotalPixels
    )
      throw new PresentationStaticExportError("EXPORT_LIMIT");
    images.set(id.toLowerCase(), {
      ...value,
      bytes: value.contentType === "image/png" ? pngWithoutMetadata(value.bytes) : value.bytes,
    });
  }
  for (const block of blocks) {
    const media = block.kind === "question" ? block.question.mediaId : block.mediaId;
    if (media && !images.has(media.toLowerCase()))
      throw new PresentationStaticExportError("EXPORT_MEDIA_UNAVAILABLE");
    if (block.kind === "content")
      for (const node of block.scene?.nodes ?? [])
        if (node.type === "image" && !images.has(node.mediaId.toLowerCase()))
          throw new PresentationStaticExportError("EXPORT_MEDIA_UNAVAILABLE");
  }
  return { review, blocks, images };
}
export async function renderPresentationStaticCore(
  input: PresentationStaticRenderInput,
): Promise<PresentationStaticRenderResult> {
  const { review, blocks, images } = await prepare(input);
  if (input.format === "png")
    return {
      bytes: checkSize(await drawPage(blocks[0]!, images)),
      contentType: "image/png",
      extension: "png",
    };
  if (input.format === "offline_html") return offlineHtml(review, blocks, images);
  if (input.format === "html") {
    const selected = new Set(blocks.map((block) => block.id.toLowerCase()));
    const parts = [
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escape(review.title)}</title><style>body{font:18px/1.6 system-ui,sans-serif;color:#172b4d;background:#fffdf7;margin:0 auto;max-width:1100px;padding:24px}h1,h2,h3,h4{line-height:1.25}p,li,td,th{overflow-wrap:anywhere;white-space:pre-wrap}a{color:#174d8c}a:focus{outline:3px solid #174d8c}img{max-width:100%;height:auto}.snapshot{width:100%;border:1px solid #a6b0ba}article{border-top:2px solid #a6b0ba;margin-top:32px;padding-top:16px}table{border-collapse:collapse;width:100%;margin:16px 0}caption{text-align:left;font-weight:bold}th,td{text-align:left;vertical-align:top;border:1px solid #a6b0ba;padding:8px}figure{margin:16px 0}@media print{article{break-before:page}nav{display:none}}</style></head><body><header><h1>${escape(review.title)}</h1><p>${escape(disclosure)}</p><p>This HTML includes the complete public readable companion. PDF and PNG are flattened visual snapshots.</p></header><nav aria-label="Presentation sections"><h2>Sections</h2><ul>${review.sections
        .map((section) => {
          const target = section.blockIds.find((id) => selected.has(id.toLowerCase()));
          return target
            ? `<li><a href="#page-${escape(target.toLowerCase())}">${escape(section.title)}</a></li>`
            : "";
        })
        .join("")}</ul></nav><main>`,
    ];
    let length = Buffer.byteLength(parts[0]!);
    for (const [index, block] of blocks.entries()) {
      const png = await drawPage(block, images);
      const part = `<article id="page-${escape(block.id.toLowerCase())}"><h2>Page ${index + 1}</h2><img class="snapshot" src="data:image/png;base64,${png.toString("base64")}" alt="" aria-hidden="true"><section aria-label="Readable content for page ${index + 1}">${semanticBlock(block, images, selected)}</section></article>`;
      length += Buffer.byteLength(part);
      if (length > limits.outputBytes) throw new PresentationStaticExportError("EXPORT_LIMIT");
      parts.push(part);
    }
    parts.push("</main></body></html>");
    return {
      bytes: checkSize(Buffer.from(parts.join(""))),
      contentType: "text/html; charset=utf-8",
      extension: "html",
    };
  }
  const doc = new PDFDocument({
    autoFirstPage: false,
    size: [W, H],
    margin: 0,
    compress: true,
    pdfVersion: "1.7",
    info: {
      Title: review.title,
      Creator: "Polling Pops",
      Producer: "Polling Pops",
      Subject: disclosure,
    },
  });
  const chunks: Buffer[] = [];
  let size = 0;
  let outputError: Error | undefined;
  const completed = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > limits.outputBytes) {
        outputError = new PresentationStaticExportError("EXPORT_LIMIT");
        doc.destroy(outputError);
        return;
      }
      chunks.push(chunk);
    });
    doc.once("error", reject);
    doc.once("end", () => resolve(Buffer.concat(chunks)));
  });
  // Stream errors can occur while a later page is awaiting image work.
  void completed.catch(() => undefined);
  try {
    for (const block of blocks) {
      const png = await drawPage(block, images);
      if (outputError) throw outputError;
      doc.addPage({ size: [W, H], margin: 0 });
      doc.image(png, 0, 0, { width: W, height: H });
    }
    doc.end();
    return { bytes: checkSize(await completed), contentType: "application/pdf", extension: "pdf" };
  } catch (error) {
    doc.destroy();
    void completed.catch(() => undefined);
    throw error;
  }
}
