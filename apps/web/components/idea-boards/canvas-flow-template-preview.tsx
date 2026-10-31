import {
  canvasConnectorGeometry,
  canvasDiagramShapePath,
  instantiateCanvasTemplate,
} from "@openround/contracts";
/** Decorative preview of the same original template factory, without random or external assets. */
export function CanvasFlowTemplatePreview() {
  let counter = 0;
  const objects = instantiateCanvasTemplate(
    "flow-to-action",
    () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`,
  );
  const fills = {
    yellow: "#fff1a8",
    blue: "#cde7ff",
    green: "#ccebdc",
    pink: "#f9d9e4",
    purple: "#e5dcf8",
    white: "var(--ui-surface)",
  };
  return (
    <svg viewBox="0 0 1440 850" aria-hidden="true">
      {objects.map((object) => {
        if (object.type === "connector")
          return (
            <path
              key={object.id}
              d={canvasConnectorGeometry(object, objects).path}
              stroke="var(--ui-text-subtle)"
              strokeWidth={4}
              fill="none"
            />
          );
        if (object.type === "text") return null;
        return (
          <g key={object.id} transform={`translate(${object.x} ${object.y})`}>
            {object.type === "diamond" || object.type === "parallelogram" ? (
              <path
                d={canvasDiagramShapePath(object.type, object.width, object.height)}
                fill={fills[object.color]}
                stroke="var(--ui-border-strong)"
                strokeWidth={3}
              />
            ) : (
              <rect
                width={object.width}
                height={object.height}
                rx={8}
                fill={object.type === "frame" ? "none" : fills[object.color]}
                stroke="var(--ui-border-strong)"
                strokeWidth={3}
              />
            )}
            {object.type !== "frame" ? (
              <text
                x={object.width / 2}
                y={object.height / 2}
                textAnchor="middle"
                fontSize={16}
                fill="#252a33"
              >
                {object.text}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
