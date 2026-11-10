import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  supportedLocales,
  type PresentationScene,
  type SupportedLocale,
} from "@openround/contracts";
import { describe, expect, it, vi } from "vitest";
import { createNativeContentBlock } from "../../lib/presentation-native-scene";
import {
  createNativeChartNode,
  createNativeTableNode,
  type NativeDataNode,
} from "../../lib/presentation-native-data";
import { NativeSceneDataEditor } from "./native-scene-data-editor";
import { nativeDataCopy } from "./native-data-copy";

const mocked = vi.hoisted(() => ({ hooks: null as { cursor: number; slots: unknown[] } | null }));
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useState: <T,>(initial: T) => {
      const hooks = mocked.hooks;
      if (!hooks) return react.useState(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = initial;
      return [
        hooks.slots[index] as T,
        (next: T | ((value: T) => T)) => {
          hooks.slots[index] =
            typeof next === "function" ? (next as (value: T) => T)(hooks.slots[index] as T) : next;
        },
      ];
    },
  };
});

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}

function harness(node: NativeDataNode, callback?: () => boolean | void) {
  const base = createNativeContentBlock().scene!;
  let scene: PresentationScene = {
    ...base,
    schemaVersion: 4,
    nodes: [...base.nodes, node],
    readingOrder: [...base.readingOrder, node.id],
  };
  const hooks = { cursor: 0, slots: [] as unknown[] };
  let locale: SupportedLocale = "en-CA";
  let tree: ReactNode;
  const onChange = vi.fn((next: PresentationScene, _historyField?: string) => {
    if (callback?.() === false) return false;
    scene = next;
  });
  function render() {
    hooks.cursor = 0;
    mocked.hooks = hooks;
    try {
      tree = NativeSceneDataEditor({
        scene,
        node: scene.nodes.find((item) => item.id === node.id) as NativeDataNode,
        onChange,
        locale,
      });
    } finally {
      mocked.hooks = null;
    }
  }
  function find(predicate: (element: ReactElement<Record<string, unknown>>) => boolean) {
    const found = elements(tree).find(predicate);
    if (!found) throw new Error("Missing data editor control");
    return found;
  }
  render();
  return {
    onChange,
    render,
    setLocale(next: SupportedLocale) {
      locale = next;
      render();
    },
    get root() {
      return tree as ReactElement<Record<string, unknown>>;
    },
    get pasteValue() {
      return find((element) => element.type === "textarea" && "placeholder" in element.props).props
        .value;
    },
    field(label: string) {
      const wrapper = find(
        (element) =>
          element.type === "label" &&
          Array.isArray(element.props.children) &&
          element.props.children[0] === label,
      );
      return elements(wrapper).find((element) =>
        ["input", "textarea", "select"].includes(element.type as string),
      )!;
    },
    changeField(label: string, value: string) {
      (this.field(label).props.onChange as (event: unknown) => void)({ target: { value } });
      render();
    },
    get scene() {
      return scene;
    },
    button(label: string) {
      return find((element) => element.type === "button" && element.props.children === label);
    },
    click(label: string) {
      const button = this.button(label);
      if (button.props.disabled) throw new Error("Disabled button");
      (button.props.onClick as () => void)();
      render();
    },
    change(label: string, value: string) {
      const input = find((element) => element.props["aria-label"] === label);
      (input.props.onChange as (event: unknown) => void)({ target: { value } });
      render();
    },
    paste(value: string) {
      const input = find(
        (element) => element.type === "textarea" && "placeholder" in element.props,
      );
      (input.props.onChange as (event: unknown) => void)({ target: { value } });
      render();
    },
    value(label: string) {
      return find((element) => element.props["aria-label"] === label).props.value;
    },
    control(label: string) {
      return find((element) => element.props["aria-label"] === label);
    },
    alerts() {
      return elements(tree)
        .filter((element) => element.props.role === "alert")
        .map((element) => element.props.children)
        .join(" ");
    },
    feedback(role: "alert" | "status") {
      return elements(tree).find((element) => element.props.role === role);
    },
    groupRole() {
      return find(
        (element) =>
          element.props["aria-label"] ===
          (node.type === "chart" ? "Chart data editor" : "Table data editor"),
      ).props.role;
    },
    upstream(update: (current: NativeDataNode) => NativeDataNode) {
      scene = {
        ...scene,
        nodes: scene.nodes.map((item) =>
          item.id === node.id ? update(item as NativeDataNode) : item,
        ),
      };
      render();
    },
  };
}

describe("staged native data editing", () => {
  it("keeps quoted pasted newlines in multiline table headings and cells through rendering and apply", () => {
    const editor = harness(createNativeTableNode());
    editor.paste('"Region\nname",Count,Note\r\n"North\nwest",18,"Says ""hello""\r\nfollow-up"');
    editor.click("Preview pasted data");
    const heading = editor.control("Column 1 heading");
    const note = editor.control("Row 1, column 3");
    expect(heading.type).toBe("textarea");
    expect(heading.props).toMatchObject({ rows: 2, maxLength: 120, value: "Region\nname" });
    expect(note.type).toBe("textarea");
    expect(note.props).toMatchObject({ rows: 2, maxLength: 300, value: 'Says "hello"\nfollow-up' });
    expect(renderToStaticMarkup(note)).toContain("Says &quot;hello&quot;\nfollow-up</textarea>");
    editor.change("Column 3 heading", "Observation\nnotes");
    editor.click("Apply table changes");
    expect(editor.scene.nodes.at(-1)).toMatchObject({
      headers: ["Region\nname", "Count", "Observation\nnotes"],
      rows: [["North\nwest", "18", 'Says "hello"\nfollow-up']],
    });
  });

  it("uses multiline chart labels while keeping chart numbers in bounded decimal inputs", () => {
    const editor = harness(createNativeChartNode());
    expect(editor.control("Series 1 name").type).toBe("textarea");
    expect(editor.control("Category 1").type).toBe("textarea");
    expect(editor.control("Series 1 name").props).toMatchObject({ rows: 2, maxLength: 80 });
    expect(editor.control("Category 1").props).toMatchObject({ rows: 2, maxLength: 80 });
    expect(editor.control("Category 1, series 1 value").type).toBe("input");
    expect(editor.control("Category 1, series 1 value").props).toMatchObject({
      inputMode: "decimal",
      maxLength: 40,
    });
    editor.change("Category 1", "North\nwest");
    editor.change("Series 1 name", "Attendees\ncount");
    editor.click("Apply chart changes");
    expect(editor.scene.nodes.at(-1)).toMatchObject({
      categories: ["North\nwest", "Beta", "Gamma"],
      series: [{ name: "Attendees\ncount", values: [10, 20, 15] }],
    });
  });

  it("previews locally, reports invalid chart values, then applies recovered data once", () => {
    const editor = harness(createNativeChartNode());
    expect(editor.groupRole()).toBe("group");
    editor.paste('Category,Revenue\r\n"North, west",=SUM(A1)\r\nSouth,20');
    editor.click("Preview pasted data");
    expect(editor.value("Category 1")).toBe("North, west");
    expect(editor.onChange).not.toHaveBeenCalled();
    editor.click("Apply chart changes");
    expect(editor.alerts()).toContain("Formulas");
    expect(editor.onChange).not.toHaveBeenCalled();
    editor.change("Category 1, series 1 value", "10");
    editor.click("Apply chart changes");
    expect(editor.onChange).toHaveBeenCalledTimes(1);
    expect(editor.onChange.mock.calls[0]).toHaveLength(1);
    expect(editor.scene.nodes.at(-1)).toMatchObject({
      categories: ["North, west", "South"],
      series: [{ name: "Revenue", values: [10, 20] }],
    });
  });

  it("retains staged cells on malformed or oversized paste, and discards without parent mutation", () => {
    const editor = harness(createNativeTableNode());
    editor.change("Row 1, column 2", "Staged value");
    editor.paste('A,B\n"unfinished,1');
    editor.click("Preview pasted data");
    expect(editor.alerts()).toContain("unfinished");
    expect(editor.value("Row 1, column 2")).toBe("Staged value");
    editor.paste("é".repeat(65537));
    expect(editor.alerts()).toContain("128 KiB");
    expect(editor.value("Row 1, column 2")).toBe("Staged value");
    editor.click("Discard staged changes");
    expect(editor.value("Row 1, column 2")).toBe("10");
    expect(editor.alerts()).toBe("");
    expect(editor.onChange).not.toHaveBeenCalled();
  });

  it("keeps staged data through geometry updates and resets after an upstream data/history change", () => {
    const editor = harness(createNativeTableNode());
    editor.change("Row 1, column 2", "Actual result");
    editor.upstream((node) => ({
      ...node,
      frame: { x: 20, y: 20, width: 60, height: 50 },
      rotation: 5,
    }));
    expect(editor.value("Row 1, column 2")).toBe("Actual result");
    editor.click("Apply table changes");
    expect(editor.scene.nodes.at(-1)).toMatchObject({
      rotation: 5,
      frame: { x: 20, y: 20, width: 60, height: 50 },
      rows: [
        ["Alpha", "Actual result"],
        ["Beta", "20"],
      ],
    });
    editor.change("Row 1, column 2", "Unsaved draft");
    editor.upstream((node) =>
      node.type === "table"
        ? {
            ...node,
            rows: [
              ["Alpha", "Undone result"],
              ["Beta", "20"],
            ],
          }
        : node,
    );
    expect(editor.value("Row 1, column 2")).toBe("Undone result");
    editor.upstream((node) =>
      node.type === "table"
        ? {
            ...node,
            rows: [
              ["Alpha", "Actual result"],
              ["Beta", "20"],
            ],
          }
        : node,
    );
    expect(editor.value("Row 1, column 2")).toBe("Actual result");
  });

  it("supports bounded ordinary table row/column changes", () => {
    const editor = harness(createNativeTableNode());
    editor.click("Add table row");
    editor.click("Add table column");
    editor.change("Column 3 heading", "Notes");
    editor.change("Row 3, column 3", "New observation");
    editor.click("Apply table changes");
    expect(editor.scene.nodes.at(-1)).toMatchObject({
      headers: ["Category", "Value", "Notes"],
      rows: [
        ["Alpha", "10", ""],
        ["Beta", "20", ""],
        ["", "", "New observation"],
      ],
    });
    editor.click("Remove last table row");
    editor.click("Remove last table column");
    editor.click("Apply table changes");
    expect(editor.scene.nodes.at(-1)).toMatchObject({
      headers: ["Category", "Value"],
      rows: [
        ["Alpha", "10"],
        ["Beta", "20"],
      ],
    });
    while (!editor.button("Add table row").props.disabled) editor.click("Add table row");
    while (!editor.button("Add table column").props.disabled) editor.click("Add table column");
    expect(editor.button("Add table row").props.disabled).toBe(true);
    expect(editor.button("Add table column").props.disabled).toBe(true);
  });

  it("does not swallow callback failures and retains the staged draft for recovery", () => {
    const editor = harness(createNativeTableNode(), () => {
      throw new Error("Parent update failed");
    });
    editor.change("Row 1, column 2", "Recovered data");
    expect(() => editor.click("Apply table changes")).toThrow("Parent update failed");
    editor.render();
    expect(editor.value("Row 1, column 2")).toBe("Recovered data");
    expect(editor.alerts()).toBe("");
  });

  it("retains rejected data and retries after the presentation budget accepts the update", () => {
    let accepted = false;
    const editor = harness(createNativeTableNode(), () => accepted);
    editor.change("Row 1, column 2", "Actual result");
    editor.click("Apply table changes");
    expect(editor.alerts()).toContain("Your staged data is retained");
    expect(editor.value("Row 1, column 2")).toBe("Actual result");
    expect(editor.scene.nodes.at(-1)).toMatchObject({
      rows: [
        ["Alpha", "10"],
        ["Beta", "20"],
      ],
    });
    accepted = true;
    editor.click("Apply table changes");
    expect(editor.alerts()).toBe("");
    expect(editor.scene.nodes.at(-1)).toMatchObject({
      rows: [
        ["Alpha", "Actual result"],
        ["Beta", "20"],
      ],
    });
  });

  it("keeps rapid explicit Apply actions out of continuous text-history coalescing", () => {
    const editor = harness(createNativeTableNode());
    editor.change("Row 1, column 2", "11");
    editor.click("Apply table changes");
    editor.change("Row 1, column 2", "12");
    editor.click("Apply table changes");
    expect(editor.onChange).toHaveBeenCalledTimes(2);
    expect(editor.onChange.mock.calls.every((call) => call.length === 1)).toBe(true);
    expect(editor.onChange.mock.calls[0]?.[0].nodes.at(-1)).toMatchObject({
      rows: [
        ["Alpha", "11"],
        ["Beta", "20"],
      ],
    });
    expect(editor.onChange.mock.calls[1]?.[0].nodes.at(-1)).toMatchObject({
      rows: [
        ["Alpha", "12"],
        ["Beta", "20"],
      ],
    });
  });

  it("changes every locale around an invalid chart draft without changing authored values or paste bytes", () => {
    const node = {
      ...createNativeChartNode("line"),
      title: "Authored {row} title · 차트",
      summary: "Résumé <author>\nKeep the original description.",
      frame: { x: 20, y: 20, width: 60, height: 50 },
      rotation: 5,
    };
    const original = structuredClone(node);
    const editor = harness(node);
    const paste = '\uFEFF"Category","Revenue {series}"\r\n"North\nwest",=SUM(A1)\r\nSouth,20\r\n';
    editor.paste(paste);
    editor.click("Preview pasted data");
    editor.click("Apply chart changes");
    for (const locale of supportedLocales) {
      const copy = nativeDataCopy(locale);
      editor.setLocale(locale);
      expect(editor.root.props.lang).toBe(locale);
      expect(editor.root.props["aria-label"]).toBe(copy("Chart data editor"));
      expect(editor.value(copy("Category {row}", { row: 1 }))).toBe("North\nwest");
      expect(editor.value(copy("Series {series} name", { series: 1 }))).toBe("Revenue {series}");
      expect(
        editor.value(copy("Category {row}, series {series} value", { row: 1, series: 1 })),
      ).toBe("=SUM(A1)");
      expect(editor.field(copy("Chart title")).props).toMatchObject({
        value: node.title,
        lang: "",
      });
      expect(editor.field(copy("Chart description")).props).toMatchObject({
        value: node.summary,
        lang: "",
      });
      expect(editor.field(copy("Chart type")).props.value).toBe("line");
      expect(editor.feedback("alert")?.props).toMatchObject({
        lang: locale,
        children: copy(
          "Row {row}, series {series}: use a finite number between −1 trillion and 1 trillion. Formulas and blank values are unsupported.",
          { row: 1, series: 1 },
        ),
      });
      expect(editor.pasteValue).toBe(paste);
      expect(new TextEncoder().encode(editor.pasteValue as string)).toEqual(
        new TextEncoder().encode(paste),
      );
      expect(editor.onChange).not.toHaveBeenCalled();
      expect(editor.scene.nodes.at(-1)).toEqual(original);
    }
    editor.setLocale("ko-KR");
    editor.change("범주 1, 계열 1 값", "1e2");
    editor.click("차트 변경 사항 적용");
    expect(editor.onChange).toHaveBeenCalledTimes(1);
    expect(editor.onChange.mock.calls[0]).toHaveLength(1);
    expect(editor.scene.nodes.at(-1)).toEqual({
      ...original,
      categories: ["North\nwest", "South"],
      series: [{ name: "Revenue {series}", values: [100, 20] }],
    });
    expect(editor.pasteValue).toBe("");
    editor.setLocale("fr-FR");
    expect(editor.feedback("status")?.props).toMatchObject({
      lang: "fr-FR",
      children: nativeDataCopy("fr-FR")("Data changes applied."),
    });
    expect(editor.onChange).toHaveBeenCalledTimes(1);
  });

  it("retains invalid table caption, staged literal cells and malformed raw paste across locale changes and discard", () => {
    const node = createNativeTableNode();
    const original = structuredClone(node);
    const editor = harness(node);
    const literal = "=SUM(A1)\nOriginal {row} <author> 한글";
    const paste = 'A,B\r\n"unfinished,1';
    editor.change("Row 1, column 2", literal);
    editor.changeField("Table caption", "");
    editor.click("Apply table changes");
    editor.setLocale("ko-KR");
    expect(editor.field("표 캡션").props).toMatchObject({ value: "", lang: "" });
    expect(editor.alerts()).toBe("표 캡션과 모든 열의 이름을 입력하세요.");
    editor.paste(paste);
    editor.click("붙여넣은 데이터 미리 보기");
    for (const locale of supportedLocales) {
      const copy = nativeDataCopy(locale);
      editor.setLocale(locale);
      expect(editor.pasteValue).toBe(paste);
      expect(
        editor.control(copy("Row {row}, column {column}", { row: 1, column: 2 })).props,
      ).toMatchObject({ value: literal, lang: "", maxLength: 300, rows: 2 });
      expect(editor.feedback("alert")?.props).toMatchObject({
        lang: locale,
        children: copy("A quoted cell is unfinished. Close its quote, then preview again."),
      });
      expect(editor.onChange).not.toHaveBeenCalled();
    }
    editor.setLocale("ko-KR");
    editor.click("적용 대기 중인 변경 사항 취소");
    expect(editor.field("표 캡션").props.value).toBe(original.caption);
    expect(editor.value("행 1, 열 2")).toBe("10");
    expect(editor.pasteValue).toBe("");
    expect(editor.alerts()).toBe("");
    expect(editor.scene.nodes.at(-1)).toEqual(original);
    expect(editor.onChange).not.toHaveBeenCalled();
    editor.setLocale("en-CA");
    expect(editor.feedback("status")?.props).toMatchObject({
      lang: "en-CA",
      children: "Staged changes discarded.",
    });
  });

  it("keeps language changes outside the canonical source revision fence", () => {
    const editor = harness(createNativeTableNode());
    editor.change("Row 1, column 2", "Staged literal");
    editor.paste('A,B\n"unfinished,1');
    editor.click("Preview pasted data");
    editor.setLocale("ko-KR");
    editor.upstream((node) => ({ ...node, frame: { x: 20, y: 20, width: 60, height: 50 } }));
    expect(editor.value("행 1, 열 2")).toBe("Staged literal");
    expect(editor.pasteValue).toBe('A,B\n"unfinished,1');
    expect(editor.alerts()).toBe(
      "따옴표로 묶인 셀이 완성되지 않았습니다. 따옴표를 닫고 다시 미리 보세요.",
    );
    editor.upstream((node) =>
      node.type === "table" ? { ...node, caption: "Upstream caption" } : node,
    );
    expect(editor.value("행 1, 열 2")).toBe("10");
    expect(editor.pasteValue).toBe("");
    expect(editor.alerts()).toBe("");
    editor.setLocale("fr-FR");
    editor.upstream((node) =>
      node.type === "table" ? { ...node, caption: "Illustrative sample table" } : node,
    );
    expect(
      editor.value(nativeDataCopy("fr-FR")("Row {row}, column {column}", { row: 1, column: 2 })),
    ).toBe("10");
    expect(editor.pasteValue).toBe("");
    expect(editor.alerts()).toBe("");
    expect(editor.onChange).not.toHaveBeenCalled();
  });

  it("relocalizes rejected updates without clearing the draft or adding a history identity", () => {
    let accepted = false;
    const editor = harness(createNativeTableNode(), () => accepted);
    editor.change("Row 1, column 2", "Original author literal");
    editor.click("Apply table changes");
    editor.setLocale("ko-KR");
    expect(editor.feedback("alert")?.props).toMatchObject({
      lang: "ko-KR",
      children: nativeDataCopy("ko-KR")(
        "The presentation could not accept these changes. Your staged data is retained; reduce content and try again.",
      ),
    });
    expect(editor.value("행 1, 열 2")).toBe("Original author literal");
    expect(editor.onChange).toHaveBeenCalledTimes(1);
    accepted = true;
    editor.click("표 변경 사항 적용");
    expect(editor.alerts()).toBe("");
    expect(editor.onChange).toHaveBeenCalledTimes(2);
    expect(editor.onChange.mock.calls.every((call) => call.length === 1)).toBe(true);
  });

  it("adapts real chart string limits and pie constraints while preserving the source draft", () => {
    const editor = harness(createNativeChartNode());
    const series = "Original ".repeat(10);
    editor.paste(`Category,${series}\nAlpha,-1`);
    editor.click("Preview pasted data");
    editor.click("Apply chart changes");
    expect(editor.alerts()).toBe(
      "Too big: expected string to have <=80 characters Edit the staged data or discard your changes, then try again.",
    );
    editor.setLocale("ko-KR");
    expect(editor.alerts()).toBe(
      "문자열이 너무 깁니다. 최대 80자까지 입력하세요 대기 중인 데이터를 수정하거나 변경 사항을 취소한 다음 다시 시도하세요.",
    );
    expect(editor.value("계열 1 이름")).toBe(series);
    editor.change("계열 1 이름", "Original series");
    editor.changeField("차트 유형", "pie");
    editor.click("차트 변경 사항 적용");
    for (const locale of supportedLocales) {
      const copy = nativeDataCopy(locale);
      editor.setLocale(locale);
      expect(editor.feedback("alert")?.props).toMatchObject({
        lang: locale,
        children: `${copy("Pie charts require one nonnegative series with a positive total")} ${copy("Edit the staged data or discard your changes, then try again.")}`,
      });
      expect(editor.field(copy("Chart type")).props.value).toBe("pie");
      expect(
        editor.value(copy("Category {row}, series {series} value", { row: 1, series: 1 })),
      ).toBe("-1");
    }
    expect(editor.onChange).not.toHaveBeenCalled();
    editor.setLocale("ko-KR");
    editor.change("범주 1, 계열 1 값", "12.50");
    editor.click("차트 변경 사항 적용");
    expect(editor.onChange).toHaveBeenCalledTimes(1);
    expect(editor.scene.nodes.at(-1)).toMatchObject({
      chartType: "pie",
      categories: ["Alpha"],
      series: [{ name: "Original series", values: [12.5] }],
    });
  });

  it("renders unknown source diagnostics unchanged with explicit English through locale changes", () => {
    const editor = harness(createNativeTableNode());
    editor.change("Row 1, column 2", "Staged literal");
    editor.upstream((node) => ({ ...node, "Original {row} source field": "untouched" }));
    editor.click("Apply table changes");
    const source =
      'Unrecognized key: "Original {row} source field" Edit the staged data or discard your changes, then try again.';
    expect(editor.alerts()).toBe(source);
    for (const locale of supportedLocales) {
      editor.setLocale(locale);
      expect(editor.feedback("alert")?.props).toMatchObject({ lang: "en-CA", children: source });
      expect(
        editor.value(nativeDataCopy(locale)("Row {row}, column {column}", { row: 1, column: 2 })),
      ).toBe("Staged literal");
    }
    expect(editor.onChange).not.toHaveBeenCalled();
  });

  it.each(supportedLocales)(
    "renders localized table and chart UI with authored-value language boundaries in %s",
    (locale) => {
      const copy = nativeDataCopy(locale);
      for (const chart of [false, true]) {
        const base = createNativeContentBlock().scene!;
        const node = chart
          ? {
              ...createNativeChartNode("pie"),
              title: "Authored {row} chart",
              summary: "Original summary 한글",
            }
          : { ...createNativeTableNode(), caption: "Authored {row} table" };
        const scene: PresentationScene = {
          ...base,
          schemaVersion: 4,
          nodes: [...base.nodes, node],
          readingOrder: [...base.readingOrder, node.id],
        };
        const before = JSON.stringify(scene);
        const onChange = vi.fn();
        const markup = renderToStaticMarkup(
          <NativeSceneDataEditor scene={scene} node={node} locale={locale} onChange={onChange} />,
        );
        expect(markup).toContain(`lang="${locale}" role="group"`);
        expect(markup).toContain(
          `aria-label="${copy(chart ? "Chart data editor" : "Table data editor")}"`,
        );
        for (const key of [
          "Paste CSV or TSV data",
          "Preview pasted data",
          "Discard staged changes",
          chart ? "Apply chart changes" : "Apply table changes",
        ] as const)
          expect(markup).toContain(renderToStaticMarkup(<>{copy(key)}</>));
        expect(markup).toContain('lang=""');
        if (chart) {
          expect(markup).toContain('value="bar"');
          expect(markup).toContain('value="line"');
          expect(markup).toContain('value="pie" selected=""');
          expect(markup).toContain(renderToStaticMarkup(<>{copy("Bar")}</>));
          expect(markup).toContain('value="Authored {row} chart"');
          expect(markup).toContain("Original summary 한글</textarea>");
          expect(markup).toContain('inputMode="decimal" maxLength="40" value="10"');
        } else {
          expect(markup).toContain('value="Authored {row} table"');
          expect(markup).toContain('maxLength="120">Category</textarea>');
          expect(markup).toContain('maxLength="300">Alpha</textarea>');
        }
        expect(JSON.stringify(scene)).toBe(before);
        expect(onChange).not.toHaveBeenCalled();
      }
    },
  );
});
