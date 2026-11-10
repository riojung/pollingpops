import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../locale-provider";
import { PresentationDeliveryJoinAccess } from "./delivery-join-access";

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
});
