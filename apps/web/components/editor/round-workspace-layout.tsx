"use client";

import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import {
  ROUND_PANES,
  ROUND_PANE_STORAGE_KEY,
  readRoundPaneWidths,
  roundPaneWidth,
  type RoundPane,
} from "../../lib/round-workspace-layout";
import { roundWorkspaceCopy } from "../../lib/i18n/round-workspace-copy";
import { useLocale } from "../locale-provider";
import styles from "./round-builder.module.css";

export function useRoundWorkspaceLayout(enabled: boolean) {
  const builderRef = useRef<HTMLFieldSetElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [widths, setWidths] = useState(() => readRoundPaneWidths(null));
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      setWidths(readRoundPaneWidths(localStorage.getItem(ROUND_PANE_STORAGE_KEY)));
    } catch {
      /* Private browsing may block storage. */
    }
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(ROUND_PANE_STORAGE_KEY, JSON.stringify(widths));
      } catch {
        /* Resizing still works for this page. */
      }
    }, 150);
    return () => window.clearTimeout(timer);
  }, [ready, widths]);
  useEffect(() => {
    if (!enabled) return;
    const root = builderRef.current;
    const header = root?.querySelector("header");
    if (!root || !header) return;
    const measure = () =>
      root.style.setProperty(
        "--round-command-height",
        `${Math.ceil(header.getBoundingClientRect().height)}px`,
      );
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(header);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [enabled]);
  return {
    builderRef,
    workspaceRef,
    widths,
    style: {
      "--round-nav-width": `${widths.navigation}px`,
      "--round-tools-width": `${widths.tools}px`,
    } as CSSProperties,
    setWidth: (pane: RoundPane, width: number) =>
      setWidths((previous) => ({ ...previous, [pane]: roundPaneWidth(pane, width) })),
  };
}

export function RoundPaneResize({
  pane,
  width,
  otherWidth,
  workspaceRef,
  onChange,
  hidden = false,
}: {
  pane: RoundPane;
  width: number;
  otherWidth: number;
  workspaceRef: RefObject<HTMLDivElement | null>;
  onChange: (width: number) => void;
  hidden?: boolean;
}) {
  const { locale } = useLocale();
  const copy = roundWorkspaceCopy(locale);
  const drag = useRef<{ pointerId: number; x: number; width: number; restore: number } | null>(
    null,
  );
  const limits = ROUND_PANES[pane];
  const [renderedWidth, setRenderedWidth] = useState(width);
  const ownId = pane === "navigation" ? "round-question-navigator" : "round-question-tools";
  const otherId = pane === "navigation" ? "round-question-tools" : "round-question-navigator";
  const measuredWidth = () =>
    workspaceRef.current?.querySelector<HTMLElement>(`#${ownId}`)?.getBoundingClientRect().width ||
    width;
  useEffect(() => {
    const element = workspaceRef.current?.querySelector<HTMLElement>(`#${ownId}`);
    if (!element) return;
    const measure = () => {
      const actual = element.getBoundingClientRect().width;
      if (actual > 0) setRenderedWidth(Math.round(actual));
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [workspaceRef, ownId]);
  const clamp = (next: number) =>
    roundPaneWidth(
      pane,
      next,
      workspaceRef.current?.getBoundingClientRect().width,
      workspaceRef.current?.querySelector<HTMLElement>(`#${otherId}`)?.getBoundingClientRect()
        .width ?? otherWidth,
    );
  return (
    <div
      aria-label={copy(
        pane === "navigation" ? "Resize question navigation" : "Resize question tools",
      )}
      aria-orientation="vertical"
      aria-valuemin={limits.min}
      aria-valuemax={limits.max}
      aria-valuenow={renderedWidth}
      className={styles.paneResize}
      data-pane={pane}
      hidden={hidden}
      role="separator"
      tabIndex={hidden ? -1 : 0}
      title={copy("Drag to resize. Use Left and Right Arrow; hold Shift for larger steps.")}
      onDoubleClick={() => onChange(clamp(limits.initial))}
      onKeyDown={(event) => {
        if (event.key === "Escape" && drag.current) {
          onChange(drag.current.restore);
          event.currentTarget.releasePointerCapture(drag.current.pointerId);
          drag.current = null;
          event.preventDefault();
          return;
        }
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const step = (event.shiftKey ? 48 : 16) * (pane === "navigation" ? 1 : -1);
        onChange(
          clamp(
            event.key === "Home"
              ? limits.min
              : event.key === "End"
                ? limits.max
                : measuredWidth() + (event.key === "ArrowRight" ? step : -step),
          ),
        );
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        drag.current = {
          pointerId: event.pointerId,
          x: event.clientX,
          width: measuredWidth(),
          restore: width,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (drag.current?.pointerId !== event.pointerId) return;
        const delta = (event.clientX - drag.current.x) * (pane === "navigation" ? 1 : -1);
        onChange(clamp(drag.current.width + delta));
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointerId !== event.pointerId) return;
        drag.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        if (drag.current) onChange(drag.current.restore);
        drag.current = null;
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
    >
      <span aria-hidden="true" />
    </div>
  );
}
