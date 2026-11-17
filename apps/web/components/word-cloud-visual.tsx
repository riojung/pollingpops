"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { layoutWordCloud, type WordCloudTerm } from "../lib/word-cloud-layout";
import styles from "./word-cloud-visual.module.css";

type Typography = { family: string; measureText: (text: string, fontSize: number) => number };

export function WordCloudVisual({
  terms,
  compact = false,
}: {
  terms: WordCloudTerm[];
  compact?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [typography, setTypography] = useState<Typography | null>(null);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    let disposed = false;
    const measure = () => {
      const nextWidth = Math.floor(element.getBoundingClientRect().width);
      if (nextWidth > 0) setWidth((previous) => (previous === nextWidth ? previous : nextWidth));
    };
    const measureFont = () => {
      if (disposed) return;
      const family = getComputedStyle(element).fontFamily;
      const context = document.createElement("canvas").getContext("2d");
      if (!context) return;
      setTypography({
        family,
        measureText: (text, size) => {
          context.font = `700 ${size}px ${family}`;
          return context.measureText(text).width;
        },
      });
    };
    measure();
    measureFont();
    void document.fonts?.ready.then(measureFont);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      disposed = true;
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const layout = useMemo(
    () => layoutWordCloud(terms, { width, compact, measureText: typography?.measureText }),
    [terms, width, compact, typography],
  );

  return (
    <div
      ref={root}
      aria-hidden="true"
      className={`word-cloud ${styles.cloud}`}
      data-testid="word-cloud-visual"
      data-visible-terms={layout.words.length}
      data-omitted-terms={layout.omittedCount}
    >
      <svg
        className={styles.stage}
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        focusable="false"
        style={typography ? { fontFamily: typography.family } : undefined}
      >
        {layout.words.map((word) => (
          <g
            key={word.value}
            className={styles.word}
            data-term={word.value}
            data-count={word.count}
            style={{
              transform: `translate(${word.x}px, ${word.y}px)`,
              fontSize: word.fontSize,
            }}
          >
            <g className={styles.arrival}>
              {word.lines.map((line, index) => (
                <text
                  key={index}
                  x={word.width / 2}
                  y={word.fontSize * (1.08 + index * 1.35) + 2}
                  textAnchor="middle"
                  lang=""
                  direction="auto"
                  unicodeBidi="plaintext"
                >
                  {line}
                </text>
              ))}
            </g>
          </g>
        ))}
      </svg>
    </div>
  );
}
