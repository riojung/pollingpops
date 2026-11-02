import { randomUUID } from "node:crypto";
import {
  CANVAS_SCHEMA_VERSION,
  CanvasBoardMutationSchema,
  CanvasBoardMutationResponseSchema,
  type CanvasBoardMutation,
  type CanvasBoardView,
} from "../../packages/contracts/src/index.ts";
import {
  CanvasTargetFailure,
  canvasTargetReceiptCeiling,
  canvasTargetRestoreEligible,
} from "./canvas-target-config.ts";

type TargetText = { id: string; text: string; version: number };
type Proposal = Pick<TargetText, "text" | "version">;
export type CanvasTargetRestoreOutcome =
  | "restored"
  | "fenced-unchanged"
  | "skipped-conflict"
  | "skipped-budget"
  | "skipped-cleanup-deadline";

/** Read must freshly validate board authority and target editability, just as normal preflight does. */
export async function restoreCanvasTargetText(input: {
  original: TargetText;
  attempted: Proposal;
  acknowledged?: Proposal;
  deadline: number;
  read: () => Promise<CanvasBoardView>;
  write: (mutation: CanvasBoardMutation) => Promise<unknown>;
}): Promise<CanvasTargetRestoreOutcome> {
  let proposalWonRace = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (performance.now() >= input.deadline) return "skipped-cleanup-deadline";
    const current = await input.read(),
      object = current.objects.find(({ id }) => id === input.original.id),
      prior = input.acknowledged ?? input.original;
    if (
      !object ||
      (!canvasTargetRestoreEligible(object, input.attempted) &&
        (proposalWonRace ||
          object.version !== input.attempted.version - 1 ||
          !canvasTargetRestoreEligible(object, prior)))
    )
      return "skipped-conflict";
    if (current.canvasSeq + 1 > canvasTargetReceiptCeiling) return "skipped-budget";
    if (performance.now() >= input.deadline) return "skipped-cleanup-deadline";
    const operation = CanvasBoardMutationSchema.parse({
      schemaVersion: CANVAS_SCHEMA_VERSION,
      operationId: randomUUID(),
      command: {
        type: "batch",
        operations: [
          {
            type: "update",
            id: object.id,
            expectedVersion: object.version,
            patch: { text: input.original.text },
          },
        ],
      },
    });
    let response: unknown;
    try {
      // Even identical text must advance the version before a delayed server handler can write.
      response = await input.write(operation);
    } catch (error) {
      if (
        attempt === 0 &&
        canvasTargetRestoreEligible(object, prior) &&
        object.version === input.attempted.version - 1 &&
        error instanceof CanvasTargetFailure &&
        error.code === "TARGET_HTTP" &&
        error.status === 409
      ) {
        // Only an exact own proposal at its expected next version permits the second write.
        // No retry of a timeout, lost/malformed response, rate limit or authority denial.
        proposalWonRace = true;
        continue;
      }
      throw error;
    }
    const parsed = CanvasBoardMutationResponseSchema.safeParse(response);
    if (
      !parsed.success ||
      parsed.data.receipt.operationId !== operation.operationId ||
      parsed.data.receipt.canvasSeq > parsed.data.board.canvasSeq ||
      parsed.data.receipt.canvasSeq <= current.canvasSeq ||
      parsed.data.board.id !== current.id ||
      parsed.data.board.workspaceId !== current.workspaceId ||
      !parsed.data.board.objects.some(
        (value) =>
          value.id === object.id &&
          value.text === input.original.text &&
          value.version === object.version + 1,
      )
    )
      throw new CanvasTargetFailure("ACK_INVALID");
    return object.text === input.original.text ? "fenced-unchanged" : "restored";
  }
  throw new CanvasTargetFailure("ACK_INVALID");
}
