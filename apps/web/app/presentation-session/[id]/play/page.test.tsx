import { renderToStaticMarkup } from "react-dom/server";
import type * as ReactModule from "react";
import { describe, expect, it, vi } from "vitest";
import {
  PresentationParticipantSnapshotSchema,
  type PresentationParticipantSnapshot,
} from "@openround/contracts";
import { withEnglishLocale } from "../../../../test-utils/english-locale";
import PresentationParticipantPage from "./page";

const fixtures = vi.hoisted(() => ({
  nextSnapshot: null as PresentationParticipantSnapshot | null,
}));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof ReactModule>();
  return {
    ...react,
    useState: <T,>(initial: T | (() => T)) => {
      if (initial === null && fixtures.nextSnapshot) {
        const snapshot = fixtures.nextSnapshot;
        fixtures.nextSnapshot = null;
        return react.useState(snapshot as T);
      }
      return react.useState(initial);
    },
  };
});

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "presentation-session" }),
  usePathname: () => "/presentation-session/presentation-session/play",
  useRouter: () => ({ replace: vi.fn() }),
}));

function snapshot(overrides: Record<string, unknown> = {}) {
  return PresentationParticipantSnapshotSchema.parse({
    sessionId: "11111111-1111-4111-8111-111111111111",
    artifactType: "presentation",
    presentationId: "22222222-2222-4222-8222-222222222222",
    presentationVersionId: "33333333-3333-4333-8333-333333333333",
    projection: "participant",
    participantId: "44444444-4444-4444-8444-444444444444",
    title: "Authored presentation title",
    code: "1234567",
    status: "active",
    phase: "content",
    currentBlockIndex: 0,
    blockCount: 1,
    revision: 3,
    seq: 3,
    serverTime: "2026-11-03T12:00:00.000Z",
    questionOpenedAt: null,
    questionClosesAt: null,
    acceptingResponses: false,
    settings: { timeMode: "flex", trustMode: "learning" },
    currentBlock: {
      id: "55555555-5555-4555-8555-555555555555",
      kind: "content",
      layout: "title",
      design: { theme: "sunset", font: "serif", spacing: "compact" },
      textElements: [
        {
          id: "title",
          role: "title",
          text: "Authored slide title",
          region: "top_center",
          order: 0,
        },
      ],
      mediaId: null,
      mediaAlt: null,
    },
    participantCount: 2,
    responseSubmitted: false,
    responseResult: null,
    standing: null,
    finishedAt: null,
    ...overrides,
  });
}

describe("Presentation participant workspace", () => {
  it("keeps the visible and accessible brand readable on the light header before connecting", () => {
    const markup = renderToStaticMarkup(withEnglishLocale(<PresentationParticipantPage />));
    const header = markup.match(/<header\b[^>]*>([\s\S]*?)<\/header>/)?.[1];
    expect(header).not.toContain('data-inverted="true"');
    expect(header).not.toContain('style="color:white"');
    expect(header).toContain('<span class="sr-only">Polling Pops</span>');
    expect(header).toContain('class="brand-name"');
  });

  it("retains authored slide design and puts response guidance before the slide", () => {
    fixtures.nextSnapshot = snapshot();
    const markup = renderToStaticMarkup(withEnglishLocale(<PresentationParticipantPage />));
    expect(markup).toContain('data-kind="content"');
    expect(markup).toContain('data-design-theme="sunset"');
    expect(markup).toContain("Authored slide title");
    expect(markup.indexOf("No response is collected on this slide.")).toBeLessThan(
      markup.indexOf('data-layout="title"'),
    );
    expect(markup).not.toContain("Submit response");
  });

  it.each([false, true])("preserves disabled choices when the response is saved=%s", (saved) => {
    fixtures.nextSnapshot = snapshot({
      phase: saved ? "question_open" : "question_reveal",
      responseSubmitted: saved,
      currentBlock: {
        id: "55555555-5555-4555-8555-555555555555",
        kind: "question",
        question: {
          id: "66666666-6666-4666-8666-666666666666",
          type: "single_select",
          prompt: "Authored response prompt",
          choices: [
            { id: "77777777-7777-4777-8777-777777777777", label: "First authored choice" },
            { id: "88888888-8888-4888-8888-888888888888", label: "Second authored choice" },
          ],
          timeLimitSeconds: 30,
          basePoints: 100,
          confidence: "off",
          mediaId: null,
          mediaAlt: null,
        },
      },
    });
    const markup = renderToStaticMarkup(withEnglishLocale(<PresentationParticipantPage />));
    expect(markup).toContain("Authored response prompt");
    expect(markup.match(/<button[^>]*aria-pressed="false"[^>]*disabled=""/g)).toHaveLength(2);
    expect(markup).not.toContain("Submit response");
    expect(markup).toContain(
      saved ? "Response saved." : "The facilitator has closed this question.",
    );
  });
});
