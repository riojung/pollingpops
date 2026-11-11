"use client";

import { useId, useLayoutEffect, useRef, type RefObject } from "react";
import type { SupportedLocale } from "@openround/contracts";
import { nativeAudienceCopy } from "./native-audience-copy";
import styles from "./native-scene.module.css";

export function NativeSceneDetailDialog({
  title,
  body,
  onClose,
  returnFocusRef,
  locale = "en-CA",
  titleLang = "",
}: {
  title: string;
  body: string;
  onClose: () => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  locale?: SupportedLocale;
  titleLang?: string;
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
      <h2 lang={titleLang} id={titleId}>
        {title}
      </h2>
      <button lang={locale} type="button" className="button-quiet" ref={closeRef} onClick={onClose}>
        {nativeAudienceCopy(locale)("Close details")}
      </button>
      <div
        lang={titleLang}
        className={styles.detailBody}
        tabIndex={0}
        role="region"
        aria-label={title}
      >
        <p lang="">{body}</p>
      </div>
    </dialog>
  );
}
