"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type {
  CreatedSummaryShare,
  SessionSummaryPreview,
  SummaryShareMetadata,
  SummarySource,
} from "@openround/contracts";
import { formatDateTime } from "../../lib/i18n/format";
import {
  createSummaryShare,
  fetchSummaryAvailability,
  fetchSummaryPreview,
  fetchSummaryShares,
  revokeSummaryShare,
  summaryCreateIntent,
  summaryExpiry,
  type SummaryCreateIntent,
} from "../../lib/session-summary-client";
import { useLocale } from "../locale-provider";
import { SessionSummaryDownloads } from "./summary-downloads";
import { SessionSummaryView } from "./summary-view";
import styles from "./summary.module.css";

export function SessionSummaryButton({ source }: { source: SummarySource }) {
  const { t } = useLocale();
  const [availableSource, setAvailableSource] = useState<SummarySource | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const requestedSource = { kind: source.kind, id: source.id };
    setAvailableSource(null);
    setOpen(false);
    void fetchSummaryAvailability(requestedSource, controller.signal)
      .then((enabled) => {
        if (!controller.signal.aborted) setAvailableSource(enabled ? requestedSource : null);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [source.kind, source.id]);
  if (availableSource?.kind !== source.kind || availableSource?.id !== source.id) return null;
  return (
    <>
      <button
        className="button-quiet"
        type="button"
        aria-haspopup="dialog"
        onClick={(event) => {
          event.currentTarget.focus();
          setOpen(true);
        }}
      >
        {t("summary.open")}
      </button>
      {open ? <SessionSummaryDialog source={source} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

export function SessionSummaryDialog({
  source,
  onClose,
}: {
  source: SummarySource;
  onClose: () => void;
}) {
  const { locale, t } = useLocale();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const alive = useRef(true);
  const intent = useRef<SummaryCreateIntent | null>(null);
  const [preview, setPreview] = useState<SessionSummaryPreview | null>(null);
  const [shares, setShares] = useState<SummaryShareMetadata[]>([]);
  const [receipt, setReceipt] = useState<CreatedSummaryShare | null>(null);
  const [nextSteps, setNextSteps] = useState("");
  const [days, setDays] = useState(7);
  const [allowDownloads, setAllowDownloads] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    alive.current = true;
    const previous = document.activeElement;
    const dialog = dialogRef.current;
    dialog?.showModal();
    closeRef.current?.focus();
    return () => {
      alive.current = false;
      dialog?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void Promise.all([
      fetchSummaryPreview(source, controller.signal),
      fetchSummaryShares(source, controller.signal),
    ])
      .then(([loaded, links]) => {
        if (controller.signal.aborted) return;
        setPreview(loaded);
        setNextSteps(loaded.summary.nextSteps);
        setShares(links);
        setAllowDownloads(loaded.capabilities.downloadFormats.length > 0);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(t("summary.failed"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // Locale changes must not reset an in-progress share intent or its authored next steps.
  }, [source.kind, source.id]);

  async function refreshShares() {
    const links = await fetchSummaryShares(source);
    if (alive.current) {
      setShares(links);
      setReceipt((current) =>
        current &&
        links.some(
          (share) =>
            share.id === current.share.id &&
            (share.revokedAt !== null || Date.parse(share.expiresAt) <= Date.now()),
        )
          ? null
          : current,
      );
    }
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    if (busy || !preview?.capabilities.canCreateShare) return;
    intent.current = summaryCreateIntent(intent.current, {
      expiresInDays: days,
      allowDownloads,
      nextSteps,
    });
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const created = await createSummaryShare(source, intent.current.request);
      if (!alive.current) return;
      setReceipt(created);
      intent.current = null;
      setStatus(t(created.url ? "summary.created" : "summary.replayed"));
      await refreshShares().catch(() => {
        if (alive.current) setError(t("summary.failed"));
      });
    } catch {
      if (!alive.current) return;
      setError(t("summary.uncertain"));
      await refreshShares().catch(() => undefined);
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function revoke(shareId: string) {
    if (busy || !preview?.capabilities.canRevokeShare) return;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await revokeSummaryShare(source, shareId);
      if (!alive.current) return;
      if (receipt?.share.id === shareId) setReceipt(null);
      setStatus(t("summary.revoked"));
      await refreshShares().catch(() => {
        if (alive.current) setError(t("summary.failed"));
      });
    } catch {
      if (alive.current) setError(t("summary.failed"));
      await refreshShares().catch(() => undefined);
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function copyLink() {
    if (!receipt?.url) return;
    setError("");
    try {
      await navigator.clipboard.writeText(receipt.url);
      if (alive.current) setStatus(t("summary.copied"));
    } catch {
      if (alive.current) setError(t("summary.copyFailed"));
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby="session-summary-title"
      aria-describedby="session-summary-description"
      lang={locale}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className={styles.heading}>
        <h2 id="session-summary-title">{t("summary.open")}</h2>
        <button
          ref={closeRef}
          className="button-quiet small-button"
          type="button"
          onClick={onClose}
        >
          {t("summary.close")}
        </button>
      </div>
      <p id="session-summary-description">{t("summary.description")}</p>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <p role="status" aria-live="polite" className={status ? "success" : "sr-only"}>
        {status}
      </p>
      {loading ? <p role="status">{t("summary.loading")}</p> : null}
      {preview ? (
        <div className={styles.columns}>
          <SessionSummaryView
            summary={{ ...preview.summary, nextSteps: nextSteps.trim() }}
            headingLevel={3}
          />
          <div className={styles.controls}>
            <section>
              <h3>{t("summary.downloads")}</h3>
              <SessionSummaryDownloads
                access={{ source }}
                summary={preview.summary}
                formats={preview.capabilities.downloadFormats}
                nextSteps={nextSteps}
                disabled={busy}
              />
            </section>
            <section>
              <h3>{t("summary.create")}</h3>
              {preview.capabilities.reasonCodes.map((reason) => (
                <p className="notice" key={reason}>
                  {t(`summary.reason.${reason}`)}
                </p>
              ))}
              <form onSubmit={(event) => void create(event)}>
                <label className={styles.field} htmlFor="summary-next-steps">
                  <span>{t("summary.nextSteps")}</span>
                  <textarea
                    className="input"
                    id="summary-next-steps"
                    maxLength={2000}
                    rows={4}
                    dir="auto"
                    aria-describedby="summary-next-steps-hint"
                    value={nextSteps}
                    disabled={busy}
                    onChange={(event) => setNextSteps(event.target.value)}
                  />
                </label>
                <p className="muted" id="summary-next-steps-hint">
                  {t("summary.nextStepsHint")}
                </p>
                <label className={styles.field} htmlFor="summary-expiry">
                  <span>{t("summary.expiryDays")}</span>
                  <input
                    className="input"
                    id="summary-expiry"
                    type="number"
                    min={1}
                    max={30}
                    required
                    value={days}
                    disabled={busy || !preview.capabilities.canCreateShare}
                    onChange={(event) => setDays(Number(event.target.value))}
                  />
                </label>
                <p className="muted">
                  {t("summary.expires", {
                    date: formatDateTime(
                      locale,
                      summaryExpiry(preview, Number.isFinite(days) ? days : 7),
                    ),
                  })}
                </p>
                <p className="muted">
                  {t("summary.retention", {
                    date: formatDateTime(locale, preview.sourceExpiresAt),
                  })}
                </p>
                <label className={styles.checkbox}>
                  <input
                    type="checkbox"
                    checked={allowDownloads}
                    disabled={
                      busy ||
                      !preview.capabilities.canCreateShare ||
                      preview.capabilities.downloadFormats.length === 0
                    }
                    onChange={(event) => setAllowDownloads(event.target.checked)}
                  />
                  <span>{t("summary.allowDownloads")}</span>
                </label>
                <p>{t("summary.bearerNotice")}</p>
                <button
                  className="button"
                  type="submit"
                  disabled={busy || !preview.capabilities.canCreateShare}
                >
                  {t(busy ? "summary.working" : "summary.create")}
                </button>
              </form>
              {receipt ? (
                <div className={styles.receipt}>
                  <p>{t(receipt.url ? "summary.saveLink" : "summary.replayed")}</p>
                  {receipt.url ? (
                    <>
                      <label className={styles.field} htmlFor="summary-created-link">
                        <span>{t("summary.link")}</span>
                        <input
                          className="input"
                          id="summary-created-link"
                          readOnly
                          value={receipt.url}
                          onFocus={(event) => event.target.select()}
                        />
                      </label>
                      <button
                        className="button-quiet"
                        type="button"
                        onClick={() => void copyLink()}
                      >
                        {t("summary.copy")}
                      </button>
                    </>
                  ) : null}
                </div>
              ) : null}
            </section>
            <section>
              <div className={styles.actions}>
                <h3>{t("summary.links")}</h3>
                <button
                  className="button-quiet small-button"
                  type="button"
                  disabled={busy}
                  onClick={() => void refreshShares().catch(() => setError(t("summary.failed")))}
                >
                  {t("summary.refresh")}
                </button>
              </div>
              {!shares.length ? (
                <p>{t("summary.noLinks")}</p>
              ) : (
                <ul className={styles.shares}>
                  {shares.map((share) => {
                    const inactive =
                      share.revokedAt !== null || Date.parse(share.expiresAt) <= Date.now();
                    return (
                      <li className={styles.share} key={share.id}>
                        <p>
                          {t("summary.linkCreated", {
                            date: formatDateTime(locale, share.createdAt),
                          })}
                        </p>
                        <p>
                          {t("summary.expires", { date: formatDateTime(locale, share.expiresAt) })}
                        </p>
                        <p>
                          {t(
                            share.revokedAt
                              ? "summary.linkRevoked"
                              : inactive
                                ? "summary.linkExpired"
                                : "summary.linkActive",
                          )}
                        </p>
                        {!inactive && preview.capabilities.canRevokeShare ? (
                          <button
                            className="button-quiet"
                            type="button"
                            disabled={busy}
                            onClick={() => void revoke(share.id)}
                          >
                            {t("summary.revoke")}
                          </button>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
