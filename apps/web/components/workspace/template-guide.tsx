import type { StarterGuide, SupportedLocale } from "@openround/contracts";
import { templateGuideCopy } from "../../lib/i18n/template-guide-copy";
import styles from "./template-guide.module.css";

export function TemplateGuide({
  guide,
  contentLocale,
  uiLocale,
}: {
  guide: StarterGuide;
  contentLocale: SupportedLocale;
  uiLocale: SupportedLocale;
}) {
  const copy = templateGuideCopy(uiLocale);
  return (
    <details className={styles.guide} open>
      <summary lang={uiLocale}>{copy("Template guide")}</summary>
      <dl>
        {(
          [
            ["For", guide.audience],
            ["Before you start", guide.preparation],
            ["Run the activity", guide.facilitation],
            ["Use the responses", guide.interpretation],
            ["Next step", guide.followUp],
          ] as const
        ).map(([label, value]) => (
          <div key={label}>
            <dt lang={uiLocale}>{copy(label)}</dt>
            <dd lang={contentLocale}>{value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
