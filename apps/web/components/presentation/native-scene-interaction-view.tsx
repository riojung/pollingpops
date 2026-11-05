"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import { isSafePresentationLink, type PresentationSceneNode } from "@openround/contracts";
import styles from "./native-scene.module.css";
import { NativeSceneDetailDialog } from "./native-scene-detail-dialog";

export type NativeInteractionNode = Extract<
  PresentationSceneNode,
  { type: "reveal" | "link" | "hotspot" | "dialog" | "navigation" }
>;

export interface NativeSceneInteractionRuntime {
  mode: "live_staff" | "live_audience" | "review";
  revealedNodeIds?: readonly string[];
  navigationTargets?: readonly {
    blockId: string;
    available: boolean;
    blockedReason: string | null;
  }[];
  disabled?: boolean;
  onNavigate?: (nodeId: string, targetBlockId: string) => void;
  onSetReveal?: (nodeId: string, revealed: boolean) => void;
}

export function isNativeInteractionNode(
  node: PresentationSceneNode,
): node is NativeInteractionNode {
  return ["reveal", "link", "hotspot", "dialog", "navigation"].includes(node.type);
}

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
  runtime,
}: {
  node: NativeInteractionNode;
  editing?: boolean;
  runtime?: NativeSceneInteractionRuntime;
}) {
  const regionId = useId();
  const [open, setOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const detailTriggerRef = useRef<HTMLButtonElement>(null);
  const label =
    node.label.trim() ||
    {
      reveal: "Reveal panel",
      link: "External link",
      hotspot: "Image hotspot",
      dialog: "Detail dialog",
      navigation: "Slide link",
    }[node.type];
  if (editing) {
    return (
      <div className={styles.interaction} data-native-interaction={node.type}>
        <span className={styles.interactionLabel}>{label}</span>
        {node.type === "reveal" || node.type === "hotspot" || node.type === "dialog" ? (
          <p className={styles.interactionPreview}>{node.body || "Revealed audience content"}</p>
        ) : node.type === "link" ? (
          <span className={styles.interactionNotice}>External link · opens in a new tab</span>
        ) : (
          <span className={styles.interactionNotice}>
            Slide navigation · facilitator controlled live
          </span>
        )}
      </div>
    );
  }
  if (node.type === "hotspot" || node.type === "dialog") {
    return (
      <div
        className={styles.interaction}
        data-native-interaction={node.type}
        onKeyDown={containNativeInteractionKey}
      >
        <button
          type="button"
          className={styles.interactionAction}
          ref={detailTriggerRef}
          aria-haspopup="dialog"
          aria-expanded={detailOpen}
          onClick={() => setDetailOpen(true)}
        >
          <span>{label}</span>
          <span className={styles.interactionNotice}>Open details on this screen</span>
        </button>
        {detailOpen ? (
          <NativeSceneDetailDialog
            title={node.detailTitle || label}
            body={node.body}
            onClose={() => setDetailOpen(false)}
            returnFocusRef={detailTriggerRef}
          />
        ) : null}
      </div>
    );
  }
  if (node.type === "navigation") {
    const policy = runtime?.navigationTargets?.find(
      (target) => target.blockId.toLowerCase() === node.targetBlockId?.toLowerCase(),
    );
    const available = Boolean(
      node.targetBlockId &&
      runtime?.onNavigate &&
      runtime.mode !== "live_audience" &&
      policy?.available &&
      !runtime.disabled,
    );
    const reason =
      runtime?.mode === "live_audience"
        ? "The facilitator controls slide navigation."
        : policy?.blockedReason || "Slide navigation is unavailable here.";
    return (
      <div
        className={styles.interaction}
        data-native-interaction="navigation"
        onKeyDown={containNativeInteractionKey}
      >
        <button
          type="button"
          className={styles.interactionAction}
          disabled={!available}
          onClick={() => {
            if (available && node.targetBlockId) runtime?.onNavigate?.(node.id, node.targetBlockId);
          }}
        >
          <span>{label}</span>
          <span className={styles.interactionNotice}>
            {runtime?.mode === "review"
              ? "Go to slide"
              : runtime?.mode === "live_audience"
                ? "Facilitator navigation"
                : "Jump for everyone"}
          </span>
        </button>
        {!available ? <p className={styles.interactionNotice}>{reason}</p> : null}
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
  const shared = node.scope === "broadcast" && runtime && runtime.mode !== "review";
  const revealed = shared ? Boolean(runtime.revealedNodeIds?.includes(node.id)) : open;
  const canSetShared = runtime?.mode === "live_staff" && runtime.onSetReveal && !runtime.disabled;
  return (
    <div
      className={styles.interaction}
      data-native-interaction="reveal"
      onKeyDown={containNativeInteractionKey}
    >
      <button
        className={styles.interactionAction}
        type="button"
        aria-expanded={revealed}
        aria-controls={regionId}
        disabled={shared ? !canSetShared : undefined}
        onClick={() => {
          if (shared) {
            if (canSetShared) runtime?.onSetReveal?.(node.id, !revealed);
          } else setOpen((current) => !current);
        }}
      >
        <span>{label}</span>
        <span className={styles.interactionNotice}>
          {revealed ? "Hide" : "Show"} {shared ? "for everyone" : "on this screen"}
        </span>
      </button>
      <div
        className={styles.revealBody}
        id={regionId}
        hidden={!revealed}
        role="region"
        aria-label={label}
        tabIndex={revealed ? 0 : undefined}
      >
        {revealed ? <p>{node.body}</p> : null}
      </div>
    </div>
  );
}
