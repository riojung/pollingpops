import { describe, expect, it } from "vitest";
import { supportedLocales } from "@openround/contracts";
import {
  deliveryAuthoringEnglishMessages,
  loadDeliveryAuthoringMessages,
} from "./delivery-authoring";

const criticalTranslatedKeys = [
  "delivery.landing.title",
  "delivery.auth.signInTitle",
  "delivery.auth.signInDescription",
  "delivery.auth.createAccount",
  "delivery.auth.sendVerification",
  "delivery.auth.sendPin",
  "delivery.auth.pinDescription",
  "delivery.auth.verified",
  "delivery.auth.verificationInstructions",
  "delivery.auth.invalidPin",
  "delivery.auth.pinRequesting",
  "delivery.auth.pinUncertain",
  "delivery.auth.pinThrottledExisting",
  "delivery.auth.pinThrottled",
  "delivery.auth.pinDeliveryFailed",
  "delivery.auth.pinNoChallenge",
  "delivery.join.title",
  "delivery.builder.readyToPreview",
  "delivery.presentationBuilder.emptyTitle",
] as const;

describe("delivery and authoring message catalogs", () => {
  it("keeps an explicit, non-empty value for every locale and English key", async () => {
    const englishKeys = Object.keys(deliveryAuthoringEnglishMessages).sort();

    for (const locale of supportedLocales) {
      const messages = await loadDeliveryAuthoringMessages(locale);
      expect(Object.keys(messages).sort(), locale).toEqual(englishKeys);
      expect(
        Object.values(messages).every((message) => message.trim().length > 0),
        locale,
      ).toBe(true);
    }
  });

  it("does not silently leave critical workflow copy in English", async () => {
    for (const locale of supportedLocales.filter((candidate) => candidate !== "en-CA")) {
      const messages = await loadDeliveryAuthoringMessages(locale);
      for (const key of criticalTranslatedKeys) {
        expect(messages[key], `${locale}:${key}`).not.toBe(deliveryAuthoringEnglishMessages[key]);
      }
    }
  });
});
