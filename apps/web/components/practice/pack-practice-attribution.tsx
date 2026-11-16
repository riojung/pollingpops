import Link from "next/link";
import type { RecoveryPackPracticeSource, SupportedLocale } from "@openround/contracts";
import { packPracticeDetailCopy } from "../../lib/i18n/pack-practice-detail-copy";
import styles from "./practice.module.css";

/** Render only frozen source identity; never fetch a Pack or expose its checkpoint contents. */
export function PackPracticeAttribution({
  source,
  locale = "en-CA",
}: {
  source?: RecoveryPackPracticeSource | null;
  locale?: SupportedLocale;
}) {
  const copy = packPracticeDetailCopy(locale);
  return source ? (
    <p className={styles.packPracticeAttribution} lang={locale}>
      {source.role === "full_sequence"
        ? copy("Recovery Pack full sequence")
        : copy("Recovery Pack delayed probe")}
      : <span lang="">{source.packTitle}</span> · {copy("published version")}{" "}
      <span lang="">{source.packVersion}</span>.{" "}
      <Link href="/recovery-packs">{copy("Open Recovery Pack library")}</Link>
    </p>
  ) : null;
}
