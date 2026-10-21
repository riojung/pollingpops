import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { IdeaBoardCreateSchema, type IdeaBoardRichContent } from "@openround/contracts";
import { MemoryRepository, createIdeaBoardRepository } from "../src/index.js";
import { expectIdeaBoardRichConformance } from "./support/idea-board-rich-conformance.js";
import {
  expectIdeaBoardConformance,
  expectIdeaBoardAdmissionConformance,
  ideaGuestHash,
} from "./support/idea-board-conformance.js";

async function fixture() {
  const repository = new MemoryRepository(),
    tokenHash = ideaGuestHash(),
    now = new Date();
  await repository.createMagicToken({
    id: randomUUID(),
    email: `ideas-${randomUUID()}@example.test`,
    segment: "workplace",
    tokenHash,
    policyVersion: "test",
    expiresAt: new Date(now.getTime() + 60_000),
    consumedAt: null,
  });
  const owner = (await repository.consumeMagicToken(tokenHash, now))!;
  return { repository, owner, boards: createIdeaBoardRepository(repository) };
}
describe("standalone idea board durable state", () => {
  it("keeps rich ideas and exclusively owned images private through moderation, retries and deletion", async () => {
    const { repository, owner } = await fixture();
    await expectIdeaBoardRichConformance(repository, owner.workspaceId, owner.userId);
  });
  it("rejects rich content atomically when the retained board reaches one MiB", async () => {
    const { boards, owner } = await fixture(),
      now = new Date();
    const draft = await boards.create(
      owner.workspaceId,
      randomUUID(),
      IdeaBoardCreateSchema.parse({ title: "Bounded drawings", moderationEnabled: false }),
      randomUUID(),
      {
        participantLimit: 20,
        closesAt: new Date(+now + 86_400_000).toISOString(),
        expiresAt: new Date(+now + 2 * 86_400_000).toISOString(),
      },
      now,
    );
    await boards.hostCommand(
      owner.workspaceId,
      draft.id,
      { type: "collect" },
      0,
      randomUUID(),
      now,
    );
    const rich: IdeaBoardRichContent = {
      sketch: {
        schemaVersion: 1,
        width: 1000,
        height: 600,
        elements: Array.from({ length: 32 }, () => ({
          id: randomUUID(),
          type: "text",
          x: 10,
          y: 20,
          text: "x".repeat(300),
          color: "ink",
          strokeWidth: 2,
          fontSize: 24,
        })),
      },
    };
    let rejected = false;
    for (let participant = 0; participant < 10 && !rejected; participant++) {
      const token = ideaGuestHash();
      await boards.join(draft.id, token, null, now);
      for (let index = 0; index < 10; index++) {
        const before = await boards.getModerator(owner.workspaceId, draft.id, now);
        try {
          await boards.submitIdea(draft.id, token, "A diagram", randomUUID(), now, rich);
        } catch (error) {
          expect(error).toMatchObject({ code: "ENTITLEMENT_LIMIT" });
          expect(await boards.getModerator(owner.workspaceId, draft.id, now)).toEqual(before);
          rejected = true;
          break;
        }
      }
    }
    expect(rejected).toBe(true);
  });
  it("conforms for lifecycle, private collection, moderation, groups, final concurrent ballots and safe retries", async () => {
    const { repository, owner } = await fixture();
    await expectIdeaBoardConformance(repository, owner.workspaceId, randomUUID());
    const exported = JSON.stringify((await repository.exportAccount(owner.userId)).ideaBoards);
    for (const forbidden of [
      "tokenHash",
      "guestId",
      "votedIdeaIds",
      "guests",
      "receipts",
      "PRIVATE REMOVED IDEA",
    ])
      expect(exported).not.toContain(forbidden);
    expect(exported).toContain('"voteCount":2');
  });
  it("serializes admission and enforces restrictions, frozen capacity, per-guest bounds and deadlines", async () => {
    const { repository, owner } = await fixture();
    await expectIdeaBoardAdmissionConformance(repository, owner.workspaceId);
  });
  it("retains board-only aliases on approved ideas and cascades explicit deletion, expiry and account deletion", async () => {
    const { repository, owner, boards } = await fixture(),
      now = new Date();
    const settings = {
      participantLimit: 2,
      closesAt: new Date(now.getTime() + 86_400_000).toISOString(),
      expiresAt: new Date(now.getTime() + 2 * 86_400_000).toISOString(),
    };
    const create = async () =>
      boards.create(
        owner.workspaceId,
        randomUUID(),
        IdeaBoardCreateSchema.parse({
          title: "Alias board",
          identityMode: "alias",
          moderationEnabled: false,
          ideasVisible: true,
        }),
        randomUUID(),
        settings,
        now,
      );
    const board = await create();
    await boards.hostCommand(
      owner.workspaceId,
      board.id,
      { type: "collect" },
      0,
      randomUUID(),
      now,
    );
    const token = ideaGuestHash();
    await expect(boards.join(board.id, token, null, now)).rejects.toThrow();
    await boards.join(board.id, token, "Board-only name", now);
    expect(
      (await boards.submitIdea(board.id, token, "Literal <script>text</script>", randomUUID(), now))
        .board.ideas[0],
    ).toMatchObject({ body: "Literal <script>text</script>", alias: "Board-only name" });
    await boards.delete(owner.workspaceId, board.id);
    await expect(
      boards.create(
        owner.workspaceId,
        board.id,
        IdeaBoardCreateSchema.parse({
          title: "Alias board",
          identityMode: "alias",
          moderationEnabled: false,
          ideasVisible: true,
        }),
        randomUUID(),
        { ...settings, replayOnly: true },
        now,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(boards.getGuest(board.id, token, now)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const expiring = await create();
    expect(await repository.purgeExpired(new Date(settings.expiresAt))).toContain(expiring.id);
    expect((await repository.exportAccount(owner.userId)).ideaBoards).toEqual([]);
    await create();
    await repository.deleteAccount(owner.userId);
    expect(await boards.list(owner.workspaceId, now)).toEqual([]);
  });
  it("excludes expired boards from account exports before the purge worker runs", async () => {
    const { repository, owner, boards } = await fixture();
    const now = new Date("2000-01-01T00:00:00.000Z");
    const board = await boards.create(
      owner.workspaceId,
      randomUUID(),
      IdeaBoardCreateSchema.parse({ title: "Expired private board" }),
      randomUUID(),
      {
        participantLimit: 2,
        closesAt: "2000-01-02T00:00:00.000Z",
        expiresAt: "2000-02-01T00:00:00.000Z",
      },
      now,
    );
    await expect(
      boards.getModerator(owner.workspaceId, board.id, new Date()),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await repository.exportAccount(owner.userId)).ideaBoards).toEqual([]);
  });
});
