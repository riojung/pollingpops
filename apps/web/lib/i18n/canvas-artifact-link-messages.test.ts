import { describe, expect, it } from "vitest";
import { supportedLocales } from "@openround/contracts";
import {
  canvasArtifactLinkCopy,
  canvasArtifactLinkMessages,
} from "./canvas-artifact-link-messages";
describe("creator canvas snapshot link localization", () => {
  it.each(supportedLocales)("provides all visible labels in %s", (locale) => {
    const messages = canvasArtifactLinkMessages(locale);
    expect(Object.keys(messages)).toEqual(Object.keys(canvasArtifactLinkMessages("en-CA")));
    expect(Object.keys(messages)).toHaveLength(26);
    for (const value of Object.values(canvasArtifactLinkCopy(locale)))
      expect(typeof value === "string" && value.trim().length > 0).toBe(true);
    expect(Object.keys(messages).every((key) => key.startsWith("canvas.artifactLinks."))).toBe(
      true,
    );
  });
});
