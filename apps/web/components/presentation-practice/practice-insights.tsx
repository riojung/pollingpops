"use client";

import { useEffect, useRef, useState } from "react";
import type {
  PresentationPracticeAssignmentMetadata,
  PresentationPracticeInsights,
} from "@openround/contracts";
import { AUTH_CHANGE_EVENT, humanError } from "../../lib/api";
import { fetchPracticeInsights } from "../../lib/presentation-practice-client";
import styles from "../presentation-assignments/assignment.module.css";

export function PracticeInsightCounts({ report }: { report: PresentationPracticeInsights }) {
  return (
    <>
      <p>
        Observed at <time dateTime={report.generatedAt}>{report.generatedAt}</time>. Refresh to
        observe later activity.
      </p>
      <dl className={styles.counts}>
        {[
          ["Started attempts", report.startedAttempts],
          ["Completed attempts", report.completedAttempts],
          ["In-progress attempts", report.inProgressAttempts],
        ].map(([label, value]) => (
          <div key={String(label)}>
            <dt>{label}</dt>
            <dd>{value === null ? "Suppressed" : String(value)}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}
export function PresentationPracticeInsights({
  presentationId,
  assignment,
  actorKey,
}: {
  presentationId: string;
  assignment: PresentationPracticeAssignmentMetadata;
  actorKey: string;
}) {
  const scope = JSON.stringify([
    actorKey,
    presentationId.toLowerCase(),
    assignment.id.toLowerCase(),
    assignment.versionId.toLowerCase(),
  ]);
  const memory = useRef({
    scope: "",
    epoch: 0,
    blocked: true,
    loading: false,
    controller: null as AbortController | null,
  });
  const [state, setState] = useState({
    scope,
    report: null as PresentationPracticeInsights | null,
    loading: false,
    error: "",
  });
  useEffect(() => {
    const m = memory.current;
    m.scope = scope;
    m.blocked = false;
    m.loading = false;
    const clear = () => {
      m.epoch++;
      m.blocked = true;
      m.loading = false;
      m.controller?.abort();
      setState({ scope, report: null, loading: false, error: "" });
    };
    setState({ scope, report: null, loading: false, error: "" });
    window.addEventListener(AUTH_CHANGE_EVENT, clear);
    return () => {
      clear();
      window.removeEventListener(AUTH_CHANGE_EVENT, clear);
    };
  }, [scope]);
  async function load() {
    const m = memory.current;
    if (m.blocked || m.scope !== scope || m.loading) return;
    m.controller?.abort();
    const controller = new AbortController(),
      epoch = ++m.epoch;
    m.controller = controller;
    m.loading = true;
    setState({ scope, report: null, loading: true, error: "" });
    const valid = () =>
      !controller.signal.aborted && !m.blocked && m.scope === scope && m.epoch === epoch;
    try {
      const report = await fetchPracticeInsights(
        presentationId,
        assignment.id,
        assignment.versionId,
        controller.signal,
      );
      if (valid()) setState({ scope, report, loading: false, error: "" });
    } catch (error) {
      if (valid()) setState({ scope, report: null, loading: false, error: humanError(error) });
    } finally {
      if (valid()) m.loading = false;
    }
  }
  const visible = state.scope === scope ? state : null;
  return (
    <section className={styles.insights} aria-labelledby="presentation-practice-insights-title">
      <h3 id="presentation-practice-insights-title">Practice insights</h3>
      <p>
        Counts are anonymous attempts, not people. Completion means all pages and checks were
        acknowledged, not verified identity or mastery.
      </p>
      <p>
        With fewer than 5 starts, all counts are suppressed. Groups of 1–4 and counts that would
        reveal them are suppressed. Suppressed never means zero.
      </p>
      <p>
        Reports remain available for 7 days after the deadline, including revoked assignments.
        Individual answers and grades stay private to each attempt.
      </p>
      <button type="button" disabled={!!visible?.loading} onClick={() => void load()}>
        {visible?.report
          ? "Refresh practice insights"
          : visible?.error
            ? "Retry practice insights"
            : "Load practice insights"}
      </button>
      {visible?.loading ? <p role="status">Loading practice insights…</p> : null}
      {visible?.error ? <p role="alert">{visible.error}</p> : null}
      {visible?.report ? <PracticeInsightCounts report={visible.report} /> : null}
    </section>
  );
}
