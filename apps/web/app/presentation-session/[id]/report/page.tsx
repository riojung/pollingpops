"use client";

import type { PresentationReport } from "@openround/contracts";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { CreatorBrand } from "../../../../components/brand";
import { useLocale } from "../../../../components/locale-provider";
import { SessionOnlyQuickCheckLabel } from "../../../../components/presentation-live/session-only-quick-check-label";
import {
  useWorkspace,
  WorkspaceProvider,
} from "../../../../components/workspace/workspace-provider";
import styles from "../../../../components/presentation-live/presentation-live.module.css";
import { presentationReportCopy } from "../../../../lib/i18n/presentation-report-copy";
import { SessionSummaryButton } from "../../../../components/session-summary/summary-dialog";
import { PresentationSessionInsightsPanel } from "../../../../components/presentation-insights/session-insights";
import { PresentationOpinionResults } from "../../../../components/presentation-live/opinion-results";
import {
  presentationReportCsv,
  presentationReportBlockNavigation,
  presentationReportBlockTitle,
} from "../../../../lib/presentation-report-export";
import { TextResultsView } from "../../../../components/text-results-view";
import { isTextQuestion } from "../../../../lib/text-response";
import { usePresentationReport } from "./use-presentation-report";

function PresentationReportContent() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { locale, t } = useLocale();
  const copy = presentationReportCopy(locale);
  const {
    creator,
    entitlements,
    productFeatures,
    loading: accountLoading,
    error: accountError,
    refreshAccount,
  } = useWorkspace();
  const contextKey = JSON.stringify([
    id,
    creator?.userId,
    creator?.workspaceId,
    creator?.role,
    accountLoading,
    accountError,
    productFeatures?.presentations,
    entitlements?.csvExport,
  ]);
  const read = usePresentationReport({
    id,
    contextKey,
    contextReady: !accountLoading && !accountError && creator != null,
    refreshAccount,
    onUnauthenticated: () => router.replace("/signin"),
  });
  const { report, timeMode, summaryReady } = read;
  const loading =
    accountLoading ||
    read.loading ||
    read.resolvingContext ||
    (read.contextReady && read.phase === "idle");
  const error = accountError || read.error;
  const reportFailed = read.phase === "failed";
  const [exportFailure, setExportFailure] = useState<{
    report: PresentationReport;
    current: () => boolean;
  } | null>(null);
  const exportFailed = exportFailure?.report === report && exportFailure.current();
  const hasQuestionEvidence = report?.evidence.some((block) => block.kind === "question") ?? false;

  function exportEvidence() {
    if (!report || !read.canUseReport()) return;
    setExportFailure(null);
    try {
      const url = URL.createObjectURL(
        new Blob(["\ufeff", presentationReportCsv(report)], { type: "text/csv;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `presentation-${id}-evidence.csv`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch {
      if (read.canUseReport()) setExportFailure({ report, current: read.canUseReport });
    }
  }

  return (
    <main className={styles.page} lang={locale}>
      <header className={styles.topbar}>
        <CreatorBrand inverted productFeatures={productFeatures} />
        <div className="button-row">
          {report ? (
            <button type="button" className="button-quiet" onClick={exportEvidence}>
              {copy("exportEvidenceCsv")}
            </button>
          ) : null}
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
        {exportFailed ? (
          <p className="error" role="alert">
            {copy("exportFailed")}
          </p>
        ) : null}
        {error ? (
          <p className="error" role="alert">
            {copy("serviceMessage")}: <span lang="en-CA">{error}</span>
          </p>
        ) : null}
        {read.phase !== "ready" ? (
          <section className={styles.reportCard} aria-busy={loading}>
            <p role={reportFailed ? "alert" : "status"}>
              {loading
                ? t("live.presentationReport.loading")
                : reportFailed
                  ? t("live.presentationReport.failed")
                  : copy("reportUnavailable")}
            </p>
            <button
              className="button-quiet"
              disabled={loading}
              onClick={() => {
                if (read.contextReady) read.retry();
                else void refreshAccount();
              }}
              type="button"
            >
              {copy(loading ? "retryingReport" : "retryReport")}
            </button>
          </section>
        ) : null}
        {report ? (
          <>
            <section className={styles.reportCard}>
              <span className={styles.statusPill}>{copy("finishedReport")}</span>
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
                  <strong>
                    {(hasQuestionEvidence
                      ? report.responseCount
                      : report.evidence.length
                    ).toLocaleString(locale)}
                  </strong>
                  <span>
                    {t(
                      hasQuestionEvidence
                        ? "live.common.responses"
                        : "live.presentationHost.totalBlocks",
                    )}
                  </span>
                </div>
              </div>
              {report.schemaVersion === 6 || report.schemaVersion === 7 ? (
                <p>
                  {copy("navigationCounts", {
                    jumps: report.navigation.jumpCount.toLocaleString(locale),
                    returns: report.navigation.returnCount.toLocaleString(locale),
                  })}
                </p>
              ) : null}
              {report.schemaVersion === 7 ? (
                <p>
                  {copy("interactionCounts", {
                    reveals: report.interactionSummary.revealChangeCount.toLocaleString(locale),
                    branches: report.interactionSummary.branchCount.toLocaleString(locale),
                  })}
                </p>
              ) : null}
            </section>
            {summaryReady ? (
              <PresentationSessionInsightsPanel
                canUseEvidence={read.canUseReport}
                source={{
                  sessionId: report.sessionId,
                  presentationId: report.presentationId,
                  presentationVersionId: report.presentationVersionId,
                }}
              />
            ) : null}
            <section
              className={styles.reportGrid}
              aria-label={t("live.presentationReport.blockEvidence")}
            >
              {report.evidence.map((block) => {
                const navigation = presentationReportBlockNavigation(report, block.blockId);
                return (
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
                    {navigation ? (
                      <div>
                        {navigation.sectionTitle ? (
                          <p>
                            {copy("sectionLabel")}: <span lang="">{navigation.sectionTitle}</span>
                          </p>
                        ) : null}
                        <p>
                          <strong>
                            {copy(
                              navigation.status === "skipped" ? "skippedNotPresented" : "presented",
                            )}
                          </strong>
                        </p>
                        {navigation.status === "skipped" ? <p>{copy("skippedEvidence")}</p> : null}
                      </div>
                    ) : null}
                    {block.kind === "question" ? (
                      <SessionOnlyQuickCheckLabel
                        sessionOnly={"sessionOnly" in block ? block.sessionOnly : undefined}
                      />
                    ) : null}
                    {navigation?.status === "skipped" ? null : block.kind === "content" &&
                      hasQuestionEvidence ? (
                      <p>
                        <strong>{t("live.presentationReport.notAssessed")}</strong>{" "}
                        {t("live.presentationReport.notAssessedDescription")}
                      </p>
                    ) : block.kind === "question" ? (
                      <div className={styles.metricRow}>
                        <div className={styles.metric}>
                          <strong>{block.respondents.toLocaleString(locale)}</strong>
                          <span>{t("live.presentationReport.respondents")}</span>
                        </div>
                        <div className={styles.metric}>
                          {("opinionSummary" in block && block.opinionSummary) ||
                          isTextQuestion(block.questionType) ? (
                            <>
                              <strong>{copy("unscoredOpinion")}</strong>
                              <span>{copy("assessment")}</span>
                            </>
                          ) : (
                            <>
                              <strong>
                                {block.accuracyPercent === null
                                  ? t("live.common.notScored")
                                  : `${block.accuracyPercent.toLocaleString(locale)}%`}
                              </strong>
                              <span>{t("live.presentationReport.accuracy")}</span>
                            </>
                          )}
                        </div>
                        <div className={styles.metric}>
                          <strong>{copy(`questionType.${block.questionType}`)}</strong>
                          <span>{t("live.presentationReport.questionType")}</span>
                        </div>
                        <div className={styles.metric}>
                          <strong>
                            {block.averageResponseMs === null
                              ? "—"
                              : (block.averageResponseMs / 1_000).toLocaleString(locale, {
                                  maximumFractionDigits: 1,
                                  minimumFractionDigits: 1,
                                  style: "unit",
                                  unit: "second",
                                  unitDisplay: "narrow",
                                })}
                          </strong>
                          <span>{t("live.presentationReport.averageResponse")}</span>
                        </div>
                      </div>
                    ) : null}
                    {navigation?.status !== "skipped" &&
                    block.kind === "question" &&
                    "opinionSummary" in block &&
                    block.opinionSummary ? (
                      <PresentationOpinionResults summary={block.opinionSummary} />
                    ) : null}
                    {navigation?.status !== "skipped" &&
                    block.kind === "question" &&
                    isTextQuestion(block.questionType) ? (
                      "textResults" in block && block.textResults ? (
                        <TextResultsView
                          type={block.textResults.kind}
                          respondents={block.textResults.respondents}
                          items={
                            block.textResults.kind === "open_text"
                              ? block.textResults.entries.map((entry, index) => ({
                                  answerId: `${block.blockId}:${index}`,
                                  body: entry.value,
                                }))
                              : undefined
                          }
                          terms={
                            block.textResults.kind === "word_cloud"
                              ? block.textResults.buckets
                              : undefined
                          }
                        />
                      ) : (
                        <p>{copy("textResultsSuppressed")}</p>
                      )
                    ) : null}
                  </article>
                );
              })}
            </section>
            {hasQuestionEvidence && report.leaderboard.length ? (
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
            {hasQuestionEvidence && report.recovery.length ? (
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
              <ol
                className={styles.timeline}
                aria-label={t("live.presentationReport.facilitationTimeline")}
              >
                {report.timeline.map((event) => (
                  <li key={event.sequence}>
                    <strong>{event.sequence.toLocaleString(locale)}</strong>
                    <span>
                      {copy(`event.${event.type}`)}
                      {"interaction" in event && event.interaction ? (
                        <small className={styles.timelineAttribution}>
                          {copy(
                            event.interaction.revealed
                              ? "broadcastRevealShown"
                              : "broadcastRevealHidden",
                          )}{" "}
                          ·{" "}
                          <span lang="">
                            {presentationReportBlockTitle(report, event.interaction.blockId)}
                          </span>
                        </small>
                      ) : null}
                      {"branch" in event && event.branch ? (
                        <small className={styles.timelineAttribution}>
                          {copy("answerBranchMatched", {
                            matched: event.branch.matchedResponses.toLocaleString(locale),
                            total: event.branch.denominator.toLocaleString(locale),
                          })}
                        </small>
                      ) : null}
                      {"navigation" in event && event.navigation ? (
                        <small className={styles.timelineAttribution}>
                          {copy(
                            event.navigation.restored ? "restoredSavedState" : "presentedBlock",
                          )}
                          {" · "}
                          <span lang="">
                            {presentationReportBlockTitle(report, event.navigation.toBlockId)}
                          </span>
                        </small>
                      ) : null}
                      {"recoveryPackIntervention" in event && event.recoveryPackIntervention ? (
                        <small className={styles.timelineAttribution}>
                          {copy(
                            event.recoveryPackIntervention.type === "example"
                              ? "workedExample"
                              : "explanation",
                          )}
                          {" · "}
                          {copy("recoveryPackReference", {
                            version:
                              event.recoveryPackIntervention.reference.packVersion.toLocaleString(
                                locale,
                              ),
                            card: event.recoveryPackIntervention.reference.cardId,
                          })}
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
        ) : null}
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
