"use client";

import type { SessionSnapshot } from "@openround/contracts";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import { AudiencePanel, type AudienceRealtimeBatch } from "../../../components/audience-panel";
import { CompetitionDashboard } from "../../../components/competition-dashboard";
import { useLocale } from "../../../components/locale-provider";
import { QnaPanel } from "../../../components/qna-panel";
import styles from "./participant-page.module.css";

export type ParticipantSidebarTab = "standings" | "qna" | "pulse" | "chat";

export function participantSidebarTabs(snapshot: SessionSnapshot): ParticipantSidebarTab[] {
  // Keep the established participant projection and recheck/intervention rules.
  // The presence of a score or roster never authorizes public standings.
  const standingsAvailable =
    Boolean(snapshot.competitionStandings) &&
    snapshot.phase !== "lobby" &&
    snapshot.phase !== "finished" &&
    snapshot.phase !== "intervention" &&
    snapshot.roundKind === "main";
  return [
    ...(standingsAvailable ? (["standings"] as const) : []),
    "qna",
    ...(snapshot.phase !== "finished" ? (["pulse", "chat"] as const) : []),
  ];
}

export function participantSidebarKeyTarget(
  tabs: ParticipantSidebarTab[],
  current: ParticipantSidebarTab,
  key: string,
): ParticipantSidebarTab | null {
  const index = tabs.indexOf(current);
  if (index < 0) return null;
  if (key === "Home") return tabs[0] ?? null;
  if (key === "End") return tabs.at(-1) ?? null;
  if (key === "ArrowRight") return tabs[(index + 1) % tabs.length] ?? null;
  if (key === "ArrowLeft") return tabs[(index - 1 + tabs.length) % tabs.length] ?? null;
  return null;
}

export function RoundParticipantSidebar({
  snapshot,
  sessionId,
  token,
  audiencePanelKey,
  realtimeBatch,
  audienceSyncRevision,
  qnaRevision,
}: {
  snapshot: SessionSnapshot;
  sessionId: string;
  token: string;
  audiencePanelKey: string;
  realtimeBatch: AudienceRealtimeBatch | null;
  audienceSyncRevision: number;
  qnaRevision: number;
}) {
  const { t } = useLocale();
  const id = useId();
  const [selected, setSelected] = useState<ParticipantSidebarTab>("standings");
  const buttons = useRef<Partial<Record<ParticipantSidebarTab, HTMLButtonElement | null>>>({});
  const tabs = participantSidebarTabs(snapshot);
  const active = tabs.includes(selected) ? selected : tabs[0];
  // Keep one AudiencePanel mounted when switching Pulse/chat so drafts, signal
  // receipts, moderation overlays and realtime reconciliation remain intact.
  const audienceView = active === "chat" ? "chat" : "pulse";
  const audienceActive = active === "pulse" || active === "chat";
  const labels: Record<ParticipantSidebarTab, string> = {
    standings: t("live.host.phase.standings"),
    qna: t("live.roundSetup.tools.qna"),
    pulse: t("live.audience.pulseShort"),
    chat: t("live.audience.roomChat"),
  };
  const panelId = (tab: ParticipantSidebarTab) =>
    `${id}-${tab === "pulse" || tab === "chat" ? "audience" : tab}-panel`;

  function onTabKey(event: KeyboardEvent<HTMLButtonElement>, tab: ParticipantSidebarTab) {
    const target = participantSidebarKeyTarget(tabs, tab, event.key);
    if (!target) return;
    event.preventDefault();
    setSelected(target);
    buttons.current[target]?.focus();
  }

  return (
    <aside className={styles.sidebar} aria-label={t("live.audience.sectionAria")}>
      <div className={styles.sidebarTabs} role="tablist" aria-label={t("live.roundPlay.openTools")}>
        {tabs.map((tab) => (
          <button
            aria-controls={panelId(tab)}
            aria-selected={active === tab}
            id={`${id}-${tab}-tab`}
            key={tab}
            onClick={() => setSelected(tab)}
            onKeyDown={(event) => onTabKey(event, tab)}
            ref={(element) => {
              buttons.current[tab] = element;
            }}
            role="tab"
            tabIndex={active === tab ? 0 : -1}
            type="button"
          >
            {labels[tab]}
          </button>
        ))}
      </div>
      {tabs.includes("standings") && snapshot.competitionStandings ? (
        <div
          aria-labelledby={`${id}-standings-tab`}
          className={styles.sidebarPanel}
          hidden={active !== "standings"}
          id={panelId("standings")}
          role="tabpanel"
          tabIndex={0}
        >
          <CompetitionDashboard
            variant="participant"
            standings={snapshot.competitionStandings}
            participantId={snapshot.myParticipantId ?? undefined}
            responseSummary={snapshot.myScoredResponseSummary}
            compact
          />
        </div>
      ) : null}
      <div
        aria-labelledby={`${id}-qna-tab`}
        className={styles.sidebarPanel}
        hidden={active !== "qna"}
        id={panelId("qna")}
        role="tabpanel"
        tabIndex={0}
      >
        <QnaPanel revision={qnaRevision} role="participant" sessionId={sessionId} token={token} />
      </div>
      {snapshot.phase !== "finished" ? (
        <div
          aria-labelledby={`${id}-${audienceView}-tab`}
          className={styles.sidebarPanel}
          hidden={!audienceActive}
          id={panelId("pulse")}
          role="tabpanel"
          tabIndex={0}
        >
          <AudiencePanel
            key={audiencePanelKey}
            realtimeBatch={realtimeBatch}
            role="participant"
            sessionId={sessionId}
            syncRevision={audienceSyncRevision}
            token={token}
            view={audienceView}
          />
        </div>
      ) : null}
    </aside>
  );
}
