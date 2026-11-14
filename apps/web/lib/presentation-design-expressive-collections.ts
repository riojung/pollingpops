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

function botanica(c: DesignComposer, layout: DesignLayoutId) {
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
  // Forest's pale text token becomes this collection's paper; its dark ink is accentText.
  s([0, 0, 100, 100], "text");
  const leaves = (x: number, y: number, scale = 1) => {
    s([x + 6 * scale, y, Math.max(1, 0.35 * scale), 43 * scale], "accent");
    s([x, y + 3 * scale, 6 * scale, 15 * scale], "accent", "ellipse", "none", -38);
    s([x + 6 * scale, y + 12 * scale, 6 * scale, 15 * scale], "text", "ellipse", "none", 38);
    s([x, y + 24 * scale, 6 * scale, 15 * scale], "text", "ellipse", "none", -38);
    s([x + 6 * scale, y + 30 * scale, 6 * scale, 13 * scale], "accent", "ellipse", "none", 38);
  };
  if (layout === "cover") {
    s([0, 0, 24, 100], "background");
    leaves(6, 25, 1.1);
    e([33, 11, 59, 6], "accentText");
    t([33, 26, 59, 42], 94, "serif", "accentText", 400);
    s([33, 74, 14, 1], "background");
    b([33, 80, 57, 15], 24, "accentText", "serif");
    f("01", [7, 89, 10, 5], "text");
  } else if (layout === "section") {
    s([0, 0, 31, 100], "background");
    leaves(8, 13, 1.2);
    text("02", [8, 74, 19, 17], 64, { color: "text", font: "serif" });
    e([40, 15, 52, 6], "accentText");
    t([40, 33, 52, 33], 76, "serif", "accentText", 400);
    b([40, 76, 50, 18], 24, "accentText", "serif");
  } else if (layout === "closing") {
    s([78, 0, 22, 100], "background");
    leaves(82, 26, 0.9);
    e([9, 14, 62, 6], "accentText");
    t([9, 32, 62, 38], 90, "serif", "accentText", 400);
    b([9, 80, 59, 15], 24, "accentText", "serif");
    f("08", [84, 90, 9, 5], "text");
  } else {
    s([0, 0, 14, 100], "background");
    leaves(2.4, 15, 0.7);
    e([23, 9, 69, 5], "accentText");
    t([23, 22, 69, 22], 54, "serif", "accentText", 400);
    s([23, 47, 69, 1], "background");
    if (layout === "body") {
      b([23, 55, 60, 33], 29, "accentText", "serif");
      s([88, 61, 4, 20], "background", "ellipse", "none", 28);
    } else if (layout === "split") {
      s([55, 55, 1, 32], "background");
      split([23, 55, 27, 33], [61, 55, 31, 33], "accentText", "serif", 23);
    } else if (layout === "data") {
      metric([23, 56, 22, 32], "background", "accentText");
      table([50, 54, 42, 35]);
    } else if (layout === "image_left") {
      p([23, 54, 35, 35]);
      b([64, 56, 28, 31], 24, "accentText", "serif");
    } else {
      b([23, 56, 28, 31], 24, "accentText", "serif");
      p([57, 54, 35, 35]);
    }
    f(pageNumber[layout], [3, 90, 8, 5], "text");
  }
}

function archive(c: DesignComposer, layout: DesignLayoutId) {
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
  // Two fine frames and a small catalogue column evoke a lecture folio using native geometry.
  s([4, 5, 92, 90], "none", "rectangle", "text");
  s([5.5, 7, 89, 86], "none", "rectangle", "muted");
  s([27, 11, 1, 77], "muted");
  text(pageNumber[layout], [10, 14, 13, 13], 40, { font: "serif", color: "accent" });
  if (layout === "cover") {
    s([10, 39, 12, 17], "surface", "rectangle", "muted");
    s([12, 42, 8, 11], "none", "rectangle", "text");
    s([10, 65, 12, 17], "accent");
    s([12, 68, 8, 11], "background", "rectangle", "accentText");
    e([33, 12, 56, 6], "text");
    t([33, 26, 56, 40], 92, "serif", "text", 400);
    s([33, 73, 56, 1], "muted");
    b([33, 79, 55, 12], 23, "muted", "serif");
  } else if (layout === "section") {
    s([10, 39, 12, 42], "surface", "rectangle", "muted");
    s([12, 43, 8, 34], "none", "rectangle", "accent");
    e([33, 16, 55, 6], "text");
    t([33, 34, 56, 33], 76, "serif", "text", 400);
    b([33, 77, 54, 14], 24, "text", "serif");
  } else if (layout === "closing") {
    s([11, 50, 10, 1], "accent");
    s([11, 56, 10, 1], "accent");
    e([33, 16, 56, 6], "text");
    t([33, 33, 56, 35], 84, "serif", "text", 400);
    b([33, 78, 55, 13], 23, "text", "serif");
  } else {
    e([33, 12, 56, 5], "text");
    t([33, 24, 56, 22], 52, "serif", "text", 400);
    s([33, 50, 56, 1], "muted");
    if (layout === "body") {
      s([10, 55, 12, 23], "surface", "rectangle", "muted");
      b([33, 58, 55, 30], 27, "text", "serif");
    } else if (layout === "split") {
      s([59, 57, 1, 31], "muted");
      split([33, 57, 22, 31], [64, 57, 25, 31], "text", "serif", 22);
    } else if (layout === "data") {
      metric([9, 57, 15, 29], "accent", "muted");
      table([33, 56, 56, 33]);
    } else if (layout === "image_left") {
      p([33, 56, 28, 32]);
      b([67, 58, 22, 29], 23, "text", "serif");
    } else {
      b([33, 58, 22, 29], 23, "text", "serif");
      p([61, 56, 28, 32]);
    }
    if (layout !== "data") f(pageNumber[layout], [10, 84, 12, 5], "muted");
  }
}

function workshop(c: DesignComposer, layout: DesignLayoutId) {
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
  const step = (number: string, x: number, y: number) => {
    s([x, y, 6, 10], "accent", "ellipse");
    text(number, [x + 0.6, y + 2.1, 4.8, 6], 19, {
      color: "accentText",
      align: "center",
      weight: 700,
    });
  };
  if (layout === "cover") {
    s([8, 14, 83, 55], "surface", "rounded_rectangle", "none", -2);
    s([66, 74, 25, 19], "accent", "rounded_rectangle", "none", 5);
    s([73, 79, 12, 1], "accentText");
    s([73, 84, 8, 1], "accentText");
    e([13, 20, 70, 6], "text");
    t([13, 33, 73, 32], 92, "sans", "text", 700);
    b([12, 78, 48, 17], 24, "text");
    step("01", 3, 6);
  } else if (layout === "section") {
    s([6, 15, 24, 61], "accent", "rounded_rectangle", "none", -3);
    text("02", [10, 34, 17, 20], 76, { color: "accentText", weight: 700 });
    s([37, 22, 55, 47], "surface", "rounded_rectangle", "none", 2);
    e([42, 29, 45, 6], "text");
    t([42, 42, 45, 23], 70);
    b([39, 78, 51, 17], 24);
  } else if (layout === "closing") {
    s([9, 14, 82, 58], "surface", "rounded_rectangle", "none", 1.5);
    e([15, 21, 69, 6], "text");
    t([15, 36, 69, 31], 86);
    b([15, 81, 62, 14], 24);
    step("03", 85, 81);
  } else {
    s([7.8, 20, 1, 64], "muted");
    step("01", 5, 12);
    step("02", 5, 44);
    step("03", 5, 76);
    e([21, 9, 72, 5], "text");
    t([21, 21, 72, 21], 52);
    if (layout === "body") {
      s([20, 50, 72, 39], "surface", "rounded_rectangle", "none", -1.5);
      b([25, 56, 60, 29], 28);
    } else if (layout === "split") {
      s([20, 50, 34, 39], "surface", "rounded_rectangle", "none", -2);
      s([59, 50, 34, 39], "surface", "rounded_rectangle", "none", 2);
      split([24, 56, 26, 29], [63, 56, 26, 29], "text", "sans", 22);
    } else if (layout === "data") {
      s([20, 50, 23, 39], "accent", "rounded_rectangle", "none", -2);
      metric([23, 55, 18, 30], "accentText", "accentText");
      table([49, 51, 44, 37]);
    } else if (layout === "image_left") {
      s([19, 49, 36, 41], "accent", "rounded_rectangle", "none", -2);
      p([22, 53, 30, 33], true);
      b([61, 55, 31, 31], 25);
    } else {
      b([21, 55, 30, 31], 25);
      s([57, 49, 36, 41], "accent", "rounded_rectangle", "none", 2);
      p([60, 53, 30, 33], true);
    }
    f(pageNumber[layout], [86, 93, 7, 4]);
  }
}

function scholar(c: DesignComposer, layout: DesignLayoutId) {
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
  // Cobalt ink and a disciplined blue side rail sit on an explicit white sheet.
  s([0, 0, 100, 100], "text");
  s([85, 0, 15, 100], "background");
  s([89, 11, 6, 1], "text");
  s([89, 15, 6, 1], "text");
  s([89, 19, 6, 1], "text");
  f(pageNumber[layout], [88, 89, 7, 5], "text");
  if (layout === "cover") {
    text("01", [5, 24, 13, 26], 84, { color: "background", font: "serif" });
    s([20, 9, 1, 81], "background");
    e([26, 10, 53, 6], "accentText");
    s([26, 20, 53, 1], "background");
    t([26, 29, 53, 39], 90, "serif", "accentText", 400);
    b([26, 79, 52, 15], 24, "accentText", "serif");
  } else if (layout === "section") {
    text("02", [6, 14, 22, 25], 104, { color: "background", font: "serif" });
    s([7, 48, 71, 1], "background");
    e([34, 17, 44, 6], "accentText");
    t([7, 54, 71, 24], 72, "serif", "accentText", 400);
    b([34, 83, 44, 13], 23, "accentText", "serif");
  } else if (layout === "closing") {
    e([9, 13, 69, 6], "accentText");
    s([9, 25, 69, 1], "background");
    t([9, 37, 69, 34], 88, "serif", "accentText", 400);
    b([28, 81, 50, 14], 24, "accentText", "serif");
    s([9, 82, 10, 1], "background");
  } else {
    text(pageNumber[layout], [5, 20, 12, 17], 48, { color: "background", font: "serif" });
    s([20, 10, 1, 80], "background");
    e([26, 10, 52, 5], "accentText");
    t([26, 22, 52, 23], 50, "serif", "accentText", 400);
    s([26, 49, 52, 1], "background");
    if (layout === "body") {
      b([26, 57, 51, 32], 27, "accentText", "serif");
    } else if (layout === "split") {
      s([50, 57, 1, 32], "background");
      split([26, 57, 20, 32], [55, 57, 23, 32], "accentText", "serif", 22);
    } else if (layout === "data") {
      metric([5, 58, 13, 29], "background", "accentText");
      table([26, 56, 52, 34]);
    } else if (layout === "image_left") {
      p([26, 56, 27, 34]);
      b([59, 58, 19, 30], 23, "accentText", "serif");
    } else {
      b([26, 58, 20, 30], 23, "accentText", "serif");
      p([52, 56, 26, 34]);
    }
  }
}

function ribbon(c: DesignComposer, layout: DesignLayoutId) {
  const {
    shape: s,
    title: t,
    eyebrow: e,
    body: b,
    folio: f,
    split,
    placeholder: p,
    table,
    metric,
  } = c;
  const loops = (x: number, y: number, scale = 1) => {
    s([x, y, 36 * scale, 17 * scale], "none", "ellipse", "accent");
    s([x + 25 * scale, y, 36 * scale, 17 * scale], "none", "ellipse", "text");
    s([x + 7 * scale, y + 4 * scale, 47 * scale, 9 * scale], "none", "ellipse", "accent");
  };
  if (layout === "cover") {
    loops(7, 5, 1.08);
    s([84, 0, 5, 100], "accent");
    s([92, 0, 2, 100], "surface");
    e([9, 27, 68, 6], "text");
    t([9, 40, 68, 33], 96);
    b([9, 82, 65, 14], 25, "text");
    f("01", [85, 91, 3, 5], "accentText");
  } else if (layout === "section") {
    s([6, 12, 29, 53], "none", "ellipse", "accent");
    s([14, 25, 23, 49], "none", "ellipse", "text");
    e([46, 16, 46, 6], "text");
    t([46, 33, 46, 33], 76);
    b([46, 78, 45, 17], 25);
    s([6, 85, 29, 3], "accent");
  } else if (layout === "closing") {
    s([7, 7, 86, 3], "accent");
    e([9, 20, 80, 6], "text");
    t([9, 34, 81, 35], 92);
    b([9, 81, 56, 15], 24);
    loops(72, 77, 0.32);
  } else {
    loops(7, 7, 0.34);
    e([34, 10, 55, 5], "text");
    t([9, 28, 80, 22], 54);
    s([94, 0, 3, 100], "accent");
    if (layout === "body") {
      b([9, 59, 69, 30], 29);
      s([86, 58, 3, 31], "accent");
      s([81, 58, 1, 31], "surface");
    } else if (layout === "split") {
      s([9, 57, 36, 1], "accent");
      s([53, 57, 36, 1], "accent");
      split([9, 64, 36, 26], [53, 64, 36, 26], "text", "sans", 23);
    } else if (layout === "data") {
      metric([9, 59, 23, 31]);
      table([38, 58, 51, 33]);
    } else if (layout === "image_left") {
      p([9, 58, 43, 33], true);
      b([59, 61, 30, 28], 25);
    } else {
      b([9, 61, 30, 28], 25);
      p([46, 58, 43, 33], true);
    }
    f(pageNumber[layout], [84, 93, 5, 5]);
  }
}

function mosaic(c: DesignComposer, layout: DesignLayoutId) {
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
  const quadrants = (x: number, y: number, scale = 1) => {
    s([x, y, 9 * scale, 15 * scale], "accent", "ellipse");
    s([x + 11 * scale, y, 9 * scale, 15 * scale], "none", "ellipse", "accent");
    s([x, y + 17 * scale, 9 * scale, 15 * scale], "text");
    s([x + 11 * scale, y + 17 * scale, 9 * scale, 15 * scale], "background", "diamond");
  };
  if (layout === "cover") {
    s([6, 8, 61, 13], "accent");
    e([9, 12, 55, 6], "accentText");
    s([70, 8, 24, 37], "surface");
    quadrants(72, 10);
    s([70, 48, 24, 44], "accent");
    s([73, 53, 18, 12], "accentText");
    s([73, 68, 7, 19], "background");
    s([82, 68, 9, 19], "text", "ellipse");
    t([9, 31, 55, 39], 92);
    b([9, 79, 55, 16], 25);
    f("01", [85, 93, 8, 5]);
  } else if (layout === "section") {
    s([6, 8, 27, 28], "accent");
    text("02", [10, 14, 19, 17], 70, { color: "accentText", weight: 700 });
    s([6, 39, 27, 53], "surface");
    quadrants(9.5, 48);
    e([40, 13, 53, 6], "text");
    t([40, 31, 53, 37], 80);
    b([40, 79, 51, 16], 25);
  } else if (layout === "closing") {
    s([6, 8, 88, 13], "accent");
    e([10, 12, 80, 6], "accentText");
    s([6, 27, 13, 65], "surface");
    s([9, 33, 7, 12], "accent", "ellipse");
    s([9, 48, 7, 12], "text");
    s([9, 63, 7, 12], "accent", "diamond");
    t([26, 34, 67, 36], 88);
    b([26, 81, 64, 14], 24);
  } else {
    s([6, 7, 12, 31], "accent");
    s([9, 12, 6, 10], "accentText", "ellipse");
    s([9, 25, 6, 8], "background");
    e([25, 9, 68, 5], "text");
    t([25, 21, 68, 23], 54);
    if (layout === "body") {
      s([6, 51, 12, 39], "surface");
      s([9, 57, 6, 27], "accent");
      b([25, 55, 64, 32], 29);
    } else if (layout === "split") {
      s([6, 51, 40, 39], "surface");
      s([53, 51, 40, 39], "surface");
      s([6, 51, 6, 6], "accent");
      s([90, 84, 6, 6], "accent");
      split([11, 58, 30, 28], [58, 58, 30, 28], "text", "sans", 23);
    } else if (layout === "data") {
      s([6, 51, 26, 39], "accent");
      metric([10, 56, 19, 30], "accentText", "accentText");
      table([39, 51, 54, 39]);
    } else if (layout === "image_left") {
      s([6, 51, 45, 39], "accent");
      p([9, 55, 39, 31]);
      b([59, 55, 34, 31], 25);
    } else {
      b([6, 55, 34, 31], 25);
      s([48, 51, 45, 39], "accent");
      p([51, 55, 39, 31]);
    }
    f(pageNumber[layout], [85, 93, 8, 5]);
  }
}

function linen(c: DesignComposer, layout: DesignLayoutId) {
  const {
    shape: s,
    title: t,
    eyebrow: e,
    body: b,
    folio: f,
    split,
    placeholder: p,
    table,
    metric,
  } = c;
  // Restrained selvage stripes and small binding tabs, without a centred editorial masthead.
  s([4, 5, 92, 90], "none", "rectangle", "muted");
  s([8, 11, 1, 78], "accent");
  s([10, 11, 1, 78], "muted");
  s([12, 11, 1, 78], "accent");
  s([22, 4, 14, 2.5], "accent");
  s([72, 93.5, 13, 2.5], "surface", "rectangle", "muted");
  if (layout === "cover") {
    e([19, 16, 68, 6], "text");
    t([19, 34, 68, 34], 94, "sans", "text", 500);
    s([19, 75, 18, 1], "accent");
    b([19, 81, 66, 12], 24, "muted");
    f("01", [84, 8, 7, 5]);
  } else if (layout === "section") {
    e([19, 15, 69, 6], "text");
    t([19, 31, 69, 36], 80, "sans", "text", 500);
    s([19, 77, 13, 1], "accent");
    s([19, 82, 13, 1], "muted");
    b([40, 77, 48, 16], 24);
    f("02", [84, 8, 7, 5]);
  } else if (layout === "closing") {
    e([19, 16, 69, 6], "text");
    t([19, 34, 69, 34], 88, "sans", "text", 500);
    s([19, 75, 69, 1], "muted");
    b([19, 82, 66, 11], 24);
    f("08", [84, 8, 7, 5]);
  } else {
    e([19, 11, 60, 5], "text");
    t([19, 23, 69, 22], 52, "sans", "text", 500);
    s([19, 49, 69, 1], "muted");
    if (layout === "body") {
      s([84, 56, 1, 31], "accent");
      s([86, 56, 1, 31], "muted");
      s([88, 56, 1, 31], "accent");
      b([19, 57, 57, 31], 28);
    } else if (layout === "split") {
      s([53, 57, 1, 31], "muted");
      split([19, 57, 28, 31], [60, 57, 28, 31], "text", "sans", 23);
    } else if (layout === "data") {
      metric([19, 58, 19, 30]);
      table([44, 56, 44, 33]);
    } else if (layout === "image_left") {
      p([19, 56, 33, 33]);
      b([59, 58, 29, 29], 25);
    } else {
      b([19, 58, 29, 29], 25);
      p([55, 56, 33, 33]);
    }
    f(pageNumber[layout], [84, 8, 7, 5]);
  }
}

function beacon(c: DesignComposer, layout: DesignLayoutId) {
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
  const sun = (x: number, y: number, scale = 1) => {
    s([x + 4 * scale, y + 7 * scale, 14 * scale, 25 * scale], "accent", "ellipse");
    s([x + 10.5 * scale, y, Math.max(1, scale), 4 * scale], "accent");
    s([x + 10.5 * scale, y + 35 * scale, Math.max(1, scale), 4 * scale], "accent");
    s([x, y + 18.5 * scale, 2.5 * scale, Math.max(1, 1.2 * scale)], "accent");
    s([x + 19.5 * scale, y + 18.5 * scale, 2.5 * scale, Math.max(1, 1.2 * scale)], "accent");
    s(
      [x + 1 * scale, y + 4 * scale, Math.max(1, scale), 5 * scale],
      "accent",
      "rectangle",
      "none",
      -43,
    );
    s(
      [x + 20 * scale, y + 30 * scale, Math.max(1, scale), 5 * scale],
      "accent",
      "rectangle",
      "none",
      -43,
    );
  };
  const stairs = (x: number, y: number, scale = 1) => {
    s([x, y + 14 * scale, 7 * scale, 9 * scale], "surface");
    s([x + 7 * scale, y + 7 * scale, 7 * scale, 16 * scale], "surface");
    s([x + 14 * scale, y, 7 * scale, 23 * scale], "surface");
    s([x, y + 14 * scale, 7 * scale, Math.max(1, 0.6 * scale)], "accent");
    s([x + 7 * scale, y + 7 * scale, 7 * scale, Math.max(1, 0.6 * scale)], "accent");
    s([x + 14 * scale, y, 7 * scale, Math.max(1, 0.6 * scale)], "accent");
  };
  if (layout === "cover") {
    sun(74, 6, 0.95);
    stairs(74, 70, 0.95);
    e([9, 11, 57, 6]);
    t([9, 31, 62, 41], 100, "sans", "text", 700);
    b([9, 82, 58, 14], 25, "muted");
    f("01", [88, 93, 6, 5], "accent");
  } else if (layout === "section") {
    sun(7, 12, 0.8);
    s([6, 70, 26, 21], "surface");
    text("02", [10, 73, 18, 16], 65, { color: "accent", weight: 700 });
    e([40, 16, 52, 6]);
    t([40, 33, 52, 33], 78);
    b([40, 79, 51, 16], 25, "muted");
  } else if (layout === "closing") {
    s([0, 0, 6, 100], "accent");
    sun(75, 7, 0.75);
    e([14, 15, 57, 6]);
    t([14, 34, 76, 35], 92);
    b([14, 82, 56, 14], 25, "muted");
    stairs(77, 78, 0.65);
  } else {
    sun(82, 6, 0.45);
    e([8, 10, 66, 5]);
    t([8, 23, 73, 23], 54);
    s([8, 50, 84, 1], "accent");
    if (layout === "body") {
      b([8, 59, 60, 31], 29);
      stairs(74, 65, 0.85);
    } else if (layout === "split") {
      s([8, 57, 39, 33], "surface");
      s([53, 61, 39, 29], "surface");
      split([12, 61, 31, 26], [57, 61, 31, 29], "text", "sans", 22);
    } else if (layout === "data") {
      metric([8, 59, 24, 31]);
      table([39, 57, 53, 34]);
    } else if (layout === "image_left") {
      p([8, 57, 43, 34]);
      s([53, 85, 6, 6], "accent");
      b([61, 60, 31, 29], 25);
    } else {
      b([8, 60, 31, 29], 25);
      s([41, 85, 6, 6], "accent");
      p([49, 57, 43, 34]);
    }
    f(pageNumber[layout], [86, 93, 6, 5], "accent");
  }
}

/** Original, editable compositions; each collection owns every layout's full geometry. */
export const expressiveDesignCollections = {
  botanica,
  archive,
  workshop,
  scholar,
  ribbon,
  mosaic,
  linen,
  beacon,
} satisfies Record<string, (composer: DesignComposer, layout: DesignLayoutId) => void>;
