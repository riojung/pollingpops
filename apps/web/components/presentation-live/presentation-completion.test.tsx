import type { ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  PresentationHostSnapshotSchema,
  PresentationParticipantSnapshotSchema,
} from "@openround/contracts";
import { translate, type MessageKey } from "../../lib/i18n/catalog";
import { liveDeliveryEnglishMessages } from "../../lib/i18n/domains/live-delivery";
import PresentationHostPage from "../../app/presentation-session/[id]/host/page";
import PresentationParticipantPage from "../../app/presentation-session/[id]/play/page";

const fixtures = vi.hoisted(() => ({ nextSnapshot: null as unknown }));

// Render the actual finished page without starting browser transports or replacing later state.
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof ReactModule>();
  return {
    ...react,
    useState: <T,>(initial: T | (() => T)) => {
      if (fixtures.nextSnapshot !== null) {
        const snapshot = fixtures.nextSnapshot;
        fixtures.nextSnapshot = null;
        return react.useState(snapshot as T);
      }
      return react.useState(initial);
    },
  };
});
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "11111111-1111-4111-8111-111111111111" }),
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock("../brand", () => ({ Brand: () => null, CreatorBrand: () => null }));
vi.mock("../locale-provider", () => ({
  useLocale: () => ({
    locale: "en-CA",
    t: (key: MessageKey, values?: Record<string, string | number>) =>
      translate(liveDeliveryEnglishMessages, key, values),
  }),
}));
vi.mock("../workspace/workspace-provider", () => ({
  WorkspaceProvider: ({ children }: { children: ReactNode }) => children,
  useWorkspace: () => ({ productFeatures: {}, canEdit: true }),
}));

const finished = {
  sessionId: "11111111-1111-4111-8111-111111111111",
  artifactType: "presentation",
  presentationId: "22222222-2222-4222-8222-222222222222",
  presentationVersionId: "33333333-3333-4333-8333-333333333333",
  title: "Project update",
  code: "1234567",
  status: "finished",
  phase: "finished",
  currentBlockIndex: 0,
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
  finishedAt: "2026-11-03T12:00:00.000Z",
};

describe("Presentation completion", () => {
  it("gives the host participation and report access without assessment or poll claims", () => {
    fixtures.nextSnapshot = PresentationHostSnapshotSchema.parse({
      ...finished,
      projection: "host",
      responseCount: 0,
      participants: [],
      roomStatus: {
        sessionId: finished.sessionId,
        joinedCount: 2,
        connectedCount: 2,
        notCurrentlyConnectedCount: 0,
        responseCount: 0,
        sampledAt: finished.serverTime,
      },
    });
    const markup = renderToStaticMarkup(<PresentationHostPage />);
    expect(markup).toContain("Presentation finished");
    expect(markup).toContain("2 joined");
    expect(markup).toContain("Open session report");
    expect(markup).not.toContain("assessed questions");
    expect(markup).not.toContain("These polls collect opinions");
    expect(markup).not.toContain("Leaderboard");
  });

  it("thanks a participant without claiming answers or zero-point standing", () => {
    fixtures.nextSnapshot = PresentationParticipantSnapshotSchema.parse({
      ...finished,
      projection: "participant",
      participantId: "44444444-4444-4444-8444-444444444444",
      responseSubmitted: false,
      responseResult: null,
      standing: null,
    });
    const markup = renderToStaticMarkup(<PresentationParticipantPage />);
    expect(markup).toContain("Thanks for participating");
    expect(markup).toContain("Presentation finished");
    expect(markup).toContain("Leave Presentation");
    expect(markup).not.toContain("Your responses have been saved");
    expect(markup).not.toContain("Rank");
    expect(markup).not.toContain("points");
  });

  it("retains a supplied standing for a participant in a scored session", () => {
    fixtures.nextSnapshot = PresentationParticipantSnapshotSchema.parse({
      ...finished,
      projection: "participant",
      participantId: "44444444-4444-4444-8444-444444444444",
      responseSubmitted: false,
      responseResult: null,
      standing: { rank: 2, score: 1500 },
    });
    const markup = renderToStaticMarkup(<PresentationParticipantPage />);
    expect(markup).toContain("Rank 2 with 1,500 points");
  });
});
