"use client";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
const scrollKeys = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  " ",
  "Spacebar",
]);
/** Add one keyboard stop only when this authored text actually needs native scrolling. */
export function useNativeTextOverflow(contentKey: string) {
  const element = useRef<HTMLElement | null>(null),
    [overflow, setOverflow] = useState(false);
  useEffect(() => {
    const target = element.current;
    if (!target) return;
    let active = true;
    const measure = () => {
      if (active)
        setOverflow(
          target.clientHeight > 0 &&
            target.clientWidth > 0 &&
            (target.scrollHeight > target.clientHeight || target.scrollWidth > target.clientWidth),
        );
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(target);
    const ownerWindow = target.ownerDocument?.defaultView,
      fonts = target.ownerDocument?.fonts;
    ownerWindow?.addEventListener("resize", measure);
    fonts?.addEventListener("loadingdone", measure);
    void fonts?.ready.then(measure);
    return () => {
      active = false;
      observer?.disconnect();
      ownerWindow?.removeEventListener("resize", measure);
      fonts?.removeEventListener("loadingdone", measure);
    };
  }, [contentKey]);
  return {
    ref: (target: HTMLElement | null) => {
      element.current = target;
    },
    tabIndex: overflow ? 0 : undefined,
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (overflow && scrollKeys.has(event.key)) event.stopPropagation();
    },
  };
}
