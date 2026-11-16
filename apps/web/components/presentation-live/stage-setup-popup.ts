"use client";

import { useEffect, useRef } from "react";

type Anchor = Pick<DOMRect, "left" | "right" | "top" | "bottom">;
type Viewport = { left: number; top: number; width: number; height: number };
const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(value, maximum));

/** WebKit pointer activation may leave focus on body, so Escape need not target the popup. */
export function dismissStagePopupOnEscape(
  event: KeyboardEvent,
  details: HTMLDetailsElement | null,
) {
  if (
    event.key !== "Escape" ||
    event.defaultPrevented ||
    event.isComposing ||
    !details?.open ||
    details.closest("[hidden], [inert]")
  )
    return;
  const modals = details.ownerDocument.querySelectorAll<HTMLElement>(
    'dialog[open], [role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]',
  );
  // A separate modal owns its Escape, including native dialogs' default cancel action.
  if ([...modals].some((modal) => !modal.contains(details))) return;
  event.preventDefault();
  event.stopPropagation();
  details.open = false;
  details.querySelector("summary")?.focus({ preventScroll: true });
}

/** Fixed popup coordinates use the visible viewport, including a mobile keyboard's inset. */
export function stageSetupPopupBounds(anchor: Anchor, viewport: Viewport, naturalHeight: number) {
  const gutter = Math.min(12, viewport.width / 4, viewport.height / 4);
  const minimumX = viewport.left + gutter;
  const minimumY = viewport.top + gutter;
  const maximumX = viewport.left + viewport.width - gutter;
  const maximumY = viewport.top + viewport.height - gutter;
  const width = Math.max(1, Math.min(360, maximumX - minimumX));
  const below = clamp(anchor.bottom + 8, minimumY, maximumY);
  const above = clamp(anchor.top - 8, minimumY, maximumY);
  const belowSpace = maximumY - below;
  const aboveSpace = above - minimumY;
  const wantedHeight = Math.max(40, Math.min(540, naturalHeight));
  const preferBelow = belowSpace >= Math.min(wantedHeight, 160) || belowSpace >= aboveSpace;
  const available = preferBelow ? belowSpace : aboveSpace;
  const maxHeight = Math.max(1, Math.min(540, available < 40 ? maximumY - minimumY : available));
  return {
    left: clamp(anchor.right - width, minimumX, maximumX - width),
    top:
      available < 40 ? minimumY : preferBelow ? below : above - Math.min(wantedHeight, maxHeight),
    width,
    maxHeight,
  };
}

/** Native details retain state and tab order while their fixed popup follows a wrapped header. */
export function useStageSetupPopup(enabled = true) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const positionRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    const details = detailsRef.current;
    const popup = popupRef.current;
    if (!enabled || !details || !popup) return;
    const position = () => {
      if (!details.open) return;
      const summary = details.querySelector("summary");
      if (!summary) return;
      const visible = window.visualViewport;
      const viewport = {
        left: visible?.offsetLeft ?? 0,
        top: visible?.offsetTop ?? 0,
        width: visible?.width ?? window.innerWidth,
        height: visible?.height ?? window.innerHeight,
      };
      // Set the clamped width before reading the height of translated, wrapped text.
      popup.style.width = `${Math.max(1, Math.min(360, viewport.width - 24))}px`;
      const bounds = stageSetupPopupBounds(
        summary.getBoundingClientRect(),
        viewport,
        popup.scrollHeight + 2,
      );
      Object.assign(popup.style, {
        left: `${bounds.left}px`,
        top: `${bounds.top}px`,
        width: `${bounds.width}px`,
        maxHeight: `${bounds.maxHeight}px`,
      });
    };
    positionRef.current = position;
    const outside = (event: Event) => {
      if (event.target instanceof Node && !details.contains(event.target)) details.open = false;
    };
    const escape = (event: KeyboardEvent) => dismissStagePopupOnEscape(event, details);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(position);
    observer?.observe(details);
    observer?.observe(popup);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    position();
    return () => {
      positionRef.current = null;
      observer?.disconnect();
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
    };
  }, [enabled]);
  return { detailsRef, popupRef, position: () => positionRef.current?.() };
}
