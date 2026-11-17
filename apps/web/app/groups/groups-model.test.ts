import { describe, expect, it } from "vitest";
import {
  defaultGroupFilters,
  filterGroups,
  resolveGroupCapabilities,
  type GroupSummary,
} from "./groups-model";

const caps = {
  manageMembers: true,
  shareContent: true,
  postMessage: true,
  schedule: false,
  manageGroup: true,
};
function group(id: string, values: Partial<GroupSummary> = {}): GroupSummary {
  return {
    id,
    name: id,
    description: "",
    role: "member",
    scope: "workspace",
    scopeName: "Personal workspace",
    purpose: "team",
    status: "active",
    memberCount: 2,
    artifactCount: 0,
    upcomingCount: 0,
    createdAt: "2026-11-01T12:00:00Z",
    updatedAt: "2026-11-01T12:00:00Z",
    capabilities: caps,
    ...values,
  };
}
const groups = [
  group("Alpine team"),
  group("Zulu project", {
    scope: "organization",
    scopeName: "Acme",
    role: "owner",
    purpose: "project",
    description: "Launch planning",
    updatedAt: "2026-11-15T12:00:00Z",
  }),
  group("Archive", {
    scope: "organization",
    status: "archived",
    purpose: "department",
    updatedAt: "2026-11-16T12:00:00Z",
  }),
];

describe("group discovery", () => {
  it("defaults to active joined groups across scopes in recent order without mutating the source", () => {
    expect(filterGroups(groups, defaultGroupFilters, "en-CA").map((item) => item.id)).toEqual([
      "Zulu project",
      "Alpine team",
    ]);
    expect(groups.map((item) => item.id)).toEqual(["Alpine team", "Zulu project", "Archive"]);
  });
  it("combines scope, purpose, role and localized text search", () => {
    const filters = {
      ...defaultGroupFilters,
      scope: "organization" as const,
      purpose: "project" as const,
      access: "owner" as const,
      search: " ACME ",
    };
    expect(filterGroups(groups, filters, "en-CA").map((item) => item.id)).toEqual(["Zulu project"]);
    expect(filterGroups(groups, { ...filters, search: "launch" }, "en-CA")).toHaveLength(1);
    expect(filterGroups(groups, { ...filters, access: "member" }, "en-CA")).toEqual([]);
  });
  it("finds archived groups explicitly and sorts by name independently of update date", () => {
    expect(
      filterGroups(groups, { ...defaultGroupFilters, status: "archived" }, "en-CA").map(
        (item) => item.id,
      ),
    ).toEqual(["Archive"]);
    expect(
      filterGroups(groups, { ...defaultGroupFilters, status: "all", sort: "name" }, "en-CA").map(
        (item) => item.id,
      ),
    ).toEqual(["Alpine team", "Archive", "Zulu project"]);
  });
});

describe("group action authority", () => {
  it("uses server capabilities even for a local workspace owner", () => {
    const denied = { ...caps, manageGroup: false, manageMembers: false, shareContent: false };
    expect(resolveGroupCapabilities({ ...groups[1]!, capabilities: denied }, true, true)).toEqual(
      denied,
    );
  });
  it("fails closed for organization responses without capabilities", () => {
    const result = resolveGroupCapabilities(
      { scope: "organization", role: "owner", status: "active" },
      true,
      true,
    );
    expect(Object.values(result)).not.toContain(true);
  });
  it("keeps legacy archived groups read-only and workspace viewers from member management", () => {
    expect(
      Object.values(
        resolveGroupCapabilities(
          { scope: "workspace", role: "owner", status: "archived" },
          true,
          true,
        ),
      ),
    ).not.toContain(true);
    expect(
      resolveGroupCapabilities(
        { scope: "workspace", role: "owner", status: "active" },
        false,
        false,
      ),
    ).toMatchObject({
      manageMembers: false,
      shareContent: false,
      schedule: false,
      postMessage: true,
    });
  });
});
