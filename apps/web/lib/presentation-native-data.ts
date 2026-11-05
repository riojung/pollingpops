import {
  PRESENTATION_SCENE_MAX_BYTES,
  PresentationSceneDraftSchema,
  type PresentationScene,
  type PresentationSceneNode,
} from "@openround/contracts";
import { clientUuid } from "./uuid";

export type NativeTableNode = Extract<PresentationSceneNode, { type: "table" }>;
export type NativeChartNode = Extract<PresentationSceneNode, { type: "chart" }>;
export type NativeDataNode = NativeTableNode | NativeChartNode;
export type NativeDataDraft =
  | { type: "table"; caption: string; grid: string[][] }
  | {
      type: "chart";
      chartType: NativeChartNode["chartType"];
      title: string;
      summary: string;
      grid: string[][];
    };
type Result<T> = { success: true; data: T } | { success: false; error: string };

export function createNativeTableNode(): NativeTableNode {
  return {
    id: clientUuid(),
    type: "table",
    caption: "Illustrative sample table",
    headers: ["Category", "Value"],
    rows: [
      ["Alpha", "10"],
      ["Beta", "20"],
    ],
    frame: { x: 8, y: 35, width: 84, height: 55 },
  };
}

export function createNativeChartNode(
  chartType: NativeChartNode["chartType"] = "bar",
): NativeChartNode {
  return {
    id: clientUuid(),
    type: "chart",
    chartType,
    title: "Illustrative sample chart",
    summary:
      "Illustrative values: Alpha 10, Beta 20 and Gamma 15. Replace this sample with your own data and description.",
    categories: ["Alpha", "Beta", "Gamma"],
    series: [{ name: "Illustrative value", values: [10, 20, 15] }],
    frame: { x: 8, y: 35, width: 84, height: 55 },
  };
}

/** Data changes reset a local draft; geometry and other scene changes do not. */
export function nativeDataRevision(node: NativeDataNode): string {
  return JSON.stringify([node.id, nativeDataDraft(node)]);
}

export function nativeDataDraft(node: NativeDataNode): NativeDataDraft {
  return node.type === "table"
    ? {
        type: "table",
        caption: node.caption,
        grid: [node.headers, ...node.rows].map((row) => [...row]),
      }
    : {
        type: "chart",
        chartType: node.chartType,
        title: node.title,
        summary: node.summary,
        grid: [
          ["Category", ...node.series.map((series) => series.name)],
          ...node.categories.map((category, index) => [
            category,
            ...node.series.map((series) => String(series.values[index]!)),
          ]),
        ],
      };
}

/** A bounded, local CSV/TSV reader. Values remain literal strings until chart validation. */
export function parseNativeDataPaste(input: string): Result<string[][]> {
  if (new TextEncoder().encode(input).byteLength > PRESENTATION_SCENE_MAX_BYTES) {
    return {
      success: false,
      error: "Paste at most 128 KiB of data. Use up to 20 data rows and 6 columns.",
    };
  }
  const source = input.replace(/^\uFEFF/, "");
  let inQuotes = false;
  let delimiter = ",";
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (inQuotes && source[index + 1] === '"') index += 1;
      else inQuotes = !inQuotes;
    } else if (!inQuotes && character === "\t") delimiter = "\t";
    else if (!inQuotes && (character === "\r" || character === "\n")) break;
  }
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;
  let failure = "";
  function finishField() {
    row.push(field);
    field = "";
    closedQuote = false;
    if (row.length > 6) failure = "Use at most 6 columns (charts support 4 value series).";
  }
  function finishRow() {
    finishField();
    rows.push(row);
    row = [];
    if (rows.length > 21) failure = "Use one header row and at most 20 data rows.";
  }
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else {
        field += character === "\r" ? "\n" : character;
        if (character === "\r" && source[index + 1] === "\n") index += 1;
      }
    } else if (character === delimiter) finishField();
    else if (character === "\r" || character === "\n") {
      finishRow();
      if (character === "\r" && source[index + 1] === "\n") index += 1;
    } else if (character === '"') {
      if (field || closedQuote)
        return {
          success: false,
          error: "Put quotes around the whole cell, and double any quotes inside it.",
        };
      quoted = true;
    } else if (closedQuote) {
      if (character !== " ")
        return {
          success: false,
          error: "After a closing quote, use a column separator or a new row.",
        };
    } else field += character;
    if (field.length > 300)
      return { success: false, error: "Keep each cell within 300 characters." };
    if (failure) return { success: false, error: failure };
  }
  if (quoted)
    return {
      success: false,
      error: "A quoted cell is unfinished. Close its quote, then preview again.",
    };
  if (field || row.length || closedQuote) finishRow();
  if (failure) return { success: false, error: failure };
  if (rows.length < 2)
    return { success: false, error: "Include a header row and at least one data row." };
  if (rows.some((item) => item.length !== rows[0]!.length))
    return {
      success: false,
      error: "Every row must have the same number of cells as the header row.",
    };
  return { success: true, data: rows };
}

const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

/** Replace only authored data on the newest node, retaining frame/rotation/group metadata. */
export function applyNativeDataDraft(
  scene: PresentationScene,
  nodeId: string,
  draft: NativeDataDraft,
): Result<PresentationScene> {
  const node = scene.nodes.find((candidate) => candidate.id === nodeId);
  if (!node || node.type !== draft.type || (node.type !== "table" && node.type !== "chart"))
    return {
      success: false,
      error: "This object changed or was removed. Select it again before applying data.",
    };
  const [headers, ...rows] = draft.grid;
  if (!headers?.length || !rows.length || rows.some((row) => row.length !== headers.length))
    return { success: false, error: "Use one header row and equally sized data rows." };
  let next: NativeDataNode;
  if (node.type === "table" && draft.type === "table") {
    if (!draft.caption.trim() || headers.some((header) => !header.trim()))
      return { success: false, error: "Add a table caption and a name for every column." };
    next = {
      ...node,
      caption: draft.caption,
      headers: [...headers],
      rows: rows.map((row) => [...row]),
    };
  } else if (node.type === "chart" && draft.type === "chart") {
    if (
      !draft.title.trim() ||
      !draft.summary.trim() ||
      headers.slice(1).some((header) => !header.trim()) ||
      rows.some((row) => !row[0]?.trim())
    )
      return {
        success: false,
        error: "Add a chart title, description, category labels and series names.",
      };
    const series: NativeChartNode["series"] = [];
    for (let column = 1; column < headers.length; column += 1) {
      const values: number[] = [];
      for (let index = 0; index < rows.length; index += 1) {
        const text = rows[index]![column]!.trim();
        if (!decimal.test(text) || !Number.isFinite(Number(text)) || Math.abs(Number(text)) > 1e12)
          return {
            success: false,
            error: `Row ${index + 1}, series ${column}: use a finite number between −1 trillion and 1 trillion. Formulas and blank values are unsupported.`,
          };
        values.push(Number(text));
      }
      series.push({ name: headers[column]!, values });
    }
    next = {
      ...node,
      chartType: draft.chartType,
      title: draft.title,
      summary: draft.summary,
      categories: rows.map((row) => row[0]!),
      series,
    };
  } else return { success: false, error: "Select the data object again before applying changes." };
  const result = PresentationSceneDraftSchema.safeParse({
    ...scene,
    schemaVersion: scene.schemaVersion >= 4 ? scene.schemaVersion : 4,
    nodes: scene.nodes.map((candidate) => (candidate.id === nodeId ? next : candidate)),
  });
  if (!result.success)
    return {
      success: false,
      error: `${result.error.issues[0]?.message ?? "This data exceeds the slide’s limits."} Edit the staged data or discard your changes, then try again.`,
    };
  return { success: true, data: result.data };
}
