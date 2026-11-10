import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PresentationParticipantSnapshotSchema,
  PresentationStageSnapshotSchema,
  supportedLocales,
  type SupportedLocale,
} from "@openround/contracts";
import { loadMessages, translate, type MessageKey } from "../../lib/i18n/catalog";
import {
  presentationDeliveryCopy,
  presentationDeliveryEnglishCopy,
  type PresentationDeliveryCopyKey,
} from "../../lib/i18n/presentation-delivery-copy";
import PresentationAudienceStagePage from "../../app/presentation-session/[id]/stage/page";
import PresentationParticipantPage from "../../app/presentation-session/[id]/play/page";

const fixtures = vi.hoisted(() => ({
  states: [] as unknown[],
  locale: "ko-KR" as SupportedLocale,
}));

// Supply an authoritative projection without starting browser transports. All subsequent
// component state remains real React state, including the default unsaved connection state.
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof ReactModule>();
  return {
    ...react,
    useState: <T,>(initial: T | (() => T)) =>
      react.useState(fixtures.states.length ? (fixtures.states.shift() as T) : initial),
  };
});
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "11111111-1111-4111-8111-111111111111" }),
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock("../brand", () => ({ Brand: () => null }));
vi.mock("../locale-provider", async () => {
  const { loadMessages, translate } = await import("../../lib/i18n/catalog");
  const messages = await loadMessages("ko-KR", ["live-delivery"]);
  return {
    useLocale: () => ({
      locale: fixtures.locale,
      t: (key: MessageKey, values?: Record<string, string | number>) =>
        translate(messages, key, values),
    }),
  };
});

const session = {
  sessionId: "11111111-1111-4111-8111-111111111111",
  artifactType: "presentation",
  presentationId: "22222222-2222-4222-8222-222222222222",
  presentationVersionId: "33333333-3333-4333-8333-333333333333",
  title: "Authored project update",
  code: "1234567",
  status: "active",
  phase: "lobby",
  currentBlockIndex: -1,
  blockCount: 1,
  revision: 3,
  seq: 3,
  serverTime: "2026-11-03T12:00:00.000Z",
  questionOpenedAt: null,
  questionClosesAt: null,
  acceptingResponses: false,
  settings: { timeMode: "timed", trustMode: "learning" },
  currentBlock: null,
  participantCount: 2,
  finishedAt: null,
};

function stage(overrides: Record<string, unknown> = {}) {
  return PresentationStageSnapshotSchema.parse({
    ...session,
    projection: "stage",
    revealedAnswer: null,
    responseCount: 0,
    ...overrides,
  });
}

function ranking(responseSubmitted: boolean) {
  return PresentationParticipantSnapshotSchema.parse({
    ...session,
    phase: "question_open",
    currentBlockIndex: 0,
    acceptingResponses: !responseSubmitted,
    projection: "participant",
    participantId: "44444444-4444-4444-8444-444444444444",
    currentBlock: {
      id: "55555555-5555-4555-8555-555555555555",
      kind: "question",
      question: {
        id: "66666666-6666-4666-8666-666666666666",
        type: "ranking",
        prompt: "Authored English priorities",
        choices: [
          { id: "77777777-7777-4777-8777-777777777777", label: "Authored first answer" },
          { id: "88888888-8888-4888-8888-888888888888", label: "Authored second answer" },
        ],
        timeLimitSeconds: 30,
        basePoints: 0,
        confidence: "off",
        mediaId: null,
        mediaAlt: null,
      },
    },
    responseSubmitted,
    responseResult: null,
    standing: null,
  });
}

beforeEach(() => {
  fixtures.states = [];
  fixtures.locale = "ko-KR";
});

describe("public Presentation delivery localization", () => {
  it.each(supportedLocales)(
    "preserves all delivery placeholders and English defaults in %s",
    (locale) => {
      const copy = presentationDeliveryCopy(locale);
      for (const [key, english] of Object.entries(presentationDeliveryEnglishCopy)) {
        const localized = copy(key as PresentationDeliveryCopyKey);
        expect(localized.trim()).not.toBe("");
        expect(localized.match(/\{\w+\}/g) ?? []).toEqual(english.match(/\{\w+\}/g) ?? []);
        if (locale === "en-CA") expect(localized).toBe(english);
      }
    },
  );

  it("renders Korean stage lobby and reconnection chrome around unchanged authored title and code", () => {
    fixtures.states = [stage(), "public-stage-pass", false, true];
    const markup = renderToStaticMarkup(<PresentationAudienceStagePage />);
    expect(markup).toContain('lang="ko-KR"');
    expect(markup).toContain("시작 준비 완료");
    expect(markup).toContain("기다리는 동안 기기에서 참여하세요.");
    expect(markup).toContain("다시 연결 중 — 마지막으로 확인된 슬라이드를 표시합니다.");
    expect(markup).toContain('aria-label="참여자 슬라이드"');
    expect(markup).toContain("Authored project update");
    expect(markup).toContain("참여 코드: 1234567");
    expect(markup).not.toContain("public-stage-pass");
  });

  it("renders localized connecting, unavailable, waiting, and completion states without exposing stage data", () => {
    expect(renderToStaticMarkup(<PresentationAudienceStagePage />)).toContain(
      "참여자 화면에 연결 중…",
    );
    fixtures.states = [null, null, true];
    const unavailable = renderToStaticMarkup(<PresentationAudienceStagePage />);
    expect(unavailable).toContain("참여자 화면을 사용할 수 없습니다");
    expect(unavailable).toContain("발표자에게 새 참여자 화면을 열어 달라고 요청하세요.");
    expect(unavailable).not.toContain("1234567");
    fixtures.states = [stage({ phase: "content", currentBlockIndex: 0 }), "public-stage-pass"];
    expect(renderToStaticMarkup(<PresentationAudienceStagePage />)).toContain(
      "다음 슬라이드를 기다리는 중입니다.",
    );
    fixtures.states = [
      stage({ phase: "finished", status: "finished", finishedAt: session.serverTime }),
      "public-stage-pass",
    ];
    const complete = renderToStaticMarkup(<PresentationAudienceStagePage />);
    expect(complete).toContain("프레젠테이션 완료");
    expect(complete).toContain("참여해 주셔서 감사합니다.");
    expect(complete).not.toContain("Your responses have been saved");
  });

  it("shows Korean ranking receipt only for an accepted response and keeps authored choices unchanged", async () => {
    fixtures.states = [ranking(true)];
    const accepted = renderToStaticMarkup(<PresentationParticipantPage />);
    expect(accepted).toContain("순위가 저장되었습니다.");
    expect(accepted).toContain('aria-label="순위 선택지"');
    expect(accepted).toContain("저장됨");
    expect(accepted).toContain('<li lang="">Authored first answer</li>');
    expect(accepted).toContain("Authored English priorities");
    fixtures.states = [ranking(false)];
    const pending = renderToStaticMarkup(<PresentationParticipantPage />);
    expect(pending).toContain("다시 연결 중 — 아직 저장되지 않음");
    expect(pending).not.toContain("순위가 저장되었습니다.");
    const messages = await loadMessages("ko-KR", ["live-delivery"]);
    expect(pending).not.toContain(translate(messages, "live.presentationPlay.responseSaved"));
  });
});
