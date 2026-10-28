function copyWithSelection(value: string): boolean {
  if (typeof document === "undefined" || typeof document.execCommand !== "function") return false;

  const activeElement = document.activeElement;
  const textControl =
    activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement
      ? activeElement
      : null;
  const controlSelection = textControl
    ? {
        start: textControl.selectionStart,
        end: textControl.selectionEnd,
        direction: textControl.selectionDirection,
      }
    : null;
  const selection = document.getSelection();
  const ranges = selection
    ? Array.from({ length: selection.rangeCount }, (_, index) =>
        selection.getRangeAt(index).cloneRange(),
      )
    : [];
  const field = document.createElement("textarea");
  field.value = value;
  field.readOnly = true;
  field.tabIndex = -1;
  field.style.cssText =
    "position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;font-size:16px;";

  try {
    document.body.append(field);
    field.focus({ preventScroll: true });
    field.select();
    field.setSelectionRange(0, value.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    field.remove();
    try {
      if (activeElement instanceof HTMLElement) activeElement.focus({ preventScroll: true });
      if (selection) {
        selection.removeAllRanges();
        for (const range of ranges) selection.addRange(range);
      }
      if (textControl && controlSelection?.start != null && controlSelection.end != null) {
        textControl.setSelectionRange(
          controlSelection.start,
          controlSelection.end,
          controlSelection.direction ?? undefined,
        );
      }
    } catch {
      // The original element or selection may have been removed by a copy handler.
    }
  }
}

/** Call directly from a user action so legacy copy retains browser user activation. */
export async function copyTextToClipboard(value: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Some browsers expose the API but reject it; selection copy may still work.
  }

  // Run synchronously when the secure-context API is absent, including LAN HTTP.
  return copyWithSelection(value);
}
