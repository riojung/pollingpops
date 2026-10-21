import { useId, type SVGProps } from "react";
import type { IdeaBoardSketch, IdeaBoardSketchElement } from "@openround/contracts";
import { sketchElementBounds } from "./sketch-model";
import styles from "./boards.module.css";

export const sketchColors = {
  ink: "#172331",
  blue: "#1D4ED8",
  green: "#047857",
  orange: "#B45309",
  red: "#B91C1C",
  purple: "#7E22CE",
} as const;

function SketchElement({
  element,
  markerId,
}: {
  element: IdeaBoardSketchElement;
  markerId: string;
}) {
  const shared = {
    stroke: sketchColors[element.color],
    strokeWidth: element.strokeWidth,
    fill: "none",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (element.type === "rect")
    return (
      <rect
        {...shared}
        x={element.x}
        y={element.y}
        width={element.width}
        height={element.height}
        rx={6}
      />
    );
  if (element.type === "ellipse")
    return (
      <ellipse
        {...shared}
        cx={element.x + element.width / 2}
        cy={element.y + element.height / 2}
        rx={element.width / 2}
        ry={element.height / 2}
      />
    );
  if (element.type === "text")
    return (
      <text
        x={element.x}
        y={element.y}
        fill={sketchColors[element.color]}
        fontSize={element.fontSize}
        fontFamily="system-ui, sans-serif"
        style={{ whiteSpace: "pre" }}
      >
        {element.text}
      </text>
    );
  if (element.type === "freehand")
    return (
      <polyline {...shared} points={element.points.map((point) => point.join(",")).join(" ")} />
    );
  return (
    <line
      {...shared}
      x1={element.x1}
      y1={element.y1}
      x2={element.x2}
      y2={element.y2}
      markerEnd={element.type === "arrow" ? `url(#${markerId}-${element.color})` : undefined}
    />
  );
}

/** Only contract-validated geometry becomes SVG; authored markup is never interpreted. */
export function SketchPreview({
  sketch,
  label,
  selectedId,
  ...props
}: {
  sketch: IdeaBoardSketch;
  label: string;
  selectedId?: string | null;
} & SVGProps<SVGSVGElement>) {
  const markerId = `sketch-${useId().replace(/:/g, "")}`;
  const selected = sketch.elements.find((element) => element.id === selectedId);
  const bounds = selected ? sketchElementBounds(selected) : null;
  return (
    <svg
      className={styles.sketchSvg}
      viewBox="0 0 1000 600"
      role="img"
      aria-label={label}
      {...props}
    >
      <defs>
        {Object.entries(sketchColors).map(([color, fill]) => (
          <marker
            key={color}
            id={`${markerId}-${color}`}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={fill} />
          </marker>
        ))}
      </defs>
      {sketch.elements.map((element) => (
        <g key={element.id} data-sketch-element={element.id}>
          <SketchElement element={element} markerId={markerId} />
        </g>
      ))}
      {bounds ? (
        <rect
          x={bounds.x - 6}
          y={bounds.y - 6}
          width={Math.max(12, bounds.width + 12)}
          height={Math.max(12, bounds.height + 12)}
          fill="none"
          stroke="#2563EB"
          strokeWidth="2"
          strokeDasharray="6 5"
          pointerEvents="none"
        />
      ) : null}
    </svg>
  );
}
