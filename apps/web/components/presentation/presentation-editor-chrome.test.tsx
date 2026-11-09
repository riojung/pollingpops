import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTH_CHANGE_EVENT } from "../../lib/api";
import { createContentBlock, createQuestionBlock } from "../../lib/presentation-builder";
import { createNativeContentBlock } from "../../lib/presentation-native-scene";
import { ContentSlideView } from "./content-slide-view";
import {
  EditorDisclosure,
  EditorIcon,
  EditorMenuItem,
  EditorMenuSection,
  PresentationSlideThumbnail,
} from "./presentation-editor-chrome";
import { PresentationThumbnailImage } from "./presentation-thumbnail-image";

const mocked = vi.hoisted(() => ({
  hooks: null as null | { cursor: number; slots: unknown[]; effects: (() => void)[] },
}));
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useRef: <T,>(initial: T) => {
      if (!mocked.hooks) return react.useRef(initial);
      const hooks = mocked.hooks;
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
      return hooks.slots[index];
    },
    useState: <T,>(initial: T) => {
      if (!mocked.hooks) return react.useState(initial);
      const hooks = mocked.hooks;
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = initial;
      return [
        hooks.slots[index],
        (value: T) => {
          hooks.slots[index] = value;
        },
      ];
    },
    useEffect: (callback: () => void | (() => void), dependencies: unknown[]) => {
      if (!mocked.hooks) return react.useEffect(callback, dependencies);
      const hooks = mocked.hooks;
      const index = hooks.cursor++;
      const previous = hooks.slots[index] as
        { dependencies: unknown[]; cleanup?: () => void } | undefined;
      if (previous && dependencies.every((value, i) => value === previous.dependencies[i])) return;
      hooks.effects.push(() => {
        previous?.cleanup?.();
        hooks.slots[index] = { dependencies, cleanup: callback() };
      });
    },
  };
});

function elements(node: ReactNode): ReactElement<Record<string, any>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, any>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function hookHarness(
  component: () => ReactElement<Record<string, any>>,
  root: unknown,
  attachChildren?: (tree: ReactElement<Record<string, any>>) => void,
) {
  const hooks = { cursor: 0, slots: [] as unknown[], effects: [] as (() => void)[] };
  let tree: ReactElement<Record<string, any>>;
  const render = () => {
    hooks.cursor = 0;
    mocked.hooks = hooks;
    try {
      tree = component();
    } finally {
      mocked.hooks = null;
    }
    tree.props.ref.current = root;
    attachChildren?.(tree);
    hooks.effects.splice(0).forEach((effect) => effect());
    return tree;
  };
  return {
    render,
    tree: () => tree,
    unmount: () =>
      hooks.slots.forEach((slot) => (slot as { cleanup?: () => void } | null)?.cleanup?.()),
  };
}

class FakeNode {}
class FakeElement extends FakeNode {
  modalAncestor = false;
  buttonAncestor: FakeElement | null = null;
  disabled = false;
  focus = vi.fn();
  closest = (selector: string) =>
    selector === "button" ? this.buttonAncestor : this.modalAncestor ? this : null;
}
function disclosureHarness(
  children: ReactNode,
  options: Partial<Parameters<typeof EditorDisclosure>[0]> = {},
) {
  const documentListeners = new Map<string, Set<(event: unknown) => void>>();
  const windowListeners = new Map<string, Set<(event: unknown) => void>>();
  const listen = (
    registry: typeof documentListeners,
    name: string,
    callback: (event: unknown) => void,
  ) => {
    const callbacks = registry.get(name) ?? new Set();
    callbacks.add(callback);
    registry.set(name, callbacks);
  };
  const anchor = { left: 500, right: 540, top: 80, bottom: 120 };
  const summary = { focus: vi.fn(), getBoundingClientRect: () => anchor };
  let popoverOpen = false;
  let popoverAttribute = !options.inline;
  const popup = {
    scrollHeight: 300,
    zoom: 1,
    get offsetWidth() {
      return Math.min(280, Number.parseFloat(popup.style.maxWidth) || 280);
    },
    style: { maxHeight: "", maxWidth: "", top: "", left: "" },
    dataset: {} as Record<string, string>,
    matches: () => popoverOpen,
    contains: () => false,
    hasAttribute: () => popoverAttribute,
    removeAttribute: () => {
      popoverAttribute = false;
    },
    setAttribute: () => {
      popoverAttribute = true;
    },
    showPopover: vi.fn(() => {
      popoverOpen = true;
    }),
    hidePopover: vi.fn(() => {
      popoverOpen = false;
    }),
    getBoundingClientRect: () => ({
      width: popup.offsetWidth * popup.zoom,
      height:
        Math.min(popup.scrollHeight, Number.parseFloat(popup.style.maxHeight) || 300) * popup.zoom,
    }),
  };
  const inside = new FakeElement();
  const outside = new FakeElement();
  const details = {
    open: true,
    contains: (target: unknown) => target === inside,
    querySelector: () => summary,
  };
  let modalOpen = false;
  let modalTagName = "DIALOG";
  vi.stubGlobal("Node", FakeNode);
  vi.stubGlobal("Element", FakeElement);
  vi.stubGlobal("document", {
    querySelector: () => (modalOpen ? { tagName: modalTagName } : null),
    addEventListener: (name: string, callback: (event: unknown) => void) =>
      listen(documentListeners, name, callback),
    removeEventListener: (name: string, callback: (event: unknown) => void) =>
      documentListeners.get(name)?.delete(callback),
  });
  vi.stubGlobal("window", {
    innerWidth: 960,
    innerHeight: 720,
    addEventListener: (name: string, callback: (event: unknown) => void) =>
      listen(windowListeners, name, callback),
    removeEventListener: (name: string, callback: (event: unknown) => void) =>
      windowListeners.get(name)?.delete(callback),
  });
  const harness = hookHarness(
    () => EditorDisclosure({ label: "Share and deliver", children, ...options }),
    details,
    (tree) => {
      elements(tree).find((element) => element.props.role === "group")!.props.ref.current = popup;
    },
  );
  harness.render();
  const keydown = (target = inside, key = "Escape") => {
    const event = { key, target, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    harness.tree().props.onKeyDown(event);
    return event;
  };
  return {
    ...harness,
    details,
    summary,
    anchor,
    popup,
    inside,
    toggle: () => harness.tree().props.onToggle(),
    scroll: () =>
      windowListeners.get("scroll")?.forEach((listener) => listener({ type: "scroll" })),
    focusOutside: () =>
      documentListeners
        .get("focusin")
        ?.forEach((listener) => listener({ type: "focusin", target: outside })),
    keydown,
    clickCapture: (target = inside) =>
      harness.tree().props.onClickCapture({ target, currentTarget: details }),
    setModal: (open: boolean, custom = false) => {
      modalOpen = open;
      modalTagName = custom ? "DIV" : "DIALOG";
    },
    focusOut: () =>
      documentListeners
        .get("focusout")
        ?.forEach((listener) => listener({ type: "focusout", target: inside })),
    pointer: (target = outside) =>
      documentListeners
        .get("pointerdown")
        ?.forEach((listener) => listener({ type: "pointerdown", target })),
    authChange: () =>
      windowListeners
        .get(AUTH_CHANGE_EVENT)
        ?.forEach((listener) => listener({ type: AUTH_CHANGE_EVENT })),
    listeners: documentListeners,
  };
}

afterEach(() => {
  mocked.hooks = null;
  vi.unstubAllGlobals();
});

describe("editor menu primitives", () => {
  it("renders decorative original icons and ordinary labeled button groups", () => {
    const action = vi.fn();
    const markup = renderToStaticMarkup(
      <EditorDisclosure label="Insert" icon="plus" align="start">
        <EditorMenuSection label="Slide elements">
          <EditorMenuItem icon="text" onClick={action}>
            Text box
          </EditorMenuItem>
          <EditorMenuItem icon="table" disabled>
            Table
          </EditorMenuItem>
        </EditorMenuSection>
      </EditorDisclosure>,
    );
    expect(markup).toContain('aria-label="Insert"');
    expect(markup).toContain('role="group" aria-label="Slide elements"');
    expect(markup).toContain('data-editor-icon="text"');
    expect(markup).toContain('aria-hidden="true" focusable="false"');
    expect(markup).toContain('type="button"');
    expect(markup).not.toContain('role="menu"');
    expect(renderToStaticMarkup(<EditorIcon name="distribute-vertical" />)).toContain("<path");
  });

  it("uses a top-layer popup that flips above a bottom-edge opener and stays inside the viewport", () => {
    const disclosure = disclosureHarness(<button>Duplicate</button>);
    Object.assign(disclosure.anchor, { left: 900, right: 940, top: 650, bottom: 690 });
    const body = elements(disclosure.tree()).find((element) => element.props.role === "group")!;
    expect(body.props.popover).toBe("manual");
    disclosure.toggle();
    expect(disclosure.popup.showPopover).toHaveBeenCalledOnce();
    expect(disclosure.popup.dataset.placement).toBe("top");
    expect(disclosure.popup.style.left).toBe("660px");
    expect(disclosure.popup.style.top).toBe("342px");
    disclosure.scroll();
    expect(disclosure.popup.showPopover).toHaveBeenCalledOnce();
    disclosure.details.open = false;
    disclosure.toggle();
    expect(disclosure.popup.hidePopover).toHaveBeenCalledOnce();
    disclosure.unmount();
  });

  it("honors start alignment while clamping left and right edges and available height", () => {
    const disclosure = disclosureHarness(<button>Insert</button>, { align: "start" });
    Object.assign(disclosure.anchor, { left: 920, right: 950, top: 330, bottom: 370 });
    disclosure.popup.scrollHeight = 900;
    disclosure.toggle();
    expect(disclosure.popup.style.left).toBe("668px");
    expect(disclosure.popup.style.maxHeight).toBe("330px");
    expect(disclosure.popup.dataset.placement).toBe("bottom");
    disclosure.anchor.left = -20;
    disclosure.scroll();
    expect(disclosure.popup.style.left).toBe("12px");
    disclosure.unmount();
  });

  it("converts viewport coordinates into CSS pixels under 200 percent ancestor zoom", () => {
    const disclosure = disclosureHarness(<button>Duplicate</button>);
    Object.assign(disclosure.anchor, { left: 900, right: 940, top: 650, bottom: 690 });
    disclosure.popup.zoom = 2;
    disclosure.toggle();
    expect(disclosure.popup.style.left).toBe("190px");
    expect(disclosure.popup.style.top).toBe("36px");
    expect(disclosure.popup.style.maxHeight).toBe("285px");
    disclosure.unmount();
  });

  it("keeps intentional inline panels in normal flow without opening a popover", () => {
    const disclosure = disclosureHarness(<button>Audience activity</button>, { inline: true });
    const body = elements(disclosure.tree()).find((element) => element.props.role === "group")!;
    expect(body.props.popover).toBeUndefined();
    disclosure.toggle();
    expect(disclosure.popup.showPopover).not.toHaveBeenCalled();
    expect(disclosure.popup.style.top).toBe("");
    disclosure.unmount();
  });
});

describe("editor disclosure lifecycle", () => {
  it("focuses a pointer-activated action before its dialog records the opener", () => {
    let focused: unknown = null;
    const recordOpener = vi.fn();
    const child = <button onClick={() => recordOpener(focused)}>Assign reading</button>;
    const disclosure = disclosureHarness(child);
    disclosure.inside.buttonAncestor = disclosure.inside;
    disclosure.inside.focus.mockImplementation(() => {
      focused = disclosure.inside;
    });
    const icon = new FakeElement();
    icon.buttonAncestor = disclosure.inside;
    // Model Safari's pointer activation: the browser has not focused the clicked button.
    disclosure.clickCapture(icon);
    child.props.onClick();
    expect(disclosure.inside.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(recordOpener).toHaveBeenCalledWith(disclosure.inside);
    expect(disclosure.details.open).toBe(true);
    disclosure.unmount();
  });

  it("leaves native dialog buttons and disabled actions in control of their own focus", () => {
    const disclosure = disclosureHarness(<button>Export</button>);
    disclosure.inside.buttonAncestor = disclosure.inside;
    disclosure.inside.modalAncestor = true;
    disclosure.clickCapture();
    expect(disclosure.inside.focus).not.toHaveBeenCalled();
    disclosure.inside.modalAncestor = false;
    disclosure.inside.disabled = true;
    disclosure.clickCapture();
    expect(disclosure.inside.focus).not.toHaveBeenCalled();
    disclosure.unmount();
  });

  it("retains the pending operation child and exact retry receipt when closed and reopened", () => {
    const receipt = { mutationId: "uncertain-share-operation", versionId: "published-version" };
    const retry = vi.fn();
    const child = <button onClick={() => retry(receipt)}>Retry link creation</button>;
    const disclosure = disclosureHarness(child);
    const body = () =>
      elements(disclosure.tree()).find((element) => element.props.role === "group")!;
    expect(body().props.children).toBe(child);
    disclosure.pointer(disclosure.inside);
    expect(disclosure.details.open).toBe(true);
    disclosure.pointer();
    expect(disclosure.details.open).toBe(false);
    disclosure.render();
    expect(body().props.children).toBe(child);
    disclosure.details.open = true;
    (body().props.children as typeof child).props.onClick();
    disclosure.authChange();
    expect(disclosure.details.open).toBe(false);
    disclosure.render();
    expect(body().props.children).toBe(child);
    (body().props.children as typeof child).props.onClick();
    expect(retry.mock.calls).toEqual([[receipt], [receipt]]);
    expect(retry.mock.calls[0]![0]).toBe(retry.mock.calls[1]![0]);
    disclosure.unmount();
    expect(disclosure.listeners.get("pointerdown")?.size).toBe(0);
  });

  it("closes on Escape and restores focus to its summary while leaving other keys alone", () => {
    const disclosure = disclosureHarness(<button>Share link</button>);
    const arrow = disclosure.keydown(disclosure.inside, "ArrowRight");
    expect(disclosure.details.open).toBe(true);
    expect(arrow.preventDefault).not.toHaveBeenCalled();
    const escape = disclosure.keydown();
    expect(disclosure.details.open).toBe(false);
    expect(escape.preventDefault).toHaveBeenCalledOnce();
    expect(escape.stopPropagation).toHaveBeenCalledOnce();
    expect(disclosure.summary.focus).toHaveBeenCalledOnce();
    disclosure.keydown();
    expect(disclosure.summary.focus).toHaveBeenCalledOnce();
    disclosure.unmount();
  });

  it("closes after Tab moves focus outside while preserving the action child", () => {
    const child = <button>Pending action</button>;
    const disclosure = disclosureHarness(child);
    const tab = disclosure.keydown(disclosure.inside, "Tab");
    expect(tab.preventDefault).not.toHaveBeenCalled();
    disclosure.focusOutside();
    expect(disclosure.details.open).toBe(false);
    disclosure.render();
    expect(
      elements(disclosure.tree()).find((element) => element.props.role === "group")!.props.children,
    ).toBe(child);
    disclosure.unmount();
  });

  it("does not dismiss Safari pointer actions between pointerdown blur and click focus", async () => {
    const disclosure = disclosureHarness(<button>Assign reading</button>);
    disclosure.pointer(disclosure.inside);
    disclosure.focusOut();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(disclosure.details.open).toBe(true);
    disclosure.unmount();
  });

  it("closes when Safari Tabs out of the document without a subsequent focusin", async () => {
    const disclosure = disclosureHarness(<button>Final action</button>);
    disclosure.focusOut();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(disclosure.details.open).toBe(false);
    expect(disclosure.popup.hidePopover).toHaveBeenCalledOnce();
    disclosure.unmount();
  });

  it("suspends the top layer for external custom modals and restores it with its native ancestry intact", () => {
    const child = <button>Outline to slides</button>;
    const disclosure = disclosureHarness(child);
    disclosure.toggle();
    disclosure.setModal(true, true);
    disclosure.pointer();
    expect(disclosure.details.open).toBe(true);
    expect(disclosure.popup.hasAttribute()).toBe(false);
    expect(disclosure.popup.dataset.suspended).toBe("true");
    const modalControl = new FakeElement();
    modalControl.modalAncestor = true;
    const escape = disclosure.keydown(modalControl);
    expect(escape.preventDefault).not.toHaveBeenCalled();
    disclosure.setModal(false);
    disclosure.scroll();
    expect(disclosure.popup.hasAttribute()).toBe(true);
    expect(disclosure.popup.dataset.suspended).toBeUndefined();
    expect(disclosure.popup.showPopover).toHaveBeenCalledTimes(2);
    expect(
      elements(disclosure.tree()).find((element) => element.props.role === "group")!.props.children,
    ).toBe(child);
    disclosure.unmount();
  });

  it("closes on an authorization change even while a modal owns focus", () => {
    const disclosure = disclosureHarness(<button>Pending export</button>);
    disclosure.setModal(true);
    disclosure.authChange();
    expect(disclosure.details.open).toBe(false);
    disclosure.unmount();
  });

  it("lets an open native dialog own outside clicks and Escape without closing its disclosure", () => {
    const disclosure = disclosureHarness(
      <dialog open>
        <button>Retry pending export</button>
      </dialog>,
    );
    const dialogControl = new FakeElement();
    dialogControl.modalAncestor = true;
    disclosure.setModal(true);
    disclosure.pointer();
    expect(disclosure.details.open).toBe(true);
    const escape = disclosure.keydown(dialogControl);
    expect(disclosure.details.open).toBe(true);
    expect(escape.preventDefault).not.toHaveBeenCalled();
    expect(escape.stopPropagation).not.toHaveBeenCalled();
    expect(disclosure.summary.focus).not.toHaveBeenCalled();
    disclosure.setModal(false);
    disclosure.pointer();
    expect(disclosure.details.open).toBe(false);
    disclosure.unmount();
  });
});

describe("presentation filmstrip thumbnails", () => {
  it("keeps ordinary legacy slides free of fake media and makes every thumbnail inert", () => {
    const block = createContentBlock();
    const harness = hookHarness(() => PresentationSlideThumbnail({ block, priority: true }), {
      getBoundingClientRect: () => ({ width: 180 }),
    });
    vi.stubGlobal("ResizeObserver", undefined);
    vi.stubGlobal("IntersectionObserver", undefined);
    vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    harness.render();
    const slide = elements(harness.tree()).find((element) => element.type === ContentSlideView)!;
    expect(slide.props.staticThumbnail).toBe(true);
    expect(slide.props.variant).toBe("preview");
    expect(slide.props.media).toBeUndefined();
    expect(harness.tree().props.inert).toBe(true);
    expect(harness.tree().props["aria-hidden"]).toBe("true");
    const markup = renderToStaticMarkup(<PresentationSlideThumbnail block={block} priority />);
    expect(markup).toContain('data-static-thumbnail="true"');
    expect(markup).not.toContain("Image unavailable");
    expect(markup).not.toContain("imagePlaceholder");
    harness.unmount();
  });

  it("uses a local placeholder for private images without issuing media requests", () => {
    const block = createNativeContentBlock();
    const imageId = "11111111-1111-4111-8111-111111111111";
    block.scene!.nodes.push({
      id: "private-image",
      type: "image",
      mediaId: imageId,
      altText: "Private reference",
      frame: { x: 60, y: 35, width: 30, height: 40 },
    });
    block.scene!.readingOrder.push("private-image");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const markup = renderToStaticMarkup(<PresentationSlideThumbnail block={block} priority />);
    expect(markup).toContain('data-thumbnail-scene="true"');
    expect(markup).toContain("imagePlaceholder");
    expect(markup).not.toContain("<img");
    expect(markup).not.toContain(imageId);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("mounts shared scene rendering only while observed visible and releases its observers", () => {
    const block = createContentBlock();
    const resizeDisconnect = vi.fn();
    const visibilityDisconnect = vi.fn();
    let show: (entries: { isIntersecting: boolean }[]) => void = () => {};
    const observed = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe = observed;
        disconnect = resizeDisconnect;
      },
    );
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: typeof show) {
          show = callback;
        }
        observe = observed;
        disconnect = visibilityDisconnect;
      },
    );
    const container = { getBoundingClientRect: () => ({ width: 192 }) };
    const harness = hookHarness(() => PresentationSlideThumbnail({ block }), container);
    harness.render();
    const slides = () =>
      elements(harness.tree()).filter((element) => element.type === ContentSlideView);
    expect(slides()).toHaveLength(0);
    expect(observed).toHaveBeenCalledWith(container);
    show([{ isIntersecting: true }]);
    harness.render();
    expect(slides()).toHaveLength(1);
    expect(
      elements(harness.tree()).find((element) => element.props.style?.transform)?.props.style
        .transform,
    ).toBe("scale(0.2)");
    show([{ isIntersecting: false }]);
    harness.render();
    expect(slides()).toHaveLength(0);
    harness.unmount();
    expect(resizeDisconnect).toHaveBeenCalledOnce();
    expect(visibilityDisconnect).toHaveBeenCalledOnce();
  });

  it("authorizes media only after observing the row and releases image children when its rail closes", () => {
    const block = createContentBlock();
    block.mediaId = "11111111-1111-4111-8111-111111111111";
    block.mediaAlt = "Private reference";
    let show: (entries: { isIntersecting: boolean }[]) => void = () => {};
    vi.stubGlobal("ResizeObserver", undefined);
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: typeof show) {
          show = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    let mediaEnabled = true;
    const mediaScope = { actorKey: "actor:workspace", presentationId: "deck" };
    const harness = hookHarness(
      () => PresentationSlideThumbnail({ block, priority: true, mediaScope, mediaEnabled }),
      { getBoundingClientRect: () => ({ width: 192 }) },
    );
    harness.render();
    const media = () =>
      elements(harness.tree()).find((element) => element.type === ContentSlideView)?.props.media;
    expect(media().type).not.toBe(PresentationThumbnailImage);
    show([{ isIntersecting: true }]);
    harness.render();
    expect(media().type).toBe(PresentationThumbnailImage);
    expect(media().props).toMatchObject({
      scope: mediaScope,
      mediaId: block.mediaId,
      altText: block.mediaAlt,
    });
    mediaEnabled = false;
    harness.render();
    expect(media().type).not.toBe(PresentationThumbnailImage);
    mediaEnabled = true;
    show([{ isIntersecting: false }]);
    harness.render();
    expect(media()).toBeUndefined();
    harness.unmount();
  });

  it("renders a bounded activity summary rather than answer inputs or correctness", () => {
    const block = createQuestionBlock();
    block.question.prompt = "Choose a direction";
    const markup = renderToStaticMarkup(<PresentationSlideThumbnail block={block} priority />);
    expect(markup).toContain("Choose a direction");
    expect(markup).toContain("Audience activity");
    expect(markup).not.toContain("<input");
    expect(markup).not.toContain("Correct answer");
    expect(markup).toContain('inert=""');
  });
});
