"use client";

import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import type {
  PresentationNavigationSnapshot,
  PresentationSpatialSnapshot,
} from "@openround/contracts";
import { fitPresentationSpatialFrames } from "../../lib/presentation-spatial-geometry";
import styles from "./presentation-spatial-delivery.module.css";
import { useLocale } from "../locale-provider";
import {
  sectionsSpatialCopy,
  localizeSectionsSpatialMessage,
} from "../../lib/i18n/sections-spatial-copy";
import { formatNumber } from "../../lib/i18n/format";

interface SpatialDeliveryProps {
  spatial?: PresentationSpatialSnapshot;
  currentBlockIndex: number;
  phase: string;
  sourceKey: string;
  compact?: boolean;
  navigation?: PresentationNavigationSnapshot;
  disabled?: boolean;
  onJump?: (blockId: string) => void;
}

/** Geometry never supplies content or navigation authority. The accepted snapshot owns the cursor. */
export function PresentationSpatialDelivery(props: SpatialDeliveryProps) {
  return props.spatial ? (
    <SpatialPath key={props.sourceKey} {...props} spatial={props.spatial} />
  ) : null;
}

function SpatialPath({
  spatial,
  currentBlockIndex,
  phase,
  navigation,
  disabled = false,
  compact = false,
  onJump,
}: SpatialDeliveryProps & { spatial: PresentationSpatialSnapshot }) {
  const { locale } = useLocale();
  const copy = sectionsSpatialCopy(locale);
  const [view, setView] = useState<"automatic" | "overview" | "focus">("automatic");
  const [linear, setLinear] = useState(false);
  const [size, setSize] = useState({ width: 800, height: 240 });
  const [selected, setSelected] = useState("");
  const diagram = useRef<HTMLDivElement>(null);
  const measureDiagram = useRef<(() => void) | null>(null);
  const selectId = useId();
  const reasonId = useId();
  const current = spatial.frames.find((frame) => frame.blockIndex === currentBlockIndex);
  const paintedFrames =
    current && phase !== "lobby"
      ? [...spatial.frames.filter((frame) => frame !== current), current]
      : spatial.frames;
  const overview = phase === "lobby" || phase === "finished" || !current || view === "overview";
  const camera = fitPresentationSpatialFrames(
    overview ? spatial.frames : [current!],
    size.width,
    size.height,
  );
  const selection = navigation?.entries.find((entry) => entry.blockId === selected);
  const staffNavigation = !!navigation && !!onJump;
  const status =
    phase === "finished"
      ? copy("Presentation complete · {count} pages", {
          count: formatNumber(locale, spatial.frames.length),
        })
      : current && phase !== "lobby"
        ? copy("Page {current} of {total}", {
            current: formatNumber(locale, currentBlockIndex + 1),
            total: formatNumber(locale, spatial.frames.length),
          })
        : copy("Overview · {count} pages", { count: formatNumber(locale, spatial.frames.length) });

  useEffect(() => {
    const element = diagram.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0)
        setSize((previous) =>
          previous.width === rect.width && previous.height === rect.height
            ? previous
            : { width: rect.width, height: rect.height },
        );
    };
    measureDiagram.current = measure;
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element);
    if (!observer) window.addEventListener("resize", measure);
    return () => {
      measureDiagram.current = null;
      observer?.disconnect();
      if (!observer) window.removeEventListener("resize", measure);
    };
  }, [compact]);
  useEffect(() => {
    if (compact && !linear) measureDiagram.current?.();
  }, [compact, linear]);

  const content = (
    <>
      <div className={styles.toolbar}>
        <p className={styles.status} role="status">
          {status}
        </p>
        <div className={styles.controls}>
          <button
            type="button"
            aria-pressed={!linear && overview}
            disabled={linear}
            onClick={() => setView("overview")}
          >
            {copy("Show overview")}
          </button>
          <button
            type="button"
            aria-pressed={!linear && !overview}
            disabled={linear || !current || phase === "lobby" || phase === "finished"}
            onClick={() => setView("focus")}
          >
            {copy("Focus current page")}
          </button>
          <button type="button" aria-pressed={linear} onClick={() => setLinear((value) => !value)}>
            {copy(linear ? "Use spatial view" : "Use linear view")}
          </button>
        </div>
      </div>
      <p className={styles.explanation}>
        {linear
          ? copy("Linear view. The current page remains below.")
          : copy("The path shows page positions only. Read the current page below.")}
      </p>
      <div
        ref={diagram}
        className={styles.diagram}
        hidden={linear}
        data-spatial-view={overview ? "overview" : "current"}
      >
        <svg width="100%" height="100%" aria-hidden="true" focusable="false">
          <g
            className={styles.camera}
            style={
              {
                transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
              } as CSSProperties
            }
          >
            <polyline
              className={styles.path}
              points={spatial.frames
                .map((frame) => `${frame.x + frame.width / 2},${frame.y + frame.height / 2}`)
                .join(" ")}
            />
            {paintedFrames.map((frame) => (
              <g
                key={frame.blockIndex}
                data-spatial-page={frame.blockIndex + 1}
                data-current={frame.blockIndex === currentBlockIndex && phase !== "lobby"}
              >
                <rect
                  className={styles.frame}
                  x={frame.x}
                  y={frame.y}
                  width={frame.width}
                  height={frame.height}
                  rx={Math.min(24, frame.width / 20)}
                />
                <text
                  className={styles.ordinal}
                  x={frame.x + frame.width / 2}
                  y={frame.y + frame.height / 2}
                  dominantBaseline="central"
                  textAnchor="middle"
                  fontSize={Math.min(140, frame.height / 2)}
                >
                  {formatNumber(locale, frame.blockIndex + 1)}
                </text>
              </g>
            ))}
          </g>
        </svg>
      </div>
      {staffNavigation ? (
        <div className={styles.staff}>
          <label htmlFor={selectId}>{copy("Jump to page")}</label>
          <select
            id={selectId}
            value={selected}
            disabled={disabled}
            aria-describedby={selection?.blockedReason ? reasonId : undefined}
            onChange={(event) => setSelected(event.target.value)}
          >
            <option value="">{copy("Choose a page")}</option>
            {navigation.entries.map((entry, index) => (
              <option key={entry.blockId} value={entry.blockId} lang="">
                {formatNumber(locale, index + 1)}. {entry.title}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={
              disabled || !selection || selection.status === "current" || !selection.canJump
            }
            onClick={() => {
              if (!disabled && selection?.canJump && selection.status !== "current")
                onJump(selection.blockId);
            }}
          >
            {copy("Jump to selected page")}
          </button>
          {selection?.blockedReason ? (
            <p
              id={reasonId}
              role="status"
              lang={localizeSectionsSpatialMessage(locale, selection.blockedReason).language}
            >
              {localizeSectionsSpatialMessage(locale, selection.blockedReason).text}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );

  return (
    <section
      className={`${styles.panel}${compact ? ` ${styles.compact}` : ""}`}
      aria-label={copy("Presentation spatial path")}
      data-spatial-compact={compact ? "true" : undefined}
      data-spatial-linear={compact ? String(linear) : undefined}
      lang={locale}
    >
      {compact ? (
        <details
          className={styles.disclosure}
          onToggle={(event) => {
            if (event.currentTarget.open) measureDiagram.current?.();
          }}
        >
          <summary aria-label={copy("Presentation spatial path")}>
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Zm6-3v15m6-12v15" />
            </svg>
            <span>{copy("Presentation spatial path")}</span>
            <svg
              className={styles.chevron}
              viewBox="0 0 24 24"
              aria-hidden="true"
              focusable="false"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </summary>
          <div className={styles.compactBody}>{content}</div>
        </details>
      ) : (
        content
      )}
    </section>
  );
}
