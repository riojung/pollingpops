import type { PresentationSection } from "@openround/contracts";
import { presentationSectionForBlock } from "../../lib/presentation-builder";
import styles from "./presentation-builder.module.css";
import { useLocale } from "../locale-provider";
import { sectionsSpatialCopy } from "../../lib/i18n/sections-spatial-copy";
import { formatNumber, pluralCategory } from "../../lib/i18n/format";

interface PresentationSectionsProps {
  enabled: boolean;
  sections: PresentationSection[];
  selectedBlockId: string | null;
  disabled?: boolean;
  onEnable: () => void;
  onAdd: () => void;
  onRename: (sectionId: string, title: string) => void;
  onDelete: (sectionId: string) => void;
  onAssign: (blockId: string, sectionId: string | null) => void;
}

export function PresentationSections({
  enabled,
  sections,
  selectedBlockId,
  disabled = false,
  onEnable,
  onAdd,
  onRename,
  onDelete,
  onAssign,
}: PresentationSectionsProps) {
  const { locale } = useLocale();
  const copy = sectionsSpatialCopy(locale);
  const selectedSection = presentationSectionForBlock(sections, selectedBlockId);
  return (
    <section className={styles.sections} aria-label={copy("Sections and navigation")} lang={locale}>
      {disabled ? (
        <p className={styles.sectionHelp}>
          {copy("Section editing is available to workspace owners and editors.")}
        </p>
      ) : null}
      {enabled ? (
        <details open>
          <summary>{copy("Sections and navigation")}</summary>
          <p className={styles.sectionHelp}>
            {copy("Section names are published. Slides play in their numbered order below.")}
          </p>
          <div className={styles.sectionList}>
            {sections.map((section, index) => (
              <form
                className={styles.sectionEditor}
                key={section.id}
                onSubmit={(event) => {
                  event.preventDefault();
                  if (disabled) return;
                  const title = new FormData(event.currentTarget).get("title");
                  if (typeof title === "string") onRename(section.id, title);
                }}
              >
                <label htmlFor={`section-title-${section.id}`}>
                  {copy("Section {number} name", { number: formatNumber(locale, index + 1) })}
                </label>
                <input
                  defaultValue={section.title}
                  disabled={disabled}
                  id={`section-title-${section.id}`}
                  key={section.title}
                  lang={section.title.trim() ? "" : locale}
                  maxLength={120}
                  name="title"
                  placeholder={copy("Section name")}
                />
                <div className={styles.sectionActions}>
                  <small>
                    {copy(
                      pluralCategory(locale, section.blockIds.length) === "one"
                        ? "{count} block"
                        : "{count} blocks",
                      { count: formatNumber(locale, section.blockIds.length) },
                    )}
                  </small>
                  <button disabled={disabled} type="submit">
                    {copy("Rename")}
                  </button>
                  <button
                    aria-label={copy("Delete section {title}", {
                      title: section.title || formatNumber(locale, index + 1),
                    })}
                    disabled={disabled}
                    onClick={() => {
                      if (!disabled) onDelete(section.id);
                    }}
                    type="button"
                  >
                    {copy("Delete")}
                  </button>
                </div>
              </form>
            ))}
          </div>
          <button
            disabled={disabled || sections.length >= 50}
            onClick={() => {
              if (!disabled && sections.length < 50) onAdd();
            }}
            type="button"
          >
            {copy("Add section")}
          </button>
          {sections.length >= 50 ? (
            <p className={styles.sectionHelp}>{copy("50 section limit reached.")}</p>
          ) : null}
          {selectedBlockId ? (
            <label className={styles.sectionAssignment}>
              <span>{copy("Selected block section")}</span>
              <select
                disabled={disabled}
                onChange={(event) => {
                  if (!disabled) onAssign(selectedBlockId, event.target.value || null);
                }}
                value={selectedSection?.id ?? ""}
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
        </details>
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
    </section>
  );
}
