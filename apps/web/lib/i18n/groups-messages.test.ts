import { supportedLocales } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { groupsEnglishMessages, groupsMessages } from "./groups-messages";

describe("Groups route translations", () => {
  it.each(supportedLocales)(
    "provides all discovery, membership, lifecycle and scope explanations in %s",
    (locale) => {
      const copy = groupsMessages(locale);
      expect(Object.keys(copy)).toEqual(Object.keys(groupsEnglishMessages));
      for (const key of Object.keys(groupsEnglishMessages) as Array<
        keyof typeof groupsEnglishMessages
      >) {
        expect(copy[key]?.trim(), `${locale}:${key}`).toBeTruthy();
        expect(copy[key]?.match(/\{\w+\}/g) ?? []).toEqual(
          groupsEnglishMessages[key].match(/\{\w+\}/g) ?? [],
        );
      }
      if (locale !== "en-CA") {
        for (const key of [
          "description",
          "creationHelp",
          "collectionHelp",
          "lastOwner",
          "addMemberHelp",
          "archivedHelp",
        ] as const)
          expect(copy[key]).not.toBe(groupsEnglishMessages[key]);
      }
    },
  );
});
