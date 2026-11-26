import {
  FollowupHistoryAnalyticsSchema,
  PresentationResultsAnalyticsSchema,
  ReportHistoryAnalyticsSchema,
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

function useHistoryAnalytics<T>(path: string, parse: (response: unknown) => T) {
  const [analytics, setAnalytics] = useState<T | "loading" | "unavailable">("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void apiFetch<unknown>(path, { signal: controller.signal })
      .then((response) => {
        if (!controller.signal.aborted) setAnalytics(parse(response));
      })
      .catch(() => {
        if (!controller.signal.aborted) setAnalytics("unavailable");
      });
    return () => controller.abort();
  }, [attempt, parse, path]);

  return {
    analytics,
    onAnalyticsRetry() {
      setAnalytics("loading");
      setAttempt((current) => current + 1);
    },
  };
}

export function RoundResultsOverview({ query, ...overview }: HistoryOverviewProps<ReportSummary>) {
  const analytics = useHistoryAnalytics(
    `/v1/reports/totals?${query}&includeActivity=true`,
    ReportHistoryAnalyticsSchema.parse,
  );
  return <ResultsOverview {...overview} {...analytics} kind="rounds" />;
}

export function PracticeResultsOverview({
  query,
  ...overview
}: HistoryOverviewProps<FollowupSummary>) {
  const analytics = useHistoryAnalytics(
    `/v1/followups/analytics?${query}`,
    FollowupHistoryAnalyticsSchema.parse,
  );
  return <ResultsOverview {...overview} {...analytics} kind="practice" />;
}

export function PresentationResultsOverview({
  query,
  ...overview
}: HistoryOverviewProps<PresentationResultSummary>) {
  const analytics = useHistoryAnalytics(
    `/v1/presentation-sessions/results/analytics?${query}`,
    PresentationResultsAnalyticsSchema.parse,
  );
  return <ResultsOverview {...overview} {...analytics} kind="presentations" />;
}
