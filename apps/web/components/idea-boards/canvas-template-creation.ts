import {
  CANVAS_SCHEMA_VERSION,
  CanvasBoardCreateSchema,
  IdeaBoardCreateSchema,
  CANVAS_TEMPLATE_IDS,
  type CanvasBoardCreate,
  type CanvasTemplateId,
  type IdeaBoardCreate,
} from "@openround/contracts";
import { createIdeaBoard, ideaBoardCreateIntent } from "../../lib/idea-board-client";
import { clientUuid } from "../../lib/uuid";
import { createCanvas } from "../canvas-boards/canvas-client";

export interface WorkshopTemplateIntent {
  version: 1;
  canvasSchemaVersion?: 2 | 3;
  userId: string;
  workspaceId: string;
  source: ReturnType<typeof ideaBoardCreateIntent>;
  canvasOperationId: string;
  templateId: CanvasTemplateId;
  sourceBoardId?: string;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function workshopTemplateIntent(
  userId: string,
  workspaceId: string,
  input: IdeaBoardCreate,
  templateId: CanvasTemplateId,
): WorkshopTemplateIntent {
  return parseWorkshopTemplateIntent(
    {
      version: 1,
      canvasSchemaVersion: CANVAS_SCHEMA_VERSION,
      userId,
      workspaceId,
      source: ideaBoardCreateIntent({ ...input, title: input.title.trim() }),
      canvasOperationId: clientUuid(),
      templateId,
    },
    userId,
    workspaceId,
  );
}

/** Local setup is untrusted; it only supplies inputs to fresh server authorization. */
export function parseWorkshopTemplateIntent(
  value: unknown,
  userId: string,
  workspaceId: string,
): WorkshopTemplateIntent {
  if (!value || typeof value !== "object") throw new Error("Invalid saved setup");
  const record = value as Record<string, unknown>;
  const fields = [
    "version",
    "userId",
    "workspaceId",
    "source",
    "canvasOperationId",
    "canvasSchemaVersion",
    "templateId",
    "sourceBoardId",
  ];
  if (
    Object.keys(record).some((field) => !fields.includes(field)) ||
    record.version !== 1 ||
    (record.canvasSchemaVersion !== undefined &&
      record.canvasSchemaVersion !== 2 &&
      record.canvasSchemaVersion !== 3) ||
    record.userId !== userId ||
    record.workspaceId !== workspaceId ||
    !uuid.test(userId) ||
    !uuid.test(workspaceId) ||
    typeof record.canvasOperationId !== "string" ||
    !uuid.test(record.canvasOperationId) ||
    !CANVAS_TEMPLATE_IDS.includes(record.templateId as CanvasTemplateId) ||
    !record.source ||
    typeof record.source !== "object" ||
    (record.sourceBoardId !== undefined &&
      (typeof record.sourceBoardId !== "string" || !uuid.test(record.sourceBoardId)))
  )
    throw new Error("Invalid saved setup");
  const { idempotencyKey, ...source } = record.source as Record<string, unknown>;
  if (typeof idempotencyKey !== "string" || !uuid.test(idempotencyKey))
    throw new Error("Invalid creation key");
  const input = IdeaBoardCreateSchema.parse(source);
  const canvasSchemaVersion =
    record.canvasSchemaVersion === undefined ? 2 : record.canvasSchemaVersion;
  CanvasBoardCreateSchema.parse({
    schemaVersion: canvasSchemaVersion,
    workspaceId,
    title: input.title,
    boardType: "workshop",
    sourceBoardId: record.sourceBoardId ?? workspaceId,
    operationId: record.canvasOperationId,
    templateId: record.templateId,
  });
  return {
    version: 1,
    userId,
    workspaceId,
    source: { ...input, idempotencyKey },
    canvasSchemaVersion: canvasSchemaVersion as 2 | 3,
    canvasOperationId: record.canvasOperationId,
    templateId: record.templateId as CanvasTemplateId,
    ...(record.sourceBoardId ? { sourceBoardId: record.sourceBoardId as string } : {}),
  };
}

/** Checkpoint before both writes; a retry always reuses the exact accepted source/canvas keys. */
export async function finishWorkshopTemplate(
  intent: WorkshopTemplateIntent,
  checkpoint: (intent: WorkshopTemplateIntent) => void,
  signal?: AbortSignal,
) {
  checkpoint(intent);
  if (!intent.sourceBoardId) {
    const source = await createIdeaBoard(intent.source, signal, {
      userId: intent.userId,
      workspaceId: intent.workspaceId,
    });
    // Keep the acknowledged source in memory even if the next storage write fails.
    intent.sourceBoardId = source.id;
    checkpoint(intent);
  }
  if (signal?.aborted) throw new DOMException("Creation interrupted", "AbortError");
  const canvas: CanvasBoardCreate = CanvasBoardCreateSchema.parse({
    schemaVersion: intent.canvasSchemaVersion ?? 2,
    workspaceId: intent.workspaceId,
    title: intent.source.title,
    boardType: "workshop",
    sourceBoardId: intent.sourceBoardId,
    operationId: intent.canvasOperationId,
    templateId: intent.templateId,
  });
  return createCanvas(canvas, signal, { userId: intent.userId, workspaceId: intent.workspaceId });
}
