import type { IdeaBoardGuestView, IdeaBoardView } from "@openround/contracts";

export const boardId = "00000000-0000-4000-8000-000000000006";
export const boardIdeaId = "00000000-0000-4000-8000-000000000007";
export const boardFixture: IdeaBoardView = {
  schemaVersion: 1,
  id: boardId,
  title: "Synthetic priorities",
  description: "What should we improve?",
  status: "collecting",
  revision: 1,
  identityMode: "anonymous",
  moderationEnabled: true,
  voteBudget: 3,
  participantLimit: 250,
  participantCount: 2,
  totalIdeas: 1,
  ideasVisible: true,
  countsVisible: false,
  createdAt: "2026-10-16T12:00:00.000Z",
  closesAt: "2026-10-23T12:00:00.000Z",
  expiresAt: "2026-11-23T12:00:00.000Z",
  groups: [],
  ideas: [
    {
      id: boardIdeaId,
      body: "Synthetic accessible idea",
      alias: null,
      groupId: null,
      status: "approved",
      createdAt: "2026-10-16T12:01:00.000Z",
      voteCount: null,
    },
  ],
};
export const boardGuestFixture: IdeaBoardGuestView = {
  board: { ...boardFixture, participantCount: null },
  ownIdeas: [],
  votedIdeaIds: [],
  revision: 0,
};
