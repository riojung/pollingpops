import {
  FollowupHistoryAnalyticsSchema,
  PresentationResultsAnalyticsSchema,
  ReportHistoryAnalyticsSchema,
  SurveyResultsAnalyticsSchema,
  type PresentationResultSummary,
} from "@openround/contracts";
import { useEffect, useState } from "react";
import type { FollowupSummary, ReportSummary } from "../../components/workspace/workspace-types";
import { apiFetch } from "../../lib/api";
import { ResultsOverview } from "./results-overview";
import type { ResultsActivityGrouping } from "./results-overview-model";

interface HistoryOverviewProps<T> {
  query: string;
  items: readonly T[];
  hasMore: boolean;
  grouping: ResultsActivityGrouping;
  onGroupingChange: (grouping: ResultsActivityGrouping) => void;
}

function useHistoryAnalytics<T>(
  path: string | null,
  parse: (response: unknown) => T,
  revision = 0,
) {
  const [snapshot, setSnapshot] = useState<{
    path: string;
    revision: number;
    requestedAt: number;
    analytics: T | "unavailable";
  } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    const requestedAt = Date.now();
    void apiFetch<unknown>(path, { signal: controller.signal })
      .then((response) => {
        if (!controller.signal.aborted)
          setSnapshot({ path, revision, requestedAt, analytics: parse(response) });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setSnapshot({ path, revision, requestedAt, analytics: "unavailable" });
      });
    return () => controller.abort();
  }, [attempt, parse, path, revision]);

  return {
    current: snapshot?.path === path ? snapshot : null,
    onAnalyticsRetry() {
      setSnapshot(null);
      setAttempt((current) => current + 1);
    },
  };
}

export function RoundResultsOverview({ query, ...overview }: HistoryOverviewProps<ReportSummary>) {
  const { current, onAnalyticsRetry } = useHistoryAnalytics(
    `/v1/reports/totals?${query}&includeActivity=true`,
    ReportHistoryAnalyticsSchema.parse,
  );
  return (
    <ResultsOverview
      {...overview}
      analytics={current?.analytics ?? "loading"}
      onAnalyticsRetry={onAnalyticsRetry}
      kind="rounds"
    />
  );
}

export function PracticeResultsOverview({
  query,
  ...overview
}: HistoryOverviewProps<FollowupSummary>) {
  const { current, onAnalyticsRetry } = useHistoryAnalytics(
    `/v1/followups/analytics?${query}`,
    FollowupHistoryAnalyticsSchema.parse,
  );
  return (
    <ResultsOverview
      {...overview}
      analytics={current?.analytics ?? "loading"}
      onAnalyticsRetry={onAnalyticsRetry}
      kind="practice"
    />
  );
}

export function PresentationResultsOverview({
  query,
  ...overview
}: HistoryOverviewProps<PresentationResultSummary>) {
  const { current, onAnalyticsRetry } = useHistoryAnalytics(
    `/v1/presentation-sessions/results/analytics?${query}`,
    PresentationResultsAnalyticsSchema.parse,
  );
  return (
    <ResultsOverview
      {...overview}
      analytics={current?.analytics ?? "loading"}
      onAnalyticsRetry={onAnalyticsRetry}
      kind="presentations"
    />
  );
}

export function useSurveyResultsAnalytics(query: string | null, revision: number, clock: number) {
  const { current, onAnalyticsRetry } = useHistoryAnalytics(
    query === null ? null : `/v1/survey-rooms/results/analytics?${query}`,
    SurveyResultsAnalyticsSchema.parse,
    revision,
  );
  const expiresAt =
    current && typeof current.analytics === "object" && current.analytics.refreshAfterMs !== null
      ? current.requestedAt + current.analytics.refreshAfterMs
      : Infinity;
  return {
    analytics: expiresAt > clock ? (current?.analytics ?? "loading") : ("loading" as const),
    refreshAt: expiresAt > clock || current?.revision === revision ? expiresAt : Infinity,
    onAnalyticsRetry,
  };
}
