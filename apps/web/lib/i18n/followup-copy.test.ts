import { supportedLocales } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { followupCopy, followupCopyKeys, localizeFollowupMessage } from "./followup-copy";

describe("secondary follow-up system copy", () => {
  it.each(supportedLocales)(
    "covers every phrase and preserves its interpolation contract in %s",
    (locale) => {
      const copy = followupCopy(locale);
      for (const key of followupCopyKeys) {
        expect(copy(key).trim()).not.toBe("");
        expect(
          copy(key)
            .match(/\{\w+\}/g)
            ?.sort() ?? [],
        ).toEqual(key.match(/\{\w+\}/g)?.sort() ?? []);
      }
      expect(copy("Question {current} of {total}", { current: 2, total: 4 })).not.toMatch(
        /\{\w+\}/,
      );
      if (locale !== "en-CA")
        expect(copy("Retry response acknowledgement")).not.toBe("Retry response acknowledgement");
    },
  );

  it("translates exact known access denials while retaining unknown service diagnostics verbatim", () => {
    expect(localizeFollowupMessage("ko-KR", "This follow-up has expired")).toMatchObject({
      text: "이 후속 학습은 만료되었습니다",
      language: "ko-KR",
      known: true,
    });
    const unknown = "This follow-up has expired: upstream incident abc-123";
    expect(localizeFollowupMessage("ko-KR", unknown)).toEqual({
      text: unknown,
      language: "en-CA",
      known: false,
    });
  });
});
