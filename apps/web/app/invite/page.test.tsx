import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({
  cursor: 0,
  states: [] as unknown[],
  api: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof ReactModule>()),
  useEffect: () => undefined,
  useState: () => {
    const index = fixtures.cursor++;
    return [
      fixtures.states[index],
      (value: unknown) => {
        fixtures.states[index] = value;
      },
    ];
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: fixtures.replace }),
}));

vi.mock("../../components/locale-provider", () => ({
  useLocale: () => ({ t: (key: string) => key }),
}));

vi.mock("../../lib/api", () => ({
  apiFetch: fixtures.api,
  humanError: (error: Error) => error.message,
}));

import WorkspaceInvitationPage from "./page";

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}

function invitationForm() {
  fixtures.cursor = 0;
  const form = elements(WorkspaceInvitationPage()).find((element) => element.type === "form");
  if (!form) throw new Error("Missing invitation form");
  return form;
}

describe("workspace invitation account access", () => {
  beforeEach(() => {
    fixtures.states = ["invitation-token", true, false, ""];
    vi.clearAllMocks();
  });

  it.each([
    {
      requiresSignIn: true,
      redirectTo:
        "http://localhost:8080/signin?verified=1&returnTo=%2Fdashboard%3Finvitation%3Daccepted",
    },
    {
      requiresSignIn: false,
      redirectTo: "http://localhost:8080/dashboard?invitation=accepted",
    },
  ])("follows the server destination when requiresSignIn is $requiresSignIn", async (result) => {
    fixtures.api.mockResolvedValueOnce(result);
    const form = invitationForm();
    (form.props.onSubmit as (event: { preventDefault: () => void }) => void)({
      preventDefault: vi.fn(),
    });
    await Promise.resolve();
    expect(fixtures.api).toHaveBeenCalledExactlyOnceWith("/v1/invitations/accept", {
      method: "POST",
      body: JSON.stringify({ token: "invitation-token", acceptPolicies: true }),
    });
    expect(fixtures.replace).toHaveBeenCalledExactlyOnceWith(result.redirectTo);
  });
});
