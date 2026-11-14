import { renderToStaticMarkup } from "react-dom/server";
import type * as ReactModule from "react";
import { describe, expect, it, vi } from "vitest";
import { PresentationStageSnapshotSchema } from "@openround/contracts";
import { withEnglishLocale } from "../../../../test-utils/english-locale";
import PresentationAudienceStagePage from "./page";

const fixtures = vi.hoisted(() => ({ states: [] as unknown[] }));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof ReactModule>();
  return {
    ...react,
    useState: <T,>(initial: T | (() => T)) =>
      react.useState(
        initial === null && fixtures.states.length ? (fixtures.states.shift() as T) : initial,
      ),
  };
});

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "11111111-1111-4111-8111-111111111111" }),
  usePathname: () => "/presentation-session/11111111-1111-4111-8111-111111111111/stage",
}));

describe("Presentation audience stage workspace", () => {
  it("keeps accessible brand and full-screen access in the stage header while connecting", () => {
    const markup = renderToStaticMarkup(withEnglishLocale(<PresentationAudienceStagePage />));
    const header = markup.match(/<header\b[^>]*>([\s\S]*?)<\/header>/)?.[1];
    expect(header).toContain('<span class="sr-only">Polling Pops</span>');
    expect(header).toContain("Enter full screen");
    expect(header).not.toContain('data-inverted="true"');
    expect(markup).toContain("Connecting to audience stage");
  });

  it("retains authored content design inside a dedicated frame with join access after the slide", () => {
    fixtures.states = [
      PresentationStageSnapshotSchema.parse({
        sessionId: "11111111-1111-4111-8111-111111111111",
        artifactType: "presentation",
        presentationId: "22222222-2222-4222-8222-222222222222",
        presentationVersionId: "33333333-3333-4333-8333-333333333333",
        projection: "stage",
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
        responseCount: 0,
        revealedAnswer: null,
        finishedAt: null,
      }),
      "stage-pass",
    ];
    const markup = renderToStaticMarkup(withEnglishLocale(<PresentationAudienceStagePage />));
    expect(markup).toContain('aria-label="Audience slide"');
    expect(markup).toContain('data-kind="content"');
    expect(markup).toContain('data-design-theme="sunset"');
    expect(markup).toContain("Authored slide title");
    expect(markup.indexOf("Authored slide title")).toBeLessThan(
      markup.indexOf('aria-label="Join this Presentation"'),
    );
    expect(markup).not.toContain("Submit response");
  });
});
