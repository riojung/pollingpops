import { supportedLocales, type SupportedLocale } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { participantCanvasCopy } from "./participant-canvas-messages";

const expectedKeys = [
  "title",
  "privateDraft",
  "privateHint",
  "startIdea",
  "continueIdea",
  "backToWorkshop",
  "ideaTitle",
  "ideaTitleHint",
  "titleRequired",
  "submitIdea",
  "submitting",
  "canvasLimit",
  "objectLimit",
  "invalidCanvas",
  "readOnlyContext",
  "tools",
  "selection",
  "arrange",
  "addImage",
  "addLink",
  "uploadFailed",
  "uploadsUnavailable",
  "linkInvalid",
  "previewTitle",
  "openPreview",
  "canvasSummary",
  "draftKept",
  "discardDraft",
  "confirmDiscard",
  "sourceContext",
  "emptyCanvasHelp",
  "canvasFrozen",
  "ownObjectsOnly",
  "addToCanvas",
  "saveImage",
  "saveLink",
  "sharedLimit",
] as const;

describe("participant canvas localization", () => {
  it.each(supportedLocales)("provides complete participant copy in %s", (locale) => {
    const english = participantCanvasCopy("en-CA");
    const copy = participantCanvasCopy(locale);
    expect(Object.keys(copy)).toEqual(expectedKeys);
    for (const key of expectedKeys) {
      expect(copy[key].trim(), key).toBeTruthy();
      expect(copy[key].match(/\{\w+\}/g) ?? [], key).toEqual(english[key].match(/\{\w+\}/g) ?? []);
      if (locale !== "en-CA") expect(copy[key], key).not.toBe(english[key]);
    }
    expect(copy.objectLimit.match(/\{\w+\}/g)).toEqual(["{count}"]);
    expect(copy.canvasSummary.match(/\{\w+\}/g)).toEqual(["{count}"]);
    expect(copy.startIdea).not.toBe(copy.continueIdea);
    expect(copy.submitIdea).not.toBe(copy.submitting);
    expect(copy.addImage).not.toBe(copy.addLink);
    expect(copy.saveImage).not.toBe(copy.saveLink);
  });

  it("explains private composition, explicit submission, and shared content boundaries", () => {
    const copy = participantCanvasCopy("en-CA");
    expect(copy.title).toBe("Your idea canvas");
    expect(copy.privateDraft).toBe("Private draft");
    expect(copy.privateHint).toBe("Only you can see this draft. Submit it for review when ready.");
    expect(copy.ideaTitleHint).toBe("Give your composition a short title.");
    expect(copy.titleRequired).toContain("before submitting");
    expect(copy.readOnlyContext).toBe("Workshop content is view only.");
    expect(copy.ownObjectsOnly).toBe("Only your draft objects can be edited.");
    expect(copy.canvasFrozen).toContain("this round");
    expect(copy.uploadFailed).toContain("private draft is kept");
    expect(copy.confirmDiscard).toContain("cannot be undone");
    expect(copy.linkInvalid).toBe("Enter an HTTP or HTTPS URL without credentials.");
    expect(copy.sharedLimit).toBe(
      "This workshop has reached its canvas capacity. Simplify your composition or ask the facilitator to make room.",
    );
  });

  it("falls back to English for an unsupported locale", () => {
    expect(participantCanvasCopy("xx-XX" as SupportedLocale)).toEqual(
      participantCanvasCopy("en-CA"),
    );
  });
});
