import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { withEnglishLocale } from "../../test-utils/english-locale";
import { PresentationCompanionLauncher } from "./companion-launcher";
import { CompanionOverlay } from "./companion-overlay";
import { LocaleProvider } from "../locale-provider";
import { loadMessages, translate } from "../../lib/i18n/catalog";
import { CompanionQuickCheckForm } from "./companion-quick-check";
import {
  CompanionRecoveryCardPicker,
  CompanionRecoveryPackPicker,
} from "./companion-recovery-packs";
import { CompanionPublishedQuestionPicker } from "./companion-published-questions";

vi.mock("next/navigation", () => ({ usePathname: () => "/presentation-session/session/host" }));

describe("Presentation companion surfaces", () => {
  it("renders Korean launch, modal and auxiliary controls using the real delivery catalog while retaining authored material", async () => {
    const messages = await loadMessages("ko-KR", ["live-delivery"]);
    const markup = renderToStaticMarkup(
      <LocaleProvider
        initialLocale="ko-KR"
        initialDomains={["live-delivery"]}
        initialMessages={messages}
      >
        <PresentationCompanionLauncher sessionId="session" enabled canEdit />
        <CompanionOverlay
          title={translate(messages, "live.companion.quickCheck.title")}
          onClose={vi.fn()}
        >
          <CompanionQuickCheckForm
            draft={{
              prompt: "Authored English poll",
              choices: ["Original A", "Original B"],
              timeLimitSeconds: "30",
            }}
            timeMode="flex"
            available
            disabled={false}
            onChange={vi.fn()}
            onInsert={vi.fn()}
          />
          <CompanionRecoveryPackPicker
            catalog={{
              packs: [
                {
                  packId: "pack",
                  packVersionId: "version",
                  packVersion: 2,
                  title: "Original Pack title",
                },
              ],
            }}
            loading={false}
            error="Synthetic service detail"
            disabled={false}
            onReload={vi.fn()}
            onInsert={vi.fn()}
          />
          <CompanionRecoveryCardPicker
            cards={[
              {
                reference: {
                  insertionId: "insertion",
                  packId: "pack",
                  packVersionId: "version",
                  packVersion: 2,
                  contentHash: "hash",
                  cardId: "card",
                },
                title: "Original card title",
              },
            ]}
            disabled={false}
            onStart={vi.fn()}
          />
          <CompanionPublishedQuestionPicker
            catalog={{ questions: [], hasMore: false }}
            loading={false}
            error=""
            disabled={false}
            onSearch={vi.fn()}
            onInsert={vi.fn()}
          />
        </CompanionOverlay>
      </LocaleProvider>,
    );
    expect(markup).toContain("Companion 실행");
    expect(markup).toContain("이 세션 전용 Quick Check");
    expect(markup).toContain("응답 마감 시간이 없으므로");
    expect(markup).toContain("프레젠테이션으로 돌아가기");
    expect(markup).toContain("게시된 Round 질문");
    expect(markup).toContain("Pack 불러오기 재시도");
    expect(markup).toContain("Authored English poll");
    expect(markup).toContain('lang=""');
    expect(markup).toContain("Original Pack title");
    expect(markup).toContain("Original card title");
    expect(markup).toContain('lang="en-CA">Synthetic service detail');
    expect(markup).not.toContain("Launch companion");
    expect(markup).not.toContain("Choose a card by title");
  });

  it("exposes launch only to editors in an enabled workspace", () => {
    const markup = (enabled: boolean, canEdit: boolean) =>
      renderToStaticMarkup(
        withEnglishLocale(
          <PresentationCompanionLauncher sessionId="session" enabled={enabled} canEdit={canEdit} />,
        ),
      );
    expect(markup(true, true)).toContain("Launch companion");
    expect(markup(false, true)).toBe("");
    expect(markup(true, false)).toBe("");
  });

  it("labels the native modal and provides a close action whose meaning is explicit", () => {
    const markup = renderToStaticMarkup(
      withEnglishLocale(
        <CompanionOverlay title="Join this Presentation" onClose={vi.fn()}>
          <p>Join code 1234567</p>
        </CompanionOverlay>,
      ),
    );
    expect(markup).toContain('aria-label="Join this Presentation"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain("Return to deck");
    expect(markup).toContain("Close this overlay to return to the companion controls.");
    expect(markup).not.toContain("desktop");
  });
});
