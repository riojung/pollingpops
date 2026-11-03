import {
  CANVAS_MAX_OBJECTS,
  CANVAS_FILL_COLORS,
  CANVAS_STROKE_COLORS,
  canvasShapeVariantPath,
  canvasDiagramPort,
  canvasDiagramShapePath,
  canvasConnectorGeometry,
  canvasConnectorLabel,
  CanvasObjectSchema,
  type CanvasObject,
  type CanvasExportRegion,
} from "@openround/contracts";

export const CANVAS_EXPORT_MAX_BYTES = 20 * 1024 * 1024;
export const CANVAS_EXPORT_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const CANVAS_EXPORT_MAX_IMAGES = 25;
export const CANVAS_EXPORT_MAX_PIXELS = 4096;
export const CANVAS_EXPORT_TIMEOUT_MS = 15_000;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_WORLD = 100_000;
const fills = CANVAS_FILL_COLORS;
const inks = CANVAS_STROKE_COLORS;
const fontFamilies = {
  sans: "Arial, sans-serif",
  serif: "Georgia, serif",
  mono: "Courier New, monospace",
} as const;
export type CanvasExportErrorCode =
  | "INVALID_EXPORT"
  | "EXPORT_LIMIT"
  | "EXPORT_MEDIA_UNAVAILABLE"
  | "EXPORT_TIMEOUT"
  | "EXPORT_CANCELLED";
/** Deliberately contains no object content, image paths, or source identities. */
export class CanvasExportError extends Error {
  constructor(public readonly code: CanvasExportErrorCode) {
    super(code);
    this.name = "CanvasExportError";
  }
}
export interface CanvasExportImage {
  bytes: Uint8Array;
  mime: "image/jpeg" | "image/png" | "image/webp";
}
export interface CanvasSvgExport {
  svg: Buffer;
  width: number;
  height: number;
  region: CanvasExportRegion;
  mediaIds: string[];
}
type Point = { x: number; y: number };
type Connector = Extract<CanvasObject, { type: "connector" }>;

function xml(value: string) {
  // XML 1.0 characters only; this also removes lone UTF-16 surrogates.
  return Array.from(value)
    .filter((character) => {
      const code = character.codePointAt(0)!;
      return (
        code === 9 ||
        code === 10 ||
        code === 13 ||
        (code >= 32 && code <= 0xd7ff) ||
        (code >= 0xe000 && code <= 0xfffd) ||
        code >= 0x10000
      );
    })
    .join("")
    .replace(
      /[&<>"']/g,
      (character) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&apos;",
        })[character]!,
    );
}
function n(value: number) {
  return String(Math.round(value * 100_000) / 100_000);
}
function checkRegion(region: CanvasExportRegion) {
  if (
    ![region.x, region.y, region.width, region.height].every(Number.isFinite) ||
    Math.abs(region.x) > MAX_WORLD ||
    Math.abs(region.y) > MAX_WORLD ||
    region.width < 0.00001 ||
    region.height < 0.00001 ||
    region.width > MAX_WORLD ||
    region.height > MAX_WORLD
  )
    throw new CanvasExportError("EXPORT_LIMIT");
}
function endpoint(value: Connector["from"], objects: Map<string, CanvasObject>): Point | null {
  if (!value.objectId) return { x: value.x, y: value.y };
  const target = objects.get(value.objectId);
  // Never fall back to a stored point for a private, removed or missing object.
  if (!target) return null;
  return canvasDiagramPort(value, [...objects.values()]);
}
function pointBounds(points: Point[]): CanvasExportRegion {
  const x = Math.min(...points.map((point) => point.x));
  const y = Math.min(...points.map((point) => point.y));
  return {
    x: x - 2,
    y: y - 2,
    width: Math.max(1, Math.max(...points.map((point) => point.x)) - x) + 4,
    height: Math.max(1, Math.max(...points.map((point) => point.y)) - y) + 4,
  };
}
function bounds(
  object: CanvasObject,
  objects: Map<string, CanvasObject>,
): CanvasExportRegion | null {
  if (object.type === "connector") {
    const from = endpoint(object.from, objects),
      to = endpoint(object.to, objects);
    return from && to ? canvasConnectorGeometry(object, [...objects.values()]).bounds : null;
  }
  if (object.type === "pen") {
    const box = pointBounds(object.points.map(([x, y]) => ({ x, y })));
    const padding = Math.max(0, object.strokeWidth / 2 - 2);
    return {
      x: box.x - padding,
      y: box.y - padding,
      width: box.width + padding * 2,
      height: box.height + padding * 2,
    };
  }
  const angle = (object.rotation * Math.PI) / 180;
  const width =
    Math.abs(object.width * Math.cos(angle)) + Math.abs(object.height * Math.sin(angle));
  const height =
    Math.abs(object.width * Math.sin(angle)) + Math.abs(object.height * Math.cos(angle));
  return {
    x: object.x + (object.width - width) / 2 - object.strokeWidth / 2,
    y: object.y + (object.height - height) / 2 - object.strokeWidth / 2,
    width: width + object.strokeWidth,
    height: height + object.strokeWidth,
  };
}
function intersects(a: CanvasExportRegion, b: CanvasExportRegion) {
  return (
    a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y
  );
}
function fit(regions: CanvasExportRegion[]): CanvasExportRegion {
  if (!regions.length) return { x: 0, y: 0, width: 800, height: 600 };
  const x = Math.min(...regions.map((region) => region.x));
  const y = Math.min(...regions.map((region) => region.y));
  return {
    x,
    y,
    width: Math.max(...regions.map((region) => region.x + region.width)) - x,
    height: Math.max(...regions.map((region) => region.y + region.height)) - y,
  };
}
function nativeImage(bytes: Buffer, mime: string) {
  if (mime === "image/png")
    return (
      bytes.length >= 24 &&
      bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      bytes.toString("ascii", 12, 16) === "IHDR"
    );
  if (mime === "image/jpeg")
    return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return (
    mime === "image/webp" &&
    bytes.length >= 16 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  );
}
function textLines(value: string, width: number, fontSize: number) {
  const columns = Math.max(1, Math.floor(width / (fontSize * 0.5)));
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .flatMap((line) => {
      const characters = Array.from(line);
      if (!characters.length) return [""];
      const result: string[] = [];
      for (let start = 0; start < characters.length; start += columns)
        result.push(characters.slice(start, start + columns).join(""));
      return result;
    });
}

/**
 * Render only the supplied current authorized scene. The caller owns board/idea/media
 * authorization, clean-scan checks and final reauthorization after this asynchronous call.
 * This helper cannot discover other objects or fetch URLs/files. Idea refs must carry an
 * approved projected `idea`; no source board, author metadata or credentials are rendered.
 */
export async function renderCanvasSvg(input: {
  objects: readonly CanvasObject[];
  region: CanvasExportRegion | null;
  title?: string;
  background?: "white" | "transparent";
  loadImage: (mediaId: string, signal: AbortSignal) => Promise<CanvasExportImage>;
  signal?: AbortSignal;
}): Promise<CanvasSvgExport> {
  if (input.signal?.aborted) throw new CanvasExportError("EXPORT_CANCELLED");
  if (
    input.objects.length > CANVAS_MAX_OBJECTS ||
    (input.title?.length ?? 0) > 160 ||
    (input.background !== undefined && !["white", "transparent"].includes(input.background))
  )
    throw new CanvasExportError("INVALID_EXPORT");
  // Parse/copy before awaiting media so mutable caller state cannot change the rendered scene.
  const parsed = input.objects.map((object) => CanvasObjectSchema.safeParse(object));
  if (parsed.some((result) => !result.success)) throw new CanvasExportError("INVALID_EXPORT");
  const scene = parsed
    .map((result) => result.data!)
    .filter(
      (object) =>
        object.type !== "idea_ref" ||
        (object.idea?.id === object.ideaId && object.idea.status === "approved"),
    );
  if (new Set(scene.map((object) => object.id)).size !== scene.length)
    throw new CanvasExportError("INVALID_EXPORT");
  if (
    scene.reduce(
      (count, object) =>
        count + 1 + (object.type === "idea_ref" ? (object.idea?.canvas?.objects.length ?? 0) : 0),
      0,
    ) > CANVAS_MAX_OBJECTS
  )
    throw new CanvasExportError("EXPORT_LIMIT");
  const byId = new Map(scene.map((object) => [object.id, object]));
  // An omitted connector must not remain a usable endpoint for another connector.
  for (let pass = 0; pass < scene.length; pass++) {
    let removed = false;
    for (const object of byId.values()) {
      if (
        object.type === "connector" &&
        (!endpoint(object.from, byId) || !endpoint(object.to, byId))
      ) {
        byId.delete(object.id);
        removed = true;
      }
    }
    if (!removed) break;
  }
  const items = [...byId.values()]
    .map((object) => ({ object, bounds: bounds(object, byId) }))
    .filter(
      (item): item is { object: CanvasObject; bounds: CanvasExportRegion } => item.bounds !== null,
    );
  const region = input.region ? { ...input.region } : fit(items.map((item) => item.bounds));
  checkRegion(region);
  const scale = Math.min(
    1,
    CANVAS_EXPORT_MAX_PIXELS / region.width,
    CANVAS_EXPORT_MAX_PIXELS / region.height,
  );
  const width = Math.max(1, Math.min(CANVAS_EXPORT_MAX_PIXELS, Math.ceil(region.width * scale)));
  const height = Math.max(1, Math.min(CANVAS_EXPORT_MAX_PIXELS, Math.ceil(region.height * scale)));
  const visible = items
    .filter((item) => intersects(item.bounds, region))
    .map((item) => item.object)
    .sort(
      (a, b) =>
        a.zIndex - b.zIndex ||
        (a.type === "frame" ? -1 : 0) - (b.type === "frame" ? -1 : 0) ||
        a.id.localeCompare(b.id),
    );
  for (const object of visible) {
    if (object.type !== "idea_ref" || !object.idea?.canvas) continue;
    const authorizedImages = new Set((object.idea.attachments ?? []).map((item) => item.mediaId));
    if (
      object.idea.canvas.objects.some(
        (item) => item.type === "image" && !authorizedImages.has(item.mediaId),
      )
    )
      throw new CanvasExportError("INVALID_EXPORT");
  }
  const mediaIds = visible.flatMap((object) =>
    object.type === "image"
      ? [object.mediaId]
      : object.type === "idea_ref"
        ? object.idea!.canvas
          ? object.idea!.canvas.objects.flatMap((item) =>
              item.type === "image" ? [item.mediaId] : [],
            )
          : (object.idea!.attachments ?? []).map((attachment) => attachment.mediaId)
        : [],
  );
  if (mediaIds.length > CANVAS_EXPORT_MAX_IMAGES) throw new CanvasExportError("EXPORT_LIMIT");
  const controller = new AbortController();
  let stopped: CanvasExportError | undefined;
  let rejectStop: (error: CanvasExportError) => void = () => undefined;
  const stopPromise = new Promise<never>((_resolve, reject) => {
    rejectStop = reject;
  });
  const stop = (code: "EXPORT_CANCELLED" | "EXPORT_TIMEOUT") => {
    stopped = new CanvasExportError(code);
    controller.abort();
    rejectStop(stopped);
  };
  const cancelled = () => stop("EXPORT_CANCELLED");
  input.signal?.addEventListener("abort", cancelled, { once: true });
  const timer = setTimeout(() => stop("EXPORT_TIMEOUT"), CANVAS_EXPORT_TIMEOUT_MS);
  const images = new Map<string, string>();
  let imageBytes = 0,
    textBytes = 0,
    outputBytes = 0;
  const parts: string[] = [];
  function append(value: string) {
    if (stopped) throw stopped;
    outputBytes += Buffer.byteLength(value);
    if (outputBytes > CANVAS_EXPORT_MAX_BYTES) throw new CanvasExportError("EXPORT_LIMIT");
    parts.push(value);
  }
  function text(
    value: string,
    x: number,
    y: number,
    availableWidth: number,
    availableHeight: number,
    object: CanvasObject,
  ) {
    textBytes += Buffer.byteLength(value);
    if (textBytes > MAX_TEXT_BYTES) throw new CanvasExportError("EXPORT_LIMIT");
    const lineHeight = object.fontSize * 1.25;
    const lines = textLines(value, availableWidth, object.fontSize).slice(
      0,
      Math.max(0, Math.floor(availableHeight / lineHeight)),
    );
    const anchor =
      object.textAlign === "center" ? "middle" : object.textAlign === "right" ? "end" : "start";
    const textX =
      x +
      (object.textAlign === "center"
        ? availableWidth / 2
        : object.textAlign === "right"
          ? availableWidth
          : 0);
    const ink =
      object.type === "text"
        ? inks[object.color]
        : object.color === "black"
          ? "#ffffff"
          : "#202938";
    append(
      `<text x="${n(textX)}" y="${n(y)}" text-anchor="${anchor}" font-family="${fontFamilies[object.fontFamily]}" font-size="${n(object.fontSize)}" font-weight="${object.fontWeight}" font-style="${object.fontStyle}" text-decoration="${object.textDecoration}" fill="${ink}" xml:space="preserve">`,
    );
    lines.forEach((line, index) =>
      append(`<tspan x="${n(textX)}" dy="${index ? n(lineHeight) : 0}">${xml(line)}</tspan>`),
    );
    append("</text>");
  }
  function image(mediaId: string, alt: string, x: number, y: number, w: number, h: number) {
    append(
      `<image x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" preserveAspectRatio="xMidYMid meet" href="${images.get(mediaId)!}"><title>${xml(alt)}</title></image>`,
    );
  }
  try {
    for (const mediaId of new Set(mediaIds)) {
      let loaded: CanvasExportImage;
      try {
        loaded = await Promise.race([input.loadImage(mediaId, controller.signal), stopPromise]);
      } catch (error) {
        if (stopped) throw stopped;
        if (error instanceof CanvasExportError) throw error;
        throw new CanvasExportError("EXPORT_MEDIA_UNAVAILABLE");
      }
      if (stopped) throw stopped;
      if (!(loaded?.bytes instanceof Uint8Array))
        throw new CanvasExportError("EXPORT_MEDIA_UNAVAILABLE");
      if (!loaded.bytes.byteLength || loaded.bytes.byteLength > CANVAS_EXPORT_MAX_IMAGE_BYTES)
        throw new CanvasExportError("EXPORT_LIMIT");
      const bytes = Buffer.from(loaded.bytes);
      imageBytes += bytes.length;
      if (imageBytes > CANVAS_EXPORT_MAX_BYTES) throw new CanvasExportError("EXPORT_LIMIT");
      if (!nativeImage(bytes, loaded.mime)) throw new CanvasExportError("EXPORT_MEDIA_UNAVAILABLE");
      images.set(mediaId, `data:${loaded.mime};base64,${bytes.toString("base64")}`);
    }
    append(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${n(region.x)} ${n(region.y)} ${n(region.width)} ${n(region.height)}">`,
    );
    if (input.title) append(`<title>${xml(input.title)}</title>`);
    append(
      `<defs><clipPath id="export-region"><rect x="${n(region.x)}" y="${n(region.y)}" width="${n(region.width)}" height="${n(region.height)}"/></clipPath></defs>`,
    );
    for (const color of ["neutral", ...Object.keys(inks)] as Array<"neutral" | keyof typeof inks>) {
      const id = color === "neutral" ? "export-arrow" : `export-arrow-${color}`;
      const ink = color === "neutral" ? "#667085" : inks[color];
      append(
        `<defs><marker id="${id}" viewBox="0 0 10 10" markerWidth="7" markerHeight="7" refX="9" refY="5" orient="auto-start-reverse" markerUnits="strokeWidth"><path d="M0 0L10 5L0 10Z" fill="${ink}"/></marker></defs>`,
      );
    }
    if (input.background !== "transparent")
      append(
        `<rect x="${n(region.x)}" y="${n(region.y)}" width="${n(region.width)}" height="${n(region.height)}" fill="#ffffff"/>`,
      );
    append('<g clip-path="url(#export-region)">');
    let objectIndex = 0;
    function renderObject(object: CanvasObject, objectsById: Map<string, CanvasObject>) {
      const index = objectIndex++;
      if (object.type === "connector") {
        const geometry = canvasConnectorGeometry(object, [...objectsById.values()]);
        const path = geometry.points
          .map((point, index) => `${index ? "L" : "M"}${n(point.x)} ${n(point.y)}`)
          .join(" ");
        const ink = object.lineColor === "neutral" ? "#667085" : inks[object.lineColor];
        const marker =
          object.lineColor === "neutral" ? "export-arrow" : `export-arrow-${object.lineColor}`;
        append(
          `<g opacity="${n(object.opacity)}"><title>${xml(object.text)}</title><path d="${path}" fill="none" stroke="${ink}" stroke-width="${n(object.strokeWidth)}"${object.lineStyle === "dashed" ? ' stroke-dasharray="8 6"' : ""}${object.startMarker === "arrow" ? ` marker-start="url(#${marker})"` : ""}${object.endMarker === "arrow" ? ` marker-end="url(#${marker})"` : ""}/>`,
        );
        const label = canvasConnectorLabel(object.text, geometry.label, object.fontSize);
        if (label) {
          append(
            `<rect x="${n(label.x)}" y="${n(label.y)}" width="${n(label.width)}" height="${n(label.height)}" rx="4" fill="#ffffff" stroke="#cdd4df"/>`,
          );
          append(
            `<text fill="#202938" font-family="${fontFamilies[object.fontFamily]}" font-size="${n(object.fontSize)}" font-weight="${object.fontWeight}" font-style="${object.fontStyle}" text-decoration="${object.textDecoration}" text-anchor="${object.textAlign === "center" ? "middle" : object.textAlign === "right" ? "end" : "start"}" xml:space="preserve">`,
          );
          label.lines.forEach((line, lineIndex) =>
            append(
              `<tspan x="${n(label.x + (object.textAlign === "center" ? label.width / 2 : object.textAlign === "right" ? label.width - 8 : 8))}" y="${n(label.y + 6 + object.fontSize + (lineIndex * 18 * object.fontSize) / 13)}">${xml(line)}</tspan>`,
            ),
          );
          append("</text>");
        }
        append("</g>");
        return;
      }
      if (object.type === "pen") {
        append(
          `<polyline points="${object.points.map(([x, y]) => `${n(x)},${n(y)}`).join(" ")}" fill="none" stroke="${inks[object.color]}" stroke-width="${n(object.strokeWidth)}" opacity="${n(object.opacity)}" stroke-linecap="round" stroke-linejoin="round"/>`,
        );
        return;
      }
      append(
        `<g opacity="${n(object.opacity)}" transform="translate(${n(object.x)} ${n(object.y)}) rotate(${n(object.rotation)} ${n(object.width / 2)} ${n(object.height / 2)})">`,
      );
      if (object.type === "idea_ref" && object.idea?.canvas) {
        const canvas = object.idea.canvas;
        const contents = canvas.objects.map((item) =>
          CanvasObjectSchema.parse({ ...item, version: 1, visibility: "published" }),
        );
        const local = new Map(contents.map((item) => [item.id, item]));
        // Match the fitted native preview, including its protected-reference inset.
        const availableWidth = Math.max(1, object.width - 4);
        const availableHeight = Math.max(1, object.height - 4);
        const zoom = Math.min(availableWidth / canvas.width, availableHeight / canvas.height);
        const x = 2 + (availableWidth - canvas.width * zoom) / 2;
        const y = 2 + (availableHeight - canvas.height * zoom) / 2;
        append(
          `<title>${xml(object.idea.body ?? "")}</title><defs><clipPath id="export-object-${index}"><rect x="2" y="2" width="${n(availableWidth)}" height="${n(availableHeight)}"/></clipPath></defs><g clip-path="url(#export-object-${index})"><g transform="translate(${n(x)} ${n(y)}) rotate(0 0 0)"><g transform="scale(${n(zoom)} ${n(zoom)})">`,
        );
        contents
          .sort(
            (a, b) =>
              a.zIndex - b.zIndex ||
              (a.type === "frame" ? -1 : 0) - (b.type === "frame" ? -1 : 0) ||
              a.id.localeCompare(b.id),
          )
          .forEach((item) => renderObject(item, local));
        append("</g></g></g></g>");
        return;
      }
      const fill = object.type === "frame" || object.type === "text" ? "none" : fills[object.color];
      const stroke = ["rect", "ellipse", "diamond", "parallelogram"].includes(object.type)
        ? inks[object.color]
        : "#89919d";
      if (object.type === "rect")
        append(
          `<path d="${canvasShapeVariantPath(object.shapeVariant, object.width, object.height)}" fill="${fill}" stroke="${stroke}" stroke-width="${n(object.strokeWidth)}"/>`,
        );
      else if (object.type === "ellipse")
        append(
          `<ellipse cx="${n(object.width / 2)}" cy="${n(object.height / 2)}" rx="${n(object.width / 2)}" ry="${n(object.height / 2)}" fill="${fill}" stroke="${stroke}" stroke-width="${n(object.strokeWidth)}"/>`,
        );
      else if (object.type === "diamond" || object.type === "parallelogram")
        append(
          `<path d="${canvasDiagramShapePath(object.type, object.width, object.height)}" fill="${fill}" stroke="${stroke}" stroke-width="${n(object.strokeWidth)}"/>`,
        );
      else
        append(
          `<rect width="${n(object.width)}" height="${n(object.height)}" rx="${object.type === "sticky" ? 3 : 10}" fill="${fill}" stroke="${object.type === "text" ? "none" : stroke}" stroke-width="${n(object.strokeWidth)}"${object.type === "frame" ? ' stroke-dasharray="7 5"' : ""}/>`,
        );
      append(
        `<defs><clipPath id="export-object-${index}"><rect width="${n(object.width)}" height="${n(object.height)}"/></clipPath></defs><g clip-path="url(#export-object-${index})">`,
      );
      if (object.type === "image")
        image(object.mediaId, object.altText, 0, 0, object.width, object.height);
      else if (object.type === "idea_ref") {
        const attachments = object.idea!.attachments ?? [];
        const imageHeight = attachments.length ? Math.max(1, object.height * 0.4) : 0;
        text(
          object.idea!.body ?? "",
          10,
          26,
          Math.max(1, object.width - 20),
          object.height - imageHeight - 20,
          object,
        );
        attachments.forEach((attachment, attachmentIndex) =>
          image(
            attachment.mediaId,
            attachment.alt,
            10 + (attachmentIndex * (object.width - 20)) / attachments.length,
            object.height - imageHeight,
            Math.max(1, (object.width - 20) / attachments.length),
            imageHeight,
          ),
        );
      } else {
        const label =
          object.type === "link"
            ? [object.text, object.url].filter(Boolean).join("\n")
            : object.text;
        const insetX =
          object.type === "diamond"
            ? object.width * 0.25
            : object.type === "parallelogram"
              ? object.width * 0.2
              : 10;
        const insetY = object.type === "diamond" ? object.height * 0.25 : 10;
        text(
          label,
          insetX,
          insetY + object.fontSize,
          Math.max(1, object.width - insetX * 2),
          object.type === "frame"
            ? Math.max(28, object.fontSize * 1.25)
            : object.height - insetY * 2,
          object,
        );
      }
      append("</g></g>");
    }
    visible.forEach((object) => renderObject(object, byId));
    append("</g></svg>");
    return {
      svg: Buffer.from(parts.join("")),
      width,
      height,
      region,
      mediaIds: [...new Set(mediaIds)],
    };
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", cancelled);
    controller.abort();
  }
}
