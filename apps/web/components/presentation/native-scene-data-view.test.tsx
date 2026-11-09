import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createNativeChartNode, createNativeTableNode } from "../../lib/presentation-native-data";
import { NATIVE_DESIGN_THEMES } from "../../lib/presentation-native-design";
import { NativeSceneDataView, NATIVE_CHART_COLORS } from "./native-scene-data-view";
import styles from "./native-scene-data.module.css";

function luminance(hex: string) {
  const channels = [1, 3, 5]
    .map((start) => parseInt(hex.slice(start, start + 2), 16) / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}

describe("native information rendering", () => {
  it.each([createNativeTableNode(), createNativeChartNode()])(
    "retains the authored $type plane in a fixed preview without changing its data",
    (node) => {
      const original = structuredClone(node);
      expect(
        NativeSceneDataView({ node, fixedLayout: true }).props["data-native-fixed-layout"],
      ).toBe("true");
      expect(NativeSceneDataView({ node }).props["data-native-fixed-layout"]).toBeUndefined();
      expect(node).toEqual(original);
    },
  );

  it("chooses chart columns from authored width at the canonical plane rather than editor width", () => {
    const node = createNativeChartNode();
    node.frame.width = 46.8;
    expect(NativeSceneDataView({ node }).props["data-chart-layout"]).toBe("stack");
    node.frame.width = 46.875;
    expect(NativeSceneDataView({ node }).props["data-chart-layout"]).toBe("split");
    node.frame.width = 86;
    expect(NativeSceneDataView({ node, fixedLayout: true }).props["data-chart-layout"]).toBe(
      "split",
    );
  });

  it.each([createNativeTableNode(), createNativeChartNode()])(
    "makes overflowing $type content a named keyboard focus target and keeps scroll keys away from slide shortcuts",
    (node) => {
      const view = NativeSceneDataView({ node });
      expect(view.props.tabIndex).toBe(0);
      expect(view.props["aria-label"]).toBe(node.type === "table" ? node.caption : node.title);
      expect(view.type).toBe(node.type === "table" ? "div" : "figure");
      if (node.type === "table") expect(view.props.role).toBe("group");
      for (const key of [
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Home",
        "End",
        "PageUp",
        "PageDown",
        " ",
      ]) {
        const stopPropagation = vi.fn(),
          preventDefault = vi.fn();
        view.props.onKeyDown({ key, stopPropagation, preventDefault });
        expect(stopPropagation).toHaveBeenCalledTimes(1);
        expect(preventDefault).not.toHaveBeenCalled();
      }
      for (const key of ["Escape", "Tab", "Enter"]) {
        const stopPropagation = vi.fn(),
          preventDefault = vi.fn();
        view.props.onKeyDown({ key, stopPropagation, preventDefault });
        expect(stopPropagation).not.toHaveBeenCalled();
        expect(preventDefault).not.toHaveBeenCalled();
      }
      if (node.type === "table") node.caption = " ";
      else node.title = " ";
      expect(NativeSceneDataView({ node }).props["aria-label"]).toBe(
        node.type === "table" ? "Data table" : "Chart",
      );
    },
  );

  it("renders complete table text, semantic column headings and escaped literal values", () => {
    const node = createNativeTableNode();
    node.caption = "Complete result table";
    node.headers = ["A long heading ".repeat(7), "Literal"];
    node.rows = [["A long cell ".repeat(25), "<script>run()</script> =SUM(A1:A2)"]];
    const markup = renderToStaticMarkup(<NativeSceneDataView node={node} />);
    expect(markup).toContain("<caption>Complete result table</caption>");
    expect(markup).toContain('scope="col"');
    expect(markup).toContain(node.headers[0]);
    expect(markup).toContain(node.rows[0]![0]);
    expect(markup).toContain("&lt;script&gt;run()&lt;/script&gt; =SUM(A1:A2)");
    expect(markup).not.toContain("<script>");
    expect(markup).not.toContain("<input");
  });

  it.each(["bar", "line", "pie"] as const)(
    "renders %s with authored summary and all accessible data",
    (chartType) => {
      const node = createNativeChartNode(chartType);
      node.title = "Revenue by category";
      node.summary = "Beta has twice the revenue of Alpha.";
      const markup = renderToStaticMarkup(<NativeSceneDataView node={node} />);
      expect(markup).toContain(node.title);
      expect(markup).toContain(node.summary);
      expect(markup).toContain('aria-hidden="true" focusable="false"');
      expect(markup).toContain("Revenue by category · chart data");
      expect(markup).toContain('scope="row">1. Alpha');
      expect(markup).toContain(">10</td>");
      expect(markup).toContain(">20</td>");
      expect(markup).toContain(">15</td>");
      expect(markup).toContain("blue");
      expect(markup).not.toMatch(/NaN|Infinity|https?:/);
    },
  );

  it("keeps the complete plot and native data table in ordered layout columns without rewriting authored data", () => {
    const node = createNativeChartNode("line");
    node.series.push({ name: "Second complete series", values: [-12, 0, 28] });
    const original = structuredClone(node);
    const markup = renderToStaticMarkup(<NativeSceneDataView node={node} />);
    expect(markup).toContain(`class="${styles.chartColumns}"`);
    expect(markup).toContain(`class="${styles.chartVisual}"`);
    expect(markup.indexOf("</figcaption>")).toBeLessThan(markup.indexOf(styles.chartColumns!));
    expect(markup.indexOf("<svg")).toBeLessThan(markup.indexOf("<table"));
    expect(markup).toContain('viewBox="0 0 640 270"');
    expect(markup).toContain("Second complete series");
    for (const value of [-12, 0, 28]) expect(markup).toContain(`>${value}</td>`);
    for (const category of node.categories) expect(markup).toContain(category);
    expect(markup).toContain(node.summary);
    expect(node).toEqual(original);
  });

  it.each([
    [0, 0, 0],
    [-10, 0, 10],
    [-10, -10, -10],
    [5, 5, 5],
  ])("keeps zero, negative and equal Cartesian values finite (%j)", (...values) => {
    for (const chartType of ["bar", "line"] as const) {
      const node = createNativeChartNode(chartType);
      node.series[0]!.values = values;
      const markup = renderToStaticMarkup(<NativeSceneDataView node={node} />);
      expect(markup).not.toMatch(/NaN|Infinity/);
      expect(markup).toContain('data-chart-series="1"');
      values.forEach((value) => expect(markup).toContain(`>${value}</td>`));
    }
  });

  it("shows a centered point for one line category and a full circle for a full pie turn", () => {
    const node = createNativeChartNode("line");
    node.categories = ["Only category"];
    node.series[0]!.values = [10];
    const line = renderToStaticMarkup(<NativeSceneDataView node={node} />);
    expect(line).toContain('cx="340" cy="20"');
    node.chartType = "pie";
    node.categories.push("Zero category");
    node.series[0]!.values.push(0);
    const pie = renderToStaticMarkup(<NativeSceneDataView node={node} />);
    expect(pie).toContain('<circle cx="320" cy="140" r="112"');
    expect(pie).not.toContain(" A112 ");
    expect(pie).toContain("2. Zero category");
    expect(pie).toContain(">0</td>");
  });

  it.each([
    { values: [10000000, 1], dominant: 1 },
    { values: [1e12, 1], dominant: 1 },
    { values: [1e12, 1e-12], dominant: 1 },
    { values: [1, 1e12], dominant: 2 },
    { values: [0, 1e12, Number.MIN_VALUE], dominant: 2 },
  ])(
    "paints the dominant pie slice for highly unequal positive values without promoting it to a full circle ($values)",
    ({ values, dominant }) => {
      const node = createNativeChartNode("pie");
      node.categories = values.map((_, index) => `Category ${index + 1}`);
      node.series[0]!.values = [...values];
      const original = structuredClone(node);
      const markup = renderToStaticMarkup(<NativeSceneDataView node={node} />);
      const path = markup.match(
        new RegExp(`data-pie-category="${dominant}"><path d="([^"]+)"`),
      )?.[1];
      expect(path).toBeDefined();
      const start = path!.match(/^M320 140 L([\d.-]+) ([\d.-]+)/)!;
      const arcs = [...path!.matchAll(/A112 112 0 0 1 ([\d.-]+) ([\d.-]+)/g)];
      expect(arcs).toHaveLength(2);
      // The midpoint is opposite the start, so the dominant slice paints a real area even
      // when the final endpoint rounds back onto the start for a subpixel remaining slice.
      expect(
        Math.hypot(Number(arcs[0]![1]) - Number(start[1]), Number(arcs[0]![2]) - Number(start[2])),
      ).toBeGreaterThan(200);
      expect(markup).not.toContain('<circle cx="320" cy="140" r="112"');
      expect(markup).not.toMatch(/NaN|Infinity/);
      for (const value of values) expect(markup).toContain(`>${String(value)}</td>`);
      expect(node).toEqual(original);
    },
  );

  it("provides at least 3:1 graphical contrast on paper and midnight", () => {
    for (const color of NATIVE_CHART_COLORS) {
      for (const background of [
        NATIVE_DESIGN_THEMES.paper.background,
        NATIVE_DESIGN_THEMES.midnight.background,
      ]) {
        const [light, dark] = [luminance(color), luminance(background)].sort((a, b) => b - a);
        expect((light! + 0.05) / (dark! + 0.05)).toBeGreaterThanOrEqual(3);
      }
      // White category numbers on pie slices remain readable as ordinary small text.
      expect(1.05 / (luminance(color) + 0.05)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
