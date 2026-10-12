"use client";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { feedbackPage } from "@openround/contracts";
import { apiFetch, humanError } from "../../lib/api";
import { useLocale } from "../locale-provider";
import styles from "./feedback.module.css";
import shellStyles from "./workspace.module.css";

export function FeedbackButton() {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  return (
    <>
      <button
        className={`${shellStyles.utilityAction} ${shellStyles.feedbackAction}`}
        type="button"
        onClick={(event) => {
          // Safari does not focus pointer-clicked buttons; give the dialog a reliable return target.
          event.currentTarget.focus();
          setOpen(true);
        }}
        aria-haspopup="dialog"
        aria-label={t("feedback.button")}
        title={t("feedback.title")}
      >
        <svg className={shellStyles.icon} aria-hidden="true" fill="none" viewBox="0 0 24 24">
          <path d="M20 11a8 8 0 0 1-8 8H5l-3 3V11a9 9 0 0 1 18 0Z" />
          <path d="M7 10h10M7 14h6" />
        </svg>
        <span>{t("feedback.button")}</span>
      </button>
      {open ? (
        <FeedbackDialog page={feedbackPage(pathname)} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}
export function FeedbackDialog({ page, onClose }: { page: string; onClose: () => void }) {
  const { locale, t } = useLocale();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const retry = useRef<{ content: string; id: string } | null>(null);
  const [category, setCategory] = useState("bug");
  const [message, setMessage] = useState("");
  const [allowContact, setAllowContact] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState("");
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = dialogRef.current;
    dialog?.showModal();
    messageRef.current?.focus();
    return () => {
      dialog?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const content = JSON.stringify({ category, message: message.trim(), page, allowContact });
    if (!retry.current || retry.current.content !== content)
      retry.current = { content, id: crypto.randomUUID() };
    setBusy(true);
    setError("");
    try {
      const result = await apiFetch<{ feedbackId: string }>("/v1/feedback", {
        method: "POST",
        body: JSON.stringify({ ...JSON.parse(content), idempotencyKey: retry.current.id }),
        signal: AbortSignal.timeout(20_000),
      });
      setReceipt(result.feedbackId);
    } catch (caught) {
      setError(`${t("feedback.failed")} ${humanError(caught)}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby="feedback-title"
      aria-describedby="feedback-description"
      lang={locale}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className={styles.heading}>
        <h2 id="feedback-title">{t("feedback.title")}</h2>
        <button
          className="button-quiet small-button"
          aria-label={t("feedback.close")}
          type="button"
          disabled={busy}
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <p id="feedback-description">{t("feedback.description")}</p>
      {receipt ? (
        <section className={styles.success} role="status">
          <h3>{t("feedback.thanks")}</h3>
          <p>{t("feedback.received")}</p>
          <p>
            {t("feedback.receipt")} <code>{receipt}</code>
          </p>
          <button className="button" type="button" onClick={onClose}>
            {t("feedback.done")}
          </button>
        </section>
      ) : (
        <form onSubmit={(event) => void submit(event)}>
          <label htmlFor="feedback-category">{t("feedback.category")}</label>
          <select
            id="feedback-category"
            value={category}
            disabled={busy}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option value="bug">{t("feedback.bug")}</option>
            <option value="usability">{t("feedback.usability")}</option>
            <option value="idea">{t("feedback.idea")}</option>
            <option value="other">{t("feedback.other")}</option>
          </select>
          <label htmlFor="feedback-message">{t("feedback.message")}</label>
          <textarea
            ref={messageRef}
            id="feedback-message"
            aria-describedby="feedback-message-hint feedback-privacy"
            required
            minLength={10}
            maxLength={4000}
            rows={6}
            value={message}
            disabled={busy}
            onChange={(event) => setMessage(event.target.value)}
          />
          <p id="feedback-message-hint" className="muted">
            {t("feedback.messageHint")}
          </p>
          <p id="feedback-privacy" className={styles.privacy}>
            {t("feedback.privacy")}
          </p>
          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={allowContact}
              disabled={busy}
              onChange={(event) => setAllowContact(event.target.checked)}
            />
            {t("feedback.contact")}
          </label>
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
          <div className={styles.actions}>
            <button className="button-quiet" type="button" disabled={busy} onClick={onClose}>
              {t("feedback.cancel")}
            </button>
            <button className="button" type="submit" disabled={busy || message.trim().length < 10}>
              {t(busy ? "feedback.sending" : "feedback.send")}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
