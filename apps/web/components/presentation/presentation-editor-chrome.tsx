"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { PresentationBlockDraft } from "@openround/contracts";
import { AUTH_CHANGE_EVENT } from "../../lib/api";
import { ContentSlideView } from "./content-slide-view";
import {
  PresentationThumbnailImage,
  ThumbnailImagePlaceholder,
} from "./presentation-thumbnail-image";
import type { PresentationThumbnailMediaScope } from "./presentation-thumbnail-media";
import styles from "./presentation-editor-chrome.module.css";

type IconName =
  | "back"
  | "slides"
  | "inspector"
  | "preview"
  | "play"
  | "undo"
  | "redo"
  | "more"
  | "plus"
  | "image";
const paths: Record<IconName, string[]> = {
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
};
export function EditorIcon({ name }: { name: IconName }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
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

/** Children remain mounted, so closing the disclosure cannot discard an uncertain operation. */
export function EditorDisclosure({
  label,
  children,
  className = "",
  compact = false,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: Event) => {
      const node = details.current;
      if (!node?.open || document.querySelector("dialog[open]")) return;
      if (
        event.type === AUTH_CHANGE_EVENT ||
        (event.target instanceof Node && !node.contains(event.target))
      )
        node.open = false;
    };
    document.addEventListener("pointerdown", close);
    window.addEventListener(AUTH_CHANGE_EVENT, close);
    return () => {
      document.removeEventListener("pointerdown", close);
      window.removeEventListener(AUTH_CHANGE_EVENT, close);
    };
  }, []);
  return (
    <details
      ref={details}
      className={`${styles.disclosure} ${compact ? styles.compact : ""} ${className}`}
      onClickCapture={(event) => {
        if (!(event.target instanceof Element) || event.target.closest("dialog")) return;
        const button = event.target.closest<HTMLButtonElement>("button");
        // Safari pointer activation does not focus buttons. Establish the opener before
        // its handler mounts a dialog so the dialog can restore focus to this action.
        if (button && event.currentTarget.contains(button) && !button.disabled)
          button.focus({ preventScroll: true });
      }}
      onKeyDown={(event) => {
        if (
          event.key !== "Escape" ||
          (event.target instanceof Element && event.target.closest("dialog[open]"))
        )
          return;
        if (details.current?.open) {
          event.preventDefault();
          event.stopPropagation();
          details.current.open = false;
          details.current.querySelector("summary")?.focus();
        }
      }}
    >
      <summary aria-label={label} title={label}>
        {compact ? <EditorIcon name="more" /> : label}
        <span aria-hidden="true" className={styles.chevron}>
          ⌄
        </span>
      </summary>
      <div className={styles.disclosureBody} role="group" aria-label={label}>
        {children}
      </div>
    </details>
  );
}

/** Shared renderer; only observed visible rows mount authorized media readers. */
export function PresentationSlideThumbnail({
  block,
  priority = false,
  mediaScope,
  mediaEnabled = true,
}: {
  block: PresentationBlockDraft;
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
              staticThumbnail
              media={block.mediaId ? image(block.mediaId, block.mediaAlt) : undefined}
              renderSceneImage={image}
            />
          ) : (
            <div
              className={styles.activityThumbnail}
              data-has-media={Boolean(block.question.mediaId)}
            >
              <span>Audience activity</span>
              <strong>{block.question.prompt || "Your question"}</strong>
              {block.question.mediaId ? (
                <div className={styles.activityMedia}>
                  {image(block.question.mediaId, block.question.mediaAlt)}
                </div>
              ) : null}
              {"choices" in block.question ? (
                block.question.choices
                  .slice(0, 4)
                  .map((choice) => <div key={choice.id}>{choice.label || "Answer option"}</div>)
              ) : (
                <p>Collect audience responses</p>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className={styles.thumbnailPlaceholder} />
      )}
    </div>
  );
}
