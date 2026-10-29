import type { CSSProperties, ReactNode } from "react";
import { useLocale } from "../../components/locale-provider";
import type { FollowupSummary, ReportSummary } from "../../components/workspace/workspace-types";
import { formatNumber } from "../../lib/i18n/format";
import type { SurveySessionSummary } from "../../lib/session-controls";
import {
  evidencePercent,
  practiceOverview,
  presentationOverview,
  roundOverview,
  surveyOverview,
  type PresentationResultSummary,
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
      <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.8">
        {kind === "presentation" ? (
          <>
            <path d="M5 6h22v15H5zM16 21v6M10 27h12" />
            <path d="m10 16 4-4 4 3 5-5" />
          </>
        ) : (
          <>
            <path d="M10 5H7v23h18V5h-3M12 3h8v5h-8zM16 14h6M16 21h6" />
            <path d="m9 14 1.5 1.5L13 12m-4 9 1.5 1.5L13 19" />
          </>
        )}
      </svg>
    </span>
  );
}

type Props = { hasMore?: boolean } & (
  | { kind: "rounds"; items: readonly ReportSummary[] }
  | { kind: "practice"; items: readonly FollowupSummary[] }
  | { kind: "presentations"; items: readonly PresentationResultSummary[] }
  | { kind: "surveys"; items: readonly SurveySessionSummary[] }
);

export function ResultsOverview(props: Props) {
  const { locale, t } = useLocale();
  const number = (value: number) => formatNumber(locale, value);
  let primary: ReactNode;
  let secondary: ReactNode;
  let distribution: Array<{ label: string; count: number; tone: string }> = [];
  let shownLabel = t("resultsOverview.shown");

  if (props.kind === "rounds") {
    const summary = roundOverview(props.items);
    distribution = [
      { label: t("pages.common.status.ready"), count: summary.ready, tone: "green" },
      { label: t("pages.common.status.processing"), count: summary.pending, tone: "yellow" },
      { label: t("pages.common.status.needsAttention"), count: summary.failed, tone: "pink" },
    ];
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
        <dt>{t("resultsOverview.followups")}</dt>
        <dd>
          {number(summary.followups)}
          <p>{t("resultsOverview.readyOnly")}</p>
        </dd>
      </>
    );
  } else if (props.kind === "practice") {
    const summary = practiceOverview(props.items);
    distribution = (["open", "scheduled", "closed", "expired"] as const).map((status, index) => ({
      label: t(`pages.common.status.${status}`),
      count: summary[status],
      tone: ["green", "yellow", "purple", "muted"][index]!,
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
      </>
    );
  } else if (props.kind === "presentations") {
    const summary = presentationOverview(props.items);
    distribution = [
      { label: t("pages.common.status.finished"), count: summary.finished, tone: "green" },
      { label: t("pages.common.status.active"), count: summary.active, tone: "yellow" },
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
        <dt>{t("resultsOverview.responses")}</dt>
        <dd>
          {number(summary.responses)}
          <p>{t("resultsOverview.responseScope")}</p>
        </dd>
      </>
    );
  } else {
    const summary = surveyOverview(props.items);
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

  return (
    <section className={styles.overview} aria-label={t("resultsOverview.title")}>
      <div className={styles.header}>
        <strong>{t("resultsOverview.title")}</strong>
        <p>{t("resultsOverview.scope")}</p>
      </div>
      <div className={styles.widgets}>
        <div className={styles.widget}>
          <dl>
            <dt>{shownLabel}</dt>
            <dd>{number(props.items.length)}</dd>
          </dl>
          {distribution.length ? (
            <div
              className={styles.distribution}
              role="group"
              aria-label={t("resultsOverview.status")}
            >
              <div className={styles.statusTrack} aria-hidden="true">
                {distribution.map((part) => (
                  <span
                    key={part.label}
                    data-tone={part.tone}
                    style={{ flex: part.count } as CSSProperties}
                  />
                ))}
              </div>
              <ul>
                {distribution.map((part) => (
                  <li key={part.label}>
                    <span data-tone={part.tone} />
                    {part.label}
                    <strong>{number(part.count)}</strong>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        <div className={styles.widget}>{primary}</div>
        <dl className={styles.widget}>{secondary}</dl>
      </div>
      {props.hasMore ? <p className={styles.more}>{t("resultsOverview.more")}</p> : null}
    </section>
  );
}
