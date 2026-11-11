import type { SupportedLocale } from "@openround/contracts";
import { packPracticeDetailCopy } from "../../lib/i18n/pack-practice-detail-copy";
import type { PackPracticeMode, PublishedPracticePack } from "../../lib/recovery-pack-practice";
import styles from "./practice.module.css";

export function PackPracticePreview({
  version,
  mode,
  locale = "en-CA",
}: {
  version: PublishedPracticePack;
  mode: PackPracticeMode;
  locale?: SupportedLocale;
}) {
  const copy = packPracticeDetailCopy(locale);
  return mode === "full_sequence" ? (
    <section
      aria-label={copy("Frozen full-sequence preview")}
      className={styles.packPracticePreview}
      lang={locale}
    >
      <h3>{copy("Diagnostic")}</h3>
      <p lang="">{version.content.diagnostic.prompt}</p>
      <h3>{copy("Intervention cards in order")}</h3>
      <ol>
        {version.content.interventions.map((card) => (
          <li key={card.id}>
            <h4 lang="">{card.title}</h4>
            <p lang="" className={styles.packPracticeBody}>
              {card.body}
            </p>
            {card.citations.length ? (
              <ul aria-label={copy("Card citations")}>
                {card.citations.map((citation, index) => (
                  <li key={index} lang="">
                    {citation.sourceName}, {citation.locator}
                    {citation.excerpt ? ` — ${citation.excerpt}` : ""}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ol>
      <h3>{copy("Linked recheck")}</h3>
      <p lang="">{version.content.recheck.prompt}</p>
      <p>
        {copy(
          "The participant sees only the active checkpoint or card. Cards have no countdown. This sequence does not include the optional delayed probe or form a delayed recovery trail.",
        )}
      </p>
    </section>
  ) : (
    <div className={styles.packPracticePreview} lang={locale}>
      {version.content.delayedProbe ? <p lang="">{version.content.delayedProbe.prompt}</p> : null}
      <p>
        {copy(
          "Only this published delayed probe is copied. Draft edits and future Pack changes do not update the assignment.",
        )}
      </p>
    </div>
  );
}
