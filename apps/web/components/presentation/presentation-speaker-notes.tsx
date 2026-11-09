"use client";

import { useEffect, useId, useRef, useState } from "react";
import { EditorIcon } from "./presentation-editor-chrome";
import styles from "./presentation-speaker-notes.module.css";

const NOTES_LIMIT = 2000;

interface SpeakerNotesEditorProps {
  value: string;
  onChange: (value: string) => void;
  onPreview: () => void;
  disabled?: boolean;
  previewDisabled?: boolean;
  previewDisabledReason?: string;
  /** Identifies the selected slide so an open editor closes when the selection changes. */
  sourceKey?: string;
}

/** Both writing surfaces edit the same controlled draft; closing never commits a second copy. */
export function SpeakerNotesEditor(props: SpeakerNotesEditorProps) {
  const {
    value,
    disabled = false,
    previewDisabled = false,
    previewDisabledReason,
    sourceKey,
  } = props;
  const scope = sourceKey ?? "";
  const id = useId();
  const [expandedFor, setExpandedFor] = useState<string | null>(null);
  const section = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const expandedInput = useRef<HTMLTextAreaElement>(null);
  const mounted = useRef(true);
  const active = useRef<string | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const expanded = expandedFor !== null && expandedFor === scope && !disabled;
  if (disabled || (active.current !== null && active.current !== scope)) active.current = null;

  function close() {
    active.current = null;
    setExpandedFor(null);
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      active.current = null;
    };
  }, []);
  useEffect(() => {
    if (expandedFor !== null && !expanded) setExpandedFor(null);
  }, [expandedFor, expanded]);
  useEffect(() => {
    if (!expanded) return;
    const target = dialog.current;
    if (target && !target.open) target.showModal();
    const fit = () => {
      if (!target?.isConnected) return;
      const viewport = window.visualViewport;
      const width = viewport?.width ?? window.innerWidth;
      const height = viewport?.height ?? window.innerHeight;
      const scale = target.getBoundingClientRect().width / target.offsetWidth || 1;
      const availableWidth = Math.max(1, (width - 24) / scale);
      const availableHeight = Math.max(1, (height - 24) / scale);
      target.style.position = "fixed";
      target.style.inset = "auto";
      target.style.margin = "0";
      target.style.width = `${Math.min(920, availableWidth)}px`;
      target.style.maxWidth = `${availableWidth}px`;
      target.style.maxHeight = `${availableHeight}px`;
      target.style.setProperty("--notes-dialog-height", `${Math.min(780, availableHeight - 2)}px`);
      const bounds = target.getBoundingClientRect();
      target.style.left = `${((viewport?.offsetLeft ?? 0) + Math.max(12, (width - bounds.width) / 2)) / scale}px`;
      target.style.top = `${((viewport?.offsetTop ?? 0) + Math.max(12, (height - bounds.height) / 2)) / scale}px`;
    };
    fit();
    if (typeof window !== "undefined") {
      window.addEventListener("resize", fit);
      window.visualViewport?.addEventListener("resize", fit);
      window.visualViewport?.addEventListener("scroll", fit);
    }
    const layout = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    if (typeof document !== "undefined") layout?.observe(document.documentElement);
    expandedInput.current?.focus({ preventScroll: true });
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("resize", fit);
        window.visualViewport?.removeEventListener("resize", fit);
        window.visualViewport?.removeEventListener("scroll", fit);
      }
      layout?.disconnect();
      if (target?.open) target.close();
      if (trigger.current?.isConnected && !trigger.current.disabled)
        trigger.current.focus({ preventScroll: true });
      else if (section.current?.isConnected) section.current.focus({ preventScroll: true });
    };
  }, [expanded]);

  function canEdit() {
    return mounted.current && !latest.current.disabled && latest.current.sourceKey === sourceKey;
  }
  function change(next: string, fromExpanded = false) {
    if (!canEdit() || (fromExpanded && active.current !== scope)) return;
    latest.current.onChange(next.slice(0, NOTES_LIMIT));
  }
  function expand() {
    if (!canEdit() || active.current !== null) return;
    active.current = scope;
    setExpandedFor(scope);
  }

  const count = `${value.length.toLocaleString("en-CA")} / 2,000 characters`;
  return (
    <section
      ref={section}
      className={styles.editor}
      aria-label="Speaker notes editor"
      tabIndex={-1}
      lang="en-CA"
    >
      <div className={styles.heading}>
        <label htmlFor={`${id}-notes`}>Speaker notes</label>
        <span className={styles.privateBadge}>
          <EditorIcon name="eye-off" /> Private
        </span>
      </div>
      <p className={styles.help} id={`${id}-privacy`}>
        For your eyes only. The audience never sees these notes.
      </p>
      <textarea
        id={`${id}-notes`}
        className={styles.textarea}
        value={value}
        onChange={(event) => change(event.target.value)}
        disabled={disabled}
        maxLength={NOTES_LIMIT}
        rows={14}
        lang={value.trim() ? "" : "en-CA"}
        aria-describedby={`${id}-privacy ${id}-limit`}
        placeholder="Write your talking points, transitions and reminders…"
      />
      <div className={styles.limit} id={`${id}-limit`}>
        <span>Up to 2,000 characters per slide.</span>
        <span className={styles.count}>{count}</span>
      </div>
      <div className={styles.actions}>
        <button ref={trigger} type="button" disabled={disabled} onClick={expand}>
          <EditorIcon name="notes" /> Expand notes editor
        </button>
        <button
          type="button"
          disabled={previewDisabled}
          aria-describedby={
            previewDisabled && previewDisabledReason ? `${id}-preview-help` : undefined
          }
          onClick={(event) => {
            event.currentTarget.focus({ preventScroll: true });
            if (!latest.current.previewDisabled) latest.current.onPreview();
          }}
        >
          <EditorIcon name="preview" /> Preview presenter view
        </button>
      </div>
      {previewDisabled && previewDisabledReason ? (
        <p className={styles.help} id={`${id}-preview-help`}>
          {previewDisabledReason}
        </p>
      ) : null}
      {expanded ? (
        <dialog
          ref={dialog}
          className={styles.dialog}
          aria-modal="true"
          aria-labelledby={`${id}-expanded-title`}
          aria-describedby={`${id}-expanded-privacy`}
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
          onClose={close}
          onKeyDown={(event) => {
            if (event.key === "Escape") event.stopPropagation();
          }}
        >
          <div className={styles.dialogLayout}>
            <header className={styles.dialogHeader}>
              <div>
                <span className={styles.privateBadge}>
                  <EditorIcon name="eye-off" /> Private notes
                </span>
                <h2 id={`${id}-expanded-title`}>Room to write</h2>
                <p className={styles.help} id={`${id}-expanded-privacy`}>
                  The audience never sees these notes. Edits update this slide’s draft.
                </p>
              </div>
              <button
                type="button"
                className={styles.close}
                aria-label="Close notes editor"
                onClick={close}
              >
                <EditorIcon name="close" />
              </button>
            </header>
            <div className={styles.writingArea}>
              <label className={styles.expandedLabel} htmlFor={`${id}-expanded-notes`}>
                Speaker notes
              </label>
              <textarea
                id={`${id}-expanded-notes`}
                ref={expandedInput}
                className={`${styles.textarea} ${styles.expandedTextarea}`}
                value={value}
                onChange={(event) => change(event.target.value, true)}
                disabled={disabled}
                maxLength={NOTES_LIMIT}
                lang={value.trim() ? "" : "en-CA"}
                aria-describedby={`${id}-expanded-count`}
                placeholder="Write your talking points, transitions and reminders…"
                autoFocus
              />
            </div>
            <footer className={styles.dialogFooter}>
              <span className={styles.count} id={`${id}-expanded-count`}>
                {count}
              </span>
              <button type="button" onClick={close}>
                Done writing
              </button>
            </footer>
          </div>
        </dialog>
      ) : null}
    </section>
  );
}

/** Render only after the author explicitly selects private presenter preview. */
export function PresenterNotesPanel({
  notes,
  slideNumber,
  totalSlides,
}: {
  notes: string;
  slideNumber?: number;
  totalSlides?: number;
}) {
  return (
    <section className={styles.presenterPanel} aria-label="Private presenter notes" lang="en-CA">
      <div className={styles.presenterHeading}>
        <span className={styles.privateBadge}>
          <EditorIcon name="eye-off" /> Private · Draft rehearsal
        </span>
        {slideNumber !== undefined ? (
          <span className={styles.slideNumber}>
            Slide {slideNumber}
            {totalSlides !== undefined ? ` of ${totalSlides}` : ""}
          </span>
        ) : null}
      </div>
      <h2>Speaker notes</h2>
      <p className={styles.help}>Only you can see these notes. The audience never sees them.</p>
      <div className={styles.notesBody} role="group" aria-label="Speaker notes text" tabIndex={0}>
        <p lang={notes.trim() ? "" : "en-CA"}>
          {notes.trim()
            ? notes
            : "No speaker notes for this slide yet. Add them in the Notes tab to rehearse your cues."}
        </p>
      </div>
      <p className={styles.rehearsalHelp}>
        This rehearsal shows your draft notes. Live presenter notes use the published version that
        started the session.
      </p>
    </section>
  );
}
