import { CanvasFacilitationViewSchema } from "@openround/contracts";
import { canvasBoard, canvasObject } from "./canvas-test-fixtures";
export const facilitationFixture = CanvasFacilitationViewSchema.parse({
  schemaVersion: 1,
  boardId: canvasBoard.id,
  canvasSeq: 1,
  actorId: canvasBoard.ownerUserId,
  serverNow: "2026-11-01T12:00:00.000Z",
  timer: { revision: 0, status: "idle", durationSeconds: null, remainingMs: 0, deadlineAt: null },
  capabilities: {
    comment: true,
    moderateComments: true,
    controlTimer: true,
    saveVersion: true,
    deleteVersion: true,
  },
  threads: [
    {
      id: "00000000-0000-4000-8000-000000000001",
      objectId: canvasObject.id,
      version: 1,
      resolved: false,
      createdAt: "2026-11-01T12:00:00.000Z",
      updatedAt: "2026-11-01T12:00:00.000Z",
      messages: [
        {
          id: "00000000-0000-4000-8000-000000000002",
          authorId: canvasBoard.ownerUserId,
          text: "A plain comment",
          version: 1,
          createdAt: "2026-11-01T12:00:00.000Z",
          updatedAt: "2026-11-01T12:00:00.000Z",
          deleted: false,
        },
      ],
    },
  ],
  versions: [
    {
      id: "00000000-0000-4000-8000-000000000003",
      name: "Before discussion",
      version: 1,
      createdAt: "2026-11-01T12:00:00.000Z",
      createdBy: canvasBoard.ownerUserId,
      canvasSeq: 1,
      objectCount: 1,
    },
  ],
});
