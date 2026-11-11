import Link from "next/link";
import type { SupportedLocale } from "@openround/contracts";
import { packPracticeCopy, packPracticeFeedback } from "../../lib/i18n/pack-practice-copy";
import styles from "./pack-practice-action.module.css";
import {
  packPracticeAssignmentHref,
  packPracticeUnavailableReason,
  type PublishedPracticePack,
  type PackPracticeMode,
} from "../../lib/recovery-pack-practice";

export function PackPracticeAction({
  packId,
  version,
  loading = false,
  loadError = "",
  recoveryPacksEnabled,
  practiceAssignmentsEnabled,
  canEdit,
  followups,
  mode = "delayed_probe",
  locale = "en-CA",
}: {
  packId: string;
  version: PublishedPracticePack | null;
  loading?: boolean;
  loadError?: string;
  recoveryPacksEnabled: boolean;
  practiceAssignmentsEnabled: boolean;
  canEdit: boolean;
  followups: boolean;
  mode?: PackPracticeMode;
  locale?: SupportedLocale;
}) {
  const copy = packPracticeCopy(locale);
  const reason = loading
    ? mode === "full_sequence"
      ? "Checking the frozen published sequence…"
      : "Checking the frozen published delayed probe…"
    : loadError ||
      packPracticeUnavailableReason({
        version,
        recoveryPacksEnabled,
        practiceAssignmentsEnabled,
        canEdit,
        followups,
        mode,
      });
  const feedback = reason ? packPracticeFeedback(locale, reason) : null;
  return (
    <section
      className={styles.entry}
      lang={locale}
      aria-label={copy(
        mode === "full_sequence" ? "Full-sequence Pack practice" : "Pack delayed-probe practice",
      )}
    >
      <h3>
        {copy(
          mode === "full_sequence"
            ? "Full-sequence Recovery Pack practice"
            : "Standalone delayed-probe practice",
        )}
      </h3>
      <p>
        {copy(
          mode === "full_sequence"
            ? "Assign the diagnostic, all frozen intervention cards, and linked recheck from this exact published version. The optional delayed probe is not included; this is not a delayed recovery trail."
            : "Assign only the delayed probe from this exact published version. This is not full Pack recovery or a delayed recovery trail. Diagnostic and recheck checkpoints are not substituted.",
        )}
      </p>
      {reason ? (
        <>
          <p className="muted" lang={feedback!.lang} role={loading ? "status" : undefined}>
            {feedback!.text}
          </p>
          <button className={`button-quiet ${styles.action}`} disabled type="button">
            {copy(
              mode === "full_sequence"
                ? "Assign full-sequence practice"
                : "Assign delayed-probe practice",
            )}
          </button>
        </>
      ) : version ? (
        <Link
          className={`button-quiet ${styles.action}`}
          href={packPracticeAssignmentHref(packId, version.id, mode)}
        >
          {copy(
            mode === "full_sequence"
              ? "Assign full-sequence practice"
              : "Assign delayed-probe practice",
          )}
        </Link>
      ) : null}
    </section>
  );
}
