"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useLocale } from "../locale-provider";
import { creatorWorkflowCopy } from "../editor/creator-workflow-copy";
import { authoringWorkflowCopy } from "../editor/authoring-workflow-copy";
import { usePresentationPublicationInfo } from "./presentation-publication-info";
import { focusModal, handleModalKeyDown } from "./presentation-modal-focus";
import styles from "./presentation-version-choice.module.css";

export function PresentationVersionChoice({
  href,
  error,
  onClose,
  onPublish,
  onPublishedExit,
  publicationContext,
}: {
  href: string;
  error: string;
  onClose: () => void;
  onPublish: () => Promise<boolean>;
  onPublishedExit: (event: MouseEvent<HTMLAnchorElement>) => void;
  publicationContext: { actorKey: string; presentationId: string; versionId: string };
}) {
  const { locale, t } = useLocale();
  const copy = creatorWorkflowCopy(locale);
  const authoring = authoringWorkflowCopy(locale);
  const { state: publicationState, retry } = usePresentationPublicationInfo(
    publicationContext.actorKey,
    publicationContext.presentationId,
    publicationContext.versionId,
  );
  const publication = publicationState.publication;
  const dialog = useRef<HTMLDivElement>(null);
  const publishingRef = useRef(false);
  const [publishing, setPublishing] = useState(false);
  useEffect(() => focusModal(dialog.current), []);

  async function publishLatest() {
    if (publishingRef.current) return;
    publishingRef.current = true;
    // Keep keyboard focus inside the dialog before its actions become disabled.
    dialog.current?.focus();
    setPublishing(true);
    try {
      await onPublish();
    } finally {
      publishingRef.current = false;
      setPublishing(false);
    }
  }

  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-labelledby="presentation-version-title"
      aria-describedby="presentation-version-description"
      aria-busy={publishing}
      lang={locale}
      ref={dialog}
      tabIndex={-1}
      onKeyDown={(event) =>
        handleModalKeyDown(event, () => {
          if (!publishingRef.current) onClose();
        })
      }
    >
      <section className={styles.panel}>
        <h2 id="presentation-version-title">{copy.chooseVersion}</h2>
        <p id="presentation-version-description">{copy.versionExplanation}</p>
        <div className={styles.publication} role="status" aria-live="polite">
          {publicationState.status === "ready" && publication ? (
            <>
              <strong>
                {authoring.version.replace(
                  "{version}",
                  new Intl.NumberFormat(locale).format(publication.version),
                )}
              </strong>
              <time dateTime={publication.publishedAt}>
                {authoring.publishedOn.replace(
                  "{date}",
                  new Intl.DateTimeFormat(locale, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(publication.publishedAt)),
                )}
              </time>
            </>
          ) : publicationState.status === "loading" ? (
            <span>{authoring.publicationLoading}</span>
          ) : (
            <>
              <span>{authoring.publicationUnavailable}</span>
              <button className="button-quiet" disabled={publishing} type="button" onClick={retry}>
                {authoring.retryPublication}
              </button>
            </>
          )}
        </div>
        {error ? (
          <p className="error" role="alert" lang="en-CA">
            {error}
          </p>
        ) : null}
        <div className={styles.actions}>
          <button
            className="button"
            disabled={publishing}
            onClick={() => void publishLatest()}
            type="button"
          >
            {publishing ? copy.publishing : copy.publishAndPresent}
          </button>
          {publishing ? (
            <span>{copy.presentPublished}</span>
          ) : (
            <Link className="button-quiet" href={href} prefetch={false} onClick={onPublishedExit}>
              {copy.presentPublished}
            </Link>
          )}
          <small>{copy.currentVersion}</small>
          <button className="button-quiet" disabled={publishing} onClick={onClose} type="button">
            {t("delivery.common.cancel")}
          </button>
        </div>
      </section>
    </div>
  );
}
