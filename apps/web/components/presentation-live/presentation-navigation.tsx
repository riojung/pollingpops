"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";
import type { PresentationHostSnapshot, PresentationControlCommand } from "@openround/contracts";
import { presentationNavigationRetryLabel } from "../../lib/presentation-navigation";
import styles from "./presentation-navigation.module.css";

type Navigation = NonNullable<PresentationHostSnapshot["navigation"]>;

export function PresentationNavigationDialog({
  navigation,
  disabled,
  onJump,
  onReturn,
  onClose,
  returnFocusRef,
  pendingCommand,
  busy = false,
  onRetry,
  retryDisabled = false,
}: {
  navigation: Navigation;
  disabled: boolean;
  onJump: (blockId: string) => void;
  onReturn: () => void;
  onClose: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
  pendingCommand?: PresentationControlCommand | null;
  busy?: boolean;
  onRetry?: () => void;
  retryDisabled?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const previousFocus = document.activeElement;
    const dialog = dialogRef.current;
    dialog?.showModal();
    closeRef.current?.focus();
    return () => {
      dialog?.close();
      if (
        previousFocus instanceof HTMLElement &&
        previousFocus.isConnected &&
        !(previousFocus instanceof HTMLButtonElement && previousFocus.disabled)
      )
        previousFocus.focus();
      else returnFocusRef?.current?.focus();
    };
  }, [returnFocusRef]);

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-label="Presentation navigation"
      aria-modal="true"
      lang="en-CA"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2>Presentation navigation</h2>
      <button type="button" className="button-quiet full-width" ref={closeRef} onClick={onClose}>
        Close navigation
      </button>
      <p>
        Jump to a slide or activity. Reviewed activities keep their saved results and remain closed.
      </p>
      {pendingCommand ? (
        <div>
          <p role="status" aria-live="polite">
            {busy
              ? "Waiting for server confirmation…"
              : "Action not yet confirmed. Retry to confirm the original action."}
          </p>
          {!busy && onRetry ? (
            <button
              className="button-quiet"
              type="button"
              disabled={retryDisabled}
              onClick={onRetry}
            >
              {presentationNavigationRetryLabel(pendingCommand)}
            </button>
          ) : null}
        </div>
      ) : null}
      {navigation.blockedReason ? <p role="status">{navigation.blockedReason}</p> : null}
      <ol className={styles.entries} role="list">
        {navigation.entries.map((entry, index) => (
          <li key={entry.blockId} className={styles.entry}>
            {entry.sectionTitle &&
            (index === 0 || navigation.entries[index - 1]?.sectionId !== entry.sectionId) ? (
              <p className={styles.section}>{entry.sectionTitle}</p>
            ) : null}
            <button
              type="button"
              className="button-quiet"
              disabled={disabled || entry.status === "current" || !entry.canJump}
              aria-current={entry.status === "current" ? "step" : undefined}
              aria-describedby={
                entry.blockedReason ? `navigation-reason-${entry.blockId}` : undefined
              }
              onClick={() => onJump(entry.blockId)}
            >
              <span lang="">{entry.title}</span>
              <span className={styles.detail}>
                {entry.kind === "content" ? "Slide" : "Activity"} ·{" "}
                {entry.status === "current"
                  ? "Current"
                  : entry.status === "visited"
                    ? "Visited"
                    : "Not visited"}
                {entry.kind === "question" && entry.phase && entry.phase !== "question_open"
                  ? " · Review"
                  : ""}
              </span>
            </button>
            {entry.blockedReason ? (
              <p className={styles.reason} id={`navigation-reason-${entry.blockId}`}>
                {entry.blockedReason}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
      {navigation.returnTarget ? (
        <div className={styles.return}>
          <p>
            Return target: <span lang="">{navigation.returnTarget.title}</span>
          </p>
          <button
            type="button"
            className="button"
            disabled={disabled || !navigation.canReturn}
            onClick={onReturn}
          >
            Return to path: <span lang="">{navigation.returnTarget.title}</span>
          </button>
        </div>
      ) : null}
    </dialog>
  );
}
