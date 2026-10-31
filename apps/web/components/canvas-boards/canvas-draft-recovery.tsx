"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "../locale-provider";
import { formatNumber } from "../../lib/i18n/format";
import { canvasDiagramCopy } from "../../lib/i18n/canvas-diagram-messages";
import type { CanvasDraftRecoveryReason, CanvasObjectDraft } from "./canvas-draft";
import styles from "./canvas.module.css";

export function CanvasDraftRecovery({
  draft,
  reason,
  disabled,
  onDiscard,
}: {
  draft: CanvasObjectDraft;
  reason: CanvasDraftRecoveryReason;
  disabled?: boolean;
  onDiscard: () => void;
}) {
  const { t, locale } = useLocale();
  const diagram = canvasDiagramCopy(locale);
  const [notice, setNotice] = useState<"copied" | "manual" | null>(null);
  const text = useRef<HTMLTextAreaElement>(null);
  const active = useRef(true);
  const recoveredText = [
    draft.text,
    draft.altText !== undefined ? `${t("canvas.assets.altText")}: ${draft.altText}` : "",
    draft.url !== undefined ? `${t("canvas.assets.url")}: ${draft.url}` : "",
    ...(draft.routing !== undefined
      ? [
          `${diagram.routing}: ${diagram[draft.routing]}`,
          `${diagram.lineStyle}: ${diagram[draft.lineStyle ?? "solid"]}`,
          `${diagram.lineColor}: ${!draft.lineColor || draft.lineColor === "neutral" ? diagram.neutral : t(draft.lineColor === "yellow" || draft.lineColor === "pink" || draft.lineColor === "white" ? `canvas.color.${draft.lineColor}` : draft.lineColor === "blue" ? "boards.colorBlue" : draft.lineColor === "green" ? "boards.colorGreen" : "boards.colorPurple")}`,
          `${diagram.startMarker}: ${diagram[draft.startMarker ?? "none"]}`,
          `${diagram.endMarker}: ${diagram[draft.endMarker ?? "arrow"]}`,
          `${diagram.fromPort}: ${draft.fromId ? diagram[draft.fromAnchor ?? "center"] : diagram.free}`,
          `${diagram.toPort}: ${draft.toId ? diagram[draft.toAnchor ?? "center"] : diagram.free}`,
          ...(["fromX", "fromY", "toX", "toY"] as const).flatMap((field) =>
            draft[field] === undefined
              ? []
              : [`${diagram[field]}: ${formatNumber(locale, draft[field]!)}`],
          ),
        ]
      : []),
    ...(draft.rotation ? [`${diagram.rotation}: ${formatNumber(locale, draft.rotation)}`] : []),
  ]
    .filter(Boolean)
    .join("\n");
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const heading = t(
    reason === "missing"
      ? "canvas.draftMissing"
      : reason === "unavailable"
        ? "canvas.draftUnavailable"
        : "canvas.draftReadOnly",
  );
  async function copy() {
    try {
      await navigator.clipboard.writeText(recoveredText);
      if (active.current) setNotice("copied");
    } catch {
      if (!active.current) return;
      text.current?.focus();
      text.current?.select();
      setNotice("manual");
    }
  }
  return (
    <section className={styles.draftRecovery} aria-labelledby="canvas-draft-recovery-title">
      <h2 id="canvas-draft-recovery-title" aria-live="polite">
        {heading}
      </h2>
      <p>
        {t(
          reason === "missing"
            ? "canvas.draftMissingHelp"
            : reason === "unavailable"
              ? "canvas.draftUnavailableHelp"
              : "canvas.draftReadOnlyHelp",
        )}
      </p>
      <label>
        {t("canvas.yourDraft")}
        <textarea ref={text} value={recoveredText} readOnly dir="auto" lang="" />
      </label>
      <dl>
        {(["x", "y", "width", "height"] as const).map((field) => (
          <div key={field}>
            <dt>
              {t(
                field === "x"
                  ? "boards.positionX"
                  : field === "y"
                    ? "boards.positionY"
                    : field === "width"
                      ? "boards.shapeWidth"
                      : "boards.shapeHeight",
              )}
            </dt>
            <dd>{formatNumber(locale, draft[field])}</dd>
          </div>
        ))}
      </dl>
      <div className={styles.actions}>
        <button
          type="button"
          className="button"
          disabled={!recoveredText}
          onClick={() => void copy()}
        >
          {t("canvas.copyDraft")}
        </button>
        <button type="button" className="button-quiet" disabled={disabled} onClick={onDiscard}>
          {t("canvas.discard")}
        </button>
      </div>
      {notice ? (
        <p role="status">
          {t(notice === "copied" ? "canvas.draftCopied" : "canvas.draftCopyManual")}
        </p>
      ) : null}
    </section>
  );
}
