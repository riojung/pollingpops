import { renderToStaticMarkup } from "react-dom/server";
import type * as ReactModule from "react";
import { describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../locale-provider";
import { PresentationDeliveryJoinAccess } from "./delivery-join-access";

const fixtures = vi.hoisted(() => ({ nextBase: null as string | null }));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof ReactModule>();
  return {
    ...react,
    useState: <T,>(initial: T | (() => T)) => {
      if (initial === "" && fixtures.nextBase) {
        const base = fixtures.nextBase;
        fixtures.nextBase = null;
        return react.useState(base as T);
      }
      return react.useState(initial);
    },
  };
});

vi.mock("next/navigation", () => ({ usePathname: () => "/present/audience" }));

describe("audience join access language", () => {
  it.each([
    ["en-CA", "Join this Presentation", "Join code"],
    ["ko-KR", "이 프레젠테이션에 참여", "참여 코드"],
  ] as const)(
    "renders %s guidance without an editor catalog and preserves the room code",
    (locale, title, label) => {
      const markup = renderToStaticMarkup(
        <LocaleProvider
          initialLocale={locale}
          initialDomains={["live-delivery"]}
          initialMessages={{}}
        >
          <PresentationDeliveryJoinAccess code="1234567" />
        </LocaleProvider>,
      );
      expect(markup).toContain(`aria-label="${title}"`);
      expect(markup).toContain(`lang="${locale}"`);
      expect(markup).toContain(label);
      expect(markup).toContain(">1234567</strong>");
    },
  );

  it("keeps the QR code, visible address, and copy action on the same public join destination", () => {
    fixtures.nextBase = "https://join.example.test";
    const markup = renderToStaticMarkup(
      <LocaleProvider initialLocale="en-CA" initialDomains={["live-delivery"]} initialMessages={{}}>
        <PresentationDeliveryJoinAccess code="1234567" />
      </LocaleProvider>,
    );
    expect(markup).toContain('width="88"');
    expect(markup).toContain('height="88"');
    expect(markup).toContain("Scan to join this Presentation");
    expect(markup).toContain('href="https://join.example.test/join?code=1234567"');
    expect(markup).toContain('rel="noopener noreferrer"');
    expect(markup).toContain("Copy join link</button>");
  });
});
