"use client";

import { useEffect, useId, useRef, useState } from "react";
import type {
  PresentationSessionInsights,
  PresentationSessionInsightsEnvelope,
  SupportedLocale,
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
  type PresentationInsightsTable,
} from "../../lib/presentation-session-insights-export";
import { presentationInsightsCopy } from "../../lib/i18n/presentation-insights-copy";
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
function TableTitle({ table }: { table: PresentationInsightsTable }) {
  return table.titleParts ? (
    <>
      {table.titleParts.map((part, index) => (
        <span key={index} lang={part.authored ? "" : undefined}>
          {part.text}
        </span>
      ))}
    </>
  ) : (
    table.title
  );
}
export function PresentationInsightsDetails({
  insights,
  locale = "en-CA",
}: {
  insights: PresentationSessionInsights;
  locale?: SupportedLocale;
}) {
  const copy = presentationInsightsCopy(locale);
  const view = presentationInsightsView(insights, locale, copy);
  return (
    <div lang={locale}>
      <h3>{copy("Delivery coverage")}</h3>
      <Facts rows={view.facts} />
      {view.tables.map((table) => (
        <section key={table.title}>
          <h3>
            <TableTitle table={table} />
          </h3>
          <div className={styles.table} tabIndex={0} role="region" aria-label={table.title}>
            <table>
              <caption className="sr-only">
                <TableTitle table={table} />
              </caption>
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
                        <th
                          scope="row"
                          key={column}
                          lang={table.authoredCells?.[index]?.[column] ? "" : undefined}
                        >
                          {cell}
                        </th>
                      ) : (
                        <td
                          key={column}
                          lang={table.authoredCells?.[index]?.[column] ? "" : undefined}
                        >
                          {cell}
                        </td>
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
        <h3>{copy("Q&A outcomes")}</h3>
        <Facts rows={view.qna} />
        <p>{view.qnaNote}</p>
      </section>
      <details className={styles.notes}>
        <summary>{copy("Reading these insights")}</summary>
        <ul>
          {view.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

export function PresentationSessionInsightsPanel({
  source,
  canUseEvidence = () => true,
}: {
  source: PresentationInsightsSource;
  canUseEvidence?: () => boolean;
}) {
  const headingId = useId();
  const { locale } = useLocale();
  const copy = presentationInsightsCopy(locale);
  const [data, setData] = useState<PresentationSessionInsightsEnvelope | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [downloadError, setDownloadError] = useState("");
  const [downloadStarted, setDownloadStarted] = useState(false);
  const releaseDownload = useRef<(() => void) | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setLoading(true);
    setLoadFailed(false);
    setUnavailable(false);
    setDownloadError("");
    setDownloadStarted(false);
    void fetchPresentationSessionInsights(source, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch((caught) => {
        if (controller.signal.aborted) return;
        if (caught instanceof ApiClientError && [404, 405, 501].includes(caught.status))
          setUnavailable(true);
        else setLoadFailed(true);
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
    if (!current || !canUseEvidence()) return;
    setDownloadError("");
    setDownloadStarted(false);
    try {
      const contents =
        format === "csv"
          ? presentationInsightsCsv(current, locale)
          : presentationInsightsHtml(current, locale);
      releaseDownload.current?.();
      releaseDownload.current = downloadPresentationInsightsFile(contents, format);
      setDownloadStarted(true);
    } catch (caught) {
      setDownloadError(humanError(caught));
    }
  }
  return (
    <section className={styles.panel} aria-labelledby={headingId} lang={locale}>
      <h2 id={headingId}>{copy("Session insights")}</h2>
      {loading ? <p role="status">{copy("Loading session insights…")}</p> : null}
      {unavailable ? (
        <p role="status">
          {copy(
            "Additional insights are unavailable for this report. The detailed report and summary controls remain available.",
          )}
        </p>
      ) : null}
      {loadFailed ? (
        <p role="alert">
          {copy("Could not load session insights. The detailed report is still available below.")}
        </p>
      ) : null}
      {data?.status === "pending" ? (
        <p role="status">
          {copy(
            "Session insights are still being reconciled. The detailed report is available below.",
          )}
        </p>
      ) : null}
      {data?.status === "failed" ? (
        <p role="alert">
          {copy(
            "Session insights could not be reconciled. The detailed report is still available below.",
          )}
        </p>
      ) : null}
      {!loading && !current ? (
        <button type="button" onClick={() => setAttempt((value) => value + 1)}>
          {copy("Retry insights")}
        </button>
      ) : null}
      {current ? (
        <>
          <div className={styles.actions}>
            <button type="button" onClick={() => download("csv")}>
              {copy("Export coverage CSV")}
            </button>
            <button type="button" onClick={() => download("html")}>
              {copy("Download readable summary")}
            </button>
            <button type="button" onClick={() => setAttempt((value) => value + 1)}>
              {copy("Refresh insights")}
            </button>
          </div>
          <p>
            {copy("Downloaded copies cannot be revoked. Keep them within the intended audience.")}
          </p>
          <PresentationInsightsDetails insights={current} locale={locale} />
        </>
      ) : null}
      {downloadError ? (
        <p role="alert">
          {downloadError ===
          "This summary exceeds the 1 MiB download limit. No file was downloaded." ? (
            copy("This summary exceeds the 1 MiB download limit. No file was downloaded.")
          ) : (
            <>
              {copy("Service message (original language)")}:{" "}
              <span lang="en-CA">{downloadError}</span>
            </>
          )}
        </p>
      ) : null}
      <p className={downloadStarted ? undefined : "sr-only"} role="status" aria-live="polite">
        {downloadStarted ? copy("Download started. Downloaded copies cannot be revoked.") : ""}
      </p>
    </section>
  );
}
