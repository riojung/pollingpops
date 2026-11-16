"use client";

import { formatNumber } from "../lib/i18n/format";
import { useLocale } from "./locale-provider";

export interface RecoveryStoryIntervention {
  id: string;
  label: string;
  startedAt?: string;
  followedByLinkedRecheck?: boolean;
  sourceReference?: string;
}

export interface RecoveryStoryModel {
  recovered: number;
  denominator: number;
  recoveryPercent: number | null;
  initialAccuracyPercent: number | null;
  initialCorrect?: number;
  initialResponses?: number;
  evidenceLabel: string;
  unresolvedCount: number;
  conceptEvidenceCount?: number;
  unresolvedNarrative: string;
  interventions: RecoveryStoryIntervention[];
  nextActionLabel: string;
  nextAction: string;
  highConfidenceWrong: number;
  correctButUnsure: number;
  smallSample: boolean;
  initialSmallSample?: boolean;
  evidenceNote: string;
  synthetic?: boolean;
}

export function RecoveryStorySummary({
  model,
  contentLanguage,
  evidenceLanguage,
}: {
  model: RecoveryStoryModel;
  contentLanguage?: string;
  evidenceLanguage?: string;
}) {
  const { locale, t } = useLocale();
  const number = (value: number) => formatNumber(locale, value);
  const percent = (value: number) =>
    formatNumber(locale, value / 100, { style: "percent", maximumFractionDigits: 1 });

  return (
    <section
      aria-label={
        model.synthetic ? t("reportRound.story.syntheticLabel") : t("reportRound.story.label")
      }
      className="recovery-story"
      data-synthetic={model.synthetic || undefined}
      data-testid="recovery-summary"
      lang={locale}
    >
      <div className="recovery-story-heading">
        <div>
          <p className="eyebrow">{t("reportRound.story.label")}</p>
          <h2>{t("reportRound.story.title")}</h2>
        </div>
        <span className="status-pill">
          {model.synthetic
            ? t("reportRound.story.syntheticEvidence")
            : t("reportRound.story.sessionEvidence")}
        </span>
      </div>
      <div className="recovery-story-grid">
        <article>
          <span>{t("reportRound.story.recovered")}</span>
          <strong>
            {model.denominator > 0
              ? t("reportRound.story.ratio", {
                  recovered: number(model.recovered),
                  total: number(model.denominator),
                })
              : t("reportRound.common.notMeasured")}
          </strong>
          <p lang={model.recoveryPercent === null ? undefined : contentLanguage}>
            {model.recoveryPercent === null
              ? t("reportRound.story.noPairedEvidence")
              : t("reportRound.story.recoveryNarrative", {
                  percent: percent(model.recoveryPercent),
                  evidence: model.evidenceLabel,
                })}
          </p>
        </article>
        <article>
          <span>{t("reportRound.story.unresolved")}</span>
          <strong>
            {model.conceptEvidenceCount === 0
              ? t("reportRound.common.notMeasured")
              : number(model.unresolvedCount)}
          </strong>
          <p lang={contentLanguage}>{model.unresolvedNarrative}</p>
        </article>
        <article>
          <span>{t("reportRound.story.facilitatorTried")}</span>
          <strong>{number(model.interventions.length)}</strong>
          <p lang={model.interventions.length ? contentLanguage : undefined}>
            {model.interventions.length
              ? model.interventions.map((item) => item.label).join(", ")
              : t("reportRound.story.noIntervention")}
          </p>
        </article>
        <article>
          <span>{t("reportRound.story.nextAction")}</span>
          <strong lang={contentLanguage}>{model.nextActionLabel}</strong>
          <p lang={contentLanguage}>{model.nextAction}</p>
        </article>
      </div>
      {model.initialSmallSample ? (
        <p className="notice">{t("reportRound.clarity.initialSmallSample")}</p>
      ) : null}
      <div className="recovery-comparison" aria-label={t("reportRound.story.comparisonLabel")}>
        <div>
          <span>{t("reportRound.story.initialAccuracy")}</span>
          <span className="recovery-bar" aria-hidden="true">
            <span style={{ width: `${model.initialAccuracyPercent ?? 0}%` }} />
          </span>
          <strong>
            {model.initialAccuracyPercent === null
              ? t("reportRound.common.notMeasured")
              : typeof model.initialCorrect === "number" &&
                  typeof model.initialResponses === "number"
                ? t("reportRound.story.accuracyRatio", {
                    correct: number(model.initialCorrect),
                    total: number(model.initialResponses),
                    percent: percent(model.initialAccuracyPercent),
                  })
                : percent(model.initialAccuracyPercent)}
          </strong>
        </div>
        <div>
          <span>{t("reportRound.story.pairedRecovery")}</span>
          <span className="recovery-bar" aria-hidden="true">
            <span style={{ width: `${model.recoveryPercent ?? 0}%` }} />
          </span>
          <strong>
            {model.recoveryPercent === null
              ? t("reportRound.common.notMeasured")
              : percent(model.recoveryPercent)}
          </strong>
        </div>
      </div>
      {model.highConfidenceWrong > 0 || model.correctButUnsure > 0 ? (
        <p className="confidence-callout">
          <strong>{t("reportRound.story.confidenceContradiction")}</strong>{" "}
          {t("reportRound.story.confidenceSummary", {
            highWrong: number(model.highConfidenceWrong),
            correctUnsure: number(model.correctButUnsure),
          })}
        </p>
      ) : null}
      {model.smallSample ? <p className="notice">{t("reportRound.story.smallSample")}</p> : null}
      {model.interventions.length ? (
        <ol
          className="intervention-timeline"
          aria-label={t("reportRound.story.interventionTimeline")}
        >
          {model.interventions.map((intervention) => (
            <li key={intervention.id}>
              <strong lang={contentLanguage}>{intervention.label}</strong>
              {intervention.sourceReference ? (
                <small lang="en-CA">{intervention.sourceReference}</small>
              ) : null}
              <span>
                {intervention.startedAt
                  ? new Date(intervention.startedAt).toLocaleTimeString(locale, {
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : model.synthetic
                    ? t("reportRound.story.syntheticAction")
                    : t("reportRound.story.timeUnavailable")}
                {intervention.followedByLinkedRecheck
                  ? ` · ${t("reportRound.story.followedByRecheck")}`
                  : ""}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
      <p className="recovery-story-evidence-note" lang={evidenceLanguage ?? contentLanguage}>
        {model.evidenceNote}
      </p>
    </section>
  );
}
