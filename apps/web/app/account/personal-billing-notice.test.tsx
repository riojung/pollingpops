import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../../components/locale-provider";
import { englishMessages } from "../../lib/i18n/catalog";
import { accountEnglishMessages } from "../../lib/i18n/domains/account";
import { PersonalBillingNotice } from "./personal-billing-notice";
import type { PersonalBillingState } from "./account-settings-model";

vi.mock("next/navigation", () => ({ usePathname: () => "/account" }));

function render(status: PersonalBillingState) {
  return renderToStaticMarkup(
    <LocaleProvider
      initialLocale="en-CA"
      initialDomains={["account"]}
      initialMessages={{ ...englishMessages, ...accountEnglishMessages }}
    >
      <PersonalBillingNotice status={status} onRetry={() => {}} />
    </LocaleProvider>,
  );
}

describe("personal billing recovery status", () => {
  it("announces the status load without offering a duplicate subscription", () => {
    const markup = render({ state: "loading" });
    expect(markup).toContain('role="status"');
    expect(markup).toContain("Loading billing details");
    expect(markup).not.toContain("<button");
  });

  it.each<PersonalBillingState>([
    { state: "error" },
    {
      state: "ready",
      billing: { status: "past_due", customerId: null, subscriptionId: "sub_existing" },
    },
  ])("provides a retry when status cannot authorize billing actions: $state", (status) => {
    const markup = render(status);
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Billing details are unavailable");
    expect(markup).toContain(">Reload billing</button>");
    expect(markup).not.toContain("Explore Pro");
  });
});
