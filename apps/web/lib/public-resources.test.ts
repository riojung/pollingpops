import { describe, expect, it } from "vitest";
import { getPublicResource, publicResources } from "./public-resources";

describe("public resource guidance", () => {
  it("provides substantive original guides for the full public journey", () => {
    expect(new Set(publicResources.map((resource) => resource.slug)).size).toBe(
      publicResources.length,
    );
    for (const slug of [
      "getting-started",
      "joining-a-round",
      "rechecks-and-follow-up",
      "understanding-reports",
      "feature-availability",
      "data-and-access-controls",
    ]) {
      const resource = getPublicResource(slug)!;
      expect(resource.sections.length).toBeGreaterThanOrEqual(3);
      expect(
        resource.sections
          .flatMap((section) => section.paragraphs)
          .join(" ")
          .split(/\s+/u).length,
      ).toBeGreaterThan(220);
      expect(
        resource.links.every((link) => link.href.startsWith("/") && !link.href.startsWith("//")),
      ).toBe(true);
    }
    expect(getPublicResource("not-a-guide")).toBeUndefined();
  });

  it("keeps privacy and interpretation limits explicit at the relevant decision", () => {
    expect(JSON.stringify(getPublicResource("understanding-reports"))).toContain(
      "five finalized answers",
    );
    expect(JSON.stringify(getPublicResource("rechecks-and-follow-up"))).toContain(
      "does not establish long-term learning",
    );
    expect(JSON.stringify(getPublicResource("joining-a-round"))).toContain(
      "does not hide your session alias",
    );
    expect(JSON.stringify(getPublicResource("feature-availability"))).toContain(
      "Conditional branching authoring and conditional results are not available",
    );
    expect(JSON.stringify(getPublicResource("data-and-access-controls"))).toContain(
      "cannot recall a previously downloaded file",
    );
  });
});
