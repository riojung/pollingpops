import { renderToStaticMarkup } from "react-dom/server";
import { supportedLocales, type QuestionDraft } from "@openround/contracts";
import { describe, expect, it, vi } from "vitest";
import { authoringWorkflowCopy } from "./authoring-workflow-copy";
import { MediaEditor } from "./media-editor";
import { ResponseEditor } from "./response-editor";
import { LocaleProvider } from "../locale-provider";
import { loadMessages, localeDomains } from "../../lib/i18n/catalog";
import { presentationStartCopy } from "../workspace/presentation-start-copy";
import { presentationCommandCopy } from "../presentation/presentation-command-copy";
import { presentationActivityCopy } from "../presentation/presentation-activity-copy";

vi.mock("next/navigation", () => ({ usePathname: () => "/quiz/draft" }));
const question: QuestionDraft = {
  id: "question",
  type: "numeric",
  prompt: "AUTHOR TEXT",
  correctValue: "4",
  tolerance: "0",
  unit: null,
  timeLimitSeconds: 30,
  basePoints: 1000,
  explanation: "",
  mediaId: null,
  mediaAlt: null,
};
describe("core authoring locale copy", () => {
  it("supplies every instruction and keeps placeholders in all supported locales", () => {
    for (const messages of [
      authoringWorkflowCopy,
      presentationStartCopy,
      presentationCommandCopy,
      presentationActivityCopy,
    ]) {
      const english = messages();
      for (const locale of supportedLocales) {
        const copy = messages(locale);
        expect(Object.keys(copy)).toEqual(Object.keys(english));
        for (const key of Object.keys(english)) {
          const source = english as Record<string, string>,
            target = copy as Record<string, string>;
          expect(target[key], `${locale}:${key}`).toBeTruthy();
          expect(target[key]!.match(/\{\w+\}/g) ?? []).toEqual(
            source[key]!.match(/\{\w+\}/g) ?? [],
          );
        }
      }
    }
  });

  it("renders Korean image guidance and numeric controls while preserving authored content", async () => {
    const messages = await loadMessages("ko-KR", localeDomains);
    const markup = renderToStaticMarkup(
      <LocaleProvider
        initialLocale="ko-KR"
        initialDomains={localeDomains}
        initialMessages={messages}
      >
        <MediaEditor
          question={question}
          uxBeta
          mediaUploadsEnabled={false}
          mediaState="idle"
          mediaPreviewUrl=""
          onRemoveImage={vi.fn()}
          onUpdateQuestion={vi.fn()}
          onUploadImage={vi.fn()}
        />
        <ResponseEditor
          question={question}
          uxBeta
          onStructuralChange={vi.fn()}
          onUpdateQuestion={vi.fn()}
          onUpdateChoiceQuestion={vi.fn()}
        />
      </LocaleProvider>,
    );
    expect(markup).toContain("교육용 이미지 선택");
    expect(markup).toContain("운영자가 악성코드 검사를 설정");
    expect(markup).toContain("절대 허용 오차");
    expect(markup).toContain("단위(선택 사항)");
    expect(markup).not.toContain("Choose instructional image");
    expect(markup).not.toContain("Absolute tolerance");
    expect(markup).toContain('lang="ko-KR"');
  });
});
