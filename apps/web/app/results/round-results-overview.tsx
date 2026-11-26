import { ReportHistoryAnalyticsSchema, type ReportHistoryAnalytics } from "@openround/contracts";
import { useEffect, useState } from "react";
import type { ReportSummary } from "../../components/workspace/workspace-types";
import { apiFetch } from "../../lib/api";
import { ResultsOverview } from "./results-overview";
import type { ResultsActivityGrouping } from "./results-overview-model";

export function RoundResultsOverview({
  query,
  ...overview
}: {
  query: string;
  items: readonly ReportSummary[];
  hasMore: boolean;
  grouping: ResultsActivityGrouping;
  onGroupingChange: (grouping: ResultsActivityGrouping) => void;
}) {
  const [analytics, setAnalytics] = useState<ReportHistoryAnalytics | "loading" | "unavailable">(
    "loading",
  );
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void apiFetch<unknown>(`/v1/reports/totals?${query}&includeActivity=true`, {
      signal: controller.signal,
    })
      .then((response) => {
        if (!controller.signal.aborted) setAnalytics(ReportHistoryAnalyticsSchema.parse(response));
      })
      .catch(() => {
        if (!controller.signal.aborted) setAnalytics("unavailable");
      });
    return () => controller.abort();
  }, [attempt, query]);

  return (
    <ResultsOverview
      {...overview}
      kind="rounds"
      analytics={analytics}
      onAnalyticsRetry={() => {
        setAnalytics("loading");
        setAttempt((current) => current + 1);
      }}
    />
  );
}
