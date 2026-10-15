import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { productFeatureCatalog } from "@openround/contracts";
import { allowedViews, apiView, initialView } from "../app/console-views";
import FeaturesPanel from "../app/features-panel";
import OverviewPanel from "../app/overview-panel";

describe("operator area access", () => {
  it("maps the overview and staff aliases to their retained operations endpoint", () => {
    expect(apiView("overview")).toBe("operations");
    expect(apiView("staff")).toBe("operations");
    expect(allowedViews(["operations.read", "features.read"])).toEqual([
      "overview",
      "features",
      "operations",
    ]);
    expect(allowedViews(["organizations.read", "support.read"])).toEqual([
      "organizations",
      "support",
    ]);
  });

  it("opens overview by default while keeping restricted-link fallback and deep links", () => {
    const capabilities = ["organizations.read", "operations.read", "features.read"];
    expect(initialView(capabilities)).toBe("overview");
    expect(initialView(capabilities, "billing")).toBe("organizations");
    expect(initialView(capabilities, "features")).toBe("features");
    expect(initialView([])).toBeUndefined();
  });

  it("requires operations read access before exposing Staff through its shared endpoint", () => {
    expect(allowedViews(["organizations.read", "billing.read", "operators.write"])).not.toContain(
      "staff",
    );
    expect(allowedViews(["organizations.read", "support.read", "operators.write"])).not.toContain(
      "staff",
    );
    expect(allowedViews(["operations.read", "operators.write"])).toContain("staff");
    expect(initialView(["organizations.read", "operators.write"], "staff")).toBe("organizations");
  });
});

describe("feature policy presentation", () => {
  it("shows inherited defaults and plan assignments without creating an explicit policy", () => {
    const markup = renderToStaticMarkup(
      <FeaturesPanel
        data={{
          policy: { revision: 0, features: {}, updatedAt: null },
          catalog: productFeatureCatalog,
        }}
        writable
        busy={false}
        onReview={vi.fn()}
      />,
    );
    expect(markup).toContain("Inherit deployment");
    expect(markup).toContain("Free plan includes Session summaries");
    expect(markup).toContain("Policy is up to date");
    expect(markup).toContain("Review changes");
    expect(markup).toContain('role="region"');
    expect(markup).toContain('aria-label="Feature availability and plan assignments"');
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain("Scroll horizontally to see availability and plans");
    expect(markup).toContain("Dependencies and required provider configuration still apply");
  });

  it("keeps read-only policy visible and flags explicitly excluded dependency plans", () => {
    const markup = renderToStaticMarkup(
      <FeaturesPanel
        data={{
          policy: {
            revision: 4,
            features: {
              workspaceShell: { enabled: true, plans: ["free"] },
              uxBeta: { enabled: false, plans: ["free"] },
            },
            updatedAt: null,
          },
          catalog: productFeatureCatalog,
        }}
        writable={false}
        busy={false}
        onReview={vi.fn()}
      />,
    );
    expect(markup).not.toContain("Review changes");
    expect(markup).not.toContain("<select");
    expect(markup).toContain("Dependency policy excludes selected plans: Professional workspace");
    expect(markup).toContain("Revision 4");
    expect(markup).toContain("Your operator role can review this policy");
  });
});

describe("operational overview", () => {
  it("uses current queue facts and hides service mutations from read-only operators", () => {
    const markup = renderToStaticMarkup(
      <OverviewPanel
        data={{
          activeRooms: [{ roomId: "a" }],
          productQueues: [{ pending: 7, failed: 2 }],
          workerControls: [{ id: "reports", paused: true }],
        }}
        writable={false}
        onReview={vi.fn()}
        onOperations={vi.fn()}
      />,
    );
    expect(markup).toContain("Queued product jobs");
    expect(markup).toContain(">7</strong>");
    expect(markup).toContain(">2</strong>");
    expect(markup).toContain("1 paused");
    expect(markup).not.toContain('aria-label="Resume Reports"');
    expect(markup).toContain("Operational guidance");
  });
});
