"use client";

import { useEffect, useRef, useState } from "react";
import { CANVAS_TEMPLATES, getCanvasTemplate, type CanvasTemplateId } from "@openround/contracts";
import { canvasTemplateMessages } from "../../lib/i18n/canvas-template-messages";
import { canvasTemplateBrowserMessages } from "../../lib/i18n/canvas-template-browser-messages";
import { useLocale } from "../locale-provider";
import { CanvasTemplateChooser } from "./canvas-template-chooser";
import { CanvasTemplateThumbnail } from "./canvas-template-thumbnail";
import styles from "./canvas-template-library.module.css";

function Arrow() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path d="M5 12h14m-6-6 6 6-6 6" />
    </svg>
  );
}

export function CanvasTemplateStrip({
  disabled,
  inactive,
  onChoose,
  onExplore,
}: {
  disabled: boolean;
  inactive: boolean;
  onChoose: (id: CanvasTemplateId | null, opener: HTMLElement) => void;
  onExplore: (opener: HTMLElement) => void;
}) {
  const { locale } = useLocale();
  const copy = canvasTemplateMessages(locale);
  const browserCopy = canvasTemplateBrowserMessages(locale);
  return (
    <section
      className={styles.strip}
      data-testid="canvas-template-strip"
      aria-labelledby="canvas-quick-start-heading"
      aria-hidden={inactive || undefined}
      inert={inactive}
    >
      <header className={styles.stripHeader}>
        <div>
          <h2 id="canvas-quick-start-heading">{browserCopy.quickStart}</h2>
          <p>{browserCopy.quickStartHelp}</p>
        </div>
        <button
          type="button"
          onClick={(event) => onExplore(event.currentTarget)}
          disabled={disabled}
          className={styles.explore}
        >
          {browserCopy.explore}
          <Arrow />
        </button>
      </header>
      <ul className={styles.starters}>
        {[null, ...CANVAS_TEMPLATES.map((template) => template.id)].map((id) => {
          const template = id ? getCanvasTemplate(id) : null;
          return (
            <li key={id ?? "blank"}>
              <button
                type="button"
                disabled={disabled}
                onClick={(event) => onChoose(id, event.currentTarget)}
              >
                <span className={styles.miniature} aria-hidden="true">
                  <CanvasTemplateThumbnail id={id} />
                </span>
                <span lang={template ? "en" : undefined}>{template?.title ?? copy.blank}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function CanvasTemplateBrowserDialog({
  onClose,
  onUse,
  returnFocus,
}: {
  onClose: () => void;
  onUse: (id: CanvasTemplateId | null) => void;
  returnFocus: HTMLElement | null;
}) {
  const { locale } = useLocale();
  const copy = canvasTemplateMessages(locale);
  const browserCopy = canvasTemplateBrowserMessages(locale);
  const [selected, setSelected] = useState<CanvasTemplateId | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = returnFocus ?? document.activeElement;
    const node = dialog.current;
    node?.showModal();
    node?.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
    return () => {
      node?.close();
      if (previous instanceof HTMLElement && previous.isConnected && !previous.closest("[inert]"))
        previous.focus();
    };
  }, [returnFocus]);
  return (
    <dialog
      ref={dialog}
      className={styles.browser}
      data-testid="canvas-template-browser"
      aria-labelledby="canvas-template-library-heading"
      aria-describedby="canvas-template-library-description"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className={styles.browserHeader}>
        <div>
          <h2 id="canvas-template-library-heading">{browserCopy.heading}</h2>
          <p id="canvas-template-library-description">{browserCopy.quickStartHelp}</p>
        </div>
        <button
          type="button"
          className={styles.close}
          aria-label={browserCopy.close}
          onClick={onClose}
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
            <path d="m7 7 10 10M17 7 7 17" />
          </svg>
        </button>
      </header>
      <div className={styles.browserBody} data-testid="template-browser-body">
        <CanvasTemplateChooser browse value={selected} onChange={setSelected} />
      </div>
      <footer className={styles.browserFooter}>
        <p lang={selected ? "en" : undefined}>
          {selected ? getCanvasTemplate(selected).title : copy.blank}
        </p>
        <button className={`button ${styles.use}`} type="button" onClick={() => onUse(selected)}>
          {browserCopy.useTemplate}
          <Arrow />
        </button>
      </footer>
    </dialog>
  );
}
