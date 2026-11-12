import { useEffect, useRef, useState } from "react";
import type {
  PresentationReport,
  PresentationReportWithSessionContextEnvelope,
  PresentationTimeMode,
} from "@openround/contracts";
import { AUTH_CHANGE_EVENT, apiFetch, humanError, isRetryableReadError } from "../../../../lib/api";
import { presentationReportUrl } from "../../../../lib/presentation-report-export";

interface ReadAuthority {
  key: string;
}

interface ReportState {
  authority: ReadAuthority | null;
  report: PresentationReport | null;
  timeMode: PresentationTimeMode | null;
  phase: "idle" | "loading" | "polling" | "ready" | "failed" | "unavailable";
  error: string;
}

const emptyState: ReportState = {
  authority: null,
  report: null,
  timeMode: null,
  phase: "idle",
  error: "",
};

export function usePresentationReport({
  id,
  contextKey,
  contextReady,
  refreshAccount,
  onUnauthenticated,
}: {
  id: string;
  contextKey: string;
  contextReady: boolean;
  refreshAccount: () => Promise<void>;
  onUnauthenticated: () => void;
}) {
  const [state, setState] = useState<ReportState>(emptyState);
  const [contextRevision, setContextRevision] = useState(0);
  const stateRef = useRef(state);
  const mounted = useRef(false);
  const barrier = useRef({ generation: 0, pending: false });
  const authorityRef = useRef<ReadAuthority | null>(null);
  const retryRef = useRef<(() => void) | null>(null);
  const unauthenticatedRef = useRef(onUnauthenticated);
  unauthenticatedRef.current = onUnauthenticated;

  const ready = contextReady && !barrier.current.pending;
  const authorityKey = JSON.stringify([id, contextKey, ready, contextRevision]);
  if (authorityRef.current?.key !== authorityKey) {
    authorityRef.current = { key: authorityKey };
    stateRef.current = emptyState;
  }
  const authority = authorityRef.current;
  // Canonical identity/loading/grant changes hide private evidence during render, before
  // effects run. Replacing the object also permanently invalidates captured handlers.
  const view = ready && state.authority === authority ? state : emptyState;

  function publish(next: ReportState) {
    stateRef.current = next;
    setState(next);
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      retryRef.current = null;
    };
  }, []);

  useEffect(() => {
    const invalidate = () => {
      const generation = ++barrier.current.generation;
      barrier.current.pending = true;
      authorityRef.current = null;
      retryRef.current = null;
      publish(emptyState);
      setContextRevision((current) => current + 1);
      // The same route may remain mounted after an identity change. Re-read only after
      // the provider has resolved its canonical account, even if the IDs stay the same.
      void refreshAccount()
        .catch(() => undefined)
        .finally(() => {
          if (!mounted.current || barrier.current.generation !== generation) return;
          barrier.current.pending = false;
          setContextRevision((current) => current + 1);
        });
    };
    window.addEventListener(AUTH_CHANGE_EVENT, invalidate);
    window.addEventListener("polling-pops:workspace-updated", invalidate);
    return () => {
      window.removeEventListener(AUTH_CHANGE_EVENT, invalidate);
      window.removeEventListener("polling-pops:workspace-updated", invalidate);
    };
  }, [refreshAccount]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let retryAttempts = 0;
    const current = () =>
      !cancelled &&
      mounted.current &&
      !barrier.current.pending &&
      authorityRef.current === authority;
    const load = async () => {
      if (!current()) return;
      try {
        const result = await apiFetch<PresentationReportWithSessionContextEnvelope>(
          presentationReportUrl(id),
        );
        if (!current()) return;
        retryAttempts = 0;
        if (result.reportStatus === "failed") {
          publish({ ...emptyState, authority, phase: "failed" });
          return;
        }
        const report = result.report ?? stateRef.current.report;
        const pending = result.reportStatus !== "ready";
        publish({
          authority,
          report,
          // Older APIs ignore the opt-in query during a rolling upgrade.
          timeMode: result.sessionContext?.timeMode ?? "timed",
          phase: pending ? "polling" : report ? "ready" : "unavailable",
          error: "",
        });
        if (pending) pollTimer = setTimeout(() => void load(), 1_000);
      } catch (caught) {
        if (!current()) return;
        const status = (caught as { status?: number }).status;
        const revoked = status === 401 || status === 403 || status === 404;
        const retryable = isRetryableReadError(caught) && retryAttempts < 5;
        publish({
          ...(revoked ? emptyState : stateRef.current),
          authority,
          phase: retryable ? "polling" : "unavailable",
          error: humanError(caught),
        });
        if (status === 401) unauthenticatedRef.current();
        if (retryable) {
          const retryDelayMs = Math.min(10_000, 1_000 * 2 ** retryAttempts);
          retryAttempts += 1;
          pollTimer = setTimeout(() => void load(), retryDelayMs);
        }
      }
    };
    const retry = () => {
      if (!current() || ["loading", "polling"].includes(stateRef.current.phase)) return;
      if (pollTimer) clearTimeout(pollTimer);
      retryAttempts = 0;
      publish({ ...stateRef.current, authority, phase: "loading", error: "" });
      void load();
    };
    retryRef.current = retry;
    publish({ ...emptyState, authority, phase: "loading" });
    void load();
    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
      if (retryRef.current === retry) retryRef.current = null;
    };
  }, [id, authority, ready]);

  return {
    ...view,
    loading: view.phase === "loading" || view.phase === "polling",
    summaryReady: view.phase === "ready",
    contextReady: ready,
    resolvingContext: barrier.current.pending,
    canUseReport: () =>
      mounted.current &&
      !barrier.current.pending &&
      authorityRef.current === authority &&
      stateRef.current === view &&
      view.report !== null,
    retry: () => {
      if (authorityRef.current === authority && !barrier.current.pending) retryRef.current?.();
    },
  };
}
