"use client";

import { useEffect, useRef, useState } from "react";
import type {
  PresentationAssignmentMetadata,
  PresentationReadingReport,
} from "@openround/contracts";
import { AUTH_CHANGE_EVENT, humanError } from "../../lib/api";
import {
  downloadReadingInsightsCsv,
  fetchReadingInsights,
  readingInsightCount,
  readingInsightsCsv,
  verifyReadingInsights,
} from "../../lib/presentation-reading-insights-client";
import sharing from "../presentation-sharing/sharing.module.css";
import styles from "./assignment.module.css";

export function ReadingInsightsDetails({ report }: { report: PresentationReadingReport }) {
  return (
    <>
      <p className={styles.metadata}>
        Created{" "}
        <time dateTime={report.assignment.createdAt}>
          {new Date(report.assignment.createdAt).toLocaleString("en-CA")}
        </time>
        <br />
        Deadline{" "}
        <time dateTime={report.assignment.expiresAt}>
          {new Date(report.assignment.expiresAt).toLocaleString("en-CA")}
        </time>
      </p>
      <p>
        Observed at <time dateTime={report.generatedAt}>{report.generatedAt}</time>. Refresh to
        observe later activity.
      </p>
      <dl className={styles.counts}>
        <div>
          <dt>Started attempts</dt>
          <dd>{readingInsightCount(report.startedAttempts)}</dd>
        </div>
        <div>
          <dt>Completed attempts</dt>
          <dd>{readingInsightCount(report.completedAttempts)}</dd>
        </div>
        <div>
          <dt>In-progress attempts</dt>
          <dd>{readingInsightCount(report.inProgressAttempts)}</dd>
        </div>
      </dl>
      <div
        className={styles.coverage}
        tabIndex={0}
        role="region"
        aria-label="Page reading coverage"
      >
        <table>
          <caption>Page reading coverage · assigned published version</caption>
          <thead>
            <tr>
              <th scope="col">Page</th>
              <th scope="col">Attempts marked read</th>
            </tr>
          </thead>
          <tbody>
            {report.pages.map((page) => (
              <tr key={page.blockId}>
                <th scope="row">Page {page.pageNumber}</th>
                <td>{readingInsightCount(page.readAttempts)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

interface SnapshotState {
  scope: string;
  report: PresentationReadingReport | null;
  loading: boolean;
  error: string;
  downloadStatus: string;
}

export function PresentationReadingInsights({
  presentationId,
  assignment,
  actorKey,
}: {
  presentationId: string;
  assignment: PresentationAssignmentMetadata;
  actorKey: string;
}) {
  const source = { presentationId, assignmentId: assignment.id, versionId: assignment.versionId };
  const scope = JSON.stringify([
    actorKey,
    presentationId.toLowerCase(),
    assignment.id.toLowerCase(),
    assignment.versionId.toLowerCase(),
  ]);
  const [state, setState] = useState<SnapshotState>({
    scope,
    report: null,
    loading: false,
    error: "",
    downloadStatus: "",
  });
  const lifetime = useRef({ scope: "", epoch: 0, blocked: true, loading: false });
  const request = useRef<AbortController | null>(null);
  const snapshot = useRef<PresentationReadingReport | null>(null);
  const releaseDownload = useRef<(() => void) | null>(null);
  useEffect(() => {
    const live = lifetime.current;
    live.scope = scope;
    live.blocked = false;
    live.loading = false;
    const clear = () => {
      live.epoch++;
      live.blocked = true;
      live.loading = false;
      request.current?.abort();
      snapshot.current = null;
      releaseDownload.current?.();
      releaseDownload.current = null;
      setState({ scope, report: null, loading: false, error: "", downloadStatus: "" });
    };
    setState({ scope, report: null, loading: false, error: "", downloadStatus: "" });
    window.addEventListener(AUTH_CHANGE_EVENT, clear);
    return () => {
      clear();
      window.removeEventListener(AUTH_CHANGE_EVENT, clear);
    };
  }, [scope]);
  const visible = state.scope === scope ? state : null;
  async function load() {
    const live = lifetime.current;
    if (live.blocked || live.scope !== scope || live.loading) return;
    request.current?.abort();
    snapshot.current = null;
    releaseDownload.current?.();
    releaseDownload.current = null;
    const controller = new AbortController(),
      epoch = ++live.epoch;
    request.current = controller;
    live.loading = true;
    setState({ scope, report: null, loading: true, error: "", downloadStatus: "" });
    try {
      const report = verifyReadingInsights(
        await fetchReadingInsights(source, controller.signal),
        source,
      );
      if (
        !controller.signal.aborted &&
        !live.blocked &&
        live.scope === scope &&
        live.epoch === epoch
      ) {
        snapshot.current = report;
        setState({ scope, report, loading: false, error: "", downloadStatus: "" });
      }
    } catch (caught) {
      if (
        !controller.signal.aborted &&
        !live.blocked &&
        live.scope === scope &&
        live.epoch === epoch
      )
        setState({
          scope,
          report: null,
          loading: false,
          error: humanError(caught),
          downloadStatus: "",
        });
    } finally {
      if (live.scope === scope && live.epoch === epoch) live.loading = false;
    }
  }
  function download() {
    const live = lifetime.current,
      report = visible?.report;
    if (
      !report ||
      snapshot.current !== report ||
      live.blocked ||
      live.loading ||
      live.scope !== scope
    )
      return;
    try {
      const csv = readingInsightsCsv(report, source);
      releaseDownload.current?.();
      releaseDownload.current = downloadReadingInsightsCsv(csv);
      setState({
        ...state,
        error: "",
        downloadStatus: "CSV download started from the displayed snapshot.",
      });
    } catch (caught) {
      setState({ ...state, error: humanError(caught), downloadStatus: "" });
    }
  }
  return (
    <section className={styles.insights} aria-labelledby="presentation-reading-insights-title">
      <h3 id="presentation-reading-insights-title">Reading insights</h3>
      <p>
        Counts are anonymous attempts, not people. Reading completion is self-reported; preview
        opens are excluded.
      </p>
      <p>
        With fewer than 5 starts, all counts are suppressed. Groups of 1–4 and counts that would
        reveal them are suppressed. Suppressed never means zero.
      </p>
      <p>
        Pages stay frozen to the assigned publication. Reports remain available for 7 days after the
        deadline, including revoked assignments.
      </p>
      <div className={sharing.controls}>
        <button type="button" disabled={!!visible?.loading} onClick={() => void load()}>
          {visible?.report
            ? "Refresh reading insights"
            : visible?.error
              ? "Retry reading insights"
              : "Load reading insights"}
        </button>
        {visible?.report ? (
          <button type="button" onClick={download}>
            Export reading CSV
          </button>
        ) : null}
      </div>
      {visible?.loading ? <p role="status">Loading reading insights…</p> : null}
      {visible?.error ? <p role="alert">{visible.error}</p> : null}
      {visible?.report ? <ReadingInsightsDetails report={visible.report} /> : null}
      <p role="status" aria-live="polite">
        {visible?.downloadStatus}
      </p>
    </section>
  );
}
