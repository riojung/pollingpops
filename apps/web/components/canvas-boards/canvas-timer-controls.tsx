"use client";

import { useId } from "react";
import type { CanvasFacilitationCommand, CanvasTimer } from "@openround/contracts";
import { useLocale } from "../locale-provider";
import { canvasFacilitationCopy } from "../../lib/i18n/canvas-facilitation-messages";
import { canvasFacilitationUiCopy } from "../../lib/i18n/canvas-facilitation-ui-messages";
import { formatNumber } from "../../lib/i18n/format";
import { CanvasTimerDisplay } from "./canvas-timer";
import styles from "./canvas-facilitation.module.css";

type IconName =
  | "comments"
  | "timer"
  | "versions"
  | "play"
  | "pause"
  | "reset"
  | "minus"
  | "plus"
  | "float"
  | "close";
const paths: Record<IconName, string> = {
  comments: "M3 4h18v13H9l-6 4V4Zm4 5h10M7 13h6",
  timer: "M20 13a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM12 9v5l3 2M9 2h6m-3 0v3m6-1 2 2",
  versions: "M4 7h16v14H4V7Zm3-3h10M9 1h6M8 11h8m-8 4h5",
  play: "m9 5 11 7-11 7V5Z",
  pause: "M7 5h3v14H7Zm7 0h3v14h-3Z",
  reset: "M4 4v6h6M4 10a8 8 0 1 1 1 8",
  minus: "M5 12h14",
  plus: "M5 12h14M12 5v14",
  float: "M14 3h7v7m0-7-9 9M9 4H4v16h16v-5",
  close: "m6 6 12 12M18 6 6 18",
};
/** Locally authored line artwork; the labelled control supplies the accessible name. */
export function FacilitationIcon({ name }: { name: IconName }) {
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
      <path d={paths[name]} />
    </svg>
  );
}
export interface CanvasTimerControlsProps {
  timer: CanvasTimer;
  serverNow: string;
  observedAt?: number;
  minutes: number;
  onMinutes: (minutes: number) => void;
  canControl: boolean;
  disabled?: boolean;
  onCommand: (command: CanvasFacilitationCommand) => void;
  onFloat?: () => void;
}
export function CanvasTimerControls({
  timer,
  serverNow,
  observedAt,
  minutes,
  onMinutes,
  canControl,
  disabled = false,
  onCommand,
  onFloat,
}: CanvasTimerControlsProps) {
  const { locale } = useLocale();
  const copy = canvasFacilitationCopy(locale),
    ui = canvasFacilitationUiCopy(locale);
  const id = useId();
  const active = timer.status === "running" || timer.status === "paused";
  const durationDisabled = disabled || active;
  const valid = Number.isInteger(minutes) && minutes >= 1 && minutes <= 120;
  const action =
    timer.status === "running" ? "pause" : timer.status === "paused" ? "resume" : "start";
  const shownMinutes =
    active && timer.durationSeconds ? Math.max(1, Math.ceil(timer.durationSeconds / 60)) : minutes;
  function submit() {
    if (disabled || !canControl || (action === "start" && !valid)) return;
    onCommand(
      action === "start"
        ? { type: "timer_start", expectedRevision: timer.revision, durationSeconds: minutes * 60 }
        : {
            type: action === "pause" ? "timer_pause" : "timer_resume",
            expectedRevision: timer.revision,
          },
    );
  }
  function step(delta: number) {
    if (durationDisabled || !canControl) return;
    onMinutes(
      Math.min(120, Math.max(1, Number.isFinite(minutes) ? Math.round(minutes) + delta : 5)),
    );
  }
  return (
    <div className={styles.timerWidget} role="group" aria-label={ui.timerControls}>
      <CanvasTimerDisplay
        timer={timer}
        serverNow={serverNow}
        observedAt={observedAt}
        idleSeconds={canControl && valid ? minutes * 60 : 0}
        showProgress
      />
      {canControl ? (
        <form
          className={styles.timerForm}
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {!active ? (
            <>
              <div className={styles.duration}>
                <label htmlFor={`${id}-minutes`}>{copy.duration}</label>
                <div className={styles.durationStepper}>
                  <button
                    type="button"
                    aria-label={ui.decreaseDuration}
                    title={ui.decreaseDuration}
                    disabled={durationDisabled || minutes <= 1}
                    onClick={() => step(-1)}
                  >
                    <FacilitationIcon name="minus" />
                  </button>
                  <input
                    id={`${id}-minutes`}
                    type="number"
                    min="1"
                    max="120"
                    step="1"
                    inputMode="numeric"
                    value={Number.isFinite(shownMinutes) ? shownMinutes : ""}
                    disabled={durationDisabled}
                    onChange={(event) => {
                      if (!durationDisabled) onMinutes(event.currentTarget.valueAsNumber);
                    }}
                  />
                  <button
                    type="button"
                    aria-label={ui.increaseDuration}
                    title={ui.increaseDuration}
                    disabled={durationDisabled || minutes >= 120}
                    onClick={() => step(1)}
                  >
                    <FacilitationIcon name="plus" />
                  </button>
                </div>
              </div>
              <div className={styles.presets} role="group" aria-label={ui.quickDurations}>
                {[1, 3, 5, 10, 15, 25].map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={shownMinutes === value}
                    disabled={durationDisabled}
                    onClick={() => {
                      if (!durationDisabled) onMinutes(value);
                    }}
                  >
                    {ui.presetMinutes.replace("{minutes}", formatNumber(locale, value))}
                  </button>
                ))}
              </div>
            </>
          ) : null}
          <div className={styles.timerActions}>
            <button
              type="submit"
              data-timer-primary
              className={styles.primary}
              aria-label={copy[action]}
              disabled={disabled || (action === "start" && !valid)}
            >
              <FacilitationIcon name={action === "pause" ? "pause" : "play"} />
              <span>{copy[action]}</span>
            </button>
            <button
              type="button"
              className={styles.reset}
              aria-label={copy.reset}
              title={copy.reset}
              disabled={disabled || timer.status === "idle"}
              onClick={() => {
                if (!disabled && timer.status !== "idle")
                  onCommand({ type: "timer_reset", expectedRevision: timer.revision });
              }}
            >
              <FacilitationIcon name="reset" />
            </button>
          </div>
        </form>
      ) : null}
      <p className={styles.timerHelp}>{copy.timerHelp}</p>
      {onFloat ? (
        <button type="button" className={styles.floatAction} onClick={onFloat}>
          <FacilitationIcon name="float" />
          <span>{ui.floatTimer}</span>
        </button>
      ) : null}
    </div>
  );
}
