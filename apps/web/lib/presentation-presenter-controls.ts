export type PresentationPresenterAction = "advance";

type PresenterKeyboardEvent = Pick<
  KeyboardEvent,
  | "key"
  | "target"
  | "altKey"
  | "ctrlKey"
  | "metaKey"
  | "shiftKey"
  | "repeat"
  | "defaultPrevented"
  | "isComposing"
>;

const nativeControlSelector = [
  "a[href]",
  "button",
  "input",
  "textarea",
  "select",
  "option",
  "summary",
  "audio[controls]",
  "video[controls]",
  "iframe",
  "object",
  "embed",
  "[contenteditable]",
  "[tabindex]",
  ...[
    "button",
    "link",
    "textbox",
    "searchbox",
    "combobox",
    "listbox",
    "menu",
    "menubar",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "slider",
    "spinbutton",
    "checkbox",
    "radio",
    "radiogroup",
    "switch",
    "tab",
    "tablist",
    "tree",
    "treeitem",
    "grid",
    "dialog",
    "alertdialog",
  ].map((role) => `[role="${role}"]`),
  "dialog",
  "[inert]",
].join(",");

function ownsKeyboardInput(target: EventTarget | null): boolean {
  // Use the target's DOM methods rather than instanceof so embedded documents
  // and nodes from another window retain their native keyboard behaviour.
  if (!target || !("nodeType" in target)) return false;
  const node = target as Node;
  const element = node.nodeType === 1 ? (node as Element) : node.parentElement;
  if (!element) return false;
  return element.closest(nativeControlSelector) !== null;
}

/** Classifies a shortcut without mutating the event or dispatching a command. */
export function presentationPresenterAction(
  event: PresenterKeyboardEvent,
  { dialogOpen }: { dialogOpen: boolean },
): PresentationPresenterAction | null {
  if (
    dialogOpen ||
    event.defaultPrevented ||
    event.repeat ||
    event.isComposing ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    ownsKeyboardInput(event.target)
  ) {
    return null;
  }

  return event.key === "ArrowRight" || event.key === "PageDown" || event.key === " "
    ? "advance"
    : null;
}
