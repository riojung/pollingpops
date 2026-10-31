import type { CanvasHistoryHeads, CanvasReceipt } from "./canvas-board-types.js";

/** Same stable action ordering as the full-state view, without copying retained inverse bodies. */
export function canvasHistoryHeads(
  receipts: readonly CanvasReceipt[],
  actorId: string,
): CanvasHistoryHeads {
  let undo: CanvasReceipt | undefined;
  let redo: CanvasReceipt | undefined;
  for (const receipt of receipts) {
    if (receipt.actorId !== actorId || !receipt.undoable) continue;
    const previous = receipt.undone ? redo : undo;
    if (
      previous &&
      (receipt.historySeq ?? receipt.canvasSeq) < (previous.historySeq ?? previous.canvasSeq)
    )
      continue;
    // Equal action sequences retain the original full-read stable array order.
    if (receipt.undone) redo = receipt;
    else undo = receipt;
  }
  return {
    undoOperationId: undo?.operationId ?? null,
    redoOperationId: redo?.operationId ?? null,
  };
}
