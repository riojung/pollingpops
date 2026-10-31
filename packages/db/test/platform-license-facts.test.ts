import { describe, expect, it } from "vitest";
import {
  PlatformService,
  selectWorkspaceLicenseAssignment,
  workspaceLicenseTerms,
  type PlatformStore,
} from "../src/platform-service.js";
import type {
  LicenseUnit,
  OrganizationMemberRecord,
  OrganizationRecord,
  PlatformSubscription,
  UserLicenseAssignment,
} from "../src/platform-types.js";

const now = new Date("2030-01-01T00:00:00.000Z");
const before = new Date(now.getTime() - 1);
const after = new Date(now.getTime() + 1);
const organization: OrganizationRecord = {
  id: "org",
  name: "License policy",
  status: "active",
  licenseUnit: "user",
  createdAt: before,
  updatedAt: before,
};
const subscription: PlatformSubscription = {
  organizationId: "org",
  customerId: null,
  subscriptionId: null,
  status: "active",
  licenseQuantity: 2,
  licenseUnit: "user",
  offerId: null,
  paidThrough: null,
  graceUntil: null,
  updatedAt: before,
};

describe("workspace license facts", () => {
  it.each<{
    name: string;
    org?: OrganizationRecord | null;
    sub?: Partial<PlatformSubscription> | null;
    hold?: boolean;
    active: boolean;
  }>([
    { name: "active without a paid-through deadline", active: true },
    { name: "trialing", sub: { status: "trialing" }, active: true },
    { name: "future paid-through", sub: { paidThrough: after }, active: true },
    { name: "equal paid-through", sub: { paidThrough: now }, active: false },
    { name: "past paid-through", sub: { paidThrough: before }, active: false },
    {
      name: "active with grace after paid-through",
      sub: { paidThrough: before, graceUntil: after },
      active: true,
    },
    {
      name: "active equal grace after paid-through",
      sub: { paidThrough: before, graceUntil: now },
      active: false,
    },
    { name: "past_due without grace", sub: { status: "past_due" }, active: false },
    {
      name: "past_due with future grace",
      sub: { status: "past_due", graceUntil: after },
      active: true,
    },
    {
      name: "past_due with equal grace",
      sub: { status: "past_due", graceUntil: now },
      active: false,
    },
    {
      name: "past_due future paid-through does not replace grace",
      sub: { status: "past_due", paidThrough: after },
      active: false,
    },
    {
      name: "unpaid with future grace",
      sub: { status: "unpaid", graceUntil: after },
      active: true,
    },
    {
      name: "unpaid with expired grace",
      sub: { status: "unpaid", graceUntil: before },
      active: false,
    },
    { name: "free", sub: { status: "free" }, active: false },
    {
      name: "canceled even with future grace",
      sub: { status: "canceled", graceUntil: after },
      active: false,
    },
    { name: "missing organization", org: null, active: false },
    {
      name: "suspended organization",
      org: { ...organization, status: "suspended" },
      active: false,
    },
    { name: "closed organization", org: { ...organization, status: "closed" }, active: false },
    { name: "missing subscription", sub: null, active: false },
    { name: "commercial hold", hold: true, active: false },
  ])("preserves $name", ({ org, sub, hold, active }) => {
    const facts = workspaceLicenseTerms(
      org === undefined ? organization : org,
      sub === null ? null : { ...subscription, ...sub },
      hold ?? false,
      now,
    );
    expect(facts).toEqual(active ? { unit: "user", quantity: 2 } : null);
  });

  it.each<{
    name: string;
    subscriptionUnit: LicenseUnit | undefined;
    organizationUnit: LicenseUnit | undefined;
    expected: LicenseUnit;
  }>([
    {
      name: "subscription overrides organization",
      subscriptionUnit: "workspace",
      organizationUnit: "user",
      expected: "workspace",
    },
    {
      name: "user subscription overrides legacy organization",
      subscriptionUnit: "user",
      organizationUnit: "workspace",
      expected: "user",
    },
    {
      name: "organization fallback",
      subscriptionUnit: undefined,
      organizationUnit: "user",
      expected: "user",
    },
    {
      name: "historical absent-unit fallback",
      subscriptionUnit: undefined,
      organizationUnit: undefined,
      expected: "workspace",
    },
  ])("preserves $name", ({ subscriptionUnit, organizationUnit, expected }) => {
    expect(
      workspaceLicenseTerms(
        { ...organization, licenseUnit: organizationUnit },
        { ...subscription, licenseUnit: subscriptionUnit, licenseQuantity: 0 },
        false,
        now,
      ),
    ).toEqual({ unit: expected, quantity: 0 });
  });

  it("orders user seats by timestamp then user ID, before quantity slicing and workspace selection", () => {
    const assignments = Object.freeze([
      Object.freeze({ workspaceId: "target", userId: "z", assignedAt: after }),
      Object.freeze({ workspaceId: "other", userId: "a", assignedAt: now }),
      Object.freeze({ workspaceId: "target", userId: "b", assignedAt: now }),
      Object.freeze({ workspaceId: "earlier", userId: "z", assignedAt: before }),
    ]);
    const original = [...assignments];
    const select = (quantity: number) =>
      selectWorkspaceLicenseAssignment(assignments, "target", quantity, (entry) => entry.userId);
    expect(select(0)).toBeUndefined();
    expect(select(1)).toBeUndefined();
    expect(select(2)).toBeUndefined();
    expect(select(3)).toBe(assignments[2]);
    expect(assignments).toEqual(original);
  });

  it("uses workspace IDs for historical workspace-seat ties", () => {
    const assignments = Object.freeze([
      Object.freeze({ workspaceId: "z", assignedAt: now }),
      Object.freeze({ workspaceId: "a", assignedAt: now }),
    ]);
    expect(
      selectWorkspaceLicenseAssignment(assignments, "z", 1, (entry) => entry.workspaceId),
    ).toBeUndefined();
    expect(
      selectWorkspaceLicenseAssignment(assignments, "a", 1, (entry) => entry.workspaceId),
    ).toBe(assignments[1]);
    expect(assignments[0]?.workspaceId).toBe("z");
  });

  it.each<{ role: OrganizationMemberRecord["role"] | null; licensed: boolean }>([
    { role: "owner", licensed: true },
    { role: "admin", licensed: true },
    { role: "member", licensed: true },
    { role: "billing", licensed: false },
    { role: null, licensed: false },
  ])("looks up the selected origin seat's current member ($role)", async ({ role, licensed }) => {
    const lookedUp: string[] = [];
    const records = new Map<string, unknown>([
      ["organization:org", organization],
      ["subscription:org", subscription],
      [
        "member:org:actor",
        { organizationId: "org", userId: "actor", role: "owner", createdAt: before },
      ],
    ]);
    if (role)
      records.set("member:org:origin", {
        organizationId: "org",
        userId: "origin",
        role,
        createdAt: before,
      });
    const assignments: UserLicenseAssignment[] = [
      {
        organizationId: "org",
        userId: "actor",
        workspaceId: "actor-workspace",
        assignedBy: "actor",
        assignedAt: before,
      },
      {
        organizationId: "org",
        userId: "origin",
        workspaceId: "origin-workspace",
        assignedBy: "actor",
        assignedAt: now,
      },
    ];
    const facts: Pick<PlatformStore, "organizationIdForWorkspace" | "get" | "list"> = {
      organizationIdForWorkspace: async () => "org",
      get: async <T>(kind: string, id: string): Promise<T | null> => {
        lookedUp.push(`${kind}:${id}`);
        return (records.get(`${kind}:${id}`) as T | undefined) ?? null;
      },
      list: async <T>(kind: string): Promise<T[]> =>
        kind === "user_license" ? (assignments as unknown as T[]) : [],
    };
    expect(
      await new PlatformService(facts as PlatformStore).workspaceHasLicense(
        "origin-workspace",
        now,
      ),
    ).toBe(licensed);
    expect(lookedUp).toContain("member:org:origin");
    expect(lookedUp).not.toContain("member:org:actor");
  });
});
