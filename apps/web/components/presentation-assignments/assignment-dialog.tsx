"use client";
import { useEffect, useRef, useState } from "react";
import type {
  CreatePresentationAssignment,
  PresentationAssignmentMetadata,
} from "@openround/contracts";
import { ApiClientError, AUTH_CHANGE_EVENT, humanError } from "../../lib/api";
import {
  clearReadingAssignmentIntent,
  createReadingAssignment,
  listReadingAssignments,
  loadReadingAssignmentIntent,
  readingAssignmentIntent,
  revokeReadingAssignment,
  saveReadingAssignmentIntent,
} from "../../lib/presentation-assignments-client";
import styles from "../presentation-sharing/sharing.module.css";
import { PresentationReadingInsights } from "./reading-insights";

export function PresentationAssignmentButton({
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
        Assign reading
      </button>
      {open && versionId ? (
        <PresentationAssignmentDialog
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
export function PresentationAssignmentDialog({
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
    intent = useRef<CreatePresentationAssignment | null>(null),
    working = useRef(false),
    generation = useRef(0);
  const [assignments, setAssignments] = useState<PresentationAssignmentMetadata[]>([]),
    [days, setDays] = useState(7),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [insightsId, setInsightsId] = useState<string | null>(null),
    [url, setUrl] = useState("");
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.showModal();
    intent.current = loadReadingAssignmentIntent(presentationId, actorKey);
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
    void listReadingAssignments(presentationId, controller.signal)
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
    let request: CreatePresentationAssignment | null = null;
    try {
      intent.current ??= readingAssignmentIntent(versionId, days);
      request = intent.current;
      saveReadingAssignmentIntent(presentationId, actorKey, request);
      setPending(true);
      const result = await createReadingAssignment(presentationId, request);
      if (generation.current !== epoch) return;
      setUrl(result.url);
      clearReadingAssignmentIntent(presentationId, actorKey, request);
      intent.current = null;
      setPending(false);
      const refreshed = await listReadingAssignments(presentationId);
      if (generation.current === epoch) setAssignments(refreshed);
    } catch (caught) {
      if (generation.current !== epoch) return;
      if (
        request &&
        caught instanceof ApiClientError &&
        caught.status === 410 &&
        caught.code === "PRESENTATION_ASSIGNMENT_REQUEST_EXPIRED"
      ) {
        clearReadingAssignmentIntent(presentationId, actorKey, request);
        intent.current = null;
        setPending(false);
        setError(
          "The pending request expired before it was accepted. Choose a deadline and create a new assignment.",
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
      await revokeReadingAssignment(presentationId, id);
      if (generation.current !== epoch) return;
      const refreshed = await listReadingAssignments(presentationId);
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
      aria-labelledby="presentation-assignment-title"
      lang="en-CA"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className={styles.controls}>
        <h2 id="presentation-assignment-title">Assign a reading assignment</h2>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
      <p>
        Assigns this published version. Draft changes and speaker notes stay private. Anyone with
        the assignment link can start their own reader until the deadline or revocation.
      </p>
      <p>
        Readers mark each page read and explicitly finish. This is self-reported reading completion;
        identity is not verified. Questions are read-only. Responses, scores and mastery are not
        collected.
      </p>
      <label>
        Reading deadline
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
      <h3>Reading assignments</h3>
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
                  Reading insights
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
        <p>No reading assignments yet.</p>
      )}
      {assignments
        .filter((assignment) => assignment.id === insightsId)
        .map((assignment) => (
          <PresentationReadingInsights
            key={`${actorKey}:${presentationId}:${assignment.id}:${assignment.versionId}`}
            actorKey={actorKey}
            presentationId={presentationId}
            assignment={assignment}
          />
        ))}
    </dialog>
  );
}
