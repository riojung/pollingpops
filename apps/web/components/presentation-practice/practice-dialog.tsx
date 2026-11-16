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
import { EditorIcon } from "../presentation/presentation-editor-chrome";
import styles from "../presentation/presentation-delivery-dialog.module.css";
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
      <header className={styles.header}>
        <span className={styles.headerIcon}>
          <EditorIcon name="check" />
        </span>
        <h2 id="presentation-practice-title">Assign self-paced practice</h2>
        <button className={styles.closeButton} type="button" onClick={onClose}>
          <EditorIcon name="close" />
          <span className={styles.srOnly}>Close</span>
        </button>
      </header>
      <div className={styles.body}>
        <div className={styles.publication}>
          <span className={styles.publicationLabel}>
            <EditorIcon name="slides" />
            Published version only
          </span>
          <p>Draft changes and speaker notes stay private.</p>
        </div>
        <section className={styles.setup} aria-label="Set up practice">
          <div className={styles.sectionIntro}>
            <h3>Set up practice</h3>
            <p>
              Anyone with the assignment link can start a private practice attempt until the
              deadline or revocation.
            </p>
          </div>
          <div className={styles.setupControls}>
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
            <button
              className={styles.primaryButton}
              type="button"
              disabled={busy}
              onClick={() => void create()}
            >
              {busy ? "Working…" : pending ? "Retry assignment creation" : "Create assignment"}
            </button>
          </div>
          <p className={styles.hint}>
            No timer or points. Each answer is submitted once, with feedback after acceptance.
          </p>
          <details className={styles.guidance}>
            <summary>Practice details and supported content</summary>
            <div className={styles.guidanceBody}>
              <p>
                Readers mark content pages read and submit each answer once, then explicitly finish.
                Feedback appears after an answer is accepted. This practice has no timer or points;
                identity is not verified and results do not establish mastery.
              </p>
              <p>
                Supports 1–50 visible pages with 1–25 ordinary single-choice or true/false checks.
                Other activity formats, linked rechecks and required confidence are not supported.
                If the published version is unsupported, creation explains what to change.
              </p>
            </div>
          </details>
          {pending ? (
            <p className={styles.notice} role="status">
              An assignment request is pending. Retry to recover the same link.
            </p>
          ) : null}
        </section>
        {error ? <p role="alert">{error}</p> : null}
        {url ? (
          <section className={styles.created} aria-label="Created assignment link">
            <div className={styles.sectionIntro}>
              <h3>Your assignment is ready</h3>
              <p>Save this link before closing. To share again later, create a new assignment.</p>
            </div>
            <label>
              Your assignment link
              <textarea
                readOnly
                value={url}
                rows={2}
                onFocus={(event) => event.currentTarget.select()}
              />
            </label>
            <div className={styles.actions}>
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
              <a className={styles.actionLink} href={url} target="_blank" rel="noopener noreferrer">
                Open assignment
              </a>
            </div>
          </section>
        ) : null}
        <section className={styles.management} aria-label="Practice assignments">
          <div className={styles.sectionHeading}>
            <h3>Practice assignments</h3>
            <span className={styles.count}>{assignments.length}</span>
          </div>
          {assignments.length ? (
            <ul className={styles.shareList}>
              {assignments.map((assignment, index) => {
                const expired = Date.parse(assignment.expiresAt) <= Date.now();
                return (
                  <li key={assignment.id}>
                    <div className={styles.listRow}>
                      <div className={styles.itemDetails}>
                        <div className={styles.itemHeading}>
                          <strong>Practice assignment {index + 1}</strong>
                          <span
                            className={styles.badge}
                            data-inactive={!!assignment.revokedAt || expired}
                          >
                            {assignment.revokedAt ? "Revoked" : expired ? "Expired" : "Active"}
                          </span>
                        </div>
                        <span className={styles.itemMeta}>
                          Created{" "}
                          <time dateTime={assignment.createdAt}>
                            {new Date(assignment.createdAt).toLocaleString("en-CA")}
                          </time>
                        </span>
                        <span className={styles.itemMeta}>
                          Deadline{" "}
                          <time dateTime={assignment.expiresAt}>
                            {new Date(assignment.expiresAt).toLocaleString("en-CA")}
                          </time>
                        </span>
                      </div>
                      <div className={styles.actions}>
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
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className={styles.empty}>
              <span className={styles.emptyIcon}>
                <EditorIcon name="check" />
              </span>
              <p className={styles.emptyTitle}>No practice assignments yet.</p>
              <p className={styles.emptyDescription}>
                Create an assignment to share practice at your readers’ own pace.
              </p>
            </div>
          )}
        </section>
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
      </div>
    </dialog>
  );
}
