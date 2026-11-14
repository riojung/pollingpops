"use client";

import { creationContent } from "../../lib/i18n/creation-content";

import { useState } from "react";
import {
  PRESENTATION_SCENE_MAX_BYTES,
  type PresentationScene,
  type SupportedLocale,
} from "@openround/contracts";
import {
  applyNativeDataDraft,
  nativeDataDraft,
  nativeDataRevision,
  parseNativeDataPaste,
  type NativeDataDraft,
  type NativeDataNode,
} from "../../lib/presentation-native-data";
import { nativeDataCopy, nativeDataFeedback } from "./native-data-copy";
import styles from "./native-scene-data.module.css";
import { NativeInspectorSection } from "./native-inspector-section";

type DraftState = {
  revision: string;
  draft: NativeDataDraft;
  paste: string;
  error: string;
  status: string;
};

export function NativeSceneDataEditor({
  scene,
  node,
  onChange,
  locale = "en-CA",
}: {
  scene: PresentationScene;
  node: NativeDataNode;
  onChange: (scene: PresentationScene, historyField?: string) => boolean | void;
  locale?: SupportedLocale;
}) {
  const copy = nativeDataCopy(locale);
  const defaults = creationContent(locale);
  const revision = nativeDataRevision(node);
  const [staged, setStaged] = useState<DraftState | null>(null);
  // An undo/redo round trip must not revive a draft from an obsolete source.
  if (staged && staged.revision !== revision) setStaged(null);
  const state: DraftState =
    staged?.revision === revision
      ? staged
      : { revision, draft: nativeDataDraft(node), paste: "", error: "", status: "" };
  const draft = state.draft;
  const chart = draft.type === "chart";
  const columns = draft.grid[0]!.length;
  const rowCount = draft.grid.length - 1;
  const error = nativeDataFeedback(locale, state.error);
  const status = nativeDataFeedback(locale, state.status);
  function edit(next: NativeDataDraft) {
    setStaged({ ...state, draft: next, error: "", status: "" });
  }
  function cell(row: number, column: number, value: string) {
    edit({
      ...draft,
      grid: draft.grid.map((items, index) =>
        index === row
          ? items.map((item, itemIndex) => (itemIndex === column ? value : item))
          : items,
      ),
    });
  }
  function addRow() {
    if (rowCount >= 20) return;
    edit({
      ...draft,
      grid: [
        ...draft.grid,
        Array.from({ length: columns }, (_, column) =>
          chart ? (column === 0 ? `${defaults("category")} ${rowCount + 1}` : "0") : "",
        ),
      ],
    });
  }
  function addColumn() {
    if (columns >= (chart ? 5 : 6) || (chart && draft.chartType === "pie")) return;
    edit({
      ...draft,
      grid: draft.grid.map((row, index) => [
        ...row,
        index === 0
          ? defaults(chart ? "series" : "column", chart ? columns : columns + 1)
          : chart
            ? "0"
            : "",
      ]),
    });
  }
  function apply() {
    const result = applyNativeDataDraft(scene, node.id, draft);
    if (!result.success) {
      setStaged({ ...state, error: result.error, status: "" });
      return;
    }
    // A caller failure must propagate. Keep the staged draft available if the update fails.
    const accepted = onChange(result.data);
    if (accepted === false) {
      setStaged({
        ...state,
        error:
          "The presentation could not accept these changes. Your staged data is retained; reduce content and try again.",
        status: "",
      });
      return;
    }
    const next = result.data.nodes.find((candidate) => candidate.id === node.id) as NativeDataNode;
    setStaged({
      revision: nativeDataRevision(next),
      draft: nativeDataDraft(next),
      paste: "",
      error: "",
      status: "Data changes applied.",
    });
  }
  return (
    <div
      className={styles.editor}
      lang={locale}
      role="group"
      aria-label={copy(chart ? "Chart data editor" : "Table data editor")}
    >
      {draft.type === "table" ? (
        <label>
          {copy("Table caption")}
          <input
            lang=""
            maxLength={160}
            value={draft.caption}
            onChange={(event) => edit({ ...draft, caption: event.target.value })}
          />
        </label>
      ) : (
        <>
          <label>
            {copy("Chart title")}
            <input
              lang=""
              maxLength={160}
              value={draft.title}
              onChange={(event) => edit({ ...draft, title: event.target.value })}
            />
          </label>
          <label>
            {copy("Chart description")}
            <textarea
              lang=""
              maxLength={800}
              value={draft.summary}
              onChange={(event) => edit({ ...draft, summary: event.target.value })}
            />
          </label>
          <p className={styles.help}>
            {copy(
              "Describe the message and important patterns. Update this description when the data changes.",
            )}
          </p>
          <label>
            {copy("Chart type")}
            <select
              value={draft.chartType}
              onChange={(event) =>
                edit({ ...draft, chartType: event.target.value as typeof draft.chartType })
              }
            >
              <option value="bar">{copy("Bar")}</option>
              <option value="line">{copy("Line")}</option>
              <option value="pie">{copy("Pie")}</option>
            </select>
          </label>
        </>
      )}
      <NativeInspectorSection title={copy("Paste CSV or TSV data")} icon="import" name="data-paste">
        <label>
          {copy("Paste CSV or TSV data")}
          <textarea
            lang=""
            rows={5}
            value={state.paste}
            placeholder={copy(
              chart ? "Category,Series\nAlpha,10\nBeta,20" : "Category,Value\nAlpha,10\nBeta,20",
            )}
            onChange={(event) => {
              const paste = event.target.value;
              if (new TextEncoder().encode(paste).byteLength > PRESENTATION_SCENE_MAX_BYTES) {
                setStaged({
                  ...state,
                  error: "Paste at most 128 KiB of data. Your staged cells are unchanged.",
                  status: "",
                });
                return;
              }
              setStaged({ ...state, paste, error: "", status: "" });
            }}
          />
        </label>
        <p className={styles.help}>
          {copy(
            chart
              ? "Use a header row with category then series names, followed by up to 20 categories and 4 numeric series. Pie charts need one nonnegative series with a positive total."
              : "Use a header row and up to 20 data rows, with up to 6 columns. Table cells stay literal text.",
          )}{" "}
          {copy(
            "Commas, tabs, quoted cells and quoted newlines are supported. Preview before applying.",
          )}
        </p>
        <div className={styles.actions}>
          <button
            type="button"
            disabled={!state.paste}
            onClick={() => {
              const result = parseNativeDataPaste(state.paste);
              if (!result.success) {
                setStaged({ ...state, error: result.error, status: "" });
                return;
              }
              edit({ ...draft, grid: result.data });
            }}
          >
            {copy("Preview pasted data")}
          </button>
        </div>
      </NativeInspectorSection>
      <div className={`${styles.actions} ${styles.gridActions}`}>
        <button type="button" disabled={rowCount >= 20} onClick={addRow}>
          {copy(chart ? "Add category" : "Add table row")}
        </button>
        <button
          type="button"
          disabled={rowCount <= 1}
          onClick={() => edit({ ...draft, grid: draft.grid.slice(0, -1) })}
        >
          {copy(chart ? "Remove last category" : "Remove last table row")}
        </button>
        <button
          type="button"
          disabled={columns >= (chart ? 5 : 6) || (chart && draft.chartType === "pie")}
          onClick={addColumn}
        >
          {copy(chart ? "Add series" : "Add table column")}
        </button>
        <button
          type="button"
          disabled={columns <= (chart ? 2 : 1)}
          onClick={() => edit({ ...draft, grid: draft.grid.map((row) => row.slice(0, -1)) })}
        >
          {copy(chart ? "Remove last series" : "Remove last table column")}
        </button>
      </div>
      <div
        className={styles.gridWrap}
        role="region"
        tabIndex={0}
        aria-label={copy(chart ? "Chart data editor" : "Table data editor")}
        data-native-data-scroll="true"
      >
        <table className={styles.editGrid} style={{ minWidth: `${columns * 160}px` }}>
          <caption>
            {chart
              ? copy("Staged chart data · {rows} rows, {series} series", {
                  rows: rowCount,
                  series: columns - 1,
                })
              : copy("Staged table data · {rows} rows, {columns} columns", {
                  rows: rowCount,
                  columns,
                })}
          </caption>
          <tbody>
            {draft.grid.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((value, columnIndex) => {
                  const label =
                    rowIndex === 0
                      ? chart
                        ? columnIndex === 0
                          ? copy("Category heading")
                          : copy("Series {series} name", { series: columnIndex })
                        : copy("Column {column} heading", { column: columnIndex + 1 })
                      : chart
                        ? columnIndex === 0
                          ? copy("Category {row}", { row: rowIndex })
                          : copy("Category {row}, series {series} value", {
                              row: rowIndex,
                              series: columnIndex,
                            })
                        : copy("Row {row}, column {column}", {
                            row: rowIndex,
                            column: columnIndex + 1,
                          });
                  const input =
                    chart && rowIndex > 0 && columnIndex > 0 ? (
                      <input
                        lang=""
                        aria-label={label}
                        inputMode="decimal"
                        maxLength={40}
                        value={value}
                        onChange={(event) => cell(rowIndex, columnIndex, event.target.value)}
                      />
                    ) : (
                      <textarea
                        lang={chart && rowIndex === 0 && columnIndex === 0 ? locale : ""}
                        aria-label={label}
                        rows={2}
                        readOnly={chart && rowIndex === 0 && columnIndex === 0}
                        maxLength={rowIndex === 0 ? (chart ? 80 : 120) : chart ? 80 : 300}
                        value={
                          chart && rowIndex === 0 && columnIndex === 0 ? copy("Category") : value
                        }
                        onChange={(event) => cell(rowIndex, columnIndex, event.target.value)}
                      />
                    );
                  return rowIndex === 0 ? (
                    <th key={columnIndex} scope="col">
                      {input}
                    </th>
                  ) : (
                    <td key={columnIndex}>{input}</td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.help}>
        {copy(
          "These edits are staged locally until you apply them. A new paste replaces the staged grid. Discard restores this object’s current data.",
        )}
      </p>
      {state.error ? (
        <p className={styles.error} role="alert" lang={error.language}>
          {error.text}
        </p>
      ) : null}
      {state.status ? (
        <p className={styles.help} role="status" lang={status.language}>
          {status.text}
        </p>
      ) : null}
      <div className={styles.actions}>
        <button type="button" onClick={apply}>
          {copy(chart ? "Apply chart changes" : "Apply table changes")}
        </button>
        <button
          type="button"
          onClick={() =>
            setStaged({
              revision,
              draft: nativeDataDraft(node),
              paste: "",
              error: "",
              status: "Staged changes discarded.",
            })
          }
        >
          {copy("Discard staged changes")}
        </button>
      </div>
    </div>
  );
}
