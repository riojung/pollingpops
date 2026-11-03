"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useLocale } from "../locale-provider";
import { canvasFacilitationUiCopy } from "../../lib/i18n/canvas-facilitation-ui-messages";
import { FacilitationIcon } from "./canvas-timer-controls";
import styles from "./canvas-facilitation.module.css";

export interface CanvasQuickTimerProps {
  open: boolean;
  onClose: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
  children: ReactNode;
}
export function CanvasQuickTimer({
  open,
  onClose,
  returnFocusRef,
  children,
}: CanvasQuickTimerProps) {
  const { locale } = useLocale();
  const copy = canvasFacilitationUiCopy(locale);
  const panel = useRef<HTMLElement>(null);
  const previous = useRef<HTMLElement | null>(null);
  const closeCallback = useRef(onClose);
  closeCallback.current = onClose;
  function restoreFocus() {
    const opener = returnFocusRef?.current ?? previous.current;
    if (document.querySelector('dialog[open], [aria-modal="true"]')) return;
    if (
      opener?.isConnected &&
      opener.getClientRects().length &&
      !opener.closest("[inert],[hidden]") &&
      !opener.matches(":disabled")
    )
      opener.focus();
  }
  useEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    previous.current = active instanceof HTMLElement ? active : null;
    const node = panel.current;
    if (!document.querySelector('dialog[open], [aria-modal="true"]') && document.hasFocus()) {
      const first =
        node?.querySelector<HTMLElement>("[data-timer-primary]:not(:disabled)") ??
        node?.querySelector<HTMLElement>("button:not(:disabled),input:not(:disabled)");
      (first ?? node)?.focus();
    }
    return () => {
      const current = document.activeElement;
      // Leaving the timer for another control must retain that control's focus.
      if (!current || current === document.body || node?.contains(current)) restoreFocus();
    };
  }, [open, returnFocusRef]);
  if (!open || typeof document === "undefined") return null;
  function close() {
    restoreFocus();
    closeCallback.current();
  }
  return createPortal(
    <section
      ref={panel}
      className={styles.quickTimer}
      role="region"
      aria-label={copy.quickTimer}
      data-testid="canvas-quick-timer"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (
          event.key === "Escape" &&
          !event.nativeEvent.isComposing &&
          !event.defaultPrevented &&
          !document.querySelector('dialog[open], [aria-modal="true"]')
        ) {
          event.preventDefault();
          close();
        }
      }}
    >
      <header className={styles.quickTimerHeader}>
        <h2>
          <FacilitationIcon name="timer" />
          {copy.quickTimer}
        </h2>
        <button type="button" aria-label={copy.closeTimer} title={copy.closeTimer} onClick={close}>
          <FacilitationIcon name="close" />
        </button>
      </header>
      <div className={styles.quickTimerBody}>{children}</div>
    </section>,
    document.body,
  );
}
