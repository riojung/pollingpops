import { describe, expect, it, vi } from "vitest";
import type {
  PresentationCommand,
  PresentationCompanionCommand,
  PresentationControlCommand,
} from "@openround/contracts";
import { createPresentationCommandRecovery } from "./presentation-command-recovery";
import {
  persistPresentationNavigationCommand,
  restorePresentationNavigationCommand,
} from "./presentation-navigation";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
function storage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

describe("Presentation navigation reload recovery", () => {
  it.each(["host", "companion"] as const)(
    "restores all advanced %s absolute actions without changing payload or storing credentials",
    (role) => {
      for (const fields of [
        { action: "set_reveal", blockId: id(3), nodeId: "broadcast-node", revealed: false },
        { action: "navigate_scene", blockId: id(3), nodeId: "navigation-node" },
        { action: "follow_branch", blockId: id(3), branchId: id(4) },
      ] as const) {
        const saved = storage();
        const credential =
          role === "host"
            ? { controlToken: "original-host".repeat(4) }
            : { companionToken: "original-companion".repeat(4) };
        const command = {
          sessionId: id(1),
          commandId: id(2),
          expectedRevision: 7,
          ...fields,
          ...credential,
        } as PresentationControlCommand;
        persistPresentationNavigationCommand(saved, id(1), role, command);
        expect([...saved.values.values()][0]).not.toMatch(/Token|original-host|original-companion/);
        const restored =
          role === "host"
            ? restorePresentationNavigationCommand(saved, id(1), {
                controlToken: "current-host".repeat(4),
              })
            : restorePresentationNavigationCommand(saved, id(1), {
                companionToken: "current-companion".repeat(4),
              });
        expect(restored).toMatchObject({
          sessionId: id(1),
          commandId: id(2),
          expectedRevision: 7,
          ...fields,
        });
        expect(Object.isFrozen(restored)).toBe(true);
      }
    },
  );
  it.each(["jump_to_block", "return_to_path"] as const)(
    "restores the exact host %s intent without persisting a credential",
    async (action) => {
      const saved = storage();
      const command: PresentationCommand = {
        sessionId: id(1),
        controlToken: "old-host-pass".repeat(4),
        commandId: id(2),
        expectedRevision: 7,
        ...(action === "jump_to_block" ? { action, targetBlockId: id(3) } : { action }),
      };
      const execute = vi.fn().mockRejectedValue(new Error("Lost acknowledgement"));
      const first = createPresentationCommandRecovery({
        execute,
        onState: ({ pendingCommand }) =>
          persistPresentationNavigationCommand(saved, id(1), "host", pendingCommand),
      });
      await expect(first.run(command)).rejects.toThrow("Lost acknowledgement");
      const serialized = [...saved.values.values()][0]!;
      expect(serialized).not.toMatch(/Token|pass/);
      const restored = restorePresentationNavigationCommand(saved, id(1), {
        controlToken: "current-host-pass".repeat(4),
      });
      expect(restored).toEqual({ ...command, controlToken: "current-host-pass".repeat(4) });
      expect(Object.isFrozen(restored)).toBe(true);
      const retry = vi.fn().mockResolvedValue({ revision: 20 });
      const reloaded = createPresentationCommandRecovery({
        execute: retry,
        pendingCommand: restored,
        onState: ({ pendingCommand }) =>
          persistPresentationNavigationCommand(saved, id(1), "host", pendingCommand),
      });
      await reloaded.run({ ...command, commandId: id(4), expectedRevision: 20 });
      expect(retry).not.toHaveBeenCalled();
      await reloaded.retry();
      expect(retry).toHaveBeenCalledExactlyOnceWith(restored);
      expect(saved.values.size).toBe(0);
    },
  );

  it("keeps Companion recovery scoped to its role and binds only its current pass", () => {
    const saved = storage();
    const command: PresentationCompanionCommand = {
      sessionId: id(1),
      companionToken: "companion-pass".repeat(4),
      commandId: id(2),
      expectedRevision: 8,
      action: "jump_to_block",
      targetBlockId: id(3),
    };
    persistPresentationNavigationCommand(saved, id(1), "companion", command);
    expect(
      restorePresentationNavigationCommand(saved, id(1), { controlToken: "host-pass".repeat(4) }),
    ).toBeNull();
    expect(
      restorePresentationNavigationCommand(saved, id(9), {
        companionToken: "new-companion-pass".repeat(4),
      }),
    ).toBeNull();
    expect(
      restorePresentationNavigationCommand(saved, id(1), {
        companionToken: "new-companion-pass".repeat(4),
      }),
    ).toEqual({ ...command, companionToken: "new-companion-pass".repeat(4) });
  });

  it.each([
    { action: "jump_to_block", targetBlockId: 1 },
    { action: "jump_to_block", targetBlockId: id(3), targetIndex: 2 },
    { action: "return_to_path", controlToken: "untrusted".repeat(4) },
    { action: "advance" },
  ])("rejects malformed or unrelated stored intents: %j", (fields) => {
    const saved = storage();
    saved.setItem(
      `openround:presentation-navigation:host:${id(1)}`,
      JSON.stringify({
        sessionId: id(1),
        commandId: id(2),
        expectedRevision: 7,
        ...fields,
      }),
    );
    expect(
      restorePresentationNavigationCommand(saved, id(1), { controlToken: "host-pass".repeat(4) }),
    ).toBeNull();
    expect(saved.values.size).toBe(0);
  });
});
