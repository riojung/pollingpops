"use client";

import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import type {
  PresentationNavigationSnapshot,
  PresentationSpatialSnapshot,
} from "@openround/contracts";
import { fitPresentationSpatialFrames } from "../../lib/presentation-spatial-geometry";
import styles from "./presentation-spatial-delivery.module.css";

interface SpatialDeliveryProps {
  spatial?: PresentationSpatialSnapshot;
  currentBlockIndex: number;
  phase: string;
  sourceKey: string;
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
  onJump,
}: SpatialDeliveryProps & { spatial: PresentationSpatialSnapshot }) {
  const [view, setView] = useState<"automatic" | "overview" | "focus">("automatic");
  const [linear, setLinear] = useState(false);
  const [size, setSize] = useState({ width: 800, height: 240 });
  const [selected, setSelected] = useState("");
  const diagram = useRef<HTMLDivElement>(null);
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
      ? `Presentation complete · ${spatial.frames.length} pages`
      : current && phase !== "lobby"
        ? `Page ${currentBlockIndex + 1} of ${spatial.frames.length}`
        : `Overview · ${spatial.frames.length} pages`;

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
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element);
    if (!observer) window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      if (!observer) window.removeEventListener("resize", measure);
    };
  }, []);

  return (
    <section className={styles.panel} aria-label="Presentation spatial path" lang="en-CA">
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
            Show overview
          </button>
          <button
            type="button"
            aria-pressed={!linear && !overview}
            disabled={linear || !current || phase === "lobby" || phase === "finished"}
            onClick={() => setView("focus")}
          >
            Focus current page
          </button>
          <button type="button" aria-pressed={linear} onClick={() => setLinear((value) => !value)}>
            {linear ? "Use spatial view" : "Use linear view"}
          </button>
        </div>
      </div>
      <p className={styles.explanation}>
        {linear
          ? "Linear view. The current page remains below."
          : "The path shows page positions only. Read the current page below."}
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
                  {frame.blockIndex + 1}
                </text>
              </g>
            ))}
          </g>
        </svg>
      </div>
      {staffNavigation ? (
        <div className={styles.staff}>
          <label htmlFor={selectId}>Jump to page</label>
          <select
            id={selectId}
            value={selected}
            disabled={disabled}
            aria-describedby={selection?.blockedReason ? reasonId : undefined}
            onChange={(event) => setSelected(event.target.value)}
          >
            <option value="">Choose a page</option>
            {navigation.entries.map((entry, index) => (
              <option key={entry.blockId} value={entry.blockId}>
                {index + 1}. {entry.title}
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
            Jump to selected page
          </button>
          {selection?.blockedReason ? (
            <p id={reasonId} role="status">
              {selection.blockedReason}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
