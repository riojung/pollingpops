import { describe, expect, it } from "vitest";
import { LibraryDiscovery } from "../library-discovery/library-discovery";
import { SharedLibrary } from "./shared-library";

describe("shared Library route", () => {
  it.each(["organization", "shared", "managed"] as const)(
    "defaults %s to all content server discovery",
    (scope) => {
      const element = SharedLibrary({ scope });
      expect(element.type).toBe(LibraryDiscovery);
      expect(element.props).toEqual({ scope, type: "all" });
    },
  );
  it("retains explicit typed share routes and their authoritative actions", () => {
    expect(SharedLibrary({ scope: "shared", type: "surveys" }).props).toEqual({
      scope: "shared",
      type: "surveys",
    });
  });
});
