import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../../components/locale-provider";
import { englishMessages } from "../../lib/i18n/catalog";
import { accountEnglishMessages } from "../../lib/i18n/domains/account";
import { PersonalSubscriptionChoices } from "./personal-subscription-options";
import {
  formatPersonalOfferPrice,
  personalCheckoutOfferId,
  personalSubscriptionOffers,
  type PersonalSubscriptionCatalog,
  type PersonalSubscriptionOffer,
} from "./personal-subscription-model";

vi.mock("next/navigation", () => ({ usePathname: () => "/account" }));

const monthly: PersonalSubscriptionOffer = {
  id: "personal-monthly",
  name: "Personal monthly",
  kind: "workspace_subscription",
  licenseUnit: "workspace",
  currency: "CAD",
  amountMinor: 1250,
  interval: "month",
};
const annual: PersonalSubscriptionOffer = {
  ...monthly,
  id: "personal-annual",
  name: "Personal annual",
  amountMinor: 12500,
  interval: "year",
};
const catalog: PersonalSubscriptionCatalog = {
  offers: [monthly, annual],
  checkoutEnabled: true,
};

function render(value = catalog, selectedId = "") {
  return renderToStaticMarkup(
    <LocaleProvider
      initialLocale="en-CA"
      initialDomains={["account"]}
      initialMessages={{ ...englishMessages, ...accountEnglishMessages }}
    >
      <PersonalSubscriptionChoices
        catalog={value}
        selectedId={selectedId}
        busy={false}
        onSelect={() => {}}
        onCheckout={() => {}}
      />
    </LocaleProvider>,
  );
}

describe("personal subscription selection", () => {
  it("requires an explicit monthly or annual selection and preserves the chosen checkout offer", () => {
    expect(personalCheckoutOfferId(catalog, "", "en-CA")).toBeNull();
    expect(personalCheckoutOfferId(catalog, "unknown", "en-CA")).toBeNull();
    expect(personalCheckoutOfferId(catalog, annual.id, "en-CA")).toBe(annual.id);
    const unselected = render();
    expect(unselected).toContain("Personal monthly · $12.50 / month");
    expect(unselected).toContain("Personal annual · $125.00 / year");
    expect(unselected).toMatch(/<button[^>]*disabled=""/);
    const selected = render(catalog, annual.id);
    expect(selected).toContain('value="personal-annual" selected=""');
    expect(selected).not.toMatch(/<button[^>]*disabled/);
  });

  it("selects the only subscription automatically and excludes organization seats and credit packs", () => {
    const mixed: PersonalSubscriptionCatalog = {
      ...catalog,
      offers: [monthly, { ...annual, licenseUnit: "user" }, { ...annual, kind: "credit_pack" }],
    };
    expect(personalSubscriptionOffers(mixed)).toEqual([monthly]);
    expect(personalCheckoutOfferId(mixed, "", "en-CA")).toBe(monthly.id);
  });

  it("shows configured offers but blocks checkout and explains an unconfigured payment provider", () => {
    const disabled = { ...catalog, checkoutEnabled: false };
    expect(personalCheckoutOfferId(disabled, monthly.id, "en-CA")).toBeNull();
    const markup = render(disabled, monthly.id);
    expect(markup).toContain("Personal monthly");
    expect(markup).toContain("Online checkout is not configured for this installation");
    expect(markup).toMatch(/<button[^>]*disabled=""/);
    expect(render({ ...disabled, offers: [] })).toContain(
      "No personal subscription offers are available.",
    );
  });

  it("uses the currency minor unit, and prevents checkout when the published price is incomplete", () => {
    expect(
      formatPersonalOfferPrice({ ...monthly, currency: "JPY", amountMinor: 1250 }, "ja-JP"),
    ).toBe("￥1,250");
    const missingPrice = { ...catalog, offers: [{ ...monthly, amountMinor: null }] };
    expect(personalCheckoutOfferId(missingPrice, monthly.id, "en-CA")).toBeNull();
    expect(render(missingPrice)).toContain("Price unavailable");
  });
});
