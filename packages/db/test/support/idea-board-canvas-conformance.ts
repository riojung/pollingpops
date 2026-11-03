import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import {
  IdeaBoardCanvasSchema,
  IdeaBoardCreateSchema,
  type IdeaBoardHostCommand,
} from "@openround/contracts";
import { createIdeaBoardRepository, type Repository } from "../../src/index.js";
import { ideaGuestHash } from "./idea-board-conformance.js";

export async function expectIdeaBoardCanvasConformance(
  repository: Repository,
  workspaceId: string,
  userId: string,
) {
  const boards = createIdeaBoardRepository(repository),
    now = new Date(),
    token = ideaGuestHash(),
    other = ideaGuestHash();
  const settings = {
    participantLimit: 10,
    closesAt: new Date(+now + 86_400_000).toISOString(),
    expiresAt: new Date(+now + 2 * 86_400_000).toISOString(),
  };
  const board = await boards.create(
    workspaceId,
    randomUUID(),
    IdeaBoardCreateSchema.parse({ title: "Private spatial workshop", ideasVisible: true }),
    randomUUID(),
    settings,
    now,
  );
  const host = async (command: IdeaBoardHostCommand) => {
    const current = await boards.getModerator(workspaceId, board.id, now);
    return (
      await boards.hostCommand(workspaceId, board.id, command, current.revision, randomUUID(), now)
    ).board;
  };
  await host({ type: "collect" });
  await boards.join(board.id, token, null, now);
  await boards.join(board.id, other, null, now);
  const asset = await boards.reserveMedia(
    board.id,
    token,
    {
      id: randomUUID(),
      workspaceId,
      objectKey: `${workspaceId}/quarantine/${randomUUID()}`,
      mimeType: "image/png",
      sizeBytes: 1024,
      scanStatus: "pending",
      altText: "Spatial image",
      createdAt: now,
    },
    now,
  );
  const canvas = IdeaBoardCanvasSchema.parse({
    schemaVersion: 1,
    x: -440,
    y: 320,
    width: 600,
    height: 400,
    objects: [
      {
        id: randomUUID(),
        type: "sticky",
        x: 20,
        y: 20,
        width: 200,
        height: 160,
        text: "PRIVATE CANVAS TEXT",
      },
      {
        id: randomUUID(),
        type: "image",
        x: 240,
        y: 20,
        width: 200,
        height: 160,
        mediaId: asset.id,
        altText: "PRIVATE CANVAS IMAGE",
      },
    ],
  });
  const rich = { canvas, attachments: [{ mediaId: asset.id, alt: "PRIVATE CANVAS IMAGE" }] };
  await expect(
    boards.submitIdea(board.id, token, "Spatial proposal", randomUUID(), now, rich),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  const finalizationToken = randomUUID();
  expect(
    await repository.claimMediaAssetFinalization(workspaceId, asset.id, finalizationToken, now),
  ).not.toBeNull();
  expect(
    await repository.updateMediaAsset(workspaceId, asset.id, {
      scanStatus: "clean",
      finalizationToken,
      finalizedAt: now,
    }),
  ).not.toBeNull();
  await expect(
    boards.submitIdea(board.id, other, "Foreign image", randomUUID(), now, rich),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  const key = randomUUID();
  const submitted = await boards.submitIdea(board.id, token, "Spatial proposal", key, now, rich);
  const ideaId = submitted.ownIdeas[0]!.id;
  expect(submitted.ownIdeas[0]).toMatchObject({ canvas, status: "pending" });
  expect(submitted.board.ideas).toEqual([]);
  expect((await boards.getGuest(board.id, other, now)).board.ideas).toEqual([]);
  expect(JSON.stringify(await boards.getPublicInfo(board.id, now))).not.toContain("PRIVATE CANVAS");
  expect(await boards.submitIdea(board.id, token, "Spatial proposal", key, now, rich)).toEqual(
    submitted,
  );
  await expect(
    boards.submitIdea(board.id, token, "Spatial proposal", key, now, {
      ...rich,
      canvas: { ...canvas, x: 100 },
    }),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  const exported = JSON.stringify((await repository.exportAccount(userId)).ideaBoards);
  expect(exported).toContain("PRIVATE CANVAS TEXT");
  for (const field of ["guestId", "tokenHash", "receipts", "uploadCount"])
    expect(exported).not.toContain(field);
  await host({ type: "moderate", ideaId, status: "approved" });
  expect((await boards.getGuest(board.id, other, now)).board.ideas[0]).toMatchObject({
    id: ideaId,
    canvas,
  });
  expect(await boards.authorizeGuestMedia(board.id, other, asset.id, now)).toBe(workspaceId);
  await host({ type: "start_voting" });
  await expect(
    boards.submitIdea(board.id, token, "Voting is frozen", randomUUID(), now, rich),
  ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  await boards.vote(board.id, token, [ideaId], 0, randomUUID(), now);
  await host({ type: "close" });
  const reopened = await host({ type: "reopen", roundNumber: 1 });
  expect(reopened).toMatchObject({
    roundNumber: 2,
    expiresAt: settings.expiresAt,
    roundHistory: [{ results: [{ ideaId, voteCount: 1 }], ballotCount: 1 }],
  });
  expect(reopened.ideas[0]?.canvas).toEqual(canvas);
  expect((await boards.getGuest(board.id, token, now)).hasVoted).toBe(false);
  await expect(
    boards.submitIdea(board.id, token, "Stale scene", randomUUID(), now, rich, 1),
  ).rejects.toMatchObject({ code: "STALE_DRAFT" });
  await host({ type: "moderate", ideaId, status: "removed", roundNumber: 2 });
  const removed = JSON.stringify({
    own: (await boards.getGuest(board.id, token, now)).ownIdeas,
    replay: await boards.submitIdea(board.id, token, "Spatial proposal", key, now, rich),
    export: (await repository.exportAccount(userId)).ideaBoards,
  });
  expect(removed).not.toContain("PRIVATE CANVAS");
  expect(removed).not.toContain(asset.id);
  expect(await repository.listMediaReferences(workspaceId, asset.id)).toEqual([]);
  expect(await repository.getMediaAsset(workspaceId, asset.id)).toMatchObject({
    scanStatus: "deleting",
  });
  await expect(boards.authorizeGuestMedia(board.id, token, asset.id, now)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  await expect(
    boards.getGuest(board.id, token, new Date(Date.parse(settings.expiresAt) + 1)),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
}

export async function expectIdeaBoardCanvasBudgetConformance(
  repository: Repository,
  workspaceId: string,
) {
  const boards = createIdeaBoardRepository(repository),
    now = new Date(),
    token = ideaGuestHash();
  const board = await boards.create(
    workspaceId,
    randomUUID(),
    IdeaBoardCreateSchema.parse({ title: "Bounded canvas submissions" }),
    randomUUID(),
    {
      participantLimit: 10,
      closesAt: new Date(+now + 86_400_000).toISOString(),
      expiresAt: new Date(+now + 2 * 86_400_000).toISOString(),
    },
    now,
  );
  await boards.hostCommand(workspaceId, board.id, { type: "collect" }, 0, randomUUID(), now);
  await boards.join(board.id, token, null, now);
  const canvas = IdeaBoardCanvasSchema.parse({
    schemaVersion: 1,
    x: 100,
    y: 100,
    width: 200,
    height: 200,
    objects: Array.from({ length: 32 }, () => ({
      id: randomUUID(),
      type: "sticky",
      x: 10,
      y: 10,
      width: 100,
      height: 100,
      text: "Bounded",
    })),
  });
  for (let index = 0; index < 6; index++)
    await boards.submitIdea(board.id, token, `Composition ${index}`, randomUUID(), now, { canvas });
  await boards.submitIdea(board.id, token, "Legacy idea at 199", randomUUID(), now);
  const before = await boards.getModerator(workspaceId, board.id, now);
  const keys = [randomUUID(), randomUUID()];
  const attempts = await Promise.allSettled(
    keys.map((key) => boards.submitIdea(board.id, token, "Concurrent final slot", key, now)),
  );
  expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
  const rejectedIndex = attempts.findIndex((attempt) => attempt.status === "rejected");
  expect(attempts[rejectedIndex]).toMatchObject({
    status: "rejected",
    reason: {
      code: "ENTITLEMENT_LIMIT",
      message: "This board has reached its 200 submitted canvas object limit",
    },
  });
  const full = await boards.getModerator(workspaceId, board.id, now);
  expect(full.revision).toBe(before.revision + 1);
  expect(full.totalIdeas).toBe(8);
  expect((await boards.getGuest(board.id, token, now)).ownIdeas).toHaveLength(8);
  await boards.hostCommand(
    workspaceId,
    board.id,
    { type: "moderate", ideaId: full.ideas[0]!.id, status: "removed" },
    full.revision,
    randomUUID(),
    now,
  );
  expect(
    (await boards.submitIdea(board.id, token, "Concurrent final slot", keys[rejectedIndex]!, now))
      .ownIdeas,
  ).toHaveLength(9);
}
