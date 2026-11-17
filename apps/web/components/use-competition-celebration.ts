"use client";

import { useEffect, useRef, useState } from "react";

/** Leave enough time for the podium sequence and the last streamer to settle. */
export const COMPETITION_CELEBRATION_MS = 4_400;

/** A finale belongs to a viewed result, rather than the arrival of a background snapshot. */
export function useCompetitionCelebration({
  eligible,
  enabled,
  releaseKey,
}: {
  eligible: boolean;
  enabled: boolean;
  releaseKey: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const played = useRef<string | null>(null);
  const replay = useRef<() => void>(() => {});
  const [playback, setPlayback] = useState({ key: "", run: 0, playing: false });

  useEffect(() => {
    const element = ref.current;
    if (!eligible || !enabled || !element) return;
    // Observe the whole stage so any visible podium/race section can start it,
    // including in a scrolling phone panel or a large expanded standings list.
    const anchor = element.querySelector('[data-testid="competition-stage"]') ?? element;
    let stageVisible = false;
    let dashboardVisible = false;
    let interrupted = false;
    let active = false;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function stop(resume: boolean) {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      if (!active) return;
      active = false;
      if (resume) {
        played.current = null;
        interrupted = true;
      }
      setPlayback((previous) => ({ ...previous, playing: false }));
    }

    function start(manual = false) {
      if (
        disposed ||
        (!manual && (!dashboardVisible || (!stageVisible && !interrupted))) ||
        document.hidden ||
        (!manual && played.current === releaseKey)
      )
        return;
      if (timer !== undefined) clearTimeout(timer);
      played.current = releaseKey;
      interrupted = false;
      active = true;
      setPlayback((previous) => ({ key: releaseKey, run: previous.run + 1, playing: true }));
      timer = setTimeout(() => stop(false), COMPETITION_CELEBRATION_MS);
    }

    function pageVisibility() {
      if (document.hidden) stop(true);
      else start();
    }

    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(
            (entries) => {
              for (const entry of entries) {
                if (entry.target === anchor) stageVisible = entry.isIntersecting;
                if (entry.target === element) dashboardVisible = entry.isIntersecting;
              }
              // Scrolling from the banner to a still-visible race must not stop it.
              if (!dashboardVisible) stop(true);
              else start();
            },
            // Apply the visibility inset to the viewport, not a fraction of an
            // unbounded target. Any intersection now crosses the zero threshold.
            { threshold: 0, rootMargin: "-20px 0px" },
          );

    function measure() {
      const inView = (node: Element | null) => {
        if (!node) return false;
        const bounds = node.getBoundingClientRect();
        return (
          bounds.width > 0 &&
          bounds.bottom >= 20 &&
          bounds.top <= window.innerHeight - 20 &&
          bounds.height > 0
        );
      };
      stageVisible = inView(anchor);
      dashboardVisible = inView(element);
      if (!dashboardVisible) stop(true);
      else start();
    }

    observer?.observe(anchor);
    if (anchor !== element) observer?.observe(element);
    if (!observer) {
      // Older embedded browsers still get an on-screen finale without a new dependency.
      window.addEventListener("scroll", measure, true);
      window.addEventListener("resize", measure);
      measure();
    }
    document.addEventListener("visibilitychange", pageVisibility);
    replay.current = () => start(true);
    return () => {
      disposed = true;
      stop(true);
      observer?.disconnect();
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
      document.removeEventListener("visibilitychange", pageVisibility);
      replay.current = () => {};
    };
  }, [eligible, enabled, releaseKey]);

  return {
    ref,
    run: playback.run,
    playing: eligible && enabled && playback.key === releaseKey && playback.playing,
    replay: () => replay.current(),
  };
}
