import { useEffect, useRef, useState } from "react";
import { useLocale } from "../locale-provider";
import { presentationNavigatorCopy } from "./presentation-navigator-copy";
import {
  clampPresentationNavigatorWidth,
  PRESENTATION_NAVIGATOR_DEFAULT_WIDTH,
  PRESENTATION_NAVIGATOR_MIN_WIDTH,
  PRESENTATION_NAVIGATOR_MAX_WIDTH,
  presentationNavigatorMaxWidth,
  readPresentationNavigatorWidth,
  savePresentationNavigatorWidth,
} from "../../lib/presentation-navigator-width";
import styles from "./presentation-builder.module.css";

/** This preference belongs to the local workspace view, never the presentation draft. */
export function PresentationNavigatorResize({ enabled }: { enabled: boolean }) {
  const { locale } = useLocale();
  const copy = presentationNavigatorCopy(locale);
  const handle = useRef<HTMLDivElement>(null);
  const preferred = useRef(PRESENTATION_NAVIGATOR_DEFAULT_WIDTH);
  const [width, setWidth] = useState(PRESENTATION_NAVIGATOR_DEFAULT_WIDTH);
  const [maximum, setMaximum] = useState(PRESENTATION_NAVIGATOR_MAX_WIDTH);
  const drag = useRef<{ pointerId: number; x: number; width: number; scale: number } | null>(null);
  useEffect(() => {
    try {
      preferred.current = readPresentationNavigatorWidth(window.localStorage);
    } catch {
      // Accessing the storage object itself can be blocked by browser policy.
    }
    const workspace = handle.current?.parentElement;
    if (!workspace) return;
    const inspector = workspace.querySelector<HTMLElement>("#presentation-object-inspector");
    const measure = () => {
      const limit = presentationNavigatorMaxWidth(
        workspace.clientWidth,
        inspector?.offsetWidth ?? 0,
      );
      const actual = clampPresentationNavigatorWidth(preferred.current, limit);
      setMaximum(limit);
      setWidth(actual);
      workspace.style.setProperty("--presentation-navigator-width", `${actual}px`);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(workspace);
    if (inspector) observer?.observe(inspector);
    if (!observer) window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      if (!observer) window.removeEventListener("resize", measure);
      workspace.style.removeProperty("--presentation-navigator-width");
    };
  }, []);
  useEffect(() => {
    if (enabled || !drag.current) return;
    const pointerId = drag.current.pointerId;
    drag.current = null;
    if (handle.current?.hasPointerCapture(pointerId))
      handle.current.releasePointerCapture(pointerId);
  }, [enabled]);
  const resize = (next: number) => {
    const actual = clampPresentationNavigatorWidth(next, maximum);
    preferred.current = actual;
    setWidth(actual);
    handle.current?.parentElement?.style.setProperty(
      "--presentation-navigator-width",
      `${actual}px`,
    );
    try {
      savePresentationNavigatorWidth(window.localStorage, actual);
    } catch {
      // Local resizing remains available without persistent browser storage.
    }
  };
  return (
    <div
      ref={handle}
      className={styles.navigatorResize}
      role="separator"
      aria-label={copy("Resize slide navigator")}
      aria-description={copy(
        "Drag or use Left and Right arrows. Home sets minimum, End sets maximum, Enter resets.",
      )}
      aria-orientation="vertical"
      aria-controls="presentation-slide-navigator"
      aria-valuemin={PRESENTATION_NAVIGATOR_MIN_WIDTH}
      aria-valuemax={maximum}
      aria-valuenow={width}
      aria-disabled={!enabled}
      tabIndex={enabled ? 0 : -1}
      data-navigator-resize="true"
      onDoubleClick={() => enabled && resize(PRESENTATION_NAVIGATOR_DEFAULT_WIDTH)}
      onKeyDown={(event) => {
        if (!enabled) return;
        const step = event.shiftKey ? 40 : 16;
        const next =
          event.key === "ArrowLeft"
            ? width - step
            : event.key === "ArrowRight"
              ? width + step
              : event.key === "Home"
                ? PRESENTATION_NAVIGATOR_MIN_WIDTH
                : event.key === "End"
                  ? maximum
                  : event.key === "Enter"
                    ? PRESENTATION_NAVIGATOR_DEFAULT_WIDTH
                    : null;
        if (next === null) return;
        event.preventDefault();
        event.stopPropagation();
        resize(next);
      }}
      onPointerDown={(event) => {
        if (!enabled || event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        const workspace = event.currentTarget.parentElement;
        const scale = workspace
          ? workspace.getBoundingClientRect().width / workspace.offsetWidth || 1
          : 1;
        drag.current = { pointerId: event.pointerId, x: event.clientX, width, scale };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const current = drag.current;
        if (!enabled || !current || current.pointerId !== event.pointerId) return;
        resize(current.width + (event.clientX - current.x) / current.scale);
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointerId !== event.pointerId) return;
        drag.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
    />
  );
}
