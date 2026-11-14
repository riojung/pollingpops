import type { PresentationSceneFrame, PresentationSceneNode } from "@openround/contracts";
import type { PresentationDesignSlideCopy } from "./presentation-designs";

type Text = Extract<PresentationSceneNode, { type: "text" }>;
type Shape = Extract<PresentationSceneNode, { type: "shape" }>;
type Box = readonly [number, number, number, number];
type Ink = NonNullable<Text["typography"]>["color"];
type Fill = NonNullable<Shape["appearance"]>["fill"];
type Font = NonNullable<Text["typography"]>["font"];
const bounds = ([x, y, width, height]: Box): PresentationSceneFrame => ({ x, y, width, height });

/** Small native primitives keep every collection editable and make new collections additive. */
export function createDesignComposer(
  copy: PresentationDesignSlideCopy,
  createId: () => string,
  padding = 0,
) {
  const nodes: PresentationSceneNode[] = [];
  const text = (
    value: string | undefined,
    box: Box,
    size = 24,
    options: Partial<NonNullable<Text["typography"]>> & { title?: boolean } = {},
  ) => {
    if (!value?.trim()) return;
    const { title, ...typography } = options;
    const leading = typography.leading ?? 1.15;
    const font = typography.font ?? "sans";
    // A monospaced space is a full character cell. Reserve it when fitting the new
    // collections and existing-content reflows; zero-inset legacy recipes stay stable.
    const spaceWidth = padding > 0 && font === "mono" ? 0.63 : 0.3;
    const unitWidth = (word: string) =>
      Array.from(word).reduce(
        (width, character) =>
          width +
          (/[\u2e80-\uffef]/u.test(character)
            ? 1.03
            : font === "mono"
              ? 0.63
              : /[MW@%]/u.test(character)
                ? 0.84
                : /[A-Z]/u.test(character)
                  ? 0.64
                  : 0.53),
        0,
      );
    const lineCount = (fontSize: number) => {
      const capacity = Math.max(1, box[2] * 12.8 - 2 * padding) / fontSize;
      return value.split("\n").reduce((total, paragraph) => {
        let lines = 1;
        let used = 0;
        for (const word of paragraph.split(/\s+/u)) {
          const width = unitWidth(word);
          if (used && used + spaceWidth + width > capacity) {
            lines += 1;
            used = 0;
          }
          if (width > capacity) {
            lines += Math.ceil(width / capacity) - 1;
            used = width % capacity;
          } else used += (used ? spaceWidth : 0) + width;
        }
        return total + lines;
      }, 0);
    };
    // Fit localized sample text and long caller copy inside its own editable box. No wording
    // is trimmed, and every family retains its authored maximum type size and proportions.
    let fitted = size;
    while (
      fitted > 18 &&
      lineCount(fitted) * fitted * leading > Math.max(1, box[3] * 7.2 - 2 * padding)
    )
      fitted -= 1;
    nodes.push({
      id: createId(),
      type: "text",
      role: title ? "title" : "body",
      text: value,
      frame: bounds(box),
      typography: { size: fitted, weight: 400, leading, font, color: "text", ...typography },
    });
    // Callers applying a composition to authored content must be able to reject a box
    // that still overflows at the minimum size. Allow one authored pixel for rounding.
    return lineCount(fitted) * fitted * leading <= Math.max(1, box[3] * 7.2 - 2 * padding) + 1;
  };
  const shape = (
    box: Box,
    fill: Fill = "accent",
    variant: Shape["shape"] = "rectangle",
    stroke: NonNullable<Shape["appearance"]>["stroke"] = "none",
    rotation?: number,
  ) => {
    nodes.push({
      id: createId(),
      type: "shape",
      shape: variant,
      color: "sky",
      label: "",
      decorative: true,
      frame: bounds(box),
      appearance: { fill, stroke, strokeWidth: stroke === "none" ? 0 : 1 },
      ...(rotation === undefined ? {} : { rotation }),
    });
  };
  const title = (
    box: Box,
    size: number,
    font: Font = "sans",
    color: Ink = "text",
    weight: NonNullable<Text["typography"]>["weight"] = 700,
    align: NonNullable<Text["typography"]>["align"] = "left",
  ) => {
    // Long caller-authored titles remain intact; compact them without changing their wording.
    const fitted =
      copy.title.length > 65
        ? Math.min(size, 56)
        : copy.title.length > 42
          ? Math.min(size, 70)
          : size;
    text(copy.title, box, fitted, { title: true, font, color, weight, align, leading: 1.02 });
  };
  const eyebrow = (
    box: Box,
    color: Ink = "accent",
    align: NonNullable<Text["typography"]>["align"] = "left",
  ) => text(copy.eyebrow, box, 16, { color, align, weight: 600, leading: 1.1 });
  const body = (box: Box, size = 25, color: Ink = "text", font: Font = "sans") =>
    text(copy.body, box, size, { color, font, leading: 1.35 });
  const folio = (number: string, box: Box = [88, 91, 6, 5], color: Ink = "muted") =>
    text(number, box, 14, { color, font: "mono", align: "right" });
  const placeholder = (box: Box, round = false) => {
    nodes.push({
      id: createId(),
      type: "shape",
      shape: round ? "rounded_rectangle" : "rectangle",
      color: "sky",
      label: copy.imageLabel ?? copy.title,
      frame: bounds(box),
      appearance: { fill: "surface", stroke: "muted", strokeWidth: 1 },
    });
  };
  const split = (
    left: Box,
    right: Box,
    color: Ink = "text",
    font: Font = "sans",
    size = 24,
    rightColor: Ink = color,
  ) => {
    const column = (box: Box, heading: string | undefined, value: string, color: Ink) => {
      const [x, y, w, h] = box;
      if (heading) text(heading, [x, y, w, 11], size + 5, { weight: 600, font, color });
      text(value, [x, y + (heading ? 14 : 0), w, h - (heading ? 14 : 0)], size, {
        color,
        font,
        leading: 1.35,
      });
    };
    column(left, copy.leftTitle, copy.leftBody ?? copy.body, color);
    column(right, copy.rightTitle, copy.rightBody ?? copy.body, rightColor);
  };
  const table = (box: Box) => {
    nodes.push({
      id: createId(),
      type: "table",
      frame: bounds(box),
      caption: copy.dataCaption ?? copy.body,
      headers: [
        ...(copy.dataHeaders ?? [copy.leftTitle ?? copy.title, copy.rightTitle ?? copy.title]),
      ],
      rows: (
        copy.dataRows ?? [
          [copy.leftBody ?? copy.body, "24"],
          [copy.rightBody ?? copy.body, "36"],
        ]
      ).map((row) => [...row]),
    });
  };
  const metric = (box: Box, color: Ink = "accent", labelColor: Ink = "muted") => {
    const [x, y, w, h] = box;
    const lastRow = copy.dataRows?.at(-1);
    if (lastRow) {
      text(lastRow[1], [x, y, w, h * 0.65], 92, { color, weight: 700, leading: 1 });
      text(lastRow[0], [x, y + h * 0.72, w, h * 0.28], 20, { color: labelColor });
    } else text(copy.eyebrow, box, 30, { color, weight: 600 });
  };
  return { nodes, text, shape, title, eyebrow, body, folio, placeholder, split, table, metric };
}
export type DesignComposer = ReturnType<typeof createDesignComposer>;
