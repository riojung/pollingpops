import type { KeyboardEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { focusModal, handleModalKeyDown } from "./presentation-modal-focus";

function fixture() {
  const documentState = {
    activeElement: null as FocusTarget | null,
    defaultView: {
      getComputedStyle: (element: FocusTarget) => ({ visibility: element.visibility }),
    },
  };
  class FocusTarget {
    tabIndex = 0;
    disabled = false;
    excludedAncestor: "inert" | "hidden" | "aria-hidden" | null = null;
    rects = true;
    offsetParent: object | null = {};
    visibility = "visible";
    modalOwner: FocusTarget | null = null;
    modalKind = "custom";
    type = "button";
    name = "";
    form: object | null = null;
    checked = false;
    rootNode: object = documentState;
    ownerDocument = documentState;
    children: FocusTarget[] = [];
    focus = vi.fn(() => {
      documentState.activeElement = this;
    });
    querySelectorAll = () => this.children;
    getClientRects = () => (this.rects ? [{}] : []);
    getRootNode = () => this.rootNode;
    matches = (selector: string) =>
      selector === ":disabled"
        ? this.disabled
        : selector === 'input[type="radio"]' && this.type === "radio";
    closest = (selector: string) => {
      const modalSelector =
        this.modalOwner?.modalKind === "native"
          ? "dialog[open]"
          : '[role="dialog"][aria-modal="true"]';
      if (this.modalOwner && selector.includes(modalSelector)) return this.modalOwner;
      return this.excludedAncestor && selector.includes(`[${this.excludedAncestor}`) ? this : null;
    };
  }
  vi.stubGlobal("document", documentState);
  vi.stubGlobal("HTMLElement", FocusTarget);
  vi.stubGlobal("Element", FocusTarget);
  const root = new FocusTarget();
  root.tabIndex = -1;
  root.modalOwner = root;
  const targets = Array.from({ length: 5 }, () => {
    const element = new FocusTarget();
    element.modalOwner = root;
    return element;
  });
  root.children = targets;
  const onClose = vi.fn();
  function key(overrides: Record<string, unknown> = {}) {
    const event = {
      key: "Tab",
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      defaultPrevented: false,
      currentTarget: root,
      target: documentState.activeElement ?? root,
      preventDefault: vi.fn(),
      ...overrides,
    };
    handleModalKeyDown(event as unknown as KeyboardEvent<HTMLElement>, onClose);
    return event;
  }
  return { root, targets, key, onClose, documentState, FocusTarget };
}

afterEach(() => vi.unstubAllGlobals());

describe("presentation modal focus", () => {
  it("takes every forward and reverse step explicitly, including a reading region between buttons", () => {
    const { targets, key, documentState } = fixture();
    // A tabIndex=0 reading region can receive focus while WebKit's native reverse
    // sequence skips preceding buttons. Each step must be owned by this handler.
    documentState.activeElement = targets[2]!;
    expect(key({ shiftKey: true }).preventDefault).toHaveBeenCalledOnce();
    expect(documentState.activeElement).toBe(targets[1]);
    for (const expected of [targets[2], targets[3], targets[4], targets[0], targets[1]]) {
      expect(key().preventDefault).toHaveBeenCalledOnce();
      expect(documentState.activeElement).toBe(expected);
    }
    for (const expected of [targets[0], targets[4], targets[3], targets[2], targets[1]]) {
      expect(key({ shiftKey: true }).preventDefault).toHaveBeenCalledOnce();
      expect(documentState.activeElement).toBe(expected);
    }
  });

  it("starts at the appropriate boundary when focus is on the root or another unlisted element", () => {
    const { root, targets, key, documentState, FocusTarget } = fixture();
    for (const current of [root, new FocusTarget()]) {
      documentState.activeElement = current;
      key();
      expect(documentState.activeElement).toBe(targets[0]);
      documentState.activeElement = current;
      key({ shiftKey: true });
      expect(documentState.activeElement).toBe(targets[4]);
    }
  });

  it("uses visible enabled non-inert nodes and keeps fixed-position controls with client rects", () => {
    const { root, targets, key, documentState, FocusTarget } = fixture();
    const [negative, disabled, excluded, displayNone, fixed] = targets;
    negative!.tabIndex = -1;
    disabled!.disabled = true;
    excluded!.excludedAncestor = "hidden";
    displayNone!.rects = false;
    displayNone!.offsetParent = null;
    fixed!.offsetParent = null;
    const visibilityHidden = new FocusTarget();
    visibilityHidden.visibility = "hidden";
    const visibilityCollapse = new FocusTarget();
    visibilityCollapse.visibility = "collapse";
    root.children.push(visibilityHidden, visibilityCollapse);
    key();
    expect(documentState.activeElement).toBe(fixed);
    key({ shiftKey: true });
    expect(documentState.activeElement).toBe(fixed);
    for (const excludedNode of [
      negative,
      disabled,
      excluded,
      displayNone,
      visibilityHidden,
      visibilityCollapse,
    ])
      expect(excludedNode!.focus).not.toHaveBeenCalled();
  });

  it.each(["inert", "hidden", "aria-hidden"] as const)(
    "excludes controls below %s ancestors",
    (attribute) => {
      const { targets, key, documentState } = fixture();
      targets[0]!.excludedAncestor = attribute;
      key();
      expect(documentState.activeElement).toBe(targets[1]);
      expect(targets[0]!.focus).not.toHaveBeenCalled();
    },
  );

  it("honors positive tab order before ordinary document order", () => {
    const { targets, key, documentState } = fixture();
    targets[3]!.tabIndex = 2;
    targets[1]!.tabIndex = 1;
    for (const expected of [targets[1], targets[3], targets[0], targets[2], targets[4]]) {
      key();
      expect(documentState.activeElement).toBe(expected);
    }
  });

  it("keeps only the checked eligible radio as its named group's Tab stop", () => {
    const { targets, key, documentState } = fixture();
    for (const target of targets.slice(1, 4)) {
      target.type = "radio";
      target.name = "authoring-source-mode";
    }
    targets[2]!.checked = true;
    for (const expected of [targets[0], targets[2], targets[4]]) {
      key();
      expect(documentState.activeElement).toBe(expected);
    }
    key({ shiftKey: true });
    expect(documentState.activeElement).toBe(targets[2]);
    expect(key({ key: "ArrowRight" }).preventDefault).not.toHaveBeenCalled();
    expect(targets[2]!.checked).toBe(true);
  });

  it("uses the first eligible radio when its group has no eligible checked member", () => {
    const { targets, key, documentState } = fixture();
    targets.slice(0, 4).forEach((target) => {
      target.type = "radio";
      target.name = "source-mode";
    });
    targets[0]!.checked = true;
    targets[0]!.disabled = true;
    targets[1]!.checked = true;
    targets[1]!.excludedAncestor = "hidden";
    key();
    expect(documentState.activeElement).toBe(targets[2]);
    key();
    expect(documentState.activeElement).toBe(targets[4]);
    key({ shiftKey: true });
    expect(documentState.activeElement).toBe(targets[2]);
  });

  it("keeps differently named, form-owned, rooted and unnamed radios independent", () => {
    const { root, key, documentState, FocusTarget } = fixture();
    const radios = Array.from({ length: 8 }, () => {
      const radio = new FocusTarget();
      radio.modalOwner = root;
      radio.type = "radio";
      radio.name = "source-mode";
      return radio;
    });
    radios[1]!.checked = true;
    radios[2]!.name = "other-mode";
    radios[3]!.name = "other-mode";
    radios[3]!.checked = true;
    radios[4]!.form = {};
    radios[5]!.rootNode = {};
    radios[6]!.name = "";
    radios[7]!.name = "";
    root.children = radios;
    for (const expected of [radios[1], radios[3], radios[4], radios[5], radios[6], radios[7]]) {
      key();
      expect(documentState.activeElement).toBe(expected);
    }
  });

  it("focuses the root and prevents escape through either Tab boundary when there are no items", () => {
    const { root, key, documentState } = fixture();
    root.children = [];
    expect(key().preventDefault).toHaveBeenCalledOnce();
    expect(documentState.activeElement).toBe(root);
    expect(key({ shiftKey: true }).preventDefault).toHaveBeenCalledOnce();
    expect(documentState.activeElement).toBe(root);
  });

  it.each(["ctrlKey", "metaKey", "altKey"])("leaves %s Tab to the browser", (modifier) => {
    const { key, targets, documentState } = fixture();
    documentState.activeElement = targets[0]!;
    expect(key({ [modifier]: true }).preventDefault).not.toHaveBeenCalled();
    expect(documentState.activeElement).toBe(targets[0]);
  });

  it.each(["native", "custom"])(
    "leaves a nested %s modal's Tab and Escape handlers in control",
    (kind) => {
      const { key, targets, onClose, documentState, FocusTarget } = fixture();
      const nested = new FocusTarget();
      nested.modalKind = kind;
      targets[2]!.modalOwner = nested;
      documentState.activeElement = targets[2]!;
      expect(key().preventDefault).not.toHaveBeenCalled();
      expect(key({ key: "Escape" }).preventDefault).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      expect(documentState.activeElement).toBe(targets[2]);
    },
  );

  it("closes on Escape and leaves unrelated or already handled events alone", () => {
    const { key, onClose, targets } = fixture();
    expect(key({ key: "ArrowRight" }).preventDefault).not.toHaveBeenCalled();
    expect(key({ defaultPrevented: true }).preventDefault).not.toHaveBeenCalled();
    expect(key({ key: "Escape", defaultPrevented: true }).preventDefault).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(key({ key: "Escape" }).preventDefault).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
    expect(targets.every((target) => target.focus.mock.calls.length === 0)).toBe(true);
  });

  it("initially focuses the first visible item and restores the actual prior opener on cleanup", () => {
    const { root, targets, documentState, FocusTarget } = fixture();
    const opener = new FocusTarget();
    documentState.activeElement = opener;
    targets[0]!.excludedAncestor = "hidden";
    const cleanup = focusModal(root as unknown as HTMLElement);
    expect(documentState.activeElement).toBe(targets[1]);
    expect(targets[0]!.focus).not.toHaveBeenCalled();
    cleanup();
    expect(documentState.activeElement).toBe(opener);
    expect(opener.focus).toHaveBeenCalledOnce();
  });

  it("uses the modal root for initial focus with no visible item and tolerates a null container", () => {
    const { root, targets, documentState } = fixture();
    targets.forEach((target) => {
      target.excludedAncestor = "hidden";
    });
    focusModal(root as unknown as HTMLElement);
    expect(documentState.activeElement).toBe(root);
    const cleanup = focusModal(null);
    expect(documentState.activeElement).toBe(root);
    cleanup();
    expect(root.focus).toHaveBeenCalledTimes(2);
  });
});
