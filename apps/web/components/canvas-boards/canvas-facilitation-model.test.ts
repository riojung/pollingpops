import { describe, expect, it } from "vitest";
import { reviewFacilitationCommand } from "./canvas-facilitation-model";
import { canvasTimerRemaining } from "./canvas-timer";
import { facilitationFixture as view } from "./canvas-facilitation-test-fixtures";
describe("facilitation conflict review and countdown", () => {
  it("changes a stale fence only after explicit review while preserving the comment proposal", () => {
    const thread = view.threads[0]!;
    const command = {
      type: "comment_edit" as const,
      threadId: thread.id,
      expectedVersion: 1,
      messageId: thread.messages[0]!.id,
      text: "My retained proposal",
    };
    const next = { ...view, threads: [{ ...thread, version: 5 }] };
    expect(reviewFacilitationCommand(command, next)).toEqual({ ...command, expectedVersion: 5 });
    expect(command.expectedVersion).toBe(1);
    expect(reviewFacilitationCommand(command, { ...next, actorId: view.boardId })).toBeNull();
    expect(reviewFacilitationCommand(command, { ...next, threads: [] })).toBeNull();
    expect(
      reviewFacilitationCommand(command, {
        ...next,
        capabilities: { ...next.capabilities, comment: false },
      }),
    ).toBeNull();
  });
  it("allows moderator removal but never another author's edit", () => {
    const thread = view.threads[0]!;
    const foreign = { ...view, actorId: view.boardId };
    expect(
      reviewFacilitationCommand(
        {
          type: "comment_delete",
          threadId: thread.id,
          expectedVersion: 0,
          messageId: thread.messages[0]!.id,
        },
        foreign,
      ),
    ).toMatchObject({ expectedVersion: thread.version });
  });
  it("derives running time from server time and monotonic elapsed, clamps zero and holds paused time", () => {
    const timer = {
      ...view.timer,
      status: "running" as const,
      durationSeconds: 60,
      remainingMs: 60000,
      deadlineAt: "2026-11-01T12:01:00.000Z",
    };
    expect(canvasTimerRemaining(timer, view.serverNow, 1250)).toBe(58750);
    expect(canvasTimerRemaining(timer, view.serverNow, 90000)).toBe(0);
    expect(
      canvasTimerRemaining({ ...timer, status: "paused", deadlineAt: null }, view.serverNow, 90000),
    ).toBe(60000);
    expect(canvasTimerRemaining(timer, "2026-11-01T12:00:30.000Z", 1000)).toBe(29000);
  });
});
