import { useEffect, useState } from "react";
import { apiFetch, humanError } from "../../lib/api";
import type { HomeSummary } from "./home-model";

interface SummaryState {
  contextKey: string | null;
  summary: HomeSummary | null;
  loading: boolean;
  error: string;
}

export function useHomeSummary(contextKey: string | null) {
  const [state, setState] = useState<SummaryState>({
    contextKey: null,
    summary: null,
    loading: false,
    error: "",
  });
  const [refreshIndex, setRefreshIndex] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setState((previous) => ({
      contextKey,
      summary: contextKey !== null && previous.contextKey === contextKey ? previous.summary : null,
      loading: contextKey !== null,
      error: "",
    }));
    if (contextKey !== null) {
      void apiFetch<HomeSummary>("/v1/home/summary", {
        signal: controller.signal,
        cache: "no-store",
      }).then(
        (summary) => {
          if (current && !controller.signal.aborted)
            setState({ contextKey, summary, loading: false, error: "" });
        },
        (error: unknown) => {
          if (current && !controller.signal.aborted)
            setState((previous) => ({ ...previous, loading: false, error: humanError(error) }));
        },
      );
    }
    return () => {
      current = false;
      controller.abort();
    };
  }, [contextKey, refreshIndex]);

  const matches = contextKey !== null && state.contextKey === contextKey;
  return {
    summary: matches ? state.summary : null,
    loading: contextKey !== null && (!matches || state.loading),
    error: matches ? state.error : "",
    refresh: () => setRefreshIndex((index) => index + 1),
  };
}
