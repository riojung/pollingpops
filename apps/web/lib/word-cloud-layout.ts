export type WordCloudTerm = { value: string; label: string; count: number };

export type PositionedWordCloudTerm = WordCloudTerm & {
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  lines: string[];
};

export const WORD_CLOUD_VISIBLE_LIMIT = 40;

type TextMeasure = (text: string, fontSize: number) => number;

export type WordCloudLayout = {
  width: number;
  height: number;
  words: PositionedWordCloudTerm[];
  omittedCount: number;
};

const EDGE = 12;
const GAP = 7;
const SEARCH_POINTS = 2_600;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Absolute frequency matters, so a lone repeated response can still grow. */
export function wordCloudFontSize(count: number, compact = false): number {
  const frequency = Math.log2(1 + Math.max(1, Number.isFinite(count) ? count : 1));
  return (compact ? 14 : 17) + (compact ? 43 : 54) * (frequency / (7 + frequency));
}

function compareValues(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function hash(value: string): number {
  let result = 2_166_136_261;
  for (const character of value) {
    result ^= character.codePointAt(0) ?? 0;
    result = Math.imul(result, 16_777_619);
  }
  return result >>> 0;
}

/** A conservative server fallback; the mounted visual uses actual font metrics. */
function estimateText(text: string, fontSize: number): number {
  let width = 0;
  for (const { segment } of graphemes.segment(text)) {
    if (/^\s+$/u.test(segment)) width += 0.36;
    else if (/^[ilI.,'!|:;]$/u.test(segment)) width += 0.34;
    else if (/^[mwMW@%]$/u.test(segment)) width += 0.96;
    else if (/^[\p{Script=Latin}\p{Number}\p{Punctuation}]+$/u.test(segment)) width += 0.68;
    else width += 1.12;
  }
  return width * fontSize;
}

function wrapLabel(label: string, maxWidth: number, fontSize: number, measure: TextMeasure) {
  const lines: string[] = [];
  let line = "";
  // Prefer word boundaries, while allowing a single long token to wrap by grapheme.
  for (const token of label.split(/(\s+)/u)) {
    if (!token) continue;
    if (measure(line + token, fontSize) <= maxWidth) {
      line += token;
      continue;
    }
    if (line.trim()) {
      lines.push(line.trim());
      line = "";
    }
    if (!token.trim()) continue;
    for (const { segment } of graphemes.segment(token)) {
      if (line && measure(line + segment, fontSize) > maxWidth) {
        lines.push(line);
        line = "";
      }
      line += segment;
    }
  }
  if (line.trim()) lines.push(line.trim());
  return lines.length ? lines : [label];
}

function intersects(a: PositionedWordCloudTerm, b: PositionedWordCloudTerm): boolean {
  return (
    a.x < b.x + b.width + GAP &&
    a.x + a.width + GAP > b.x &&
    a.y < b.y + b.height + GAP &&
    a.y + a.height + GAP > b.y
  );
}

function pack(words: PositionedWordCloudTerm[], width: number, height: number) {
  const placed: PositionedWordCloudTerm[] = [];
  for (const word of words) {
    const candidates = [{ x: (width - word.width) / 2, y: (height - word.height) / 2 }];
    // Touching existing box edges finds useful pockets before the bounded spiral.
    for (const other of placed) {
      const xs = [
        other.x,
        other.x + (other.width - word.width) / 2,
        other.x + other.width - word.width,
      ];
      const ys = [
        other.y,
        other.y + (other.height - word.height) / 2,
        other.y + other.height - word.height,
      ];
      for (const x of xs) {
        candidates.push({ x, y: other.y - word.height - GAP });
        candidates.push({ x, y: other.y + other.height + GAP });
      }
      for (const y of ys) {
        candidates.push({ x: other.x - word.width - GAP, y });
        candidates.push({ x: other.x + other.width + GAP, y });
      }
    }
    const distance = ({ x, y }: { x: number; y: number }) =>
      ((x + word.width / 2 - width / 2) / width) ** 2 +
      ((y + word.height / 2 - height / 2) / height) ** 2;
    candidates.sort((a, b) => distance(a) - distance(b) || a.y - b.y || a.x - b.x);
    const fits = ({ x, y }: { x: number; y: number }) =>
      x >= EDGE &&
      y >= EDGE &&
      x + word.width <= width - EDGE &&
      y + word.height <= height - EDGE &&
      !placed.some((other) => intersects({ ...word, x, y }, other));
    const pocket = candidates.find(fits);
    if (pocket) {
      placed.push({ ...word, ...pocket });
      continue;
    }
    const phase = ((hash(word.value) % 360) / 180) * Math.PI;
    let found = false;
    // Equal-area, center-out samples cover an ellipse without random render state.
    for (let attempt = 0; attempt < SEARCH_POINTS; attempt++) {
      const radius = Math.sqrt(attempt / SEARCH_POINTS);
      const angle = attempt * GOLDEN_ANGLE + phase;
      const x = width / 2 + Math.cos(angle) * radius * (width / 2 - EDGE) - word.width / 2;
      const y = height / 2 + Math.sin(angle) * radius * (height / 2 - EDGE) - word.height / 2;
      if (!fits({ x, y })) continue;
      const candidate = { ...word, x, y };
      placed.push(candidate);
      found = true;
      break;
    }
    if (!found) return null;
  }
  return placed;
}

/** Bounded, deterministic layout of the most frequent terms, with no dropped labels. */
export function layoutWordCloud(
  terms: readonly WordCloudTerm[],
  {
    width: requestedWidth = 640,
    compact = false,
    measureText = estimateText,
  }: { width?: number; compact?: boolean; measureText?: TextMeasure } = {},
): WordCloudLayout {
  const width = Math.max(120, Number.isFinite(requestedWidth) ? requestedWidth : 640);
  const eligible = terms
    .filter((term) => term.label.trim() && Number.isFinite(term.count) && term.count > 0)
    .slice()
    .sort((a, b) => b.count - a.count || compareValues(a.value, b.value));
  const selected = eligible.slice(0, WORD_CLOUD_VISIBLE_LIMIT);
  const measure: TextMeasure = (text, size) => {
    const measured = measureText(text, size);
    return Number.isFinite(measured) && measured >= 0 ? measured : estimateText(text, size);
  };
  const density =
    selected.length <= 2
      ? 1.6
      : selected.length <= 5
        ? 1.15
        : selected.length > 25
          ? 0.82
          : selected.length > 15
            ? 0.92
            : 1;
  const projection = Math.min(1.55, Math.max(0.72, width / 680));
  const words = selected.map((term): PositionedWordCloudTerm => {
    let fontSize = Math.max(
      compact ? 14 : 15,
      wordCloudFontSize(term.count, compact) * density * projection,
    );
    const maxWidth = Math.max(40, Math.min(width - EDGE * 2 - 8, width * 0.78));
    const widestGrapheme = Math.max(
      1,
      ...Array.from(graphemes.segment(term.label), ({ segment }) => measure(segment, fontSize)),
    );
    // Even a single very wide emoji cluster must remain inside its box.
    fontSize *= Math.min(1, maxWidth / widestGrapheme);
    const lines = wrapLabel(term.label, maxWidth, fontSize, measure);
    const textWidth = Math.max(...lines.map((line) => measure(line, fontSize)));
    return {
      ...term,
      x: 0,
      y: 0,
      fontSize,
      width: Math.min(width - EDGE * 2, Math.ceil(textWidth + 8)),
      height: Math.ceil(lines.length * fontSize * 1.35 + 4),
      lines,
    };
  });
  const area = words.reduce((sum, word) => sum + (word.width + GAP) * (word.height + GAP), 0);
  let height = Math.ceil(
    Math.max(
      compact ? 200 : 280,
      area / (width * 0.68),
      ...words.map((word) => word.height + EDGE * 2),
    ),
  );
  for (let pass = 0; pass < 5; pass++) {
    const placed = pack(words, width, height);
    if (placed)
      return { width, height, words: placed, omittedCount: eligible.length - selected.length };
    height = Math.ceil(height * 1.3);
  }
  // Pathological long labels still have a finite, readable, collision-free fallback.
  let y = EDGE;
  const stacked = words.map((word) => {
    const positioned = { ...word, x: (width - word.width) / 2, y };
    y += word.height + GAP;
    return positioned;
  });
  return {
    width,
    height: Math.max(compact ? 200 : 280, y + EDGE),
    words: stacked,
    omittedCount: eligible.length - selected.length,
  };
}
