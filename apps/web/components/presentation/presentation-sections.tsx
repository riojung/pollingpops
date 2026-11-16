import { useEffect, useId, useRef, useState } from "react";
import type { PresentationSection } from "@openround/contracts";
import { presentationSectionForBlock } from "../../lib/presentation-builder";
import { useLocale } from "../locale-provider";
import { sectionsSpatialCopy } from "../../lib/i18n/sections-spatial-copy";
import { formatNumber, pluralCategory } from "../../lib/i18n/format";
import { presentationNavigatorCopy } from "./presentation-navigator-copy";
import {
  EditorDisclosure,
  EditorIcon,
  handoffEditorDisclosure,
} from "./presentation-editor-chrome";
import styles from "./presentation-sections.module.css";

interface PresentationSectionsProps {
  enabled: boolean;
  sections: PresentationSection[];
  selectedBlockId: string | null;
  disabled?: boolean;
  onEnable: () => void;
  onAdd: (title?: string) => void;
  onRename: (sectionId: string, title: string) => void;
  onDelete: (sectionId: string) => void;
  onAssign: (blockId: string, sectionId: string | null) => void;
}

/** Creation and membership stay compact; section actions live beside their slides. */
export function PresentationSections({
  enabled,
  sections,
  selectedBlockId,
  disabled = false,
  onEnable,
  onAdd,
  onAssign,
}: PresentationSectionsProps) {
  const { locale } = useLocale();
  const copy = sectionsSpatialCopy(locale);
  const navigator = presentationNavigatorCopy(locale);
  const [creating, setCreating] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const selectedSection = presentationSectionForBlock(sections, selectedBlockId);
  useEffect(() => {
    if (!creating || disabled) return;
    nameInput.current?.focus({ preventScroll: true });
    nameInput.current?.select();
  }, [creating, disabled]);
  const close = () => {
    setCreating(false);
    addButton.current?.focus({ preventScroll: true });
  };
  return (
    <section className={styles.toolbar} aria-label={copy("Sections and navigation")} lang={locale}>
      {enabled ? (
        <>
          <button
            ref={addButton}
            className={styles.addSection}
            disabled={disabled || sections.length >= 50}
            aria-expanded={creating}
            aria-controls={`${inputId}-form`}
            onClick={() => {
              if (!disabled && sections.length < 50) setCreating((value) => !value);
            }}
            type="button"
          >
            <EditorIcon name="plus" /> {copy("Add section")}
          </button>
          {creating && !disabled ? (
            <form
              className={styles.nameForm}
              id={`${inputId}-form`}
              onSubmit={(event) => {
                event.preventDefault();
                if (disabled || sections.length >= 50) return;
                onAdd(nameInput.current?.value ?? copy("New section"));
                close();
              }}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                event.preventDefault();
                event.stopPropagation();
                close();
              }}
            >
              <label htmlFor={inputId}>{copy("Section name")}</label>
              <input
                ref={nameInput}
                defaultValue={copy("New section")}
                id={inputId}
                maxLength={120}
                name="title"
                autoComplete="off"
              />
              <p className={styles.help}>
                {navigator(
                  "Starts at the selected slide and includes slides until the next section.",
                )}
              </p>
              <div className={styles.formActions}>
                <button type="submit">{navigator("Create section")}</button>
                <button onClick={close} type="button">
                  {navigator("Cancel")}
                </button>
              </div>
            </form>
          ) : null}
          {sections.length >= 50 ? (
            <p className={styles.help}>{copy("50 section limit reached.")}</p>
          ) : null}
          {selectedBlockId ? (
            <label className={styles.assignment}>
              <span>{navigator("Selected slide section")}</span>
              <select
                disabled={disabled}
                value={selectedSection?.id ?? ""}
                onChange={(event) => {
                  if (!disabled) onAssign(selectedBlockId, event.target.value || null);
                }}
              >
                <option value="">{copy("Unsectioned")}</option>
                {sections.map((section, index) => (
                  <option key={section.id} lang={section.title ? "" : locale} value={section.id}>
                    {section.title ||
                      copy("Unnamed section {number}", { number: formatNumber(locale, index + 1) })}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </>
      ) : (
        <button
          disabled={disabled}
          onClick={() => {
            if (!disabled) onEnable();
          }}
          type="button"
        >
          {copy("Enable sections and navigation")}
        </button>
      )}
      {disabled ? (
        <p className={styles.help}>
          {copy("Section editing is available to workspace owners and editors.")}
        </p>
      ) : null}
    </section>
  );
}

export function PresentationSectionHeader({
  section,
  runKey,
  count,
  continued,
  collapsed,
  disabled,
  canMove,
  fragmented,
  onToggle,
  onRename,
  onDelete,
  onMove,
}: {
  section: PresentationSection | null;
  runKey: string;
  count: number;
  continued: boolean;
  collapsed: boolean;
  disabled: boolean;
  canMove: (direction: -1 | 1) => boolean;
  fragmented: boolean;
  onToggle: () => void;
  onRename: (sectionId: string, title: string) => void;
  onDelete: (sectionId: string) => void;
  onMove: (sectionId: string, direction: -1 | 1) => void;
}) {
  const { locale } = useLocale();
  const copy = sectionsSpatialCopy(locale);
  const navigator = presentationNavigatorCopy(locale);
  const [renaming, setRenaming] = useState(false);
  const [moveOptions, setMoveOptions] = useState({ up: false, down: false });
  const input = useRef<HTMLInputElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const inputId = useId();
  const title = section ? section.title || copy("Unnamed section") : copy("Unsectioned");
  const displayTitle = continued ? navigator("{title} (continued)", { title }) : title;
  const moveHelp = fragmented
    ? navigator(
        "This section has separated slides. Move individual slides together before moving the section.",
      )
    : navigator("Linked checks and navigation targets must keep their order.");
  useEffect(() => {
    if (!renaming || disabled) return;
    input.current?.focus({ preventScroll: true });
    input.current?.select();
  }, [renaming, disabled]);
  const finishRename = () => {
    setRenaming(false);
    toggle.current?.focus({ preventScroll: true });
  };
  return (
    <div
      className={styles.header}
      data-section-header={section?.id ?? "unsectioned"}
      onClickCapture={(event) => {
        if (disabled || !(event.target instanceof Element) || !event.target.closest("summary"))
          return;
        // Validate reordering when its menu opens rather than parsing the whole deck
        // for every offscreen section on every text keystroke.
        setMoveOptions({ up: canMove(-1), down: canMove(1) });
      }}
    >
      <div className={styles.headerRow}>
        <button
          ref={toggle}
          className={styles.toggle}
          type="button"
          aria-expanded={!collapsed}
          aria-controls={`section-slides-${runKey}`}
          aria-label={navigator(collapsed ? "Expand section {title}" : "Collapse section {title}", {
            title: displayTitle,
          })}
          onClick={onToggle}
        >
          <span className={collapsed ? styles.collapsedChevron : styles.chevron}>
            <EditorIcon name="chevron-down" />
          </span>
          <span className={styles.headerText}>
            <strong lang={section?.title ? "" : locale}>{displayTitle}</strong>
            <small lang={locale}>
              {navigator(
                pluralCategory(locale, count) === "one" ? "{count} slide" : "{count} slides",
                { count: formatNumber(locale, count) },
              )}
            </small>
          </span>
        </button>
        {section && !disabled ? (
          <EditorDisclosure
            label={navigator("Section actions: {title}", { title })}
            compact
            icon="more"
            className={styles.actions}
          >
            <button
              type="button"
              onClick={(event) => {
                if (disabled) return;
                handoffEditorDisclosure(event.currentTarget);
                setRenaming(true);
              }}
            >
              <EditorIcon name="rewrite" /> {copy("Rename")}
            </button>
            <button
              disabled={!moveOptions.up}
              title={moveHelp}
              type="button"
              onClick={(event) => {
                if (disabled || !canMove(-1)) return;
                handoffEditorDisclosure(event.currentTarget);
                onMove(section.id, -1);
              }}
            >
              <EditorIcon name="arrow-up" /> {navigator("Move section up")}
            </button>
            <button
              disabled={!moveOptions.down}
              title={moveHelp}
              type="button"
              onClick={(event) => {
                if (disabled || !canMove(1)) return;
                handoffEditorDisclosure(event.currentTarget);
                onMove(section.id, 1);
              }}
            >
              <EditorIcon name="arrow-down" /> {navigator("Move section down")}
            </button>
            {fragmented ? <p className={styles.help}>{moveHelp}</p> : null}
            <button
              title={navigator("Remove section only; keep all slides.")}
              type="button"
              onClick={(event) => {
                if (disabled) return;
                handoffEditorDisclosure(event.currentTarget);
                onDelete(section.id);
              }}
            >
              <EditorIcon name="trash" /> {navigator("Remove section")}
            </button>
          </EditorDisclosure>
        ) : null}
      </div>
      {renaming && section && !disabled ? (
        <form
          className={styles.nameForm}
          onSubmit={(event) => {
            event.preventDefault();
            if (disabled) return;
            onRename(section.id, input.current?.value ?? section.title);
            finishRename();
          }}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            finishRename();
          }}
        >
          <label htmlFor={inputId}>{copy("Section name")}</label>
          <input
            ref={input}
            defaultValue={section.title}
            id={inputId}
            maxLength={120}
            autoComplete="off"
            lang={section.title ? "" : locale}
          />
          <div className={styles.formActions}>
            <button type="submit">{navigator("Save")}</button>
            <button onClick={finishRename} type="button">
              {navigator("Cancel")}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
