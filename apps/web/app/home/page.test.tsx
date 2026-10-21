import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { withEnglishLocale } from "../../test-utils/english-locale";

vi.mock("next/navigation", () => ({
  usePathname: () => "/home",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock("../../components/workspace/workspace-provider", () => ({
  WorkspaceProvider: ({ children }: { children: ReactNode }) => children,
  useWorkspace: () => ({
    creator: { email: "new.user@example.com", role: "owner", plan: "free", segment: "workplace" },
    productFeatures: { workspaceShell: true, uxBeta: false, builderV2: false },
    loading: false,
    error: "",
    canEdit: true,
    signOut: vi.fn(),
    startUpgrade: vi.fn(),
    refreshAccount: vi.fn(),
  }),
}));

import HomePage from "./page";

describe("baseline tenant Home", () => {
  it("renders the modern Home shell without UX beta or optional paid capabilities", () => {
    const markup = renderToStaticMarkup(withEnglishLocale(<HomePage />));
    expect(markup).toContain(">Home</h1>");
    expect(markup).toContain('class="brand" href="/home"');
    expect(markup).toContain('href="/library"');
    expect(markup).toContain('href="/sessions"');
    expect(markup).not.toContain("Your checkpoint sets");
    expect(markup).not.toContain("Loading your workspace");
    expect(markup).not.toContain('href="/create/presentation"');
    expect(markup).not.toContain('href="/surveys/new"');
  });
});
