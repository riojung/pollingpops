import type { CanvasFacilitationCommand, CanvasFacilitationView } from "@openround/contracts";

export function facilitationCommandAllowed(
  command: CanvasFacilitationCommand,
  view: CanvasFacilitationView,
) {
  if ("expectedRevision" in command) return view.capabilities.controlTimer;
  if (command.type === "version_create") return view.capabilities.saveVersion;
  if (command.type === "version_delete") return view.capabilities.deleteVersion;
  if (command.type === "comment_resolve") return view.capabilities.moderateComments;
  if (command.type === "comment_delete" && view.capabilities.moderateComments) return true;
  return view.capabilities.comment;
}

/** Only an explicit review action may replace a stale concurrency fence. */
export function reviewFacilitationCommand(
  command: CanvasFacilitationCommand,
  view: CanvasFacilitationView,
): CanvasFacilitationCommand | null {
  if ("expectedRevision" in command) {
    if (!view.capabilities.controlTimer) return null;
    if (command.type === "timer_pause" && view.timer.status !== "running") return null;
    if (command.type === "timer_resume" && view.timer.status !== "paused") return null;
    return { ...command, expectedRevision: view.timer.revision };
  }
  if (command.type === "version_create") return view.capabilities.saveVersion ? command : null;
  if (command.type === "version_delete") {
    const saved = view.versions.find((version) => version.id === command.versionId);
    return saved && view.capabilities.deleteVersion
      ? { ...command, expectedVersion: saved.version }
      : null;
  }
  if (command.type === "comment_thread_create") return view.capabilities.comment ? command : null;
  const thread = view.threads.find((entry) => entry.id === command.threadId);
  if (!thread) return null;
  if (command.type === "comment_resolve")
    return view.capabilities.moderateComments
      ? { ...command, expectedVersion: thread.version }
      : null;
  if (
    !view.capabilities.comment &&
    !(command.type === "comment_delete" && view.capabilities.moderateComments)
  )
    return null;
  if (command.type === "comment_reply")
    return thread.resolved ? null : { ...command, expectedVersion: thread.version };
  const message = thread.messages.find((entry) => entry.id === command.messageId && !entry.deleted);
  if (
    !message ||
    (message.authorId !== view.actorId &&
      !(command.type === "comment_delete" && view.capabilities.moderateComments))
  )
    return null;
  return { ...command, expectedVersion: thread.version };
}
