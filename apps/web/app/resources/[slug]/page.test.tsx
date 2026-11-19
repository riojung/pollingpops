import { describe, expect, it, vi } from "vitest";
import ResourcePage, { generateMetadata, generateStaticParams } from "./page";
import { publicResources } from "../../../lib/public-resources";
import { PublicResourcePage } from "../../../components/public-resources-page";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

describe("public guide routing", () => {
  it("builds only the finite resource catalog and provides matching metadata", async () => {
    expect(generateStaticParams()).toEqual(
      publicResources.map((resource) => ({ slug: resource.slug })),
    );
    for (const resource of publicResources) {
      const params = Promise.resolve({ slug: resource.slug });
      expect((await ResourcePage({ params })).type).toBe(PublicResourcePage);
      expect(await generateMetadata({ params })).toEqual({
        title: resource.title,
        description: resource.summary,
        alternates: { canonical: `/resources/${resource.slug}` },
      });
    }
  });

  it("returns not found for an unrecognized resource", async () => {
    await expect(ResourcePage({ params: Promise.resolve({ slug: "unknown" }) })).rejects.toThrow(
      "NOT_FOUND",
    );
  });
});
