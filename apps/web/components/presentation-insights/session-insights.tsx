"use client";

import { useEffect, useId, useRef, useState } from "react";
import type {
  PresentationSessionInsights,
  PresentationSessionInsightsEnvelope,
} from "@openround/contracts";
import { ApiClientError, humanError } from "../../lib/api";
import { useLocale } from "../locale-provider";
import {
  downloadPresentationInsightsFile,
  fetchPresentationSessionInsights,
  type PresentationInsightsSource,
} from "../../lib/presentation-session-insights-client";
import {
  presentationInsightsCsv,
  presentationInsightsHtml,
  presentationInsightsView,
} from "../../lib/presentation-session-insights-export";
import styles from "./insights.module.css";

function Facts({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className={styles.facts}>
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
export function PresentationInsightsDetails({
  insights,
  locale = "en-CA",
}: {
  insights: PresentationSessionInsights;
  locale?: string;
}) {
  const view = presentationInsightsView(insights, locale);
  return (
    <>
      <h3>Delivery coverage</h3>
      <Facts rows={view.facts} />
      {view.tables.map((table) => (
        <section key={table.title}>
          <h3>{table.title}</h3>
          <div className={styles.table} tabIndex={0} role="region" aria-label={table.title}>
            <table>
              <caption className="sr-only">{table.title}</caption>
              <thead>
                <tr>
                  {table.columns.map((column) => (
                    <th scope="col" key={column}>
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, index) => (
                  <tr key={index}>
                    {row.map((cell, column) =>
                      column === 0 ? (
                        <th scope="row" key={column} lang="">
                          {cell}
                        </th>
                      ) : (
                        <td key={column}>{cell}</td>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {table.note ? <p>{table.note}</p> : null}
        </section>
      ))}
      <section>
        <h3>Q&A outcomes</h3>
        <Facts rows={view.qna} />
        <p>{view.qnaNote}</p>
      </section>
      <details className={styles.notes}>
        <summary>Reading these insights</summary>
        <ul>
          {view.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </details>
    </>
  );
}

export function PresentationSessionInsightsPanel({
  source,
}: {
  source: PresentationInsightsSource;
}) {
  const headingId = useId();
  const { locale } = useLocale();
  const [data, setData] = useState<PresentationSessionInsightsEnvelope | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [downloadError, setDownloadError] = useState("");
  const [downloadStatus, setDownloadStatus] = useState("");
  const releaseDownload = useRef<(() => void) | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setLoading(true);
    setError("");
    setUnavailable(false);
    setDownloadError("");
    setDownloadStatus("");
    void fetchPresentationSessionInsights(source, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch((caught) => {
        if (controller.signal.aborted) return;
        if (caught instanceof ApiClientError && [404, 405, 501].includes(caught.status))
          setUnavailable(true);
        else
          setError(
            "Could not load session insights. The detailed report is still available below.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [source.sessionId, source.presentationId, source.presentationVersionId, attempt]);
  useEffect(() => () => releaseDownload.current?.(), []);
  const insights = data?.insights;
  const current =
    insights &&
    insights.sessionId.toLowerCase() === source.sessionId.toLowerCase() &&
    insights.presentationId.toLowerCase() === source.presentationId.toLowerCase() &&
    insights.presentationVersionId.toLowerCase() === source.presentationVersionId.toLowerCase()
      ? insights
      : null;
  function download(format: "csv" | "html") {
    if (!current) return;
    setDownloadError("");
    setDownloadStatus("");
    try {
      const contents =
        format === "csv"
          ? presentationInsightsCsv(current, locale)
          : presentationInsightsHtml(current, locale);
      releaseDownload.current?.();
      releaseDownload.current = downloadPresentationInsightsFile(contents, format);
      setDownloadStatus("Download started. Downloaded copies cannot be revoked.");
    } catch (caught) {
      setDownloadError(humanError(caught));
    }
  }
  return (
    <section className={styles.panel} aria-labelledby={headingId} lang="en-CA">
      <h2 id={headingId}>Session insights</h2>
      {loading ? <p role="status">Loading session insights…</p> : null}
      {unavailable ? (
        <p role="status">
          Additional insights are unavailable for this report. The detailed report and summary
          controls remain available.
        </p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {data?.status === "pending" ? (
        <p role="status">
          Session insights are still being reconciled. The detailed report is available below.
        </p>
      ) : null}
      {data?.status === "failed" ? (
        <p role="alert">
          Session insights could not be reconciled. The detailed report is still available below.
        </p>
      ) : null}
      {!loading && !current ? (
        <button type="button" onClick={() => setAttempt((value) => value + 1)}>
          Retry insights
        </button>
      ) : null}
      {current ? (
        <>
          <div className={styles.actions}>
            <button type="button" onClick={() => download("csv")}>
              Export coverage CSV
            </button>
            <button type="button" onClick={() => download("html")}>
              Download readable summary
            </button>
            <button type="button" onClick={() => setAttempt((value) => value + 1)}>
              Refresh insights
            </button>
          </div>
          <p>Downloaded copies cannot be revoked. Keep them within the intended audience.</p>
          <PresentationInsightsDetails insights={current} locale={locale} />
        </>
      ) : null}
      {downloadError ? <p role="alert">{downloadError}</p> : null}
      <p className={downloadStatus ? undefined : "sr-only"} role="status" aria-live="polite">
        {downloadStatus}
      </p>
    </section>
  );
}
