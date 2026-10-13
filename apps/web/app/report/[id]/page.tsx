"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import type {
  Entitlements,
  Followup,
  Report,
  ReportV2,
  ReportV3,
  ReportV4,
  ResponseDistribution,
  WorkspaceProductFeatures,
} from "@openround/contracts";
import { CreatorBrand } from "../../../components/brand";
import { ParticipantIdentity } from "../../../components/participant-avatar";
import { RecoveryStorySummary } from "../../../components/recovery-story";
import { recordFollowupShared } from "../../../components/workspace/product-events";
import { API_URL, apiFetch, humanError } from "../../../lib/api";
import { deriveRecoverySummary } from "../../../lib/report-summary";

interface ReportContext {
  quizId: string;
  quizTitle: string;
  sessionCreatedAt: string;
  sessionUpdatedAt: string;
}

type ReportTab =
  "evidence" | "decision_replay" | "questions" | "participants" | "interactions" | "manage";

function RecoveryStory({ report }: { report: ReportV2 | ReportV3 | ReportV4 }) {
  const summary = deriveRecoverySummary(report);
  const evidenceLabel =
    summary.evidenceTypes.length === 0
      ? "No recheck evidence"
      : summary.evidenceTypes
          .map((type) => (type === "linked_recheck" ? "linked recheck" : "revote"))
          .join(" and ");
  return (
    <RecoveryStorySummary
      contentLanguage="en-CA"
      model={{
        recovered: summary.recovered,
        denominator: summary.denominator,
        recoveryPercent: summary.recoveryPercent,
        initialAccuracyPercent: report.initialAccuracy.percent,
        initialCorrect: report.initialAccuracy.correct,
        initialResponses: report.initialAccuracy.responses,
        evidenceLabel,
        unresolvedCount: summary.unresolved.length,
        unresolvedNarrative: summary.topUnresolved
          ? `${summary.topUnresolved.conceptKey} has the strongest unresolved evidence (${summary.topUnresolved.unresolved}).`
          : "No authored concept remains unresolved in the available evidence.",
        interventions: report.interventions.map((item) => ({
          id: item.id,
          label: item.type.replaceAll("_", " "),
          startedAt: item.startedAt,
          followedByLinkedRecheck: Boolean(item.linkedRecheckRoundId),
          ...(item.recoveryPackCard
            ? {
                sourceReference: `Recovery Pack v${item.recoveryPackCard.packVersion} · card ${item.recoveryPackCard.cardId}`,
              }
            : {}),
        })),
        nextActionLabel: summary.unresolved.length ? "Target practice" : "Review evidence",
        nextAction: summary.nextAction,
        highConfidenceWrong: summary.highConfidenceWrong,
        correctButUnsure: summary.correctButUnsure,
        smallSample: summary.smallSample,
        evidenceNote: report.evidenceNote,
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
  if (!distribution) {
    return responses < 5 ? "Hidden below five responses" : "Not available";
  }
  if (distribution.kind === "numeric") {
    return `${distribution.correct} correct · ${distribution.incorrect} incorrect`;
  }
  return (
    <details>
      <summary>{distribution.respondents} respondents</summary>
      <ul>
        {distribution.buckets.map((bucket) => (
          <li key={bucket.value}>
            <span lang="">{bucket.label}</span>: {bucket.count} ({bucket.percent}%
            {distribution.kind === "choice" && distribution.percentBasis === "respondents"
              ? " of respondents"
              : ""}
            )
          </li>
        ))}
      </ul>
    </details>
  );
}

function EvidenceSections({ report }: { report: ReportV2 | ReportV3 | ReportV4 }) {
  const recovered = report.recovery.reduce((total, item) => total + item.recovered, 0);
  const recoveryDenominator = report.recovery.reduce(
    (total, item) => total + item.initiallyIncorrectWithBoth,
    0,
  );
  return (
    <>
      <p className="notice" style={{ marginBottom: 26 }}>
        {report.evidenceNote}
      </p>
      <section className="metric-grid" aria-label="Recovery evidence" style={{ marginBottom: 26 }}>
        <div className="metric">
          <strong>{report.initialAccuracy.percent}%</strong>
          <span>initial accuracy</span>
        </div>
        <div className="metric">
          <strong>{report.participation.percent}%</strong>
          <span>participation</span>
        </div>
        <div className="metric">
          <strong>
            {recovered}/{recoveryDenominator}
          </strong>
          <span>recovered in rechecks</span>
        </div>
        <div className="metric">
          <strong>
            {report.unresolvedConcepts.filter((concept) => concept.unresolved > 0).length}
          </strong>
          <span>unresolved concepts</span>
        </div>
      </section>

      <section className="panel" style={{ marginBottom: 26 }}>
        <h2 style={{ fontSize: "1.7rem" }}>Recovery evidence</h2>
        {report.recovery.length === 0 ? (
          <p className="muted">No linked recheck or revote evidence was collected.</p>
        ) : (
          <div
            aria-label="Scrollable recovery evidence table"
            role="region"
            style={{ overflowX: "auto" }}
            tabIndex={0}
          >
            <table className="report-table">
              <thead>
                <tr>
                  <th>Evidence</th>
                  <th>Recovered</th>
                  <th>Initially incorrect with both</th>
                  <th>Rate</th>
                  <th>Strength</th>
                </tr>
              </thead>
              <tbody>
                {report.recovery.map((item) => (
                  <tr key={item.recheckRoundId}>
                    <td>{item.evidenceType === "linked_recheck" ? "Linked recheck" : "Revote"}</td>
                    <td>{item.recovered}</td>
                    <td>{item.initiallyIncorrectWithBoth}</td>
                    <td>
                      {item.recoveryPercent === null ? "Not available" : `${item.recoveryPercent}%`}
                    </td>
                    <td>{item.smallSample ? "Small sample" : "Larger sample"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel" style={{ marginBottom: 26 }}>
        <h2 style={{ fontSize: "1.7rem" }}>Confidence and correctness</h2>
        <div
          aria-label="Scrollable confidence matrix"
          role="region"
          style={{ overflowX: "auto" }}
          tabIndex={0}
        >
          <table className="report-table">
            <thead>
              <tr>
                <th>Confidence</th>
                <th>Correct</th>
                <th>Incorrect</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {report.confidenceMatrix.map((row) => (
                <tr key={row.confidence}>
                  <td>{["Not sure", "Somewhat sure", "Very sure"][row.confidence - 1]}</td>
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
          <h2 style={{ fontSize: "1.7rem" }}>Concept follow-up</h2>
          <div
            aria-label="Scrollable concept follow-up table"
            role="region"
            style={{ overflowX: "auto" }}
            tabIndex={0}
          >
            <table className="report-table">
              <thead>
                <tr>
                  <th>Concept</th>
                  <th>Initially incorrect</th>
                  <th>Recovered</th>
                  <th>Unresolved</th>
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
          <h2 style={{ fontSize: "1.7rem" }}>Observed misconceptions</h2>
          <ul>
            {report.misconceptions.map((item) => (
              <li key={`${item.questionId}:${item.key}`}>
                <strong lang="">{item.key}</strong>: {item.responses} responses (
                {item.allResponsePercent}% of all; {item.wrongResponsePercent}% of incorrect
                responses)
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function DecisionTimeline({ report }: { report: ReportV4 }) {
  const labelForEvent = (event: ReportV4["decisionTimeline"][number]) => {
    switch (event.type) {
      case "insight_shown":
        return `Facilitator insight: ${event.recommendationCode.replaceAll("_", " ")} (${event.sampleSize} of ${event.activeParticipantCount} active participants; ${event.ruleSetVersion})`;
      case "answer_revealed":
        return "Answer revealed";
      case "intervention_started":
        return `${event.interventionType.replaceAll("_", " ")} started`;
      case "intervention_finished":
        return `${event.interventionType.replaceAll("_", " ")} finished`;
      case "recheck_opened":
        return event.kind === "linked_recheck" ? "Linked recheck opened" : "Revote opened";
      case "question_advanced":
        return "Advanced to the next question";
      case "session_finished":
        return event.reason === "completed" ? "Session completed" : "Session ended by facilitator";
      case "capture_truncated":
        return "Replay capture reached its event limit";
    }
  };

  return (
    <section
      aria-labelledby="decision-replay-heading"
      className="panel"
      style={{ marginBottom: 26 }}
    >
      <p className="eyebrow">Session decision replay</p>
      <h2 id="decision-replay-heading" style={{ fontSize: "1.7rem" }}>
        Facilitator decisions
      </h2>
      <p className="muted">
        This timeline records session events as they happened. It is not reconstructed from answers
        and does not establish a causal learning outcome.
      </p>
      {!report.decisionReplayAvailable ? (
        <p className="notice">
          No decision timeline is available. This session may predate replay capture, or no replay
          events were retained.
        </p>
      ) : null}
      {report.decisionReplayAvailable && !report.decisionReplayComplete ? (
        <p className="notice" role="status">
          This is a partial timeline. Some events could not be retained, so do not treat it as a
          complete sequence.
        </p>
      ) : null}
      {report.decisionReplayAvailable ? (
        <ol>
          {report.decisionTimeline.map((event) => (
            <li key={event.seq}>
              <time dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleString()}</time>
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
  report: ReportV3 | ReportV4;
  transcriptExport: boolean;
  uxBeta: boolean;
}) {
  return (
    <section className="panel" style={{ marginBottom: 26 }}>
      <div className="page-heading" style={{ marginBottom: 18 }}>
        <div>
          <p className="eyebrow">Audience interaction</p>
          <h2 style={{ fontSize: "1.7rem" }}>Pulse and conversation evidence</h2>
        </div>
        <span className="status-pill">
          {report.experience.preset.id} · {report.experience.category.replaceAll("_", " ")}
        </span>
      </div>
      <div className="metric-grid" style={{ marginBottom: 18 }}>
        <div className="metric">
          <strong>{report.audiencePulse.uniqueParticipants}</strong>
          <span>people signaled</span>
        </div>
        <div className="metric">
          <strong>{report.audiencePulse.events}</strong>
          <span>pulse changes</span>
        </div>
        <div className="metric">
          <strong>{report.conversation.messages}</strong>
          <span>chat messages</span>
        </div>
        <div className="metric">
          <strong>{report.conversation.uniqueContributors}</strong>
          <span>chat contributors</span>
        </div>
      </div>
      <p className="muted">
        {report.conversation.reactions} reactions · {report.conversation.reports} reports ·{" "}
        {report.conversation.removed} removals · peak {report.conversation.peakMessagesPerMinute}{" "}
        messages per minute
      </p>
      {report.audiencePulse.contexts.length ? (
        <div className="table-wrap" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th>Pulse context</th>
                <th>People</th>
                <th>Got it</th>
                <th>Unsure</th>
                <th>Need example</th>
                <th>Too fast</th>
              </tr>
            </thead>
            <tbody>
              {report.audiencePulse.contexts.map((context) => (
                <tr key={context.contextKey}>
                  <td>
                    {context.contextKey.startsWith("intervention:")
                      ? "Intervention"
                      : context.contextKey === "lobby"
                        ? "Lobby"
                        : uxBeta
                          ? "Question / recheck"
                          : "Checkpoint / recheck"}
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
            Open authorized transcript
          </a>
          {transcriptExport ? (
            <a
              className="button-quiet"
              href={`${API_URL}/v1/reports/${report.id}/interactions.csv`}
            >
              Download interaction CSV
            </a>
          ) : null}
        </div>
      ) : (
        <p className="muted">No retained room conversation was collected.</p>
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
}: {
  report: ReportV2 | ReportV3 | ReportV4;
  entitlement: boolean;
  initialFollowup: Followup | null;
  uxBeta: boolean;
}) {
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
  const [passLabel, setPassLabel] = useState("Extended time");
  const [passMultiplier, setPassMultiplier] = useState<1.5 | 2>(1.5);
  const [latestPass, setLatestPass] = useState<FollowupAccessView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [shareStatus, setShareStatus] = useState("");

  useEffect(() => {
    if (!followup) return;
    let cancelled = false;
    void apiFetch<{ access: FollowupAccessView[] }>(`/v1/followups/${followup.id}`)
      .then((result) => {
        if (!cancelled) setAccess(result.access);
      })
      .catch((caught) => {
        if (!cancelled) setError(humanError(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [followup]);

  async function createFollowup(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
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
    if (!followup) return;
    setBusy(true);
    setError("");
    try {
      const result = await apiFetch<{ access: FollowupAccessView }>(
        `/v1/followups/${followup.id}/accommodation-passes`,
        {
          method: "POST",
          body: JSON.stringify({ label: passLabel, timeMultiplier: passMultiplier }),
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
      !window.confirm("Revoke this follow-up pass? Its attempt will stop working.")
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
    if (!followup || !window.confirm("Close this follow-up for every participant?")) return;
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
    setShareStatus("Follow-up links downloaded.");
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function copyGenericLink() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.genericUrl);
      recordFollowupShared();
      setShareStatus("Generic follow-up link copied.");
    } catch {
      setError("Copy was blocked. Select and copy the link instead.");
    }
  }

  if (!unresolved.length) return null;
  return (
    <section className="panel" style={{ marginBottom: 26 }} aria-labelledby="followup-heading">
      <p className="eyebrow">Continue the recovery loop</p>
      <h2 id="followup-heading" style={{ fontSize: "1.7rem" }}>
        Self-paced follow-up
      </h2>
      {!entitlement ? (
        <p className="notice">
          Signed follow-up links and private feedback are available with Hosted Pro and in the
          Community edition. <Link href="/pricing">Compare editions</Link>.
        </p>
      ) : followup ? (
        <>
          <p>
            <strong lang="">{followup.title}</strong> contains {followup.checkpointCount}{" "}
            {uxBeta ? "question" : "checkpoint"}
            {followup.checkpointCount === 1 ? "" : "s"} and closes on{" "}
            {new Date(followup.closesAt).toLocaleString()}.
          </p>
          <p className="muted">
            {followup.timeMode === "flex"
              ? "Time-flex mode has no countdown."
              : `Standard ${uxBeta ? "question" : "checkpoint"} timers are enforced by the server.`}{" "}
            {followup.closedAt ? "This follow-up is closed." : "Links remain revocable."}
          </p>
          {created ? (
            <div className="notice">
              <strong>Save these links now.</strong> Polling Pops stores only token hashes and
              cannot show the same links again.
              <div className="field" style={{ marginTop: 12 }}>
                <span>Generic anonymous link</span>
                <div className="toolbar">
                  <input className="input" readOnly value={created.genericUrl} />
                  <button
                    className="button-quiet small-button"
                    onClick={() => void copyGenericLink()}
                    type="button"
                  >
                    Copy
                  </button>
                </div>
              </div>
              <button className="button-quiet small-button" onClick={downloadLinks} type="button">
                Download all links as CSV
              </button>
              {shareStatus ? (
                <p aria-live="polite" className="success" role="status">
                  {shareStatus}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="notice">
              Access links were shown once when this follow-up was created. Create an accommodation
              pass below if a new individual link is needed.
            </p>
          )}

          {!followup.closedAt ? (
            <form onSubmit={createPass} className="toolbar" style={{ marginTop: 20 }}>
              <label className="field" style={{ flex: "1 1 220px" }}>
                <span>Accommodation pass label</span>
                <input
                  className="input"
                  lang=""
                  maxLength={80}
                  onChange={(event) => setPassLabel(event.target.value)}
                  required
                  value={passLabel}
                />
              </label>
              <label className="field">
                <span>Time allowance</span>
                <select
                  className="select"
                  onChange={(event) => setPassMultiplier(Number(event.target.value) as 1.5 | 2)}
                  value={passMultiplier}
                >
                  <option value={1.5}>1.5×</option>
                  <option value={2}>2×</option>
                </select>
              </label>
              <button className="button-quiet" disabled={busy} type="submit">
                Create private pass
              </button>
            </form>
          ) : null}
          {latestPass?.url ? (
            <div className="notice">
              <strong>Save this new pass now:</strong>
              <div className="toolbar" style={{ marginTop: 8 }}>
                <input className="input" readOnly value={latestPass.url} />
                <button
                  className="button-quiet small-button"
                  onClick={() => void navigator.clipboard.writeText(latestPass.url!)}
                  type="button"
                >
                  Copy
                </button>
              </div>
            </div>
          ) : null}
          {access.length ? (
            <div
              style={{ overflowX: "auto" }}
              role="region"
              aria-label="Follow-up access passes"
              tabIndex={0}
            >
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Pass</th>
                    <th>Time</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {access.map((item) => (
                    <tr key={item.id}>
                      <td lang="">{item.nickname ?? item.label}</td>
                      <td>{item.timeMultiplier}×</td>
                      <td>{item.revokedAt ? "Revoked" : "Active"}</td>
                      <td>
                        {!item.revokedAt && !followup.closedAt ? (
                          <button
                            className="danger-link"
                            disabled={busy}
                            onClick={() => void revoke(item.id)}
                            type="button"
                          >
                            Revoke
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
          {!followup.closedAt ? (
            <button
              className="danger-link"
              disabled={busy}
              onClick={() => void closeFollowup()}
              type="button"
            >
              Close follow-up for everyone
            </button>
          ) : null}
        </>
      ) : (
        <form onSubmit={createFollowup}>
          <p>Select the unresolved concepts to include. Linked rechecks are used when available.</p>
          <fieldset className="choice-list">
            <legend className="sr-only">Unresolved concepts</legend>
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
                  <strong lang="">{concept.conceptKey}</strong> — {concept.unresolved} unresolved
                </span>
              </label>
            ))}
          </fieldset>
          <div className="toolbar">
            <label className="field">
              <span>Timing</span>
              <select
                className="select"
                onChange={(event) => setTimeMode(event.target.value as "flex" | "timed")}
                value={timeMode}
              >
                <option value="flex">Time-flex, no countdown</option>
                <option value="timed">Use {uxBeta ? "question" : "checkpoint"} timers</option>
              </select>
            </label>
            <label className="field">
              <span>Close date and time</span>
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
          <button className="button" disabled={busy || selected.length === 0} type="submit">
            {busy ? "Creating…" : "Create follow-up and links"}
          </button>
        </form>
      )}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

export default function ReportPage() {
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

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const response = await apiFetch<{
          report: Report;
          entitlements: Entitlements;
          followup: Followup | null;
          context?: ReportContext;
        }>(`/v1/reports/${id}`);
        if (cancelled) return;
        setReport(response.report);
        setContext(response.context ?? null);
        setEntitlements(response.entitlements);
        setFollowup(response.followup);
        setError("");
        if (response.report.status === "pending") retryTimer = setTimeout(load, 1_500);
      } catch (caught) {
        if (cancelled) return;
        if ((caught as { status?: number }).status === 401) router.replace("/signin");
        else setError(humanError(caught));
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [id, router]);

  useEffect(() => {
    apiFetch<{
      productFeatures: Pick<WorkspaceProductFeatures, "uxBeta" | "workspaceShell">;
    }>("/v1/auth/me")
      .then((account) => setProductFeatures(account.productFeatures))
      .catch(() => setProductFeatures(null));
  }, []);

  const uxBeta = productFeatures?.uxBeta === true;

  const evidence =
    report?.schemaVersion === 2 || report?.schemaVersion === 3 || report?.schemaVersion === 4
      ? report
      : null;
  const detailTabs: { id: ReportTab; label: string }[] = [
    ...(evidence ? [{ id: "evidence" as const, label: "Evidence" }] : []),
    ...(report?.schemaVersion === 4
      ? [{ id: "decision_replay" as const, label: "Decision replay" }]
      : []),
    ...(report?.schemaVersion === 3 || report?.schemaVersion === 4
      ? [{ id: "interactions" as const, label: "Conversation" }]
      : []),
    { id: "questions", label: "Questions" },
    { id: "participants", label: "Participants" },
    ...(uxBeta ? [{ id: "manage" as const, label: "Manage data" }] : []),
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
    if (!report || !window.confirm("Delete this session, its answers, and this report?")) return;
    setDeleting(true);
    setError("");
    try {
      await apiFetch(`/v1/sessions/${report.sessionId}`, { method: "DELETE" });
      router.replace("/dashboard");
    } catch (caught) {
      setError(humanError(caught));
      setDeleting(false);
    }
  }

  return (
    <>
      <header className="shell topbar" lang="en-CA">
        <CreatorBrand productFeatures={productFeatures} />
        <Link className="button-quiet small-button" href="/dashboard">
          Dashboard
        </Link>
      </header>
      <main className="shell page-main" id="main" lang="en-CA">
        <div className="page-heading">
          <div>
            <p className="eyebrow">Session report</p>
            {uxBeta && context?.quizTitle ? (
              <h1 lang="">{context.quizTitle}</h1>
            ) : (
              <h1>What the room understood</h1>
            )}
            {uxBeta && context ? (
              <p className="muted">
                What the room understood · {new Date(context.sessionCreatedAt).toLocaleDateString()}
              </p>
            ) : null}
          </div>
          {!uxBeta && report?.status === "ready" && entitlements?.csvExport ? (
            <div className="button-row">
              <a className="button" href={`${API_URL}/v1/reports/${id}.csv`}>
                Download CSV
              </a>
              <a className="button-quiet" href={`${API_URL}/v1/reports/${id}.json`}>
                Download JSON
              </a>
            </div>
          ) : !uxBeta && report && entitlements ? (
            <Link className="button-quiet" href="/pricing">
              CSV was not included for this room
            </Link>
          ) : null}
        </div>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        {!report && !error ? <p>Loading report…</p> : null}
        {report?.status === "pending" ? (
          <section className="panel" aria-live="polite">
            <p className="eyebrow">Building evidence</p>
            <h2>Your report is being generated</h2>
            <p className="muted">
              Polling Pops is reconciling durable responses, interventions, and rechecks. This page
              refreshes automatically and is normally ready within a minute.
            </p>
          </section>
        ) : null}
        {report?.status === "failed" ? (
          <p className="error" role="alert">
            Report generation could not finish. Contact support with report ID {report.id} so the
            job can be safely retried.
          </p>
        ) : null}
        {report?.status === "ready" ? (
          <>
            <p className="muted" lang="en-CA">
              Response timing:{" "}
              {report.timeMode === "flex"
                ? "Flex — facilitator closes responses"
                : "Timed — question deadline"}
            </p>
            {!uxBeta ? (
              <p className="notice" style={{ marginBottom: 26 }}>
                This report&apos;s stored retention deadline is{" "}
                {new Date(report.expiresAt).toLocaleDateString()}. The current{" "}
                {entitlements?.plan ?? "account"} plan defaults to{" "}
                {entitlements?.reportRetentionDays ?? ""} days. You can delete it sooner below.
              </p>
            ) : null}
            {evidence && uxBeta ? (
              <RecoveryStory report={evidence} />
            ) : (
              <section className="metric-grid" style={{ marginBottom: 26 }}>
                <div className="metric">
                  <strong>{report.metrics.participantCount}</strong>
                  <span>participants</span>
                </div>
                <div className="metric">
                  <strong>{report.metrics.answerCount}</strong>
                  <span>answers</span>
                </div>
                <div className="metric">
                  <strong>{report.metrics.accuracyPercent}%</strong>
                  <span>accuracy</span>
                </div>
                <div className="metric">
                  <strong>
                    {report.questions.filter((question) => question.difficult).length}
                  </strong>
                  <span>difficult {uxBeta ? "questions" : "checkpoints"}</span>
                </div>
              </section>
            )}
            {evidence && entitlements && uxBeta ? (
              <FollowupBuilder
                entitlement={entitlements.followups}
                initialFollowup={followup}
                report={evidence}
                uxBeta={uxBeta}
              />
            ) : null}
            {uxBeta ? (
              <nav className="report-tabs" aria-label="Report details" role="tablist">
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
                {!uxBeta && report.schemaVersion === 4 ? (
                  <DecisionTimeline report={report} />
                ) : null}
              </div>
            ) : null}
            {uxBeta && selectedTab === "decision_replay" && report.schemaVersion === 4 ? (
              <div
                aria-labelledby="report-tab-decision_replay"
                id="report-panel-decision_replay"
                role="tabpanel"
              >
                <DecisionTimeline report={report} />
              </div>
            ) : null}
            {(!uxBeta || selectedTab === "interactions") &&
            (report.schemaVersion === 3 || report.schemaVersion === 4) ? (
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
                  {uxBeta ? "Question" : "Checkpoint"} analysis
                </h2>
                <div
                  aria-label={`Scrollable ${uxBeta ? "question" : "checkpoint"} analysis table`}
                  role="region"
                  style={{ overflowX: "auto" }}
                  tabIndex={0}
                >
                  <table className="report-table">
                    <thead>
                      <tr>
                        <th>{uxBeta ? "Question" : "Checkpoint"}</th>
                        <th>Responses</th>
                        <th>Correct</th>
                        <th>Accuracy</th>
                        {uxBeta ? <th>Distribution</th> : null}
                        <th>Follow-up</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.questions.map((question) => (
                        <tr key={question.questionId}>
                          <td lang="">{question.prompt}</td>
                          <td>{question.responses}</td>
                          <td>{question.correct}</td>
                          <td>{question.accuracyPercent}%</td>
                          {uxBeta ? (
                            <td>
                              <ReportDistribution
                                distribution={question.responseDistribution}
                                responses={question.responses}
                              />
                            </td>
                          ) : null}
                          <td>{question.difficult ? "Review" : "On track"}</td>
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
                <h2 style={{ fontSize: "1.7rem" }}>Participant outcomes</h2>
                <div
                  aria-label="Scrollable participant outcomes table"
                  role="region"
                  style={{ overflowX: "auto" }}
                  tabIndex={0}
                >
                  <table className="report-table">
                    <thead>
                      <tr>
                        <th>Nickname</th>
                        <th>Score</th>
                        <th>Correct</th>
                        <th>Answered</th>
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
                  <h2 style={{ fontSize: "1.5rem" }}>Export report data</h2>
                  {entitlements?.csvExport ? (
                    <div className="button-row">
                      <a className="button" href={`${API_URL}/v1/reports/${id}.csv`}>
                        Download CSV
                      </a>
                      <a className="button-quiet" href={`${API_URL}/v1/reports/${id}.json`}>
                        Download JSON
                      </a>
                    </div>
                  ) : entitlements ? (
                    <Link className="button-quiet" href="/pricing">
                      CSV was not included for this room
                    </Link>
                  ) : null}
                  <p className="muted" style={{ marginBottom: 0 }}>
                    This report&apos;s stored retention deadline is{" "}
                    {new Date(report.expiresAt).toLocaleDateString()}. This room&apos;s{" "}
                    {entitlements?.plan ?? "recorded"} reporting terms provide{" "}
                    {entitlements?.reportRetentionDays ?? ""} days of retention.
                  </p>
                </section>
                <section className="panel danger-panel">
                  <h2 style={{ fontSize: "1.5rem" }}>Delete session data</h2>
                  <p className="muted">
                    Permanently remove this session, its participant records, answers, and report.
                  </p>
                  <button
                    className="button-danger"
                    disabled={deleting}
                    onClick={() => void deleteSession()}
                    type="button"
                  >
                    {deleting ? "Deleting…" : "Delete session and report"}
                  </button>
                </section>
              </div>
            ) : null}
            {!uxBeta ? (
              <section className="panel danger-panel">
                <h2 style={{ fontSize: "1.5rem" }}>Delete session data</h2>
                <p className="muted">
                  Permanently remove this session, its participant records, answers, and report.
                </p>
                <button
                  className="button-danger"
                  disabled={deleting}
                  onClick={() => void deleteSession()}
                  type="button"
                >
                  {deleting ? "Deleting…" : "Delete session and report"}
                </button>
              </section>
            ) : null}
          </>
        ) : null}
      </main>
    </>
  );
}
