"use client";
import { useEffect, useRef, useState } from "react";
import type { CreatePresentationShare, PresentationShareMetadata } from "@openround/contracts";
import {
  createPresentationShare,
  listPresentationShares,
  loadPresentationShareIntent,
  presentationShareIntent,
  revokePresentationShare,
  savePresentationShareIntent,
  clearPresentationShareIntent,
  isExpiredPresentationShareRequest,
} from "../../lib/presentation-sharing-client";
import { humanError } from "../../lib/api";
import styles from "./sharing.module.css";
export function PresentationShareButton({
  presentationId,
  versionId,
  disabled = false,
  className,
}: {
  presentationId: string;
  versionId: string | null;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        aria-label="Share review link"
        className={className}
        type="button"
        disabled={disabled || !versionId}
        onClick={() => setOpen(true)}
      >
        <span className={styles.shareLongLabel}>Share review link</span>
        <span className={styles.shareShortLabel}>Share</span>
      </button>
      {open && versionId ? (
        <PresentationShareDialog
          presentationId={presentationId}
          versionId={versionId}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
export function PresentationShareDialog({
  presentationId,
  versionId,
  onClose,
}: {
  presentationId: string;
  versionId: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    intent = useRef<CreatePresentationShare | null>(null);
  const [shares, setShares] = useState<PresentationShareMetadata[]>([]),
    [days, setDays] = useState(7),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [url, setUrl] = useState("");
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.showModal();
    intent.current = loadPresentationShareIntent(presentationId);
    setPending(!!intent.current);
    const controller = new AbortController();
    void listPresentationShares(presentationId, controller.signal)
      .then(setShares)
      .catch((caught) => {
        if (!controller.signal.aborted) setError(humanError(caught));
      });
    return () => {
      controller.abort();
      previous?.focus();
    };
  }, [presentationId]);
  async function create() {
    if (busy) return;
    setBusy(true);
    setError("");
    setUrl("");
    let request: CreatePresentationShare | null = null;
    try {
      if (!intent.current) intent.current = presentationShareIntent(versionId, days);
      request = intent.current;
      savePresentationShareIntent(presentationId, request);
      setPending(true);
      const result = await createPresentationShare(presentationId, request);
      setUrl(result.url ?? "");
      intent.current = null;
      clearPresentationShareIntent(presentationId, request);
      setPending(false);
      setShares(await listPresentationShares(presentationId));
    } catch (caught) {
      if (request && intent.current === request && isExpiredPresentationShareRequest(caught)) {
        clearPresentationShareIntent(presentationId, request);
        intent.current = null;
        setPending(false);
        setError(
          "The pending request expired before it was accepted. Choose an expiry and create a new link.",
        );
      } else setError(humanError(caught));
    } finally {
      setBusy(false);
    }
  }
  async function revoke(shareId: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await revokePresentationShare(presentationId, shareId);
      setShares(await listPresentationShares(presentationId));
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby="presentation-share-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      lang="en-CA"
    >
      <header className={styles.controls}>
        <h2 id="presentation-share-title">Share a private review link</h2>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </header>
      <p>
        Shares the published version. Draft changes and speaker notes stay private. Anyone with the
        link can review it until it expires or you revoke it.
      </p>
      <p>Questions are for reading. Responses are not collected.</p>
      <label>
        Link expires in
        <select
          disabled={busy || pending}
          value={days}
          onChange={(event) => setDays(Number(event.target.value))}
        >
          <option value={1}>1 day</option>
          <option value={7}>7 days</option>
          <option value={30}>30 days</option>
        </select>
      </label>
      {pending ? (
        <p role="status">A link request is pending. Retry to recover the same link.</p>
      ) : null}
      <button type="button" disabled={busy} onClick={() => void create()}>
        {busy ? "Working…" : pending ? "Retry link creation" : "Create link"}
      </button>
      {error ? <p role="alert">{error}</p> : null}
      {url ? (
        <div className={styles.created}>
          <p>
            Copy or save this link before closing the dialog. To share again later, create a new
            link.
          </p>
          <label>
            Your private link
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
            Copy link
          </button>
          <a href={url} target="_blank" rel="noopener noreferrer">
            Open review
          </a>
        </div>
      ) : null}
      <h3>Review links</h3>
      {shares.length ? (
        <ul className={styles.shareList}>
          {shares.map((share) => {
            const expired = Date.parse(share.expiresAt) <= Date.now();
            return (
              <li key={share.id}>
                <span>
                  Created {new Date(share.createdAt).toLocaleString("en-CA")}
                  <br />
                  {share.revokedAt
                    ? "Revoked"
                    : expired
                      ? "Expired"
                      : `Expires ${new Date(share.expiresAt).toLocaleString("en-CA")}`}
                </span>
                <button
                  type="button"
                  disabled={busy || !!share.revokedAt || expired}
                  onClick={() => void revoke(share.id)}
                >
                  Revoke link
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p>No review links yet.</p>
      )}
    </dialog>
  );
}
