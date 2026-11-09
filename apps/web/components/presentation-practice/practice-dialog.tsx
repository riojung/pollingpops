"use client";
import { useEffect, useRef, useState } from "react";
import type {
  CreatePresentationPracticeAssignment,
  PresentationPracticeAssignmentMetadata,
} from "@openround/contracts";
import { ApiClientError, AUTH_CHANGE_EVENT, humanError } from "../../lib/api";
import {
  clearPracticeAssignmentIntent,
  createPracticeAssignment,
  listPracticeAssignments,
  loadPracticeAssignmentIntent,
  practiceAssignmentIntent,
  revokePracticeAssignment,
  savePracticeAssignmentIntent,
} from "../../lib/presentation-practice-client";
import styles from "../presentation-sharing/sharing.module.css";
import { PresentationPracticeInsights } from "./practice-insights";

export function PresentationPracticeButton({
  presentationId,
  versionId,
  actorKey,
  disabled = false,
  className,
}: {
  presentationId: string;
  actorKey: string;
  versionId: string | null;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const close = () => setOpen(false);
    window.addEventListener(AUTH_CHANGE_EVENT, close);
    return () => window.removeEventListener(AUTH_CHANGE_EVENT, close);
  }, []);
  return (
    <>
      <button
        className={className}
        type="button"
        disabled={disabled || !versionId}
        onClick={() => setOpen(true)}
      >
        Assign practice
      </button>
      {open && versionId ? (
        <PresentationPracticeDialog
          key={`${actorKey}:${presentationId}`}
          actorKey={actorKey}
          presentationId={presentationId}
          versionId={versionId}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
export function PresentationPracticeDialog({
  presentationId,
  versionId,
  actorKey,
  onClose,
}: {
  presentationId: string;
  actorKey: string;
  versionId: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    intent = useRef<CreatePresentationPracticeAssignment | null>(null),
    working = useRef(false),
    generation = useRef(0);
  const [assignments, setAssignments] = useState<PresentationPracticeAssignmentMetadata[]>([]),
    [days, setDays] = useState(7),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [insightsId, setInsightsId] = useState<string | null>(null),
    [url, setUrl] = useState("");
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.showModal();
    intent.current = loadPracticeAssignmentIntent(presentationId, actorKey);
    setPending(!!intent.current);
    const controller = new AbortController(),
      epoch = generation.current;
    const authChanged = () => {
      generation.current++;
      controller.abort();
      intent.current = null;
      setUrl("");
      setInsightsId(null);
      onClose();
    };
    window.addEventListener(AUTH_CHANGE_EVENT, authChanged);
    void listPracticeAssignments(presentationId, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted && generation.current === epoch) setAssignments(value);
      })
      .catch((caught) => {
        if (!controller.signal.aborted) setError(humanError(caught));
      });
    return () => {
      generation.current++;
      controller.abort();
      intent.current = null;
      window.removeEventListener(AUTH_CHANGE_EVENT, authChanged);
      previous?.focus();
    };
  }, [presentationId, actorKey]);
  async function create() {
    if (working.current) return;
    working.current = true;
    const epoch = generation.current;
    setBusy(true);
    setError("");
    setUrl("");
    let request: CreatePresentationPracticeAssignment | null = null;
    try {
      intent.current ??= practiceAssignmentIntent(versionId, days);
      request = intent.current;
      savePracticeAssignmentIntent(presentationId, actorKey, request);
      setPending(true);
      const result = await createPracticeAssignment(presentationId, request);
      if (generation.current !== epoch) return;
      setUrl(result.url);
      clearPracticeAssignmentIntent(presentationId, actorKey, request);
      intent.current = null;
      setPending(false);
      const refreshed = await listPracticeAssignments(presentationId);
      if (generation.current === epoch) setAssignments(refreshed);
    } catch (caught) {
      if (generation.current !== epoch) return;
      if (
        request &&
        caught instanceof ApiClientError &&
        ((caught.status === 410 && caught.code === "PRESENTATION_PRACTICE_REQUEST_EXPIRED") ||
          (caught.status === 422 &&
            ["PRESENTATION_PRACTICE_UNSUPPORTED_CONTENT", "PRESENTATION_PRACTICE_INVALID"].includes(
              caught.code,
            )))
      ) {
        clearPracticeAssignmentIntent(presentationId, actorKey, request);
        intent.current = null;
        setPending(false);
        setError(
          caught.code === "PRESENTATION_PRACTICE_REQUEST_EXPIRED"
            ? "The pending request expired before it was accepted. Choose a deadline and create a new assignment."
            : humanError(caught),
        );
      } else setError(humanError(caught));
    } finally {
      if (generation.current === epoch) {
        working.current = false;
        setBusy(false);
      }
    }
  }
  async function revoke(id: string) {
    if (working.current) return;
    working.current = true;
    const epoch = generation.current;
    setBusy(true);
    setError("");
    try {
      await revokePracticeAssignment(presentationId, id);
      if (generation.current !== epoch) return;
      const refreshed = await listPracticeAssignments(presentationId);
      if (generation.current === epoch) setAssignments(refreshed);
      setUrl("");
    } catch (caught) {
      if (generation.current === epoch) setError(humanError(caught));
    } finally {
      if (generation.current === epoch) {
        working.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby="presentation-practice-title"
      lang="en-CA"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className={styles.controls}>
        <h2 id="presentation-practice-title">Assign self-paced practice</h2>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
      <p>
        Assigns this published version. Draft changes and speaker notes stay private. Anyone with
        the assignment link can start a private practice attempt until the deadline or revocation.
      </p>
      <p>
        Readers mark content pages read and submit each answer once, then explicitly finish.
        Feedback appears after an answer is accepted. This practice has no timer or points; identity
        is not verified and results do not establish mastery.
      </p>
      <p>
        Supports 1–50 visible pages with 1–25 ordinary single-choice or true/false checks. Other
        activity formats, linked rechecks and required confidence are not supported. If the
        published version is unsupported, creation explains what to change.
      </p>
      <label>
        Practice deadline
        <select
          disabled={busy || pending}
          value={days}
          onChange={(event) => setDays(Number(event.target.value))}
        >
          <option value={1}>In 1 day</option>
          <option value={7}>In 7 days</option>
          <option value={30}>In 30 days</option>
        </select>
      </label>
      {pending ? (
        <p role="status">An assignment request is pending. Retry to recover the same link.</p>
      ) : null}
      <button type="button" disabled={busy} onClick={() => void create()}>
        {busy ? "Working…" : pending ? "Retry assignment creation" : "Create assignment"}
      </button>
      {error ? <p role="alert">{error}</p> : null}
      {url ? (
        <div className={styles.created}>
          <p>Save this link before closing. To share again later, create a new assignment.</p>
          <label>
            Your assignment link
            <textarea
              readOnly
              value={url}
              rows={3}
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>
          <button
            type="button"
            onClick={() => {
              if (!navigator.clipboard?.writeText) {
                setError("Select and copy the link above.");
                return;
              }
              void navigator.clipboard
                .writeText(url)
                .catch(() => setError("Select and copy the link above."));
            }}
          >
            Copy assignment link
          </button>
          <a href={url} target="_blank" rel="noopener noreferrer">
            Open assignment
          </a>
        </div>
      ) : null}
      <h3>Practice assignments</h3>
      {assignments.length ? (
        <ul className={styles.shareList}>
          {assignments.map((assignment) => {
            const expired = Date.parse(assignment.expiresAt) <= Date.now();
            return (
              <li key={assignment.id}>
                <span>
                  Created {new Date(assignment.createdAt).toLocaleString("en-CA")}
                  <br />
                  {assignment.revokedAt
                    ? "Revoked"
                    : expired
                      ? "Expired"
                      : `Deadline ${new Date(assignment.expiresAt).toLocaleString("en-CA")}`}
                </span>
                <button
                  type="button"
                  aria-pressed={insightsId === assignment.id}
                  onClick={() => setInsightsId(assignment.id)}
                >
                  Practice insights
                </button>
                <button
                  type="button"
                  disabled={busy || !!assignment.revokedAt || expired}
                  onClick={() => void revoke(assignment.id)}
                >
                  Revoke assignment
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p>No practice assignments yet.</p>
      )}
      {assignments
        .filter((assignment) => assignment.id === insightsId)
        .map((assignment) => (
          <PresentationPracticeInsights
            key={`${actorKey}:${presentationId}:${assignment.id}:${assignment.versionId}`}
            actorKey={actorKey}
            presentationId={presentationId}
            assignment={assignment}
          />
        ))}
    </dialog>
  );
}
