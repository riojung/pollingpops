"use client";
import { useEffect, useRef, useState } from "react";
import type { CanvasTimer } from "@openround/contracts";
import { useLocale } from "../locale-provider";
import { canvasFacilitationCopy } from "../../lib/i18n/canvas-facilitation-messages";
import { canvasFacilitationUiCopy } from "../../lib/i18n/canvas-facilitation-ui-messages";
import styles from "./canvas-facilitation.module.css";

export function canvasTimerRemaining(timer: CanvasTimer, serverNow: string, elapsedMs = 0) {
  return Math.max(
    0,
    timer.status === "running" && timer.deadlineAt
      ? Math.min(timer.remainingMs, Date.parse(timer.deadlineAt) - Date.parse(serverNow)) -
          Math.max(0, elapsedMs)
      : timer.remainingMs,
  );
}
export function CanvasTimerDisplay({
  timer,
  serverNow,
  observedAt,
  idleSeconds = 0,
  showProgress = false,
}: {
  timer: CanvasTimer;
  serverNow: string;
  observedAt?: number;
  idleSeconds?: number;
  showProgress?: boolean;
}) {
  const { locale } = useLocale();
  const copy = canvasFacilitationCopy(locale);
  const ui = canvasFacilitationUiCopy(locale);
  const base = useRef({
    serverNow,
    revision: timer.revision,
    time: observedAt ?? performance.now(),
  });
  const [elapsed, setElapsed] = useState(() => Math.max(0, performance.now() - base.current.time));
  useEffect(() => {
    base.current = { serverNow, revision: timer.revision, time: observedAt ?? performance.now() };
    setElapsed(Math.max(0, performance.now() - base.current.time));
    if (timer.status !== "running") return;
    const tick = window.setInterval(() => setElapsed(performance.now() - base.current.time), 250);
    return () => window.clearInterval(tick);
  }, [serverNow, timer.revision, timer.status, observedAt]);
  const remaining = canvasTimerRemaining(
    timer,
    serverNow,
    base.current.serverNow === serverNow && base.current.revision === timer.revision ? elapsed : 0,
  );
  const preview = timer.status === "idle" && Number.isFinite(idleSeconds) && idleSeconds > 0;
  const shownRemaining = preview ? idleSeconds * 1000 : remaining;
  const seconds = Math.ceil(shownRemaining / 1000);
  const total = preview ? idleSeconds * 1000 : (timer.durationSeconds ?? 0) * 1000;
  const progress = total > 0 ? Math.max(0, Math.min(100, 100 * (1 - shownRemaining / total))) : 0;
  const status = timer.status === "running" && !remaining ? "finished" : timer.status;
  return (
    <div className={styles.timer}>
      <output role="timer" aria-label={copy.timerLabel}>
        {String(Math.floor(seconds / 60)).padStart(2, "0")}:{String(seconds % 60).padStart(2, "0")}
      </output>
      <p role="status">{preview ? ui.ready : copy[status]}</p>
      {showProgress ? (
        <div
          className={styles.timerProgress}
          role="progressbar"
          aria-label={ui.timerProgress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress)}
        >
          <span style={{ width: `${progress}%` }} />
        </div>
      ) : null}
    </div>
  );
}
