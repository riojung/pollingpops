import { getCanvasTemplate, type CanvasTemplateId } from "@openround/contracts";
import { CanvasFlowTemplatePreview } from "./canvas-flow-template-preview";

const colors = {
  yellow: "#fff1a8",
  blue: "#cde7ff",
  green: "#ccebdc",
  pink: "#f9d9e4",
  purple: "#e5dcf8",
};

/** Original decorative miniatures derived from the authored sections and their note colours. */
export function CanvasTemplateThumbnail({ id }: { id: CanvasTemplateId | null }) {
  if (id === null)
    return (
      <svg viewBox="0 0 360 200" aria-hidden="true" focusable="false">
        {Array.from({ length: 40 }, (_, index) => (
          <circle
            key={index}
            cx={22 + (index % 10) * 35}
            cy={25 + Math.floor(index / 10) * 50}
            r="1.5"
            fill="var(--ui-border)"
          />
        ))}
        <rect
          x="108"
          y="49"
          width="144"
          height="102"
          rx="12"
          fill="var(--ui-surface)"
          stroke="var(--ui-border-strong)"
          strokeDasharray="5 5"
          strokeWidth="1.5"
        />
        <rect x="160" y="80" width="40" height="40" rx="11" fill="var(--ui-accent-soft)" />
        <path
          d="M180 90v20m-10-10h20"
          stroke="var(--ui-accent-ink)"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
    );
  if (id === "flow-to-action") return <CanvasFlowTemplatePreview />;
  const template = getCanvasTemplate(id);
  const columns = template.sections.length === 4 ? 2 : 3;
  const rows = Math.ceil(template.sections.length / columns);
  return (
    <svg
      viewBox={`0 0 ${columns * 180 + 20} ${rows * 180 + 20}`}
      aria-hidden="true"
      focusable="false"
    >
      {template.sections.map((section, index) => {
        const x = 10 + (index % columns) * 180;
        const y = 10 + Math.floor(index / columns) * 180;
        return (
          <g key={section.title} data-section-color={section.color}>
            <rect
              x={x}
              y={y}
              width="160"
              height="160"
              rx="10"
              fill="var(--ui-surface)"
              stroke="var(--ui-border-strong)"
              strokeWidth="1.5"
            />
            <path
              d={`M${x + 13} ${y + 22}h${Math.min(122, section.title.length * 4)}M${x + 13} ${y + 39}h${Math.min(120, section.guidance.length * 2)}M${x + 13} ${y + 49}h${Math.min(88, section.guidance.length)}`}
              stroke="var(--ui-text-subtle)"
              strokeWidth="4"
              strokeLinecap="round"
            />
            {section.prompts.map((prompt, note) => (
              <g key={prompt}>
                <rect
                  x={x + 12 + note * 72}
                  y={y + 76}
                  width="64"
                  height="69"
                  rx="4"
                  fill={colors[section.color]}
                />
                <path
                  d={`M${x + 21 + note * 72} ${y + 92}h${Math.min(45, prompt.length * 2)}M${x + 21 + note * 72} ${y + 103}h${Math.min(35, prompt.length)}M${x + 21 + note * 72} ${y + 114}h${Math.min(40, Math.max(10, prompt.length - 12))}`}
                  stroke="#48566b"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
              </g>
            ))}
          </g>
        );
      })}
    </svg>
  );
}
