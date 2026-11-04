import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  PresentationDraftSchema,
  type PresentationDraft,
  type PresentationDraftMutation,
} from "@openround/contracts";
import { createContentBlock } from "./presentation-builder";
import {
  RetainedPresentationSave,
  type PresentationSaveOperations,
} from "./presentation-draft-save";

function draft(title: string): PresentationDraft {
  return {
    title,
    description: "",
    schemaVersion: 2,
    experiencePreset: { id: "focus", version: 1 },
    blocks: [createContentBlock()],
  };
}

function harness() {
  let revision = 1;
  let savedJson = JSON.stringify(draft("Saved"));
  let persisted: PresentationDraftMutation | null = null;
  const requests: PresentationDraftMutation[] = [];
  const operations: PresentationSaveOperations<number> = {
    revision: () => revision,
    savedJson: () => savedJson,
    mutationId: vi.fn(randomUUID),
    persist: vi.fn(async (pending) => {
      persisted = structuredClone(pending);
    }),
    send: vi.fn(async (pending) => {
      requests.push(structuredClone(pending));
      return pending.expectedRevision + 1;
    }),
    accepted: vi.fn((next, pending) => {
      revision = next;
      savedJson = JSON.stringify(pending.draft);
    }),
  };
  return { operations, requests, revision: () => revision, persisted: () => persisted };
}

describe("retained Presentation draft saves", () => {
  it("keeps Undo eligible for autosave while accepted-receipt storage cleanup is pending", async () => {
    const coordinator = new RetainedPresentationSave();
    const state = harness();
    const original = JSON.parse(state.operations.savedJson()) as PresentationDraft;
    const edited = { ...original, title: "Accepted edit" };
    let releaseCleanup!: () => void;
    let notifyCleanup!: () => void;
    const cleanup = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    const cleanupStarted = new Promise<void>((resolve) => {
      notifyCleanup = resolve;
    });
    const persist = state.operations.persist;
    state.operations.persist = async (pending) => {
      await persist(pending);
      if (pending === null) {
        notifyCleanup();
        await cleanup;
      }
    };

    const saving = coordinator.save(edited, state.operations);
    await cleanupStarted;
    // Undo returns to the old saved snapshot while its replacement receipt is still settling.
    // This is the builder's autosave admission check, before the receipt advances savedJson.
    const undoNeedsSave =
      JSON.stringify(original) !== state.operations.savedJson() || coordinator.pending !== null;
    releaseCleanup();
    await saving;
    expect(undoNeedsSave).toBe(true);

    await coordinator.save(original, state.operations);
    expect(state.requests).toHaveLength(2);
    expect(state.requests[1]).toMatchObject({ expectedRevision: 2, draft: original });
    expect(state.revision()).toBe(3);
    expect(state.operations.savedJson()).toBe(JSON.stringify(original));
    expect(coordinator.pending).toBeNull();
  });

  it("settles the immutable uncertain receipt before saving newer local edits at the advanced revision", async () => {
    const coordinator = new RetainedPresentationSave();
    const state = harness();
    const candidate = draft("Attempted");
    const transportError = new Error("Acknowledgements exhausted");
    const send = state.operations.send;
    state.operations.send = vi.fn(async (pending) => {
      state.requests.push(structuredClone(pending));
      throw transportError;
    });
    await expect(coordinator.save(candidate, state.operations)).rejects.toBe(transportError);
    const attemptedBody = JSON.stringify(state.requests[0]);
    candidate.title = "Newer local edit";
    expect(coordinator.pending!.draft.title).toBe("Attempted");
    expect(state.persisted()).toEqual(coordinator.pending);

    state.operations.send = send;
    await coordinator.save(candidate, state.operations);
    expect(JSON.stringify(state.requests[1])).toBe(attemptedBody);
    expect(state.requests[2]).toMatchObject({
      expectedRevision: 2,
      draft: { title: "Newer local edit" },
    });
    expect(state.requests[2]!.mutationId).not.toBe(state.requests[1]!.mutationId);
    expect(state.operations.mutationId).toHaveBeenCalledTimes(2);
    expect(state.revision()).toBe(3);
    expect(state.persisted()).toBeNull();
    expect(coordinator.pending).toBeNull();
  });

  it("replays a persisted envelope after refresh without changing its serialized fields or creating a redundant save", async () => {
    const state = harness();
    const candidate = draft("Recovered");
    const persisted = {
      mutationId: randomUUID(),
      draft: candidate,
      schemaVersion: 2 as const,
      expectedRevision: 1,
    };
    const coordinator = new RetainedPresentationSave();
    coordinator.restore(persisted);
    persisted.draft.title = "Outside mutation";
    const recoveredCandidate = PresentationDraftSchema.parse(coordinator.pending!.draft);
    const exactBody = JSON.stringify(coordinator.pending);
    await coordinator.save(recoveredCandidate, state.operations);
    expect(JSON.stringify(state.requests[0])).toBe(exactBody);
    expect(state.requests).toHaveLength(1);
    expect(state.operations.mutationId).not.toHaveBeenCalled();
    expect(state.persisted()).toBeNull();
  });

  it("persists an envelope before any network request, including a retry after local persistence failed", async () => {
    const state = harness();
    const coordinator = new RetainedPresentationSave();
    const candidate = draft("Local storage unavailable");
    const persist = state.operations.persist;
    state.operations.persist = vi.fn().mockRejectedValueOnce(new Error("storage unavailable"));
    await expect(coordinator.save(candidate, state.operations)).rejects.toThrow(
      "storage unavailable",
    );
    const exactBody = JSON.stringify(coordinator.pending);
    expect(state.operations.send).not.toHaveBeenCalled();
    state.operations.persist = persist;
    await coordinator.save(candidate, state.operations);
    expect(JSON.stringify(state.requests[0])).toBe(exactBody);
    expect(state.operations.mutationId).toHaveBeenCalledTimes(1);
  });

  it("replaces definitively rejected content with a corrected request and a new key at the original revision", async () => {
    const state = harness();
    const coordinator = new RetainedPresentationSave();
    const validationError = Object.assign(new Error("Draft too large"), { status: 422 });
    const send = state.operations.send;
    state.operations.definitiveFailure = (error) => error === validationError;
    state.operations.send = vi.fn(async (pending) => {
      state.requests.push(structuredClone(pending));
      throw validationError;
    });
    await expect(coordinator.save(draft("Invalid draft"), state.operations)).rejects.toBe(
      validationError,
    );
    expect(coordinator.pending).toBeNull();
    expect(state.persisted()).toBeNull();
    state.operations.send = send;
    await coordinator.save(draft("Corrected draft"), state.operations);
    expect(state.requests[1]).toMatchObject({
      expectedRevision: 1,
      draft: { title: "Corrected draft" },
    });
    expect(state.requests[1]!.mutationId).not.toBe(state.requests[0]!.mutationId);
  });

  it("does not send newer local work when a recovered receipt conflicts with the loaded remote revision", async () => {
    const state = harness();
    const coordinator = new RetainedPresentationSave();
    coordinator.restore({
      draft: draft("Accepted earlier"),
      expectedRevision: 1,
      mutationId: randomUUID(),
      schemaVersion: 2,
    });
    state.operations.accepted = () => {
      throw new Error("Newer remote revision exists");
    };
    await expect(coordinator.save(draft("Unsaved local work"), state.operations)).rejects.toThrow(
      "Newer remote revision exists",
    );
    expect(state.requests).toHaveLength(1);
    expect(state.operations.mutationId).not.toHaveBeenCalled();
    expect(coordinator.pending).toBeNull();
  });

  it("checks a divergent local base before issuing any new write", async () => {
    const state = harness();
    const coordinator = new RetainedPresentationSave();
    state.operations.beforeNewAttempt = () => {
      throw new Error("Review the local copy first");
    };
    await expect(coordinator.save(draft("Stale local copy"), state.operations)).rejects.toThrow(
      "Review the local copy first",
    );
    expect(state.requests).toHaveLength(0);
    expect(coordinator.pending).toBeNull();
  });
});
