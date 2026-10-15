"use client";

import type { surveyAggregate } from "@openround/contracts/surveys";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useLocale } from "../../../../components/locale-provider";
import { SessionSummaryButton } from "../../../../components/session-summary/summary-dialog";
import {
  WorkspaceProvider,
  useWorkspace,
} from "../../../../components/workspace/workspace-provider";
import { WorkspaceShell } from "../../../../components/workspace/workspace-shell";
import styles from "../../../../components/workspace/workspace-content.module.css";
import { apiFetch } from "../../../../lib/api";
import { formatDateTime, formatNumber } from "../../../../lib/i18n/format";
import reportStyles from "./survey-results.module.css";

interface SurveyRoom {
  title: string;
  closesAt: string;
  expiresAt: string;
  closed: boolean;
}

interface SurveyReport {
  key: string;
  room: SurveyRoom;
  results: ReturnType<typeof surveyAggregate>;
}

function SurveyResults() {
  const { id } = useParams<{ id: string }>();
  const { creator, canEdit } = useWorkspace();
  const { locale, t } = useLocale();
  const workspaceId = creator?.workspaceId ?? "";
  const requestKey = `${workspaceId}\u0000${id}`;
  const activeRequestKey = useRef(requestKey);
  activeRequestKey.current = requestKey;
  const [report, setReport] = useState<SurveyReport | null>(null);
  const [loadState, setLoadState] = useState({ key: "", loading: true, failed: false });
  const [revision, setRevision] = useState(0);
  // Route and workspace changes hide previous evidence before their effects run.
  const current = report?.key === requestKey && workspaceId ? report : null;
  const loading = loadState.key !== requestKey || loadState.loading;
  const failed = loadState.key === requestKey && loadState.failed;

  useEffect(() => {
    const controller = new AbortController();
    setReport(null);
    setLoadState({ key: requestKey, loading: true, failed: false });
    if (!workspaceId || !id) return () => controller.abort();
    const path = `/v1/survey-rooms/${encodeURIComponent(id)}`;
    void Promise.all([
      apiFetch<{ room: SurveyRoom }>(path, {
        cache: "no-store",
        signal: controller.signal,
      }),
      apiFetch<{ results: SurveyReport["results"] }>(`${path}/results`, {
        cache: "no-store",
        signal: controller.signal,
      }),
    ])
      .then(([roomResponse, resultsResponse]) => {
        if (controller.signal.aborted || activeRequestKey.current !== requestKey) return;
        setReport({ key: requestKey, room: roomResponse.room, results: resultsResponse.results });
        setLoadState({ key: requestKey, loading: false, failed: false });
      })
      .catch(() => {
        if (controller.signal.aborted || activeRequestKey.current !== requestKey) return;
        setLoadState({ key: requestKey, loading: false, failed: true });
      });
    return () => controller.abort();
  }, [id, requestKey, revision, workspaceId]);

  return (
    <WorkspaceShell
      translationLevel="full"
      title={current?.room.title || t("pages.results.surveyTitle")}
      description={t("pages.results.surveyDescription")}
      actions={
        <Link className="button-quiet" href="/results?view=surveys">
          {t("pages.results.surveyBack")}
        </Link>
      }
    >
      <div className="button-row">
        <button
          className="button-quiet"
          type="button"
          disabled={loading}
          onClick={() => setRevision((value) => value + 1)}
        >
          {t("pages.results.surveyRefresh")}
        </button>
        {current && canEdit ? (
          <Link className="button-quiet" href={`/surveys/rooms/${encodeURIComponent(id)}`}>
            {t("pages.results.surveyManage")}
          </Link>
        ) : null}
        {current && current.results.resultsStatus !== "collecting" ? (
          <SessionSummaryButton key={requestKey} source={{ kind: "survey", id }} />
        ) : null}
      </div>
      {failed ? (
        <p className="error" role="alert">
          {t("pages.results.surveyLoadError")}
        </p>
      ) : null}
      {loading ? <p role="status">{t("pages.common.loading")}</p> : null}
      {current ? (
        <>
          <section className={`${styles.panel} ${reportStyles.panel}`}>
            <h2>
              {t(
                current.results.resultsStatus === "collecting"
                  ? "pages.results.surveyCollecting"
                  : "pages.results.surveyClosed",
              )}
            </h2>
            <p>
              {t("pages.results.surveyDeadline", {
                date: formatDateTime(locale, current.room.closesAt),
              })}
            </p>
            <p>
              {t("pages.results.surveyRetention", {
                date: formatDateTime(locale, current.room.expiresAt),
              })}
            </p>
            <p>{t("pages.results.surveyPrivacy")}</p>
          </section>
          <section className={`${styles.panel} ${reportStyles.panel}`}>
            <h2>{t("pages.results.surveyAggregate")}</h2>
            <p>
              {t("pages.results.surveySubmissions", {
                count: formatNumber(locale, current.results.submittedCount),
              })}
            </p>
            {current.results.resultsStatus === "collecting" ? (
              <p className="notice">{t("pages.results.surveyCollectingNotice")}</p>
            ) : current.results.suppressed ? (
              <p className="notice">{t("pages.results.surveySuppressed")}</p>
            ) : (
              current.results.questions.map((question, index) => (
                <section className={reportStyles.question} key={question.id}>
                  <h3 id={`survey-question-${question.id}`} lang="">
                    {question.prompt}
                  </h3>
                  {question.suppressed ? (
                    <p className="notice">{t("pages.results.surveyQuestionSuppressed")}</p>
                  ) : (
                    <>
                      <p>
                        {t("pages.results.surveyResponses", {
                          count: formatNumber(locale, question.answeredCount ?? 0),
                        })}
                      </p>
                      {(question.maxSelections ?? 1) > 1 ? (
                        <p>{t("pages.results.surveyMultipleSelections")}</p>
                      ) : null}
                      <div
                        className={reportStyles.tableContainer}
                        role="region"
                        aria-label={t("summary.questionRegion", {
                          number: formatNumber(locale, index + 1),
                          prompt: question.prompt,
                        })}
                        tabIndex={0}
                      >
                        <table className={reportStyles.distribution}>
                          <caption id={`survey-counts-${question.id}`}>
                            {t("pages.results.surveyResponseCounts")}
                          </caption>
                          <thead>
                            <tr>
                              <th scope="col">{t("pages.results.surveyResponse")}</th>
                              <th scope="col">{t("pages.results.surveyCount")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {question.distribution.map((row) => (
                              <tr key={row.label}>
                                <th scope="row" lang="">
                                  {row.label}
                                </th>
                                <td>{formatNumber(locale, row.count)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </section>
              ))
            )}
          </section>
        </>
      ) : null}
    </WorkspaceShell>
  );
}

export default function SurveyResultsPage() {
  return (
    <WorkspaceProvider>
      <SurveyResults />
    </WorkspaceProvider>
  );
}
