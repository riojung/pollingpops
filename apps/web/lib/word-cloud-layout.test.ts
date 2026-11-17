import { describe, expect, it } from "vitest";
import {
  layoutWordCloud,
  WORD_CLOUD_VISIBLE_LIMIT,
  wordCloudFontSize,
  type WordCloudLayout,
} from "./word-cloud-layout";

function expectReadableBounds(layout: WordCloudLayout) {
  expect(Number.isFinite(layout.height)).toBe(true);
  expect(layout.height).toBeGreaterThan(0);
  for (const word of layout.words) {
    for (const metric of [word.x, word.y, word.width, word.height, word.fontSize]) {
      expect(Number.isFinite(metric)).toBe(true);
      expect(metric).toBeGreaterThan(0);
    }
    expect(word.x + word.width).toBeLessThanOrEqual(layout.width);
    expect(word.y + word.height).toBeLessThanOrEqual(layout.height);
    expect(word.lines.length).toBeGreaterThan(0);
    expect(word.lines.join("").replace(/\s/gu, "")).toBe(word.label.replace(/\s/gu, ""));
  }
  for (let i = 0; i < layout.words.length; i++) {
    const a = layout.words[i]!;
    for (const b of layout.words.slice(i + 1)) {
      const overlap =
        a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
      expect(overlap, `${a.value} intersects ${b.value}`).toBe(false);
    }
  }
}

describe("word cloud layout", () => {
  it.each([1, 2, 10, 50, 250])("packs %i terms within phone and projection bounds", (count) => {
    const terms = Array.from({ length: count }, (_, index) => ({
      value: `concept-${index}`,
      label: `concept ${index}`,
      count: Math.max(1, 24 - index),
    }));
    for (const width of [280, 640, 1280]) {
      for (const compact of [false, true]) {
        const layout = layoutWordCloud(terms, { width, compact });
        expectReadableBounds(layout);
        expect(layout.words).toHaveLength(Math.min(count, WORD_CLOUD_VISIBLE_LIMIT));
        expect(layout.omittedCount).toBe(Math.max(0, count - WORD_CLOUD_VISIBLE_LIMIT));
        expect(layout.words.every((word) => word.fontSize >= (compact ? 14 : 15))).toBe(true);
      }
    }
  });

  it("is deterministic across calls and changes to source ordering", () => {
    const terms = [
      { value: "gamma", label: "gamma", count: 3 },
      { value: "alpha", label: "alpha", count: 8 },
      { value: "beta", label: "beta", count: 3 },
    ];
    const first = layoutWordCloud(terms, { width: 560 });
    expect(layoutWordCloud(terms, { width: 560 })).toEqual(first);
    expect(layoutWordCloud([...terms].reverse(), { width: 560 })).toEqual(first);
    expect(terms[0]?.value).toBe("gamma");
  });

  it("gives common terms more area and central placement", () => {
    const layout = layoutWordCloud([
      { value: "rare", label: "rare", count: 1 },
      { value: "often", label: "often", count: 80 },
      { value: "less", label: "less", count: 3 },
    ]);
    const [largest, ...others] = layout.words;
    expect(largest?.value).toBe("often");
    expect(largest!.x + largest!.width / 2).toBe(layout.width / 2);
    expect(largest!.y + largest!.height / 2).toBe(layout.height / 2);
    expect(others.every((word) => word.fontSize < largest!.fontSize)).toBe(true);
  });

  it("grows a repeated term even when it is the only term", () => {
    const once = layoutWordCloud([{ value: "idea", label: "idea", count: 1 }]);
    const repeated = layoutWordCloud([{ value: "idea", label: "idea", count: 8 }]);
    expect(repeated.words[0]!.fontSize).toBeGreaterThan(once.words[0]!.fontSize);
    expect(repeated.words[0]!.width).toBeGreaterThan(once.words[0]!.width);
    expect(wordCloudFontSize(2)).toBeGreaterThan(wordCloudFontSize(1));
  });

  it("wraps long multilingual labels without losing graphemes or clipping", () => {
    const labels = [
      "a".repeat(80),
      "漢字ひらがなカタカナ".repeat(5),
      "مرحبا بالعالم ".repeat(5).trim(),
      "e\u0301".repeat(50),
      "👩🏽‍🚀🌈".repeat(15),
    ];
    const layout = layoutWordCloud(
      labels.map((label, index) => ({ value: String(index), label, count: index + 1 })),
      { width: 280 },
    );
    expectReadableBounds(layout);
    expect(layout.words.every((word) => word.lines.length > 1)).toBe(true);
    expect(layout.words.flatMap((word) => word.lines).some((line) => /^\p{Mark}/u.test(line))).toBe(
      false,
    );
  });

  it("keeps counts and geometry finite for very large frequencies", () => {
    const layout = layoutWordCloud([
      { value: "largest", label: "largest", count: Number.MAX_SAFE_INTEGER },
      { value: "next", label: "next", count: 1_000_000 },
      { value: "one", label: "one", count: 1 },
    ]);
    expectReadableBounds(layout);
    expect(layout.words[0]?.count).toBe(Number.MAX_SAFE_INTEGER);
    expect(layout.words[0]!.fontSize).toBeGreaterThan(layout.words[1]!.fontSize);
  });

  it("retains the most frequent terms when limiting a large cloud", () => {
    const terms = Array.from({ length: 250 }, (_, index) => ({
      value: String(index),
      label: String(index),
      count: index + 1,
    }));
    const layout = layoutWordCloud(terms);
    expect(layout.words).toHaveLength(WORD_CLOUD_VISIBLE_LIMIT);
    expect(layout.words[0]?.count).toBe(250);
    expect(layout.words.at(-1)?.count).toBe(250 - WORD_CLOUD_VISIBLE_LIMIT + 1);
  });

  it("handles empty inputs and ignores nonpositive or nonfinite frequencies", () => {
    const layout = layoutWordCloud([
      { value: "blank", label: " ", count: 1 },
      { value: "zero", label: "zero", count: 0 },
      { value: "nan", label: "nan", count: Number.NaN },
    ]);
    expect(layout.words).toEqual([]);
    expect(layout.height).toBeGreaterThan(0);
  });
});
