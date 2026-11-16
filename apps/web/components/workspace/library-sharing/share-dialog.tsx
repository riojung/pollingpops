"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  LibraryShareCreateSchema,
  type LibraryShareCreate,
  type LibraryShareRecipient,
} from "@openround/contracts";
import { useLocale } from "../../locale-provider";
import { AUTH_CHANGE_EVENT, ApiClientError } from "../../../lib/api";
import { clientUuid } from "../../../lib/uuid";
import { librarySharingMessages } from "../../../lib/i18n/library-sharing-messages";
import { createLibraryShare, listLibraryShareRecipients, type LibraryShareSource } from "./client";
import styles from "./library-sharing.module.css";
import { useWorkspace } from "../workspace-provider";

export function ShareLibraryButton({ source }: { source: LibraryShareSource }) {
  const { locale } = useLocale();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="button-quiet small-button" onClick={() => setOpen(true)}>
        {librarySharingMessages(locale).shareAction}
      </button>
      {open ? <LibraryShareDialog source={source} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

export function LibraryShareDialog({
  source,
  onClose,
}: {
  source: LibraryShareSource;
  onClose: () => void;
}) {
  const { locale } = useLocale();
  const copy = librarySharingMessages(locale);
  const { creator } = useWorkspace();
  const pendingKey = `openround:library-share:${creator?.userId ?? ""}:${creator?.workspaceId ?? ""}:${source.artifactType}:${source.artifactId}:${source.versionId}`;
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const active = useRef<AbortController | null>(null);
  const pending = useRef<LibraryShareCreate | null>(null);
  const inFlight = useRef(false);
  const [audience, setAudience] = useState<"organization" | "people">("organization");
  const [permission, setPermission] = useState<"view" | "use">("view");
  const [message, setMessage] = useState("");
  const [due, setDue] = useState("");
  const [search, setSearch] = useState("");
  const [recipients, setRecipients] = useState<LibraryShareRecipient[]>([]);
  const [selected, setSelected] = useState<Map<string, string>>(() => new Map());
  const [recipientLoading, setRecipientLoading] = useState(false);
  const [recipientError, setRecipientError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState(false);
  const [savedId, setSavedId] = useState("");

  function clearPending() {
    pending.current = null;
    try {
      window.sessionStorage.removeItem(pendingKey);
    } catch {
      /* The in-memory request still protects retries. */
    }
  }

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(pendingKey);
      if (!raw) return;
      const cached = JSON.parse(raw) as { intent: unknown; emails?: Record<string, string> };
      const intent = LibraryShareCreateSchema.parse(cached.intent);
      if (
        intent.artifactType !== source.artifactType ||
        intent.artifactId !== source.artifactId ||
        intent.versionId !== source.versionId
      )
        return;
      pending.current = intent;
      setAudience(intent.audience);
      setPermission(intent.permission);
      setMessage(intent.message);
      setSelected(
        new Map(
          intent.recipientIds.map((userId) => [
            userId,
            typeof cached.emails?.[userId] === "string" ? cached.emails[userId]! : userId,
          ]),
        ),
      );
      if (intent.dueAt) {
        const date = new Date(intent.dueAt);
        setDue(
          new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16),
        );
      }
      setUncertain(true);
      setError(true);
    } catch {
      /* Storage failures must not block a new share. */
    }
  }, [pendingKey, source.artifactId, source.artifactType, source.versionId]);

  useEffect(() => {
    const controller = new AbortController();
    active.current = controller;
    const previous = document.activeElement;
    dialog.current?.showModal();
    const changed = () => {
      controller.abort();
      closeRef.current();
    };
    window.addEventListener(AUTH_CHANGE_EVENT, changed);
    return () => {
      controller.abort();
      window.removeEventListener(AUTH_CHANGE_EVENT, changed);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  useEffect(() => {
    if (audience !== "people") return;
    const controller = new AbortController();
    setRecipients([]);
    setRecipientLoading(true);
    setRecipientError(false);
    const timer = window.setTimeout(
      () => {
        void listLibraryShareRecipients(search, controller.signal)
          .then((rows) => {
            if (!controller.signal.aborted) setRecipients(rows);
          })
          .catch(() => {
            if (!controller.signal.aborted) setRecipientError(true);
          })
          .finally(() => {
            if (!controller.signal.aborted) setRecipientLoading(false);
          });
      },
      search ? 250 : 0,
    );
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [audience, search]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || !active.current || active.current.signal.aborted || savedId) return;
    if (!pending.current) {
      pending.current = {
        requestId: clientUuid(),
        artifactType: source.artifactType,
        artifactId: source.artifactId,
        versionId: source.versionId,
        audience,
        recipientIds: audience === "people" ? [...selected.keys()] : [],
        permission,
        message: message.trim(),
        dueAt: due ? new Date(due).toISOString() : null,
      };
      try {
        window.sessionStorage.setItem(
          pendingKey,
          JSON.stringify({ intent: pending.current, emails: Object.fromEntries(selected) }),
        );
      } catch {
        /* Keep the exact request in memory when per-tab storage is unavailable. */
      }
    }
    inFlight.current = true;
    setBusy(true);
    setError(false);
    try {
      const result = await createLibraryShare(pending.current, active.current.signal);
      if (active.current.signal.aborted) return;
      clearPending();
      setUncertain(false);
      setSavedId(result.id);
    } catch (caught) {
      if (active.current.signal.aborted) return;
      const retryable =
        !(caught instanceof ApiClientError) || caught.status >= 500 || caught.status === 429;
      if (!retryable) clearPending();
      setUncertain(retryable);
      setError(true);
    } finally {
      inFlight.current = false;
      if (!active.current.signal.aborted) setBusy(false);
    }
  }

  const locked = busy || uncertain || Boolean(savedId);
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={`${id}-title`}
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else onClose();
      }}
    >
      <form onSubmit={(event) => void submit(event)}>
        <div>
          <h2 id={`${id}-title`}>{savedId ? copy.saved : copy.shareTitle}</h2>
          <p className={styles.help} lang="" dir="auto">
            {source.title}
          </p>
        </div>
        <p className={styles.notice}>{copy.snapshotNote}</p>
        {!savedId ? (
          <>
            <label className={styles.field}>
              {copy.audience}
              <select
                value={audience}
                disabled={locked}
                onChange={(event) => setAudience(event.target.value as typeof audience)}
              >
                <option value="organization">{copy.organizationAudience}</option>
                <option value="people">{copy.peopleAudience}</option>
              </select>
            </label>
            {audience === "people" ? (
              <div className={styles.field}>
                <label htmlFor={`${id}-search`}>{copy.recipients}</label>
                <input
                  id={`${id}-search`}
                  type="search"
                  placeholder={copy.searchPeople}
                  value={search}
                  disabled={locked}
                  onChange={(event) => setSearch(event.target.value)}
                />
                {selected.size ? (
                  <p className={styles.help}>{[...selected.values()].join(", ")}</p>
                ) : null}
                <div className={styles.recipients}>
                  {recipientLoading ? (
                    <p className={styles.help} role="status">
                      {copy.loading}
                    </p>
                  ) : recipientError ? (
                    <p className="error" role="alert">
                      {copy.unavailable}
                    </p>
                  ) : recipients.length ? (
                    recipients.map((recipient) => (
                      <label className={styles.recipient} key={recipient.userId}>
                        <input
                          type="checkbox"
                          disabled={
                            locked || (!selected.has(recipient.userId) && selected.size >= 50)
                          }
                          checked={selected.has(recipient.userId)}
                          onChange={() =>
                            setSelected((current) => {
                              const next = new Map(current);
                              if (next.has(recipient.userId)) next.delete(recipient.userId);
                              else next.set(recipient.userId, recipient.email);
                              return next;
                            })
                          }
                        />
                        <span lang="">{recipient.email}</span>
                      </label>
                    ))
                  ) : (
                    <p className={styles.help}>{copy.noPeople}</p>
                  )}
                </div>
              </div>
            ) : null}
            <div className={styles.field}>
              <label htmlFor={`${id}-permission`}>{copy.permission}</label>
              <select
                id={`${id}-permission`}
                aria-describedby={`${id}-permission-help`}
                disabled={locked}
                value={permission}
                onChange={(event) => setPermission(event.target.value as typeof permission)}
              >
                <option value="view">{copy.canView}</option>
                <option value="use">{copy.canUse}</option>
              </select>
              <p id={`${id}-permission-help`} className={styles.help}>
                {copy.copyHelp}
              </p>
            </div>
            <label className={styles.field}>
              {copy.message}
              <textarea
                value={message}
                maxLength={1000}
                disabled={locked}
                onChange={(event) => setMessage(event.target.value)}
              />
            </label>
            <label className={styles.field}>
              {copy.due}
              <input
                type="datetime-local"
                value={due}
                disabled={locked}
                onChange={(event) => setDue(event.target.value)}
              />
            </label>
            {error ? (
              <p className="error" role="alert">
                {copy.failed}
              </p>
            ) : null}
          </>
        ) : (
          <Link className="button-quiet" href={`/library/shared/${savedId}`} onClick={onClose}>
            {copy.open}
          </Link>
        )}
        <div className={styles.dialogActions}>
          <button type="button" className="button-quiet" disabled={busy} onClick={onClose}>
            {savedId ? copy.close : copy.cancel}
          </button>
          {!savedId ? (
            <button
              type="submit"
              className="button"
              disabled={busy || (audience === "people" && !selected.size)}
            >
              {busy ? copy.loading : uncertain ? copy.retry : copy.submit}
            </button>
          ) : null}
        </div>
      </form>
    </dialog>
  );
}
