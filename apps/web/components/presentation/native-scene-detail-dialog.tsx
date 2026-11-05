"use client";

import { useId, useLayoutEffect, useRef, type RefObject } from "react";
import styles from "./native-scene.module.css";

export function NativeSceneDetailDialog({
  title,
  body,
  onClose,
  returnFocusRef,
}: {
  title: string;
  body: string;
  onClose: () => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const trigger = returnFocusRef.current;
    const dialog = dialogRef.current;
    dialog?.showModal();
    closeRef.current?.focus();
    return () => {
      dialog?.close();
      if (trigger?.isConnected && !trigger.disabled) trigger.focus();
    };
  }, [returnFocusRef]);
  return (
    <dialog
      ref={dialogRef}
      className={styles.detailDialog}
      aria-labelledby={titleId}
      aria-modal="true"
      onKeyDown={(event) => event.stopPropagation()}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2 id={titleId}>{title}</h2>
      <button type="button" className="button-quiet" ref={closeRef} onClick={onClose}>
        Close details
      </button>
      <div className={styles.detailBody} tabIndex={0} role="region" aria-label={title}>
        <p>{body}</p>
      </div>
    </dialog>
  );
}
