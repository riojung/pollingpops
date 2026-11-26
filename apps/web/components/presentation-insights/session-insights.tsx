"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
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

const insightsTabs = [
  { id: "overview", label: "Overview" },
  { id: "delivery", label: "Delivery" },
  { id: "coverage", label: "Response coverage" },
  { id: "opinion", label: "Opinion results" },
  { id: "qna", label: "Q&A" },
] as const;
type InsightsTab = (typeof insightsTabs)[number]["id"];

function Facts({ rows, compact = false }: { rows: Array<[string, string]>; compact?: boolean }) {
  return (
    <dl className={compact ? styles.metadataFacts : styles.facts}>
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

function InsightsTable({ table }: { table: PresentationInsightsTable }) {
  const headingId = useId();
  const scale = table.visualization?.description;
  return (
    <section className={styles.tableSection} data-category={table.category}>
      <h3 id={headingId}>
        <TableTitle table={table} />
      </h3>
      {scale ? (
        <p className={styles.scale} id={`${headingId}-scale`}>
          {scale}
        </p>
      ) : null}
      <div className={styles.table} tabIndex={0} role="region" aria-labelledby={headingId}>
        <table aria-describedby={scale ? `${headingId}-scale` : undefined}>
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
                {row.map((cell, column) => {
                  const language = table.authoredCells?.[index]?.[column] ? "" : undefined;
                  if (column === 0) {
                    return (
                      <th scope="row" key={column} lang={language}>
                        {cell}
                      </th>
                    );
                  }
                  const fraction =
                    column === table.visualization?.column
                      ? table.visualization.fractions[index]
                      : null;
                  return (
                    <td key={column} lang={language}>
                      {cell}
                      {fraction != null ? (
                        <span className={styles.metricTrack} aria-hidden="true">
                          <span style={{ width: `${fraction * 100}%` }} />
                        </span>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {table.note ? <p className={styles.note}>{table.note}</p> : null}
    </section>
  );
}

export function PresentationInsightsDetails({
  insights,
  locale = "en-CA",
  activeTab,
  onSelectTab,
}: {
  insights: PresentationSessionInsights;
  locale?: SupportedLocale;
  activeTab: InsightsTab;
  onSelectTab: (tab: InsightsTab) => void;
}) {
  const tabsId = useId();
  const copy = presentationInsightsCopy(locale);
  const view = useMemo(() => {
    const copy = presentationInsightsCopy(locale);
    return presentationInsightsView(insights, locale, (key, values) =>
      copy(
        key === "Frozen session content; session additions are marked below."
          ? "Frozen session content. See Delivery for items added during this session."
          : key,
        values,
      ),
    );
  }, [insights, locale]);
  const totals = insights.delivery.totals;
  const deliveryParts = [
    { status: "presented", count: totals.presentedBlocks },
    { status: "skipped", count: totals.skippedBlocks },
    { status: "unknown", count: totals.unknownBlocks },
  ];

  function moveTabFocus(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    switch (event.key) {
      case "ArrowRight":
        next = (index + 1) % insightsTabs.length;
        break;
      case "ArrowLeft":
        next = (index + insightsTabs.length - 1) % insightsTabs.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = insightsTabs.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const id = insightsTabs[next]!.id;
    onSelectTab(id);
    event.currentTarget.ownerDocument.getElementById(`${tabsId}-tab-${id}`)?.focus();
  }

  function selectedContent() {
    if (activeTab === "overview") {
      return (
        <>
          <div className={styles.overviewFacts}>
            <Facts rows={view.facts.slice(8, 11)} />
          </div>
          <details className={styles.metadata}>
            <summary>
              {copy("Published version")} · {view.facts[0]?.[1]}
            </summary>
            <div className={styles.metadataGroups}>
              <Facts rows={[...view.facts.slice(0, 3), ...view.facts.slice(6, 8)]} compact />
              <Facts rows={view.facts.slice(3, 6)} compact />
            </div>
          </details>
          <details className={styles.notes}>
            <summary>{copy("Reading these insights")}</summary>
            <ul>
              {view.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </details>
        </>
      );
    }
    if (activeTab === "qna") {
      const asOf = insights.qna.status === "available" ? insights.qna.asOf : null;
      return (
        <section className={styles.qna}>
          <h3>{copy("Q&A outcomes")}</h3>
          {asOf ? (
            <>
              <Facts rows={view.qna.slice(0, -1)} />
              <p className={styles.snapshot}>
                {copy("Q&A data as of")} ·{" "}
                <time dateTime={asOf}>{new Date(asOf).toLocaleString(locale)}</time>
              </p>
            </>
          ) : null}
          <p className={styles.note}>{view.qnaNote}</p>
        </section>
      );
    }

    const tables = view.tables.filter((table) => table.category === activeTab);
    return (
      <>
        {activeTab === "delivery" ? (
          <section className={styles.delivery}>
            <h3>{copy("Delivery coverage")}</h3>
            <Facts rows={view.facts.slice(10)} />
            {totals.totalBlocks > 0 ? (
              <div className={styles.deliveryTrack} aria-hidden="true">
                {deliveryParts
                  .filter((part) => part.count > 0)
                  .map((part) => (
                    <span
                      key={part.status}
                      data-status={part.status}
                      style={{ flex: part.count }}
                    />
                  ))}
              </div>
            ) : null}
          </section>
        ) : null}
        {tables.map((table) => (
          <InsightsTable table={table} key={table.title} />
        ))}
        {activeTab !== "delivery" && tables.length === 0 ? (
          <p className={styles.empty}>
            {copy(
              activeTab === "opinion"
                ? "No opinion or Quick Check results are available for this session."
                : "No response coverage was recorded for this session.",
            )}
          </p>
        ) : null}
      </>
    );
  }

  return (
    <div className={styles.details} lang={locale}>
      <div className={styles.tabs} role="tablist" aria-label={copy("Session insights")}>
        {insightsTabs.map((tab, index) => (
          <button
            key={tab.id}
            id={`${tabsId}-tab-${tab.id}`}
            role="tab"
            type="button"
            aria-selected={activeTab === tab.id}
            aria-controls={`${tabsId}-panel-${tab.id}`}
            tabIndex={activeTab === tab.id ? 0 : -1}
            onClick={() => onSelectTab(tab.id)}
            onKeyDown={(event) => moveTabFocus(event, index)}
          >
            {copy(tab.label)}
          </button>
        ))}
      </div>
      {insightsTabs.map((tab) => (
        <div
          key={tab.id}
          id={`${tabsId}-panel-${tab.id}`}
          className={styles.tabPanel}
          role="tabpanel"
          aria-labelledby={`${tabsId}-tab-${tab.id}`}
          hidden={activeTab !== tab.id}
          tabIndex={activeTab === tab.id ? 0 : -1}
        >
          {activeTab === tab.id ? selectedContent() : null}
        </div>
      ))}
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
  const [activeTab, setActiveTab] = useState<InsightsTab>("overview");
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
      <div className={styles.heading}>
        <h2 id={headingId}>{copy("Session insights")}</h2>
        {current ? (
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
        ) : null}
      </div>
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
          <div className={styles.panelContext}>
            <p className={styles.snapshot}>
              {copy("Insights calculated")} ·{" "}
              <time dateTime={current.freshness.calculatedAt}>
                {new Date(current.freshness.calculatedAt).toLocaleString(locale)}
              </time>
            </p>
            <p>
              {copy("Downloaded copies cannot be revoked. Keep them within the intended audience.")}
            </p>
          </div>
          <PresentationInsightsDetails
            insights={current}
            locale={locale}
            activeTab={activeTab}
            onSelectTab={setActiveTab}
          />
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
