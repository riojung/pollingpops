import type { KeyboardEvent } from "react";

const modalFocusable =
  'a[href], area[href], button, input, select, textarea, summary, [tabindex], [contenteditable]:not([contenteditable="false"]), audio[controls], video[controls], iframe';
const nestedModal = 'dialog[open], [role="dialog"][aria-modal="true"]';

function focusableElements(container: HTMLElement) {
  const eligible = [...container.querySelectorAll<HTMLElement>(modalFocusable)].filter(
    (element) => {
      if (
        element.tabIndex < 0 ||
        element.matches(":disabled") ||
        element.closest('[inert], [hidden], [aria-hidden="true"]') ||
        (!element.getClientRects().length && element.offsetParent === null)
      )
        return false;
      const visibility = element.ownerDocument.defaultView?.getComputedStyle(element).visibility;
      return visibility !== "hidden" && visibility !== "collapse";
    },
  );
  return eligible
    .filter((element) => {
      if (!element.matches('input[type="radio"]')) return true;
      const radio = element as HTMLInputElement;
      if (!radio.name) return true;
      const group = eligible.filter((candidate): candidate is HTMLInputElement => {
        if (!candidate.matches('input[type="radio"]')) return false;
        const other = candidate as HTMLInputElement;
        return (
          other.name === radio.name &&
          other.form === radio.form &&
          other.getRootNode() === radio.getRootNode()
        );
      });
      return radio === (group.find((candidate) => candidate.checked) ?? group[0]);
    })
    .sort((left, right) => {
      // Positive tabindex values precede the ordinary DOM-order sequence.
      const leftOrder = left.tabIndex > 0 ? left.tabIndex : Infinity;
      const rightOrder = right.tabIndex > 0 ? right.tabIndex : Infinity;
      return leftOrder === rightOrder ? 0 : leftOrder - rightOrder;
    });
}

export function focusModal(container: HTMLElement | null) {
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const first = container ? (focusableElements(container)[0] ?? container) : null;
  first?.focus();
  return () => previous?.focus();
}

/** Explicit steps include reading regions that WebKit skips in its native Tab sequence. */
export function handleModalKeyDown(event: KeyboardEvent<HTMLElement>, onClose: () => void) {
  const owner = event.target instanceof Element ? event.target.closest(nestedModal) : null;
  if ((owner && owner !== event.currentTarget) || event.defaultPrevented) return;
  if (event.key === "Escape") {
    event.preventDefault();
    onClose();
    return;
  }
  if (event.key !== "Tab" || event.ctrlKey || event.metaKey || event.altKey) return;
  event.preventDefault();
  const focusable = focusableElements(event.currentTarget);
  if (!focusable.length) {
    event.currentTarget.focus();
    return;
  }
  const index = focusable.indexOf(event.currentTarget.ownerDocument.activeElement as HTMLElement);
  const next =
    index < 0
      ? event.shiftKey
        ? focusable.length - 1
        : 0
      : (index + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length;
  focusable[next]!.focus();
}
