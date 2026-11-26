import { ReportHistoryTotalsSchema, type ReportHistoryTotals } from "@openround/contracts";
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
  const [totals, setTotals] = useState<ReportHistoryTotals | "loading" | "unavailable">("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void apiFetch<unknown>(`/v1/reports/totals?${query}`, { signal: controller.signal })
      .then((response) => {
        if (!controller.signal.aborted) setTotals(ReportHistoryTotalsSchema.parse(response));
      })
      .catch(() => {
        if (!controller.signal.aborted) setTotals("unavailable");
      });
    return () => controller.abort();
  }, [attempt, query]);

  return (
    <ResultsOverview
      {...overview}
      kind="rounds"
      totals={totals}
      onTotalsRetry={() => {
        setTotals("loading");
        setAttempt((current) => current + 1);
      }}
    />
  );
}
