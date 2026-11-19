import { supportedLocales } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { publicSiteShellCopy, publicSiteShellCopyKeys } from "./public-site-shell-copy";

describe("public site shell translations", () => {
  it.each(supportedLocales)("supplies the navigation, join form and footer in %s", (locale) => {
    const copy = publicSiteShellCopy(locale);
    expect(Object.keys(copy)).toEqual([...publicSiteShellCopyKeys]);
    for (const key of publicSiteShellCopyKeys) expect(copy[key].trim(), key).not.toBe("");
    if (locale !== "en-CA") {
      expect(copy.joinHelp).not.toBe(publicSiteShellCopy("en-CA").joinHelp);
      expect(copy.openWorkspace).not.toBe(publicSiteShellCopy("en-CA").openWorkspace);
      expect(copy.communityNote).not.toBe(publicSiteShellCopy("en-CA").communityNote);
    }
  });
});
