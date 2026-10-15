"use client";

import type {
  PresentationReport,
  PresentationReportWithSessionContextEnvelope,
  PresentationTimeMode,
} from "@openround/contracts";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CreatorBrand } from "../../../../components/brand";
import { useLocale } from "../../../../components/locale-provider";
import { SessionOnlyQuickCheckLabel } from "../../../../components/presentation-live/session-only-quick-check-label";
import {
  useWorkspace,
  WorkspaceProvider,
} from "../../../../components/workspace/workspace-provider";
import styles from "../../../../components/presentation-live/presentation-live.module.css";
import { apiFetch, humanError } from "../../../../lib/api";
import { SessionSummaryButton } from "../../../../components/session-summary/summary-dialog";

function PresentationReportContent() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { locale, t } = useLocale();
  const { productFeatures } = useWorkspace();
  const [report, setReport] = useState<PresentationReport | null>(null);
  const [timeMode, setTimeMode] = useState<PresentationTimeMode | null>(null);
  const [reportFailed, setReportFailed] = useState(false);
  const [error, setError] = useState("");
  const [summaryReady, setSummaryReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let retryAttempts = 0;
    setReport(null);
    setTimeMode(null);
    setReportFailed(false);
    setError("");
    setSummaryReady(false);
    const load = async () => {
      try {
        const result = await apiFetch<PresentationReportWithSessionContextEnvelope>(
          `/v1/presentation-sessions/${id}/report?includeSessionContext=true&includeQuickChecks=true`,
        );
        if (cancelled) return;
        setError("");
        setSummaryReady(result.reportStatus === "ready");
        retryAttempts = 0;
        // An older API binary ignores the opt-in query during a rolling web/API upgrade.
        setTimeMode(result.sessionContext?.timeMode ?? "timed");
        if (result.report) {
          setReport(result.report);
        }
        if (result.reportStatus === "ready") {
          return;
        }
        if (result.reportStatus === "failed") {
          setReport(null);
          setReportFailed(true);
          return;
        }
        pollTimer = setTimeout(() => void load(), 1_000);
      } catch (caught) {
        if (cancelled) return;
        if ((caught as { status?: number }).status === 401) {
          router.replace("/signin");
          return;
        }
        setError(humanError(caught));
        if (retryAttempts < 5) {
          const retryDelayMs = Math.min(10_000, 1_000 * 2 ** retryAttempts);
          retryAttempts += 1;
          pollTimer = setTimeout(() => void load(), retryDelayMs);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [id, router]);

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <CreatorBrand productFeatures={productFeatures} />
        <div className="button-row">
          {summaryReady && report ? (
            <SessionSummaryButton source={{ kind: "presentation", id }} />
          ) : null}
          <Link href="/results">{t("live.presentationReport.allResults")}</Link>
          <Link href={`/presentation-session/${id}/host`}>
            {t("live.presentationReport.hostView")}
          </Link>
        </div>
      </header>
      <div className={`${styles.stage} ${styles.report}`}>
        {error ? (
          <p className="error" lang="en-CA" role="alert">
            {error}
          </p>
        ) : null}
        {reportFailed ? (
          <p className="error" lang={locale} role="alert">
            {t("live.presentationReport.failed")}
          </p>
        ) : null}
        {!report ? (
          !reportFailed ? (
            <section className={styles.reportCard} role="status" aria-live="polite">
              {t("live.presentationReport.loading")}
            </section>
          ) : null
        ) : (
          <>
            <section className={styles.reportCard}>
              <span className={styles.statusPill} lang="en-CA">
                {report.status} report
              </span>
              <h1 lang="">{report.title}</h1>
              <p lang="en-CA">{report.evidenceNote}</p>
              {timeMode ? (
                <p className="muted" lang={locale}>
                  {t("live.common.timeMode")}:{" "}
                  {t(timeMode === "flex" ? "live.common.flexMode" : "live.common.timedMode")}
                </p>
              ) : null}
              <div className={styles.metricRow}>
                <div className={styles.metric}>
                  <strong>{report.participantCount.toLocaleString(locale)}</strong>
                  <span>{t("live.common.participants")}</span>
                </div>
                <div className={styles.metric}>
                  <strong>{report.responseCount.toLocaleString(locale)}</strong>
                  <span>{t("live.common.responses")}</span>
                </div>
              </div>
            </section>
            <section
              className={styles.reportGrid}
              aria-label={t("live.presentationReport.blockEvidence")}
            >
              {report.evidence.map((block) => (
                <article className={styles.reportCard} key={block.blockId}>
                  <span className={styles.statusPill}>
                    {t("live.presentationReport.blockLabel", {
                      number: (block.blockIndex + 1).toLocaleString(locale),
                      kind:
                        block.kind === "content"
                          ? t("live.presentationPlay.content")
                          : t("live.roundSetup.item.question"),
                    })}
                  </span>
                  <h2 lang={block.kind === "question" || block.title ? "" : undefined}>
                    {block.kind === "content"
                      ? block.title || t("live.presentationReport.contentSlide")
                      : block.prompt}
                  </h2>
                  {block.kind === "question" ? (
                    <SessionOnlyQuickCheckLabel
                      sessionOnly={"sessionOnly" in block ? block.sessionOnly : undefined}
                    />
                  ) : null}
                  {block.kind === "content" ? (
                    <p>
                      <strong>{t("live.presentationReport.notAssessed")}</strong>{" "}
                      {t("live.presentationReport.notAssessedDescription")}
                    </p>
                  ) : (
                    <div className={styles.metricRow}>
                      <div className={styles.metric}>
                        <strong>{block.respondents.toLocaleString(locale)}</strong>
                        <span>{t("live.presentationReport.respondents")}</span>
                      </div>
                      <div className={styles.metric}>
                        <strong>
                          {block.accuracyPercent === null
                            ? t("live.common.notScored")
                            : `${block.accuracyPercent.toLocaleString(locale)}%`}
                        </strong>
                        <span>{t("live.presentationReport.accuracy")}</span>
                      </div>
                      <div className={styles.metric}>
                        <strong lang="en-CA">{block.questionTypeLabel}</strong>
                        <span>{t("live.presentationReport.questionType")}</span>
                      </div>
                      <div className={styles.metric}>
                        <strong>
                          {block.averageResponseMs === null
                            ? "—"
                            : `${(block.averageResponseMs / 1_000).toLocaleString(locale, {
                                maximumFractionDigits: 1,
                                minimumFractionDigits: 1,
                              })}s`}
                        </strong>
                        <span>{t("live.presentationReport.averageResponse")}</span>
                      </div>
                    </div>
                  )}
                </article>
              ))}
            </section>
            {report.leaderboard.length ? (
              <section className={styles.reportCard}>
                <h2>{t("live.common.leaderboard")}</h2>
                <ol className={styles.leaderboard}>
                  {report.leaderboard.map((participant) => (
                    <li key={participant.id}>
                      <span lang={locale}>{participant.rank.toLocaleString(locale)}.</span>{" "}
                      <span className={styles.reportNickname} lang="">
                        {participant.nickname}
                      </span>
                      <strong>
                        {t("live.common.points", {
                          count: participant.score.toLocaleString(locale),
                        })}
                      </strong>
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}
            {report.recovery.length ? (
              <section className={styles.reportCard}>
                <h2>{t("live.presentationReport.recoveryEvidence")}</h2>
                {report.recovery.map((item) => (
                  <p key={`${item.sourceQuestionId}:${item.recheckQuestionId}`}>
                    {t("live.presentationReport.recovered", {
                      recovered: item.recovered.toLocaleString(locale),
                      eligible: item.eligible.toLocaleString(locale),
                      percent:
                        item.recoveryPercent === null
                          ? ""
                          : ` (${item.recoveryPercent.toLocaleString(locale)}%)`,
                    })}
                  </p>
                ))}
              </section>
            ) : null}
            <section className={styles.reportCard}>
              <h2>{t("live.presentationReport.facilitationTimeline")}</h2>
              <ol className={styles.timeline} aria-label="Facilitation timeline">
                {report.timeline.map((event) => (
                  <li key={event.sequence}>
                    <strong>{event.sequence.toLocaleString(locale)}</strong>
                    <span lang="en-CA">
                      {event.type.replaceAll(".", " ")}
                      {"recoveryPackIntervention" in event && event.recoveryPackIntervention ? (
                        <small className={styles.timelineAttribution}>
                          {event.recoveryPackIntervention.type === "example"
                            ? "Worked example"
                            : "Explanation"}
                          {" · Recovery Pack v"}
                          {event.recoveryPackIntervention.reference.packVersion}
                          {" · card "}
                          {event.recoveryPackIntervention.reference.cardId}
                        </small>
                      ) : null}
                    </span>
                    <time dateTime={event.occurredAt}>
                      {new Date(event.occurredAt).toLocaleTimeString(locale)}
                    </time>
                  </li>
                ))}
              </ol>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

export default function PresentationReportPage() {
  return (
    <WorkspaceProvider>
      <PresentationReportContent />
    </WorkspaceProvider>
  );
}
