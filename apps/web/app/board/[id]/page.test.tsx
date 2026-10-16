import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import GuestPage from "./page";
import HostPage from "../../boards/[id]/page";
import { boardId, boardIdeaId } from "../../../test-utils/idea-board";

describe("board navigation state isolation", () => {
  it("gives each participant route its own React state identity for drafts, ballots and credentials", async () => {
    const first = await GuestPage({ params: Promise.resolve({ id: boardId }) });
    const second = await GuestPage({ params: Promise.resolve({ id: boardIdeaId }) });
    expect(first.key).toBe(boardId);
    expect(second.key).toBe(boardIdeaId);
    expect(first.key).not.toBe(second.key);
  });

  it("isolates host moderation state and pending command intents between boards", async () => {
    const first = await HostPage({ params: Promise.resolve({ id: boardId }) });
    const second = await HostPage({ params: Promise.resolve({ id: boardIdeaId }) });
    const firstChild = first.props.children as ReactElement;
    const secondChild = second.props.children as ReactElement;
    expect(firstChild.key).toBe(boardId);
    expect(secondChild.key).toBe(boardIdeaId);
  });
});
