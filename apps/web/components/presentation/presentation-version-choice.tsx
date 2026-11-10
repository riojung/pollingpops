"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useLocale } from "../locale-provider";
import { creatorWorkflowCopy } from "../editor/creator-workflow-copy";
import { focusModal, handleModalKeyDown } from "./presentation-modal-focus";
import styles from "./presentation-version-choice.module.css";

export function PresentationVersionChoice({
  href,
  error,
  onClose,
  onPublish,
  onPublishedExit,
}: {
  href: string;
  error: string;
  onClose: () => void;
  onPublish: () => Promise<boolean>;
  onPublishedExit: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const { locale, t } = useLocale();
  const copy = creatorWorkflowCopy(locale);
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
