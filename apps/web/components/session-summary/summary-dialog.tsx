"use client";

import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import type {
  CreatedSummaryShare,
  SessionSummaryPreview,
  SummaryShareMetadata,
  SummarySource,
} from "@openround/contracts";
import { formatDateTime } from "../../lib/i18n/format";
import { ApiClientError, AUTH_CHANGE_EVENT } from "../../lib/api";
import { SESSION_EXPIRED_EVENT, SESSION_LOGOUT_EVENT } from "../../lib/idle-session";
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
import { handleModalKeyDown } from "../presentation/presentation-modal-focus";
import { SessionSummaryDownloads } from "./summary-downloads";
import { SessionSummaryView } from "./summary-view";
import styles from "./summary.module.css";

/** These controls also appear outside WorkspaceProvider, so observe the shared authority events. */
function useSummaryScope(source: SummarySource) {
  const [revision, setRevision] = useState(0);
  const [stoppedSource, setStoppedSource] = useState<string | null>(null);
  const sourceKey = JSON.stringify([source.kind, source.id]);
  const blocked = stoppedSource === sourceKey;
  const key = JSON.stringify([source.kind, source.id, revision, blocked]);
  const active = useRef({ key, valid: !blocked });
  if (active.current.key !== key) active.current = { key, valid: !blocked };
  const captured = active.current;
  // Restore the scope before descendant reads restart during Strict Mode effect replay.
  useLayoutEffect(() => {
    captured.valid = !blocked;
    const invalidate = (event: Event) => {
      captured.valid = false;
      if (event.type === SESSION_EXPIRED_EVENT || event.type === SESSION_LOGOUT_EVENT)
        setStoppedSource(sourceKey);
      else {
        setStoppedSource(null);
        setRevision((value) => value + 1);
      }
    };
    const events = [
      AUTH_CHANGE_EVENT,
      SESSION_EXPIRED_EVENT,
      SESSION_LOGOUT_EVENT,
      "polling-pops:workspace-updated",
    ];
    for (const event of events) window.addEventListener(event, invalidate);
    return () => {
      captured.valid = false;
      for (const event of events) window.removeEventListener(event, invalidate);
    };
  }, [key]);
  return { key, current: () => active.current === captured && captured.valid };
}

function authorityDenied(error: unknown) {
  return error instanceof ApiClientError && [401, 403, 404, 410].includes(error.status);
}

function replaceRetryFocus(retry: HTMLElement | null, target: HTMLElement | null) {
  if (
    retry &&
    (document.activeElement === retry ||
      (!retry.isConnected && document.activeElement === document.body))
  )
    target?.focus();
}

export function SessionSummaryButton({ source }: { source: SummarySource }) {
  const { t } = useLocale();
  const scope = useSummaryScope(source);
  const [availability, setAvailability] = useState<{
    key: string;
    phase: "checking" | "retrying" | "available" | "disabled" | "failed";
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const retryButton = useRef<HTMLButtonElement>(null);
  const openerButton = useRef<HTMLButtonElement>(null);
  const focusAfterRetry = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!scope.current()) return;
    const controller = new AbortController();
    const requestedSource = { kind: source.kind, id: source.id };
    setAvailability((previous) => ({
      key: scope.key,
      phase: previous?.key === scope.key && previous.phase === "retrying" ? "retrying" : "checking",
    }));
    const current = () => !controller.signal.aborted && scope.current();
    void fetchSummaryAvailability(requestedSource, controller.signal)
      .then((enabled) => {
        if (current()) {
          focusAfterRetry.current =
            enabled && document.activeElement === retryButton.current ? retryButton.current : null;
          setAvailability({ key: scope.key, phase: enabled ? "available" : "disabled" });
        }
      })
      .catch(() => {
        if (current()) setAvailability({ key: scope.key, phase: "failed" });
      });
    return () => controller.abort();
  }, [scope.key, attempt]);
  const phase = availability?.key === scope.key ? availability.phase : "checking";
  useEffect(() => {
    if (phase === "available" && scope.current())
      replaceRetryFocus(focusAfterRetry.current, openerButton.current);
    focusAfterRetry.current = null;
  }, [phase, scope.key]);
  if (!scope.current()) return null;
  if (phase === "failed" || phase === "retrying")
    return (
      <div>
        <p
          className={phase === "failed" ? "error" : undefined}
          role={phase === "failed" ? "alert" : "status"}
        >
          {t(phase === "failed" ? "summary.availabilityFailed" : "summary.working")}
        </p>
        <button
          className="button-quiet"
          ref={retryButton}
          type="button"
          aria-disabled={phase === "retrying"}
          onClick={() => {
            if (scope.current() && phase === "failed") {
              setAvailability({ key: scope.key, phase: "retrying" });
              setAttempt((value) => value + 1);
            }
          }}
        >
          {t("summary.retryAvailability")}
        </button>
      </div>
    );
  if (phase !== "available") return null;
  return (
    <>
      <button
        ref={openerButton}
        className="button-quiet"
        type="button"
        aria-haspopup="dialog"
        onClick={(event) => {
          if (!scope.current()) return;
          event.currentTarget.focus();
          setOpenKey(scope.key);
        }}
      >
        {t("summary.open")}
      </button>
      {openKey === scope.key ? (
        <SessionSummaryDialog key={scope.key} source={source} onClose={() => setOpenKey(null)} />
      ) : null}
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
  const scope = useSummaryScope(source);
  if (!scope.current()) return null;
  return (
    <SessionSummaryDialogContent
      key={scope.key}
      source={source}
      onClose={onClose}
      isSourceCurrent={scope.current}
    />
  );
}

function SessionSummaryDialogContent({
  source,
  onClose,
  isSourceCurrent,
}: {
  source: SummarySource;
  onClose: () => void;
  isSourceCurrent: () => boolean;
}) {
  const { locale, t } = useLocale();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const alive = useRef(true);
  const intent = useRef<SummaryCreateIntent | null>(null);
  const generation = useRef(0);
  const previewRead = useRef<AbortController | null>(null);
  const sharesRead = useRef<AbortController | null>(null);
  const initializedForm = useRef(false);
  const previewPane = useRef<HTMLDivElement>(null);
  const previewRetry = useRef<HTMLButtonElement>(null);
  const focusAfterPreview = useRef<HTMLButtonElement | null>(null);
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
  const [previewFailed, setPreviewFailed] = useState(false);
  const [loadingShares, setLoadingShares] = useState(true);
  const [sharesFailed, setSharesFailed] = useState(false);
  const [sharesLoaded, setSharesLoaded] = useState(false);

  function captureCurrent() {
    const captured = generation.current;
    return () => alive.current && isSourceCurrent() && generation.current === captured;
  }

  function clearPrivateState() {
    generation.current += 1;
    previewRead.current?.abort();
    sharesRead.current?.abort();
    intent.current = null;
    initializedForm.current = false;
    setPreview(null);
    setShares([]);
    setReceipt(null);
    setNextSteps("");
    setDays(7);
    setAllowDownloads(true);
    setBusy(false);
    setError("");
    setStatus("");
    setLoading(false);
    setLoadingShares(false);
    setSharesLoaded(false);
    setPreviewFailed(true);
    setSharesFailed(true);
  }

  useEffect(() => {
    alive.current = true;
    const previous = document.activeElement;
    const dialog = dialogRef.current;
    dialog?.showModal();
    closeRef.current?.focus();
    return () => {
      alive.current = false;
      generation.current += 1;
      previewRead.current?.abort();
      sharesRead.current?.abort();
      dialog?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  useEffect(() => {
    void loadPreview();
    void refreshShares();
    // Locale changes must not reset an in-progress share intent or its authored next steps.
  }, [source.kind, source.id]);

  useEffect(() => {
    if (preview && !previewFailed && isSourceCurrent())
      replaceRetryFocus(focusAfterPreview.current, previewPane.current);
    focusAfterPreview.current = null;
  }, [preview, previewFailed]);

  async function loadPreview() {
    if (!alive.current || !isSourceCurrent()) return;
    previewRead.current?.abort();
    const controller = new AbortController();
    previewRead.current = controller;
    const scopeCurrent = captureCurrent();
    const current = () =>
      scopeCurrent() && !controller.signal.aborted && previewRead.current === controller;
    setLoading(true);
    try {
      const loaded = await fetchSummaryPreview(source, controller.signal);
      if (!current()) return;
      focusAfterPreview.current =
        document.activeElement === previewRetry.current ? previewRetry.current : null;
      setPreviewFailed(false);
      setPreview(loaded);
      if (!initializedForm.current) {
        initializedForm.current = true;
        setNextSteps(loaded.summary.nextSteps);
        setAllowDownloads(loaded.capabilities.downloadFormats.length > 0);
      }
    } catch (caught) {
      if (!current()) return;
      if (authorityDenied(caught)) clearPrivateState();
      else setPreviewFailed(true);
    } finally {
      if (current()) setLoading(false);
    }
  }

  async function refreshShares() {
    if (!alive.current || !isSourceCurrent()) return;
    sharesRead.current?.abort();
    const controller = new AbortController();
    sharesRead.current = controller;
    const scopeCurrent = captureCurrent();
    const current = () =>
      scopeCurrent() && !controller.signal.aborted && sharesRead.current === controller;
    setLoadingShares(true);
    setSharesFailed(false);
    try {
      const links = await fetchSummaryShares(source, controller.signal);
      if (!current()) return;
      setShares(links);
      setSharesLoaded(true);
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
    } catch (caught) {
      if (!current()) return;
      if (authorityDenied(caught)) clearPrivateState();
      else setSharesFailed(true);
    } finally {
      if (current()) setLoadingShares(false);
    }
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    if (busy || !alive.current || !isSourceCurrent() || !preview?.capabilities.canCreateShare)
      return;
    const current = captureCurrent();
    sharesRead.current?.abort();
    setLoadingShares(false);
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
      if (!current()) return;
      setReceipt(created);
      intent.current = null;
      setStatus(t(created.url ? "summary.created" : "summary.replayed"));
      await refreshShares();
    } catch (caught) {
      if (!current()) return;
      if (caught instanceof ApiClientError && caught.code === "SUMMARY_SHARING_UNAVAILABLE") {
        // The policy may deny new links while the preview and existing links remain readable.
        setPreview((current) =>
          current
            ? { ...current, capabilities: { ...current.capabilities, canCreateShare: false } }
            : current,
        );
        setError(t("summary.failed"));
        void refreshShares();
        await loadPreview();
        return;
      }
      if (authorityDenied(caught)) {
        clearPrivateState();
        return;
      }
      setError(t("summary.uncertain"));
      await refreshShares();
    } finally {
      if (current()) setBusy(false);
    }
  }

  async function revoke(shareId: string) {
    if (busy || !alive.current || !isSourceCurrent() || !preview?.capabilities.canRevokeShare)
      return;
    const current = captureCurrent();
    sharesRead.current?.abort();
    setLoadingShares(false);
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await revokeSummaryShare(source, shareId);
      if (!current()) return;
      if (receipt?.share.id === shareId) setReceipt(null);
      setStatus(t("summary.revoked"));
      await refreshShares();
    } catch (caught) {
      if (!current()) return;
      if (authorityDenied(caught)) {
        clearPrivateState();
        return;
      }
      setError(t("summary.failed"));
      await refreshShares();
    } finally {
      if (current()) setBusy(false);
    }
  }

  async function copyLink() {
    if (!receipt?.url || !alive.current || !isSourceCurrent()) return;
    const current = captureCurrent();
    setError("");
    try {
      await navigator.clipboard.writeText(receipt.url);
      if (current()) setStatus(t("summary.copied"));
    } catch {
      if (current()) setError(t("summary.copyFailed"));
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby="session-summary-title"
      aria-describedby="session-summary-description"
      lang={locale}
      onKeyDown={(event) => handleModalKeyDown(event, onClose)}
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
      <div className={styles.dialogBody}>
        <p id="session-summary-description">{t("summary.description")}</p>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        <p role="status" aria-live="polite" className={status ? "success" : "sr-only"}>
          {status}
        </p>
        <div className={styles.columns}>
          <div
            ref={previewPane}
            className={styles.previewPane}
            tabIndex={0}
            role="region"
            aria-label={t("summary.title")}
          >
            {loading ? <p role="status">{t("summary.loading")}</p> : null}
            {previewFailed ? (
              <div>
                {!loading ? (
                  <p className="error" role="alert">
                    {t("summary.previewFailed")}
                  </p>
                ) : null}
                <button
                  ref={previewRetry}
                  className="button-quiet"
                  type="button"
                  aria-disabled={busy || loading}
                  onClick={() => {
                    if (!busy && !loading) void loadPreview();
                  }}
                >
                  {t("summary.retryPreview")}
                </button>
              </div>
            ) : null}
            {preview ? (
              <SessionSummaryView
                summary={{ ...preview.summary, nextSteps: nextSteps.trim() }}
                headingLevel={3}
              />
            ) : null}
          </div>
          <div
            className={styles.controls}
            tabIndex={0}
            role="region"
            aria-label={t("summary.open")}
          >
            {preview ? (
              <>
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
              </>
            ) : null}
            <section>
              <div className={styles.actions}>
                <h3>{t("summary.links")}</h3>
                <button
                  className="button-quiet small-button"
                  type="button"
                  aria-disabled={busy || loadingShares}
                  onClick={() => {
                    if (!busy && !loadingShares) void refreshShares();
                  }}
                >
                  {t("summary.refresh")}
                </button>
              </div>
              {loadingShares ? <p role="status">{t("summary.loadingLinks")}</p> : null}
              {sharesFailed ? (
                <p className="error" role="alert">
                  {t("summary.linksFailed")}
                </p>
              ) : null}
              {sharesLoaded && !shares.length ? (
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
                          {t("summary.expires", {
                            date: formatDateTime(locale, share.expiresAt),
                          })}
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
                        {!inactive && preview?.capabilities.canRevokeShare ? (
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
      </div>
    </dialog>
  );
}
