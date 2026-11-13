import type { PresentationSceneFrame, PresentationSceneNode } from "@openround/contracts";
import type {
  DesignLayoutId,
  PresentationDesignId,
  PresentationDesignSlideCopy,
} from "./presentation-designs";

type Text = Extract<PresentationSceneNode, { type: "text" }>;
type Shape = Extract<PresentationSceneNode, { type: "shape" }>;
type Box = readonly [number, number, number, number];
type Ink = NonNullable<Text["typography"]>["color"];
type Fill = NonNullable<Shape["appearance"]>["fill"];
type Font = NonNullable<Text["typography"]>["font"];
const bounds = ([x, y, width, height]: Box): PresentationSceneFrame => ({ x, y, width, height });

/** Small native primitives keep every collection editable and make new collections additive. */
function composer(copy: PresentationDesignSlideCopy, createId: () => string) {
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
      const capacity = (box[2] * 12.8) / fontSize;
      return value.split("\n").reduce((total, paragraph) => {
        let lines = 1;
        let used = 0;
        for (const word of paragraph.split(/\s+/u)) {
          const width = unitWidth(word);
          if (used && used + 0.3 + width > capacity) {
            lines += 1;
            used = 0;
          }
          if (width > capacity) {
            lines += Math.ceil(width / capacity) - 1;
            used = width % capacity;
          } else used += (used ? 0.3 : 0) + width;
        }
        return total + lines;
      }, 0);
    };
    // Fit localized sample text and long caller copy inside its own editable box. No wording
    // is trimmed, and every family retains its authored maximum type size and proportions.
    let fitted = size;
    while (fitted > 18 && lineCount(fitted) * fitted * leading > box[3] * 7.2) fitted -= 1;
    nodes.push({
      id: createId(),
      type: "text",
      role: title ? "title" : "body",
      text: value,
      frame: bounds(box),
      typography: { size: fitted, weight: 400, leading, font, color: "text", ...typography },
    });
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
type Composer = ReturnType<typeof composer>;

function studio(c: Composer, layout: DesignLayoutId) {
  const {
    shape: s,
    title: t,
    eyebrow: e,
    body: b,
    text,
    folio: f,
    split,
    placeholder: p,
    table,
    metric,
  } = c;
  if (layout === "cover") {
    s([68, 0, 32, 100], "accent");
    s([73, 15, 21, 37], "none", "ellipse", "accentText");
    s([77, 43, 16, 29], "accentText", "ellipse");
    s([72, 68, 10, 18], "text", "ellipse");
    s([6, 10, 4, 2], "accent");
    e([12, 8, 48, 6]);
    t([6, 23, 59, 46], 96);
    b([7, 75, 53, 16], 25, "muted");
    f("01", [87, 91, 6, 5], "accentText");
  } else if (layout === "section") {
    s([0, 0, 32, 100], "accent");
    text("02", [5, 22, 25, 33], 128, { color: "accentText", weight: 700 });
    s([7, 79, 17, 2], "accentText");
    e([39, 15, 54, 6]);
    t([39, 30, 54, 34], 72);
    b([39, 71, 51, 20], 25);
    f("02");
  } else if (layout === "closing") {
    s([0, 71, 100, 29], "accent");
    s([77, 12, 15, 27], "accent", "ellipse");
    e([7, 11, 62, 6]);
    t([7, 27, 75, 36], 88);
    b([7, 78, 77, 17], 26, "accentText");
    f("08", [88, 90, 6, 5], "accentText");
  } else {
    e([7, 7, 73, 5]);
    t([7, 17, 86, 19], 54);
    s([7, 39, 8, 1], "accent");
    if (layout === "body") {
      s([64, 46, 29, 40], "surface", "rounded_rectangle");
      s([70, 52, 16, 28], "accent", "ellipse");
      s([77, 59, 9, 16], "background", "ellipse");
      b([7, 48, 50, 36], 30);
    } else if (layout === "split") {
      s([7, 47, 40, 39], "surface", "rounded_rectangle");
      s([53, 47, 40, 39], "surface", "rounded_rectangle");
      text("01", [10, 50, 6, 5], 16, { color: "accent", font: "mono" });
      text("02", [56, 50, 6, 5], 16, { color: "accent", font: "mono" });
      split([10, 59, 34, 25], [56, 59, 34, 25], "text", "sans", 22);
    } else if (layout === "data") {
      metric([7, 48, 25, 36]);
      table([37, 47, 56, 39]);
    } else if (layout === "image_left") {
      p([7, 47, 45, 39], true);
      b([59, 49, 33, 35], 27);
    } else {
      p([53, 47, 40, 39], true);
      b([7, 49, 39, 35], 27);
    }
    f(
      layout === "body"
        ? "03"
        : layout === "split"
          ? "04"
          : layout === "image_left"
            ? "05"
            : layout === "image_right"
              ? "06"
              : "07",
    );
  }
}

function editorial(c: Composer, layout: DesignLayoutId) {
  const {
    shape: s,
    title: t,
    eyebrow: e,
    body: b,
    text,
    folio: f,
    split,
    placeholder: p,
    table,
    metric,
  } = c;
  if (layout === "cover") {
    e([7, 7, 70, 6], "text");
    s([7, 16, 86, 1], "text");
    t([7, 24, 69, 46], 110, "serif", "text", 400);
    s([76, 24, 17, 44], "accent", "rectangle");
    s([79, 29, 11, 35], "background", "ellipse");
    b([47, 78, 46, 15], 23, "muted");
    text("01", [7, 79, 20, 13], 48, { font: "serif", color: "accent" });
  } else if (layout === "section") {
    text("02", [7, 13, 23, 26], 110, { font: "serif", color: "accent" });
    s([34, 8, 1, 82], "muted");
    e([41, 12, 51, 6], "text");
    t([41, 29, 51, 33], 72, "serif", "text", 400);
    b([41, 70, 49, 20], 24);
    f("02");
  } else if (layout === "closing") {
    s([7, 9, 86, 1], "text");
    e([7, 15, 85, 6], "text", "center");
    t([11, 31, 78, 35], 86, "serif", "text", 400, "center");
    b([29, 75, 58, 17], 23);
    s([14, 74, 7, 13], "accent", "diamond");
  } else {
    e([7, 7, 72, 5], "text");
    s([7, 15, 86, 1], "text");
    t([7, 22, 82, 22], 58, "serif", "text", 400);
    if (layout === "body") {
      text("01", [7, 52, 20, 21], 86, { font: "serif", color: "accent" });
      b([33, 53, 58, 34], 29, "text", "serif");
    } else if (layout === "split") {
      s([45, 51, 1, 37], "muted");
      split([7, 52, 30, 37], [53, 52, 39, 37], "text", "serif", 25);
    } else if (layout === "data") {
      metric([7, 54, 25, 34]);
      table([37, 52, 56, 36]);
    } else if (layout === "image_left") {
      p([7, 51, 51, 37]);
      b([65, 54, 27, 32], 25, "text", "serif");
    } else {
      b([7, 54, 30, 32], 25, "text", "serif");
      p([45, 51, 48, 37]);
    }
    f(
      layout === "body"
        ? "03"
        : layout === "split"
          ? "04"
          : layout === "image_left"
            ? "05"
            : layout === "image_right"
              ? "06"
              : "07",
    );
  }
}

function midnight(c: Composer, layout: DesignLayoutId) {
  const {
    shape: s,
    title: t,
    eyebrow: e,
    body: b,
    text,
    folio: f,
    split,
    placeholder: p,
    table,
    metric,
  } = c;
  if (layout === "cover") {
    // An orbital emblem built from native outlines, rather than a stock tech illustration.
    s([66, 21, 27, 48], "none", "ellipse", "accent");
    s([71, 30, 17, 30], "none", "ellipse", "accent");
    s([76, 39, 7, 12], "accent", "ellipse");
    s([63, 57, 6, 11], "accent", "ellipse");
    s([7, 12, 12, 1], "accent");
    e([7, 18, 52, 6]);
    t([7, 29, 57, 43], 90, "sans", "text", 800);
    b([7, 78, 51, 16], 24, "muted");
    f("01", [88, 91, 6, 5], "accent");
  } else if (layout === "section") {
    text("02", [69, 12, 24, 34], 130, { color: "muted", weight: 900 });
    s([7, 19, 8, 3], "accent");
    e([7, 29, 68, 6]);
    t([7, 41, 84, 31], 78, "sans", "text", 800);
    b([7, 79, 67, 16], 25, "muted");
  } else if (layout === "closing") {
    s([0, 0, 100, 8], "accent");
    e([7, 18, 84, 6]);
    t([7, 34, 80, 36], 94, "sans", "text", 800);
    b([7, 79, 68, 16], 24, "muted");
    s([83, 77, 10, 15], "accent", "chevron");
  } else {
    e([7, 7, 75, 5]);
    t([7, 20, 86, 22], 56, "sans", "text", 800);
    s([7, 45, 86, 1], "muted");
    if (layout === "body") {
      s([7, 53, 2, 33], "accent");
      b([14, 54, 61, 34], 31);
      s([83, 57, 8, 25], "accent", "chevron");
    } else if (layout === "split") {
      s([7, 53, 40, 34], "surface", "rounded_rectangle");
      s([53, 53, 40, 34], "surface", "rounded_rectangle");
      split([10, 57, 34, 28], [56, 57, 34, 28], "text", "sans", 22);
    } else if (layout === "data") {
      metric([7, 54, 25, 34]);
      table([37, 53, 56, 34]);
    } else if (layout === "image_left") {
      p([7, 53, 49, 34], true);
      b([62, 56, 31, 29], 25);
    } else {
      b([7, 56, 34, 29], 25);
      p([48, 53, 45, 34], true);
    }
    f(
      layout === "body"
        ? "03"
        : layout === "split"
          ? "04"
          : layout === "image_left"
            ? "05"
            : layout === "image_right"
              ? "06"
              : "07",
      [88, 90, 6, 6],
      "accent",
    );
  }
}

function blueprint(c: Composer, layout: DesignLayoutId) {
  const {
    shape: s,
    title: t,
    eyebrow: e,
    body: b,
    text,
    folio: f,
    split,
    placeholder: p,
    table,
    metric,
  } = c;
  // A consistent report rail and right-aligned folios make this a proposal system.
  s([0, 0, 2, 100], "accent");
  s([7, 10, 5, 4], "accent");
  if (layout === "cover") {
    e([15, 9, 69, 6]);
    t([7, 27, 67, 35], 82, "sans", "text", 700);
    b([7, 72, 52, 17], 25, "muted");
    s([77, 23, 16, 57], "surface");
    for (let i = 0; i < 3; i++) {
      s([79, 29 + i * 16, 12, 1], "muted");
      s([79, 33 + i * 16, 3 + i * 4, 8], "accent");
    }
    s([7, 93, 75, 1], "muted");
    f("01");
  } else if (layout === "section") {
    e([15, 9, 69, 6]);
    s([7, 28, 23, 49], "accent");
    text("02", [10, 42, 18, 22], 85, { color: "accentText", weight: 700, font: "mono" });
    t([37, 29, 56, 31], 70);
    b([37, 68, 53, 21], 25);
    f("02");
  } else if (layout === "closing") {
    e([15, 9, 69, 6]);
    t([7, 29, 79, 34], 84);
    s([7, 72, 86, 17], "accent");
    b([11, 76, 77, 11], 23, "accentText");
    f("08");
  } else {
    e([15, 9, 69, 6]);
    t([7, 23, 86, 20], 52);
    s([7, 47, 86, 1], "muted");
    if (layout === "body") {
      text("01", [7, 55, 10, 11], 30, { color: "accent", font: "mono", weight: 700 });
      b([22, 55, 66, 31], 29);
      s([7, 77, 10, 1], "accent");
    } else if (layout === "split") {
      s([7, 54, 40, 4], "accent");
      s([53, 54, 40, 4], "text");
      split([7, 64, 40, 24], [53, 64, 40, 24], "text", "sans", 22);
    } else if (layout === "data") {
      s([7, 54, 24, 34], "surface");
      metric([9, 55, 21, 31]);
      table([37, 54, 56, 34]);
    } else if (layout === "image_left") {
      p([7, 54, 41, 34]);
      b([55, 56, 37, 29], 25);
    } else {
      b([7, 56, 37, 29], 25);
      p([52, 54, 41, 34]);
    }
    f(
      layout === "body"
        ? "03"
        : layout === "split"
          ? "04"
          : layout === "image_left"
            ? "05"
            : layout === "image_right"
              ? "06"
              : "07",
    );
  }
}

function terracotta(c: Composer, layout: DesignLayoutId) {
  const {
    shape: s,
    title: t,
    eyebrow: e,
    body: b,
    text,
    folio: f,
    split,
    placeholder: p,
    table,
    metric,
  } = c;
  if (layout === "cover") {
    s([62, 9, 31, 75], "surface", "rounded_rectangle");
    s([66, 25, 23, 53], "accent", "ellipse");
    s([70, 31, 15, 40], "background", "ellipse");
    s([60, 66, 16, 20], "text", "ellipse");
    e([8, 10, 50, 6], "text");
    t([8, 27, 52, 41], 100, "serif", "text", 400);
    b([8, 77, 48, 17], 25, "muted");
    f("01");
  } else if (layout === "section") {
    s([70, 10, 22, 39], "surface", "ellipse");
    text("02", [8, 12, 22, 20], 78, { font: "serif", color: "accent" });
    e([8, 36, 75, 6], "text");
    t([8, 49, 79, 25], 76, "serif", "text", 400);
    b([8, 81, 77, 14], 24);
  } else if (layout === "closing") {
    s([8, 20, 20, 56], "accent", "rounded_rectangle");
    s([11, 26, 14, 43], "background", "ellipse");
    e([36, 17, 56, 6], "text");
    t([36, 34, 56, 34], 80, "serif", "text", 400);
    b([36, 77, 54, 17], 24);
  } else {
    e([8, 8, 70, 6], "text");
    s([88, 7, 4, 7], "accent", "ellipse");
    t([8, 22, 84, 22], 57, "serif", "text", 400);
    if (layout === "body") {
      s([8, 52, 18, 32], "accent", "ellipse");
      text("01", [11, 60, 12, 14], 42, { color: "accentText", font: "serif" });
      b([34, 53, 57, 34], 29, "text", "serif");
    } else if (layout === "split") {
      s([8, 51, 38, 37], "surface", "rounded_rectangle");
      s([53, 51, 39, 37], "surface", "rounded_rectangle");
      split([11, 56, 32, 29], [56, 56, 33, 29], "text", "serif", 24);
    } else if (layout === "data") {
      metric([8, 54, 25, 33]);
      table([39, 52, 53, 36]);
    } else if (layout === "image_left") {
      p([8, 51, 40, 37], true);
      b([56, 54, 36, 31], 26, "text", "serif");
    } else {
      b([8, 54, 35, 31], 26, "text", "serif");
      p([51, 51, 41, 37], true);
    }
    f(
      layout === "body"
        ? "03"
        : layout === "split"
          ? "04"
          : layout === "image_left"
            ? "05"
            : layout === "image_right"
              ? "06"
              : "07",
    );
  }
}

function signal(c: Composer, layout: DesignLayoutId) {
  const {
    shape: s,
    title: t,
    eyebrow: e,
    body: b,
    text,
    folio: f,
    split,
    placeholder: p,
    table,
    metric,
  } = c;
  if (layout === "cover") {
    s([0, 0, 100, 100], "background");
    s([72, 19, 21, 37], "text", "diamond");
    s([79, 31, 7, 13], "background", "ellipse");
    e([7, 9, 61, 6], "text");
    t([7, 27, 59, 42], 108, "sans", "text", 900);
    s([7, 76, 86, 17], "text");
    b([10, 79, 79, 12], 24, "accentText");
  } else if (layout === "section") {
    s([0, 0, 100, 24], "text");
    e([7, 9, 76, 6], "background");
    text("02", [77, 29, 17, 22], 83, { color: "accent", weight: 900 });
    t([7, 34, 67, 35], 82, "sans", "text", 900);
    s([7, 75, 86, 18], "accent");
    b([10, 79, 80, 12], 23, "accentText");
  } else if (layout === "closing") {
    s([0, 0, 100, 100], "background");
    e([7, 9, 79, 6], "text");
    t([7, 28, 85, 37], 100, "sans", "text", 900);
    b([7, 78, 68, 16], 25, "text");
    s([81, 77, 12, 17], "text", "chevron");
  } else {
    s([0, 0, 100, 6], "accent");
    e([7, 12, 75, 5]);
    t([7, 24, 86, 22], 59, "sans", "text", 900);
    if (layout === "body") {
      s([7, 54, 86, 34], "text");
      b([12, 59, 76, 25], 31, "accentText");
    } else if (layout === "split") {
      s([7, 54, 40, 34], "accent");
      s([53, 54, 40, 34], "surface");
      split([10, 58, 34, 28], [56, 58, 34, 28], "accentText", "sans", 22, "text");
    } else if (layout === "data") {
      s([7, 54, 25, 34], "text");
      metric([10, 55, 21, 31], "accentText", "accentText");
      table([38, 54, 55, 34]);
    } else if (layout === "image_left") {
      p([7, 54, 48, 34]);
      s([58, 54, 3, 34], "accent");
      b([66, 56, 27, 30], 25);
    } else {
      b([7, 56, 30, 30], 25);
      s([41, 54, 3, 34], "accent");
      p([48, 54, 45, 34]);
    }
    f(
      layout === "body"
        ? "03"
        : layout === "split"
          ? "04"
          : layout === "image_left"
            ? "05"
            : layout === "image_right"
              ? "06"
              : "07",
    );
  }
}

function monograph(c: Composer, layout: DesignLayoutId) {
  const {
    shape: s,
    title: t,
    eyebrow: e,
    body: b,
    text,
    folio: f,
    split,
    placeholder: p,
    table,
    metric,
  } = c;
  if (layout === "cover") {
    s([7, 9, 86, 1], "text");
    e([7, 15, 65, 6], "text");
    t([7, 31, 85, 40], 100, "sans", "text", 700);
    s([7, 79, 7, 12], "text");
    b([38, 80, 55, 16], 23, "muted");
    text("01", [83, 14, 10, 6], 16, { font: "mono", align: "right" });
  } else if (layout === "section") {
    s([7, 9, 86, 1], "text");
    text("02", [7, 21, 24, 25], 100, { font: "sans", weight: 700 });
    e([38, 24, 55, 6], "text");
    t([38, 39, 55, 33], 72, "sans", "text", 600);
    b([38, 80, 54, 15], 23);
  } else if (layout === "closing") {
    s([7, 9, 86, 1], "text");
    e([7, 16, 75, 6], "text");
    t([7, 36, 85, 36], 94, "sans", "text", 600);
    s([7, 80, 19, 1], "text");
    b([38, 79, 55, 16], 23);
    f("08");
  } else {
    s([7, 9, 86, 1], "text");
    e([7, 15, 76, 5], "text");
    t([7, 29, 86, 20], 57, "sans", "text", 600);
    if (layout === "body") {
      text("01", [7, 58, 18, 15], 42, { font: "mono" });
      b([38, 57, 55, 32], 28);
    } else if (layout === "split") {
      split([7, 58, 31, 31], [47, 58, 46, 31], "text", "sans", 24);
    } else if (layout === "data") {
      metric([7, 58, 24, 31], "text");
      table([38, 57, 55, 32]);
    } else if (layout === "image_left") {
      p([7, 57, 53, 32]);
      b([67, 59, 26, 28], 24);
    } else {
      b([7, 59, 28, 28], 24);
      p([43, 57, 50, 32]);
    }
    f(
      layout === "body"
        ? "03"
        : layout === "split"
          ? "04"
          : layout === "image_left"
            ? "05"
            : layout === "image_right"
              ? "06"
              : "07",
    );
  }
}

function canvas(c: Composer, layout: DesignLayoutId) {
  const {
    shape: s,
    title: t,
    eyebrow: e,
    body: b,
    text,
    folio: f,
    split,
    placeholder: p,
    table,
    metric,
  } = c;
  if (layout === "cover") {
    s([69, 17, 22, 28], "surface", "rounded_rectangle", "none", 7);
    s([71, 48, 22, 30], "accent", "rounded_rectangle", "none", -7);
    s([78, 26, 6, 11], "accent", "ellipse");
    s([77, 58, 10, 2], "accentText");
    s([77, 65, 7, 2], "accentText");
    e([7, 11, 59, 6], "text");
    t([7, 28, 59, 40], 90, "sans", "text", 700);
    b([7, 77, 55, 17], 25, "muted");
    s([7, 94, 4, 1], "accent");
  } else if (layout === "section") {
    s([7, 15, 20, 28], "accent", "rounded_rectangle", "none", -6);
    text("02", [10, 21, 14, 14], 58, { color: "accentText", weight: 600 });
    e([35, 18, 58, 6], "text");
    t([35, 33, 58, 32], 72);
    b([35, 74, 55, 20], 25);
  } else if (layout === "closing") {
    s([8, 16, 84, 68], "surface", "rounded_rectangle");
    s([75, 73, 14, 17], "accent", "rounded_rectangle", "none", -6);
    e([14, 24, 68, 6], "text");
    t([14, 39, 70, 29], 80);
    b([14, 73, 56, 20], 24);
    f("08");
  } else {
    e([7, 8, 75, 6], "text");
    t([7, 23, 86, 22], 55);
    s([87, 9, 6, 10], "accent", "rounded_rectangle", "none", 8);
    if (layout === "body") {
      s([7, 53, 86, 35], "surface", "rounded_rectangle");
      text("01", [11, 59, 11, 13], 38, { color: "accent", weight: 700 });
      b([27, 59, 60, 26], 28);
    } else if (layout === "split") {
      s([7, 53, 40, 35], "surface", "rounded_rectangle");
      s([53, 53, 40, 35], "surface", "rounded_rectangle");
      split([11, 58, 32, 27], [57, 58, 32, 27], "text", "sans", 23);
    } else if (layout === "data") {
      s([7, 53, 25, 35], "surface", "rounded_rectangle");
      metric([10, 55, 20, 31]);
      table([38, 53, 55, 35]);
    } else if (layout === "image_left") {
      p([7, 53, 42, 35], true);
      b([56, 56, 37, 30], 25);
    } else {
      b([7, 56, 37, 30], 25);
      p([51, 53, 42, 35], true);
    }
    f(
      layout === "body"
        ? "03"
        : layout === "split"
          ? "04"
          : layout === "image_left"
            ? "05"
            : layout === "image_right"
              ? "06"
              : "07",
    );
  }
}

/** A collection owns its whole composition, rather than sharing one wireframe with new colours. */
const collections: Record<
  PresentationDesignId,
  (composition: Composer, layout: DesignLayoutId) => void
> = {
  studio,
  editorial,
  midnight,
  blueprint,
  terracotta,
  signal,
  monograph,
  canvas,
};

export function createPresentationDesignComposition(
  designId: PresentationDesignId,
  layout: DesignLayoutId,
  copy: PresentationDesignSlideCopy,
  createId: () => string,
): PresentationSceneNode[] {
  const composition = composer(copy, createId);
  collections[designId](composition, layout);
  return composition.nodes;
}
