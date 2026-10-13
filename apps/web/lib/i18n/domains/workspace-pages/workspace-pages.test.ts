import { supportedLocales } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { loadMessages, localeDomainsForPath, translate } from "../../catalog";
import { loadWorkspacePageMessages, workspacePageEnglishMessages } from "./index";

const sessionWorkflowKeys = [
  "pages.sessions.typeLabel",
  "pages.sessions.searchRounds",
  "pages.sessions.searchPresentations",
  "pages.sessions.searchSurveys",
  "pages.sessions.workspaceSearch",
  "pages.sessions.filtersLabel",
  "pages.sessions.layoutLabel",
  "pages.sessions.allPresentations",
  "pages.sessions.allSurveys",
  "pages.sessions.closesFrom",
  "pages.sessions.closesTo",
  "pages.sessions.resultCount",
  "pages.sessions.surveyDescription",
  "pages.sessions.surveySharing",
  "pages.sessions.surveyRun",
  "pages.sessions.deleteSurvey",
  "pages.sessions.deleteSurveyConfirm",
] as const;

describe("Sessions workspace messages", () => {
  it("explicitly translates tab navigation, filters, and Survey history in every locale", async () => {
    for (const locale of supportedLocales.filter((candidate) => candidate !== "en-CA")) {
      const messages = await loadWorkspacePageMessages(locale);
      for (const key of sessionWorkflowKeys) {
        expect(messages[key]?.trim(), `${locale}:${key}`).not.toBe("");
        expect(messages[key], `${locale}:${key}`).not.toBe(workspacePageEnglishMessages[key]);
      }
    }
  });

  it("loads and interpolates Sessions controls through the scoped route catalog", async () => {
    const domains = localeDomainsForPath("/sessions?type=surveys");
    for (const locale of supportedLocales) {
      const messages = await loadMessages(locale, domains);
      const count = translate(messages, "pages.sessions.resultCount", { count: 12 });
      const back = translate(messages, "pages.sessions.backToLibrary", {
        type: translate(messages, "pages.common.survey"),
      });
      const deletion = translate(messages, "pages.sessions.deleteSurveyConfirm", {
        title: "Survey snapshot",
      });

      expect(count, locale).toContain("12");
      expect(back, locale).toContain(translate(messages, "pages.common.survey"));
      expect(deletion, locale).toContain("Survey snapshot");
      expect(`${count} ${back} ${deletion}`, locale).not.toMatch(/\{\w+\}|pages\.sessions\./);
      expect(messages["pages.sessions.surveyDescription"], locale).toBeTruthy();
      expect(messages["live.audience.chat"], locale).toBeUndefined();
    }
  });
});
