"use client";

import Link from "next/link";
import { useLocale } from "../../components/locale-provider";
import { homeOverviewCopy, formatHomeOverviewText } from "../../lib/i18n/home-overview-copy";
import type { deriveHomeInsights } from "../../lib/home-insights";
import type { HomeSummary } from "./home-model";
import { HomeIcon } from "./home-icon";
import styles from "./home.module.css";

type Insights = ReturnType<typeof deriveHomeInsights>;

export function HomeOverview({
  summary,
  insights,
  boardsAvailable,
}: {
  summary: HomeSummary;
  insights: Insights;
  boardsAvailable: boolean;
}) {
  const { locale } = useLocale();
  const copy = homeOverviewCopy(locale);
  const number = new Intl.NumberFormat(locale);
  const progress = insights.assignmentProgress;
  const percentage =
    progress.completionPercent === null
      ? null
      : new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(
          progress.completionPercent / 100,
        );
  return (
    <section className={styles.overview} aria-labelledby="home-overview-title">
      <div className={styles.overviewHeading}>
        <div>
          <h2 id="home-overview-title">{copy.overview}</h2>
          <p>{copy.scope}</p>
        </div>
        <time dateTime={summary.generatedAt}>
          {formatHomeOverviewText(copy.updated, {
            date: new Intl.DateTimeFormat(locale, {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            }).format(new Date(summary.generatedAt)),
          })}
        </time>
      </div>
      <div className={styles.widgetGrid}>
        <article
          className={styles.widget}
          data-widget="work"
          aria-labelledby="home-accessible-work-title"
        >
          <span className={styles.widgetTopline}>
            <span className={styles.widgetIcon} data-tone="violet">
              <HomeIcon name="work" />
            </span>
          </span>
          <span className={styles.widgetLabel} id="home-accessible-work-title">
            {copy.accessibleWork}
          </span>
          <strong className={styles.widgetValue}>{number.format(summary.totals.artifacts)}</strong>
          <span className={styles.widgetDescription}>{copy.workDescription}</span>
          <nav className={styles.workDestinations} aria-label={copy.accessibleWork}>
            <Link href="/library" aria-label={copy.viewLibrary} title={copy.viewLibrary}>
              <HomeIcon name="work" />
              <span>{copy.viewLibrary}</span>
            </Link>
            {boardsAvailable ? (
              <Link href="/boards" aria-label={copy.viewBoards} title={copy.viewBoards}>
                <HomeIcon name="idea_board" />
                <span>{copy.viewBoards}</span>
              </Link>
            ) : null}
          </nav>
        </article>
        <Link className={styles.widget} href="/sessions" data-widget="sessions">
          <span className={styles.widgetTopline}>
            <span className={styles.widgetIcon} data-tone="green">
              <HomeIcon name="liveSession" />
            </span>
            <HomeIcon name="arrow" />
          </span>
          <span className={styles.widgetLabel}>{copy.activeSessions}</span>
          <strong className={styles.widgetValue}>
            {number.format(summary.totals.activeSessions)}
            {insights.activeSessionsLowerBound ? "+" : ""}
          </strong>
          <span className={styles.widgetDescription}>{copy.sessionsDescription}</span>
        </Link>
        <Link className={styles.widget} href="/assignments" data-widget="assignments">
          <span className={styles.widgetTopline}>
            <span className={styles.widgetIcon} data-tone="amber">
              <HomeIcon name="assignmentClosing" />
            </span>
            <HomeIcon name="arrow" />
          </span>
          <span className={styles.widgetLabel}>{copy.recentAssignments}</span>
          <strong className={styles.widgetValue}>{percentage ?? "—"}</strong>
          <span className={styles.widgetDescription}>
            {progress.attempts
              ? formatHomeOverviewText(copy.attemptsComplete, {
                  completed: number.format(progress.completedAttempts),
                  total: number.format(progress.attempts),
                })
              : copy.noAttempts}
          </span>
          {percentage !== null ? (
            <progress
              className={styles.completionBar}
              max={100}
              value={progress.completionPercent!}
              aria-label={copy.completionLabel}
            />
          ) : null}
          <span className={styles.widgetFootnote}>{copy.recentAssignmentsNote}</span>
        </Link>
        <Link className={styles.widget} href="/results" data-widget="reports">
          <span className={styles.widgetTopline}>
            <span className={styles.widgetIcon} data-tone="neutral">
              <HomeIcon name="readyResult" />
            </span>
            <HomeIcon name="arrow" />
          </span>
          <span className={styles.widgetLabel}>{copy.readyReports}</span>
          <strong className={styles.widgetValue}>
            {number.format(insights.readyResults.length)}
          </strong>
          <span className={styles.widgetDescription}>
            {summary.resultHighlights.length
              ? formatHomeOverviewText(copy.reportsDescription, {
                  ready: number.format(insights.readyResults.length),
                  total: number.format(summary.resultHighlights.length),
                })
              : copy.noReports}
          </span>
        </Link>
      </div>
    </section>
  );
}

export function HomeNextUp({ insights }: { insights: Insights }) {
  const { locale } = useLocale();
  const copy = homeOverviewCopy(locale);
  return (
    <section className={styles.sidePanel} aria-labelledby="home-next-up-title">
      <div className={styles.sideHeading}>
        <div>
          <h2 id="home-next-up-title">{copy.nextUp}</h2>
          <p className={styles.panelDescription}>{copy.nextUpDescription}</p>
        </div>
      </div>
      {insights.actions.length ? (
        <div className={styles.insightList}>
          {insights.actions.map((action) => (
            <Link
              className={styles.insightItem}
              href={action.href}
              key={action.kind}
              data-insight={action.kind}
            >
              <span className={styles.insightIcon}>
                <HomeIcon name={action.kind} />
              </span>
              <span>
                <span className={styles.insightLabel}>{copy[action.kind]}</span>
                {action.title ? <strong lang="">{action.title}</strong> : null}
                {action.kind === "assignmentClosing" ? (
                  <small>
                    {formatHomeOverviewText(copy.closes, {
                      date: new Intl.DateTimeFormat(locale, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      }).format(new Date(action.closesAt)),
                    })}
                  </small>
                ) : null}
              </span>
              <HomeIcon name="arrow" />
            </Link>
          ))}
        </div>
      ) : (
        <div className={styles.caughtUp}>
          <span className={styles.insightIcon}>
            <HomeIcon name="readyResult" />
          </span>
          <div>
            <strong>{copy.caughtUp}</strong>
            <p>{copy.caughtUpDescription}</p>
            <Link className={styles.emptyInsightAction} href="/library">
              {copy.viewLibrary} →
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}
