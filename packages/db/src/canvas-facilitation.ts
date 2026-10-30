import {
  CANVAS_MAX_COMMENT_BYTES,
  CANVAS_MAX_COMMENT_MESSAGES,
  CANVAS_MAX_COMMENT_THREADS,
  CANVAS_MAX_THREAD_MESSAGES,
  CANVAS_MAX_HISTORY_BYTES,
  CANVAS_MAX_SAVED_VERSIONS,
  CANVAS_MAX_VERSION_BYTES,
  type CanvasFacilitationCommand,
  type CanvasObject,
  type CanvasTimer,
  type IdeaBoardStored,
} from "@openround/contracts";
import type { CanvasFacilitationStored, CanvasState } from "./canvas-board-types.js";
import { CanvasBoardError } from "./canvas-board-error.js";

export function canvasDefaultTimer(): CanvasTimer {
  return { revision: 0, status: "idle", durationSeconds: null, remainingMs: 0, deadlineAt: null };
}
export function canvasFacilitation(state: CanvasState): CanvasFacilitationStored {
  return (state.facilitation ??= {
    threads: [],
    versions: [],
    timer: canvasDefaultTimer(),
  });
}
export function canvasTimerAt(timer: CanvasTimer, now: Date): CanvasTimer {
  if (timer.status !== "running") return { ...timer };
  const remainingMs = Math.max(0, Date.parse(timer.deadlineAt!) - now.getTime());
  return { ...timer, remainingMs, status: remainingMs ? "running" : "finished" };
}
export function canvasHistoricalObjects(objects: CanvasObject[], source: IdeaBoardStored | null) {
  const approved = new Set(
    source?.ideas.filter((idea) => idea.status === "approved").map((idea) => idea.id),
  );
  let safe = objects
    .filter((object) => object.type !== "idea_ref" || approved.has(object.ideaId))
    .map(({ idea: _idea, ...object }) => {
      void _idea;
      return object as CanvasObject;
    });
  for (let pass = 0; pass < 500; pass++) {
    const ids = new Set(safe.map((object) => object.id));
    const next = safe.filter(
      (object) =>
        object.type !== "connector" ||
        ((!object.from.objectId || ids.has(object.from.objectId)) &&
          (!object.to.objectId || ids.has(object.to.objectId))),
    );
    if (next.length === safe.length)
      return safe.map((object) => ({
        ...object,
        parentId: object.parentId && !ids.has(object.parentId) ? null : object.parentId,
      }));
    safe = next;
  }
  return [];
}
/** Removal is terminal for anchored discussion; snapshots never keep canonical guest bodies. */
export function sanitizeCanvasFacilitation(state: CanvasState, source: IdeaBoardStored | null) {
  if (!state.facilitation) return;
  const ids = new Set(canvasHistoricalObjects(state.objects, source).map((object) => object.id));
  state.facilitation.threads = state.facilitation.threads.filter((thread) =>
    ids.has(thread.objectId),
  );
  for (const saved of state.facilitation.versions) {
    saved.objects = canvasHistoricalObjects(saved.objects, source);
    saved.metadata.objectCount = saved.objects.length;
  }
}
function invalid(message: string): never {
  throw new CanvasBoardError("VALIDATION_ERROR", message);
}
function stale() {
  throw new CanvasBoardError(
    "STALE_DRAFT",
    "This discussion or timer changed; review the latest state",
  );
}
export function applyCanvasComment(
  stored: CanvasFacilitationStored,
  command: Extract<CanvasFacilitationCommand, { type: `comment_${string}` }>,
  actorId: string,
  moderator: boolean,
  visibleObjectIds: Set<string>,
  now: string,
) {
  const thread = stored.threads.find((entry) => entry.id === command.threadId);
  if (command.type === "comment_thread_create") {
    if (
      thread ||
      stored.threads.some((entry) =>
        entry.messages.some((message) => message.id === command.messageId),
      )
    )
      invalid("Choose new discussion identifiers");
    if (!visibleObjectIds.has(command.objectId))
      throw new CanvasBoardError("NOT_FOUND", "Choose a currently visible canvas object");
    if (stored.threads.length >= CANVAS_MAX_COMMENT_THREADS)
      invalid("Use up to 100 anchored discussions");
    stored.threads.push({
      id: command.threadId,
      objectId: command.objectId,
      version: 1,
      resolved: false,
      createdAt: now,
      updatedAt: now,
      messages: [
        {
          id: command.messageId,
          authorId: actorId,
          text: command.text,
          version: 1,
          createdAt: now,
          updatedAt: now,
          deleted: false,
        },
      ],
    });
  } else {
    if (!thread || !visibleObjectIds.has(thread.objectId))
      throw new CanvasBoardError("NOT_FOUND", "Discussion is no longer available");
    if (thread.version !== command.expectedVersion) stale();
    if (command.type === "comment_resolve") {
      if (!moderator)
        throw new CanvasBoardError("FORBIDDEN", "A facilitator can resolve discussions");
      thread.resolved = command.resolved;
    } else if (command.type === "comment_reply") {
      if (thread.resolved) invalid("Reopen this discussion before replying");
      if (thread.messages.length >= CANVAS_MAX_THREAD_MESSAGES)
        invalid("Use up to 20 messages per discussion");
      if (
        stored.threads.some((entry) =>
          entry.messages.some((message) => message.id === command.messageId),
        )
      )
        invalid("Choose a new message identifier");
      thread.messages.push({
        id: command.messageId,
        authorId: actorId,
        text: command.text,
        version: 1,
        createdAt: now,
        updatedAt: now,
        deleted: false,
      });
    } else {
      const message = thread.messages.find((entry) => entry.id === command.messageId);
      if (!message || message.deleted)
        throw new CanvasBoardError("NOT_FOUND", "Message is no longer available");
      if (message.authorId !== actorId && !(moderator && command.type === "comment_delete"))
        throw new CanvasBoardError("FORBIDDEN", "Only the author can edit this message");
      message.text = command.type === "comment_delete" ? "" : command.text;
      message.deleted = command.type === "comment_delete";
      message.version++;
      message.updatedAt = now;
    }
    thread.version++;
    thread.updatedAt = now;
  }
  if (
    stored.threads.reduce((count, entry) => count + entry.messages.length, 0) >
      CANVAS_MAX_COMMENT_MESSAGES ||
    Buffer.byteLength(JSON.stringify(stored.threads)) > CANVAS_MAX_COMMENT_BYTES
  )
    invalid("This canvas has reached its retained discussion limit");
}
export function applyCanvasTimer(
  stored: CanvasFacilitationStored,
  command: Extract<CanvasFacilitationCommand, { type: `timer_${string}` }>,
  now: Date,
) {
  const timer = canvasTimerAt(stored.timer, now);
  if (timer.revision !== command.expectedRevision) stale();
  if (command.type === "timer_start")
    stored.timer = {
      revision: timer.revision + 1,
      status: "running",
      durationSeconds: command.durationSeconds,
      remainingMs: command.durationSeconds * 1000,
      deadlineAt: new Date(now.getTime() + command.durationSeconds * 1000).toISOString(),
    };
  else if (command.type === "timer_reset")
    stored.timer = {
      revision: timer.revision + 1,
      status: "idle",
      durationSeconds: null,
      remainingMs: 0,
      deadlineAt: null,
    };
  else if (command.type === "timer_pause") {
    if (timer.status !== "running") invalid("Only a running timer can be paused");
    stored.timer = { ...timer, revision: timer.revision + 1, status: "paused", deadlineAt: null };
  } else {
    if (timer.status !== "paused" || timer.remainingMs <= 0)
      invalid("Only a paused timer can be resumed");
    stored.timer = {
      ...timer,
      revision: timer.revision + 1,
      status: "running",
      deadlineAt: new Date(now.getTime() + timer.remainingMs).toISOString(),
    };
  }
}
export function validateCanvasVersions(stored: CanvasFacilitationStored) {
  if (
    stored.versions.length > CANVAS_MAX_SAVED_VERSIONS ||
    stored.versions.some(
      (saved) => Buffer.byteLength(JSON.stringify(saved.objects)) > CANVAS_MAX_VERSION_BYTES,
    ) ||
    Buffer.byteLength(JSON.stringify(stored.versions)) > CANVAS_MAX_HISTORY_BYTES
  )
    invalid(
      "Keep up to 10 checkpoints and 4 MiB of retained history; delete a checkpoint before saving another",
    );
}
