"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import type {
  PresentationMotionBackground as MotionPreset,
  PresentationSceneDesign,
  SupportedLocale,
} from "@openround/contracts";
import { motionBackgroundCopy } from "./motion-background-copy";
import styles from "./presentation-motion-background.module.css";

export const PRESENTATION_MOTION_PAUSE_KEY = "polling-pops:presentation-motion-paused";
const pauseEvent = "polling-pops:presentation-motion-preference";
let fallbackPaused = false;
let failedWriteOverride: boolean | undefined;
const serverFalse = () => false;
const noopSubscribe = () => () => {};

export function getPresentationMotionPaused() {
  if (typeof window === "undefined") return false;
  if (failedWriteOverride !== undefined) return failedWriteOverride;
  try {
    return window.localStorage.getItem(PRESENTATION_MOTION_PAUSE_KEY) === "true";
  } catch {
    return fallbackPaused;
  }
}

function subscribePaused(listener: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === null || event.key === PRESENTATION_MOTION_PAUSE_KEY) {
      failedWriteOverride = undefined;
      listener();
    }
  };
  window.addEventListener(pauseEvent, listener);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(pauseEvent, listener);
    window.removeEventListener("storage", storage);
  };
}

/** A local playback preference, never a document edit, response or broadcast action. */
export function setPresentationMotionPaused(paused: boolean) {
  fallbackPaused = paused;
  failedWriteOverride = undefined;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PRESENTATION_MOTION_PAUSE_KEY, String(paused));
  } catch {
    failedWriteOverride = paused;
    // Playback controls remain usable when browser storage is unavailable.
  }
  window.dispatchEvent(new Event(pauseEvent));
}

export function getPresentationMotionReduced() {
  if (typeof window === "undefined") return false;
  if (
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ||
    (typeof document !== "undefined" &&
      document.documentElement.dataset.openroundMotion === "reduced")
  )
    return true;
  try {
    const preferences = JSON.parse(
      window.localStorage.getItem("openround:experience-preferences") ?? "null",
    );
    return preferences?.reducedMotion === true;
  } catch {
    return false;
  }
}

function subscribeReduced(listener: () => void) {
  const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  query?.addEventListener("change", listener);
  window.addEventListener("storage", listener);
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-openround-motion"],
  });
  return () => {
    query?.removeEventListener("change", listener);
    window.removeEventListener("storage", listener);
    observer.disconnect();
  };
}

function hiddenSnapshot() {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

function subscribeHidden(listener: () => void) {
  document.addEventListener("visibilitychange", listener);
  return () => document.removeEventListener("visibilitychange", listener);
}

const accents = {
  paper: ["#7587d4", "#6aa69b", "#bc8fbd"],
  midnight: ["#6f8edb", "#57b9b1", "#ae8fca"],
  ocean: ["#4f9fb2", "#65b5a5", "#8b98ca"],
  sunset: ["#d69072", "#ce91a4", "#b5a078"],
} as const;

/** Original bounded CSS artwork. It is decorative and cannot capture canvas interactions. */
export function PresentationMotionBackground({
  preset,
  theme,
  static: still = false,
  paused,
}: {
  preset?: MotionPreset;
  theme: PresentationSceneDesign["theme"];
  static?: boolean;
  /** Explicit picker preview state may differ from the saved local playback preference. */
  paused?: boolean;
}) {
  const enabled = Boolean(preset) && !still;
  const savedPaused = useSyncExternalStore(
    enabled ? subscribePaused : noopSubscribe,
    enabled ? getPresentationMotionPaused : serverFalse,
    serverFalse,
  );
  const reduced = useSyncExternalStore(
    enabled ? subscribeReduced : noopSubscribe,
    enabled ? getPresentationMotionReduced : serverFalse,
    serverFalse,
  );
  const hidden = useSyncExternalStore(
    enabled ? subscribeHidden : noopSubscribe,
    enabled ? hiddenSnapshot : serverFalse,
    serverFalse,
  );
  const root = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!enabled || !root.current) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver((entries) =>
      setVisible(entries.some((entry) => entry.isIntersecting)),
    );
    observer.observe(root.current);
    return () => observer.disconnect();
  }, [enabled]);
  if (!preset) return null;
  const palette = accents[theme];
  const playing = enabled && visible && !(paused ?? savedPaused) && !reduced && !hidden;
  return (
    <span
      ref={root}
      className={styles.background}
      data-motion-background={preset}
      data-motion-playing={playing ? "true" : "false"}
      data-motion-static={still || undefined}
      aria-hidden="true"
      style={
        {
          "--motion-a": palette[0],
          "--motion-b": palette[1],
          "--motion-c": palette[2],
        } as CSSProperties
      }
    >
      <span className={styles.layer} />
      <span className={styles.layer} />
      <span className={styles.layer} />
    </span>
  );
}

/** Kept outside slide artwork, including in presenter/audience views and print. */
export function PresentationMotionControls({
  preset,
  locale = "en-CA",
}: {
  preset?: MotionPreset;
  locale?: SupportedLocale;
}) {
  const paused = useSyncExternalStore(
    preset ? subscribePaused : noopSubscribe,
    preset ? getPresentationMotionPaused : serverFalse,
    serverFalse,
  );
  const reduced = useSyncExternalStore(
    preset ? subscribeReduced : noopSubscribe,
    preset ? getPresentationMotionReduced : serverFalse,
    serverFalse,
  );
  if (!preset) return null;
  const copy = motionBackgroundCopy(locale);
  return (
    <div
      className={styles.controls}
      lang={locale}
      data-motion-controls
      onKeyDown={(event) => {
        if (
          ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", " "].includes(
            event.key,
          )
        )
          event.stopPropagation();
      }}
    >
      {reduced ? (
        <p role="status">{copy("Reduced motion is enabled; backgrounds stay still.")}</p>
      ) : (
        <button type="button" onClick={() => setPresentationMotionPaused(!paused)}>
          <span aria-hidden="true">{paused ? "▶" : "Ⅱ"}</span>
          {copy(paused ? "Play background motion" : "Pause background motion")}
        </button>
      )}
    </div>
  );
}
