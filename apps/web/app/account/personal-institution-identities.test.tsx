import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { FederatedIdentity, OidcStatus } from "@openround/contracts";
import { LocaleProvider } from "../../components/locale-provider";
import { englishMessages } from "../../lib/i18n/catalog";
import { accountEnglishMessages } from "../../lib/i18n/domains/account";
import { visibleSettingsSections } from "./account-settings-model";
import { PersonalInstitutionIdentities } from "./personal-institution-identities";

vi.mock("next/navigation", () => ({ usePathname: () => "/account" }));

const status: OidcStatus = {
  enabled: true,
  providerName: "Example institution",
  workspaceId: "11111111-1111-4111-8111-111111111111",
  identityRequirement: "optional",
};
const identity: FederatedIdentity = {
  id: "22222222-2222-4222-8222-222222222222",
  provider: "oidc",
  issuer: "https://identity.example.org",
  emailHint: "viewer@example.org",
  linkedAt: "2026-10-29T12:00:00Z",
  lastUsedAt: null,
};

function render(oidc: OidcStatus | null, identities: FederatedIdentity[]) {
  return renderToStaticMarkup(
    <LocaleProvider
      initialLocale="en-CA"
      initialDomains={["account"]}
      initialMessages={{ ...englishMessages, ...accountEnglishMessages }}
    >
      <PersonalInstitutionIdentities
        status={oidc}
        identities={identities}
        workspaceId={status.workspaceId}
        busy={false}
        onLink={() => {}}
        onUnlink={() => {}}
      />
    </LocaleProvider>,
  );
}

describe("personal institution sign-in settings", () => {
  it.each(["viewer", "editor"] as const)(
    "keeps own identity management in Privacy for a %s without workspace integration permission",
    (role) => {
      expect(visibleSettingsSections(null, role)).toContain("data");
      expect(visibleSettingsSections(null, role)).not.toContain("security");
      const linked = render(status, [identity]);
      expect(linked).toContain("viewer@example.org");
      expect(linked).toContain(">Unlink</button>");
      expect(linked).toContain(`href="/signin?workspaceId=${status.workspaceId}"`);
      expect(linked).not.toContain("Identity and integration policy");
      expect(render(status, [])).toContain("Link Example institution");
    },
  );
  it("allows unlinking a retained identity after the provider is disabled without offering a new link", () => {
    const markup = render({ ...status, enabled: false, providerName: null }, [identity]);
    expect(markup).toContain(">Unlink</button>");
    expect(markup).toContain(identity.issuer);
    expect(markup).not.toContain("Link Example institution");
    expect(markup).not.toContain("/signin?workspaceId=");
  });
  it("does not expose unconfigured institution settings", () => {
    expect(render(null, [])).toBe("");
  });
});
