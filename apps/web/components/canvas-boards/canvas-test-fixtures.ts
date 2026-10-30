import { CanvasBoardViewSchema, CanvasObjectSchema } from "@openround/contracts";

export const canvasId = "00000000-0000-4000-8000-000000000091";
export const canvasObject = CanvasObjectSchema.parse({
  id: "00000000-0000-4000-8000-000000000092",
  type: "sticky",
  version: 1,
  x: 20,
  y: 30,
  width: 200,
  height: 160,
  text: "Synthetic canvas note",
});
export const canvasBoard = CanvasBoardViewSchema.parse({
  schemaVersion: 1,
  id: canvasId,
  workspaceId: "00000000-0000-4000-8000-000000000093",
  organizationId: "00000000-0000-4000-8000-000000000094",
  ownerUserId: "00000000-0000-4000-8000-000000000095",
  title: "Synthetic canvas",
  boardType: "team",
  sourceBoardId: null,
  status: "active",
  canvasSeq: 1,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  expiresAt: "2026-11-01T00:00:00.000Z",
  role: "owner",
  capabilities: { edit: true, facilitate: true, share: true, delete: true, archive: true },
  objects: [canvasObject],
  grants: [],
  invitations: [],
  undoOperationId: null,
  redoOperationId: null,
});
