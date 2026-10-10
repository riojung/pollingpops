import { supportedLocales } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import {
  englishMessages,
  loadMessages,
  localeDomainsForPath,
  translate,
  type MessageKey,
} from "./catalog";
import { accountEnglishMessages, loadAccountMessages } from "./domains/account";
import {
  deliveryAuthoringEnglishMessages,
  loadDeliveryAuthoringMessages,
} from "./domains/delivery-authoring";
import { loadWorkspacePageMessages, workspacePageEnglishMessages } from "./domains/workspace-pages";
import { loadReportRoundMessages, reportRoundEnglishMessages } from "./domains/report-round";
import { liveDeliveryEnglishMessages, loadLiveDeliveryMessages } from "./domains/live-delivery";
import germanMessages from "./messages/de-DE";
import { englishMessages as coreEnglishMessages } from "./messages/en-CA";
import spanishMessages from "./messages/es-ES";
import frenchMessages from "./messages/fr-FR";
import italianMessages from "./messages/it-IT";
import japaneseMessages from "./messages/ja-JP";
import koreanMessages from "./messages/ko-KR";
import portugueseMessages from "./messages/pt-PT";
import simplifiedChineseMessages from "./messages/zh-CN";
import traditionalChineseMessages from "./messages/zh-TW";

const translatedCatalogs = {
  "fr-FR": frenchMessages,
  "de-DE": germanMessages,
  "es-ES": spanishMessages,
  "it-IT": italianMessages,
  "pt-PT": portugueseMessages,
  "ja-JP": japaneseMessages,
  "ko-KR": koreanMessages,
  "zh-CN": simplifiedChineseMessages,
  "zh-TW": traditionalChineseMessages,
} as const;

function placeholders(message: string) {
  return [...message.matchAll(/\{([a-zA-Z][\w]*)\}/g)].map((match) => match[1]).sort();
}

describe("localized message catalogs", () => {
  it("loads a complete non-empty catalog for every public locale", async () => {
    const completeEnglish = await loadMessages("en-CA");
    const sourceKeys = Object.keys(completeEnglish).sort();
    for (const locale of supportedLocales) {
      if (locale !== "en-CA") {
        expect(Object.keys(translatedCatalogs[locale]).sort()).toEqual(
          Object.keys(coreEnglishMessages).sort(),
        );
      }
      const messages = await loadMessages(locale);
      expect(Object.keys(messages).sort()).toEqual(sourceKeys);
      for (const key of sourceKeys) {
        const messageKey = key as MessageKey;
        expect(messages[messageKey]?.trim()).not.toBe("");
        expect(placeholders(messages[messageKey] ?? "")).toEqual(
          placeholders(completeEnglish[messageKey] ?? ""),
        );
      }
    }
  });

  it("loads only the domains required by the active route", async () => {
    expect(localeDomainsForPath("/account")).toEqual(["account"]);
    expect(localeDomainsForPath("/surveys/rooms/example")).toEqual(["live-delivery"]);
    expect(localeDomainsForPath("/surveys/example")).toEqual([]);
    expect(localeDomainsForPath("/home")).toEqual(["workspace-pages"]);
    expect(localeDomainsForPath("/quiz/example")).toEqual([
      "delivery-authoring",
      "report-round",
      "live-delivery",
    ]);
    expect(localeDomainsForPath("/quiz/example/preview")).toEqual([
      "delivery-authoring",
      "report-round",
      "live-delivery",
    ]);
    expect(localeDomainsForPath("/quiz/example/rehearse")).toEqual([
      "delivery-authoring",
      "report-round",
      "live-delivery",
    ]);
    expect(localeDomainsForPath("/quiz/example/assign")).toEqual([
      "account",
      "delivery-authoring",
      "report-round",
    ]);
    expect(localeDomainsForPath("/quiz/example/unknown")).toEqual([]);
    expect(localeDomainsForPath("/create")).toEqual(["delivery-authoring", "report-round"]);
    expect(localeDomainsForPath("/create/presentation")).toEqual(["delivery-authoring"]);
    expect(localeDomainsForPath("/recovery-packs")).toEqual(["delivery-authoring"]);
    expect(localeDomainsForPath("/recovery-packs/")).toEqual(["delivery-authoring"]);
    expect(localeDomainsForPath("/dashboard")).toEqual([
      "workspace-pages",
      "delivery-authoring",
      "report-round",
    ]);
    expect(localeDomainsForPath("/join")).toEqual(["delivery-authoring", "live-delivery"]);
    expect(localeDomainsForPath("/report/example")).toEqual(["report-round", "live-delivery"]);
    expect(localeDomainsForPath("/host/example")).toEqual(["live-delivery"]);
    expect(localeDomainsForPath("/presentation-session/example/report")).toEqual(["live-delivery"]);
    expect(localeDomainsForPath("/presentation-session/example/host")).toEqual(["live-delivery"]);
    expect(localeDomainsForPath("/presentation-session/example/play")).toEqual(["live-delivery"]);
    expect(localeDomainsForPath("/presentation/example")).toEqual(["delivery-authoring"]);
    expect(localeDomainsForPath("/presentation/example/host")).toEqual([
      "delivery-authoring",
      "live-delivery",
    ]);
    expect(localeDomainsForPath("/presentation/join")).toEqual([
      "delivery-authoring",
      "live-delivery",
    ]);
    expect(localeDomainsForPath("/practice/example")).toEqual(["report-round"]);
    expect(localeDomainsForPath("/followup/example")).toEqual(["report-round"]);
    expect(localeDomainsForPath("/templates")).toEqual([]);
    expect(localeDomainsForPath("/privacy")).toEqual([]);
    expect(localeDomainsForPath("/terms")).toEqual([]);
    expect(localeDomainsForPath("/pricing")).toEqual([]);
    expect(localeDomainsForPath("/status")).toEqual([]);
    expect(localeDomainsForPath("/lti/link")).toEqual([]);
    expect(localeDomainsForPath("/lti/select")).toEqual([]);

    const accountMessages = await loadMessages("en-CA", localeDomainsForPath("/account"));
    expect(accountMessages["account.workspace.title"]).toBe("Active workspace");
    expect(accountMessages["live.audience.chat"]).toBeUndefined();
    expect(accountMessages["reportRound.assign.title"]).toBeUndefined();
  });

  it("keeps shared site chrome in core while loading exact Round-route domains", async () => {
    expect(localeDomainsForPath("/quiz/round-1?mode=edit")).toEqual([
      "delivery-authoring",
      "report-round",
      "live-delivery",
    ]);
    expect(localeDomainsForPath("/quiz/round-1/preview/")).toEqual([
      "delivery-authoring",
      "report-round",
      "live-delivery",
    ]);
    expect(localeDomainsForPath("/quiz/round-1/rehearse?source=editor")).toEqual([
      "delivery-authoring",
      "report-round",
      "live-delivery",
    ]);
    expect(localeDomainsForPath("/quiz/round-1/assign?source=library")).toEqual([
      "account",
      "delivery-authoring",
      "report-round",
    ]);

    const staticPageMessages = await loadMessages("fr-FR", localeDomainsForPath("/privacy"));
    expect(staticPageMessages["delivery.site.privacy"]).toBe("Confidentialité");
    expect(staticPageMessages["delivery.landing.title"]).toBeUndefined();

    const assignmentMessages = await loadMessages(
      "en-CA",
      localeDomainsForPath("/quiz/round-1/assign"),
    );
    expect(assignmentMessages["reportRound.assign.title"]).toBe("Assign practice");
    expect(assignmentMessages["account.subscription.comparePlans"]).toBe("Compare plans");
    expect(assignmentMessages["live.audience.chat"]).toBeUndefined();
  });

  it("keeps every lazy domain catalog complete with placeholder parity", async () => {
    const domains = [
      [accountEnglishMessages, loadAccountMessages],
      [workspacePageEnglishMessages, loadWorkspacePageMessages],
      [deliveryAuthoringEnglishMessages, loadDeliveryAuthoringMessages],
      [reportRoundEnglishMessages, loadReportRoundMessages],
      [liveDeliveryEnglishMessages, loadLiveDeliveryMessages],
    ] as const;

    for (const [source, loader] of domains) {
      const sourceKeys = Object.keys(source).sort();
      for (const locale of supportedLocales) {
        const translated = await loader(locale);
        const sourceRecord = source as Record<string, string>;
        const translatedRecord = translated as Record<string, string>;
        expect(Object.keys(translated).sort()).toEqual(sourceKeys);
        for (const key of sourceKeys) {
          expect(translatedRecord[key]?.trim()).not.toBe("");
          expect(placeholders(translatedRecord[key] ?? "")).toEqual(
            placeholders(sourceRecord[key] ?? ""),
          );
        }
      }
    }
  });

  it("interpolates named values without exposing message identifiers", () => {
    expect(translate(englishMessages, "workspace.identity", { role: "Editor", plan: "Team" })).toBe(
      "Editor · Team plan",
    );
    expect(translate(englishMessages, "home.welcome", { name: "Minji" })).toBe(
      "Welcome back, Minji",
    );
  });
});
