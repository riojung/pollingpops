import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { withEnglishLocale } from "../../../../test-utils/english-locale";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "presentation-1" }),
  usePathname: () => "/presentation/presentation-1/host",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import { PresentationSessionCreationControls } from "./page";

function renderCreationControls(liveCreationAvailable: boolean, unavailableReason?: unknown) {
  return renderToStaticMarkup(
    withEnglishLocale(
      <PresentationSessionCreationControls
        busy={false}
        currentVersionId="presentation-version-1"
        error=""
        liveCreationAvailable={liveCreationAvailable}
        unavailableReason={unavailableReason}
        onStart={vi.fn()}
      />,
    ),
  );
}

describe("Presentation host live-session creation controls", () => {
  it.each([
    [
      "rollout_unavailable",
      "New live Presentation sessions are unavailable under this deployment’s rollout settings.",
    ],
    [
      "operator_policy",
      "The deployment’s feature policy does not allow this live Presentation launch.",
    ],
    ["future_reason", "Starting new live Presentation sessions is paused for this workspace."],
    [undefined, "Starting new live Presentation sessions is paused for this workspace."],
  ])("disables Start and explains why launch is unavailable for %s", (reason, notice) => {
    const markup = renderCreationControls(false, reason);

    expect(markup).toContain(notice);
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Start live session<\/button>/);
    expect(markup).toContain('href="/sessions"');
  });

  it("allows Start when realtime creation is available and content is published", () => {
    const markup = renderCreationControls(true, "operator_policy");

    expect(markup).not.toContain('role="status"');
    expect(markup).toMatch(/<button(?![^>]*disabled)[^>]*>Start live session<\/button>/);
  });
});
