"use client";
import { useMemo, useState } from "react";
import type { CanvasBoardView } from "@openround/contracts";
import { useLocale } from "../locale-provider";
import { formatNumber } from "../../lib/i18n/format";
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
import styles from "./canvas.module.css";
export function canvasPlanMessage(reason: CanvasPlanReason) {
  if (reason === "permission") return "canvas.readOnly";
  if (reason === "protected") return "canvas.protected";
  if (reason === "objects") return "canvas.productivity.bounds";
  return `canvas.productivity.${reason}` as const;
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
  const affected = new Set(canvasSelectionClosure(board.objects, ids).map((object) => object.id));
  function action(label: string, plan: CanvasPlan) {
    return (
      <button
        type="button"
        className="button-quiet"
        disabled={disabled || !plan.command}
        title={plan.reason ? t(canvasPlanMessage(plan.reason)) : undefined}
        onClick={() => void onPlan(plan)}
      >
        {label}
      </button>
    );
  }
  return (
    <section
      className={styles.selectionTools}
      aria-label={t("canvas.productivity.selected", { count: formatNumber(locale, ids.length) })}
    >
      <h2>{t("canvas.productivity.selected", { count: formatNumber(locale, ids.length) })}</h2>
      <div className={styles.actions}>
        <button type="button" className="button-quiet" disabled={disabled} onClick={onAll}>
          {t("canvas.productivity.all")}
        </button>
        <button type="button" className="button-quiet" disabled={disabled} onClick={onClear}>
          {t("canvas.productivity.clear")}
        </button>
      </div>
      <div className={styles.actions}>
        {action(t("canvas.productivity.group"), plans.group)}
        {action(t("canvas.productivity.ungroup"), plans.ungroup)}
        {action(t("canvas.productivity.frameSelection"), plans.frame)}
      </div>
      <div className={styles.actions}>
        {action(t("canvas.duplicate"), plans.duplicate)}
        {action(t("boards.deleteElement"), plans.remove)}
        {action(t("canvas.productivity.lock"), plans.lock)}
        {action(t("canvas.productivity.unlock"), plans.unlock)}
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
          <button className="button-quiet" type="submit" disabled={disabled || !move.command}>
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
        {action(t("canvas.productivity.applyFrame"), reparent)}
      </details>
      <div className={styles.actions}>
        {plans.arrange.map(({ mode, plan }) => (
          <span key={mode}>{action(t(`canvas.productivity.${mode}`), plan)}</span>
        ))}
      </div>
      {move.reason === "limit" ? <p role="status">{t("canvas.productivity.limit")}</p> : null}
      {move.reason === "locked" ? <p>{t("canvas.productivity.locked")}</p> : null}
      <p className={styles.keyboardHelp}>{t("canvas.productivity.help")}</p>
    </section>
  );
}
