"use client";

import { CANVAS_TEMPLATES, getCanvasTemplate, type CanvasTemplateId } from "@openround/contracts";
import { useId, useState } from "react";
import { canvasTemplateMessages } from "../../lib/i18n/canvas-template-messages";
import { canvasTemplateBrowserMessages } from "../../lib/i18n/canvas-template-browser-messages";
import { useLocale } from "../locale-provider";
import styles from "./canvas-templates.module.css";
import { CanvasTemplateThumbnail } from "./canvas-template-thumbnail";

function SelectionMark() {
  return (
    <span className={styles.selectionMark} aria-hidden="true">
      <svg viewBox="0 0 20 20" focusable="false">
        <path
          d="m5 10 3 3 7-7"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export function CanvasTemplateChooser({
  value,
  onChange,
  browse = false,
}: {
  value: CanvasTemplateId | null;
  onChange: (id: CanvasTemplateId | null) => void;
  browse?: boolean;
}) {
  const { locale } = useLocale();
  const copy = canvasTemplateMessages(locale);
  const selected = value ? getCanvasTemplate(value) : null;
  if (browse) return <CanvasTemplateBrowser value={value} onChange={onChange} />;
  return (
    <section className={styles.chooser} aria-labelledby="canvas-starter-heading">
      <header className={styles.chooserHeader}>
        <h3 id="canvas-starter-heading">{copy.choose}</h3>
        <p>{copy.english}</p>
      </header>
      {renderTemplateChoices({ value, onChange, copy })}
      {selected ? <CanvasTemplatePreview id={selected.id} /> : null}
    </section>
  );
}

const categories = ["brainstorm", "retro", "project", "decision", "learning"] as const;
type Category = "all" | (typeof categories)[number];

function CanvasTemplateBrowser({
  value,
  onChange,
}: {
  value: CanvasTemplateId | null;
  onChange: (id: CanvasTemplateId | null) => void;
}) {
  const { locale } = useLocale();
  const copy = canvasTemplateMessages(locale);
  const english = canvasTemplateMessages("en-CA");
  const browserCopy = canvasTemplateBrowserMessages(locale);
  const instance = useId();
  const prefix = `canvas-template-browser-${instance}`;
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<Category>("all");
  const normalize = (text: string) =>
    text.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase(locale).trim();
  const query = normalize(search);
  const matches = (text: string) => !query || normalize(text).includes(query);
  const templates = CANVAS_TEMPLATES.filter(
    (template) =>
      (category === "all" || template.category === category) &&
      matches(
        [
          template.title,
          template.description,
          template.category,
          copy[template.category],
          english[template.category],
        ].join(" "),
      ),
  );
  const showBlank =
    category === "all" &&
    matches([copy.blank, copy.blankHelp, english.blank, english.blankHelp].join(" "));
  const count = templates.length + Number(showBlank);
  const filtered = Boolean(search || category !== "all");
  const reset = () => {
    setSearch("");
    setCategory("all");
  };
  const options = ["all", ...categories] as const;
  const categoryLabel = (key: Category) => (key === "all" ? browserCopy.all : copy[key]);
  return (
    <section className={styles.chooser} aria-label={browserCopy.heading}>
      <div className={styles.browserLayout}>
        <aside className={styles.browserSidebar}>
          <h3>{browserCopy.categories}</h3>
          <nav aria-label={browserCopy.categories}>
            {options.map((key) => (
              <button
                key={key}
                type="button"
                className={styles.categoryButton}
                aria-pressed={category === key}
                onClick={() => setCategory(key)}
              >
                <span>{categoryLabel(key)}</span>
                <small aria-hidden="true">
                  {key === "all"
                    ? CANVAS_TEMPLATES.length + 1
                    : CANVAS_TEMPLATES.filter((template) => template.category === key).length}
                </small>
              </button>
            ))}
          </nav>
        </aside>
        <div className={styles.browserMain}>
          <div className={styles.browserToolbar}>
            <label className={styles.searchField}>
              <span>{browserCopy.search}</span>
              <input
                type="search"
                maxLength={160}
                value={search}
                placeholder={browserCopy.searchPlaceholder}
                aria-describedby={`${prefix}-language`}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <label className={styles.mobileCategories}>
              <span>{browserCopy.categories}</span>
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value as Category)}
              >
                {options.map((key) => (
                  <option key={key} value={key}>
                    {categoryLabel(key)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className={styles.browserResults}>
            <p role="status" aria-atomic="true">
              {browserCopy.results.replace("{count}", String(count))}
            </p>
            {filtered && count > 0 ? (
              <button type="button" onClick={reset}>
                {browserCopy.reset}
              </button>
            ) : null}
          </div>
          <p id={`${prefix}-language`} className={styles.browserLanguage}>
            {copy.english}
          </p>
          {count ? (
            renderTemplateChoices({ value, onChange, copy, templates, showBlank, prefix })
          ) : (
            <div className={styles.browserEmpty}>
              <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
                <circle cx="13" cy="13" r="8" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <path
                  d="m19 19 8 8"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
              <h3>{browserCopy.noMatches}</h3>
              <button type="button" className="button-quiet" onClick={reset}>
                {browserCopy.reset}
              </button>
            </div>
          )}
          {value ? <CanvasTemplatePreview id={value} idPrefix={prefix} /> : null}
        </div>
      </div>
    </section>
  );
}

function renderTemplateChoices({
  value,
  onChange,
  copy,
  templates = CANVAS_TEMPLATES,
  showBlank = true,
  prefix = "canvas-starter",
}: {
  value: CanvasTemplateId | null;
  onChange: (id: CanvasTemplateId | null) => void;
  copy: ReturnType<typeof canvasTemplateMessages>;
  templates?: typeof CANVAS_TEMPLATES;
  showBlank?: boolean;
  prefix?: string;
}) {
  return (
    <div className={styles.options} role="group" aria-label={copy.choose}>
      {showBlank ? (
        <button
          className={styles.option}
          type="button"
          aria-pressed={value === null}
          aria-labelledby={`${prefix}-blank-title`}
          aria-describedby={`${prefix}-blank-description`}
          onClick={() => onChange(null)}
        >
          <span className={styles.thumbnail} data-starter-thumbnail="blank" aria-hidden="true">
            <CanvasTemplateThumbnail id={null} />
          </span>
          <span className={styles.optionBody}>
            <strong id={`${prefix}-blank-title`} className={styles.optionTitle}>
              {copy.blank}
            </strong>
            <span id={`${prefix}-blank-description`} className={styles.optionDescription}>
              {copy.blankHelp}
            </span>
          </span>
          {value === null ? <SelectionMark /> : null}
        </button>
      ) : null}
      {templates.map((template) => (
        <button
          key={template.id}
          className={styles.option}
          type="button"
          aria-pressed={value === template.id}
          aria-labelledby={`${prefix}-${template.id}-title`}
          aria-describedby={`${prefix}-${template.id}-category ${prefix}-${template.id}-description`}
          onClick={() => onChange(template.id)}
        >
          <span
            className={styles.thumbnail}
            data-starter-thumbnail={template.id}
            aria-hidden="true"
          >
            <CanvasTemplateThumbnail id={template.id} />
          </span>
          <span className={styles.optionBody}>
            <small id={`${prefix}-${template.id}-category`} className={styles.optionCategory}>
              {copy[template.category]}
            </small>
            <strong id={`${prefix}-${template.id}-title`} className={styles.optionTitle} lang="en">
              {template.title}
            </strong>
            <span
              id={`${prefix}-${template.id}-description`}
              className={styles.optionDescription}
              lang="en"
            >
              {template.description}
            </span>
          </span>
          {value === template.id ? <SelectionMark /> : null}
        </button>
      ))}
    </div>
  );
}

export function CanvasTemplatePreview({
  id,
  idPrefix = "canvas-starter",
}: {
  id: CanvasTemplateId;
  idPrefix?: string;
}) {
  const { locale } = useLocale();
  const copy = canvasTemplateMessages(locale);
  const template = getCanvasTemplate(id);
  return (
    <section className={styles.preview} aria-labelledby={`${idPrefix}-preview`}>
      <details key={id} className={styles.previewDisclosure}>
        <summary
          aria-labelledby={`${idPrefix}-preview`}
          aria-describedby={`${idPrefix}-preview-selection`}
        >
          <span className={styles.previewSummary}>
            <strong id={`${idPrefix}-preview`}>{copy.preview}</strong>
            <span id={`${idPrefix}-preview-selection`} lang="en">
              {template.title}
            </span>
          </span>
          <svg
            className={styles.disclosureIcon}
            viewBox="0 0 20 20"
            aria-hidden="true"
            focusable="false"
          >
            <path
              d="m6 8 4 4 4-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </summary>
        <div className={styles.previewBody}>
          <p className={styles.previewHelp}>{copy.previewHelp}</p>
          <CanvasTemplateThumbnail id={id} />
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
        </div>
      </details>
    </section>
  );
}
