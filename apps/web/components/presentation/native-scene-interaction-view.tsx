"use client";

import { useId, useState, type KeyboardEvent } from "react";
import { isSafePresentationLink, type PresentationSceneNode } from "@openround/contracts";
import styles from "./native-scene.module.css";

export type NativeInteractionNode = Extract<PresentationSceneNode, { type: "reveal" | "link" }>;

/** Keep native control keys away from document-level presentation shortcuts. */
export function containNativeInteractionKey(event: KeyboardEvent<HTMLElement>) {
  if (
    [
      " ",
      "Enter",
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
      "PageUp",
      "PageDown",
      "Home",
      "End",
    ].includes(event.key)
  )
    event.stopPropagation();
}

/** Audience content with viewer-local state only; this component has no command or response API. */
export function NativeSceneInteractionView({
  node,
  editing = false,
}: {
  node: NativeInteractionNode;
  editing?: boolean;
}) {
  const regionId = useId();
  const [open, setOpen] = useState(false);
  const label = node.label.trim() || (node.type === "reveal" ? "Reveal panel" : "External link");
  if (editing) {
    return (
      <div className={styles.interaction} data-native-interaction={node.type}>
        <span className={styles.interactionLabel}>{label}</span>
        {node.type === "reveal" ? (
          <p className={styles.interactionPreview}>{node.body || "Revealed audience content"}</p>
        ) : (
          <span className={styles.interactionNotice}>External link · opens in a new tab</span>
        )}
      </div>
    );
  }
  if (node.type === "link") {
    return (
      <div
        className={styles.interaction}
        data-native-interaction="link"
        onKeyDown={containNativeInteractionKey}
      >
        {node.label.trim() &&
        Array.from(node.href).length <= 2_048 &&
        isSafePresentationLink(node.href) ? (
          <a
            className={styles.interactionAction}
            href={node.href}
            target="_blank"
            rel="noopener noreferrer"
            referrerPolicy="no-referrer"
          >
            <span>{label}</span>
            <span className={styles.interactionNotice}>Opens in a new tab</span>
          </a>
        ) : (
          <span className={styles.interactionLabel}>{label} · link unavailable</span>
        )}
      </div>
    );
  }
  return (
    <div
      className={styles.interaction}
      data-native-interaction="reveal"
      onKeyDown={containNativeInteractionKey}
    >
      <button
        className={styles.interactionAction}
        type="button"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{label}</span>
        <span className={styles.interactionNotice}>{open ? "Hide" : "Show"} on this screen</span>
      </button>
      <div
        className={styles.revealBody}
        id={regionId}
        hidden={!open}
        role="region"
        aria-label={label}
        tabIndex={open ? 0 : undefined}
      >
        {open ? <p>{node.body}</p> : null}
      </div>
    </div>
  );
}
