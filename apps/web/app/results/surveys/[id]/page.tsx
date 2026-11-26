"use client";

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
import { ApiClientError, apiFetch } from "../../../../lib/api";
import { formatDateTime, formatNumber } from "../../../../lib/i18n/format";
import { SurveyAnalytics, SurveyQuestionResults } from "./survey-analytics";
import { surveyAnalyticsOverview, type SurveyAggregate } from "./survey-analytics-model";
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
  results: SurveyAggregate;
}

type SurveyLoadState = "loading" | "ready" | "unavailable" | "failed";

function SurveyResults() {
  const { id } = useParams<{ id: string }>();
  const { creator, canEdit } = useWorkspace();
  const { locale, t } = useLocale();
  const workspaceId = creator?.workspaceId ?? "";
  const requestKey = `${workspaceId}\u0000${id}`;
  const activeRequestKey = useRef(requestKey);
  activeRequestKey.current = requestKey;
  const [report, setReport] = useState<SurveyReport | null>(null);
  const [loadState, setLoadState] = useState<{ key: string; status: SurveyLoadState }>({
    key: "",
    status: "loading",
  });
  const [revision, setRevision] = useState(0);
  // Route and workspace changes hide previous evidence before their effects run.
  const current = report?.key === requestKey && workspaceId ? report : null;
  const status = loadState.key === requestKey ? loadState.status : "loading";
  const loading = status === "loading";
  const overview = current ? surveyAnalyticsOverview(current.results) : null;
  const answerCounts = new Map(
    overview?.questions.map(({ id, answeredCount }) => [id, answeredCount]),
  );
  const empty =
    current?.results.resultsStatus === "insufficient_sample" &&
    current.results.submittedCount === 0;

  useEffect(() => {
    const controller = new AbortController();
    setReport(null);
    setLoadState({ key: requestKey, status: "loading" });
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
        setLoadState({ key: requestKey, status: "ready" });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || activeRequestKey.current !== requestKey) return;
        const conditionalUnavailable =
          error instanceof ApiClientError &&
          error.code === "SURVEY_BRANCHING_RESULTS_NOT_AVAILABLE";
        setLoadState({
          key: requestKey,
          status: conditionalUnavailable ? "unavailable" : "failed",
        });
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
      {status === "failed" ? (
        <p className="error" role="alert">
          {t("pages.results.surveyLoadError")}
        </p>
      ) : null}
      {status === "unavailable" ? (
        <p className="notice" role="status">
          {t("pages.results.surveyConditionalUnavailable")}
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
          {overview ? (
            <SurveyAnalytics overview={overview} submittedCount={current.results.submittedCount} />
          ) : null}
          <section className={`${styles.panel} ${reportStyles.panel}`}>
            <h2>{t("pages.results.surveyAggregate")}</h2>
            <p>
              {empty
                ? t("pages.results.surveyNoSubmissions")
                : t("pages.results.surveySubmissions", {
                    count: formatNumber(locale, current.results.submittedCount),
                  })}
            </p>
            {current.results.resultsStatus === "collecting" ? (
              <p className="notice">{t("pages.results.surveyCollectingNotice")}</p>
            ) : empty ? null : !overview ? (
              <p className="notice">{t("pages.results.surveySuppressed")}</p>
            ) : (
              <div className={reportStyles.questions}>
                {current.results.questions.map((question, index) => (
                  <SurveyQuestionResults
                    key={question.id}
                    question={question}
                    position={index + 1}
                    answeredCount={answerCounts.get(question.id)}
                  />
                ))}
              </div>
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
