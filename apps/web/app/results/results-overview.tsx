import type { FollowupHistoryAnalytics, ReportHistoryAnalytics } from "@openround/contracts";
import { useRef, type ReactNode } from "react";
import Link from "next/link";
import { useLocale } from "../../components/locale-provider";
import type { FollowupSummary, ReportSummary } from "../../components/workspace/workspace-types";
import {
  WorkspaceKindIcon,
  workspaceStateTone,
} from "../../components/workspace/workspace-signals";
import { formatDate, formatNumber } from "../../lib/i18n/format";
import type { SurveySessionSummary } from "../../lib/session-controls";
import {
  evidencePercent,
  practiceOverview,
  practiceTotalsOverview,
  presentationOverview,
  resultsActivity,
  roundOverview,
  surveyOverview,
  utcHistoryActivity,
  type PresentationResultSummary,
  type ResultsActivityGrouping,
  type ResultsActivityPeriod,
} from "./results-overview-model";
import styles from "./results-overview.module.css";

export function EvidenceMeter({
  label,
  value,
  detail,
  empty,
}: {
  label: string;
  value: number | null;
  detail?: string;
  empty?: string;
}) {
  const { locale, t } = useLocale();
  const percent = value === null ? null : Math.max(0, Math.min(100, value));
  const formatted =
    percent === null
      ? "—"
      : formatNumber(locale, percent / 100, {
          style: "percent",
          maximumFractionDigits: 0,
        });
  return (
    <div className={styles.evidence}>
      <div className={styles.evidenceHeading}>
        <span>{label}</span>
        <strong>{formatted}</strong>
      </div>
      {percent === null ? (
        <div className={styles.emptyTrack} aria-hidden="true" />
      ) : (
        <div
          role="meter"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-valuetext={detail ?? formatted}
          className={styles.track}
        >
          <span style={{ width: `${percent}%` }} />
        </div>
      )}
      {percent === null || detail ? (
        <small>{percent === null ? (empty ?? t("resultsOverview.noEvidence")) : detail}</small>
      ) : null}
    </div>
  );
}

export function ResultKindIcon({ kind }: { kind: "presentation" | "survey" }) {
  return (
    <span className={styles.kindIcon} data-kind={kind} aria-hidden="true">
      <WorkspaceKindIcon kind={kind} />
    </span>
  );
}

interface ActivityGroupingControls {
  grouping: ResultsActivityGrouping;
  onGroupingChange: (grouping: ResultsActivityGrouping) => void;
}

type Props = ActivityGroupingControls & { hasMore?: boolean } & (
    | {
        kind: "rounds";
        items: readonly ReportSummary[];
        analytics: ReportHistoryAnalytics | "loading" | "unavailable";
        onAnalyticsRetry: () => void;
      }
    | {
        kind: "practice";
        items: readonly FollowupSummary[];
        analytics: FollowupHistoryAnalytics | "loading" | "unavailable";
        onAnalyticsRetry: () => void;
      }
    | { kind: "presentations"; items: readonly PresentationResultSummary[] }
    | { kind: "surveys"; items: readonly SurveySessionSummary[] }
  );

interface ResultLink {
  title: string;
  date: string;
  href: string;
}

function ResultsActivity({
  periods,
  dateBasis,
  timeZone,
  empty,
  grouping,
  onGroupingChange,
}: ActivityGroupingControls & {
  periods: readonly ResultsActivityPeriod[];
  dateBasis: string;
  timeZone?: "UTC";
  empty?: string;
}) {
  const { locale, t } = useLocale();
  if (periods.length === 0 && !empty) return null;

  const max = Math.max(1, ...periods.map((period) => period.count));
  const formatter = new Intl.DateTimeFormat(locale, { month: "short", year: "numeric", timeZone });
  return (
    <section className={styles.widget} aria-label={t("resultsOverview.activity")}>
      <div className={styles.activityHeader}>
        <div>
          <h3>{t("resultsOverview.activity")}</h3>
          <p>
            {dateBasis} {periods.length ? t("resultsOverview.recentPeriods") : null}
          </p>
        </div>
        {periods.length ? (
          <label className={styles.grouping}>
            {t("resultsOverview.groupBy")}
            <select
              className="select"
              value={grouping}
              onChange={(event) =>
                onGroupingChange(event.target.value === "quarter" ? "quarter" : "month")
              }
            >
              <option value="month">{t("resultsOverview.month")}</option>
              <option value="quarter">{t("resultsOverview.quarter")}</option>
            </select>
          </label>
        ) : null}
      </div>
      {periods.length ? (
        <ul className={styles.periods} role="list">
          {periods.map((period) => (
            <li key={period.start.getTime()}>
              <span>
                {grouping === "month"
                  ? formatter.format(period.start)
                  : formatter.formatRange(period.start, period.end)}
              </span>
              <span className={styles.activityTrack} aria-hidden="true">
                <span style={{ width: `${(period.count / max) * 100}%` }} />
              </span>
              <strong>{formatNumber(locale, period.count)}</strong>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.noLinks}>{empty}</p>
      )}
    </section>
  );
}

function ResultLinks({ links, label }: { links: readonly ResultLink[]; label: string }) {
  const { locale, t } = useLocale();
  const recent = [...links].sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 3);
  return (
    <section className={styles.widget} aria-label={label}>
      <h3>{label}</h3>
      {recent.length ? (
        <ul className={styles.resultLinks} role="list">
          {recent.map(({ title, date, href }) => (
            <li key={href}>
              <Link href={href}>
                <span lang="">{title}</span>
                <span aria-hidden="true">↗</span>
              </Link>
              <time dateTime={date}>{formatDate(locale, date)}</time>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.noLinks}>{t("resultsOverview.noReadyReports")}</p>
      )}
    </section>
  );
}

export function ResultsOverview(props: Props) {
  const { locale, t } = useLocale();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const number = (value: number) => formatNumber(locale, value);
  let primary: ReactNode;
  let secondary: ReactNode;
  let dates: string[] = [];
  let links: ResultLink[];
  let dateBasis = t("resultsOverview.sessionDateBasis");
  let linksLabel = t("resultsOverview.reportsToOpen");
  let distribution: Array<{ label: string; count: number; status: string }> = [];
  let shownLabel = t("resultsOverview.shown");
  let shownCount = props.items.length;
  const isPractice = props.kind === "practice";
  const usesHistoryAnalytics = props.kind === "rounds" || isPractice;
  const analytics = usesHistoryAnalytics ? props.analytics : undefined;
  const hasFullAnalytics = typeof analytics === "object";
  const hasLoadedEvidence = !usesHistoryAnalytics || props.items.length > 0;

  if (props.kind === "rounds") {
    const summary = roundOverview(props.items);
    const statusCounts = typeof props.analytics === "object" ? props.analytics : summary;
    const ready = props.items.filter((item) => item.status === "ready");
    dateBasis = t("resultsOverview.roundDateBasis");
    links = ready.map((item) => ({
      title: item.title,
      date: item.createdAt,
      href: `/report/${item.id}?view=analytics`,
    }));
    distribution = [
      { label: t("pages.common.status.ready"), count: statusCounts.ready, status: "ready" },
      {
        label: t("pages.common.status.processing"),
        count: statusCounts.pending,
        status: "pending",
      },
      {
        label: t("pages.common.status.needsAttention"),
        count: statusCounts.failed,
        status: "failed",
      },
    ];
    if (typeof props.analytics === "object") {
      shownLabel = t("resultsOverview.matchingReports");
      shownCount = statusCounts.ready + statusCounts.pending + statusCounts.failed;
    }
    primary = (
      <>
        <p className={styles.qualifier}>{t("resultsOverview.readyOnly")}</p>
        <EvidenceMeter
          label={t("resultsOverview.recovery")}
          value={summary.recoveryPercent}
          detail={t("resultsOverview.recoveryDetail", {
            completed: number(summary.recovered),
            total: number(summary.eligible),
          })}
          empty={t("resultsOverview.noRecovery")}
        />
      </>
    );
    secondary = (
      <>
        <dt>{t("resultsOverview.participantJoins")}</dt>
        <dd>
          {summary.ready
            ? number(ready.reduce((sum, item) => sum + item.participantCount, 0))
            : "—"}
          <p>{t("resultsOverview.readyOnly")}</p>
        </dd>
        <dt className={styles.additionalMetric}>{t("resultsOverview.followups")}</dt>
        <dd>{number(summary.followups)}</dd>
      </>
    );
  } else if (props.kind === "practice") {
    const summary =
      typeof props.analytics === "object"
        ? practiceTotalsOverview(props.analytics)
        : practiceOverview(props.items);
    if (hasFullAnalytics) {
      shownLabel = t("resultsOverview.matchingPractice");
      shownCount = summary.count;
    }
    links = props.items.map((item) => ({
      title: item.title,
      date: item.createdAt,
      href: `/practice/${item.id}`,
    }));
    dateBasis = t("resultsOverview.practiceDateBasis");
    linksLabel = t("resultsOverview.practiceToOpen");
    distribution = (["open", "scheduled", "closed", "expired"] as const).map((status) => ({
      label: t(`pages.common.status.${status}`),
      count: summary[status],
      status,
    }));
    primary = (
      <EvidenceMeter
        label={t("resultsOverview.completed")}
        value={summary.percent}
        detail={t("resultsOverview.attemptDetail", {
          completed: number(summary.completed),
          total: number(summary.attempts),
        })}
        empty={t("resultsOverview.noAttempts")}
      />
    );
    secondary = (
      <>
        <dt>{t("resultsOverview.open")}</dt>
        <dd>{number(summary.open)}</dd>
        <dt className={styles.additionalMetric}>{t("resultsOverview.practiceAttempts")}</dt>
        <dd>{number(summary.attempts)}</dd>
      </>
    );
  } else if (props.kind === "presentations") {
    const summary = presentationOverview(props.items);
    dates = props.items.map((item) => item.createdAt);
    links = props.items
      .filter(
        (item) =>
          item.status === "finished" &&
          (item.reportStatus === "ready" || item.reportStatus === "pending"),
      )
      .map((item) => ({
        title: item.title,
        date: item.createdAt,
        href: `/presentation-session/${item.id}/report`,
      }));
    distribution = [
      { label: t("pages.common.status.finished"), count: summary.finished, status: "finished" },
      { label: t("pages.common.status.active"), count: summary.active, status: "active" },
    ];
    primary = (
      <EvidenceMeter
        label={t("resultsOverview.finished")}
        value={evidencePercent(summary.finished, summary.count)}
        detail={`${number(summary.finished)} / ${number(summary.count)}`}
      />
    );
    secondary = (
      <>
        <dt>{t("resultsOverview.participantJoins")}</dt>
        <dd>
          {number(summary.joins)}
          <p>{t("resultsOverview.joinScope")}</p>
        </dd>
      </>
    );
  } else {
    const summary = surveyOverview(props.items);
    dates = props.items.map((item) => item.closesAt);
    links = props.items.map((item) => ({
      title: item.title,
      date: item.closesAt,
      href: `/results/surveys/${item.id}`,
    }));
    dateBasis = t("resultsOverview.surveyDateBasis");
    shownLabel = t("resultsOverview.surveys");
    primary = (
      <dl className={styles.sourceCount}>
        <dt>{t("resultsOverview.sources")}</dt>
        <dd>{number(summary.sources)}</dd>
      </dl>
    );
    secondary = (
      <>
        <dt>{t("resultsOverview.evidence")}</dt>
        <dd className={styles.textValue}>
          {t("resultsOverview.openReport")}
          <p>{t("resultsOverview.surveyNote")}</p>
        </dd>
      </>
    );
  }

  const periods = hasFullAnalytics
    ? utcHistoryActivity(analytics.activity, props.grouping)
    : resultsActivity(dates, props.grouping);

  return (
    <section
      className={styles.overview}
      data-kind={
        props.kind === "rounds"
          ? "round"
          : props.kind === "presentations"
            ? "presentation"
            : props.kind === "surveys"
              ? "survey"
              : "practice"
      }
      aria-label={t("resultsOverview.title")}
    >
      <div className={styles.header}>
        <h2 ref={headingRef} tabIndex={usesHistoryAnalytics ? -1 : undefined}>
          {t("resultsOverview.title")}
        </h2>
        <p role={usesHistoryAnalytics ? "status" : undefined}>
          {hasFullAnalytics
            ? t(isPractice ? "resultsOverview.allPracticeScope" : "resultsOverview.allReportsScope")
            : hasLoadedEvidence
              ? t("resultsOverview.scope", { count: number(props.items.length) })
              : null}
          {props.kind === "rounds" && hasFullAnalytics && hasLoadedEvidence
            ? ` ${t("resultsOverview.loadedReportsEvidence")}`
            : null}
          {analytics === "loading"
            ? ` ${t(isPractice ? "resultsOverview.practiceAnalyticsLoading" : "resultsOverview.reportTotalsLoading")}`
            : null}
          {analytics === "unavailable"
            ? ` ${t(isPractice ? "resultsOverview.practiceAnalyticsUnavailable" : "resultsOverview.reportTotalsUnavailable")}`
            : null}
        </p>
        {usesHistoryAnalytics && analytics === "unavailable" ? (
          <button
            className="button-quiet"
            type="button"
            onClick={() => {
              headingRef.current?.focus();
              props.onAnalyticsRetry();
            }}
          >
            {t(
              isPractice
                ? "resultsOverview.retryPracticeAnalytics"
                : "resultsOverview.retryReportTotals",
            )}
          </button>
        ) : null}
      </div>
      {hasFullAnalytics || hasLoadedEvidence ? (
        <div className={styles.widgets}>
          <div className={`${styles.widget} ${styles.countWidget}`}>
            <dl>
              <dt>{shownLabel}</dt>
              <dd>{number(shownCount)}</dd>
            </dl>
            {distribution.length ? (
              <div
                className={styles.distribution}
                role="group"
                aria-label={hasFullAnalytics ? shownLabel : t("resultsOverview.status")}
              >
                <div className={styles.statusTrack} aria-hidden="true">
                  {distribution.map((part) => (
                    <span
                      key={part.label}
                      data-status={part.status}
                      data-tone={workspaceStateTone(part.status)}
                      style={{ flex: part.count }}
                    />
                  ))}
                </div>
                <ul>
                  {distribution.map((part) => (
                    <li key={part.label}>
                      <span
                        aria-hidden="true"
                        data-status={part.status}
                        data-tone={workspaceStateTone(part.status)}
                      />
                      {part.label}
                      <strong>{number(part.count)}</strong>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
          {hasLoadedEvidence || (isPractice && hasFullAnalytics) ? (
            <>
              <div className={styles.widget}>{primary}</div>
              <dl className={styles.widget}>{secondary}</dl>
            </>
          ) : null}
        </div>
      ) : null}
      {hasFullAnalytics || hasLoadedEvidence ? (
        <div className={styles.activityGrid}>
          <ResultsActivity
            periods={periods}
            dateBasis={dateBasis}
            timeZone={hasFullAnalytics ? "UTC" : undefined}
            empty={
              hasFullAnalytics
                ? t(
                    isPractice
                      ? "resultsOverview.noMatchingPracticeActivity"
                      : "resultsOverview.noMatchingReportActivity",
                  )
                : undefined
            }
            grouping={props.grouping}
            onGroupingChange={props.onGroupingChange}
          />
          {hasLoadedEvidence ? <ResultLinks label={linksLabel} links={links} /> : null}
        </div>
      ) : null}
      {props.hasMore ? (
        <p className={styles.more}>
          {t(
            props.kind === "rounds"
              ? "resultsOverview.moreRoundEvidence"
              : isPractice
                ? "resultsOverview.morePracticeItems"
                : "resultsOverview.more",
          )}
        </p>
      ) : null}
    </section>
  );
}
