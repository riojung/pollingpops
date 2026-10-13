import { afterEach, describe, expect, it, vi } from "vitest";
import {
  customerManagementLinks,
  emptyCustomerManagementNavigation,
  emptyOperatorManagementNavigation,
  fetchCustomerManagementNavigation,
  fetchOperatorManagementNavigation,
  type CustomerManagementNavigation,
} from "./management-navigation";

const user = { userId: "11111111-1111-4111-8111-111111111111", email: "admin@example.com" };
const organizationId = "22222222-2222-4222-8222-222222222222";
const origin = "https://control.example.com";

function customer(role: "owner" | "admin" | "billing" | "member"): CustomerManagementNavigation {
  return {
    user,
    organizationManagementEnabled: true,
    organizations: [{ id: organizationId, name: "Customer team", role }],
    operatorConsoleOrigin: origin,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("customer management navigation", () => {
  it("hides management when disabled or signed out", () => {
    expect(
      customerManagementLinks({ ...customer("owner"), organizationManagementEnabled: false }),
    ).toEqual([]);
    expect(customerManagementLinks({ ...customer("owner"), user: null })).toEqual([]);
  });

  it("shows membership and workspace controls only to organization owners and admins", () => {
    for (const role of ["owner", "admin"] as const) {
      expect(customerManagementLinks(customer(role)).map((link) => link.id)).toEqual([
        "organization",
        "workspaces",
        "members",
        "billing",
        "credits",
        "settings",
      ]);
    }
    expect(customerManagementLinks(customer("billing")).map((link) => link.id)).toEqual([
      "organization",
      "billing",
      "credits",
    ]);
    expect(customerManagementLinks(customer("member")).map((link) => link.id)).toEqual([
      "organization",
    ]);
  });

  it("targets an authorized organization instead of borrowing the role of another membership", () => {
    const links = customerManagementLinks({
      ...customer("owner"),
      organizations: [
        { id: "unrelated", name: "Read only", role: "member" },
        { id: "payer", name: "Billing team", role: "billing" },
        { id: "managed", name: "Managed team", role: "admin" },
      ],
    });
    expect(links.find((link) => link.id === "members")?.href).toBe(
      "/organization?organizationId=managed#members",
    );
    expect(links.find((link) => link.id === "billing")?.href).toBe(
      "/organization?organizationId=payer#billing",
    );
    expect(links.every((link) => !link.href.includes("unrelated"))).toBe(true);
  });

  it("loads user-only identity without calling the workspace authentication endpoint", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(customer("billing")));
    vi.stubGlobal("fetch", fetch);
    expect(await fetchCustomerManagementNavigation()).toEqual(customer("billing"));
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[0]).toContain("/v1/auth/navigation");
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      credentials: "include",
      cache: "no-store",
      signal: expect.any(AbortSignal),
    });
  });

  it("treats an older product API as management unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({}, { status: 404 })),
    );
    expect(await fetchCustomerManagementNavigation()).toEqual(emptyCustomerManagementNavigation);
  });
});

describe("independent operator navigation", () => {
  it("loads trusted capability-filtered links using only the console session", async () => {
    const navigation = {
      operator: { name: "Billing staff", role: "billing" },
      links: [{ id: "billing", label: "Billing", href: `${origin}/?view=billing` }],
    };
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(navigation));
    vi.stubGlobal("fetch", fetch);
    expect(await fetchOperatorManagementNavigation(origin)).toEqual(navigation);
    expect(fetch.mock.calls[0]?.[0]).toBe(`${origin}/api/navigation`);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      credentials: "include",
      cache: "no-store",
      signal: expect.any(AbortSignal),
    });
  });

  it("never exposes operator links after sign-out, outages, or invalid capabilities", async () => {
    for (const response of [
      Response.json({}, { status: 401 }),
      Response.json({}, { status: 503 }),
      Response.json({ operator: { name: "Customer owner", role: "owner" }, links: [] }),
    ]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => response),
      );
      expect(await fetchOperatorManagementNavigation(origin)).toEqual(
        emptyOperatorManagementNavigation,
      );
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Connection refused");
      }),
    );
    expect(await fetchOperatorManagementNavigation(origin)).toEqual(
      emptyOperatorManagementNavigation,
    );
  });

  it("rejects redirected link origins and never probes malformed console origins", async () => {
    const fetch = vi.fn(async () =>
      Response.json({
        operator: { name: "Founder", role: "founder" },
        links: [
          { id: "organizations", label: "Tenants", href: `${origin}/?view=organizations` },
          { id: "billing", label: "Billing", href: "https://other.example.com/?view=billing" },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const result = await fetchOperatorManagementNavigation(origin);
    expect(result.links).toHaveLength(1);
    expect(result.links[0]?.id).toBe("organizations");
    fetch.mockClear();
    for (const invalid of [
      null,
      "javascript:alert(1)",
      `${origin}/path`,
      "https://staff:secret@control.example.com",
    ]) {
      expect(await fetchOperatorManagementNavigation(invalid)).toEqual(
        emptyOperatorManagementNavigation,
      );
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});
