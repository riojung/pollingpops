"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import {
  isSafePresentationLink,
  type PresentationSceneNode,
  type SupportedLocale,
} from "@openround/contracts";
import styles from "./native-scene.module.css";
import { NativeSceneDetailDialog } from "./native-scene-detail-dialog";
import { nativeAudienceCopy, nativeAudienceInteractionKindKeys } from "./native-audience-copy";
import { localizeBranchNavigationFeedback } from "./branch-navigation-copy";
import { useNativeTextOverflow } from "./use-native-text-overflow";

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

/** Passive creator artwork remains keyboard-scrollable when its authored content overflows. */
function NativeSceneInteractionPreview({
  node,
  label,
  labelLang,
  locale,
}: {
  node: NativeInteractionNode;
  label: string;
  labelLang: string;
  locale: SupportedLocale;
}) {
  const copy = nativeAudienceCopy(locale);
  const scroll = useNativeTextOverflow(JSON.stringify([node, locale]));
  return (
    <div {...scroll} className={styles.interaction} data-native-interaction={node.type}>
      <span lang={labelLang} className={styles.interactionLabel}>
        {label}
      </span>
      {node.type === "reveal" || node.type === "hotspot" || node.type === "dialog" ? (
        <p lang={node.body ? "" : locale} className={styles.interactionPreview}>
          {node.body || copy("Revealed audience content")}
        </p>
      ) : node.type === "link" ? (
        <span lang={locale} className={styles.interactionNotice}>
          {copy("External link · opens in a new tab")}
        </span>
      ) : (
        <span lang={locale} className={styles.interactionNotice}>
          {copy("Slide navigation · facilitator controlled live")}
        </span>
      )}
    </div>
  );
}

/** Audience content with viewer-local state only; this component has no command or response API. */
export function NativeSceneInteractionView({
  node,
  editing = false,
  runtime,
  locale = "en-CA",
}: {
  node: NativeInteractionNode;
  editing?: boolean;
  runtime?: NativeSceneInteractionRuntime;
  locale?: SupportedLocale;
}) {
  const copy = nativeAudienceCopy(locale);
  const regionId = useId();
  const [open, setOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const detailTriggerRef = useRef<HTMLButtonElement>(null);
  const label = node.label.trim() || copy(nativeAudienceInteractionKindKeys[node.type]);
  const labelLang = node.label.trim() ? "" : locale;
  if (editing) {
    return (
      <NativeSceneInteractionPreview
        node={node}
        label={label}
        labelLang={labelLang}
        locale={locale}
      />
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
          <span lang={labelLang}>{label}</span>
          <span lang={locale} className={styles.interactionNotice}>
            {copy("Open details on this screen")}
          </span>
        </button>
        {detailOpen ? (
          <NativeSceneDetailDialog
            title={node.detailTitle || label}
            body={node.body}
            onClose={() => setDetailOpen(false)}
            returnFocusRef={detailTriggerRef}
            locale={locale}
            titleLang={node.detailTitle ? "" : labelLang}
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
        ? { text: copy("The facilitator controls slide navigation."), lang: locale }
        : policy?.blockedReason
          ? localizeBranchNavigationFeedback(locale, policy.blockedReason)
          : { text: copy("Slide navigation is unavailable here."), lang: locale };
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
          <span lang={labelLang}>{label}</span>
          <span lang={locale} className={styles.interactionNotice}>
            {runtime?.mode === "review"
              ? copy("Go to slide")
              : runtime?.mode === "live_audience"
                ? copy("Facilitator navigation")
                : copy("Jump for everyone")}
          </span>
        </button>
        {!available ? (
          <p lang={reason.lang} className={styles.interactionNotice}>
            {reason.text}
          </p>
        ) : null}
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
            <span lang={labelLang}>{label}</span>
            <span lang={locale} className={styles.interactionNotice}>
              {copy("Opens in a new tab")}
            </span>
          </a>
        ) : (
          <span className={styles.interactionLabel}>
            <span lang={labelLang}>{label}</span> ·{" "}
            <span lang={locale}>{copy("link unavailable")}</span>
          </span>
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
        <span lang={labelLang}>{label}</span>
        <span lang={locale} className={styles.interactionNotice}>
          {copy(
            shared
              ? revealed
                ? "Hide for everyone"
                : "Show for everyone"
              : revealed
                ? "Hide on this screen"
                : "Show on this screen",
          )}
        </span>
      </button>
      <div
        className={styles.revealBody}
        id={regionId}
        hidden={!revealed}
        role="region"
        aria-label={label}
        lang={labelLang}
        tabIndex={revealed ? 0 : undefined}
      >
        {revealed ? <p lang="">{node.body}</p> : null}
      </div>
    </div>
  );
}
