import { supportedLocales } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { sidebarMessages } from "./sidebar-messages";

describe("workspace sidebar localization", () => {
  it("provides collapse, expansion and management names in every supported locale", () => {
    const english = sidebarMessages("en-CA");
    for (const locale of supportedLocales) {
      const messages = sidebarMessages(locale);
      expect(Object.keys(messages)).toEqual(Object.keys(english));
      for (const value of Object.values(messages)) expect(value.trim()).not.toBe("");
      if (locale !== "en-CA") {
        expect(messages["workspace.sidebar.collapse"]).not.toBe(
          english["workspace.sidebar.collapse"],
        );
        expect(messages["workspace.sidebar.expand"]).not.toBe(english["workspace.sidebar.expand"]);
      }
    }
  });
});
