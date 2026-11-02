"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { BoardInvitationBatchResponse } from "@openround/contracts";
import { useLocale } from "../locale-provider";
import { useWorkspace } from "../workspace/workspace-provider";
import { ApiClientError, AUTH_CHANGE_EVENT } from "../../lib/api";
import { clientUuid } from "../../lib/uuid";
import { canvasSharingMessages } from "../../lib/i18n/canvas-sharing-messages";
import {
  parseBoardInvitationEmails,
  sendBoardInvitations,
  type BoardInvitationIntent,
  type BoardInvitationTarget,
} from "../canvas-boards/canvas-sharing-client";
import styles from "../canvas-boards/canvas-sharing.module.css";

interface BoardEmailInvitationProps {
  target: BoardInvitationTarget;
  disabled?: boolean;
  onLockChange?: (locked: boolean) => void;
  onRefresh?: () => void;
  revokedInvitationIds?: readonly string[];
}
export function BoardEmailInvitations(props: BoardEmailInvitationProps) {
  return (
    <BoardEmailInvitationsContent key={`${props.target.kind}:${props.target.id}`} {...props} />
  );
}
function BoardEmailInvitationsContent({
  target,
  disabled = false,
  onLockChange,
  onRefresh,
  revokedInvitationIds = [],
}: BoardEmailInvitationProps) {
  const { locale, t } = useLocale();
  const copy = canvasSharingMessages(locale);
  const id = useId();
  const [emails, setEmails] = useState("");
  const [role, setRole] = useState<"editor" | "viewer" | "facilitator">("editor");
  const [intent, setIntent] = useState<BoardInvitationIntent | null>(null);
  const [result, setResult] = useState<BoardInvitationBatchResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [terminalError, setTerminalError] = useState(false);
  const [retryAt, setRetryAt] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const operation = useRef<BoardInvitationIntent | null>(null);
  const hasUnknown = Boolean(result?.results.some((row) => row.status === "unknown"));
  const pending = Boolean(intent && !terminalError && (!result || !result.complete));
  const locked = busy || pending || hasUnknown;
  const canRetry = pending && !busy && retryAt <= Date.now();
  useEffect(() => {
    const active = new AbortController();
    controller.current = active;
    const authorizationChanged = () => active.abort();
    window.addEventListener(AUTH_CHANGE_EVENT, authorizationChanged);
    return () => {
      active.abort();
      window.removeEventListener(AUTH_CHANGE_EVENT, authorizationChanged);
    };
  }, [target.kind, target.id]);
  useEffect(() => {
    onLockChange?.(locked);
    return () => onLockChange?.(false);
  }, [locked, onLockChange]);
  useEffect(() => {
    if (!retryAt) return;
    const timer = setTimeout(() => setRetryAt(0), Math.max(0, retryAt - Date.now()));
    return () => clearTimeout(timer);
  }, [retryAt]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (disabled || inFlight.current || (intent && !canRetry)) return;
    let next = operation.current;
    if (!next) {
      const parsed = parseBoardInvitationEmails(emails);
      if (parsed.error) {
        setError(
          parsed.error === "empty"
            ? copy.emailEmpty
            : parsed.error === "limit"
              ? copy.emailLimit
              : copy.emailInvalid,
        );
        return;
      }
      next = {
        operationId: clientUuid(),
        emails: parsed.emails,
        ...(target.kind === "collaborators" ? { role } : {}),
      };
      operation.current = next;
      setIntent(next);
    }
    const active = controller.current;
    if (!active || active.signal.aborted) return;
    inFlight.current = true;
    onLockChange?.(true);
    setBusy(true);
    setError("");
    let remainsLocked = true;
    try {
      const response = await sendBoardInvitations(target, next, active.signal);
      if (active.signal.aborted || controller.current !== active) return;
      setResult(response);
      remainsLocked = response.results.some(
        (row) => row.status === "pending" || row.status === "unknown",
      );
      setUncertain(false);
      setTerminalError(false);
      onRefresh?.();
    } catch (caught) {
      if (active.signal.aborted || controller.current !== active) return;
      const definitive =
        caught instanceof ApiClientError && caught.status < 500 && caught.status !== 429;
      remainsLocked = !definitive;
      setTerminalError(definitive);
      setUncertain(!definitive);
      if (caught instanceof ApiClientError && caught.status === 429 && caught.retryAfterSeconds)
        setRetryAt(Date.now() + caught.retryAfterSeconds * 1000);
      setError(definitive ? copy.requestFailed : copy.notConfirmed);
    } finally {
      if (!active.signal.aborted && controller.current === active) {
        inFlight.current = false;
        setBusy(false);
        onLockChange?.(remainsLocked);
      }
    }
  }
  function reset() {
    if (busy || disabled) return;
    if ((hasUnknown || uncertain || pending) && !window.confirm(copy.newBatchConfirm)) return;
    operation.current = null;
    setIntent(null);
    setResult(null);
    setEmails("");
    setError("");
    setUncertain(false);
    setTerminalError(false);
    setRetryAt(0);
  }
  return (
    <div className={styles.emailPanel}>
      <p className={styles.help}>
        {target.kind === "guests" ? copy.guestHelp : copy.collaboratorHelp}
      </p>
      {target.kind === "guests" ? <p className={styles.scopeNote}>{copy.guestWarning}</p> : null}
      <form className={styles.form} onSubmit={(event) => void submit(event)}>
        <label className={styles.field}>
          <span>{target.kind === "guests" ? copy.guestEmails : copy.emails}</span>
          <textarea
            data-autofocus
            rows={4}
            required
            maxLength={6600}
            value={emails}
            disabled={disabled || busy || intent !== null}
            aria-describedby={`${id}-email-help`}
            onChange={(event) => setEmails(event.target.value)}
            autoCapitalize="none"
            spellCheck={false}
          />
        </label>
        <p id={`${id}-email-help`} className={styles.help}>
          {copy.emailHelp}
        </p>
        {target.kind === "collaborators" ? (
          <label className={styles.field}>
            <span>{t("canvas.inviteRole")}</span>
            <select
              value={role}
              disabled={disabled || busy || intent !== null}
              onChange={(event) => setRole(event.target.value as typeof role)}
            >
              {(["editor", "facilitator", "viewer"] as const).map((value) => (
                <option key={value} value={value}>
                  {t(`canvas.${value}`)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        <div className={styles.actions}>
          <button
            type="submit"
            className="button"
            disabled={
              disabled || busy || (!intent && !emails.trim()) || Boolean(intent && !canRetry)
            }
          >
            {busy ? copy.sending : intent ? copy.retry : copy.send}
          </button>
          {intent ? (
            <button
              type="button"
              className="button-quiet"
              disabled={disabled || busy}
              onClick={reset}
            >
              {copy.newBatch}
            </button>
          ) : null}
        </div>
      </form>
      {hasUnknown ? (
        <p className={styles.scopeNote} role="status">
          {copy.unknownHelp}
        </p>
      ) : null}
      {result ? (
        <section aria-label={copy.results} className={styles.results}>
          <h3>{copy.results}</h3>
          <ul className={styles.rows}>
            {result.results.map((row) => (
              <li key={row.email}>
                <span className={styles.person} lang="">
                  {row.email}
                </span>
                <span className={styles.outcome} data-status={row.status}>
                  {copy[row.status]}
                </span>
                {target.kind === "collaborators" &&
                row.invitationId &&
                !revokedInvitationIds.includes(row.invitationId) ? (
                  <a href={`/canvas/invitations/${row.invitationId}`}>{t("boards.link")}</a>
                ) : null}
              </li>
            ))}
          </ul>
          {result.complete ? <p className={styles.help}>{copy.newBatchHelp}</p> : null}
        </section>
      ) : null}
    </div>
  );
}

export function GuestInvitationDialog({
  sourceBoardId,
  title,
  onClose,
}: {
  sourceBoardId: string;
  title: string;
  onClose: () => void;
}) {
  const { creator } = useWorkspace();
  return (
    <GuestInvitationDialogContent
      key={`${sourceBoardId}:${creator?.userId}:${creator?.workspaceId}`}
      sourceBoardId={sourceBoardId}
      title={title}
      onClose={onClose}
    />
  );
}
function GuestInvitationDialogContent({
  sourceBoardId,
  title,
  onClose,
}: {
  sourceBoardId: string;
  title: string;
  onClose: () => void;
}) {
  const { locale } = useLocale();
  const copy = canvasSharingMessages(locale);
  const dialog = useRef<HTMLDialogElement>(null);
  const closeOnAuthChange = useRef(onClose);
  closeOnAuthChange.current = onClose;
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current;
    element?.showModal();
    element?.querySelector<HTMLTextAreaElement>("[data-autofocus]")?.focus();
    const authorizationChanged = () => closeOnAuthChange.current();
    window.addEventListener(AUTH_CHANGE_EVENT, authorizationChanged);
    return () => {
      window.removeEventListener(AUTH_CHANGE_EVENT, authorizationChanged);
      element?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-label={copy.guestTitle}
      onCancel={(event) => {
        event.preventDefault();
        if (!locked) onClose();
      }}
    >
      <header className={styles.header}>
        <div>
          <h2>{copy.guestTitle}</h2>
          <p lang="">{title}</p>
        </div>
        <button type="button" className="button-quiet" disabled={locked} onClick={onClose}>
          {copy.close}
        </button>
      </header>
      <div className={styles.body}>
        <BoardEmailInvitations
          target={{ kind: "guests", id: sourceBoardId }}
          onLockChange={setLocked}
        />
      </div>
    </dialog>
  );
}
