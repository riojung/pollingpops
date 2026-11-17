import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { withEnglishLocale } from "../../test-utils/english-locale";
import { GroupDialog } from "./group-dialog";
import type { GroupDetail, GroupsContext } from "./groups-model";

vi.mock("next/navigation", () => ({ usePathname: () => "/groups" }));
const context: GroupsContext = {
  organizationId: "company",
  organizationName: "Company",
  canCreateWorkspaceGroup: false,
  canCreateOrganizationGroup: true,
};
const group: GroupDetail = {
  id: "group",
  name: "Company project",
  description: "A focused team",
  purpose: "project",
  status: "active",
  scope: "organization",
  scopeName: "Company",
  role: "owner",
  capabilities: {
    manageMembers: true,
    shareContent: true,
    manageGroup: true,
    postMessage: true,
    schedule: false,
  },
  members: [],
  availableMembers: [],
  artifacts: [],
  messages: [],
  schedule: [],
  memberCount: 0,
  artifactCount: 0,
  upcomingCount: 0,
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
};
function render(values: { group?: GroupDetail; busy?: boolean } = {}) {
  return renderToStaticMarkup(
    withEnglishLocale(
      <GroupDialog
        context={context}
        group={values.group}
        busy={values.busy ?? false}
        error=""
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    ),
  );
}

describe("group modal semantics", () => {
  it("has an explicit translated accessible name and only permits creation in authorized scopes", () => {
    const markup = render();
    expect(markup).toContain('aria-label="Create group"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('value="organization" selected=""');
    expect(markup).not.toContain('value="workspace"');
    expect(markup).toContain("Group name");
    expect(markup).toContain("Purpose");
    expect(markup).toContain("Workspace groups bring together workspace members");
  });
  it("keeps metadata editing separate from changing scope", () => {
    const markup = render({ group });
    expect(markup).toContain('aria-label="Group settings"');
    expect(markup).toContain('value="Company project"');
    expect(markup).toContain("Save changes");
    expect(markup).not.toContain("Group scope");
  });
  it("disables dismissal and fields while saving", () => {
    const markup = render({ group, busy: true });
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Close<\/button>/);
    expect(markup).toMatch(/<input[^>]*disabled=""/);
    expect(markup).toContain("Saving…");
  });
});
