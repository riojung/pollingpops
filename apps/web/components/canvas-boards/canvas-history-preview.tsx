"use client";
import { useEffect, useState } from "react";
import type { CanvasBoardView, CanvasVersionView } from "@openround/contracts";
import { AUTH_CHANGE_EVENT } from "../../lib/api";
import { useLocale } from "../locale-provider";
import { canvasFacilitationCopy } from "../../lib/i18n/canvas-facilitation-messages";
import { CanvasReadOnlySurface } from "./canvas-surface";
import { readCanvasVersion } from "./canvas-facilitation-client";
import { planCanvasHistoryLayout } from "./canvas-history-layout";
import type { CanvasPlan } from "./canvas-productivity";
import styles from "./canvas-facilitation.module.css";

export function CanvasHistoryPreview({
  board,
  versionId,
  disabled,
  onPlan,
  onClose,
}: {
  board: CanvasBoardView;
  versionId: string;
  disabled: boolean;
  onPlan: (plan: CanvasPlan) => Promise<boolean>;
  onClose: () => void;
}) {
  const { locale } = useLocale();
  const copy = canvasFacilitationCopy(locale);
  const key = `${board.id}:${versionId}:${board.canvasSeq}:${board.sourceBoard?.revision ?? 0}`;
  const [state, setState] = useState<{
    key: string;
    data: CanvasVersionView | null;
    failed: boolean;
  }>({ key: "", data: null, failed: false });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setState({ key, data: null, failed: false });
    void readCanvasVersion(board.id, versionId, abort.signal)
      .then((data) => {
        if (!abort.signal.aborted) setState({ key, data, failed: false });
      })
      .catch(() => {
        if (!abort.signal.aborted) setState({ key, data: null, failed: true });
      });
    const changed = () => {
      abort.abort();
      setState({ key: "", data: null, failed: false });
      setRevision((value) => value + 1);
    };
    window.addEventListener(AUTH_CHANGE_EVENT, changed);
    return () => {
      abort.abort();
      window.removeEventListener(AUTH_CHANGE_EVENT, changed);
    };
  }, [board.id, versionId, key, revision]);
  const data = state.key === key ? state.data : null;
  const plan = data ? planCanvasHistoryLayout(board, data.objects) : null;
  return (
    <section className={styles.preview} aria-label={copy.savedVersion}>
      <div className={styles.actions}>
        <h3>{data?.version.name ?? copy.savedVersion}</h3>
        <button type="button" className="button-quiet" onClick={onClose}>
          {copy.close}
        </button>
      </div>
      {state.key === key && state.failed ? (
        <div role="alert">
          <p>{copy.unavailable}</p>
          <button
            type="button"
            className="button-quiet"
            onClick={() => setRevision((value) => value + 1)}
          >
            {copy.refresh}
          </button>
        </div>
      ) : !data ? (
        <p role="status">{copy.loading}</p>
      ) : (
        <>
          <CanvasReadOnlySurface
            objects={data.objects}
            canvasId={board.id}
            versionId={versionId}
            sourceBoardId={board.sourceBoardId ?? undefined}
            sourceBoard={board.sourceBoard}
            label={data.version.name}
          />
          {board.capabilities.edit ? (
            <>
              <p className={styles.muted}>{copy.restoreHelp}</p>
              <button
                type="button"
                className="button-quiet"
                disabled={disabled || !plan?.command}
                onClick={() => plan?.command && void onPlan(plan)}
              >
                {copy.restore}
              </button>
              {plan?.reason && plan.reason !== "empty" ? <p>{copy.restoreBlocked}</p> : null}
            </>
          ) : null}
        </>
      )}
    </section>
  );
}
