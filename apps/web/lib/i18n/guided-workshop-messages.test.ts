import { supportedLocales, type SupportedLocale } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { guidedWorkshopCopy } from "./guided-workshop-messages";

const expectedKeys = [
  "participantWorkspace",
  "participantPanel",
  "openParticipantPanel",
  "closeParticipantPanel",
  "sharedCanvas",
  "noCanvas",
  "navigation",
  "zoomIn",
  "zoomOut",
  "resetZoom",
  "fitSelection",
  "focusMode",
  "exitFocusMode",
  "panHelp",
  "selectObject",
  "frame",
  "object",
  "votingNeedsApproved",
  "reviewBeforeVoting",
  "reopenCollection",
  "reopenTitle",
  "reopenDescription",
  "reopenWindow",
  "oneDay",
  "sevenDays",
  "fourteenDays",
  "thirtyDays",
  "confirmReopen",
  "reopening",
  "reopenError",
  "votingHistory",
  "roundLabel",
  "closedAt",
  "ballotCount",
  "ballotCountOne",
  "votingResults",
  "emptyPreviousRounds",
  "resultsHidden",
  "approvalChanged",
  "reopenRetention",
  "roundLimit",
  "voteCount",
  "voteCountOne",
] as const;

describe("guided workshop localization", () => {
  it.each(supportedLocales)(
    "provides complete controls and preserves placeholders in %s",
    (locale) => {
      const english = guidedWorkshopCopy("en-CA");
      const copy = guidedWorkshopCopy(locale);
      expect(Object.keys(copy)).toHaveLength(43);
      expect(Object.keys(copy)).toEqual(expectedKeys);
      for (const key of expectedKeys) {
        expect(copy[key].trim(), key).toBeTruthy();
        expect(copy[key].match(/\{\w+\}/g) ?? [], key).toEqual(
          english[key].match(/\{\w+\}/g) ?? [],
        );
        // French uses the same singular and plural vote labels as English.
        if (locale !== "en-CA" && key !== "voteCount" && key !== "voteCountOne")
          expect(copy[key], key).not.toBe(english[key]);
      }
      expect(copy.selectObject.match(/\{\w+\}/g)).toEqual(["{object}"]);
      expect(copy.roundLabel.match(/\{\w+\}/g)).toEqual(["{round}"]);
      expect(copy.closedAt.match(/\{\w+\}/g)).toEqual(["{date}"]);
      expect(copy.ballotCount.match(/\{\w+\}/g)).toEqual(["{count}"]);
      expect(copy.ballotCountOne.match(/\{\w+\}/g)).toEqual(["{count}"]);
      expect(copy.voteCount.match(/\{\w+\}/g)).toEqual(["{count}"]);
      expect(copy.voteCountOne.match(/\{\w+\}/g)).toEqual(["{count}"]);
      expect(copy.openParticipantPanel).not.toBe(copy.closeParticipantPanel);
      expect(copy.focusMode).not.toBe(copy.exitFocusMode);
      expect(copy.zoomIn).not.toBe(copy.zoomOut);
      expect(copy.oneDay).not.toBe(copy.sevenDays);
    },
  );

  it("keeps reopening and approval requirements explicit", () => {
    const copy = guidedWorkshopCopy("en-CA");
    expect(copy.votingNeedsApproved).toBe(
      "Collect and approve at least one idea before starting voting.",
    );
    expect(copy.reopenDescription).toBe(
      "Keep existing ideas and previous results. Participants can submit a fresh ballot in the next voting round.",
    );
    expect(copy.reopenRetention).toBe("Reopening does not extend the data retention period.");
    expect(copy.votingHistory).toBe("Previous workshop rounds");
    expect(copy.roundLimit).toBe(
      "This workshop has reached its round limit. Create a new workshop to continue.",
    );
  });

  it("falls back to English for an unsupported locale", () => {
    expect(guidedWorkshopCopy("xx-XX" as SupportedLocale)).toEqual(guidedWorkshopCopy("en-CA"));
  });
});
