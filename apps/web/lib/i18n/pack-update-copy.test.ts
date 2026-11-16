import { supportedLocales } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { packUpdateCopy, packUpdateCopyKeys, packUpdateFeedback } from "./pack-update-copy";

describe("Pack update display copy", () => {
  it.each(supportedLocales)("covers labels and interpolation in %s", (locale) => {
    const copy = packUpdateCopy(locale);
    for (const key of packUpdateCopyKeys) {
      expect(copy(key).trim(), key).not.toBe("");
      expect(
        copy(key)
          .match(/\{\w+\}/g)
          ?.sort() ?? [],
        key,
      ).toEqual(key.match(/\{\w+\}/g)?.sort() ?? []);
    }
    expect(
      copy(
        "Compared baseline version {baseline} with published version {latest} at {artifact} revision {revision}.",
        { baseline: 1, latest: 2, artifact: "AUTHORED 原文", revision: 7 },
      ),
    ).toContain("AUTHORED 原文");
    if (locale !== "en-CA") expect(copy("Choose explicitly")).not.toBe("Choose explicitly");
  });
  it("keeps default English and translates only exact system feedback", () => {
    expect(packUpdateCopy()("Apply reviewed Pack update")).toBe("Apply reviewed Pack update");
    const raw = "Private author diagnostic — Review latest Pack version [source-id]";
    expect(packUpdateFeedback("ko-KR", raw)).toEqual({ text: raw, lang: "en-CA" });
    expect(
      packUpdateFeedback("de-DE", "The local draft changed during review. Review the Pack again.")
        .lang,
    ).toBe("de-DE");
    expect(
      packUpdateFeedback("de-DE", "The local draft changed during review. Review the Pack again. "),
    ).toEqual({
      text: "The local draft changed during review. Review the Pack again. ",
      lang: "en-CA",
    });
  });
  it.each(supportedLocales)(
    "attributes callback guards and exact success announcements in %s",
    (locale) => {
      for (const artifact of ["Round", "Presentation"] as const) {
        const guard = `Finish saving or reload this ${artifact} before reviewing a Pack update.`;
        expect(packUpdateFeedback(locale, guard).lang).toBe(locale);
        const success = `Pack update saved as one draft revision. Published ${artifact === "Round" ? "Rounds" : "Presentations"} and the original inserted baseline are unchanged.`;
        expect(packUpdateFeedback(locale, success).lang).toBe(locale);
        expect(packUpdateFeedback(locale, success).text).not.toContain("{artifacts}");
      }
    },
  );
  it("uses the displayed artifact in link repair instructions without rewriting unknown diagnostics", () => {
    const raw =
      "Choose the latest published diagnostic too, or repair its recheck link in the Round and review again. Keeping the unlinked local diagnostic would orphan the restored recheck.";
    const display = packUpdateFeedback("ko-KR", raw, "Presentation");
    expect(display.lang).toBe("ko-KR");
    expect(display.text).toContain("프레젠테이션");
    expect(display.text).not.toContain("Round");
    expect(packUpdateFeedback("ko-KR", `${raw} source=private`, "Presentation")).toEqual({
      text: `${raw} source=private`,
      lang: "en-CA",
    });
  });
});

describe("Pack update feedback allowlist", () => {
  it.each([
    "Description",
    "Review latest Pack version",
    "Choose explicitly",
    "Pack title",
    "Saving or reviewing the {artifact} draft…",
  ])("retains unknown diagnostics even when they equal the UI label %s", (message) => {
    expect(packUpdateFeedback("ko-KR", message)).toEqual({ text: message, lang: "en-CA" });
    expect(packUpdateFeedback("de-DE", `${message} request=private`)).toEqual({
      text: `${message} request=private`,
      lang: "en-CA",
    });
  });
});
