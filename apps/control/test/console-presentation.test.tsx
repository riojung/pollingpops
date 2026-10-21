import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { productFeatureCatalog } from "@openround/contracts";
import { allowedViews, apiView, initialView } from "../app/console-views";
import FeaturesPanel from "../app/features-panel";
import OverviewPanel from "../app/overview-panel";

afterEach(() => vi.unstubAllGlobals());

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
  it.each(["features", "plans"])(
    "shows inherited %s rows as deployment controlled without checked plan assignments",
    (tab) => {
      vi.stubGlobal("window", {
        location: { href: `https://control.example.test/?tab=${tab}` },
      });
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
      expect(markup).toContain("Implemented features");
      expect(markup).toContain("Deployment controlled");
      expect(markup).toContain("Choose Enabled to assign plans.");
      expect(markup).toContain("No feature overrides have been saved.");
      expect(markup).toContain("Workspace navigation is available by default for all plans");
      expect(markup).toContain(
        "Other inherited features use deployment flags and workspace allowlists",
      );
      expect(markup).not.toContain('type="checkbox"');
      expect(markup).not.toContain("Free plan includes Session summaries");
      if (tab === "plans") expect(markup).toContain('colSpan="3"');
      expect(markup).toContain("Policy is up to date");
      expect(markup).toContain("Review changes");
      expect(markup).toContain('role="region"');
      expect(markup).toContain('aria-label="Feature availability and plan assignments"');
      expect(markup).toContain('tabindex="0"');
      expect(markup).toContain("Scroll horizontally to see availability and plans");
      expect(markup).toContain("Dependencies and required provider configuration still apply");
    },
  );

  it("shows only the chosen plans checked for an explicitly enabled policy", () => {
    const markup = renderToStaticMarkup(
      <FeaturesPanel
        data={{
          policy: {
            revision: 1,
            features: { sessionSummaries: { enabled: true, plans: ["pro", "team"] } },
            updatedAt: null,
          },
          catalog: productFeatureCatalog.filter((feature) => feature.key === "sessionSummaries"),
        }}
        writable
        busy={false}
        onReview={vi.fn()}
      />,
    );
    const inputs = markup.match(/<input[^>]*type="checkbox"[^>]*>/g) ?? [];
    expect(inputs).toHaveLength(3);
    expect(
      inputs.find((input) => input.includes("Free plan includes Session summaries")),
    ).not.toContain("checked");
    for (const plan of ["Pro", "Team"])
      expect(
        inputs.find((input) => input.includes(`${plan} plan includes Session summaries`)),
      ).toContain('checked=""');
    for (const input of inputs) expect(input).not.toContain("disabled");
    expect(markup).not.toContain("Deployment controlled");
    expect(markup).not.toContain("No feature overrides have been saved.");
    expect(markup).not.toContain("Explicitly enabled in draft");
  });

  it("keeps read-only policy visible and flags explicitly excluded dependency plans", () => {
    const markup = renderToStaticMarkup(
      <FeaturesPanel
        data={{
          policy: {
            revision: 4,
            features: {
              builderV2: { enabled: true, plans: ["free"] },
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
