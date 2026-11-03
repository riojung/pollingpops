"use client";
import { useMemo, useState } from "react";
import type { CanvasBoardView } from "@openround/contracts";
import { useLocale } from "../locale-provider";
import { formatNumber } from "../../lib/i18n/format";
import { canvasChromeCopy } from "../../lib/i18n/canvas-chrome-messages";
import { canvasSelectionClosure } from "./canvas-hierarchy";
import {
  planCanvasArrange,
  planCanvasDuplicate,
  planCanvasDelete,
  planCanvasFrame,
  planCanvasGroup,
  planCanvasLock,
  planCanvasReparent,
  planCanvasTransform,
  planCanvasUngroup,
  type CanvasPlan,
  type CanvasPlanReason,
} from "./canvas-productivity";
import styles from "./canvas-selection-tools.module.css";
export function canvasPlanMessage(reason: CanvasPlanReason) {
  if (reason === "permission") return "canvas.readOnly";
  if (reason === "protected") return "canvas.protected";
  if (reason === "objects") return "canvas.productivity.bounds";
  return `canvas.productivity.${reason}` as const;
}
type SelectionAction =
  | "all"
  | "clear"
  | "group"
  | "ungroup"
  | "frame"
  | "duplicate"
  | "remove"
  | "lock"
  | "unlock"
  | "left"
  | "center"
  | "right"
  | "top"
  | "middle"
  | "bottom"
  | "horizontal"
  | "vertical";
const actionPaths: Record<SelectionAction, string> = {
  all: "M4 8V4h4m8 0h4v4m0 8v4h-4m-8 0H4v-4M8 8h8v8H8Z",
  clear: "M5 5l14 14M19 5 5 19",
  group: "M3 7V3h4m10 0h4v4m0 10v4h-4M7 21H3v-4M7 7h6v6H7Zm4 4h6v6h-6",
  ungroup: "M3 3h7v7H3Zm11 11h7v7h-7M14 3h7v7M3 14v7h7m-2-5 8-8",
  frame: "M4 9V4h5m6 0h5v5m0 6v5h-5m-6 0H4v-5M8 8h8v8H8Z",
  duplicate: "M8 8h13v13H8ZM3 16V3h13",
  remove: "M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7",
  lock: "M6 10h12v11H6Zm3 0V6a3 3 0 0 1 6 0v4m-3 5v2",
  unlock: "M6 10h12v11H6Zm3 0V6a3 3 0 0 1 6 0m-3 9v2",
  left: "M4 3v18M8 5h12v5H8Zm0 9h8v5H8Z",
  center: "M12 3v18M4 5h16v5H4Zm3 9h10v5H7Z",
  right: "M20 3v18M4 5h12v5H4Zm4 9h8v5H8Z",
  top: "M3 4h18M5 8h5v12H5Zm9 0h5v8h-5Z",
  middle: "M3 12h18M5 4h5v16H5Zm9 3h5v10h-5Z",
  bottom: "M3 20h18M5 4h5v12H5Zm9 4h5v8h-5Z",
  horizontal: "M3 4v16m18-16v16M6 8h4v8H6Zm8-3h4v14h-4Z",
  vertical: "M4 3h16M4 21h16M8 6h8v4H8Zm-3 8h14v4H5Z",
};
function SelectionIcon({ name }: { name: SelectionAction }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={actionPaths[name]} />
    </svg>
  );
}
export function CanvasSelectionTools({
  board,
  ids,
  disabled,
  onPlan,
  onAll,
  onClear,
}: {
  board: CanvasBoardView;
  ids: string[];
  disabled: boolean;
  onPlan: (plan: CanvasPlan) => Promise<boolean>;
  onAll: () => void;
  onClear: () => void;
}) {
  const { t, locale } = useLocale();
  const copy = canvasChromeCopy(locale);
  const [dx, setDx] = useState(20),
    [dy, setDy] = useState(0),
    [parentId, setParentId] = useState("");
  const key = ids.join(","),
    frameTitle = t("canvas.productivity.frame");
  const plans = useMemo(
    () => ({
      group: planCanvasGroup(board, ids),
      ungroup: planCanvasUngroup(board, ids),
      frame: planCanvasFrame(board, ids, frameTitle),
      lock: planCanvasLock(board, ids, true),
      unlock: planCanvasLock(board, ids, false),
      duplicate: planCanvasDuplicate(board, ids),
      remove: planCanvasDelete(board, ids),
      arrange: (
        ["left", "center", "right", "top", "middle", "bottom", "horizontal", "vertical"] as const
      ).map((mode) => ({ mode, plan: planCanvasArrange(board, ids, mode) })),
    }),
    [board, key, frameTitle],
  );
  const move = planCanvasTransform(board, ids, { type: "move", dx, dy });
  const reparent = planCanvasReparent(board, ids, parentId || null);
  const selection = canvasSelectionClosure(board.objects, ids);
  const affected = new Set(selection.map((object) => object.id));
  function action(label: string, plan: CanvasPlan, name: SelectionAction, iconOnly = false) {
    return (
      <button
        type="button"
        className={iconOnly ? styles.iconAction : styles.action}
        aria-label={label}
        data-canvas-selection-action={name}
        disabled={disabled || !plan.command}
        title={plan.reason ? t(canvasPlanMessage(plan.reason)) : label}
        onClick={() => {
          if (!disabled && plan.command) void onPlan(plan);
        }}
      >
        <SelectionIcon name={name} />
        {!iconOnly ? <span>{label}</span> : null}
      </button>
    );
  }
  return (
    <section
      className={styles.tools}
      aria-label={t("canvas.productivity.selected", { count: formatNumber(locale, ids.length) })}
    >
      <header className={styles.header}>
        <h2>{t("canvas.productivity.selected", { count: formatNumber(locale, ids.length) })}</h2>
        <div className={styles.selectionActions}>
          <button
            type="button"
            className={styles.iconAction}
            aria-label={t("canvas.productivity.all")}
            title={t("canvas.productivity.all")}
            disabled={disabled}
            onClick={onAll}
          >
            <SelectionIcon name="all" />
          </button>
          <button
            type="button"
            className={styles.iconAction}
            aria-label={t("canvas.productivity.clear")}
            title={t("canvas.productivity.clear")}
            disabled={disabled}
            onClick={onClear}
          >
            <SelectionIcon name="clear" />
          </button>
        </div>
      </header>
      <div className={styles.group} role="group" aria-label={copy.quickActions}>
        <h3>{copy.quickActions}</h3>
        <div className={styles.actionGrid}>
          {action(t("canvas.productivity.group"), plans.group, "group")}
          {selection.some((object) => object.geometricGroupId)
            ? action(t("canvas.productivity.ungroup"), plans.ungroup, "ungroup")
            : null}
          {action(t("canvas.productivity.frameSelection"), plans.frame, "frame")}
          {action(t("canvas.duplicate"), plans.duplicate, "duplicate")}
          {action(t("boards.deleteElement"), plans.remove, "remove")}
          {plans.lock.command || !plans.unlock.command
            ? action(t("canvas.productivity.lock"), plans.lock, "lock")
            : null}
          {plans.unlock.command
            ? action(t("canvas.productivity.unlock"), plans.unlock, "unlock")
            : null}
        </div>
      </div>
      <div className={styles.group} role="group" aria-label={copy.arrange}>
        <h3>{copy.arrange}</h3>
        <div className={styles.arrangeGrid}>
          {plans.arrange.map(({ mode, plan }) => (
            <span key={mode}>{action(t(`canvas.productivity.${mode}`), plan, mode, true)}</span>
          ))}
        </div>
      </div>
      <details>
        <summary>{t("canvas.productivity.move")}</summary>
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            if (!disabled && move.command) void onPlan(move);
          }}
        >
          <div className={styles.numeric}>
            <label>
              {t("canvas.productivity.moveX")}
              <input
                type="number"
                step="any"
                min={-100000}
                max={100000}
                value={dx}
                disabled={disabled}
                onChange={(event) => setDx(event.currentTarget.valueAsNumber || 0)}
              />
            </label>
            <label>
              {t("canvas.productivity.moveY")}
              <input
                type="number"
                step="any"
                min={-100000}
                max={100000}
                value={dy}
                disabled={disabled}
                onChange={(event) => setDy(event.currentTarget.valueAsNumber || 0)}
              />
            </label>
          </div>
          <button className={styles.apply} type="submit" disabled={disabled || !move.command}>
            {t("canvas.productivity.move")}
          </button>
        </form>
      </details>
      <details>
        <summary>{t("canvas.productivity.parentFrame")}</summary>
        <label>
          {t("canvas.productivity.parentFrame")}
          <select
            value={parentId}
            disabled={disabled}
            onChange={(event) => setParentId(event.target.value)}
          >
            <option value="">{t("canvas.productivity.noFrame")}</option>
            {board.objects
              .filter((object) => object.type === "frame" && !affected.has(object.id))
              .map((object) => (
                <option key={object.id} value={object.id}>
                  {object.text || frameTitle}
                </option>
              ))}
          </select>
        </label>
        <div className={styles.parentAction}>
          {action(t("canvas.productivity.applyFrame"), reparent, "frame")}
        </div>
      </details>
      {move.reason === "limit" ? <p role="status">{t("canvas.productivity.limit")}</p> : null}
      {move.reason === "locked" ? <p>{t("canvas.productivity.locked")}</p> : null}
      <details className={styles.help}>
        <summary>{t("workspace.help")}</summary>
        <p>{t("canvas.productivity.help")}</p>
      </details>
    </section>
  );
}
