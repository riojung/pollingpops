import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { englishMessages, translate, type MessageKey } from "../../lib/i18n/catalog";
import type { SupportedLocale } from "@openround/contracts";
import authoringEnglish from "../../lib/i18n/domains/delivery-authoring/en-CA";
import authoringFrench from "../../lib/i18n/domains/delivery-authoring/fr-FR";

const fixture = vi.hoisted(() => ({
  capture: false,
  locale: "en-CA" as SupportedLocale,
  metadataReady: false,
}));
vi.mock("./presentation-publication-info", () => ({
  usePresentationPublicationInfo: () => ({
    state: fixture.metadataReady
      ? {
          status: "ready",
          publication: { id: "version-1", version: 3, publishedAt: "2026-10-17T18:30:00.000Z" },
        }
      : { status: "loading" },
    retry: vi.fn(),
  }),
}));
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
  useLocale: () => ({
    locale: fixture.locale,
    t: (key: MessageKey) =>
      translate(
        {
          ...englishMessages,
          ...(fixture.locale === "fr-FR" ? authoringFrench : authoringEnglish),
        },
        key,
      ),
  }),
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
  fixture.locale = "en-CA";
  fixture.metadataReady = false;
});
describe("Presentation version choice", () => {
  it("explains both versions without publishing or navigating on open", () => {
    const publish = vi.fn();
    const markup = renderToStaticMarkup(
      <PresentationVersionChoice
        href="/presentation/deck/host"
        publicationContext={{
          actorKey: "owner:workspace",
          presentationId: "deck",
          versionId: "version-1",
        }}
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
      publicationContext: {
        actorKey: "owner:workspace",
        presentationId: "deck",
        versionId: "version-1",
      },
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

  it("shows the exact publication date and number in a non-English dialog", () => {
    fixture.locale = "fr-FR";
    fixture.metadataReady = true;
    const markup = renderToStaticMarkup(
      <PresentationVersionChoice
        href="/presentation/deck/host"
        publicationContext={{
          actorKey: "owner:workspace",
          presentationId: "deck",
          versionId: "version-1",
        }}
        error=""
        onClose={vi.fn()}
        onPublish={vi.fn()}
        onPublishedExit={vi.fn()}
      />,
    );
    expect(markup).toContain("Quelle version voulez-vous présenter");
    expect(markup).toContain("Version 3");
    expect(markup).toMatch(/datetime="2026-10-17T18:30:00.000Z"/i);
    expect(markup).toContain("Publié le");
    expect(markup).toContain("oct.");
    expect(markup).not.toContain("Published");
  });
});
