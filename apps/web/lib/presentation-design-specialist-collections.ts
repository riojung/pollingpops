import type { DesignComposer } from "./presentation-design-composer";
import type { DesignLayoutId } from "./presentation-designs";

const pageNumber: Record<DesignLayoutId, string> = {
  cover: "01",
  section: "02",
  body: "03",
  split: "04",
  image_left: "05",
  image_right: "06",
  data: "07",
  closing: "08",
};

function summit(c: DesignComposer, layout: DesignLayoutId) {
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
    s([71, 28, 22, 9], "none", "rectangle", "accent");
    s([71, 45, 17, 9], "none", "rectangle", "accent");
    s([71, 62, 12, 9], "none", "rectangle", "accent");
    s([71, 81, 22, 2], "accent");
    s([7, 20, 8, 1], "accent");
    e([7, 9, 55, 7]);
    t([7, 28, 56, 39], 92, "sans", "text", 500);
    b([8, 76, 52, 18], 25, "muted");
  } else if (layout === "section") {
    s([7, 12, 16, 13], "accent");
    text("02", [9, 15, 12, 8], 27, { font: "mono", color: "accentText" });
    e([30, 15, 62, 6], "text");
    t([7, 37, 85, 28], 80, "sans", "text", 500);
    s([7, 76, 18, 6], "none", "rectangle", "accent");
    s([7, 88, 11, 1], "accent");
    b([35, 76, 56, 18], 25);
  } else if (layout === "closing") {
    s([84, 31, 9, 9], "none", "rectangle", "accent");
    s([84, 47, 9, 17], "none", "rectangle", "accent");
    s([7, 21, 23, 1], "accent");
    e([7, 10, 72, 6]);
    t([7, 32, 71, 33], 86, "sans", "text", 500);
    b([8, 77, 64, 17], 25, "muted");
  } else {
    e([7, 8, 76, 6]);
    t([7, 21, 85, 21], 54, "sans", "text", 500);
    s([7, 46, 86, 1], "muted");
    if (layout === "body") {
      b([8, 55, 58, 32], 29);
      s([74, 55, 18, 5], "none", "rectangle", "accent");
      s([74, 67, 14, 5], "none", "rectangle", "accent");
      s([74, 79, 10, 5], "none", "rectangle", "accent");
    } else if (layout === "split") {
      s([7, 51, 40, 38], "none", "rectangle", "accent");
      s([53, 51, 40, 38], "none", "rectangle", "accent");
      split([11, 55, 32, 33], [57, 55, 32, 33], "text", "sans", 24);
    } else if (layout === "data") {
      metric([8, 55, 22, 31], "accent", "text");
      s([33, 53, 1, 34], "muted");
      table([38, 52, 55, 36]);
    } else if (layout === "image_left") {
      p([7, 52, 44, 36]);
      b([58, 55, 35, 31], 25);
      s([58, 89, 14, 1], "accent");
    } else {
      b([7, 55, 35, 31], 25);
      p([49, 52, 44, 36]);
      s([7, 89, 14, 1], "accent");
    }
  }
  f(pageNumber[layout], [87, 94, 6, 5], "muted");
}

function atelier(c: DesignComposer, layout: DesignLayoutId) {
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
    s([69, 13, 24, 66], "surface", "ellipse");
    s([75, 19, 12, 54], "none", "ellipse", "accent");
    s([68, 82, 24, 1], "accent");
    e([8, 10, 53, 6]);
    t([8, 28, 56, 39], 100, "serif", "text", 400);
    b([8, 77, 52, 17], 24, "text", "serif");
  } else if (layout === "section") {
    s([29, 12, 1, 77], "accent");
    s([80, 9, 12, 21], "surface", "ellipse");
    text("02", [8, 29, 19, 24], 100, { font: "serif", color: "accent" });
    e([35, 15, 39, 6], "text");
    t([35, 36, 57, 30], 76, "serif", "text", 400);
    b([35, 76, 55, 18], 24, "text", "serif");
  } else if (layout === "closing") {
    s([7, 18, 17, 49], "none", "ellipse", "accent");
    s([12, 30, 7, 25], "surface", "ellipse");
    s([7, 78, 17, 1], "accent");
    e([32, 12, 60, 6]);
    t([32, 30, 60, 36], 90, "serif", "text", 400);
    b([32, 77, 57, 17], 24, "text", "serif");
  } else {
    e([8, 9, 71, 6]);
    t([8, 23, 82, 22], 58, "serif", "text", 400);
    s([8, 49, 14, 1], "accent");
    if (layout === "body") {
      s([9, 57, 14, 26], "none", "ellipse", "accent");
      b([31, 56, 59, 32], 29, "text", "serif");
    } else if (layout === "split") {
      s([5, 53, 37, 36], "surface", "ellipse");
      s([46, 56, 1, 32], "accent");
      split([8, 55, 31, 34], [53, 55, 39, 34], "text", "serif", 24);
    } else if (layout === "data") {
      s([7, 53, 24, 36], "none", "ellipse", "accent");
      metric([10, 57, 18, 29], "accent", "text");
      table([37, 54, 55, 34]);
    } else if (layout === "image_left") {
      s([5, 51, 43, 40], "none", "ellipse", "accent");
      p([8, 54, 37, 34], true);
      b([54, 57, 38, 30], 25, "text", "serif");
    } else {
      b([8, 57, 37, 30], 25, "text", "serif");
      s([52, 51, 43, 40], "none", "ellipse", "accent");
      p([55, 54, 37, 34], true);
    }
  }
  f(pageNumber[layout], [87, 94, 6, 5], "muted");
}

function campus(c: DesignComposer, layout: DesignLayoutId) {
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
  // Cobalt's white text token supplies the lecture paper; accentText is its dark blue ink.
  s([0, 0, 100, 100], "text");
  s([0, 0, 16, 100], "background");
  s([6, 14, 4, 2], "accent");
  s([6, 22, 4, 2], "muted");
  s([6, 30, 4, 2], "muted");
  s([20, 7, 1, 86], "surface");
  if (layout === "cover") {
    s([25, 69, 66, 1], "background");
    e([25, 12, 67, 6], "accentText");
    t([25, 27, 67, 37], 94, "serif", "accentText", 400);
    b([25, 77, 61, 17], 24, "accentText", "serif");
  } else if (layout === "section") {
    e([25, 12, 66, 6], "accentText");
    text("02", [25, 31, 22, 27], 110, { color: "accentText", font: "serif" });
    t([53, 31, 39, 34], 74, "serif", "accentText", 400);
    s([25, 69, 67, 1], "background");
    b([25, 77, 64, 17], 24, "accentText", "serif");
  } else if (layout === "closing") {
    s([25, 24, 17, 2], "background");
    s([25, 69, 67, 1], "background");
    e([25, 12, 65, 6], "accentText");
    t([25, 35, 66, 29], 84, "serif", "accentText", 400);
    b([25, 78, 61, 16], 24, "accentText", "serif");
  } else {
    e([25, 9, 67, 6], "accentText");
    t([25, 23, 67, 22], 56, "serif", "accentText", 400);
    s([25, 49, 67, 1], "background");
    if (layout === "body") {
      s([25, 57, 2, 31], "background");
      b([32, 57, 54, 31], 28, "accentText", "serif");
    } else if (layout === "split") {
      s([57, 56, 1, 32], "background");
      split([25, 55, 27, 34], [63, 55, 29, 34], "accentText", "serif", 23);
    } else if (layout === "data") {
      metric([25, 57, 18, 30], "accentText", "accentText");
      table([49, 54, 43, 35]);
    } else if (layout === "image_left") {
      p([25, 54, 35, 35]);
      b([66, 57, 26, 30], 24, "accentText", "serif");
    } else {
      b([25, 57, 26, 30], 24, "accentText", "serif");
      p([57, 54, 35, 35]);
    }
  }
  f(pageNumber[layout], [3, 87, 10, 6], "text");
}

function meadow(c: DesignComposer, layout: DesignLayoutId) {
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
  // Forest is a dark palette, so its pale text token becomes the field-notes canvas.
  s([0, 0, 100, 100], "text");
  const leaf = (x: number, y: number, width: number, height: number) => {
    s([x, y, width, height], "accent", "ellipse");
    s(
      [x + width * 0.22, y + height * 0.17, width * 0.56, height * 0.66],
      "background",
      "ellipse",
      "none",
      24,
    );
    s([x + width * 0.49, y + height * 0.25, 1, height * 0.55], "accent");
  };
  if (layout === "cover") {
    leaf(74, 23, 19, 34);
    s([74, 68, 19, 1], "background");
    e([8, 11, 57, 6], "accentText");
    t([8, 29, 60, 35], 94, "sans", "accentText", 500);
    b([8, 74, 56, 13], 24, "accentText");
  } else if (layout === "section") {
    leaf(9, 22, 19, 34);
    text("02", [12, 65, 14, 16], 60, { color: "accentText", font: "mono" });
    e([37, 15, 55, 6], "accentText");
    t([37, 33, 55, 31], 78, "sans", "accentText", 500);
    b([37, 74, 54, 13], 24, "accentText");
  } else if (layout === "closing") {
    leaf(78, 18, 15, 27);
    s([8, 69, 16, 1], "background");
    e([8, 13, 62, 6], "accentText");
    t([8, 33, 64, 31], 86, "sans", "accentText", 500);
    b([8, 76, 64, 11], 24, "accentText");
  } else {
    e([8, 9, 72, 6], "accentText");
    t([8, 23, 84, 21], 55, "sans", "accentText", 500);
    s([8, 48, 84, 1], "background");
    if (layout === "body") {
      b([11, 56, 61, 29], 28, "accentText");
      leaf(81, 55, 11, 20);
    } else if (layout === "split") {
      s([50, 54, 1, 30], "background");
      split([8, 54, 37, 32], [56, 54, 36, 32], "accentText", "sans", 23);
    } else if (layout === "data") {
      metric([8, 56, 22, 28], "background", "accentText");
      table([37, 53, 55, 33]);
    } else if (layout === "image_left") {
      p([8, 53, 43, 33]);
      b([58, 56, 34, 29], 24, "accentText");
    } else {
      b([8, 56, 34, 29], 24, "accentText");
      p([49, 53, 43, 33]);
    }
  }
  // Overlapping native ellipses make low rolling hills while keeping all painted frames inside.
  s([0, 90, 44, 10], "background", "ellipse");
  s([29, 92, 45, 8], "accent", "ellipse");
  s([64, 89, 36, 11], "background", "ellipse");
  s([0, 95, 100, 5], "background");
  f(pageNumber[layout], [88, 8, 6, 5], "accentText");
}

function confetti(c: DesignComposer, layout: DesignLayoutId) {
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
  // A quiet centre stays clear of the small, fully editable pieces around the perimeter.
  s([5, 15, 3, 7], "accent", "rectangle", "none", -20);
  s([91, 17, 3, 6], "accent", "ellipse");
  s([7, 76, 4, 4], "accent", "diamond");
  s([91, 73, 3, 8], "accent", "rectangle", "none", 22);
  s([19, 90, 5, 2], "accent", "rectangle", "none", -12);
  s([79, 9, 5, 2], "accent", "rectangle", "none", 15);
  if (layout === "cover") {
    s([12, 25, 76, 43], "surface", "rounded_rectangle", "none", -2);
    e([17, 11, 58, 6], "text", "center");
    t([15, 32, 70, 30], 90, "mono", "text", 600, "center");
    b([23, 77, 54, 16], 23, "text", "mono");
  } else if (layout === "section") {
    s([10, 12, 18, 17], "surface", "rounded_rectangle", "none", -4);
    text("02", [13, 16, 12, 10], 36, { color: "text", font: "mono", align: "center" });
    e([35, 17, 49, 6], "text");
    t([16, 39, 68, 28], 82, "mono", "text", 600, "center");
    b([21, 77, 58, 16], 23, "text", "mono");
  } else if (layout === "closing") {
    s([11, 25, 78, 43], "none", "rounded_rectangle", "accent");
    s([46, 19, 8, 2], "accent");
    e([17, 11, 58, 6], "text", "center");
    t([16, 33, 68, 29], 88, "mono", "text", 600, "center");
    b([23, 77, 54, 16], 23, "text", "mono");
  } else {
    e([15, 10, 60, 6], "text", "center");
    t([14, 24, 72, 20], 54, "mono", "text", 600, "center");
    if (layout === "body") {
      s([12, 51, 76, 35], "surface", "rounded_rectangle", "none", -2);
      b([18, 57, 64, 26], 27, "text", "mono");
    } else if (layout === "split") {
      s([8, 49, 38, 40], "surface", "rounded_rectangle", "none", -2);
      s([54, 51, 38, 38], "surface", "rounded_rectangle", "none", 2);
      split([12, 54, 30, 33], [58, 54, 30, 33], "text", "mono", 22);
    } else if (layout === "data") {
      s([9, 51, 26, 36], "surface", "rounded_rectangle", "none", -3);
      metric([13, 56, 18, 28], "accent", "text");
      table([42, 52, 47, 35]);
    } else if (layout === "image_left") {
      s([8, 50, 45, 40], "surface", "rounded_rectangle", "none", -2);
      p([11, 53, 39, 34], true);
      b([59, 57, 30, 29], 24, "text", "mono");
    } else {
      b([11, 57, 30, 29], 24, "text", "mono");
      s([47, 50, 45, 40], "surface", "rounded_rectangle", "none", 2);
      p([50, 53, 39, 34], true);
    }
  }
  f(pageNumber[layout], [46, 94, 8, 5], "text");
}

function facet(c: DesignComposer, layout: DesignLayoutId) {
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
    s([75, 20, 18, 32], "none", "diamond", "accent");
    s([80, 29, 8, 14], "none", "diamond", "muted");
    s([70, 61, 18, 31], "none", "diamond", "muted");
    s([84, 67, 6, 10], "accent", "diamond");
    e([8, 11, 56, 6]);
    t([7, 29, 60, 37], 92, "mono", "text", 500);
    b([8, 78, 53, 16], 24, "muted", "mono");
  } else if (layout === "section") {
    s([11, 62, 12, 21], "none", "diamond", "accent");
    text("02", [8, 32, 18, 21], 86, { color: "accent", font: "mono" });
    e([8, 14, 73, 6]);
    t([34, 35, 57, 31], 74, "mono", "text", 500);
    b([34, 78, 56, 16], 24, "muted", "mono");
  } else if (layout === "closing") {
    s([82, 74, 11, 19], "none", "diamond", "accent");
    s([7, 22, 17, 1], "accent");
    s([87, 14, 5, 9], "accent", "diamond");
    e([8, 11, 68, 6]);
    t([8, 33, 76, 32], 88, "mono", "text", 500);
    b([8, 79, 66, 15], 24, "muted", "mono");
  } else {
    s([88, 25, 5, 9], "accent", "diamond");
    e([8, 9, 73, 6]);
    t([8, 24, 75, 20], 54, "mono", "text", 500);
    s([8, 48, 85, 1], "muted");
    if (layout === "body") {
      s([8, 55, 3, 31], "accent");
      s([84, 57, 9, 16], "none", "diamond", "accent");
      s([81, 74, 10, 15], "none", "diamond", "muted");
      b([17, 56, 59, 31], 28, "text", "mono");
    } else if (layout === "split") {
      s([49, 57, 1, 30], "accent");
      s([46, 51, 7, 12], "accent", "diamond");
      split([8, 55, 35, 33], [57, 55, 35, 33], "text", "mono", 23);
    } else if (layout === "data") {
      metric([8, 57, 22, 30], "accent", "muted");
      s([34, 53, 1, 35], "accent");
      table([40, 54, 52, 34]);
    } else if (layout === "image_left") {
      p([8, 54, 42, 34]);
      b([57, 57, 35, 30], 24, "muted", "mono");
    } else {
      b([8, 57, 35, 30], 24, "muted", "mono");
      p([50, 54, 42, 34]);
    }
  }
  f(pageNumber[layout], [88, 94, 6, 5], "accent");
}

/** Each specialist collection owns the full geometry of its eight editable layouts. */
export const specialistDesignCollections = {
  summit,
  atelier,
  campus,
  meadow,
  confetti,
  facet,
} satisfies Record<string, (composer: DesignComposer, layout: DesignLayoutId) => void>;
