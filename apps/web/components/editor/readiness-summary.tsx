import type { RoundReadinessIssue } from "../../lib/round-readiness";
import styles from "./round-builder.module.css";
import { useLocale } from "../locale-provider";
import { roundWorkspaceCopy } from "../../lib/i18n/round-workspace-copy";

export function ReadinessSummary({
  issues,
  action,
  entityLabel = "Round",
  onSelectIssue,
}: {
  issues: RoundReadinessIssue[];
  action: "preview" | "publish" | null;
  entityLabel?: string;
  onSelectIssue: (issue: RoundReadinessIssue) => void;
}) {
  const { locale, t } = useLocale();
  const copy = roundWorkspaceCopy(locale);
  const ready = issues.length === 0;
  const localizedAction =
    action === "preview"
      ? t("delivery.common.preview")
      : action === "publish"
        ? t("delivery.common.publish")
        : "";
  const actionInSentence = localizedAction.toLocaleLowerCase(locale);
  return (
    <section
      aria-label={t("delivery.builder.roundReadiness")}
      className={`${styles.readiness} validation-guidance`}
      data-ready={ready}
      role={action && !ready ? "alert" : undefined}
    >
      <div className={styles.readinessHeading}>
        <strong>
          {ready
            ? t("delivery.builder.readyToPreview")
            : action
              ? t("delivery.builder.cannotAction", {
                  action: actionInSentence,
                  entity: entityLabel,
                })
              : t("delivery.builder.roundReadiness")}
        </strong>
        <span>
          {ready
            ? t("delivery.builder.allRequiredComplete")
            : t(
                issues.length === 1
                  ? "delivery.builder.itemsNeedAttention.one"
                  : "delivery.builder.itemsNeedAttention.other",
                { count: issues.length },
              )}
        </span>
      </div>
      {!ready ? (
        <>
          <span className="sr-only" lang="en-CA">
            Source: {issues[0]?.source}. How to fix: {issues[0]?.resolution}
          </span>
          <details className={styles.readinessDetails} open={Boolean(action)}>
            <summary>{copy("Review required fixes")}</summary>
            <div className={styles.issueList}>
              {issues.map((issue) => (
                <button
                  className={styles.issueButton}
                  key={issue.id}
                  lang="en-CA"
                  onClick={() => onSelectIssue(issue)}
                  title={issue.resolution}
                  type="button"
                >
                  {issue.source}: {issue.resolution}
                </button>
              ))}
            </div>
            <small>{copy("Draft edits are saved automatically.")}</small>
          </details>
        </>
      ) : null}
    </section>
  );
}
