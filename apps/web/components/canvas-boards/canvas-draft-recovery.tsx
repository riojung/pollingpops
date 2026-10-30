"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "../locale-provider";
import { formatNumber } from "../../lib/i18n/format";
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
  const [notice, setNotice] = useState<"copied" | "manual" | null>(null);
  const text = useRef<HTMLTextAreaElement>(null);
  const active = useRef(true);
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
      await navigator.clipboard.writeText(draft.text);
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
        <textarea ref={text} value={draft.text} readOnly dir="auto" lang="" />
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
        <button type="button" className="button" disabled={!draft.text} onClick={() => void copy()}>
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
