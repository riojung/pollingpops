import { supportedLocales } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { liveDeliveryEnglishMessages, loadLiveDeliveryMessages } from ".";

function placeholders(message: string) {
  return [...message.matchAll(/\{([a-zA-Z][\w]*)\}/g)].map((match) => match[1]).sort();
}

const definitelyLocalizedKeys = [
  "live.audience.noMessages",
  "live.audience.signal.got_it",
  "live.joinAccess.updateQr",
  "live.presentationHost.creationPaused",
  "live.presentationHost.description",
  "live.presenter.thankYou",
  "live.qna.status.pending",
  "live.roundPlay.complete",
  "live.roundSetup.description",
  "live.protection.toggle",
  "live.protection.required",
  "live.protection.invalid",
] as const;

const canonicalPresetNames = [
  "live.experience.preset.pops.name",
  "live.experience.preset.blueprint.name",
  "live.experience.preset.campus.name",
  "live.experience.preset.focus.name",
  "live.experience.preset.signal.name",
  "live.experience.preset.spark.name",
  "live.experience.preset.studio.name",
] as const;

describe("live delivery localization catalog", () => {
  it("provides translated password controls and errors in all ten locales", async () => {
    const keys = Object.keys(liveDeliveryEnglishMessages).filter((key) =>
      key.startsWith("live.protection."),
    );
    expect(keys).toHaveLength(11);
    for (const locale of supportedLocales) {
      const messages = await loadLiveDeliveryMessages(locale);
      for (const key of keys) expect(messages[key as keyof typeof messages].trim()).not.toBe("");
    }
  });
  it("keeps Companion foundation copy in the existing English fallback with exact placeholders", async () => {
    const keys = Object.keys(liveDeliveryEnglishMessages).filter(
      (key) =>
        key.startsWith("live.companion.quickCheck.") ||
        key.startsWith("live.companion.publishedQuestions.") ||
        key === "live.presentationReport.sessionOnlyQuickCheck",
    );
    expect(keys).toContain("live.companion.quickCheck.retryAcknowledgement");
    expect(keys).toContain("live.companion.publishedQuestions.retryAcknowledgement");
    for (const locale of supportedLocales) {
      const messages = await loadLiveDeliveryMessages(locale);
      for (const key of keys) {
        const messageKey = key as keyof typeof liveDeliveryEnglishMessages;
        expect(messages[messageKey], `${locale}: ${key}`).toBe(
          liveDeliveryEnglishMessages[messageKey],
        );
        expect(placeholders(messages[messageKey])).toEqual(
          placeholders(liveDeliveryEnglishMessages[messageKey]),
        );
      }
    }
  });

  it("keeps every locale complete with exact placeholder parity", async () => {
    const sourceKeys = Object.keys(liveDeliveryEnglishMessages).sort();

    for (const locale of supportedLocales) {
      const messages = await loadLiveDeliveryMessages(locale);
      expect(Object.keys(messages).sort()).toEqual(sourceKeys);

      for (const key of sourceKeys) {
        const messageKey = key as keyof typeof liveDeliveryEnglishMessages;
        expect(messages[messageKey].trim()).not.toBe("");
        expect(placeholders(messages[messageKey]), `${locale}: ${key}`).toEqual(
          placeholders(liveDeliveryEnglishMessages[messageKey]),
        );
      }
    }
  });

  it("contains no translation sentinel residue or corrupted placeholder suffixes", async () => {
    for (const locale of supportedLocales) {
      const messages = await loadLiveDeliveryMessages(locale);
      for (const [key, message] of Object.entries(messages)) {
        expect(message, `${locale}: ${key}`).not.toMatch(
          /(?:ORPH|TOKEN|TOKE)|9\d{6,}|\{[a-zA-Z][\w]*\}\d/,
        );
      }
    }
  });

  it("does not regress representative non-English controls to English", async () => {
    for (const locale of supportedLocales) {
      if (locale === "en-CA") continue;
      const messages = await loadLiveDeliveryMessages(locale);
      for (const key of definitelyLocalizedKeys) {
        expect(messages[key], `${locale}: ${key}`).not.toBe(liveDeliveryEnglishMessages[key]);
      }
    }
  });

  it("preserves repaired multi-placeholder translations", async () => {
    const french = await loadLiveDeliveryMessages("fr-FR");
    const portuguese = await loadLiveDeliveryMessages("pt-PT");
    const simplifiedChinese = await loadLiveDeliveryMessages("zh-CN");
    const traditionalChinese = await loadLiveDeliveryMessages("zh-TW");

    expect(french["live.audience.reactionAria"]).toBe("{reaction} : {count}");
    expect(portuguese["live.audience.moderationSummary"]).toContain("{moderated}");
    expect(simplifiedChinese["live.presentationSession.blockProgress"]).toBe(
      "第 {current} 个区块，共 {total} 个",
    );
    expect(traditionalChinese["live.presentationSession.blockProgress"]).toBe(
      "第 {current} 個區塊，共 {total} 個",
    );
  });

  it("keeps product preset names canonical in every locale", async () => {
    for (const locale of supportedLocales) {
      const messages = await loadLiveDeliveryMessages(locale);
      for (const key of canonicalPresetNames) {
        expect(messages[key], `${locale}: ${key}`).toBe(liveDeliveryEnglishMessages[key]);
      }
    }
  });

  it("preserves reviewed translations for high-risk machine-translation terms", async () => {
    const german = await loadLiveDeliveryMessages("de-DE");
    const japanese = await loadLiveDeliveryMessages("ja-JP");
    const korean = await loadLiveDeliveryMessages("ko-KR");
    const simplifiedChinese = await loadLiveDeliveryMessages("zh-CN");

    expect(german["live.host.command.resume"]).toBe("Fortsetzen");
    expect(japanese["live.host.command.resume"]).toBe("再開");
    expect(japanese["live.host.phase.paused"]).toBe("一時停止中");
    expect(korean["live.host.command.explain"]).toBe("설명 또는 보강");
    expect(korean["live.presentationPlay.submit"]).toBe("응답 제출");
    expect(korean["live.common.accuracy"]).toBe("정확도");
    expect(simplifiedChinese["live.qna.controls"]).toBe("问答控制");
  });
});
