"use client";

import { useEffect, useRef, useState } from "react";
import {
  EnablePresentationReviewSchema,
  PresentationReviewFeedbackMutationSchema,
  type EnablePresentationReview,
  type PresentationReviewFeedback,
  type PresentationReviewFeedbackCommand,
  type PresentationReviewFeedbackMutation,
  type PresentationReviewFeedbackThread,
} from "@openround/contracts";
import { ApiClientError, AUTH_CHANGE_EVENT, humanError } from "../../lib/api";
import {
  fetchPresentationAuthorFeedback,
  enablePresentationReview,
  mutatePresentationAuthorFeedback,
  fetchPresentationReviewerAccess,
  fetchPresentationReviewerFeedback,
  mutatePresentationReviewerFeedback,
} from "../../lib/presentation-review-feedback-client";
import { fetchPresentationShareAccess } from "../../lib/presentation-sharing-client";
import { clientUuid } from "../../lib/uuid";
import styles from "./feedback-panel.module.css";

type Props = {
  shareId: string;
  versionId: string;
} & (
  | { mode: "author"; presentationId: string }
  | {
      mode: "reviewer";
      token: string;
      blockId: string;
      blockIndex: number;
      onAccessLost: () => void;
    }
);
type Draft = { text: string; blockId: string; blockIndex: number };
type Pending =
  | { kind: "enable"; viewerKey: string; request: EnablePresentationReview }
  | { kind: "mutation"; viewerKey: string; request: PresentationReviewFeedbackMutation };
type Recovery = {
  viewerKey: string;
  versionId: string;
  draft: Draft | null;
  pending: Pending | null;
};
export function presentationFeedbackRecoveryKey(mode: Props["mode"], shareId: string) {
  return `openround:presentation-feedback:${mode}:${shareId.toLowerCase()}`;
}
export function clearPresentationFeedbackRecovery(mode: Props["mode"], shareId: string) {
  try {
    sessionStorage.removeItem(presentationFeedbackRecoveryKey(mode, shareId));
  } catch {
    // Storage may be unavailable. In-memory recovery still works for this visit.
  }
}
function saveRecovery(mode: Props["mode"], shareId: string, value: Recovery) {
  try {
    sessionStorage.setItem(presentationFeedbackRecoveryKey(mode, shareId), JSON.stringify(value));
  } catch {
    // Do not turn a valid comment into a failed operation when storage is restricted.
  }
}
function loadRecovery(mode: Props["mode"], shareId: string): Recovery | null {
  try {
    const raw = sessionStorage.getItem(presentationFeedbackRecoveryKey(mode, shareId));
    if (!raw || raw.length > 16_000) return null;
    const value = JSON.parse(raw) as Recovery;
    if (!/^[a-f0-9]{64}$/.test(value.viewerKey) || !value.versionId) return null;
    if (
      value.draft &&
      (typeof value.draft.text !== "string" ||
        value.draft.text.length > 2000 ||
        !/^[a-f0-9-]{36}$/i.test(value.draft.blockId) ||
        !Number.isInteger(value.draft.blockIndex) ||
        value.draft.blockIndex < 0 ||
        value.draft.blockIndex > 199)
    )
      return null;
    if (value.pending) {
      if (value.pending.viewerKey !== value.viewerKey) return null;
      if (value.pending.kind === "mutation") {
        value.pending.request = PresentationReviewFeedbackMutationSchema.parse(
          value.pending.request,
        );
        if (value.pending.request.viewerKey !== value.viewerKey) return null;
      } else if (value.pending.kind === "enable")
        value.pending.request = EnablePresentationReviewSchema.parse(value.pending.request);
      else return null;
      if (value.pending.request.versionId !== value.versionId) return null;
    }
    return value;
  } catch {
    return null;
  }
}
function isDenied(error: unknown) {
  return error instanceof ApiClientError && [401, 403, 404, 410].includes(error.status);
}

export function PresentationFeedbackPanel(props: Props) {
  const [feedback, setFeedback] = useState<PresentationReviewFeedback | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "signin" | "unsupported" | "error">(
    "loading",
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [acceptedCommand, setAcceptedCommand] = useState<PresentationReviewFeedbackCommand | null>(
    null,
  );
  const current = useRef(props);
  current.current = props;
  const snapshot = useRef<PresentationReviewFeedback | null>(null);
  const recovery = useRef<Recovery | null>(null);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);

  function forget() {
    recovery.current = null;
    snapshot.current = null;
    setFeedback(null);
    setPending(null);
    setDraft(null);
    setAcceptedCommand(null);
    clearPresentationFeedbackRecovery(current.current.mode, current.current.shareId);
  }
  function persist(next: Recovery) {
    recovery.current = next;
    setDraft(next.draft);
    setPending(next.pending);
    saveRecovery(current.current.mode, current.current.shareId, next);
  }
  function accept(value: PresentationReviewFeedback) {
    const previous = recovery.current;
    if (value.versionId.toLowerCase() !== current.current.versionId.toLowerCase())
      throw new ApiClientError(
        "This review version is unavailable.",
        "PRESENTATION_REVIEW_UNAVAILABLE",
        404,
      );
    if (
      previous &&
      (previous.viewerKey !== value.viewerKey || previous.versionId !== value.versionId)
    ) {
      forget();
      setError("Your account or review changed. Previous drafts and pending actions were cleared.");
    }
    const retained = recovery.current;
    persist({
      viewerKey: value.viewerKey,
      versionId: value.versionId,
      draft: retained?.draft ?? null,
      pending: retained?.pending ?? null,
    });
    snapshot.current = value;
    setFeedback(value);
    setState("ready");
  }
  async function read(signal?: AbortSignal) {
    const source = current.current;
    return source.mode === "author"
      ? fetchPresentationAuthorFeedback(source.presentationId, source.shareId, signal)
      : fetchPresentationReviewerFeedback(source.shareId, source.token, signal);
  }
  async function failure(caught: unknown, signal: AbortSignal) {
    if (signal?.aborted) return;
    const source = current.current;
    if (source.mode === "reviewer" && caught instanceof ApiClientError && caught.status === 404) {
      // An older server can serve E08 without the optional feedback routes.
      try {
        const access = await fetchPresentationShareAccess(source.shareId, source.token, signal);
        if (signal?.aborted) return;
        if (access.versionId.toLowerCase() === source.versionId.toLowerCase()) {
          snapshot.current = null;
          setFeedback(null);
          setState("unsupported");
          return;
        }
      } catch (verification) {
        if (signal?.aborted) return;
        if (!isDenied(verification)) {
          setError("Could not verify review access. Refresh feedback to try again.");
          return;
        }
      }
      forget();
      source.onAccessLost();
      return;
    }
    if (isDenied(caught)) {
      forget();
      if (source.mode === "reviewer" && caught instanceof ApiClientError && caught.status === 401)
        setState("signin");
      else {
        setState("error");
        setError("Review feedback is unavailable.");
        if (source.mode === "reviewer") source.onAccessLost();
      }
    } else {
      setError(humanError(caught));
      if (!snapshot.current) setState("error");
    }
  }
  async function refresh(discover = false) {
    const epoch = ++generation.current;
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    setError("");
    try {
      const source = current.current;
      if (discover && source.mode === "reviewer") {
        const access = await fetchPresentationReviewerAccess(
          source.shareId,
          source.token,
          next.signal,
        );
        if (next.signal.aborted || epoch !== generation.current) return;
        if (!access.enabled) {
          forget();
          setState("unsupported");
          return;
        }
      }
      const value = await read(next.signal);
      if (!next.signal.aborted && epoch === generation.current) accept(value);
    } catch (caught) {
      if (epoch === generation.current) await failure(caught, next.signal);
    }
  }
  useEffect(() => {
    recovery.current = loadRecovery(props.mode, props.shareId);
    void refresh(true);
    const authChanged = () => {
      ++generation.current;
      controller.current?.abort();
      forget();
      setBusy(false);
      setState("loading");
      void refresh(true);
    };
    const focused = () => {
      if (!inFlight.current) void refresh(true);
    };
    window.addEventListener(AUTH_CHANGE_EVENT, authChanged);
    window.addEventListener("focus", focused);
    return () => {
      ++generation.current;
      controller.current?.abort();
      window.removeEventListener(AUTH_CHANGE_EVENT, authChanged);
      window.removeEventListener("focus", focused);
    };
    // Page changes deliberately retain the original composer anchor and pending intent.
  }, [props.mode, props.shareId, props.versionId, props.mode === "reviewer" ? props.token : null]);

  async function send(
    command?: PresentationReviewFeedbackCommand,
    enable = false,
  ): Promise<boolean> {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    setError("");
    const source = current.current;
    const epoch = generation.current;
    const next = new AbortController();
    controller.current?.abort();
    controller.current = next;
    let request = recovery.current?.pending ?? null;
    try {
      // Revalidate identity before sending or replaying an account-bound exact intent.
      const fresh = await read(next.signal);
      if (next.signal.aborted || epoch !== generation.current) return false;
      const expectedViewer = request?.viewerKey ?? snapshot.current?.viewerKey;
      accept(fresh);
      if (expectedViewer !== fresh.viewerKey) {
        setError("Your account changed. Review the feedback before posting again.");
        return false;
      }
      if (!request) {
        request = enable
          ? {
              kind: "enable",
              viewerKey: fresh.viewerKey,
              request: { operationId: clientUuid(), versionId: fresh.versionId },
            }
          : {
              kind: "mutation",
              viewerKey: fresh.viewerKey,
              request: PresentationReviewFeedbackMutationSchema.parse({
                schemaVersion: 1,
                operationId: clientUuid(),
                versionId: fresh.versionId,
                viewerKey: fresh.viewerKey,
                command,
              }),
            };
        persist({ ...recovery.current!, pending: request });
      }
      const result =
        request.kind === "enable" && source.mode === "author"
          ? await enablePresentationReview(
              source.presentationId,
              source.shareId,
              request.request,
              next.signal,
            )
          : request.kind === "mutation"
            ? source.mode === "author"
              ? await mutatePresentationAuthorFeedback(
                  source.presentationId,
                  source.shareId,
                  request.request,
                  next.signal,
                )
              : await mutatePresentationReviewerFeedback(
                  source.shareId,
                  source.token,
                  request.request,
                  next.signal,
                )
            : null;
      if (!result || next.signal.aborted || epoch !== generation.current) return false;
      const savedDraft = recovery.current?.draft;
      const sent = request.kind === "mutation" ? request.request.command : null;
      const clearDraft =
        sent?.type === "thread.create" &&
        savedDraft?.blockId === sent.blockId &&
        savedDraft.text.normalize("NFC").trim() === sent.text;
      persist({
        ...recovery.current!,
        pending: null,
        draft: clearDraft ? null : (savedDraft ?? null),
      });
      accept(result.feedback);
      setAcceptedCommand(sent);
      return true;
    } catch (caught) {
      if (next.signal.aborted || epoch !== generation.current) return false;
      if (caught instanceof ApiClientError && [409, 422].includes(caught.status)) {
        if (recovery.current) persist({ ...recovery.current, pending: null });
        setError(
          "Feedback changed or this action could not be accepted. Your text is retained. Refresh feedback before trying again.",
        );
      } else await failure(caught, next.signal);
      return false;
    } finally {
      inFlight.current = false;
      if (epoch === generation.current) setBusy(false);
    }
  }
  const disabled = busy || !!pending || feedback?.status !== "open";
  return (
    <section
      className={styles.panel}
      aria-label={
        props.mode === "author" ? "Author review feedback" : "Presentation review feedback"
      }
    >
      <div className={styles.toolbar}>
        <h2>Review feedback</h2>
        <button type="button" disabled={busy} onClick={() => void refresh(true)}>
          Refresh feedback
        </button>
      </div>
      {state === "loading" ? <p role="status">Loading feedback…</p> : null}
      {state === "unsupported" ? <p>Comments are not enabled for this link.</p> : null}
      {state === "signin" && props.mode === "reviewer" ? (
        <p>
          <a
            href={`/signin?returnTo=${encodeURIComponent(`/presentation-review/${props.shareId}`)}`}
          >
            Sign in to comment
          </a>
          . A free account is enough; no workspace invitation is needed.
        </p>
      ) : null}
      {feedback ? (
        <>
          <p>
            Published version {feedback.version} ·{" "}
            {feedback.status === "closed"
              ? "Review closed"
              : "Feedback stays with this review link."}
          </p>
          {props.mode === "author" ? (
            <>
              <p role="status">
                {feedback.approval.state === "approved"
                  ? "This review is approved."
                  : feedback.approval.state === "stale"
                    ? "Approval is stale. New feedback needs review."
                    : "This review is not approved."}
              </p>
              {feedback.capabilities.enable ? (
                <>
                  <p>
                    Enabling comments lets signed-in people with this link see and comment on its
                    feedback.
                  </p>
                  <button
                    type="button"
                    disabled={busy || !!pending}
                    onClick={() => void send(undefined, true)}
                  >
                    Enable comments
                  </button>
                </>
              ) : null}
              {feedback.capabilities.approve ? (
                <button
                  type="button"
                  disabled={
                    disabled ||
                    feedback.threads.some((thread) => !thread.resolved) ||
                    feedback.approval.state === "approved"
                  }
                  onClick={() =>
                    void send({
                      type: "approval.set",
                      expectedReviewSeq: feedback.reviewSeq,
                      approved: true,
                    })
                  }
                >
                  Approve this review
                </button>
              ) : null}
            </>
          ) : null}
          {props.mode === "reviewer" && feedback.capabilities.comment ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (draft?.text.trim())
                  void send({
                    type: "thread.create",
                    threadId: clientUuid(),
                    messageId: clientUuid(),
                    blockId: draft.blockId,
                    text: draft.text,
                  });
              }}
            >
              <label>
                Comment on this page
                <textarea
                  rows={4}
                  maxLength={2000}
                  disabled={disabled}
                  value={draft?.text ?? ""}
                  onChange={(event) => {
                    const nextDraft = draft ?? {
                      text: "",
                      blockId: props.blockId,
                      blockIndex: props.blockIndex,
                    };
                    persist({
                      ...recovery.current!,
                      draft:
                        event.target.value === ""
                          ? null
                          : { ...nextDraft, text: event.target.value },
                    });
                  }}
                />
              </label>
              <p>
                Commenting on published page {(draft?.blockIndex ?? props.blockIndex) + 1}, version{" "}
                {feedback.version}.
              </p>
              <button type="submit" disabled={disabled || !draft?.text.trim()}>
                Post comment
              </button>
            </form>
          ) : null}
          {feedback.threads.length ? (
            <div className={styles.threads}>
              {feedback.threads.map((thread) => (
                <PresentationFeedbackThread
                  key={`${feedback.viewerKey}:${thread.id}`}
                  thread={thread}
                  comment={feedback.capabilities.comment}
                  resolve={feedback.capabilities.resolve}
                  disabled={disabled}
                  pending={pending?.kind === "mutation" ? pending.request.command : null}
                  acceptedCommand={acceptedCommand}
                  onCommand={(command) => send(command)}
                />
              ))}
            </div>
          ) : feedback.status === "open" ? (
            <p>No comments yet.</p>
          ) : null}
        </>
      ) : null}
      {pending ? (
        <div role="status">
          <p>An action is awaiting confirmation. Retry to recover the same action.</p>
          <button type="button" disabled={busy} onClick={() => void send()}>
            Retry pending action
          </button>
        </div>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}

export function PresentationFeedbackThread({
  thread,
  comment,
  resolve,
  disabled,
  pending,
  acceptedCommand,
  onCommand,
}: {
  thread: PresentationReviewFeedbackThread;
  comment: boolean;
  resolve: boolean;
  disabled: boolean;
  pending: PresentationReviewFeedbackCommand | null;
  acceptedCommand?: PresentationReviewFeedbackCommand | null;
  onCommand: (command: PresentationReviewFeedbackCommand) => Promise<boolean>;
}) {
  const restored =
    pending && "threadId" in pending && pending.threadId === thread.id ? pending : null;
  const [reply, setReply] = useState(restored?.type === "message.reply" ? restored.text : "");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(
    restored?.type === "message.edit" ? { id: restored.messageId, text: restored.text } : null,
  );
  useEffect(() => {
    if (
      !acceptedCommand ||
      !("threadId" in acceptedCommand) ||
      acceptedCommand.threadId !== thread.id
    )
      return;
    if (acceptedCommand.type === "message.reply")
      setReply((current) =>
        current.normalize("NFC").trim() === acceptedCommand.text ? "" : current,
      );
    if (acceptedCommand.type === "message.edit")
      setEditing((current) =>
        current?.id === acceptedCommand.messageId &&
        current.text.normalize("NFC").trim() === acceptedCommand.text
          ? null
          : current,
      );
  }, [acceptedCommand, thread.id]);
  return (
    <article className={styles.thread} aria-label="Review thread">
      <h3>
        Published page {thread.blockIndex + 1} · {thread.resolved ? "Resolved" : "Open"}
      </h3>
      {thread.messages.map((message) => (
        <div key={message.id} className={styles.message}>
          <p className={styles.byline}>
            {message.authorLabel}
            {message.isOwn ? " (you)" : ""}
          </p>
          {message.deleted ? (
            <p>Comment deleted.</p>
          ) : (
            <p className={styles.body}>{message.text}</p>
          )}
          {comment && message.isOwn && !message.deleted ? (
            <>
              {editing?.id === message.id ? (
                <form
                  onSubmit={async (event) => {
                    event.preventDefault();
                    const submitted = editing;
                    if (
                      submitted.text.trim() &&
                      (await onCommand({
                        type: "message.edit",
                        threadId: thread.id,
                        expectedThreadVersion: thread.version,
                        messageId: message.id,
                        text: submitted.text,
                      }))
                    )
                      setEditing((current) =>
                        current?.id === submitted.id && current.text === submitted.text
                          ? null
                          : current,
                      );
                  }}
                >
                  <label>
                    Edit comment
                    <textarea
                      rows={3}
                      maxLength={2000}
                      disabled={disabled}
                      value={editing.text}
                      onChange={(event) => setEditing({ id: message.id, text: event.target.value })}
                    />
                  </label>
                  <div className={styles.toolbar}>
                    <button type="submit" disabled={disabled || !editing.text.trim()}>
                      Save edit
                    </button>
                    <button type="button" disabled={disabled} onClick={() => setEditing(null)}>
                      Cancel edit
                    </button>
                  </div>
                </form>
              ) : (
                <div className={styles.toolbar}>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => setEditing({ id: message.id, text: message.text })}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() =>
                      onCommand({
                        type: "message.delete",
                        threadId: thread.id,
                        expectedThreadVersion: thread.version,
                        messageId: message.id,
                      })
                    }
                  >
                    Delete
                  </button>
                </div>
              )}
            </>
          ) : null}
        </div>
      ))}
      {comment && !thread.resolved ? (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            const submitted = reply;
            if (
              submitted.trim() &&
              (await onCommand({
                type: "message.reply",
                threadId: thread.id,
                expectedThreadVersion: thread.version,
                messageId: clientUuid(),
                text: submitted,
              }))
            )
              setReply((current) => (current === submitted ? "" : current));
          }}
        >
          <label>
            Reply to this thread
            <textarea
              rows={2}
              maxLength={2000}
              disabled={disabled}
              value={reply}
              onChange={(event) => setReply(event.target.value)}
            />
          </label>
          <button type="submit" disabled={disabled || !reply.trim()}>
            Reply
          </button>
        </form>
      ) : comment && thread.resolved ? (
        <p>An author must reopen this thread before you can reply.</p>
      ) : null}
      {resolve ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() =>
            onCommand({
              type: "thread.resolve",
              threadId: thread.id,
              expectedThreadVersion: thread.version,
              resolved: !thread.resolved,
            })
          }
        >
          {thread.resolved ? "Reopen" : "Resolve"}
        </button>
      ) : null}
    </article>
  );
}
