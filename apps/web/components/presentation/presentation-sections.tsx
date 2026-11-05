import type { PresentationSection } from "@openround/contracts";
import { presentationSectionForBlock } from "../../lib/presentation-builder";
import styles from "./presentation-builder.module.css";

interface PresentationSectionsProps {
  enabled: boolean;
  sections: PresentationSection[];
  selectedBlockId: string | null;
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
  onEnable,
  onAdd,
  onRename,
  onDelete,
  onAssign,
}: PresentationSectionsProps) {
  const selectedSection = presentationSectionForBlock(sections, selectedBlockId);
  return (
    <section className={styles.sections} aria-label="Sections and navigation" lang="en-CA">
      {enabled ? (
        <details open>
          <summary>Sections and navigation</summary>
          <p className={styles.sectionHelp}>
            Section names are published. Slides play in their numbered order below.
          </p>
          <div className={styles.sectionList}>
            {sections.map((section, index) => (
              <form
                className={styles.sectionEditor}
                key={section.id}
                onSubmit={(event) => {
                  event.preventDefault();
                  const title = new FormData(event.currentTarget).get("title");
                  if (typeof title === "string") onRename(section.id, title);
                }}
              >
                <label htmlFor={`section-title-${section.id}`}>Section {index + 1} name</label>
                <input
                  defaultValue={section.title}
                  id={`section-title-${section.id}`}
                  key={section.title}
                  lang={section.title.trim() ? "" : "en-CA"}
                  maxLength={120}
                  name="title"
                  placeholder="Section name"
                />
                <div className={styles.sectionActions}>
                  <small>
                    {section.blockIds.length} {section.blockIds.length === 1 ? "block" : "blocks"}
                  </small>
                  <button type="submit">Rename</button>
                  <button
                    aria-label={`Delete section ${section.title || index + 1}`}
                    onClick={() => onDelete(section.id)}
                    type="button"
                  >
                    Delete
                  </button>
                </div>
              </form>
            ))}
          </div>
          <button disabled={sections.length >= 50} onClick={onAdd} type="button">
            Add section
          </button>
          {sections.length >= 50 ? (
            <p className={styles.sectionHelp}>50 section limit reached.</p>
          ) : null}
          {selectedBlockId ? (
            <label className={styles.sectionAssignment}>
              <span>Selected block section</span>
              <select
                onChange={(event) => onAssign(selectedBlockId, event.target.value || null)}
                value={selectedSection?.id ?? ""}
              >
                <option value="">Unsectioned</option>
                {sections.map((section, index) => (
                  <option key={section.id} lang="" value={section.id}>
                    {section.title || `Unnamed section ${index + 1}`}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </details>
      ) : (
        <button onClick={onEnable} type="button">
          Enable sections and navigation
        </button>
      )}
    </section>
  );
}
