interface ModalInitialFocusOptions {
  dialog: () => HTMLElement | null;
  target: () => HTMLElement | null;
  ownerDocument?: Document;
}

/** Transfer initial focus once the open modal is focusable; never reclaim user navigation. */
export function startModalInitialFocus({
  dialog,
  target,
  ownerDocument = document,
}: ModalInitialFocusOptions): () => void {
  const ownerWindow = ownerDocument.defaultView;
  if (!ownerWindow) return () => {};
  let stopped = false;
  let frame: number | undefined;

  const foreground = () => ownerDocument.visibilityState === "visible" && ownerDocument.hasFocus();
  const inside = () => Boolean(dialog()?.contains(ownerDocument.activeElement));
  const visible = (element: HTMLElement) => {
    const style = ownerWindow.getComputedStyle(element);
    return (
      element.isConnected &&
      !element.closest('[inert], [aria-hidden="true"]') &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.visibility !== "collapse" &&
      style.opacity !== "0" &&
      element.getClientRects().length > 0
    );
  };
  const cancelFrame = () => {
    if (frame !== undefined) ownerWindow.cancelAnimationFrame(frame);
    frame = undefined;
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancelFrame();
    ownerWindow.removeEventListener("focus", resume);
    ownerDocument.removeEventListener("visibilitychange", resume);
    ownerDocument.removeEventListener("transitionend", transition, true);
    ownerDocument.removeEventListener("focusin", entered, true);
  };
  function schedule() {
    if (stopped || frame !== undefined || !foreground()) return;
    frame = ownerWindow!.requestAnimationFrame(attempt);
  }
  function attempt() {
    frame = undefined;
    if (stopped) return;
    if (inside()) {
      stop();
      return;
    }
    if (!foreground()) return;
    const container = dialog();
    const control = target();
    if (
      container &&
      control &&
      container.contains(control) &&
      !container.inert &&
      !control.matches(":disabled") &&
      visible(container) &&
      visible(control)
    ) {
      control.focus({ preventScroll: true });
      // A rejected focus call is not success. Native focus can settle on a later rendered frame.
      if (inside()) {
        stop();
        return;
      }
    }
    schedule();
  }
  function resume() {
    if (stopped) return;
    if (inside()) stop();
    else if (foreground()) schedule();
    else cancelFrame();
  }
  function transition(event: Event) {
    if (event.target && dialog()?.contains(event.target as Node)) resume();
  }
  function entered() {
    if (inside()) stop();
  }

  ownerWindow.addEventListener("focus", resume);
  ownerDocument.addEventListener("visibilitychange", resume);
  ownerDocument.addEventListener("transitionend", transition, true);
  ownerDocument.addEventListener("focusin", entered, true);
  resume();
  return stop;
}
