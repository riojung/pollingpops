"use client";
import { useEffect, useRef, useState } from "react";
import type { CanvasTimer } from "@openround/contracts";
import { useLocale } from "../locale-provider";
import { canvasFacilitationCopy } from "../../lib/i18n/canvas-facilitation-messages";
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
}: {
  timer: CanvasTimer;
  serverNow: string;
}) {
  const { locale } = useLocale();
  const copy = canvasFacilitationCopy(locale);
  const base = useRef({ serverNow, revision: timer.revision, time: performance.now() });
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    base.current = { serverNow, revision: timer.revision, time: performance.now() };
    setElapsed(0);
    if (timer.status !== "running") return;
    const tick = window.setInterval(() => setElapsed(performance.now() - base.current.time), 250);
    return () => window.clearInterval(tick);
  }, [serverNow, timer.revision, timer.status]);
  const remaining = canvasTimerRemaining(
    timer,
    serverNow,
    base.current.serverNow === serverNow && base.current.revision === timer.revision ? elapsed : 0,
  );
  const seconds = Math.ceil(remaining / 1000);
  const status = timer.status === "running" && !remaining ? "finished" : timer.status;
  return (
    <div className={styles.timer}>
      <output role="timer" aria-label={copy.timerLabel}>
        {String(Math.floor(seconds / 60)).padStart(2, "0")}:{String(seconds % 60).padStart(2, "0")}
      </output>
      <p role="status">{copy[status]}</p>
    </div>
  );
}
