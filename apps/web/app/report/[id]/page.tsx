"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type {
  Entitlements,
  Followup,
  Report,
  ReportV2,
  ReportV3,
  ReportV4,
  ReportV5,
  ReportV6,
  ReportV7,
  ResponseDistribution,
  WorkspaceProductFeatures,
} from "@openround/contracts";
import { CreatorBrand } from "../../../components/brand";
import { ParticipantIdentity } from "../../../components/participant-avatar";
import { RecoveryStorySummary } from "../../../components/recovery-story";
import { recordFollowupShared } from "../../../components/workspace/product-events";
import { API_URL, AUTH_CHANGE_EVENT, apiFetch, humanError } from "../../../lib/api";
import { deriveRecoverySummary } from "../../../lib/report-summary";
import { RankingDistribution } from "../../../components/ranking-distribution";
import { TextResultsView } from "../../../components/text-results-view";
import { SessionSummaryButton } from "../../../components/session-summary/summary-dialog";
import { useLocale } from "../../../components/locale-provider";
import {
  deliveryPrimaryCopy,
  deliveryInterventionLabel,
  localizeDeliveryMessage,
} from "../../../lib/i18n/delivery-primary-copy";
import { formatDate, formatDateTime, formatNumber } from "../../../lib/i18n/format";
import { followupCopy, localizeFollowupMessage } from "../../../lib/i18n/followup-copy";

interface ReportContext {
  quizId: string;
  quizTitle: string;
  sessionCreatedAt: string;
  sessionUpdatedAt: string;
}

type ReportTab =
  "evidence" | "decision_replay" | "questions" | "participants" | "interactions" | "manage";

function RecoveryStory({
  report,
}: {
  report: ReportV2 | ReportV3 | ReportV4 | ReportV5 | ReportV6 | ReportV7;
}) {
  const { locale, t } = useLocale();
  const note = localizeDeliveryMessage(locale, report.evidenceNote);
  const summary = deriveRecoverySummary(report);
  const evidenceLabel =
    summary.evidenceTypes.length === 0
      ? t("reportRound.clarity.noRecheckEvidence")
      : summary.evidenceTypes
          .map((type) =>
            t(
              type === "linked_recheck"
                ? "reportRound.clarity.linkedRecheck"
                : "reportRound.clarity.revote",
            ),
          )
          .join(" · ");
  return (
    <RecoveryStorySummary
      contentLanguage={locale}
      evidenceLanguage={note.language}
      model={{
        recovered: summary.recovered,
        denominator: summary.denominator,
        recoveryPercent: summary.recoveryPercent,
        initialAccuracyPercent: summary.initialAccuracyPercent,
        initialCorrect: report.initialAccuracy.correct,
        initialResponses: report.initialAccuracy.responses,
        evidenceLabel,
        unresolvedCount: summary.unresolved.length,
        conceptEvidenceCount: summary.conceptEvidenceCount,
        unresolvedNarrative: summary.topUnresolved
          ? t("reportRound.clarity.unresolvedEvidence", {
              concept: summary.topUnresolved.conceptKey,
              count: formatNumber(locale, summary.topUnresolved.unresolved),
            })
          : summary.conceptEvidenceCount > 0
            ? t("reportRound.clarity.trackedConcepts", {
                count: formatNumber(locale, summary.conceptEvidenceCount),
              })
            : t("reportRound.clarity.noConceptEvidence"),
        interventions: report.interventions.map((item) => ({
          id: item.id,
          label: t(`reportRound.rehearsal.intervention.${item.type}`),
          startedAt: item.startedAt,
          followedByLinkedRecheck: Boolean(item.linkedRecheckRoundId),
          ...(item.recoveryPackCard
            ? {
                sourceReference: `Recovery Pack v${item.recoveryPackCard.packVersion} · card ${item.recoveryPackCard.cardId}`,
              }
            : {}),
        })),
        nextActionLabel: t(
          summary.unresolved.length
            ? "reportRound.clarity.targetPractice"
            : "reportRound.clarity.reviewEvidence",
        ),
        nextAction: t(
          summary.unresolved.length
            ? "reportRound.clarity.nextPractice"
            : summary.denominator > 0
              ? "reportRound.clarity.nextReview"
              : "reportRound.clarity.nextRecheck",
        ),
        highConfidenceWrong: summary.highConfidenceWrong,
        correctButUnsure: summary.correctButUnsure,
        smallSample: summary.smallSample,
        initialSmallSample: summary.initialSmallSample,
        evidenceNote: note.text,
      }}
    />
  );
}

function ReportDistribution({
  distribution,
  responses,
}: {
  distribution?: ResponseDistribution;
  responses: number;
}) {
  const { locale } = useLocale();
  const copy = deliveryPrimaryCopy(locale);
  if (!distribution) {
    return copy(responses < 5 ? "Hidden below five responses" : "Not available");
  }
  if (distribution.kind === "open_text" || distribution.kind === "word_cloud")
    return (
      <details>
        <summary>
          {copy("{count} approved respondents", {
            count: formatNumber(locale, distribution.respondents),
          })}
        </summary>
        <TextResultsView
          type={distribution.kind}
          respondents={distribution.respondents}
          items={
            distribution.kind === "open_text"
              ? distribution.entries.map((entry, index) => ({
                  answerId: String(index),
                  body: entry.value,
                }))
              : []
          }
          terms={distribution.kind === "word_cloud" ? distribution.buckets : []}
        />
      </details>
    );
  if (distribution.kind === "ranking")
    return (
      <details>
        <summary>
          {copy("{count} respondents", { count: formatNumber(locale, distribution.respondents) })}
        </summary>
        <RankingDistribution distribution={distribution} />
      </details>
    );
  if (distribution.kind === "numeric") {
    return copy("{correct} correct · {incorrect} incorrect", {
      correct: formatNumber(locale, distribution.correct),
      incorrect: formatNumber(locale, distribution.incorrect),
    });
  }
  return (
    <details>
      <summary>
        {copy("{count} respondents", { count: formatNumber(locale, distribution.respondents) })}
      </summary>
      <ul>
        {distribution.buckets.map((bucket) => (
          <li key={bucket.value}>
            <span lang="">{bucket.label}</span>: {bucket.count} ({bucket.percent}%
            {distribution.kind === "choice" && distribution.percentBasis === "respondents"
              ? ` ${copy("of respondents")}`
              : ""}
            )
          </li>
        ))}
      </ul>
    </details>
  );
}

function EvidenceSections({
  report,
}: {
  report: ReportV2 | ReportV3 | ReportV4 | ReportV5 | ReportV6 | ReportV7;
}) {
  const { locale, t } = useLocale();
  const copy = deliveryPrimaryCopy(locale);
  const note = localizeDeliveryMessage(locale, report.evidenceNote);
  const summary = deriveRecoverySummary(report);
  const recovered = summary.recovered;
  const recoveryDenominator = summary.denominator;
  return (
    <>
      <p className="notice" lang={note.language} style={{ marginBottom: 26 }}>
        {note.text}
      </p>
      <section
        className="metric-grid"
        aria-label={copy("Recovery evidence")}
        style={{ marginBottom: 26 }}
      >
        <div className="metric">
          <strong>
            {summary.initialAccuracyPercent === null
              ? t("reportRound.common.notMeasured")
              : `${formatNumber(locale, report.initialAccuracy.correct)}/${formatNumber(locale, report.initialAccuracy.responses)}`}
          </strong>
          <span>{t("reportRound.story.initialAccuracy")}</span>
        </div>
        <div className="metric">
          <strong>{report.participation.percent}%</strong>
          <span>{t("reportRound.clarity.participation")}</span>
        </div>
        <div className="metric">
          <strong>
            {recoveryDenominator > 0
              ? `${formatNumber(locale, recovered)}/${formatNumber(locale, recoveryDenominator)}`
              : t("reportRound.common.notMeasured")}
          </strong>
          <span>
            {recoveryDenominator > 0
              ? t("reportRound.story.pairedRecovery")
              : t("reportRound.clarity.noPairedResponses")}
          </span>
        </div>
        <div className="metric">
          <strong>
            {summary.conceptEvidenceCount > 0
              ? formatNumber(locale, summary.unresolved.length)
              : t("reportRound.common.notMeasured")}
          </strong>
          <span>{t("reportRound.clarity.unresolvedConcepts")}</span>
        </div>
      </section>
      {summary.initialSmallSample ? (
        <p className="notice" lang={locale}>
          {t("reportRound.clarity.initialSmallSample")}
        </p>
      ) : null}

      <section className="panel" style={{ marginBottom: 26 }}>
        <h2 style={{ fontSize: "1.7rem" }}>{copy("Recovery evidence")}</h2>
        {report.recovery.length === 0 ? (
          <p className="muted">{copy("No linked recheck or revote evidence was collected.")}</p>
        ) : (
          <div
            aria-label={copy("Recovery evidence")}
            role="region"
            style={{ overflowX: "auto" }}
            tabIndex={0}
          >
            <table className="report-table">
              <thead>
                <tr>
                  <th>{copy("Evidence")}</th>
                  <th>{copy("Recovered")}</th>
                  <th>{copy("Initially incorrect with both")}</th>
                  <th>{copy("Rate")}</th>
                  <th>{copy("Strength")}</th>
                </tr>
              </thead>
              <tbody>
                {report.recovery.map((item) => (
                  <tr key={item.recheckRoundId}>
                    <td>
                      {copy(item.evidenceType === "linked_recheck" ? "Linked recheck" : "Revote")}
                    </td>
                    <td>{item.recovered}</td>
                    <td>{item.initiallyIncorrectWithBoth}</td>
                    <td>
                      {item.recoveryPercent === null
                        ? copy("Not available")
                        : `${formatNumber(locale, item.recoveryPercent)}%`}
                    </td>
                    <td>{copy(item.smallSample ? "Small sample" : "Larger sample")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel" style={{ marginBottom: 26 }}>
        <h2 style={{ fontSize: "1.7rem" }}>{copy("Confidence and correctness")}</h2>
        <div
          aria-label={copy("Confidence and correctness")}
          role="region"
          style={{ overflowX: "auto" }}
          tabIndex={0}
        >
          <table className="report-table">
            <thead>
              <tr>
                <th>{copy("Confidence")}</th>
                <th>{t("reportRound.rehearsal.correct")}</th>
                <th>{t("reportRound.rehearsal.outcome.incorrect")}</th>
                <th>{copy("Total")}</th>
              </tr>
            </thead>
            <tbody>
              {report.confidenceMatrix.map((row) => (
                <tr key={row.confidence}>
                  <td>
                    {t(
                      (
                        [
                          "live.roundPlay.confidence.notSure",
                          "live.roundPlay.confidence.somewhat",
                          "live.roundPlay.confidence.very",
                        ] as const
                      )[row.confidence - 1]!,
                    )}
                  </td>
                  <td>{row.correct}</td>
                  <td>{row.incorrect}</td>
                  <td>{row.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {report.unresolvedConcepts.length > 0 ? (
        <section className="panel" style={{ marginBottom: 26 }}>
          <h2 style={{ fontSize: "1.7rem" }}>{copy("Concept follow-up")}</h2>
          <div
            aria-label={copy("Concept follow-up")}
            role="region"
            style={{ overflowX: "auto" }}
            tabIndex={0}
          >
            <table className="report-table">
              <thead>
                <tr>
                  <th>{copy("Concept")}</th>
                  <th>{copy("Initially incorrect")}</th>
                  <th>{copy("Recovered")}</th>
                  <th>{copy("Unresolved")}</th>
                </tr>
              </thead>
              <tbody>
                {report.unresolvedConcepts.map((concept) => (
                  <tr key={concept.conceptKey}>
                    <td lang="">{concept.conceptKey}</td>
                    <td>{concept.initiallyIncorrect}</td>
                    <td>{concept.recovered}</td>
                    <td>{concept.unresolved}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {report.misconceptions.length > 0 ? (
        <section className="panel" style={{ marginBottom: 26 }}>
          <h2 style={{ fontSize: "1.7rem" }}>{copy("Observed misconceptions")}</h2>
          <ul>
            {report.misconceptions.map((item) => (
              <li key={`${item.questionId}:${item.key}`}>
                <strong lang="">{item.key}</strong>:{" "}
                {copy("{responses} responses · {all}% of all · {wrong}% of incorrect responses", {
                  responses: formatNumber(locale, item.responses),
                  all: formatNumber(locale, item.allResponsePercent),
                  wrong: formatNumber(locale, item.wrongResponsePercent),
                })}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function DecisionTimeline({ report }: { report: ReportV4 | ReportV5 | ReportV6 | ReportV7 }) {
  const { locale, t } = useLocale();
  const copy = deliveryPrimaryCopy(locale);
  const labelForEvent = (event: ReportV4["decisionTimeline"][number]) => {
    switch (event.type) {
      case "insight_shown":
        return (
          <>
            {copy("Facilitator insight")}: <span lang="">{event.recommendationCode}</span> (
            {formatNumber(locale, event.sampleSize)}/
            {formatNumber(locale, event.activeParticipantCount)} ·{" "}
            <span lang="">{event.ruleSetVersion}</span>)
          </>
        );
      case "answer_revealed":
        return t("live.roundPlay.answerRevealed");
      case "intervention_started":
        return copy("{type} started", {
          type: deliveryInterventionLabel(locale, event.interventionType),
        });
      case "intervention_finished":
        return copy("{type} finished", {
          type: deliveryInterventionLabel(locale, event.interventionType),
        });
      case "recheck_opened":
        return copy(event.kind === "linked_recheck" ? "Linked recheck opened" : "Revote opened");
      case "question_advanced":
        return copy("Advanced to the next question");
      case "session_finished":
        return copy(
          event.reason === "completed" ? "Session completed" : "Session ended by facilitator",
        );
      case "capture_truncated":
        return copy("Replay capture reached its event limit");
    }
  };

  return (
    <section
      aria-labelledby="decision-replay-heading"
      className="panel"
      style={{ marginBottom: 26 }}
    >
      <p className="eyebrow">{copy("Decision replay")}</p>
      <h2 id="decision-replay-heading" style={{ fontSize: "1.7rem" }}>
        {copy("Facilitator decisions")}
      </h2>
      <p className="muted">
        {copy(
          "This timeline records retained session events. It does not establish a causal learning outcome.",
        )}
      </p>
      {!report.decisionReplayAvailable ? (
        <p className="notice">{copy("No decision timeline is available for this session.")}</p>
      ) : null}
      {report.decisionReplayAvailable && !report.decisionReplayComplete ? (
        <p className="notice" role="status">
          {copy("Partial timeline: some events could not be retained.")}
        </p>
      ) : null}
      {report.decisionReplayAvailable ? (
        <ol>
          {report.decisionTimeline.map((event) => (
            <li key={event.seq}>
              <time dateTime={event.occurredAt}>
                {new Date(event.occurredAt).toLocaleString(locale)}
              </time>
              {" — "}
              {labelForEvent(event)}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

function InteractionEvidenceSections({
  report,
  transcriptExport,
  uxBeta,
}: {
  report: ReportV3 | ReportV4 | ReportV5 | ReportV6 | ReportV7;
  transcriptExport: boolean;
  uxBeta: boolean;
}) {
  const { locale, t } = useLocale();
  const copy = deliveryPrimaryCopy(locale);
  return (
    <section className="panel" style={{ marginBottom: 26 }}>
      <div className="page-heading" style={{ marginBottom: 18 }}>
        <div>
          <p className="eyebrow">{t("live.audience.signalsAndConversation")}</p>
          <h2 style={{ fontSize: "1.7rem" }}>{copy("Pulse and conversation evidence")}</h2>
        </div>
        <span className="status-pill">
          {report.experience.preset.id} · {report.experience.category.replaceAll("_", " ")}
        </span>
      </div>
      <div className="metric-grid" style={{ marginBottom: 18 }}>
        <div className="metric">
          <strong>{report.audiencePulse.uniqueParticipants}</strong>
          <span>{copy("people signaled")}</span>
        </div>
        <div className="metric">
          <strong>{report.audiencePulse.events}</strong>
          <span>{copy("pulse changes")}</span>
        </div>
        <div className="metric">
          <strong>{report.conversation.messages}</strong>
          <span>{copy("chat messages")}</span>
        </div>
        <div className="metric">
          <strong>{report.conversation.uniqueContributors}</strong>
          <span>{copy("chat contributors")}</span>
        </div>
      </div>
      <p className="muted">
        {copy(
          "{reactions} reactions · {reports} reports · {removed} removals · peak {peak} messages per minute",
          {
            reactions: formatNumber(locale, report.conversation.reactions),
            reports: formatNumber(locale, report.conversation.reports),
            removed: formatNumber(locale, report.conversation.removed),
            peak: formatNumber(locale, report.conversation.peakMessagesPerMinute),
          },
        )}
      </p>
      {report.audiencePulse.contexts.length ? (
        <div className="table-wrap" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th>{t("live.audience.roomSignals")}</th>
                <th>{t("live.common.participants")}</th>
                <th>{t("live.audience.signal.got_it")}</th>
                <th>{t("live.audience.signal.unsure")}</th>
                <th>{t("live.audience.signal.need_example")}</th>
                <th>{t("live.audience.signal.too_fast")}</th>
              </tr>
            </thead>
            <tbody>
              {report.audiencePulse.contexts.map((context) => (
                <tr key={context.contextKey}>
                  <td>
                    {context.contextKey.startsWith("intervention:")
                      ? t("live.host.phase.intervention")
                      : context.contextKey === "lobby"
                        ? t("live.host.phase.lobby")
                        : uxBeta
                          ? `${t("reportRound.common.question")} / ${t("live.host.step.recheck")}`
                          : `${t("live.roundSetup.item.checkpoint")} / ${t("live.host.step.recheck")}`}
                  </td>
                  <td>{context.uniqueParticipants}</td>
                  <td>{context.bySignal.got_it}</td>
                  <td>{context.bySignal.unsure}</td>
                  <td>{context.bySignal.need_example}</td>
                  <td>{context.bySignal.too_fast}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {report.conversation.transcriptAvailable ? (
        <div className="button-row">
          <a className="button-quiet" href={`${API_URL}/v1/reports/${report.id}/interactions`}>
            {copy("Open authorized transcript")}
          </a>
          {transcriptExport ? (
            <a
              className="button-quiet"
              href={`${API_URL}/v1/reports/${report.id}/interactions.csv`}
            >
              {copy("Download interaction CSV")}
            </a>
          ) : null}
        </div>
      ) : (
        <p className="muted">{copy("No retained room conversation was collected.")}</p>
      )}
    </section>
  );
}

interface FollowupAccessView {
  id: string;
  kind: "personal" | "accommodation";
  participantId: string | null;
  nickname: string | null;
  label: string;
  timeMultiplier: 1 | 1.5 | 2;
  expiresAt: string;
  revokedAt: string | null;
  url?: string;
}

interface CreatedFollowup {
  followup: Followup;
  genericUrl: string;
  personalAccess: FollowupAccessView[];
}

function localDateTimeValue(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function csvCell(value: string) {
  const protectedValue = /^(?:\s*[=+@-]|[\t\r\n])/.test(value) ? `'${value}` : value;
  return `"${protectedValue.replaceAll('"', '""')}"`;
}

function FollowupBuilder({
  report,
  entitlement,
  initialFollowup,
  uxBeta,
  canEdit,
  mayManage,
}: {
  report: ReportV2 | ReportV3 | ReportV4 | ReportV5 | ReportV6 | ReportV7;
  entitlement: boolean;
  initialFollowup: Followup | null;
  uxBeta: boolean;
  canEdit: boolean;
  mayManage: () => boolean;
}) {
  const { locale, t } = useLocale();
  const copy = deliveryPrimaryCopy(locale);
  const secondary = followupCopy(locale);
  const unresolved = report.unresolvedConcepts.filter((concept) => concept.unresolved > 0);
  const [followup, setFollowup] = useState(initialFollowup);
  const [selected, setSelected] = useState(() => unresolved.map((concept) => concept.conceptKey));
  const [timeMode, setTimeMode] = useState<"flex" | "timed">("flex");
  const maximumClose = new Date(new Date(report.expiresAt).getTime() - 60_000);
  const suggestedClose = new Date(
    Math.min(Date.now() + 7 * 24 * 60 * 60_000, maximumClose.getTime()),
  );
  const [closesAt, setClosesAt] = useState(localDateTimeValue(suggestedClose));
  const [access, setAccess] = useState<FollowupAccessView[]>([]);
  const [created, setCreated] = useState<CreatedFollowup | null>(null);
  // Null means the generated default is still untouched. User input remains authored text.
  const [passLabel, setPassLabel] = useState<string | null>(null);
  const displayedPassLabel = passLabel ?? secondary("Extended time");
  const [passMultiplier, setPassMultiplier] = useState<1.5 | 2>(1.5);
  const [latestPass, setLatestPass] = useState<FollowupAccessView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [shareStatus, setShareStatus] = useState<"downloaded" | "generic" | "private" | null>(null);
  const [accessLoading, setAccessLoading] = useState(Boolean(initialFollowup));
  const [accessError, setAccessError] = useState("");
  const [accessLoadRevision, setAccessLoadRevision] = useState(0);
  const ended = Boolean(
    followup && (followup.closedAt || Date.parse(followup.closesAt) <= Date.now()),
  );
  const retentionExpired = maximumClose.getTime() <= Date.now();

  useEffect(() => {
    if (!followup) return;
    let cancelled = false;
    setAccessLoading(true);
    setAccessError("");
    void apiFetch<{ access: FollowupAccessView[] }>(`/v1/followups/${followup.id}`)
      .then((result) => {
        if (!cancelled) setAccess(result.access);
      })
      .catch((caught) => {
        if (!cancelled) setAccessError(humanError(caught));
      })
      .finally(() => {
        if (!cancelled) setAccessLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [followup, accessLoadRevision]);

  async function createFollowup(event: FormEvent) {
    event.preventDefault();
    if (!canEdit || !mayManage() || !entitlement || retentionExpired || busy) return;
    setBusy(true);
    setError("");
    setShareStatus(null);
    try {
      const result = await apiFetch<CreatedFollowup>(`/v1/reports/${report.id}/followups`, {
        method: "POST",
        body: JSON.stringify({
          conceptKeys: selected,
          timeMode,
          closesAt: new Date(closesAt).toISOString(),
        }),
      });
      setFollowup(result.followup);
      setCreated(result);
      setAccess(result.personalAccess);
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function createPass(event: FormEvent) {
    event.preventDefault();
    if (!followup || !canEdit || !mayManage() || ended || busy) return;
    setBusy(true);
    setError("");
    setShareStatus(null);
    try {
      const result = await apiFetch<{ access: FollowupAccessView }>(
        `/v1/followups/${followup.id}/accommodation-passes`,
        {
          method: "POST",
          body: JSON.stringify({ label: displayedPassLabel, timeMultiplier: passMultiplier }),
        },
      );
      setLatestPass(result.access);
      setAccess((current) => [...current, result.access]);
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(accessId: string) {
    if (
      !followup ||
      !canEdit ||
      !mayManage() ||
      busy ||
      !window.confirm(secondary("Revoke this follow-up pass? Its attempt will stop working."))
    ) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await apiFetch(`/v1/followups/${followup.id}/access/${accessId}`, { method: "DELETE" });
      setAccess((current) =>
        current.map((item) =>
          item.id === accessId ? { ...item, revokedAt: new Date().toISOString() } : item,
        ),
      );
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function closeFollowup() {
    if (
      !followup ||
      !canEdit ||
      !mayManage() ||
      busy ||
      !window.confirm(secondary("Close this follow-up for every participant?"))
    )
      return;
    setBusy(true);
    setError("");
    try {
      await apiFetch(`/v1/followups/${followup.id}/close`, { method: "POST", body: "{}" });
      setFollowup({ ...followup, closedAt: new Date().toISOString() });
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusy(false);
    }
  }

  function downloadLinks() {
    if (!created) return;
    const rows = [
      ["access", "participant", "link"],
      ["generic", "Anonymous", created.genericUrl],
      ...created.personalAccess.map((item) => [
        "personal",
        item.nickname ?? item.label,
        item.url ?? "",
      ]),
    ];
    const blob = new Blob([rows.map((row) => row.map(csvCell).join(",")).join("\r\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `polling-pops-followup-${created.followup.id}-links.csv`;
    document.body.append(link);
    link.click();
    recordFollowupShared();
    setShareStatus("downloaded");
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function copyGenericLink() {
    if (!created) return;
    setShareStatus(null);
    setError("");
    try {
      await navigator.clipboard.writeText(created.genericUrl);
      recordFollowupShared();
      setShareStatus("generic");
    } catch {
      setError("Copy was blocked. Select and copy the link instead.");
    }
  }

  async function copyPrivateLink() {
    if (!latestPass?.url) return;
    setShareStatus(null);
    setError("");
    try {
      await navigator.clipboard.writeText(latestPass.url);
      setShareStatus("private");
      setError("");
    } catch {
      setError("Copy was blocked. Select and copy the link instead.");
    }
  }

  const errorMessage =
    error === "Copy was blocked. Select and copy the link instead."
      ? { text: t("reportRound.assign.copyBlocked"), language: locale }
      : localizeFollowupMessage(locale, error);
  if (!unresolved.length) return null;
  return (
    <section className="panel" style={{ marginBottom: 26 }} aria-labelledby="followup-heading">
      <p className="eyebrow">{copy("Continue the recovery loop")}</p>
      <h2 id="followup-heading" style={{ fontSize: "1.7rem" }}>
        {copy("Self-paced follow-up")}
      </h2>
      {entitlement && followup && !canEdit ? (
        <p className="notice">
          {secondary("An owner or editor must create or manage follow-up access.")}
        </p>
      ) : null}
      {!entitlement ? (
        <p className="notice">
          {secondary(
            "Signed follow-up links and private feedback are available with Hosted Pro and in the Community edition.",
          )}{" "}
          <Link href="/pricing">{secondary("Compare editions")}</Link>.
        </p>
      ) : followup ? (
        <>
          <p>
            <strong lang="">{followup.title}</strong>{" "}
            {secondary(
              uxBeta
                ? "Questions: {count}. Closes on {date}."
                : "Checkpoints: {count}. Closes on {date}.",
              {
                count: formatNumber(locale, followup.checkpointCount),
                date: formatDateTime(locale, followup.closesAt),
              },
            )}
          </p>
          <p className="muted">
            {followup.timeMode === "flex"
              ? secondary("Time-flex mode has no countdown.")
              : secondary(
                  uxBeta
                    ? "Standard question timers are enforced by the server."
                    : "Standard checkpoint timers are enforced by the server.",
                )}{" "}
            {followup.closedAt
              ? secondary("This follow-up is closed.")
              : ended
                ? secondary("This follow-up has expired")
                : secondary("Links remain revocable.")}
          </p>
          {created ? (
            <div className="notice">
              <strong>{secondary("Save these links now.")}</strong>{" "}
              {secondary(
                "Polling Pops stores only token hashes and cannot show the same links again.",
              )}
              <div className="field" style={{ marginTop: 12 }}>
                <label htmlFor="followup-generic-url">{t("reportRound.assign.genericLink")}</label>
                <div className="toolbar">
                  <input
                    id="followup-generic-url"
                    className="input"
                    readOnly
                    value={created.genericUrl}
                  />
                  <button
                    className="button-quiet small-button"
                    onClick={() => void copyGenericLink()}
                    type="button"
                  >
                    {t("reportRound.assign.copy")}
                  </button>
                </div>
              </div>
              <button className="button-quiet small-button" onClick={downloadLinks} type="button">
                {t("reportRound.assign.downloadCsv")}
              </button>
            </div>
          ) : (
            <p className="notice">
              {secondary(
                canEdit && !ended
                  ? "Access links were shown once when this follow-up was created. Create an accommodation pass below if a new individual link is needed."
                  : "Access links were shown once when this follow-up was created.",
              )}
            </p>
          )}

          {canEdit && !ended ? (
            <form onSubmit={createPass} className="toolbar" style={{ marginTop: 20 }}>
              <label className="field" style={{ flex: "1 1 220px" }}>
                <span>{secondary("Accommodation pass label")}</span>
                <input
                  className="input"
                  lang=""
                  maxLength={80}
                  onChange={(event) => setPassLabel(event.target.value)}
                  required
                  value={displayedPassLabel}
                />
              </label>
              <label className="field">
                <span>{secondary("Time allowance")}</span>
                <select
                  className="select"
                  onChange={(event) => setPassMultiplier(Number(event.target.value) as 1.5 | 2)}
                  value={passMultiplier}
                >
                  <option value={1.5}>{formatNumber(locale, 1.5)}×</option>
                  <option value={2}>{formatNumber(locale, 2)}×</option>
                </select>
              </label>
              <button className="button-quiet" disabled={busy} type="submit">
                {secondary("Create private pass")}
              </button>
            </form>
          ) : null}
          {latestPass?.url ? (
            <div className="notice">
              <strong>{secondary("Save this new pass now:")}</strong>
              <label className="field-label" htmlFor="followup-private-url">
                {secondary("Private follow-up pass link")}
              </label>
              <div className="toolbar" style={{ marginTop: 8 }}>
                <input
                  id="followup-private-url"
                  className="input"
                  readOnly
                  value={latestPass.url}
                />
                <button
                  className="button-quiet small-button"
                  onClick={() => void copyPrivateLink()}
                  type="button"
                >
                  {t("reportRound.assign.copy")}
                </button>
              </div>
            </div>
          ) : null}
          {shareStatus ? (
            <p aria-live="polite" className="success" role="status">
              {shareStatus === "private"
                ? secondary("Private pass link copied.")
                : copy(
                    shareStatus === "downloaded"
                      ? "Follow-up links downloaded."
                      : "Generic follow-up link copied.",
                  )}
            </p>
          ) : null}
          {accessLoading ? <p role="status">{secondary("Loading access passes…")}</p> : null}
          {accessError ? (
            <div>
              <p
                className="error"
                role="alert"
                lang={localizeFollowupMessage(locale, accessError).language}
              >
                {localizeFollowupMessage(locale, accessError).text}
              </p>
              <button
                className="button-quiet"
                disabled={accessLoading}
                onClick={() => setAccessLoadRevision((revision) => revision + 1)}
                type="button"
              >
                {secondary("Retry loading access passes")}
              </button>
            </div>
          ) : null}
          {!accessLoading && !accessError && !access.length ? (
            <p className="muted">{secondary("No individual access passes have been created.")}</p>
          ) : null}
          {access.length ? (
            <div
              style={{ overflowX: "auto" }}
              role="region"
              aria-label={secondary("Follow-up access passes")}
              tabIndex={0}
            >
              <table className="report-table">
                <thead>
                  <tr>
                    <th>{secondary("Pass")}</th>
                    <th>{secondary("Time")}</th>
                    <th>{secondary("Status")}</th>
                    <th>{secondary("Action")}</th>
                  </tr>
                </thead>
                <tbody>
                  {access.map((item) => (
                    <tr key={item.id}>
                      <td lang="">{item.nickname ?? item.label}</td>
                      <td>{formatNumber(locale, item.timeMultiplier)}×</td>
                      <td>
                        {secondary(
                          item.revokedAt
                            ? "Revoked"
                            : followup.closedAt
                              ? "Closed"
                              : ended || Date.parse(item.expiresAt) <= Date.now()
                                ? "Expired"
                                : "Active",
                        )}
                      </td>
                      <td>
                        {canEdit && !item.revokedAt && !followup.closedAt ? (
                          <button
                            className="danger-link"
                            disabled={busy}
                            onClick={() => void revoke(item.id)}
                            type="button"
                          >
                            {secondary("Revoke")}
                          </button>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {canEdit && !followup.closedAt ? (
            <button
              className="danger-link"
              disabled={busy}
              onClick={() => void closeFollowup()}
              type="button"
            >
              {secondary("Close follow-up for everyone")}
            </button>
          ) : null}
        </>
      ) : !canEdit ? (
        <p className="notice">
          {secondary("An owner or editor must create or manage follow-up access.")}
        </p>
      ) : retentionExpired ? (
        <p className="notice">
          {secondary(
            Date.parse(report.expiresAt) <= Date.now()
              ? "The report retention deadline has passed. A new follow-up cannot be created."
              : "One minute or less remains before the report retention deadline. A new follow-up cannot be created.",
          )}
        </p>
      ) : (
        <form onSubmit={createFollowup}>
          <p>
            {copy(
              "Select unresolved concepts to include. Linked rechecks are used when available.",
            )}
          </p>
          <fieldset className="choice-list">
            <legend className="sr-only">{t("reportRound.clarity.unresolvedConcepts")}</legend>
            {unresolved.map((concept) => (
              <label className="choice-row" key={concept.conceptKey}>
                <input
                  checked={selected.includes(concept.conceptKey)}
                  onChange={(event) =>
                    setSelected((current) =>
                      event.target.checked
                        ? [...current, concept.conceptKey]
                        : current.filter((key) => key !== concept.conceptKey),
                    )
                  }
                  type="checkbox"
                />
                <span>
                  <strong lang="">{concept.conceptKey}</strong> —{" "}
                  {formatNumber(locale, concept.unresolved)} {copy("Unresolved")}
                </span>
              </label>
            ))}
          </fieldset>
          <div className="toolbar">
            <label className="field">
              <span>{t("reportRound.assign.timing")}</span>
              <select
                className="select"
                onChange={(event) => setTimeMode(event.target.value as "flex" | "timed")}
                value={timeMode}
              >
                <option value="flex">{t("reportRound.assign.timeFlex")}</option>
                <option value="timed">{t("reportRound.assign.useTimers")}</option>
              </select>
            </label>
            <label className="field">
              <span>{t("reportRound.assign.closeDate")}</span>
              <input
                className="input"
                max={localDateTimeValue(maximumClose)}
                min={localDateTimeValue(new Date())}
                onChange={(event) => setClosesAt(event.target.value)}
                required
                type="datetime-local"
                value={closesAt}
              />
            </label>
          </div>
          <p className="muted">
            {secondary("Choose a close time before the report retention deadline: {date}.", {
              date: formatDateTime(locale, report.expiresAt),
            })}
          </p>
          <button className="button" disabled={busy || selected.length === 0} type="submit">
            {busy ? t("reportRound.assign.creating") : copy("Create follow-up and links")}
          </button>
        </form>
      )}
      {error ? (
        <p className="error" role="alert" lang={errorMessage.language}>
          {errorMessage.text}
        </p>
      ) : null}
    </section>
  );
}

function ReportReturnLink() {
  const { locale, t } = useLocale();
  return (
    <Link className="button-quiet small-button" href="/results" lang={locale}>
      {t("reportRound.clarity.backToResults")}
    </Link>
  );
}

function ReportIdentity({ context }: { context: ReportContext | null }) {
  const { locale, t } = useLocale();
  return (
    <div lang={locale}>
      <p className="eyebrow">{t("reportRound.clarity.sessionReport")}</p>
      <h1 lang={context?.quizTitle ? "" : locale}>
        {context?.quizTitle || t("reportRound.story.title")}
      </h1>
      {context ? (
        <p className="muted">
          <time dateTime={context.sessionCreatedAt}>
            {formatDate(locale, context.sessionCreatedAt)}
          </time>
        </p>
      ) : null}
    </div>
  );
}

export default function ReportPage() {
  const { locale, t } = useLocale();
  const copy = deliveryPrimaryCopy(locale);
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [report, setReport] = useState<Report | null>(null);
  const [context, setContext] = useState<ReportContext | null>(null);
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);
  const [followup, setFollowup] = useState<Followup | null>(null);
  const [productFeatures, setProductFeatures] = useState<Pick<
    WorkspaceProductFeatures,
    "uxBeta" | "workspaceShell"
  > | null>(null);
  const [activeTab, setActiveTab] = useState<ReportTab>("evidence");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [canEdit, setCanEdit] = useState(false);
  const [canDelete, setCanDelete] = useState(false);
  const [authContextRevision, setAuthContextRevision] = useState(0);
  const authority = useRef({ canEdit: false, canDelete: false, generation: 0 });

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const generation = authority.current.generation;
    const load = async () => {
      try {
        const response = await apiFetch<{
          report: Report;
          entitlements: Entitlements;
          followup: Followup | null;
          context?: ReportContext;
        }>(`/v1/reports/${id}`);
        if (cancelled || generation !== authority.current.generation) return;
        setReport(response.report);
        setContext(response.context ?? null);
        setEntitlements(response.entitlements);
        setFollowup(response.followup);
        setError("");
        if (response.report.status === "pending") retryTimer = setTimeout(load, 1_500);
      } catch (caught) {
        if (cancelled || generation !== authority.current.generation) return;
        if ((caught as { status?: number }).status === 401) router.replace("/signin");
        else setError(humanError(caught));
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [id, router, authContextRevision]);

  useEffect(() => {
    let cancelled = false;
    const generation = authority.current.generation;
    const current = () => !cancelled && generation === authority.current.generation;
    void apiFetch<{
      productFeatures: Pick<WorkspaceProductFeatures, "uxBeta" | "workspaceShell">;
      creator: { role: "owner" | "editor" | "viewer" };
    }>("/v1/auth/me")
      .then((account) => {
        if (!current()) return;
        const editable = account.creator?.role === "owner" || account.creator?.role === "editor";
        const deletable = account.creator?.role === "owner";
        authority.current.canEdit = editable;
        authority.current.canDelete = deletable;
        setProductFeatures(account.productFeatures);
        setCanEdit(editable);
        setCanDelete(deletable);
      })
      .catch(() => {
        if (!current()) return;
        authority.current.canEdit = false;
        authority.current.canDelete = false;
        setProductFeatures(null);
        setCanEdit(false);
        setCanDelete(false);
      });
    const refreshContext = () => {
      authority.current = {
        canEdit: false,
        canDelete: false,
        generation: authority.current.generation + 1,
      };
      setCanEdit(false);
      setCanDelete(false);
      setProductFeatures(null);
      setReport(null);
      setContext(null);
      setEntitlements(null);
      setFollowup(null);
      setError("");
      setAuthContextRevision((revision) => revision + 1);
    };
    window.addEventListener(AUTH_CHANGE_EVENT, refreshContext);
    window.addEventListener("polling-pops:workspace-updated", refreshContext);
    return () => {
      cancelled = true;
      window.removeEventListener(AUTH_CHANGE_EVENT, refreshContext);
      window.removeEventListener("polling-pops:workspace-updated", refreshContext);
    };
  }, [id, authContextRevision]);

  const uxBeta = productFeatures?.uxBeta === true;
  const showResponseDistributions =
    uxBeta || report?.questions.some((question) => question.correct === null) === true;

  const evidence =
    report?.schemaVersion === 2 ||
    report?.schemaVersion === 3 ||
    report?.schemaVersion === 4 ||
    report?.schemaVersion === 5 ||
    report?.schemaVersion === 6 ||
    report?.schemaVersion === 7
      ? report
      : null;
  const detailTabs: { id: ReportTab; label: string }[] = [
    ...(evidence ? [{ id: "evidence" as const, label: copy("Evidence") }] : []),
    ...(report?.schemaVersion === 4 ||
    report?.schemaVersion === 5 ||
    report?.schemaVersion === 6 ||
    report?.schemaVersion === 7
      ? [{ id: "decision_replay" as const, label: copy("Decision replay") }]
      : []),
    ...(report?.schemaVersion === 3 ||
    report?.schemaVersion === 4 ||
    report?.schemaVersion === 5 ||
    report?.schemaVersion === 6 ||
    report?.schemaVersion === 7
      ? [{ id: "interactions" as const, label: t("live.audience.conversation") }]
      : []),
    { id: "questions", label: copy("Questions") },
    { id: "participants", label: t("live.common.participants") },
    ...(uxBeta ? [{ id: "manage" as const, label: copy("Manage data") }] : []),
  ];
  const selectedTab = detailTabs.some((tab) => tab.id === activeTab)
    ? activeTab
    : detailTabs[0]?.id;

  function moveTabFocus(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % detailTabs.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + detailTabs.length) % detailTabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = detailTabs.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextTab = detailTabs[nextIndex];
    if (!nextTab) return;
    setActiveTab(nextTab.id);
    document.getElementById(`report-tab-${nextTab.id}`)?.focus();
  }

  async function deleteSession() {
    if (
      !report ||
      !authority.current.canDelete ||
      !window.confirm(copy("Delete this session, its answers, and this report?"))
    )
      return;
    setDeleting(true);
    setError("");
    try {
      await apiFetch(`/v1/sessions/${report.sessionId}`, { method: "DELETE" });
      router.replace("/results");
    } catch (caught) {
      setError(humanError(caught));
      setDeleting(false);
    }
  }

  return (
    <>
      <header className="shell topbar" lang={locale}>
        <CreatorBrand productFeatures={productFeatures} />
        <ReportReturnLink />
      </header>
      <main className="shell page-main" id="main" lang={locale}>
        <div className="page-heading">
          <ReportIdentity context={context} />
          <div className="button-row">
            {report?.status === "ready" ? (
              <SessionSummaryButton source={{ kind: "round", id: report.sessionId }} />
            ) : null}
            {!uxBeta && report?.status === "ready" && entitlements?.csvExport ? (
              <div className="button-row">
                <a className="button" href={`${API_URL}/v1/reports/${id}.csv`}>
                  {copy("Download CSV")}
                </a>
                <a className="button-quiet" href={`${API_URL}/v1/reports/${id}.json`}>
                  {copy("Download JSON")}
                </a>
              </div>
            ) : !uxBeta && report && entitlements ? (
              <Link className="button-quiet" href="/pricing">
                {copy("CSV was not included for this room")}
              </Link>
            ) : null}
          </div>
        </div>
        {error ? (
          <p className="error" role="alert">
            <span>{copy("Service message")}: </span>
            <span lang="en-CA">{error}</span>
          </p>
        ) : null}
        {!report && !error ? <p>{copy("Loading report…")}</p> : null}
        {report?.status === "pending" ? (
          <section className="panel" aria-live="polite">
            <p className="eyebrow">{copy("Building evidence")}</p>
            <h2>{copy("Your report is being generated")}</h2>
            <p className="muted">
              {copy(
                "This page refreshes automatically while responses, interventions, and rechecks are reconciled.",
              )}
            </p>
          </section>
        ) : null}
        {report?.status === "failed" ? (
          <p className="error" role="alert">
            {copy(
              "Report generation failed. Contact support with report ID {id} to request a safe retry.",
              { id: report.id },
            )}
          </p>
        ) : null}
        {report?.status === "ready" ? (
          <>
            <p className="muted" lang={locale}>
              {copy("Response timing")}:{" "}
              {report.timeMode === "flex" ? t("live.common.flexMode") : t("live.common.timedMode")}
            </p>
            {!uxBeta ? (
              <p className="notice" style={{ marginBottom: 26 }}>
                {copy("Report retained until {date}. Current plan default: {days} days.", {
                  date: formatDate(locale, report.expiresAt),
                  days: entitlements?.reportRetentionDays ?? "—",
                })}
              </p>
            ) : null}
            {evidence && uxBeta ? (
              <RecoveryStory report={evidence} />
            ) : (
              <section className="metric-grid" style={{ marginBottom: 26 }}>
                <div className="metric">
                  <strong>{report.metrics.participantCount}</strong>
                  <span>{t("live.common.participants")}</span>
                </div>
                <div className="metric">
                  <strong>{report.metrics.answerCount}</strong>
                  <span>{t("live.common.responses")}</span>
                </div>
                <div className="metric">
                  <strong>
                    {report.metrics.accuracyPercent === null || report.metrics.answerCount === 0
                      ? "—"
                      : `${formatNumber(locale, report.metrics.accuracyPercent)}%`}
                  </strong>
                  <span>
                    {report.metrics.accuracyPercent === null || report.metrics.answerCount === 0
                      ? copy("No assessed answers")
                      : t("live.common.accuracy")}
                  </span>
                </div>
                <div className="metric">
                  <strong>
                    {
                      report.questions.filter(
                        (question) =>
                          question.responses > 0 && question.correct !== null && question.difficult,
                      ).length
                    }
                  </strong>
                  <span>
                    {copy(uxBeta ? "Questions needing review" : "Checkpoints needing review")}
                  </span>
                </div>
              </section>
            )}
            {evidence && entitlements && uxBeta ? (
              <FollowupBuilder
                entitlement={entitlements.followups}
                initialFollowup={followup}
                canEdit={canEdit}
                mayManage={() => authority.current.canEdit}
                report={evidence}
                uxBeta={uxBeta}
              />
            ) : null}
            {uxBeta ? (
              <nav className="report-tabs" aria-label={copy("Report details")} role="tablist">
                {detailTabs.map((tab, index) => (
                  <button
                    aria-controls={`report-panel-${tab.id}`}
                    aria-selected={selectedTab === tab.id}
                    className={selectedTab === tab.id ? "active" : ""}
                    id={`report-tab-${tab.id}`}
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    onKeyDown={(event) => moveTabFocus(event, index)}
                    role="tab"
                    tabIndex={selectedTab === tab.id ? 0 : -1}
                    type="button"
                  >
                    {tab.label}
                  </button>
                ))}
              </nav>
            ) : null}
            {(!uxBeta || selectedTab === "evidence") && evidence ? (
              <div
                aria-labelledby={uxBeta ? "report-tab-evidence" : undefined}
                id={uxBeta ? "report-panel-evidence" : undefined}
                role={uxBeta ? "tabpanel" : undefined}
              >
                <EvidenceSections report={evidence} />
                {!uxBeta &&
                (report.schemaVersion === 4 ||
                  report.schemaVersion === 5 ||
                  report.schemaVersion === 6 ||
                  report.schemaVersion === 7) ? (
                  <DecisionTimeline report={report} />
                ) : null}
              </div>
            ) : null}
            {uxBeta &&
            selectedTab === "decision_replay" &&
            (report.schemaVersion === 4 ||
              report.schemaVersion === 5 ||
              report.schemaVersion === 6 ||
              report.schemaVersion === 7) ? (
              <div
                aria-labelledby="report-tab-decision_replay"
                id="report-panel-decision_replay"
                role="tabpanel"
              >
                <DecisionTimeline report={report} />
              </div>
            ) : null}
            {(!uxBeta || selectedTab === "interactions") &&
            (report.schemaVersion === 3 ||
              report.schemaVersion === 4 ||
              report.schemaVersion === 5 ||
              report.schemaVersion === 6 ||
              report.schemaVersion === 7) ? (
              <div
                aria-labelledby={uxBeta ? "report-tab-interactions" : undefined}
                id={uxBeta ? "report-panel-interactions" : undefined}
                role={uxBeta ? "tabpanel" : undefined}
              >
                <InteractionEvidenceSections
                  report={report}
                  transcriptExport={Boolean(entitlements?.csvExport)}
                  uxBeta={uxBeta}
                />
              </div>
            ) : null}
            {!uxBeta && evidence && entitlements ? (
              <FollowupBuilder
                entitlement={entitlements.followups}
                initialFollowup={followup}
                canEdit={canEdit}
                mayManage={() => authority.current.canEdit}
                report={evidence}
                uxBeta={uxBeta}
              />
            ) : null}
            {!uxBeta || selectedTab === "questions" ? (
              <section
                aria-labelledby={uxBeta ? "report-tab-questions" : undefined}
                className="panel"
                id={uxBeta ? "report-panel-questions" : undefined}
                role={uxBeta ? "tabpanel" : undefined}
                style={{ marginBottom: 26 }}
              >
                <h2 style={{ fontSize: "1.7rem" }}>
                  {copy(uxBeta ? "Question analysis" : "Checkpoint analysis")}
                </h2>
                <div
                  aria-label={copy("Question analysis")}
                  role="region"
                  style={{ overflowX: "auto" }}
                  tabIndex={0}
                >
                  <table className="report-table">
                    <thead>
                      <tr>
                        <th>{t("reportRound.common.question")}</th>
                        <th>{t("live.common.responses")}</th>
                        <th>{t("reportRound.rehearsal.correct")}</th>
                        <th>{t("live.common.accuracy")}</th>
                        {showResponseDistributions ? <th>{copy("Distribution")}</th> : null}
                        <th>{copy("Follow-up")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.questions.map((question) => (
                        <tr key={question.questionId}>
                          <td lang="">{question.prompt}</td>
                          <td>{question.responses}</td>
                          <td>
                            {question.correct === null
                              ? t("live.common.notScored")
                              : formatNumber(locale, question.correct)}
                          </td>
                          <td>
                            {question.accuracyPercent === null
                              ? t("live.common.notScored")
                              : question.responses === 0
                                ? t("reportRound.common.notMeasured")
                                : `${formatNumber(locale, question.accuracyPercent)}%`}
                          </td>
                          {showResponseDistributions ? (
                            <td>
                              <ReportDistribution
                                distribution={question.responseDistribution}
                                responses={question.responses}
                              />
                            </td>
                          ) : null}
                          <td>
                            {question.correct === null
                              ? copy("Opinion feedback")
                              : question.responses === 0
                                ? t("reportRound.common.notMeasured")
                                : question.difficult
                                  ? copy("Review")
                                  : copy("On track")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}
            {!uxBeta || selectedTab === "participants" ? (
              <section
                aria-labelledby={uxBeta ? "report-tab-participants" : undefined}
                className="panel"
                id={uxBeta ? "report-panel-participants" : undefined}
                role={uxBeta ? "tabpanel" : undefined}
                style={{ marginBottom: 26 }}
              >
                <h2 style={{ fontSize: "1.7rem" }}>{copy("Participant outcomes")}</h2>
                <div
                  aria-label={copy("Participant outcomes")}
                  role="region"
                  style={{ overflowX: "auto" }}
                  tabIndex={0}
                >
                  <table className="report-table">
                    <thead>
                      <tr>
                        <th>{copy("Nickname")}</th>
                        <th>{copy("Score")}</th>
                        <th>{t("reportRound.rehearsal.correct")}</th>
                        <th>{t("live.host.answered")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...report.participants]
                        .sort((a, b) => b.score - a.score)
                        .map((participant) => (
                          <tr key={participant.participantId}>
                            <td>
                              <ParticipantIdentity
                                avatarId={participant.avatarId}
                                nickname={participant.nickname}
                              />
                            </td>
                            <td>{participant.score}</td>
                            <td>{participant.correctCount}</td>
                            <td>{participant.answerCount}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}
            {uxBeta && selectedTab === "manage" ? (
              <div aria-labelledby="report-tab-manage" id="report-panel-manage" role="tabpanel">
                <section className="panel" style={{ marginBottom: 26 }}>
                  <h2 style={{ fontSize: "1.5rem" }}>{copy("Export report data")}</h2>
                  {entitlements?.csvExport ? (
                    <div className="button-row">
                      <a className="button" href={`${API_URL}/v1/reports/${id}.csv`}>
                        {copy("Download CSV")}
                      </a>
                      <a className="button-quiet" href={`${API_URL}/v1/reports/${id}.json`}>
                        {copy("Download JSON")}
                      </a>
                    </div>
                  ) : entitlements ? (
                    <Link className="button-quiet" href="/pricing">
                      {copy("CSV was not included for this room")}
                    </Link>
                  ) : null}
                  <p className="muted" style={{ marginBottom: 0 }}>
                    {copy("Report retained until {date}. Current plan default: {days} days.", {
                      date: formatDate(locale, report.expiresAt),
                      days: entitlements?.reportRetentionDays ?? "—",
                    })}
                  </p>
                </section>
                {canDelete ? (
                  <section className="panel danger-panel">
                    <h2 style={{ fontSize: "1.5rem" }}>{copy("Delete session data")}</h2>
                    <p className="muted">
                      {copy(
                        "Permanently remove this session, its participant records, answers, and report.",
                      )}
                    </p>
                    <button
                      className="button-danger"
                      disabled={deleting}
                      onClick={() => void deleteSession()}
                      type="button"
                    >
                      {deleting ? copy("Deleting…") : copy("Delete session and report")}
                    </button>
                  </section>
                ) : null}
              </div>
            ) : null}
            {!uxBeta && canDelete ? (
              <section className="panel danger-panel">
                <h2 style={{ fontSize: "1.5rem" }}>{copy("Delete session data")}</h2>
                <p className="muted">
                  {copy(
                    "Permanently remove this session, its participant records, answers, and report.",
                  )}
                </p>
                <button
                  className="button-danger"
                  disabled={deleting}
                  onClick={() => void deleteSession()}
                  type="button"
                >
                  {deleting ? copy("Deleting…") : copy("Delete session and report")}
                </button>
              </section>
            ) : null}
          </>
        ) : null}
      </main>
    </>
  );
}
