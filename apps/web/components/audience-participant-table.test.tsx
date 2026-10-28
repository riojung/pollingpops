import type { ParticipantInteractionView } from "@openround/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { withEnglishLocale } from "../test-utils/english-locale";
import { AudienceParticipantTable } from "./audience-panel";

vi.mock("next/navigation", () => ({ usePathname: () => "/host/test-session" }));

const participant: ParticipantInteractionView = {
  participantId: "8dce12bc-efb8-4b9c-9a60-2cf8e846fc33",
  nickname: "A learner with a long alias · 김민준",
  avatarId: "owl",
  connected: true,
  answered: false,
  currentSignal: "need_example",
  lastSignalAt: null,
  lastActivityAt: null,
  chatMessageCount: 2,
  mutedUntil: null,
  banned: false,
};

function render(participants = [participant], busy = false, withKick = true) {
  return renderToStaticMarkup(
    withEnglishLocale(
      <AudienceParticipantTable
        busy={busy}
        muteDurationMinutes={15}
        onKick={withKick ? () => undefined : undefined}
        onModerate={() => undefined}
        participants={participants}
      />,
    ),
  );
}

describe("responsive audience participant table", () => {
  it("keeps table navigation and complete participant identity in compact labelled rows", () => {
    const markup = render();
    expect(markup).toContain('aria-label="Participant activity"');
    expect(markup).toContain('role="table"');
    expect(markup.match(/role="columnheader" scope="col"/g)).toHaveLength(5);
    expect(markup).toContain('role="rowheader" scope="row"');
    expect(markup).toContain(`<span lang="">${participant.nickname}</span>`);
    expect(markup).toContain("Connected · waiting");
    expect(markup).toContain("Show an example");
    expect(markup).toContain('aria-hidden="true" class="participant-cell-label">Status</span>');
    expect(markup).toContain('aria-hidden="true" class="participant-cell-label">Moderation</span>');
    expect(markup.match(/<button/g)).toHaveLength(3);
    expect(markup).not.toContain('tabindex="0"');
  });

  it("preserves moderation state, pending action protection and optional removal access", () => {
    const markup = render(
      [{ ...participant, mutedUntil: "2026-10-28T16:00:00.000Z", banned: true }],
      true,
      false,
    );
    expect(markup).toContain(">Unmute</button>");
    expect(markup).toContain(">Restore</button>");
    expect(markup.match(/disabled=""/g)).toHaveLength(2);
    expect(markup).not.toContain(">Kick</button>");
  });
});
