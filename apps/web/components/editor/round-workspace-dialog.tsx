"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { useLocale } from "../locale-provider";
import { roundWorkspaceCopy } from "../../lib/i18n/round-workspace-copy";
import styles from "./round-builder.module.css";

/** Keep reference/review state mounted while closed so pending save retries survive. */
export function RoundWorkspaceDialog({
  open,
  title,
  onClose,
  returnFocusTo,
  children,
  className,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  returnFocusTo?: HTMLElement | null;
  children: ReactNode;
  className?: string;
}) {
  const { locale } = useLocale();
  const copy = roundWorkspaceCopy(locale);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!open) {
      element.close();
      return;
    }
    const previous = returnFocusTo ?? document.activeElement;
    element.showModal();
    element.querySelector<HTMLElement>("h2")?.focus();
    return () => {
      element.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [open, returnFocusTo]);
  return (
    <dialog
      ref={dialog}
      className={`${styles.workspaceDialog}${className ? ` ${className}` : ""}`}
      aria-label={title}
      aria-modal="true"
      onCancel={(event) => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        onClose();
      }}
    >
      <header className={styles.dialogHeader}>
        <h2 tabIndex={-1}>{title}</h2>
        <button type="button" className="button-quiet small-button" onClick={onClose}>
          {copy("Close")}
        </button>
      </header>
      <div className={styles.dialogBody}>{children}</div>
    </dialog>
  );
}
