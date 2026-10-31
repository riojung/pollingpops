"use client";

import { CANVAS_TEMPLATES, getCanvasTemplate, type CanvasTemplateId } from "@openround/contracts";
import { canvasTemplateMessages } from "../../lib/i18n/canvas-template-messages";
import { useLocale } from "../locale-provider";
import styles from "./canvas-templates.module.css";
import { CanvasFlowTemplatePreview } from "./canvas-flow-template-preview";

export function CanvasTemplateChooser({
  value,
  onChange,
}: {
  value: CanvasTemplateId | null;
  onChange: (id: CanvasTemplateId | null) => void;
}) {
  const { locale } = useLocale();
  const copy = canvasTemplateMessages(locale);
  const selected = value ? getCanvasTemplate(value) : null;
  return (
    <section className={styles.chooser} aria-labelledby="canvas-starter-heading">
      <h3 id="canvas-starter-heading">{copy.choose}</h3>
      <p>{copy.english}</p>
      <div className={styles.options} role="group" aria-label={copy.choose}>
        <button type="button" aria-pressed={value === null} onClick={() => onChange(null)}>
          <strong>{copy.blank}</strong>
          <span>{copy.blankHelp}</span>
        </button>
        {CANVAS_TEMPLATES.map((template) => (
          <button
            key={template.id}
            type="button"
            aria-pressed={value === template.id}
            onClick={() => onChange(template.id)}
          >
            <small>{copy[template.category]}</small>
            <strong lang="en">{template.title}</strong>
            <span lang="en">{template.description}</span>
          </button>
        ))}
      </div>
      {selected ? <CanvasTemplatePreview id={selected.id} /> : null}
    </section>
  );
}

export function CanvasTemplatePreview({ id }: { id: CanvasTemplateId }) {
  const { locale } = useLocale();
  const copy = canvasTemplateMessages(locale);
  const template = getCanvasTemplate(id);
  const columns = template.sections.length === 4 ? 2 : 3;
  const rows = Math.ceil(template.sections.length / columns);
  return (
    <section className={styles.preview} aria-labelledby="canvas-starter-preview">
      <h3 id="canvas-starter-preview">{copy.preview}</h3>
      <p>{copy.previewHelp}</p>
      {id === "flow-to-action" ? (
        <CanvasFlowTemplatePreview />
      ) : (
        <svg viewBox={`0 0 ${columns * 180 + 10} ${rows * 180 + 10}`} aria-hidden="true">
          {template.sections.map((section, index) => {
            const x = 10 + (index % columns) * 180;
            const y = 10 + Math.floor(index / columns) * 180;
            return (
              <g key={section.title}>
                <rect
                  x={x}
                  y={y}
                  width="160"
                  height="160"
                  rx="5"
                  fill="var(--ui-surface)"
                  stroke="var(--ui-border-strong)"
                />
                <path
                  d={`M${x + 12} ${y + 18}h100 M${x + 12} ${y + 28}h76 M${x + 12} ${y + 51}h130 M${x + 12} ${y + 61}h105`}
                  stroke="var(--ui-text-subtle)"
                  strokeWidth="3"
                />
                <rect
                  x={x + 12}
                  y={y + 82}
                  width="63"
                  height="65"
                  rx="3"
                  fill={colors[section.color]}
                />
                <rect
                  x={x + 85}
                  y={y + 82}
                  width="63"
                  height="65"
                  rx="3"
                  fill={colors[section.color]}
                />
              </g>
            );
          })}
        </svg>
      )}
      <div lang="en" className={styles.previewContent}>
        <h4>{template.title}</h4>
        <p>{template.prompt}</p>
        <ol>
          {template.sections.map((section) => (
            <li key={section.title}>
              <strong>{section.title}</strong>
              <p>{section.guidance}</p>
              <ul>
                {section.prompts.map((prompt) => (
                  <li key={prompt}>{prompt}</li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
const colors = {
  yellow: "#fff1a8",
  blue: "#cde7ff",
  green: "#ccebdc",
  pink: "#f9d9e4",
  purple: "#e5dcf8",
};
