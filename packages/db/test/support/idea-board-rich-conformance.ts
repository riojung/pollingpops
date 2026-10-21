import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { IdeaBoardCreateSchema, type IdeaBoardRichContent } from "@openround/contracts";
import {
  createIdeaBoardRepository,
  type MediaAssetCreateInput,
  type Repository,
} from "../../src/index.js";
import { ideaGuestHash } from "./idea-board-conformance.js";

export async function expectIdeaBoardRichConformance(
  repository: Repository,
  workspaceId: string,
  userId: string,
) {
  const boards = createIdeaBoardRepository(repository),
    now = new Date();
  const settings = {
    participantLimit: 10,
    closesAt: new Date(+now + 86_400_000).toISOString(),
    expiresAt: new Date(+now + 2 * 86_400_000).toISOString(),
  };
  const create = async () => {
    const board = await boards.create(
      workspaceId,
      randomUUID(),
      IdeaBoardCreateSchema.parse({ title: "Rich private board" }),
      randomUUID(),
      settings,
      now,
    );
    await boards.hostCommand(workspaceId, board.id, { type: "collect" }, 0, randomUUID(), now);
    return board.id;
  };
  const id = await create(),
    otherId = await create(),
    token = ideaGuestHash(),
    other = ideaGuestHash();
  await boards.join(id, token, null, now);
  await boards.join(id, other, null, now);
  await boards.join(otherId, token, null, now);
  const input = (sizeBytes = 1_024): MediaAssetCreateInput => ({
    id: randomUUID(),
    workspaceId,
    objectKey: `${workspaceId}/quarantine/${randomUUID()}`,
    mimeType: "image/png",
    sizeBytes,
    scanStatus: "pending",
    altText: "Private image",
    createdAt: now,
  });
  const reserve = (boardId = id, sizeBytes?: number) =>
    boards.reserveMedia(boardId, token, input(sizeBytes), now);
  const clean = async (mediaId: string) => {
    const finalizationToken = randomUUID();
    expect(
      await repository.claimMediaAssetFinalization(workspaceId, mediaId, finalizationToken, now),
    ).not.toBeNull();
    expect(
      await repository.updateMediaAsset(workspaceId, mediaId, {
        scanStatus: "clean",
        finalizationToken,
        finalizedAt: now,
      }),
    ).not.toBeNull();
  };
  expect(await boards.getUploadContext(id, token, now)).toBe(workspaceId);
  expect(await boards.isBoardMedia(randomUUID())).toBe(false);
  const image = await reserve();
  expect(await boards.isBoardMedia(image.id)).toBe(true);
  expect(await repository.listMediaReferences(workspaceId, image.id)).toMatchObject([
    { ownerType: "idea_board", ownerId: id },
  ]);
  expect(await boards.getGuestUpload(id, token, image.id, now)).toMatchObject({ id: image.id });
  for (const read of [
    () => boards.getGuestUpload(id, other, image.id, now),
    () => boards.getGuestUpload(otherId, token, image.id, now),
    () => boards.authorizeGuestMedia(id, token, image.id, now),
  ])
    await expect(read()).rejects.toMatchObject({ code: "NOT_FOUND" });
  const rich: IdeaBoardRichContent = {
    attachments: [{ mediaId: image.id, alt: "PRIVATE IMAGE DESCRIPTION" }],
    links: [
      { url: "https://example.com/private", label: "PRIVATE LINK LABEL", imageMediaId: image.id },
    ],
    sketch: {
      schemaVersion: 1,
      width: 1000,
      height: 600,
      elements: [
        {
          id: randomUUID(),
          type: "text",
          x: 10,
          y: 20,
          text: "PRIVATE SKETCH TEXT",
          color: "blue",
          strokeWidth: 2,
          fontSize: 24,
        },
      ],
    },
  };
  await expect(
    boards.submitIdea(id, token, "Private content", randomUUID(), now, rich),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect((await boards.getGuest(id, token, now)).ownIdeas).toEqual([]);
  await clean(image.id);
  expect(await boards.authorizeGuestMedia(id, token, image.id, now)).toBe(workspaceId);
  await expect(
    boards.submitIdea(otherId, token, "Cross board", randomUUID(), now, rich),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    boards.submitIdea(id, other, "Cross guest", randomUUID(), now, rich),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    repository.replaceMediaReferences(workspaceId, "quiz_draft", randomUUID(), [image.id]),
  ).rejects.toThrow();
  const key = randomUUID(),
    submitted = await boards.submitIdea(id, token, "Private content", key, now, rich);
  const ideaId = submitted.ownIdeas[0]!.id;
  expect(submitted.ownIdeas[0]).toMatchObject(rich);
  expect(submitted.board.ideas).toEqual([]);
  expect(await boards.submitIdea(id, token, "Private content", key, now, rich)).toEqual(submitted);
  await expect(
    boards.submitIdea(id, token, "Private content", key, now, { ...rich, links: [] }),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  await expect(boards.authorizeGuestMedia(id, other, image.id, now)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  await expect(
    boards.authorizeHostMedia(workspaceId, id, image.id, false, now),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(await boards.authorizeHostMedia(workspaceId, id, image.id, true, now)).toBe(workspaceId);
  const exported = JSON.stringify((await repository.exportAccount(userId)).ideaBoards);
  expect(exported).toContain("PRIVATE SKETCH TEXT");
  for (const forbidden of ["guestId", "tokenHash", "uploadCount", "uploadBytes", "receipts"])
    expect(exported).not.toContain(forbidden);
  const legacyKey = randomUUID();
  const legacy = await boards.submitIdea(id, token, "Legacy receipt", legacyKey, now);
  expect(
    await boards.submitIdea(id, token, "Legacy receipt", legacyKey, now, {
      attachments: [],
      links: [],
      sketch: null,
    }),
  ).toEqual(legacy);
  expect(legacy.ownIdeas[1]).not.toHaveProperty("attachments");
  let board = await boards.getModerator(workspaceId, id, now);
  board = (
    await boards.hostCommand(
      workspaceId,
      id,
      { type: "moderate", ideaId, status: "approved" },
      board.revision,
      randomUUID(),
      now,
    )
  ).board;
  board = (
    await boards.hostCommand(
      workspaceId,
      id,
      { type: "visibility", visible: true },
      board.revision,
      randomUUID(),
      now,
    )
  ).board;
  expect(await boards.authorizeGuestMedia(id, other, image.id, now)).toBe(workspaceId);
  expect(await boards.authorizeHostMedia(workspaceId, id, image.id, false, now)).toBe(workspaceId);
  board = (
    await boards.hostCommand(
      workspaceId,
      id,
      { type: "moderate", ideaId, status: "removed" },
      board.revision,
      randomUUID(),
      now,
    )
  ).board;
  const serialized = JSON.stringify({
    board,
    retry: await boards.submitIdea(id, token, "Private content", key, now, rich),
    guest: await boards.getGuest(id, token, now),
  });
  for (const forbidden of [
    image.id,
    "PRIVATE IMAGE DESCRIPTION",
    "PRIVATE LINK LABEL",
    "PRIVATE SKETCH TEXT",
  ])
    expect(serialized).not.toContain(forbidden);
  expect(await repository.listMediaReferences(workspaceId, image.id)).toEqual([]);
  expect(await repository.getMediaAsset(workspaceId, image.id)).toMatchObject({
    scanStatus: "deleting",
  });
  expect(await boards.isBoardMedia(image.id)).toBe(true);
  await expect(boards.authorizeGuestMedia(id, token, image.id, now)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  await expect(
    boards.authorizeHostMedia(workspaceId, id, image.id, true, now),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });

  const deletedImage = await reserve();
  // Removed uploads still consume lifetime quota; reservations cannot cycle it away.
  for (let index = 2; index < 40; index++) await reserve();
  const assetCount = (await repository.listMediaAssets(workspaceId)).length;
  await expect(reserve()).rejects.toMatchObject({ code: "ENTITLEMENT_LIMIT" });
  expect((await repository.listMediaAssets(workspaceId)).length).toBe(assetCount);
  await boards.delete(workspaceId, id);
  expect(await repository.listMediaReferences(workspaceId, deletedImage.id)).toEqual([]);
  expect(await repository.getMediaAsset(workspaceId, deletedImage.id)).toMatchObject({
    scanStatus: "deleting",
  });
  expect(await boards.isBoardMedia(deletedImage.id)).toBe(false);
  const expiredImage = await reserve(otherId);
  await clean(expiredImage.id);
  await expect(
    boards.authorizeGuestMedia(otherId, token, expiredImage.id, new Date(settings.expiresAt)),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(await boards.isBoardMedia(expiredImage.id)).toBe(true);
  expect(await repository.purgeExpired(new Date(settings.expiresAt))).toContain(otherId);
  expect(await repository.listMediaReferences(workspaceId, expiredImage.id)).toEqual([]);
  expect(await repository.getMediaAsset(workspaceId, expiredImage.id)).toMatchObject({
    scanStatus: "deleting",
  });
  const bytesId = await create();
  await boards.join(bytesId, token, null, now);
  await expect(
    boards.reserveMedia(bytesId, token, input(10 * 1024 * 1024 + 1), now),
  ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  for (let index = 0; index < 20; index++) await reserve(bytesId, 10 * 1024 * 1024);
  await expect(reserve(bytesId, 1)).rejects.toMatchObject({ code: "ENTITLEMENT_LIMIT" });
  await repository.deleteAccount(userId);
  expect(await boards.list(workspaceId, now)).toEqual([]);
  expect(await repository.listMediaReferences(workspaceId)).toEqual([]);
}
