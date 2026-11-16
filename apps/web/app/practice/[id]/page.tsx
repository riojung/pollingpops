"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import styles from "./page.module.css";
import { useLocale } from "../../../components/locale-provider";
import {
  recordFollowupShared,
  recordPracticeAssignmentShared,
} from "../../../components/workspace/product-events";
import { WorkspaceProvider, useWorkspace } from "../../../components/workspace/workspace-provider";
import { WorkspaceShell } from "../../../components/workspace/workspace-shell";
import { apiFetch, humanError } from "../../../lib/api";
import { formatDateTime, formatNumber } from "../../../lib/i18n/format";
import { packPracticeCopy } from "../../../lib/i18n/pack-practice-copy";
import {
  practiceManagementCopy,
  practiceManagementFeedback,
} from "../../../lib/i18n/practice-management-copy";
import {
  practiceStatus,
  practiceSourceDetails,
  type PracticeAccess,
  type PracticeContext,
  type PracticeRecord,
} from "../../../lib/practice-assignment";

interface PracticeDetail {
  followup: PracticeRecord;
  access: PracticeAccess[];
  context: PracticeContext;
  attemptCount?: number;
  completedAttemptCount?: number;
}
type ActionFeedback = { kind: "revoked"; label: string } | { kind: "closed" } | null;

function PracticeManagementController({ id }: { id: string }) {
  const { locale } = useLocale();
  const copy = practiceManagementCopy(locale);
  const packCopy = packPracticeCopy(locale);
  const {
    creator,
    productFeatures,
    entitlements,
    canEdit,
    loading: accountLoading,
  } = useWorkspace();
  const [detail, setDetail] = useState<PracticeDetail | null>(null);
  const detailRef = useRef(detail);
  detailRef.current = detail;
  const [personalLabel, setPersonalLabel] = useState("");
  // This is a stored, editable label, not a translated UI default.
  const [accommodationLabel, setAccommodationLabel] = useState("Extended time");
  const [timeMultiplier, setTimeMultiplier] = useState<1.5 | 2>(1.5);
  const [latestAccess, setLatestAccess] = useState<PracticeAccess | null>(null);
  const [copyLabel, setCopyLabel] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState<ActionFeedback>(null);
  const [busyAction, setBusyAction] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState("");
  const mounted = useRef(false);
  const busyRef = useRef("");
  const errorRef = useRef<HTMLParagraphElement>(null);
  const latestLinkHeadingRef = useRef<HTMLHeadingElement>(null);
  const summaryHeadingRef = useRef<HTMLHeadingElement>(null);
  const accessHeadingRef = useRef<HTMLHeadingElement>(null);
  // A permission change invalidates callbacks immediately, including a change back to an
  // earlier role. Locale is deliberately absent: changing language is presentation only.
  const authorityKey = JSON.stringify([
    id,
    creator?.userId,
    creator?.workspaceId,
    creator?.role,
    canEdit,
    accountLoading,
    entitlements?.followups,
    productFeatures?.practiceAssignments,
    productFeatures?.recoveryPacks,
  ]);
  const authorityRef = useRef({ key: authorityKey });
  if (authorityRef.current.key !== authorityKey) authorityRef.current = { key: authorityKey };
  const authority = authorityRef.current;
  const [receiptAuthority, setReceiptAuthority] = useState<typeof authority | null>(null);
  const current = () => mounted.current && authorityRef.current === authority;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    busyRef.current = "";
    setBusyAction("");
    setLatestAccess(null);
    setReceiptAuthority(null);
    setCopyLabel(null);
    setActionStatus(null);
    setError("");
  }, [authority]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void apiFetch<PracticeDetail>("/v1/followups/" + id)
      .then((response) => {
        if (!cancelled) setDetail(response);
      })
      .catch((caught) => {
        if (!cancelled) setError(humanError(caught));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, retry]);

  const status = detail ? practiceStatus(detail.followup) : null;
  const source = detail ? practiceSourceDetails(detail.context, canEdit) : null;
  const isPackPractice = detail?.context.sourceType === "recovery_pack";
  const assignmentAccessEnabled =
    productFeatures?.practiceAssignments === true &&
    (!isPackPractice || productFeatures?.recoveryPacks === true);
  const mutable =
    canEdit && !accountLoading && status !== null && status !== "closed" && status !== "expired";
  const personalPassCreationAvailable =
    mutable &&
    entitlements?.followups === true &&
    assignmentAccessEnabled &&
    detail?.followup.purpose === "assignment";
  const receipt = receiptAuthority === authority ? latestAccess : null;

  function focus(ref: { current: HTMLElement | null }) {
    window.requestAnimationFrame(() => {
      if (current()) ref.current?.focus();
    });
  }
  function reportError(caught: unknown) {
    if (!current()) return;
    setError(humanError(caught));
    focus(errorRef);
  }
  function begin(action: string) {
    const currentStatus = detailRef.current ? practiceStatus(detailRef.current.followup) : null;
    if (
      !current() ||
      busyRef.current ||
      !mutable ||
      !currentStatus ||
      currentStatus === "closed" ||
      currentStatus === "expired"
    )
      return false;
    busyRef.current = action;
    setBusyAction(action);
    setError("");
    setCopyLabel(null);
    setActionStatus(null);
    return true;
  }
  function finish() {
    if (!current()) return;
    busyRef.current = "";
    setBusyAction("");
  }
  async function createPersonalPass(event: FormEvent) {
    event.preventDefault();
    if (!detail || !personalPassCreationAvailable || !personalLabel.trim() || !begin("personal"))
      return;
    try {
      const response = await apiFetch<{ access: PracticeAccess }>(
        "/v1/followups/" + id + "/personal-passes",
        { method: "POST", body: JSON.stringify({ label: personalLabel.trim() }) },
      );
      if (!current()) return;
      setLatestAccess(response.access);
      setReceiptAuthority(authority);
      setDetail((previous) =>
        previous ? { ...previous, access: [...previous.access, response.access] } : previous,
      );
      setPersonalLabel("");
      focus(latestLinkHeadingRef);
    } catch (caught) {
      reportError(caught);
    } finally {
      finish();
    }
  }
  async function createAccommodation(event: FormEvent) {
    event.preventDefault();
    if (
      !detail ||
      detail.followup.timeMode !== "timed" ||
      !accommodationLabel.trim() ||
      !begin("accommodation")
    )
      return;
    try {
      const response = await apiFetch<{ access: PracticeAccess }>(
        "/v1/followups/" + id + "/accommodation-passes",
        {
          method: "POST",
          body: JSON.stringify({ label: accommodationLabel.trim(), timeMultiplier }),
        },
      );
      if (!current()) return;
      setLatestAccess(response.access);
      setReceiptAuthority(authority);
      setDetail((previous) =>
        previous ? { ...previous, access: [...previous.access, response.access] } : previous,
      );
      focus(latestLinkHeadingRef);
    } catch (caught) {
      reportError(caught);
    } finally {
      finish();
    }
  }
  async function revoke(accessId: string) {
    const access = detail?.access.find((item) => item.id === accessId);
    if (
      !access ||
      access.revokedAt ||
      !current() ||
      !mutable ||
      busyRef.current ||
      !window.confirm(copy("Revoke this private practice link? Its attempt will stop working.")) ||
      !begin(accessId)
    )
      return;
    try {
      await apiFetch("/v1/followups/" + id + "/access/" + accessId, { method: "DELETE" });
      if (!current()) return;
      setDetail((previous) =>
        previous
          ? {
              ...previous,
              access: previous.access.map((item) =>
                item.id === accessId ? { ...item, revokedAt: new Date().toISOString() } : item,
              ),
            }
          : previous,
      );
      if (latestAccess?.id === accessId) setLatestAccess(null);
      setActionStatus({ kind: "revoked", label: access.nickname ?? access.label });
      focus(accessHeadingRef);
    } catch (caught) {
      reportError(caught);
    } finally {
      finish();
    }
  }
  async function closePractice() {
    if (
      !detail ||
      !current() ||
      !mutable ||
      busyRef.current ||
      !window.confirm(copy("Close this practice for every participant?")) ||
      !begin("close")
    )
      return;
    try {
      await apiFetch("/v1/followups/" + id + "/close", { method: "POST", body: "{}" });
      if (!current()) return;
      setDetail((previous) =>
        previous
          ? { ...previous, followup: { ...previous.followup, closedAt: new Date().toISOString() } }
          : previous,
      );
      setLatestAccess(null);
      setActionStatus({ kind: "closed" });
      focus(summaryHeadingRef);
    } catch (caught) {
      reportError(caught);
    } finally {
      finish();
    }
  }
  async function copyLatestLink() {
    if (!receipt?.url || !begin("copy")) return;
    try {
      await navigator.clipboard.writeText(receipt.url);
      if (!current()) return;
      if (detail?.followup.purpose === "assignment") recordPracticeAssignmentShared();
      else recordFollowupShared();
      setCopyLabel(receipt.label);
    } catch {
      reportError(new Error("Copy was blocked. Select and copy the link instead."));
    } finally {
      finish();
    }
  }
  const feedback = practiceManagementFeedback(locale, error);
  function statusLabel(value: "scheduled" | "open" | "closed" | "expired") {
    return copy(
      ({ scheduled: "Scheduled", open: "Open", closed: "Closed", expired: "Expired" } as const)[
        value
      ],
    );
  }
  function accessStatus(access: PracticeAccess) {
    if (access.revokedAt) return copy("Revoked");
    if (new Date(access.expiresAt) <= new Date()) return copy("Expired");
    return status === "open" ? copy("Active") : status ? statusLabel(status) : "—";
  }
  function accessType(access: PracticeAccess) {
    if (access.kind === "accommodation")
      return copy("{multiplier}× accommodation", {
        multiplier: formatNumber(locale, access.timeMultiplier),
      });
    return copy(
      access.kind === "assignment_personal"
        ? "Personal assignment link"
        : "Participant follow-up link",
    );
  }
  return (
    <WorkspaceShell
      actions={
        <Link className="button-quiet" href="/results?view=practice">
          {copy("Back to Practice")}
        </Link>
      }
      description={copy("Review progress, manage private access, and control availability.")}
      eyebrow={copy("Practice")}
      requireBeta={false}
      title={detail?.followup.title ?? copy("Manage practice")}
      titleLanguage={detail?.followup.title ? "" : locale}
      translationLevel="full"
    >
      <div className={styles.stack} lang={locale}>
        {error ? (
          <p className="error" lang={feedback.lang} ref={errorRef} role="alert" tabIndex={-1}>
            {feedback.text}
          </p>
        ) : null}
        <p
          aria-atomic="true"
          aria-live="polite"
          className={actionStatus ? "success" : "sr-only"}
          role="status"
        >
          {actionStatus?.kind === "closed" ? (
            copy("Practice closed for every participant.")
          ) : actionStatus?.kind === "revoked" ? (
            <>
              {copy("Private link revoked.")} <bdi lang="">{actionStatus.label}</bdi>
            </>
          ) : null}
        </p>
        {loading ? (
          <div className={styles.empty} role="status">
            {copy("Loading practice…")}
          </div>
        ) : !detail ? (
          <div className={styles.empty}>
            <p>{copy("Practice is unavailable.")}</p>
            <button
              className="button-quiet"
              onClick={() => setRetry((value) => value + 1)}
              type="button"
            >
              {copy("Retry loading practice")}
            </button>
          </div>
        ) : (
          <>
            <section className={styles.summaryCard} aria-labelledby="practice-summary-heading">
              <div className={styles.summaryHeader}>
                <div>
                  <p className="eyebrow">
                    {isPackPractice
                      ? packCopy(
                          detail.followup.recoveryPackSource?.role === "full_sequence"
                            ? "Full-sequence Pack practice"
                            : "Pack delayed-probe practice",
                        )
                      : copy(
                          detail.followup.purpose === "assignment"
                            ? "Practice assignment"
                            : "Recovery follow-up",
                        )}
                  </p>
                  <h2 id="practice-summary-heading" lang="" ref={summaryHeadingRef} tabIndex={-1}>
                    {source?.title}
                  </h2>
                </div>
                <div className={styles.statusGroup}>
                  <span className="status-pill">{statusLabel(status!)}</span>
                  <span className="status-pill">
                    {copy("Published v{version}", {
                      version: formatNumber(locale, detail.context.version),
                    })}
                  </span>
                </div>
              </div>
              <div className={styles.metricGrid}>
                {(
                  [
                    [detail.followup.checkpointCount, "Questions"],
                    [detail.attemptCount, "Attempts"],
                    [detail.completedAttemptCount, "Completed"],
                  ] as const
                ).map(([value, label]) => (
                  <div className={styles.metric} key={label}>
                    <strong>{value === undefined ? "—" : formatNumber(locale, value)}</strong>
                    <span>{copy(label)}</span>
                  </div>
                ))}
              </div>
              <div className={styles.schedule}>
                <p>
                  {copy("Opens {date}", { date: formatDateTime(locale, detail.followup.opensAt) })}
                </p>
                <p>
                  {copy("Closes {date}", {
                    date: formatDateTime(locale, detail.followup.closesAt),
                  })}
                </p>
              </div>
              <p className={styles.muted}>
                {copy(
                  detail.followup.timeMode === "flex"
                    ? "Time-flex mode has no countdown."
                    : "Standard question timers are enforced by the server.",
                )}{" "}
                {copy("Source version published {date}.", {
                  date: formatDateTime(locale, detail.context.publishedAt),
                })}
              </p>
              {isPackPractice ? (
                <p className={styles.sourceNote}>
                  {copy(
                    detail.followup.recoveryPackSource?.role === "full_sequence"
                      ? "Full frozen Pack sequence: diagnostic, intervention cards, and linked recheck. The optional delayed probe and a delayed recovery trail are not included."
                      : "Frozen Pack delayed probe: one standalone checkpoint. This is not full Pack recovery or a delayed recovery trail.",
                  )}{" "}
                  {copy("Source edits or deletion do not change this practice.")}
                </p>
              ) : null}
              {detail.followup.purpose === "assignment" && !assignmentAccessEnabled ? (
                <p className="notice">
                  {copy(
                    "New personal assignment links are paused. Existing access, accommodations, revocation, and close controls remain available.",
                  )}
                </p>
              ) : null}
              {!canEdit ? (
                <p className="notice">
                  {copy("An owner or editor must create or manage follow-up access.")}
                </p>
              ) : null}
              <div className={styles.managementActions}>
                <Link className="button-quiet small-button" href={source!.href}>
                  {copy(isPackPractice ? "Open Recovery Pack library" : "Open source Round")}
                </Link>
                {detail.followup.sourceReportId ? (
                  <Link
                    className="button-quiet small-button"
                    href={"/report/" + detail.followup.sourceReportId}
                  >
                    {copy("View source result")}
                  </Link>
                ) : null}
              </div>
            </section>
            {receipt?.url && mutable ? (
              <section className={styles.receipt} aria-labelledby="latest-practice-link-heading">
                <p className="eyebrow">{copy("New private link")}</p>
                <h2 id="latest-practice-link-heading" ref={latestLinkHeadingRef} tabIndex={-1}>
                  {copy("Save this link now")}
                </h2>
                <p>
                  {copy(
                    "Polling Pops stores only token hashes and cannot show the same links again.",
                  )}
                </p>
                <div className={styles.linkRow}>
                  <label className="field" htmlFor="latest-practice-link">
                    <span lang="">{receipt.label}</span>
                    <input
                      className="input"
                      id="latest-practice-link"
                      lang=""
                      readOnly
                      value={receipt.url}
                    />
                  </label>
                  <button
                    className="button-quiet"
                    disabled={busyAction !== ""}
                    onClick={() => void copyLatestLink()}
                    type="button"
                  >
                    {copy("Copy")}
                  </button>
                </div>
                <p
                  aria-live="polite"
                  className={copyLabel !== null ? "success" : "sr-only"}
                  role="status"
                >
                  {copyLabel !== null ? (
                    <>
                      {copy("Link copied.")} <bdi lang="">{copyLabel}</bdi>
                    </>
                  ) : null}
                </p>
              </section>
            ) : null}
            <section className={styles.accessCard} aria-labelledby="practice-access-heading">
              <div className={styles.sectionHeading}>
                <h2 id="practice-access-heading" ref={accessHeadingRef} tabIndex={-1}>
                  {copy("Private access")}
                </h2>
                <span className="status-pill">{formatNumber(locale, detail.access.length)}</span>
              </div>
              <p className={styles.muted}>
                {copy("Original links cannot be retrieved.")}{" "}
                {copy(
                  detail.followup.purpose === "recovery"
                    ? "Participant links from the source session can be revoked or accommodated here."
                    : personalPassCreationAvailable
                      ? "Create a one-attempt personal link for an individual."
                      : "Existing links remain available for status and revocation.",
                )}
              </p>
              {mutable &&
              detail.followup.purpose === "assignment" &&
              entitlements?.followups !== true ? (
                <div className="notice">
                  <p>
                    {copy(
                      "New personal links require Pro. You can still review or revoke access, create timing accommodations, and close practice.",
                    )}
                  </p>
                  <Link className="button-quiet small-button" href="/pricing">
                    {copy("Compare plans")}
                  </Link>
                </div>
              ) : null}
              {personalPassCreationAvailable ? (
                <form className={styles.personalForm} onSubmit={createPersonalPass}>
                  <label className="field" htmlFor="personal-pass-label">
                    <span>{copy("Personal link label")}</span>
                    <input
                      className="input"
                      id="personal-pass-label"
                      lang=""
                      maxLength={80}
                      onChange={(event) => setPersonalLabel(event.target.value)}
                      required
                      value={personalLabel}
                    />
                  </label>
                  <button className="button-quiet" disabled={busyAction !== ""} type="submit">
                    {copy(busyAction === "personal" ? "Creating…" : "Create personal link")}
                  </button>
                </form>
              ) : null}
              {detail.access.length ? (
                <div
                  aria-label={copy("Practice access links")}
                  className={styles.accessTable}
                  role="region"
                  tabIndex={0}
                >
                  <table>
                    <thead>
                      <tr>
                        <th>{copy("Label")}</th>
                        <th>{copy("Access")}</th>
                        <th>{copy("Status")}</th>
                        <th>{copy("Action")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.access.map((access) => (
                        <tr key={access.id}>
                          <td lang="">
                            <bdi>{access.nickname ?? access.label}</bdi>
                          </td>
                          <td>{accessType(access)}</td>
                          <td>
                            <span className="status-pill">{accessStatus(access)}</span>
                          </td>
                          <td>
                            {mutable && !access.revokedAt ? (
                              <button
                                className="danger-link"
                                disabled={busyAction !== ""}
                                onClick={() => void revoke(access.id)}
                                type="button"
                              >
                                {copy("Revoke")}
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
              ) : (
                <p className={styles.empty}>{copy("No private access links have been created.")}</p>
              )}
            </section>
            <div className={styles.controlGrid}>
              <section
                className={styles.accessCard}
                aria-labelledby="practice-accommodation-heading"
              >
                <h2 id="practice-accommodation-heading">{copy("Timing accommodation")}</h2>
                <p className={styles.muted}>
                  {copy(
                    detail.followup.timeMode === "flex"
                      ? "No countdown: every participant already has unlimited response time. No timing pass is needed."
                      : "Create a private 1.5× or 2× pass without storing a reason.",
                  )}
                </p>
                {mutable && detail.followup.timeMode === "timed" ? (
                  <form className={styles.fields} onSubmit={createAccommodation}>
                    <label className="field" htmlFor="accommodation-label">
                      <span>{copy("Pass label")}</span>
                      <input
                        className="input"
                        id="accommodation-label"
                        lang=""
                        maxLength={80}
                        onChange={(event) => setAccommodationLabel(event.target.value)}
                        required
                        value={accommodationLabel}
                      />
                    </label>
                    <label className="field" htmlFor="accommodation-time">
                      <span>{copy("Time allowance")}</span>
                      <select
                        className="select"
                        id="accommodation-time"
                        onChange={(event) =>
                          setTimeMultiplier(Number(event.target.value) as 1.5 | 2)
                        }
                        value={timeMultiplier}
                      >
                        <option value={1.5}>{formatNumber(locale, 1.5)}×</option>
                        <option value={2}>{formatNumber(locale, 2)}×</option>
                      </select>
                    </label>
                    <button className="button-quiet" disabled={busyAction !== ""} type="submit">
                      {copy(
                        busyAction === "accommodation" ? "Creating…" : "Create accommodation pass",
                      )}
                    </button>
                  </form>
                ) : null}
              </section>
              {mutable ? (
                <section className={styles.closeCard} aria-labelledby="close-practice-heading">
                  <h2 id="close-practice-heading">{copy("Close practice")}</h2>
                  <p className={styles.muted}>
                    {copy(
                      "Closing blocks every generic and private link immediately and cannot be undone.",
                    )}
                  </p>
                  <button
                    className="button-danger"
                    disabled={busyAction !== ""}
                    onClick={() => void closePractice()}
                    type="button"
                  >
                    {copy(busyAction === "close" ? "Closing…" : "Close practice for everyone")}
                  </button>
                </section>
              ) : null}
            </div>
          </>
        )}
      </div>
    </WorkspaceShell>
  );
}

function PracticeManagementContent() {
  const { id } = useParams<{ id: string }>();
  const { creator } = useWorkspace();
  // Route and authenticated actor changes discard the previous actor's private receipt.
  // The locale never participates in this identity.
  const actorKey = JSON.stringify([id, creator?.userId, creator?.workspaceId]);
  return <PracticeManagementController id={id} key={actorKey} />;
}
export default function PracticeManagementPage() {
  return (
    <WorkspaceProvider>
      <PracticeManagementContent />
    </WorkspaceProvider>
  );
}
