import { describe, expect, it } from "vitest";
import { BrandThemeSchema } from "@openround/contracts";
import type { WorkspaceAccountContext } from "../../components/workspace/workspace-provider";
import {
  accountPermissions,
  organizationSettingsHref,
  personalBillingAction,
  selectedSettingsSection,
  visibleSettingsSections,
  workspaceThemePresets,
  type PersonalBillingState,
} from "./account-settings-model";

const organizationWorkspace: WorkspaceAccountContext = {
  id: "workspace",
  name: "Sales - Alex",
  accountType: "organization",
  licenseUnit: "user",
  organization: { id: "org", name: "ABC Company", role: "member" },
  permissions: {
    manageWorkspace: true,
    managePeople: false,
    manageBilling: false,
    manageIntegrations: false,
  },
};

const personalWorkspace: WorkspaceAccountContext = {
  ...organizationWorkspace,
  accountType: "personal",
  licenseUnit: "workspace",
  organization: null,
  planSource: "subscription",
  permissions: { ...organizationWorkspace.permissions, manageBilling: true },
};

function billingState(
  status: string,
  customerId: string | null = "cus_existing",
): PersonalBillingState {
  return { state: "ready", billing: { status, customerId, subscriptionId: "sub_existing" } };
}

describe("customer settings permissions", () => {
  it("uses authoritative permissions instead of treating a user's workspace ownership as organization administration", () => {
    expect(visibleSettingsSections(organizationWorkspace, "owner")).toEqual([
      "overview",
      "appearance",
      "plan",
      "data",
    ]);
    expect(accountPermissions(organizationWorkspace, "owner").managePeople).toBe(false);
    expect(
      selectedSettingsSection("#people", visibleSettingsSections(organizationWorkspace, "owner")),
    ).toBe("overview");
    expect(
      selectedSettingsSection("#security", visibleSettingsSections(organizationWorkspace, "owner")),
    ).toBe("overview");
  });
  it("keeps legacy viewers read-only and personal owners able to configure their workspace", () => {
    expect(visibleSettingsSections(null, "viewer")).toEqual(["overview", "plan", "data"]);
    expect(visibleSettingsSections(null, "editor")).toEqual(["overview", "plan", "data"]);
    expect(visibleSettingsSections(null, "owner")).toEqual([
      "overview",
      "people",
      "appearance",
      "plan",
      "security",
      "data",
    ]);
  });
  it("does not grant organization privileges to a legacy collaborator without an organization role", () => {
    const workspace = {
      ...organizationWorkspace,
      organization: { ...organizationWorkspace.organization!, role: null },
    };
    expect(visibleSettingsSections(workspace, "owner")).not.toContain("people");
    expect(visibleSettingsSections(workspace, "owner")).not.toContain("security");
  });
  it("opens management for the selected organization and defaults unsupported fragments to overview", () => {
    expect(organizationSettingsHref(organizationWorkspace, "members")).toBe(
      "/organization?organizationId=org#members",
    );
    expect(organizationSettingsHref(organizationWorkspace, "billing")).toBe(
      "/organization?organizationId=org#billing",
    );
    expect(selectedSettingsSection("#data", ["overview", "data"])).toBe("data");
    expect(selectedSettingsSection("#unknown", ["overview", "data"])).toBe("overview");
  });
  it("offers only contrast-checked valid theme presets", () => {
    for (const preset of workspaceThemePresets) {
      expect(
        BrandThemeSchema.safeParse({
          organizationName: "ABC Company",
          primaryColor: preset.primaryColor,
          accentColor: preset.accentColor,
        }).success,
      ).toBe(true);
    }
  });

  it("keeps legitimate personal Pro and legacy Team subscriptions reachable through the billing portal", () => {
    const personal = personalWorkspace;
    const active = billingState("active");
    expect(personalBillingAction(personal, "owner", "pro", active)).toBe("portal");
    expect(personalBillingAction(personal, "owner", "team", active)).toBe("portal");
    expect(personalBillingAction(null, "owner", "team", active)).toBe("portal");
    expect(
      personalBillingAction({ ...personal, planSource: "community" }, "owner", "team", active),
    ).toBeNull();
    expect(personalBillingAction(null, "viewer", "team", active)).toBeNull();
    expect(personalBillingAction(null, "editor", "pro", active)).toBeNull();
    expect(
      personalBillingAction(
        { ...personal, permissions: { ...personal.permissions, manageBilling: false } },
        "owner",
        "team",
        active,
      ),
    ).toBeNull();
    expect(personalBillingAction(organizationWorkspace, "owner", "team", active)).toBeNull();
  });

  it.each(["editor", "viewer"] as const)(
    "retains payer portal recovery for a content %s with authoritative billing permission",
    (role) => {
      expect(personalBillingAction(personalWorkspace, role, "free", billingState("past_due"))).toBe(
        "portal",
      );
      expect(
        personalBillingAction(
          {
            ...personalWorkspace,
            permissions: { ...personalWorkspace.permissions, manageBilling: false },
          },
          role,
          "free",
          billingState("past_due"),
        ),
      ).toBeNull();
      expect(
        personalBillingAction(
          { ...personalWorkspace, planSource: "community" },
          role,
          "free",
          billingState("past_due"),
        ),
      ).toBeNull();
      expect(
        personalBillingAction(
          {
            ...organizationWorkspace,
            permissions: { ...organizationWorkspace.permissions, manageBilling: true },
          },
          role,
          "free",
          billingState("past_due"),
        ),
      ).toBeNull();
    },
  );

  it.each(["past_due", "unpaid", "incomplete", "paused", "active"])(
    "keeps an existing %s subscription in the portal even after grace expires and access becomes Free",
    (status) => {
      expect(
        personalBillingAction(
          { ...personalWorkspace, planSource: "free" },
          "owner",
          "free",
          billingState(status),
        ),
      ).toBe("portal");
    },
  );

  it.each(["canceled", "incomplete_expired"])(
    "allows a new subscription for a %s account with Free access",
    (status) => {
      expect(personalBillingAction(personalWorkspace, "owner", "free", billingState(status))).toBe(
        "checkout",
      );
      expect(
        personalBillingAction(personalWorkspace, "owner", "free", {
          state: "ready",
          billing: { status, customerId: null, subscriptionId: null },
        }),
      ).toBe("checkout");
    },
  );

  it("offers checkout for a new Free account but retains the portal for a linked, unconfirmed subscription", () => {
    expect(
      personalBillingAction(personalWorkspace, "owner", "free", {
        state: "ready",
        billing: { status: "free", customerId: null, subscriptionId: null },
      }),
    ).toBe("checkout");
    expect(personalBillingAction(personalWorkspace, "owner", "free", billingState("free"))).toBe(
      "portal",
    );
    expect(
      personalBillingAction(personalWorkspace, "owner", "free", billingState("free", null)),
    ).toBeNull();
  });

  it("never falls back to checkout while billing loads, fails, or lacks an existing subscriber's customer", () => {
    for (const state of [{ state: "loading" }, { state: "error" }] as const) {
      expect(personalBillingAction(personalWorkspace, "owner", "free", state)).toBeNull();
      expect(personalBillingAction(personalWorkspace, "owner", "pro", state)).toBeNull();
    }
    expect(
      personalBillingAction(personalWorkspace, "owner", "free", billingState("past_due", null)),
    ).toBeNull();
  });
});
