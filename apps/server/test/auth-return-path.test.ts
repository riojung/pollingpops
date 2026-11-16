import { describe, expect, it } from "vitest";
import { identityOnlyAuthReturnPath } from "../src/auth-return-path.js";

const path = "/presentation-review/a2f6c043-71ca-4e58-8b9b-607f86098a91";

describe("identity-only review sign-in return path", () => {
  it("allows only the clean canonical review route", () => {
    expect(identityOnlyAuthReturnPath(path)).toBe(path);
  });

  it.each([
    undefined,
    null,
    "/library",
    "/organization?setup=team",
    "https://evil.example/presentation-review/a2f6c043-71ca-4e58-8b9b-607f86098a91",
    `/${path}`,
    path.toUpperCase(),
    path.replace("a2f6c043", "A2F6C043"),
    `${path}/`,
    `${path}?token=synthetic-review-credential`,
    `${path}?tab=comments`,
    `${path}#token=synthetic-review-credential`,
    `${path}/../another-page`,
    path.replace("/presentation-review/", "/presentation-review%2f"),
    path.replace("/presentation-review/", "/presentation-review\\"),
    "/presentation-review/not-a-uuid",
    "/presentation-review/a2f6c043-71ca-0e58-0b9b-607f86098a91",
    `${path}\n`,
  ])("keeps the identity-only fallback for %s", (value) => {
    expect(identityOnlyAuthReturnPath(value)).toBe("/organization");
  });
});
