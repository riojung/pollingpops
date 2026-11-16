import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { LibraryShareSummary } from "@openround/contracts";
import { LibraryScopeNavigation } from "./scope-navigation";
import { LibraryShareActions } from "./share-actions";
import { SharedLibraryQuestion } from "./shared-reader";
import { LibraryShareDue } from "./share-due";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/library",
}));
vi.mock("../workspace-provider", () => ({
  useWorkspace: () => ({ creator: { userId: "actor", workspaceId: "workspace" } }),
}));
const id = "00000000-0000-4000-8000-000000000001";
const share: LibraryShareSummary = {
  id,
  organizationId: id,
  organizationName: "Organization",
  sourceWorkspaceId: id,
  sourceWorkspaceName: "Source workspace",
  artifactType: "round",
  artifactId: id,
  versionId: id,
  title: "Published Round",
  description: "",
  sharedAt: "2026-11-16T12:00:00.000Z",
  permission: "view",
  audience: "people",
  message: "",
  dueAt: null,
  progress: "new",
  capabilities: { view: true, copy: false, manage: false },
};

describe("library access controls", () => {
  it.each(["new", "in_progress"] as const)(
    "labels unfinished %s items with a past review date as overdue",
    (progress) => {
      const markup = renderToStaticMarkup(
        <LibraryShareDue dueAt="2000-01-01T12:00:00.000Z" progress={progress} />,
      );
      expect(markup).toContain("Review by:");
      expect(markup).toContain('dateTime="2000-01-01T12:00:00.000Z"');
      expect(markup).toContain("Overdue");
    },
  );

  it("keeps reviewed and future-due items free of an overdue indicator", () => {
    expect(
      renderToStaticMarkup(<LibraryShareDue dueAt="2000-01-01T12:00:00.000Z" progress="done" />),
    ).not.toContain("Overdue");
    expect(
      renderToStaticMarkup(<LibraryShareDue dueAt="2100-01-01T12:00:00.000Z" progress="new" />),
    ).not.toContain("Overdue");
    expect(renderToStaticMarkup(<LibraryShareDue dueAt={null} progress="new" />)).toBe("");
  });
  it("keeps Shared with me available in personal workspaces without an organization catalog", () => {
    const markup = renderToStaticMarkup(
      <LibraryScopeNavigation scope="shared" type="surveys" organization={false} />,
    );
    expect(markup).toContain("My workspace");
    expect(markup).toContain("Shared with me");
    expect(markup).toContain('href="/library?scope=shared&amp;type=surveys"');
    expect(markup).not.toContain("Organization library");
    expect(markup).not.toContain("Manage sharing");
  });

  it("offers only resource capabilities and never links to the foreign source editor", () => {
    const markup = renderToStaticMarkup(
      <LibraryShareActions share={share} onChange={vi.fn()} onRevoked={vi.fn()} />,
    );
    expect(markup).toContain(`/library/shared/${id}`);
    expect(markup).toContain("Mark reviewed");
    expect(markup).not.toContain("Use a copy");
    expect(markup).not.toContain("Revoke access");
    expect(markup).not.toContain(`/quiz/${id}`);
  });

  it("explains unavailable copy destinations while keeping shared viewing available", () => {
    const markup = renderToStaticMarkup(
      <LibraryShareActions
        share={{ ...share, permission: "use" }}
        onChange={vi.fn()}
        onRevoked={vi.fn()}
      />,
    );
    expect(markup).toContain("same organization");
    expect(markup).toContain(">Open</a>");
    expect(markup).not.toContain(">Use a copy</button>");
  });

  it("renders safe question content without answers, explanations, or response inputs", () => {
    const question = {
      id,
      type: "single_select",
      prompt: "Which direction?",
      mediaId: null,
      mediaAlt: null,
      choices: [{ id, label: "North" }],
      answers: ["secret answer"],
      explanation: "private explanation",
      notes: "private notes",
    };
    const markup = renderToStaticMarkup(<SharedLibraryQuestion question={question} shareId={id} />);
    expect(markup).toContain("Which direction?");
    expect(markup).toContain("North");
    expect(markup).not.toMatch(
      /secret answer|private explanation|private notes|<input|<textarea|<form/,
    );
  });
});
