"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale } from "../../components/locale-provider";
import { apiFetch, humanError } from "../../lib/api";
import { formatDateTime, pluralCategory } from "../../lib/i18n/format";
import { WorkspaceProvider, useWorkspace } from "../../components/workspace/workspace-provider";
import { WorkspaceShell } from "../../components/workspace/workspace-shell";
import type { CursorPage, FollowupSummary } from "../../components/workspace/workspace-types";
import styles from "../../components/workspace/workspace-content.module.css";
import compact from "./assignments.module.css";
import { WorkspaceStatus, workspaceStateTone } from "../../components/workspace/workspace-signals";
import signals from "../../components/workspace/workspace-signals.module.css";
import { PackPracticeAttribution } from "../../components/practice/pack-practice-attribution";

function AssignmentsWorkspace() {
  const { locale, t } = useLocale();
  const { canEdit, productFeatures } = useWorkspace();
  const [assignments, setAssignments] = useState<FollowupSummary[]>([]);
  const [hasMorePractice, setHasMorePractice] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (productFeatures?.practiceAssignments !== true) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void apiFetch<CursorPage<FollowupSummary>>("/v1/followups?purpose=assignment&limit=50", {
      signal: controller.signal,
    })
      .then((page) => {
        if (controller.signal.aborted) return;
        setAssignments(page.items.filter((item) => item.purpose === "assignment"));
        setHasMorePractice(Boolean(page.nextCursor));
      })
      .catch((caught) => {
        if (!controller.signal.aborted) setError(humanError(caught));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [productFeatures?.practiceAssignments]);

  return (
    <WorkspaceShell
      actions={
        <Link className="button-quiet" href="/results?view=practice">
          {t("pages.assignments.viewAllPractice")}
        </Link>
      }
      description={t("page.assignments.description")}
      eyebrow={t("page.assignments.eyebrow")}
      title={t("page.assignments.title")}
      translationLevel="full"
    >
      {productFeatures?.practiceAssignments !== true ? (
        <div className={styles.emptyState}>
          <h2>{t("pages.assignments.disabledTitle")}</h2>
          <p>{t("pages.assignments.disabledDescription")}</p>
          <Link className="button-quiet" href="/results?view=practice">
            {t("pages.assignments.openHistory")}
          </Link>
        </div>
      ) : null}

      {error ? (
        <p className="error" lang="en-CA" role="alert">
          {error}
        </p>
      ) : null}
      {loading ? (
        <p className={styles.muted} role="status">
          {t("pages.assignments.loading")}
        </p>
      ) : null}

      {productFeatures?.practiceAssignments === true &&
      !loading &&
      !error &&
      !assignments.length ? (
        <div className={styles.emptyState}>
          <h2>{t("pages.assignments.emptyTitle")}</h2>
          <p>
            {t("pages.assignments.emptyBeforeAction")}{" "}
            <strong>{t("pages.assignments.assignPractice")}</strong>{" "}
            {t("pages.assignments.emptyAfterAction")}
          </p>
          {canEdit ? (
            <Link className="button" href="/library">
              {t("pages.assignments.chooseRound")}
            </Link>
          ) : (
            <Link className="button-quiet" href="/library">
              {t("pages.assignments.browseLibrary")}
            </Link>
          )}
        </div>
      ) : null}

      <section className={styles.list} aria-label={t("pages.assignments.listLabel")}>
        {assignments.map((assignment) => (
          <article
            className={`${styles.listCard} ${compact.card} ${signals.surface}`}
            data-kind="practice"
            data-state-tone={workspaceStateTone(assignment.status)}
            key={assignment.id}
          >
            <div className={`${styles.rowTopline} ${compact.heading}`}>
              <div>
                <h2 lang="">{assignment.title}</h2>
                <PackPracticeAttribution source={assignment.recoveryPackSource} locale={locale} />
                <p className={styles.summaryLine}>
                  {t("pages.assignments.created", {
                    date: formatDateTime(locale, assignment.createdAt),
                  })}{" "}
                  ·{" "}
                  {t(
                    pluralCategory(locale, assignment.checkpointCount) === "one"
                      ? "pages.assignments.questionCount.one"
                      : "pages.assignments.questionCount.other",
                    { count: assignment.checkpointCount },
                  )}
                </p>
                <p className={styles.summaryLine}>
                  {t("pages.assignments.openRange", {
                    from: formatDateTime(locale, assignment.opensAt),
                    to: formatDateTime(locale, assignment.closesAt),
                  })}
                </p>
              </div>
              <WorkspaceStatus status={assignment.status}>
                {t(`pages.common.status.${assignment.status}`)}
              </WorkspaceStatus>
            </div>
            <div className={`${styles.metricGrid} ${compact.metrics}`}>
              <div className={styles.metric}>
                <strong>{assignment.attemptCount}</strong>
                <span>{t("pages.common.attempts")}</span>
              </div>
              <div className={styles.metric}>
                <strong>{assignment.completedAttemptCount}</strong>
                <span>{t("pages.common.completed")}</span>
              </div>
              <div className={styles.metric}>
                <strong>{formatDateTime(locale, assignment.expiresAt)}</strong>
                <span>{t("pages.assignments.retainedUntil")}</span>
              </div>
            </div>
            <div className={`${styles.listCardActions} ${compact.actions}`}>
              <Link
                className={`button small-button ${signals.action}`}
                data-action="view"
                href={`/practice/${assignment.id}`}
              >
                {t("pages.assignments.manage")}
              </Link>
            </div>
          </article>
        ))}
      </section>

      {hasMorePractice ? (
        <p className={styles.muted}>
          {t("pages.assignments.moreHistoryBeforeLink")}{" "}
          <Link href="/results?view=practice">{t("pages.common.results")}</Link>.
        </p>
      ) : null}
    </WorkspaceShell>
  );
}

export default function AssignmentsPage() {
  return (
    <WorkspaceProvider>
      <AssignmentsWorkspace />
    </WorkspaceProvider>
  );
}
