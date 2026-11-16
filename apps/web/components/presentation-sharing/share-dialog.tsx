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
import sharingStyles from "./sharing.module.css";
import { EditorIcon } from "../presentation/presentation-editor-chrome";
import styles from "../presentation/presentation-delivery-dialog.module.css";
import { PresentationFeedbackPanel } from "./feedback-panel";
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
        <span className={sharingStyles.shareLongLabel}>Share review link</span>
        <span className={sharingStyles.shareShortLabel}>Share</span>
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
    [url, setUrl] = useState(""),
    [feedbackShare, setFeedbackShare] = useState<string | null>(null);
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
      <header className={styles.header}>
        <span className={styles.headerIcon}>
          <EditorIcon name="link" />
        </span>
        <h2 id="presentation-share-title">Share a private review link</h2>
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
        <section className={styles.setup} aria-label="Create a review link">
          <div className={styles.sectionIntro}>
            <h3>Create a review link</h3>
            <p>Anyone with the link can review it until it expires or you revoke it.</p>
          </div>
          <div className={styles.setupControls}>
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
            <button
              className={styles.primaryButton}
              type="button"
              disabled={busy}
              onClick={() => void create()}
            >
              {busy ? "Working…" : pending ? "Retry link creation" : "Create link"}
            </button>
          </div>
          <p className={styles.hint}>Questions are for reading. Responses are not collected.</p>
          {pending ? (
            <p className={styles.notice} role="status">
              A link request is pending. Retry to recover the same link.
            </p>
          ) : null}
        </section>
        {error ? <p role="alert">{error}</p> : null}
        {url ? (
          <section className={styles.created} aria-label="Created review link">
            <div className={styles.sectionIntro}>
              <h3>Your link is ready</h3>
              <p>
                Copy or save this link before closing the dialog. To share again later, create a new
                link.
              </p>
            </div>
            <label>
              Your private link
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
                Copy link
              </button>
              <a className={styles.actionLink} href={url} target="_blank" rel="noopener noreferrer">
                Open review
              </a>
            </div>
          </section>
        ) : null}
        <section className={styles.management} aria-label="Review links">
          <div className={styles.sectionHeading}>
            <h3>Review links</h3>
            <span className={styles.count}>{shares.length}</span>
          </div>
          {shares.length ? (
            <ul className={styles.shareList}>
              {shares.map((share, index) => {
                const expired = Date.parse(share.expiresAt) <= Date.now();
                return (
                  <li key={share.id}>
                    <div className={styles.listRow}>
                      <div className={styles.itemDetails}>
                        <div className={styles.itemHeading}>
                          <strong>Review link {index + 1}</strong>
                          <span
                            className={styles.badge}
                            data-inactive={!!share.revokedAt || expired}
                          >
                            {share.revokedAt ? "Revoked" : expired ? "Expired" : "Active"}
                          </span>
                        </div>
                        <span className={styles.itemMeta}>
                          Created{" "}
                          <time dateTime={share.createdAt}>
                            {new Date(share.createdAt).toLocaleString("en-CA")}
                          </time>
                        </span>
                        <span className={styles.itemMeta}>
                          Expires{" "}
                          <time dateTime={share.expiresAt}>
                            {new Date(share.expiresAt).toLocaleString("en-CA")}
                          </time>
                        </span>
                      </div>
                      <div className={styles.actions}>
                        <button
                          type="button"
                          aria-expanded={feedbackShare === share.id}
                          onClick={() =>
                            setFeedbackShare(feedbackShare === share.id ? null : share.id)
                          }
                        >
                          Review feedback
                        </button>
                        <button
                          type="button"
                          disabled={busy || !!share.revokedAt || expired}
                          onClick={() => void revoke(share.id)}
                        >
                          Revoke link
                        </button>
                      </div>
                    </div>
                    {feedbackShare === share.id ? (
                      <PresentationFeedbackPanel
                        mode="author"
                        presentationId={presentationId}
                        shareId={share.id}
                        versionId={share.versionId}
                      />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className={styles.empty}>
              <span className={styles.emptyIcon}>
                <EditorIcon name="link" />
              </span>
              <p className={styles.emptyTitle}>No review links yet.</p>
              <p className={styles.emptyDescription}>
                Create a link to invite reviewers to this presentation.
              </p>
            </div>
          )}
        </section>
      </div>
    </dialog>
  );
}
