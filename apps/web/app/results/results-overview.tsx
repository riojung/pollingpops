import type { CSSProperties, ReactNode } from "react";
import { useLocale } from "../../components/locale-provider";
import type { FollowupSummary, ReportSummary } from "../../components/workspace/workspace-types";
import {
  WorkspaceKindIcon,
  workspaceStateTone,
} from "../../components/workspace/workspace-signals";
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
      <WorkspaceKindIcon kind={kind} />
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
  let distribution: Array<{ label: string; count: number; status: string }> = [];
  let shownLabel = t("resultsOverview.shown");

  if (props.kind === "rounds") {
    const summary = roundOverview(props.items);
    distribution = [
      { label: t("pages.common.status.ready"), count: summary.ready, status: "ready" },
      { label: t("pages.common.status.processing"), count: summary.pending, status: "pending" },
      { label: t("pages.common.status.needsAttention"), count: summary.failed, status: "failed" },
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
      </>
    );
  } else if (props.kind === "presentations") {
    const summary = presentationOverview(props.items);
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
        <strong>{t("resultsOverview.title")}</strong>
        <p>{t("resultsOverview.scope", { count: number(props.items.length) })}</p>
      </div>
      <div className={styles.widgets}>
        <div className={`${styles.widget} ${styles.countWidget}`}>
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
                    data-status={part.status}
                    data-tone={workspaceStateTone(part.status)}
                    style={{ flex: part.count } as CSSProperties}
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
        <div className={styles.widget}>{primary}</div>
        <dl className={styles.widget}>{secondary}</dl>
      </div>
      {props.hasMore ? <p className={styles.more}>{t("resultsOverview.more")}</p> : null}
    </section>
  );
}
