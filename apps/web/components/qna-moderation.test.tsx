import { renderToStaticMarkup } from "react-dom/server";
import type * as ReactModule from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { supportedLocales, type SupportedLocale } from "@openround/contracts";
import { LocaleProvider } from "./locale-provider";
import { loadMessages, type Messages } from "../lib/i18n/catalog";
import { QnaPanel } from "./qna-panel";
import { TextModerationPanel } from "./text-moderation-panel";
import { PresentationQnaPanel } from "./presentation-live/presentation-qna";
import { PresentationTextModerationPanel } from "./presentation-live/text-moderation";
import {
  localizeQnaModerationError,
  localizeQnaSelfName,
  qnaModerationCopy,
  qnaModerationCopyKeys,
} from "../lib/i18n/qna-moderation-copy";

const fixture = vi.hoisted(() => ({
  nulls: [] as unknown[],
  strings: [] as string[],
  booleans: [] as boolean[],
  nullCursor: 0,
  stringCursor: 0,
  booleanCursor: 0,
}));
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useState: <T,>(initial: T | (() => T)) => {
      const value =
        initial === null
          ? (fixture.nulls[fixture.nullCursor++] ?? initial)
          : initial === ""
            ? (fixture.strings[fixture.stringCursor++] ?? initial)
            : typeof initial === "boolean"
              ? (fixture.booleans[fixture.booleanCursor++] ?? initial)
              : initial;
      return react.useState(value as T);
    },
  };
});
vi.mock("next/navigation", () => ({ usePathname: () => "/presentation-session/room/host" }));
let korean: Messages;
let english: Messages;
beforeEach(async () => {
  fixture.nulls = [];
  fixture.strings = [];
  fixture.booleans = [];
  fixture.nullCursor = 0;
  fixture.stringCursor = 0;
  fixture.booleanCursor = 0;
  korean ??= await loadMessages("ko-KR", ["live-delivery"]);
  english ??= await loadMessages("en-CA", ["live-delivery"]);
});
function markup(children: ReactModule.ReactNode, locale: SupportedLocale = "ko-KR") {
  fixture.nullCursor = 0;
  fixture.stringCursor = 0;
  fixture.booleanCursor = 0;
  return renderToStaticMarkup(
    <LocaleProvider
      initialLocale={locale}
      initialDomains={["live-delivery"]}
      initialMessages={locale === "ko-KR" ? korean : english}
    >
      {children}
    </LocaleProvider>,
  );
}
const settings = {
  enabled: true,
  displayMode: "anonymous_public",
  moderationMode: "pre",
  participantReplies: true,
};
const question = {
  id: "question",
  body: "<script>Original English question?</script>",
  status: "published",
  label: "Original label",
  author: { displayName: "Original nickname", mine: true },
  voteCount: 2,
  votedByMe: false,
  replies: [
    {
      id: "reply",
      questionId: "question",
      body: "Original English reply",
      status: "published",
      author: { displayName: "Original staff alias", kind: "staff", mine: false },
    },
  ],
};
const page = { questions: [question], settings, nextCursor: null };
const roundProps = {
  sessionId: "room",
  roundId: "round",
  version: 3,
  phase: "question_open",
  credential: "PRIVATE PASS",
  disabled: false,
  onModerate: vi.fn(),
};
const presentationProps = {
  sessionId: "room",
  blockId: "block",
  revision: 3,
  seq: 7,
  phase: "question_open",
  credential: "PRIVATE PASS",
  disabled: false,
};

describe("localized Q&A and private moderation", () => {
  it("keeps every gap translation and placeholder complete in all existing locales", () => {
    for (const locale of supportedLocales)
      for (const key of qnaModerationCopyKeys) {
        const text = qnaModerationCopy(locale)(key);
        expect(text, `${locale}:${key}`).toBeTruthy();
        expect(text.match(/\{\w+\}/g) ?? []).toEqual(key.match(/\{\w+\}/g) ?? []);
        if (locale !== "en-CA") expect(text).not.toBe(key);
      }
    const unknown = localizeQnaModerationError("ko-KR", "Unknown backend diagnostic");
    expect(unknown).toEqual({
      text: "Unknown backend diagnostic",
      language: "en-CA",
      known: false,
    });
    expect(localizeQnaModerationError("ko-KR", "toString")).toEqual({
      text: "toString",
      language: "en-CA",
      known: false,
    });
    expect(localizeQnaModerationError("ko-KR", "Failed to fetch")).toMatchObject({
      language: "ko-KR",
      known: true,
    });
    expect(localizeQnaModerationError("ko-KR", "Request failed (503)").text).toContain("503");
  });

  it("renders Korean controls/privacy and preserves raw authored questions, aliases and replies", () => {
    fixture.nulls = [{ ...page, audienceSeq: 4, lifecycle: "open" }];
    const html = markup(
      <QnaPanel
        role="moderator"
        sessionId="room"
        token="PRIVATE PASS"
        revision={4}
        scopeKind="presentation"
      />,
    );
    expect(html).toContain("질문과 답변");
    expect(html).toContain("진행자는 세션 별칭을 볼 수 있습니다.");
    expect(html).toContain("답변 완료로 표시");
    expect(html).toContain("Original nickname");
    expect(html).toContain("&lt;script&gt;Original English question?&lt;/script&gt;");
    expect(html).toContain("Original English reply");
    expect(html).toContain("Original staff alias");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("PRIVATE PASS");
    expect(html).toContain('lang="ko-KR"');
  });

  it("localizes only the participant's synthesized self name, preserving literal aliases and authored You", () => {
    const mine = {
      ...question,
      body: "You authored this English question",
      author: { displayName: "You", mine: true },
      replies: [
        {
          ...question.replies[0]!,
          body: "You authored this participant reply",
          author: { displayName: "You", mine: true, kind: "participant" },
        },
        {
          ...question.replies[0]!,
          id: "staff",
          author: { displayName: "You", mine: true, kind: "staff" },
        },
      ],
    };
    const literal = { ...question, id: "other", author: { displayName: "You", mine: false } };
    fixture.nulls = [{ ...page, questions: [mine, literal] }];
    const html = markup(<QnaPanel role="participant" sessionId="room" token="pass" revision={1} />);
    expect(html.match(/<strong lang="ko-KR">본인<\/strong>/g)).toHaveLength(2);
    expect(html.match(/<strong lang="">You<\/strong>/g)).toHaveLength(2);
    expect(html).toContain("You authored this English question");
    expect(html).toContain("You authored this participant reply");
    for (const role of ["moderator", "observer"] as const) {
      expect(localizeQnaSelfName("ko-KR", role, mine.author, "question")).toEqual({
        text: "You",
        language: "",
      });
    }
    expect(
      localizeQnaSelfName(
        "ko-KR",
        "participant",
        { displayName: "Authored nickname", mine: true },
        "question",
      ),
    ).toEqual({ text: "Authored nickname", language: "" });
    expect(localizeQnaSelfName("en-CA", "participant", mine.author, "question")).toEqual({
      text: "You",
      language: "en-CA",
    });
  });

  it.each(["round", "presentation"] as const)(
    "keeps %s observers read-only even when participant replies are enabled",
    (scopeKind) => {
      fixture.nulls = [page];
      const html = markup(
        <QnaPanel
          role="observer"
          sessionId="room"
          token="observer-pass"
          revision={1}
          scopeKind={scopeKind}
        />,
      );
      expect(html).toContain("Original English reply");
      expect(html).not.toContain("<textarea");
      expect(html).not.toContain("qna-moderation-actions");
      expect(html).not.toContain("qna-settings");
    },
  );

  it("translates retained notice keys at display time and attributes unknown diagnostics", () => {
    fixture.nulls = [page];
    fixture.strings = ["", "", "Unknown backend diagnostic", "live.qna.questionSentForReview"];
    const view = <QnaPanel role="participant" sessionId="room" token="pass" revision={1} />;
    const ko = markup(view);
    expect(ko).toContain("진행자 검토");
    expect(ko).not.toContain("Question sent for facilitator review.");
    expect(ko).toContain('lang="en-CA" role="alert">Unknown backend diagnostic');
    expect(markup(view, "en-CA")).toContain("Question sent for facilitator review.");
  });

  it("localizes Presentation activation and waiting without exposing inactive Q&A content", () => {
    fixture.nulls = [{ available: true, activated: false, canActivate: true }];
    const host = markup(
      <PresentationQnaPanel role="host" sessionId="room" token="pass" closed={false} />,
    );
    expect(host).toContain("참여자 질의응답 활성화");
    expect(host).toContain("Companion은 읽기 전용입니다.");
    expect(host).not.toContain("qna-compose");
    fixture.nulls = [{ available: true, activated: false, canActivate: false }];
    const waiting = markup(
      <PresentationQnaPanel role="participant" sessionId="room" token="pass" closed={false} />,
    );
    expect(waiting).toContain("진행자가 활성화하면 참여자 질의응답이 표시됩니다.");
    expect(waiting).not.toContain("<textarea");
  });

  it.each(["round", "presentation"] as const)(
    "renders the %s private queue literally and hides it after credential/phase changes",
    (kind) => {
      const item = {
        questionPrompt: "Original prompt",
        authorAlias: "Original alias",
        submittedAt: "2026-11-10T12:00:00Z",
        status: "pending",
        answerId: "answer",
        responseId: "answer",
        roundId: "round",
        blockId: "block",
        body: "PRIVATE authored response",
        textValue: "PRIVATE authored response",
        moderationVersion: 1,
      };
      const key =
        kind === "round"
          ? JSON.stringify(["room", "round", 3, "question_open", "current", "pending", null, 0, 0])
          : JSON.stringify(["room", "block", 3, 7, "question_open", "current", "pending", null, 0]);
      fixture.nulls = [
        null,
        { key, credential: "PRIVATE PASS", data: { items: [item], nextCursor: null }, error: "" },
      ];
      const component = (credential: string, phase = "question_open") =>
        kind === "round" ? (
          <TextModerationPanel {...roundProps} credential={credential} phase={phase} />
        ) : (
          <PresentationTextModerationPanel
            {...presentationProps}
            credential={credential}
            phase={phase}
          />
        );
      const html = markup(component("PRIVATE PASS"));
      expect(html).toContain("PRIVATE authored response");
      expect(html).toContain("Original prompt");
      expect(html).toContain("Original alias");
      expect(html).toContain('role="group"');
      expect(html).not.toContain("PRIVATE PASS");
      for (const view of [component("replacement-pass"), component("PRIVATE PASS", "finished")]) {
        const fenced = markup(view);
        expect(fenced).not.toContain("PRIVATE authored response");
        expect(fenced).not.toContain("text-moderation-list");
      }
    },
  );

  it("localizes retained review acknowledgement state without changing its immutable retry identity", () => {
    const intent = Object.freeze({
      sessionId: "room",
      credential: "PRIVATE PASS",
      responseId: "answer",
      blockId: "block",
      request: Object.freeze({
        commandId: "ORIGINAL-NONCE",
        expectedRevision: 3,
        expectedModerationVersion: 1,
        status: "approved",
      }),
    });
    fixture.nulls = [
      null,
      null,
      {
        intent,
        busy: false,
        error: "The server did not confirm this response review. Retry its acknowledgement.",
      },
    ];
    const html = markup(<PresentationTextModerationPanel {...presentationProps} />);
    expect(html).toContain("검토 업데이트가 확인되지 않았습니다.");
    expect(html).toContain("검토 확인 응답 재시도");
    expect(html).toContain("서버가 이 응답 검토를 확인하지 않았습니다.");
    expect(html).not.toContain("ORIGINAL-NONCE");
    expect(html).not.toContain("PRIVATE PASS");
    expect(Object.isFrozen(intent.request)).toBe(true);
  });
});
