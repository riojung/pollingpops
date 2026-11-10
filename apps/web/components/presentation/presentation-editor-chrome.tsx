"use client";

import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { PresentationBlockDraft, PresentationSceneDesign } from "@openround/contracts";
import { AUTH_CHANGE_EVENT } from "../../lib/api";
import { ContentSlideView } from "./content-slide-view";
import { PresentationActivitySlide } from "./presentation-activity-slide";
import {
  PresentationThumbnailImage,
  ThumbnailImagePlaceholder,
} from "./presentation-thumbnail-image";
import type { PresentationThumbnailMediaScope } from "./presentation-thumbnail-media";
import styles from "./presentation-editor-chrome.module.css";

// Original line drawings shared by the presentation workspace. No external icon assets.
const paths = {
  back: ["m14 6-6 6 6 6"],
  slides: ["M5 4h14v11H5z", "M3 8v11h12"],
  inspector: ["M3 4h18v16H3z", "M14 4v16", "M17 8h1", "M17 12h1"],
  preview: ["M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z", "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6"],
  play: ["m8 5 11 7-11 7Z"],
  undo: ["M4 9h10a6 6 0 0 1 0 12", "m8 5-4 4 4 4"],
  redo: ["M20 9H10a6 6 0 0 0 0 12", "m16 5 4 4-4 4"],
  more: ["M5 11v2", "M12 11v2", "M19 11v2"],
  plus: ["M12 5v14", "M5 12h14"],
  image: ["M3 4h18v16H3z", "m3 16 6-6 6 6 3-3 3 3", "M16 8h.01"],
  text: ["M4 5h16", "M12 5v15", "M8 20h8", "M4 5v3", "M20 5v3"],
  shape: ["M4 4h10v10H4z", "M15 10a6 6 0 1 1-5 5"],
  connector: ["M4 5h5v5H4z", "M15 14h5v5h-5z", "M9 7h3v10h3"],
  table: ["M3 4h18v16H3z", "M3 9h18", "M9 9v11", "M15 9v11"],
  chart: ["M4 4v16h17", "M8 16v-5", "M13 16V7", "M18 16v-8"],
  interaction: ["M8 12V6a2 2 0 0 1 4 0v6", "M12 10h3l4 4-2 6H9l-5-6a2 2 0 0 1 3-2l1 1"],
  reveal: ["M4 7h11v13H4z", "m15 4 1 3 3 1-3 1-1 3-1-3-3-1 3-1Z", "M8 12h3", "M8 16h3"],
  link: [
    "m9 15 6-6",
    "M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0",
    "m16 8 1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0",
  ],
  dialog: ["M3 4h18v14H9l-5 3v-3H3z", "M7 9h10", "M7 13h6"],
  hotspot: [
    "M12 2v3",
    "M12 19v3",
    "M2 12h3",
    "M19 12h3",
    "M12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12",
    "M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4",
  ],
  navigation: ["M3 4h7v7H3z", "M14 13h7v7h-7z", "M10 7h8v6", "m15 10 3 3 3-3"],
  "arrow-up": ["M12 20V4", "m6 10 6-6 6 6"],
  "arrow-down": ["M12 4v16", "m6 14 6 6 6-6"],
  "eye-off": [
    "m3 3 18 18",
    "M10 5a12 12 0 0 1 12 7 16 16 0 0 1-4 5",
    "M6 6a17 17 0 0 0-4 6s4 7 10 7a11 11 0 0 0 4-1",
    "M10 10a3 3 0 0 0 4 4",
  ],
  duplicate: ["M8 8h12v12H8z", "M16 8V4H4v12h4"],
  trash: ["M4 6h16", "M9 6V3h6v3", "m6 6 1 15h10l1-15", "M10 10v7", "M14 10v7"],
  import: ["M4 14v6h16v-6", "M12 3v12", "m7 10 5 5 5-5"],
  round: ["M12 3a9 9 0 1 0 9 9", "M12 3v9h9", "M4 17l4-2"],
  source: ["m8 6-6 6 6 6", "m16 6 6 6-6 6", "m14 3-4 18"],
  outline: ["M8 5h13", "M8 12h13", "M8 19h13", "M3 5h.01", "M3 12h.01", "M3 19h.01"],
  recovery: ["M4 10a8 8 0 1 1 1 8", "M4 4v6h6", "M12 7v5l3 2"],
  "chevron-down": ["m6 9 6 6 6-6"],
  close: ["m5 5 14 14", "M19 5 5 19"],
  content: ["M5 3h10l4 4v14H5z", "M14 3v5h5", "M9 12h6", "M9 16h6"],
  layout: ["M3 4h18v16H3z", "M3 10h18", "M10 10v10"],
  media: ["M3 4h18v16H3z", "m10 8 6 4-6 4Z"],
  notes: ["M4 3h16v14l-5 4H4z", "M15 21v-5h5", "M8 7h8", "M8 11h8", "M8 15h3"],
  accessibility: ["M12 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4", "M4 9h16", "M12 7v7", "m8 21 4-7 4 7"],
  check: ["m5 12 4 4L19 6"],
  sparkle: ["m12 3 2 6 6 3-6 2-2 7-2-7-6-2 6-3Z", "M20 3v4", "M18 5h4"],
  rewrite: ["M4 5h9", "M4 10h6", "M4 15h3", "m9 20 2-6L19 6l3 3-8 8Z", "m17 8 3 3"],
  shorten: ["M3 5h18", "M3 10h14", "M3 15h8", "M3 20h5", "M21 14h-6", "m18 11-3 3 3 3"],
  translate: [
    "M3 5h12",
    "M9 3v2",
    "M5 5c1 6 4 9 8 11",
    "M12 5c-1 6-4 9-9 12",
    "m13 21 4-11 4 11",
    "M15 17h4",
  ],
  format: ["M4 4h12", "M10 4v12", "M7 16h6", "m16 21 3-9 3 9", "M17 18h4"],
  palette: [
    "M12 3a9 9 0 1 0 0 18h2a2 2 0 0 0 1-4 2 2 0 0 1 1-4h3c3 0 3-10-7-10Z",
    "M7 10h.01",
    "M10 7h.01",
    "M15 7h.01",
    "M18 10h.01",
  ],
  type: ["m3 20 6-16 6 16", "M5 15h8", "M16 10h6", "M19 10v10", "M17 20h4"],
  spacing: ["M8 4h13", "M8 12h13", "M8 20h13", "M3 4v16", "m1 6 2-2 2 2", "m1 18 2 2 2-2"],
  "align-left": ["M3 3v18", "M7 6h14", "M7 12h9", "M7 18h14"],
  "align-center": ["M12 3v18", "M4 6h16", "M7 12h10", "M4 18h16"],
  "align-right": ["M21 3v18", "M3 6h14", "M8 12h9", "M3 18h14"],
  "align-top": ["M3 3h18", "M6 7v14", "M12 7v9", "M18 7v14"],
  "align-middle": ["M3 12h18", "M6 4v16", "M12 7v10", "M18 4v16"],
  "align-bottom": ["M3 21h18", "M6 3v14", "M12 8v9", "M18 3v14"],
  "distribute-horizontal": ["M3 3v18", "M21 3v18", "M7 7h3v10H7z", "M14 5h3v14h-3z"],
  "distribute-vertical": ["M3 3h18", "M3 21h18", "M7 7h10v3H7z", "M5 14h14v3H5z"],
  "layer-back": ["m3 13 9 5 9-5", "m3 17 9 5 9-5", "M12 2v10", "m8 8 4 4 4-4"],
  "layer-backward": ["m3 8 9-5 9 5-9 5Z", "m3 13 9 5 9-5", "M12 13v9", "m8 18 4 4 4-4"],
  "layer-forward": ["m3 16 9 5 9-5", "m3 11 9 5 9-5", "M12 2v10", "m8 6 4-4 4 4"],
  "layer-front": ["m3 12 9 5 9-5", "m3 17 9 5 9-5", "M12 2v10", "m8 6 4-4 4 4"],
} satisfies Record<string, string[]>;
export type EditorIconName = keyof typeof paths;

export function EditorIcon({ name }: { name: EditorIconName }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      data-editor-icon={name}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name].map((d, i) => (
        <path d={d} key={i} />
      ))}
    </svg>
  );
}

export function EditorMenuSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.menuSection} role="group" aria-label={label}>
      <span className={styles.menuSectionLabel} aria-hidden="true">
        {label}
      </span>
      {children}
    </div>
  );
}

export function EditorMenuItem({
  icon,
  children,
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon?: EditorIconName }) {
  return (
    <button {...props} type={type} className={`${styles.menuItem} ${className}`}>
      {icon ? <EditorIcon name={icon} /> : null}
      <span>{children}</span>
    </button>
  );
}

export const EDITOR_MODAL_SELECTOR =
  'dialog[open], [role="dialog"][aria-modal="true"]:not(dialog):not([hidden]):not([aria-hidden="true"])';

function hideEditorPopup(popup: HTMLDivElement | null) {
  if (popup?.hasAttribute("popover")) popup.hidePopover?.();
}

/** External dialogs return focus to a visible summary, without reopening an obstructing menu. */
export function handoffEditorDisclosure(source?: HTMLElement) {
  const menu = source?.closest("details");
  if (!menu?.open) return;
  menu.open = false;
  hideEditorPopup(menu.querySelector<HTMLDivElement>(":scope > [popover]"));
  menu.querySelector("summary")?.focus({ preventScroll: true });
}

/** Children stay in their native details ancestry and remain mounted between openings. */
export function EditorDisclosure({
  label,
  children,
  className = "",
  compact = false,
  icon,
  align = "end",
  placement = "auto",
  inline = false,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  compact?: boolean;
  icon?: EditorIconName;
  align?: "start" | "end";
  placement?: "auto" | "top" | "bottom";
  inline?: boolean;
}) {
  const details = useRef<HTMLDetailsElement>(null);
  const body = useRef<HTMLDivElement>(null);
  // A manual popover escapes clipping scroll containers without a portal: insertion
  // actions can still find and close their closest details, and dialogs keep state.
  const syncPopup = () => {
    const node = details.current;
    const popup = body.current;
    if (!node || !popup || inline) return;
    const modal = document.querySelector<HTMLElement>(EDITOR_MODAL_SELECTOR);
    const externalCustomModal = modal && modal.tagName !== "DIALOG" && !popup.contains(modal);
    if (node.open && externalCustomModal) {
      // Custom modals use the normal stacking tree. Let their existing backdrop
      // cover the menu while keeping its opener focusable for modal cleanup.
      if (popup.hasAttribute("popover")) {
        hideEditorPopup(popup);
        popup.removeAttribute("popover");
        popup.dataset.suspended = "true";
      }
      return;
    }
    if (popup.dataset.suspended) {
      popup.setAttribute("popover", "manual");
      delete popup.dataset.suspended;
    }
    if (!node.open) {
      hideEditorPopup(popup);
      return;
    }
    if (popup.showPopover && !popup.matches(":popover-open")) popup.showPopover();
    const anchor = node.querySelector("summary")?.getBoundingClientRect();
    if (!anchor) return;
    const viewport = window.visualViewport;
    const leftEdge = (viewport?.offsetLeft ?? 0) + 12;
    const topEdge = (viewport?.offsetTop ?? 0) + 12;
    const rightEdge = (viewport?.offsetLeft ?? 0) + (viewport?.width ?? window.innerWidth) - 12;
    const bottomEdge = (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight) - 12;
    const below = Math.max(0, bottomEdge - anchor.bottom - 8);
    const above = Math.max(0, anchor.top - 8 - topEdge);
    // Rects use viewport pixels, while fixed offsets and dimensions use the
    // element's CSS pixels. Ancestor CSS zoom can make those units differ.
    const scale = popup.getBoundingClientRect().width / popup.offsetWidth || 1;
    const desiredHeight = Math.min(popup.scrollHeight * scale, 570);
    const upwards =
      placement === "top"
        ? above >= Math.min(120, desiredHeight) || above > below
        : placement === "bottom"
          ? below < Math.min(120, desiredHeight) && above > below
          : desiredHeight > below && above > below;
    popup.style.maxHeight = `${Math.min(570, upwards ? above : below) / scale}px`;
    popup.style.maxWidth = `${Math.max(0, rightEdge - leftEdge) / scale}px`;
    const bounds = popup.getBoundingClientRect();
    const wantedLeft = align === "start" ? anchor.left : anchor.right - bounds.width;
    popup.style.left = `${Math.max(leftEdge, Math.min(wantedLeft, rightEdge - bounds.width)) / scale}px`;
    const wantedTop = upwards ? anchor.top - 8 - bounds.height : anchor.bottom + 8;
    popup.style.top = `${Math.max(topEdge, Math.min(wantedTop, bottomEdge - bounds.height)) / scale}px`;
    popup.dataset.placement = upwards ? "top" : "bottom";
  };
  useEffect(() => {
    let pointerInside = false;
    const close = (event: Event) => {
      const node = details.current;
      if (!node?.open) return;
      if (event.type !== AUTH_CHANGE_EVENT && document.querySelector(EDITOR_MODAL_SELECTOR)) {
        syncPopup();
        return;
      }
      if (
        event.type === AUTH_CHANGE_EVENT ||
        (event.target instanceof Node && !node.contains(event.target))
      ) {
        node.open = false;
        hideEditorPopup(body.current);
      } else {
        syncPopup();
      }
    };
    const pointerDown = (event: PointerEvent) => {
      pointerInside = event.target instanceof Node && !!details.current?.contains(event.target);
      close(event);
    };
    const pointerUp = () => {
      setTimeout(() => {
        pointerInside = false;
      }, 0);
    };
    const focusOut = (event: FocusEvent) => {
      // Safari blurs an old control on pointerdown, then focuses buttons only
      // in click capture. Do not dismiss an action before that click can run.
      if (pointerInside) return;
      if (event.relatedTarget instanceof Node && details.current?.contains(event.relatedTarget))
        return;
      // Safari can Tab into browser chrome with no focusin. Wait until the focus
      // algorithm completes; a microtask can run between blur and the new focus.
      setTimeout(() => {
        const node = details.current;
        if (!node?.open || document.querySelector(EDITOR_MODAL_SELECTOR)) return;
        if (!node.contains(document.activeElement)) {
          node.open = false;
          hideEditorPopup(body.current);
        }
      }, 0);
    };
    document.addEventListener("pointerdown", pointerDown);
    document.addEventListener("pointerup", pointerUp);
    document.addEventListener("pointercancel", pointerUp);
    document.addEventListener("focusin", close);
    document.addEventListener("focusout", focusOut);
    window.addEventListener(AUTH_CHANGE_EVENT, close);
    window.addEventListener("resize", syncPopup);
    window.addEventListener("scroll", syncPopup, true);
    window.visualViewport?.addEventListener("resize", syncPopup);
    window.visualViewport?.addEventListener("scroll", syncPopup);
    const size = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(syncPopup);
    if (body.current && !inline) size?.observe(body.current);
    const modals = typeof MutationObserver === "undefined" ? null : new MutationObserver(syncPopup);
    if (document.body && !inline)
      modals?.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["open", "role", "aria-modal", "hidden", "aria-hidden"],
      });
    return () => {
      document.removeEventListener("pointerdown", pointerDown);
      document.removeEventListener("pointerup", pointerUp);
      document.removeEventListener("pointercancel", pointerUp);
      document.removeEventListener("focusin", close);
      document.removeEventListener("focusout", focusOut);
      window.removeEventListener(AUTH_CHANGE_EVENT, close);
      window.removeEventListener("resize", syncPopup);
      window.removeEventListener("scroll", syncPopup, true);
      window.visualViewport?.removeEventListener("resize", syncPopup);
      window.visualViewport?.removeEventListener("scroll", syncPopup);
      size?.disconnect();
      modals?.disconnect();
    };
  }, [align, placement, inline]);
  return (
    <details
      ref={details}
      className={`${styles.disclosure} ${compact ? styles.compact : ""} ${inline ? styles.inline : ""} ${className}`}
      onToggle={syncPopup}
      onClickCapture={(event) => {
        if (!(event.target instanceof Element) || event.target.closest('dialog, [role="dialog"]'))
          return;
        const button = event.target.closest<HTMLButtonElement>("button");
        // Safari pointer activation does not focus buttons. Establish the opener before
        // its handler mounts a dialog so the dialog can restore focus to this action.
        if (button && event.currentTarget.contains(button) && !button.disabled)
          button.focus({ preventScroll: true });
      }}
      onKeyDown={(event) => {
        if (
          event.key !== "Escape" ||
          (event.target instanceof Element && event.target.closest(EDITOR_MODAL_SELECTOR))
        )
          return;
        if (details.current?.open) {
          event.preventDefault();
          event.stopPropagation();
          details.current.open = false;
          hideEditorPopup(body.current);
          details.current.querySelector("summary")?.focus();
        }
      }}
    >
      <summary aria-label={label} title={label}>
        {icon || compact ? <EditorIcon name={icon ?? "more"} /> : null}
        {compact ? null : <span>{label}</span>}
        <span aria-hidden="true" className={styles.chevron}>
          <EditorIcon name="chevron-down" />
        </span>
      </summary>
      <div
        ref={body}
        className={styles.disclosureBody}
        popover={inline ? undefined : "manual"}
        role="group"
        aria-label={label}
      >
        {children}
      </div>
    </details>
  );
}

/** Shared renderer; only observed visible rows mount authorized media readers. */
export function PresentationSlideThumbnail({
  block,
  design,
  priority = false,
  mediaScope,
  mediaEnabled = true,
}: {
  block: PresentationBlockDraft;
  design?: PresentationSceneDesign;
  priority?: boolean;
  mediaScope?: PresentationThumbnailMediaScope;
  mediaEnabled?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(priority),
    [imagesVisible, setImagesVisible] = useState(false),
    [width, setWidth] = useState(210);
  useEffect(() => {
    const node = container.current;
    if (!node) return;
    const measure = () => setWidth(Math.max(1, node.getBoundingClientRect().width));
    measure();
    const size = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    size?.observe(node);
    const checkVisible = () => {
      const box = node.getBoundingClientRect();
      const shown =
        box.width > 0 &&
        box.height > 0 &&
        box.bottom > 0 &&
        box.right > 0 &&
        box.top < window.innerHeight &&
        box.left < window.innerWidth;
      setVisible(shown || priority);
      setImagesVisible(shown);
    };
    const visibility =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([entry]) => {
            setVisible(!!entry?.isIntersecting);
            setImagesVisible(!!entry?.isIntersecting);
          });
    visibility?.observe(node);
    if (!visibility) {
      checkVisible();
      window.addEventListener("scroll", checkVisible, true);
      window.addEventListener("resize", checkVisible);
    }
    return () => {
      size?.disconnect();
      visibility?.disconnect();
      if (!visibility) {
        window.removeEventListener("scroll", checkVisible, true);
        window.removeEventListener("resize", checkVisible);
      }
    };
  }, []);
  const image = (mediaId: string, altText: string | null) =>
    mediaEnabled && imagesVisible && mediaScope ? (
      <PresentationThumbnailImage scope={mediaScope} mediaId={mediaId} altText={altText} />
    ) : (
      <ThumbnailImagePlaceholder />
    );
  return (
    <div
      ref={container}
      className={styles.thumbnail}
      aria-hidden="true"
      inert
      data-slide-thumbnail={block.id}
    >
      {visible ? (
        <div className={styles.thumbnailScene} style={{ transform: `scale(${width / 960})` }}>
          {block.kind === "content" ? (
            <ContentSlideView
              block={block}
              variant="preview"
              designOverride={design}
              staticThumbnail
              media={block.mediaId ? image(block.mediaId, block.mediaAlt) : undefined}
              renderSceneImage={image}
            />
          ) : (
            <PresentationActivitySlide
              question={block.question}
              design={design}
              staticThumbnail
              media={
                block.question.mediaId
                  ? image(block.question.mediaId, block.question.mediaAlt)
                  : undefined
              }
            />
          )}
        </div>
      ) : (
        <div className={styles.thumbnailPlaceholder} />
      )}
    </div>
  );
}
