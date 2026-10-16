import { supportedLocales } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { loadMessages, localeDomainsForPath } from "./catalog";
import { ideaBoardEnglishMessages, loadIdeaBoardMessages } from "./domains/idea-boards";

describe("idea board translations", () => {
  it("supplies every board message and preserves placeholders in all supported locales", async () => {
    const keys = Object.keys(ideaBoardEnglishMessages).sort();
    const placeholders = (value: string) =>
      [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    for (const locale of supportedLocales) {
      const messages = await loadIdeaBoardMessages(locale);
      expect(Object.keys(messages).sort(), locale).toEqual(keys);
      for (const key of keys) {
        const message = key as keyof typeof ideaBoardEnglishMessages;
        expect(messages[message].trim(), `${locale}:${key}`).not.toBe("");
        expect(placeholders(messages[message]), `${locale}:${key}`).toEqual(
          placeholders(ideaBoardEnglishMessages[message]),
        );
      }
    }
  });

  it("loads board copy for both creator and accountless participant routes", async () => {
    for (const path of ["/boards", "/boards/123", "/board/123", "/boards/?status=closed"]) {
      const domains = localeDomainsForPath(path);
      expect(domains).toContain("idea-boards");
      const messages = await loadMessages("ko-KR", domains);
      expect(messages["boards.title"]).toBe("아이디어 보드");
    }
  });
});
