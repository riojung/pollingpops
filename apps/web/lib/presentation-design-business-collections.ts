import type { DesignComposer } from "./presentation-design-composer";
import type { DesignLayoutId } from "./presentation-designs";

const page = (layout: DesignLayoutId) =>
  ({
    cover: "01",
    section: "02",
    body: "03",
    split: "04",
    image_left: "05",
    image_right: "06",
    data: "07",
    closing: "08",
  })[layout];

function atlas(c: DesignComposer, layout: DesignLayoutId) {
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
  // The forest palette's pale text token becomes a paper map; dark ink is explicit.
  s([0, 0, 100, 100], "text");
  if (layout === "cover") {
    s([68, 25, 1, 64], "background");
    s([52, 66, 41, 1], "background");
    s([76, 42, 12, 1], "background");
    s([87.5, 42, 1, 18], "background");
    s([53, 75, 1, 14], "background");
    s([53, 88.5, 10, 1], "background");
    s([75, 73, 15, 13], "accent");
    s([6, 10, 10, 1], "background");
    e([20, 7, 64, 7], "accentText");
    t([6, 24, 58, 37], 96, "sans", "accentText", 700);
    b([7, 72, 39, 20], 25, "accentText");
  } else if (layout === "section") {
    s([7, 24, 24, 1], "background");
    s([7, 24, 1, 59], "background");
    s([7, 82.5, 24, 1], "background");
    text("02", [11, 41, 19, 23], 88, { font: "mono", color: "accentText" });
    e([39, 16, 53, 7], "accentText");
    t([39, 31, 54, 32], 70, "sans", "accentText");
    b([39, 72, 51, 19], 25, "accentText");
  } else if (layout === "closing") {
    s([7, 18, 1, 61], "background");
    s([7, 18, 16, 1], "background");
    s([7, 78.5, 16, 1], "background");
    s([82, 18, 11, 1], "background");
    s([92.5, 18, 1, 61], "background");
    s([82, 78.5, 11, 1], "background");
    e([14, 14, 62, 7], "accentText");
    t([14, 31, 72, 32], 88, "sans", "accentText");
    b([14, 70, 64, 18], 25, "accentText");
  } else {
    e([7, 7, 77, 6], "accentText");
    t([7, 20, 85, 20], 54, "sans", "accentText");
    s([7, 43, 86, 1], "background");
    if (layout === "body") {
      s([7, 51, 1, 36], "background");
      s([7, 51, 8, 1], "background");
      s([7, 86.5, 8, 1], "background");
      b([20, 52, 55, 35], 30, "accentText");
      s([84, 53, 1, 31], "background");
      s([78, 68, 13, 1], "background");
    } else if (layout === "split") {
      s([50, 51, 1, 36], "background");
      s([7, 51, 8, 1], "background");
      s([85, 86.5, 8, 1], "background");
      split([7, 55, 37, 32], [57, 55, 36, 32], "accentText", "sans", 24);
    } else if (layout === "data") {
      s([7, 49, 25, 39], "accent");
      metric([10, 53, 20, 32], "accentText", "accentText");
      table([39, 49, 54, 39]);
    } else if (layout === "image_left") {
      p([7, 50, 44, 38]);
      s([56, 50, 1, 38], "background");
      b([62, 52, 31, 34], 26, "accentText");
    } else {
      b([7, 52, 33, 34], 26, "accentText");
      s([45, 50, 1, 38], "background");
      p([51, 50, 42, 38]);
    }
  }
  f(page(layout), [87, 92, 6, 5], "accentText");
}

function ledger(c: DesignComposer, layout: DesignLayoutId) {
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
  s([6, 93, 88, 1], "text");
  if (layout === "cover") {
    s([6, 7, 15, 79], "text");
    text("01", [8, 12, 11, 16], 50, { color: "accentText", font: "mono" });
    for (let i = 0; i < 5; i++) s([9, 58 + i * 5, 9, 1], "accentText");
    e([27, 7, 66, 7], "text");
    s([27, 20, 67, 1], "text");
    t([27, 29, 67, 37], 94, "mono", "text", 500);
    s([27, 72, 67, 1], "text");
    b([42, 77, 52, 15], 23, "text", "mono");
  } else if (layout === "section") {
    s([6, 8, 88, 1], "text");
    e([6, 13, 72, 7], "text");
    text("02", [6, 31, 22, 26], 100, { font: "mono", weight: 500 });
    s([32, 28, 1, 58], "text");
    t([39, 30, 55, 31], 66, "mono", "text", 500);
    s([39, 67, 55, 1], "text");
    b([39, 74, 55, 16], 24, "text", "mono");
  } else if (layout === "closing") {
    e([6, 9, 83, 7], "text");
    s([6, 22, 88, 1.5], "text");
    t([6, 35, 88, 32], 90, "mono", "text", 500);
    s([6, 73, 88, 1], "text");
    b([34, 79, 60, 12], 24, "text", "mono");
    text("08", [6, 79, 16, 11], 32, { font: "mono" });
  } else {
    e([6, 7, 78, 6], "text");
    s([6, 18, 88, 1], "text");
    t([6, 25, 88, 19], 50, "mono", "text", 500);
    s([6, 49, 88, 1], "text");
    if (layout === "body") {
      text("01", [6, 57, 12, 9], 24, { font: "mono" });
      s([21, 56, 1, 30], "text");
      b([28, 57, 66, 30], 28, "text", "mono");
    } else if (layout === "split") {
      s([49, 55, 1, 32], "text");
      split([6, 57, 37, 30], [56, 57, 38, 30], "text", "mono", 23);
    } else if (layout === "data") {
      metric([6, 56, 22, 32], "text", "text");
      s([32, 55, 1, 33], "text");
      table([38, 54, 56, 34]);
    } else if (layout === "image_left") {
      p([6, 55, 45, 33]);
      b([58, 57, 36, 29], 24, "text", "mono");
    } else {
      b([6, 57, 36, 29], 24, "text", "mono");
      p([49, 55, 45, 33]);
    }
  }
  f(page(layout), [87, 94, 7, 5], "text");
}

function prism(c: DesignComposer, layout: DesignLayoutId) {
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
  // A pale launch canvas and open triangular planes differ from Signal's solid diamonds.
  s([0, 0, 100, 100], "accentText");
  if (layout === "cover") {
    s([65, 0, 35, 100], "background", "triangle", "none", 180);
    s([76, 43, 24, 57], "text", "triangle");
    s([66, 78, 12, 22], "surface", "triangle");
    e([7, 10, 55, 7], "text");
    t([7, 27, 57, 38], 104, "sans", "text", 900);
    s([7, 73, 9, 1.7], "background");
    b([7, 80, 51, 15], 25, "text");
  } else if (layout === "section") {
    s([0, 0, 27, 100], "background", "triangle", "none", 180);
    text("02", [7, 13, 21, 22], 78, { weight: 900 });
    e([35, 15, 58, 7], "text");
    t([35, 31, 58, 33], 76, "sans", "text", 900);
    b([35, 74, 55, 18], 26);
  } else if (layout === "closing") {
    s([70, 0, 30, 100], "background", "triangle");
    s([86, 51, 14, 49], "text", "triangle");
    e([7, 13, 65, 7], "text");
    t([7, 31, 68, 35], 96, "sans", "text", 900);
    b([7, 78, 60, 17], 26);
  } else {
    s([90, 0, 10, 20], "background", "triangle", "none", 180);
    e([7, 8, 76, 6], "text");
    t([7, 21, 83, 20], 56, "sans", "text", 900);
    if (layout === "body") {
      s([7, 51, 4, 36], "background");
      b([17, 53, 51, 34], 30);
      s([75, 52, 18, 35], "background", "triangle");
      s([80, 64, 8, 16], "accentText", "triangle");
    } else if (layout === "split") {
      s([7, 49, 39, 4], "background");
      s([54, 49, 39, 4], "text");
      split([7, 59, 38, 29], [54, 59, 39, 29], "text", "sans", 24);
    } else if (layout === "data") {
      s([7, 49, 25, 39], "background");
      metric([10, 53, 20, 32], "text", "text");
      table([39, 49, 54, 39]);
    } else if (layout === "image_left") {
      s([5, 48, 46, 42], "background");
      p([7, 50, 42, 38]);
      b([57, 52, 36, 34], 27);
    } else {
      b([7, 52, 36, 34], 27);
      s([50, 48, 45, 42], "background");
      p([52, 50, 41, 38]);
    }
  }
  f(
    page(layout),
    [87, 93, 6, 5],
    layout === "cover" || layout === "closing" ? "accentText" : "text",
  );
}

function folio(c: DesignComposer, layout: DesignLayoutId) {
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
  s([4, 5, 92, 90], "none", "rectangle", "muted");
  s([11, 5, 1, 90], "muted");
  if (layout === "cover") {
    s([16, 13, 72, 79], "none", "rectangle", "text");
    e([22, 19, 60, 7], "text", "center");
    s([42, 31, 20, 1], "accent");
    t([22, 38, 60, 32], 96, "serif", "text", 400, "center");
    b([27, 75, 51, 15], 24, "text", "serif");
  } else if (layout === "section") {
    text("02", [17, 15, 22, 24], 96, { font: "serif", color: "accent" });
    s([17, 45, 18, 1], "text");
    e([43, 17, 44, 7], "text");
    t([43, 33, 44, 32], 68, "serif", "text", 400);
    b([43, 73, 44, 17], 25, "text", "serif");
  } else if (layout === "closing") {
    e([18, 15, 69, 7], "text", "center");
    s([18, 27, 69, 1], "text");
    t([18, 38, 69, 29], 88, "serif", "text", 400, "center");
    s([46, 73, 14, 1], "accent");
    b([26, 79, 53, 12], 24, "text", "serif");
  } else {
    e([17, 11, 69, 6], "text");
    t([17, 24, 70, 19], 54, "serif", "text", 400);
    s([17, 47, 70, 1], "muted");
    if (layout === "body") {
      s([17, 54, 7, 1], "accent");
      b([29, 54, 58, 33], 29, "text", "serif");
    } else if (layout === "split") {
      s([51, 54, 1, 33], "muted");
      split([17, 55, 28, 32], [57, 55, 30, 32], "text", "serif", 24);
    } else if (layout === "data") {
      metric([17, 55, 20, 32], "accent", "text");
      table([42, 53, 45, 35]);
    } else if (layout === "image_left") {
      s([17, 53, 35, 35], "none", "rectangle", "text");
      p([19, 55, 31, 31]);
      b([59, 56, 28, 29], 25, "text", "serif");
    } else {
      b([17, 56, 29, 29], 25, "text", "serif");
      s([53, 53, 34, 35], "none", "rectangle", "text");
      p([55, 55, 30, 31]);
    }
  }
  f(page(layout), [5, 85, 5, 6], "text");
}

function horizon(c: DesignComposer, layout: DesignLayoutId) {
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
    s([71, 11, 19, 34], "accent", "ellipse");
    s([0, 38, 100, 12], "surface");
    s([0, 38, 100, 1], "accent");
    e([7, 10, 59, 7]);
    t([7, 53, 86, 29], 92, "mono", "text", 500);
    b([7, 86, 74, 11], 23, "muted", "mono");
  } else if (layout === "section") {
    s([0, 25, 100, 1], "accent");
    s([79, 18, 8, 14], "accent", "ellipse");
    e([7, 9, 68, 7]);
    text("02", [7, 32, 17, 18], 64, { color: "accent", font: "mono" });
    t([28, 38, 65, 31], 68, "mono", "text", 500);
    b([28, 78, 63, 14], 24, "muted", "mono");
  } else if (layout === "closing") {
    e([7, 12, 78, 7]);
    t([7, 30, 85, 32], 88, "mono", "text", 500);
    s([0, 70, 100, 1], "accent");
    s([8, 67, 4, 7], "accent", "ellipse");
    s([48, 67, 4, 7], "accent", "ellipse");
    s([88, 67, 4, 7], "accent", "ellipse");
    b([7, 81, 75, 14], 24, "muted", "mono");
  } else {
    e([7, 7, 77, 6]);
    t([7, 20, 86, 20], 52, "mono", "text", 500);
    s([0, 46, 100, 1], "accent");
    s([7, 43, 4, 7], "accent", "ellipse");
    if (layout === "body") {
      b([7, 56, 68, 31], 29, "text", "mono");
      s([83, 58, 10, 18], "accent", "ellipse");
      s([80, 76, 16, 1], "accent");
    } else if (layout === "split") {
      s([54, 43, 4, 7], "accent", "ellipse");
      split([7, 56, 37, 32], [54, 56, 39, 32], "text", "mono", 23);
    } else if (layout === "data") {
      metric([7, 56, 24, 32], "accent", "text");
      table([38, 53, 55, 36]);
    } else if (layout === "image_left") {
      p([7, 54, 45, 35]);
      b([59, 56, 34, 31], 25, "text", "mono");
    } else {
      b([7, 56, 35, 31], 25, "text", "mono");
      p([49, 54, 44, 35]);
    }
  }
  f(page(layout), [87, 93, 6, 5], "muted");
}

function circuit(c: DesignComposer, layout: DesignLayoutId) {
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
    s([72, 13, 9, 16], "none", "rectangle", "accent");
    s([76, 29, 1, 19], "accent");
    s([76, 47.5, 15, 1], "accent");
    s([90.5, 48, 1, 27], "accent");
    s([72, 74.5, 19, 1], "accent");
    s([65, 69, 7, 12], "none", "rectangle", "accent");
    s([83, 39, 5, 9], "surface");
    e([7, 11, 54, 7]);
    t([7, 29, 55, 39], 90, "mono", "text", 500);
    b([7, 79, 54, 17], 24, "muted", "mono");
  } else if (layout === "section") {
    s([7, 15, 18, 32], "none", "rectangle", "accent");
    text("02", [9, 23, 14, 16], 57, { color: "accent", font: "mono" });
    s([25, 30, 8, 1], "accent");
    s([32.5, 30, 1, 45], "accent");
    s([33, 74.5, 8, 1], "accent");
    e([41, 17, 52, 7]);
    t([41, 34, 52, 31], 66, "mono", "text", 500);
    b([41, 76, 50, 16], 24, "muted", "mono");
  } else if (layout === "closing") {
    s([7, 13, 5, 9], "none", "rectangle", "accent");
    e([18, 14, 74, 7]);
    t([7, 33, 85, 32], 88, "mono", "text", 500);
    s([7, 73, 73, 1], "accent");
    s([79.5, 73, 1, 12], "accent");
    s([80, 84.5, 8, 1], "accent");
    s([88, 80, 5, 9], "none", "rectangle", "accent");
    b([7, 82, 65, 14], 24, "muted", "mono");
  } else {
    s([7, 8, 3, 5], "none", "rectangle", "accent");
    e([15, 7, 69, 6]);
    t([7, 21, 86, 20], 52, "mono", "text", 500);
    s([7, 46, 76, 1], "accent");
    s([82.5, 46, 1, 5], "accent");
    s([83, 50.5, 10, 1], "accent");
    if (layout === "body") {
      s([7, 55, 2, 32], "accent");
      b([16, 56, 65, 32], 28, "text", "mono");
      s([87, 72, 6, 11], "none", "rectangle", "accent");
    } else if (layout === "split") {
      s([48, 56, 1, 31], "accent");
      s([48, 56, 4, 1], "accent");
      split([7, 57, 35, 31], [58, 57, 35, 31], "text", "mono", 23);
    } else if (layout === "data") {
      s([7, 55, 24, 33], "none", "rectangle", "accent");
      metric([10, 58, 18, 28], "accent", "text");
      table([38, 54, 55, 35]);
    } else if (layout === "image_left") {
      p([7, 55, 43, 34]);
      b([57, 57, 36, 30], 25, "text", "mono");
    } else {
      b([7, 57, 36, 30], 25, "text", "mono");
      p([50, 55, 43, 34]);
    }
  }
  f(page(layout), [87, 93, 6, 5], "accent");
}

function slate(c: DesignComposer, layout: DesignLayoutId) {
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
    s([38, 12, 55, 13], "surface");
    s([23, 29, 70, 43], "surface");
    s([7, 77, 70, 16], "surface");
    e([7, 13, 28, 8]);
    t([7, 34, 80, 32], 100, "sans", "text", 600);
    b([11, 80, 61, 11], 24, "text");
    s([83, 81, 10, 1], "accent");
  } else if (layout === "section") {
    s([7, 15, 25, 18], "surface");
    text("02", [11, 17, 17, 14], 46, { color: "accent", font: "sans", weight: 600 });
    e([39, 19, 54, 7]);
    s([7, 41, 86, 29], "surface");
    t([11, 45, 78, 21], 66, "sans", "text", 600);
    b([39, 77, 54, 15], 25, "muted");
  } else if (layout === "closing") {
    s([7, 16, 63, 10], "surface");
    e([11, 18, 55, 6]);
    s([15, 33, 78, 36], "surface");
    t([20, 39, 68, 25], 84, "sans", "text", 600);
    s([7, 77, 63, 16], "surface");
    b([11, 80, 55, 11], 24);
    s([79, 82, 14, 1], "accent");
  } else {
    s([7, 7, 69, 9], "surface");
    e([10, 9, 63, 6]);
    t([7, 25, 86, 20], 54, "sans", "text", 600);
    if (layout === "body") {
      s([20, 54, 73, 34], "surface");
      s([7, 54, 7, 2], "accent");
      b([25, 59, 63, 25], 29);
    } else if (layout === "split") {
      s([7, 53, 40, 35], "surface");
      s([53, 56, 40, 33], "surface");
      split([11, 57, 32, 30], [57, 60, 32, 28], "text", "sans", 23);
    } else if (layout === "data") {
      s([7, 54, 25, 34], "surface");
      metric([10, 57, 19, 28], "accent", "text");
      table([39, 53, 54, 36]);
    } else if (layout === "image_left") {
      p([7, 53, 44, 36]);
      s([57, 59, 36, 30], "surface");
      b([61, 63, 28, 22], 25);
    } else {
      s([7, 59, 36, 30], "surface");
      b([11, 63, 28, 22], 25);
      p([49, 53, 44, 36]);
    }
  }
  f(page(layout), [87, 93, 6, 5], "muted");
}

function spectrum(c: DesignComposer, layout: DesignLayoutId) {
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
    s([7, 10, 20, 80], "text");
    text("01", [9, 17, 16, 22], 72, { color: "accentText", font: "mono", weight: 500 });
    s([75, 69, 5, 21], "surface");
    s([82, 77, 5, 13], "accentText");
    s([89, 85, 5, 5], "text");
    e([34, 10, 60, 7], "text");
    t([34, 29, 60, 36], 90, "mono", "text", 500);
    b([34, 70, 35, 24], 24, "text", "mono");
  } else if (layout === "section") {
    s([7, 9, 11, 80], "surface");
    s([21, 35, 6, 54], "accentText");
    text("02", [34, 12, 22, 20], 72, { color: "text", font: "mono", weight: 500 });
    e([63, 16, 30, 9], "text");
    t([34, 42, 59, 29], 68, "mono", "text", 500);
    b([34, 76, 59, 16], 24, "text", "mono");
  } else if (layout === "closing") {
    s([7, 12, 4, 78], "text");
    s([14, 38, 4, 52], "accentText");
    s([21, 64, 4, 26], "surface");
    e([33, 14, 60, 7], "text");
    t([33, 34, 60, 33], 86, "mono", "text", 500);
    b([33, 76, 58, 16], 25, "text", "mono");
  } else {
    s([7, 8, 4, 10], "text");
    e([17, 9, 75, 7], "text");
    t([7, 27, 86, 20], 52, "mono", "text", 500);
    if (layout === "body") {
      s([7, 55, 11, 34], "text");
      text("01", [8, 59, 9, 11], 28, { color: "accentText", font: "mono" });
      s([21, 67, 4, 22], "accentText");
      b([33, 56, 60, 32], 29, "text", "mono");
    } else if (layout === "split") {
      s([7, 55, 3, 34], "text");
      s([53, 55, 3, 34], "accentText");
      split([15, 56, 31, 32], [61, 56, 32, 32], "text", "mono", 23);
    } else if (layout === "data") {
      s([7, 54, 25, 35], "text");
      metric([10, 57, 19, 29], "accentText", "accentText");
      table([39, 53, 54, 36]);
    } else if (layout === "image_left") {
      p([7, 54, 43, 35]);
      s([53, 54, 3, 35], "text");
      b([62, 56, 31, 31], 25, "text", "mono");
    } else {
      b([7, 56, 32, 31], 25, "text", "mono");
      s([45, 54, 3, 35], "text");
      p([51, 54, 42, 35]);
    }
  }
  f(page(layout), [87, 93, 6, 5], "text");
}

/** Original business compositions use native shapes, text, image slots and data tables. */
export const businessDesignCollections = {
  atlas,
  ledger,
  prism,
  folio,
  horizon,
  circuit,
  slate,
  spectrum,
};
