import { supportedLocales } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { customerAccountMessages } from "./customer-account-messages";
import { loadMessages, localeDomainsForPath } from "./catalog";

describe("customer account localization", () => {
  it("provides every customer setting and setup message with matching placeholders in all locales", () => {
    const english = customerAccountMessages("en-CA");
    for (const locale of supportedLocales) {
      const messages = customerAccountMessages(locale);
      expect(Object.keys(messages)).toEqual(Object.keys(english));
      for (const key of Object.keys(english) as Array<keyof typeof english>) {
        expect(messages[key].trim(), `${locale}:${key}`).not.toBe("");
        expect(messages[key].match(/\{\w+\}/g) ?? []).toEqual(english[key].match(/\{\w+\}/g) ?? []);
      }
      if (locale !== "en-CA")
        expect(messages["customer.section.security"]).not.toBe(
          english["customer.section.security"],
        );
    }
  });
  it("loads setup and personal/organization selection for both account and sign-in routes", async () => {
    for (const path of ["/account", "/account/setup", "/signin"]) {
      const messages = await loadMessages("ko-KR", localeDomainsForPath(path));
      expect(messages["customer.personal"]).toBe("개인 워크스페이스");
      expect(messages["customer.setup.title"]).toBe("워크스페이스 설정하기");
    }
  });
});
