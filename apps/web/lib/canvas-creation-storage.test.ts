import { CANVAS_SCHEMA_VERSION } from "@openround/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearCanvasCreationSetups,
  clearOtherCanvasCreationSetups,
  readCanvasCreationSetup,
  removeCanvasCreationSetup,
  saveCanvasCreationSetup,
} from "./canvas-creation-storage";

const entries = new Map<string, string>();
const storage = {
  get length() {
    return entries.size;
  },
  key: (index: number) => [...entries.keys()][index] ?? null,
  getItem: (key: string) => entries.get(key) ?? null,
  setItem: (key: string, value: string) => {
    entries.set(key, value);
  },
  removeItem: (key: string) => {
    entries.delete(key);
  },
};
beforeEach(() => {
  entries.clear();
  vi.stubGlobal("window", { sessionStorage: storage });
});
afterEach(() => vi.unstubAllGlobals());

describe("tab-scoped canvas setup storage", () => {
  it.each([undefined, 2, 3, CANVAS_SCHEMA_VERSION])(
    "preserves a schema %s uncertain checkpoint without changing its local envelope or retry keys",
    (canvasSchemaVersion) => {
      const checkpoint = {
        version: 1,
        ...(canvasSchemaVersion === undefined ? {} : { canvasSchemaVersion }),
        userId: "00000000-0000-4000-8000-000000000001",
        workspaceId: "00000000-0000-4000-8000-000000000002",
        canvasOperationId: "00000000-0000-4000-8000-000000000010",
        source: {
          idempotencyKey: "00000000-0000-4000-8000-000000000011",
          title: "Recover exact setup",
        },
        sourceBoardId: "00000000-0000-4000-8000-000000000012",
        templateId: "project-kickoff",
      };
      const raw = JSON.stringify(checkpoint);
      saveCanvasCreationSetup(checkpoint.userId, checkpoint.workspaceId, checkpoint);
      expect(
        entries.get(`pollingpops:canvas-setup:v1:${checkpoint.userId}:${checkpoint.workspaceId}`),
      ).toBe(raw);
      expect(readCanvasCreationSetup(checkpoint.userId, checkpoint.workspaceId)).toEqual(
        checkpoint,
      );
      expect(entries.size).toBe(1);
    },
  );
  it("keeps workspace setups separate and clears only the signed-out user's setup", () => {
    saveCanvasCreationSetup("alice", "one", { setup: "first" });
    saveCanvasCreationSetup("alice", "two", { setup: "second" });
    saveCanvasCreationSetup("bob", "one", { setup: "other identity" });
    entries.set("unrelated", "keep this");
    expect(readCanvasCreationSetup("alice", "two")).toEqual({ setup: "second" });
    expect(readCanvasCreationSetup("alice", "three")).toBeNull();
    clearCanvasCreationSetups("alice");
    expect(readCanvasCreationSetup("alice", "one")).toBeNull();
    expect(readCanvasCreationSetup("alice", "two")).toBeNull();
    expect(readCanvasCreationSetup("bob", "one")).toEqual({ setup: "other identity" });
    expect(entries.get("unrelated")).toBe("keep this");
  });
  it("clears the previous identity only after a verified new identity is known", () => {
    saveCanvasCreationSetup("alice", "one", { setup: "old" });
    saveCanvasCreationSetup("bob", "one", { setup: "current" });
    clearOtherCanvasCreationSetups("bob");
    expect(readCanvasCreationSetup("alice", "one")).toBeNull();
    expect(readCanvasCreationSetup("bob", "one")).toEqual({ setup: "current" });
    removeCanvasCreationSetup("bob", "one");
    expect(entries.size).toBe(0);
  });
  it("bounds stored data and tolerates unavailable storage during signout cleanup", () => {
    expect(() => saveCanvasCreationSetup("alice", "one", { text: "x".repeat(16_384) })).toThrow(
      "large",
    );
    expect(entries.size).toBe(0);
    Object.defineProperty(window, "sessionStorage", {
      get: () => {
        throw new Error("Blocked");
      },
    });
    expect(() => readCanvasCreationSetup("alice", "one")).toThrow();
    expect(() => clearCanvasCreationSetups("alice")).not.toThrow();
    expect(() => clearOtherCanvasCreationSetups("bob")).not.toThrow();
  });
});
