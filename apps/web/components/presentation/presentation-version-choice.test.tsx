import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { englishMessages, translate, type MessageKey } from "../../lib/i18n/catalog";

const fixture = vi.hoisted(() => ({ capture: false }));
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useState: <T,>(initial: T) => (fixture.capture ? [initial, vi.fn()] : react.useState(initial)),
    useRef: <T,>(initial: T) => (fixture.capture ? { current: initial } : react.useRef(initial)),
    useEffect: (...args: Parameters<typeof react.useEffect>) => {
      if (!fixture.capture) react.useEffect(...args);
    },
  };
});
vi.mock("../locale-provider", () => ({
  useLocale: () => ({ locale: "en-CA", t: (key: MessageKey) => translate(englishMessages, key) }),
}));
vi.mock("./presentation-modal-focus", () => ({
  focusModal: vi.fn(),
  handleModalKeyDown: (event: { key: string }, close: () => void) => {
    if (event.key === "Escape") close();
  },
}));

import { PresentationVersionChoice } from "./presentation-version-choice";

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}

beforeEach(() => {
  fixture.capture = false;
});
describe("Presentation version choice", () => {
  it("explains both versions without publishing or navigating on open", () => {
    const publish = vi.fn();
    const markup = renderToStaticMarkup(
      <PresentationVersionChoice
        href="/presentation/deck/host"
        error="Save failed"
        onClose={vi.fn()}
        onPublish={publish}
        onPublishedExit={vi.fn()}
      />,
    );
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain("Publish latest and present");
    expect(markup).toContain("Present published version");
    expect(markup).toContain('href="/presentation/deck/host"');
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Save failed");
    expect(publish).not.toHaveBeenCalled();
  });

  it("prevents duplicate publication and closing while a publication is unresolved", async () => {
    let resolve!: (result: boolean) => void;
    const publish = vi.fn(
      () =>
        new Promise<boolean>((accept) => {
          resolve = accept;
        }),
    );
    const close = vi.fn();
    fixture.capture = true;
    const tree = PresentationVersionChoice({
      href: "/presentation/deck/host",
      error: "",
      onClose: close,
      onPublish: publish,
      onPublishedExit: vi.fn(),
    });
    fixture.capture = false;
    const focusDialog = vi.fn();
    (tree.props.ref as { current: unknown }).current = { focus: focusDialog };
    const click = elements(tree).find((element) => element.type === "button")!.props
      .onClick as () => void;
    const key = tree.props.onKeyDown as (event: { key: string }) => void;
    click();
    click();
    key({ key: "Escape" });
    expect(publish).toHaveBeenCalledOnce();
    expect(focusDialog).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    resolve(false);
    for (let index = 0; index < 8; index++) await Promise.resolve();
    key({ key: "Escape" });
    expect(close).toHaveBeenCalledOnce();
  });
});
