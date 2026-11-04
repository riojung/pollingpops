"use client";

import { useEffect, useId, useState } from "react";
import styles from "./presenter-timer.module.css";

export interface PresenterTimerState {
  elapsedMs: number;
  startedAt: number | null;
}

type TimerAction = "start" | "pause" | "reset";
type TimerStorage = Pick<Storage, "getItem" | "setItem">;

const emptyTimer = (): PresenterTimerState => ({ elapsedMs: 0, startedAt: null });

export function presenterTimerStorageKey(sessionId: string): string {
  return `openround:presentation-presenter-timer:v1:${sessionId}`;
}

export function elapsedPresentationTime(timer: PresenterTimerState, now: number): number {
  return timer.elapsedMs + (timer.startedAt === null ? 0 : Math.max(0, now - timer.startedAt));
}

export function transitionPresenterTimer(
  timer: PresenterTimerState,
  action: TimerAction,
  now: number,
): PresenterTimerState {
  if (action === "reset") return emptyTimer();
  if (action === "start") {
    return timer.startedAt === null ? { ...timer, startedAt: now } : timer;
  }
  return timer.startedAt === null
    ? timer
    : { elapsedMs: elapsedPresentationTime(timer, now), startedAt: null };
}

export function formatPresentationElapsedTime(elapsedMs: number): string {
  const totalSeconds = Math.floor(Math.max(0, elapsedMs) / 1000);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${String(minutes).padStart(2, "0")}:${seconds}`;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${seconds}`;
}

function validMilliseconds(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function readPresenterTimer(
  storage: Pick<TimerStorage, "getItem"> | null,
  sessionId: string,
): PresenterTimerState {
  try {
    const saved = storage?.getItem(presenterTimerStorageKey(sessionId));
    if (!saved) return emptyTimer();
    const value: unknown = JSON.parse(saved);
    if (
      typeof value === "object" &&
      value !== null &&
      "version" in value &&
      value.version === 1 &&
      "elapsedMs" in value &&
      validMilliseconds(value.elapsedMs) &&
      "startedAt" in value &&
      (value.startedAt === null || validMilliseconds(value.startedAt))
    ) {
      return { elapsedMs: value.elapsedMs, startedAt: value.startedAt };
    }
  } catch {
    // A private/local timer remains usable when browser storage is unavailable.
  }
  return emptyTimer();
}

export function writePresenterTimer(
  storage: Pick<TimerStorage, "setItem"> | null,
  sessionId: string,
  timer: PresenterTimerState,
): void {
  try {
    storage?.setItem(presenterTimerStorageKey(sessionId), JSON.stringify({ version: 1, ...timer }));
  } catch {
    // Storage failure must not stop local timer controls.
  }
}

function browserTimerStorage(): TimerStorage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function SessionPresenterTimer({ sessionId }: { sessionId: string }) {
  const descriptionId = useId();
  const [timer, setTimer] = useState<PresenterTimerState | null>(null);
  const [now, setNow] = useState(0);
  const running = timer?.startedAt !== null && timer?.startedAt !== undefined;

  useEffect(() => {
    setTimer(readPresenterTimer(browserTimerStorage(), sessionId));
    setNow(Date.now());
  }, [sessionId]);

  useEffect(() => {
    if (!running) return;
    const update = () => setNow(Date.now());
    // Wall-clock anchors retain elapsed time while background tabs throttle ticks.
    const interval = window.setInterval(update, 250);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", update);
    };
  }, [running]);

  function changeTimer(action: TimerAction) {
    if (timer === null) return;
    const timestamp = Date.now();
    const next = transitionPresenterTimer(timer, action, timestamp);
    writePresenterTimer(browserTimerStorage(), sessionId, next);
    setNow(timestamp);
    setTimer(next);
  }

  return (
    <>
      <div className={styles.heading}>
        <h2>Presentation timer</h2>
        <span className={styles.status} role="status">
          {running ? "Running" : timer && timer.elapsedMs > 0 ? "Paused" : "Ready"}
        </span>
      </div>
      <output
        className={styles.time}
        role="timer"
        aria-live="off"
        aria-label="Elapsed presentation time"
      >
        {formatPresentationElapsedTime(timer ? elapsedPresentationTime(timer, now) : 0)}
      </output>
      <p className={styles.description} id={descriptionId}>
        Private to this tab. Reset affects only this timer.
      </p>
      <div className={styles.controls} aria-describedby={descriptionId}>
        <button
          type="button"
          disabled={timer === null || running}
          onClick={() => changeTimer("start")}
        >
          Start
        </button>
        <button
          type="button"
          disabled={timer === null || !running}
          onClick={() => changeTimer("pause")}
        >
          Pause
        </button>
        <button type="button" disabled={timer === null} onClick={() => changeTimer("reset")}>
          Reset
        </button>
      </div>
    </>
  );
}

export function PresenterTimer({
  sessionId,
  className,
}: {
  sessionId: string;
  className?: string;
}) {
  return (
    <section
      className={[styles.timer, className].filter(Boolean).join(" ")}
      aria-label="Presentation timer"
      lang="en-CA"
    >
      <SessionPresenterTimer key={sessionId} sessionId={sessionId} />
    </section>
  );
}
