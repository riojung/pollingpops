/** SVG is accepted only as a small, reconstructed drawing and is uploaded as a PNG. */
const SVG_LIMITS = {
  bytes: 512_000,
  nodes: 2000,
  path: 64_000,
  dimension: 16_384,
  pixels: 4_000_000,
  side: 2048,
};
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const NUMBERS = /^[\d\s,+.eE-]+$/;
const TAGS = new Set([
  "g",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "path",
  "text",
  "tspan",
]);
const LENGTHS = new Set([
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "width",
  "height",
  "rx",
  "ry",
  "r",
  "cx",
  "cy",
  "stroke-width",
  "font-size",
  "dx",
  "dy",
]);
const COMMON = new Set([
  "fill",
  "stroke",
  "stroke-width",
  "opacity",
  "fill-opacity",
  "stroke-opacity",
  "stroke-linecap",
  "stroke-linejoin",
  "fill-rule",
  "transform",
]);
const TEXT = new Set([
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "text-anchor",
  "text-decoration",
  "x",
  "y",
  "dx",
  "dy",
]);
function invalid(): never {
  throw new Error("Unsupported or oversized SVG drawing");
}
function escape(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function decode(value: string) {
  if (/&(?!amp;|lt;|gt;|quot;|apos;)/.test(value)) invalid();
  return value.replace(
    /&(amp|lt|gt|quot|apos);/g,
    (_, entity: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[entity]!,
  );
}
function numeric(value: string, positive = false) {
  if (!NUMBER.test(value)) invalid();
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) > 100_000 || (positive && number <= 0))
    invalid();
  return number;
}
function attributes(source: string) {
  const result = new Map<string, string>();
  let remaining = source;
  while (remaining.trim()) {
    const match = /^\s+([a-zA-Z][a-zA-Z0-9-]*)\s*=\s*(?:"([^"<>]*)"|'([^'<>]*)')/.exec(remaining);
    if (!match || result.has(match[1]!)) invalid();
    result.set(match[1]!, decode(match[2] ?? match[3] ?? ""));
    remaining = remaining.slice(match[0].length);
  }
  return result;
}
function safeAttribute(tag: string, name: string, value: string) {
  if (value.length > SVG_LIMITS.path || /(?:url\s*\(|[<>]|javascript:|data:)/i.test(value))
    invalid();
  if (!(
    COMMON.has(name) ||
    LENGTHS.has(name) ||
    ((tag === "text" || tag === "tspan") && TEXT.has(name)) ||
    (tag === "path" && name === "d") ||
    ((tag === "polyline" || tag === "polygon") && name === "points")
  ))
    invalid();
  if (LENGTHS.has(name)) numeric(value);
  else if (name === "fill" || name === "stroke") {
    if (!/^(?:none|#[\da-f]{3,8}|[a-z]{1,24}|rgba?\([\d\s.,%]+\))$/i.test(value)) invalid();
  } else if (name.endsWith("opacity")) {
    if (numeric(value) < 0 || numeric(value) > 1) invalid();
  } else if (name === "d") {
    if (
      !value ||
      !/^[MmZzLlHhVvCcSsQqTtAa\d\s,.eE+-]+$/.test(value) ||
      (value.match(/[a-df-z]/gi)?.length ?? 0) > 8000
    )
      invalid();
    const numbers = value
      .replace(/[MmZzLlHhVvCcSsQqTtAa]/g, " ")
      .split(/[\s,]+/)
      .filter(Boolean);
    numbers.forEach((number) => numeric(number));
  } else if (name === "points") {
    if (!NUMBERS.test(value)) invalid();
    const points = value.trim().split(/[\s,]+/);
    if (points.length > 16_000 || points.length % 2) invalid();
    points.forEach((number) => numeric(number));
  } else if (name === "transform") {
    let remaining = value;
    while (remaining.trim()) {
      const match = /^\s*(translate|scale|rotate|matrix)\s*\(([^()]*)\)\s*/.exec(remaining);
      if (!match || !NUMBERS.test(match[2]!)) invalid();
      const values = match[2]!.trim().split(/[\s,]+/);
      const counts: Record<string, number[]> = {
        translate: [1, 2],
        scale: [1, 2],
        rotate: [1, 3],
        matrix: [6],
      };
      if (!counts[match[1]!]!.includes(values.length)) invalid();
      values.forEach((number) => numeric(number));
      remaining = remaining.slice(match[0].length);
    }
  } else {
    const choices: Record<string, string[]> = {
      "stroke-linecap": ["butt", "round", "square"],
      "stroke-linejoin": ["miter", "round", "bevel"],
      "fill-rule": ["nonzero", "evenodd"],
      "font-family": ["sans-serif", "serif", "monospace"],
      "font-weight": ["normal", "bold", "400", "700"],
      "font-style": ["normal", "italic"],
      "text-anchor": ["start", "middle", "end"],
      "text-decoration": ["none", "underline"],
    };
    if (!choices[name]?.includes(value)) invalid();
  }
}
export function sanitizeCanvasSvg(source: string): { svg: string; width: number; height: number } {
  if (new TextEncoder().encode(source).length > SVG_LIMITS.bytes || /<!|<\?/.test(source))
    invalid();
  const tokens = source.match(/<[^>]*>|[^<]+/g) ?? [];
  if (tokens.join("") !== source) invalid();
  const stack: string[] = [];
  const output: string[] = [];
  let nodes = 0,
    width = 0,
    height = 0,
    closed = false;
  for (const token of tokens) {
    if (!token.startsWith("<")) {
      if (!stack.length && token.trim()) invalid();
      if (token.trim() && !["text", "tspan"].includes(stack.at(-1) ?? "")) invalid();
      if (token.length > 10_000) invalid();
      output.push(escape(decode(token)));
      continue;
    }
    const end = /^<\/([a-z]+)\s*>$/.exec(token);
    if (end) {
      if (stack.pop() !== end[1]) invalid();
      if (!stack.length) closed = true;
      output.push(`</${end[1]}>`);
      continue;
    }
    const match = /^<([a-z]+)([\s\S]*?)(\/?)>$/.exec(token);
    if (!match || closed || ++nodes > SVG_LIMITS.nodes || stack.length > 32) invalid();
    const tag = match[1]!,
      attrs = attributes(match[2]!);
    if (!stack.length) {
      if (tag !== "svg" || nodes !== 1) invalid();
      for (const name of attrs.keys())
        if (!["xmlns", "width", "height", "viewBox"].includes(name) && !COMMON.has(name)) invalid();
      if (attrs.has("xmlns") && attrs.get("xmlns") !== "http://www.w3.org/2000/svg") invalid();
      const box = attrs
        .get("viewBox")
        ?.trim()
        .split(/[\s,]+/)
        .map((value) => numeric(value));
      if (box && (box.length !== 4 || box[2]! <= 0 || box[3]! <= 0)) invalid();
      width = attrs.has("width") ? numeric(attrs.get("width")!, true) : (box?.[2] ?? 0);
      height = attrs.has("height") ? numeric(attrs.get("height")!, true) : (box?.[3] ?? 0);
      if (!width || !height || width > SVG_LIMITS.dimension || height > SVG_LIMITS.dimension)
        invalid();
      output.push(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${box?.join(" ") ?? `0 0 ${width} ${height}`}"`,
      );
      for (const [name, value] of attrs)
        if (COMMON.has(name)) {
          safeAttribute("g", name, value);
          output.push(` ${name}="${escape(value)}"`);
        }
    } else {
      if (!TAGS.has(tag) || (["text", "tspan"].includes(stack.at(-1)!) && tag !== "tspan"))
        invalid();
      output.push(`<${tag}`);
      for (const [name, value] of attrs) {
        safeAttribute(tag, name, value);
        output.push(` ${name}="${escape(value)}"`);
      }
    }
    output.push(match[3] ? "/>" : ">");
    if (!match[3]) stack.push(tag);
    else if (tag === "svg") closed = true;
  }
  if (!closed || stack.length) invalid();
  return { svg: output.join(""), width, height };
}
export async function rasterizeCanvasSvg(file: File, signal: AbortSignal): Promise<File> {
  if (file.size > SVG_LIMITS.bytes || signal.aborted)
    throw new Error("SVG import cancelled or oversized");
  const drawing = sanitizeCanvasSvg(await file.text());
  if (signal.aborted) throw new Error("SVG import cancelled");
  const scale = Math.min(
    1,
    SVG_LIMITS.side / drawing.width,
    SVG_LIMITS.side / drawing.height,
    Math.sqrt(SVG_LIMITS.pixels / (drawing.width * drawing.height)),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(drawing.width * scale));
  canvas.height = Math.max(1, Math.round(drawing.height * scale));
  const url = URL.createObjectURL(new Blob([drawing.svg], { type: "image/svg+xml" }));
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        signal.removeEventListener("abort", abort);
        image.onload = null;
        image.onerror = null;
        if (error) reject(error);
        else resolve();
      };
      const abort = () => {
        image.src = "";
        finish(new Error("SVG import cancelled"));
      };
      image.onload = () => finish();
      image.onerror = () => finish(new Error("SVG image could not be decoded"));
      signal.addEventListener("abort", abort, { once: true });
      image.src = url;
      if (signal.aborted) abort();
    });
    if (signal.aborted) throw new Error("SVG import cancelled");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image conversion is unavailable");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      const abort = () => {
        signal.removeEventListener("abort", abort);
        reject(new Error("SVG import cancelled"));
      };
      signal.addEventListener("abort", abort, { once: true });
      canvas.toBlob((value) => {
        signal.removeEventListener("abort", abort);
        if (value) resolve(value);
        else reject(new Error("Image conversion failed"));
      }, "image/png");
      if (signal.aborted) abort();
    });
    if (signal.aborted) throw new Error("SVG import cancelled");
    return new File([blob], `${file.name.replace(/\.svg$/i, "") || "drawing"}.png`, {
      type: "image/png",
    });
  } finally {
    image.onload = null;
    image.onerror = null;
    URL.revokeObjectURL(url);
    canvas.width = canvas.height = 0;
  }
}
