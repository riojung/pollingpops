import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SurveyDraftSchema } from "@openround/contracts/surveys";
import { ApiClientError } from "./api";
import { SurveyAutosave, type SurveyAutosaveSnapshot } from "./survey-autosave";
import type { SurveyRecordView } from "./survey-client";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture(schemaVersion: 1 | 2 = 2, enabled = true) {
  let server: SurveyRecordView = {
    id: "00000000-0000-4000-8000-000000000001",
    draft: SurveyDraftSchema.parse({ schemaVersion, title: "Original", items: [] }),
    revision: 0,
    status: "draft",
    publishedRevision: null,
    versionId: null,
  };
  const states: SurveyAutosaveSnapshot[] = [];
  let key = 0;
  const save = vi.fn(async (body: string) => {
    const input = JSON.parse(body);
    expect(input.expectedRevision).toBe(server.revision);
    server = { ...server, draft: input.draft, revision: server.revision + 1 };
    return structuredClone(server);
  });
  const controller = new SurveyAutosave(server, {
    enabled,
    save,
    changed: (snapshot) => states.push(snapshot),
    key: () => `00000000-0000-4000-8000-${String(++key).padStart(12, "0")}`,
    sleep: (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
  });
  const edit = (title: string) => controller.edit({ ...controller.snapshot().draft, title });
  return { controller, edit, save, states, server: () => structuredClone(server) };
}

describe("Survey autosave", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("does not write on initial load or upgrade a legacy draft just by viewing it", async () => {
    const { controller, save } = fixture(1);
    expect(controller.snapshot().draft.schemaVersion).toBe(2);
    expect(controller.snapshot().dirty).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).not.toHaveBeenCalled();
    expect((await controller.flush()).draft.schemaVersion).toBe(1);
  });
  it("debounces and coalesces a burst of edits into one latest-draft request", async () => {
    const { controller, edit, save } = fixture();
    edit("First");
    await vi.advanceTimersByTimeAsync(500);
    edit("Latest");
    await vi.advanceTimersByTimeAsync(699);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(JSON.parse(save.mock.calls[0]![0])).toMatchObject({
      expectedRevision: 0,
      draft: { title: "Latest" },
    });
    expect(controller.snapshot()).toMatchObject({
      phase: "saved",
      dirty: false,
      record: { revision: 1 },
    });
  });
  it("keeps typing during an in-flight save and uses its acknowledged revision for the next save", async () => {
    const { controller, edit, save } = fixture();
    const first = deferred<SurveyRecordView>();
    const persist = save.getMockImplementation()!;
    save.mockImplementationOnce((body) => persist(body).then(() => first.promise));
    edit("First");
    await vi.advanceTimersByTimeAsync(700);
    edit("Newer keystrokes");
    expect(controller.snapshot().phase).toBe("saving");
    const sent = JSON.parse(save.mock.calls[0]![0]);
    first.resolve({ ...controller.snapshot().record, revision: 1, draft: sent.draft });
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.snapshot().draft.title).toBe("Newer keystrokes");
    await vi.advanceTimersByTimeAsync(700);
    expect(save).toHaveBeenCalledTimes(2);
    expect(JSON.parse(save.mock.calls[1]![0])).toMatchObject({
      expectedRevision: 1,
      draft: { title: "Newer keystrokes" },
    });
    expect(controller.snapshot().record.revision).toBe(2);
  });
  it("flushes pending edits immediately and drains newer edits behind an in-flight save", async () => {
    const { controller, edit, save } = fixture();
    const response = deferred<SurveyRecordView>();
    const persist = save.getMockImplementation()!;
    save.mockImplementationOnce((body) => persist(body).then(() => response.promise));
    edit("First");
    const firstFlush = controller.flush();
    edit("Latest");
    const secondFlush = controller.flush();
    await vi.advanceTimersByTimeAsync(0);
    response.resolve({
      ...controller.snapshot().record,
      revision: 1,
      draft: JSON.parse(save.mock.calls[0]![0]).draft,
    });
    const [a, b] = await Promise.all([firstFlush, secondFlush]);
    expect(a).toEqual(b);
    expect(a).toMatchObject({ revision: 2, draft: { title: "Latest" } });
    expect(save).toHaveBeenCalledTimes(2);
  });
  it("normalizes persisted whitespace without rewriting editor text or looping", async () => {
    const { controller, edit, save } = fixture();
    edit("  Original  ");
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).not.toHaveBeenCalled();
    edit("  Changed  ");
    await controller.flush();
    expect(controller.snapshot().draft.title).toBe("  Changed  ");
    expect(controller.snapshot().record.draft.title).toBe("Changed");
    expect(controller.snapshot()).toMatchObject({ dirty: false, unsettled: false });
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).toHaveBeenCalledTimes(1);
  });
  it("preserves word separators when typing resumes after an automatic acknowledgement", async () => {
    const { controller, save } = fixture();
    controller.edit({
      ...controller.snapshot().draft,
      title: "Training ",
      description: "Detailed ",
    });
    await vi.advanceTimersByTimeAsync(700);
    expect(controller.snapshot()).toMatchObject({
      phase: "saved",
      dirty: false,
      draft: { title: "Training ", description: "Detailed " },
      record: { revision: 1, draft: { title: "Training", description: "Detailed" } },
    });
    const draft = controller.snapshot().draft;
    controller.edit({
      ...draft,
      title: draft.title + "feedback",
      description: draft.description + "feedback",
    });
    await vi.advanceTimersByTimeAsync(700);
    expect(controller.snapshot().record).toMatchObject({
      revision: 2,
      draft: { title: "Training feedback", description: "Detailed feedback" },
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).toHaveBeenCalledTimes(2);
  });
  it("automatically retries transient failures with an identical serialized request", async () => {
    const { controller, edit, save } = fixture();
    save.mockRejectedValueOnce(new TypeError("Offline"));
    save.mockRejectedValueOnce(new ApiClientError("Busy", "RATE_LIMITED", 429));
    edit("Changed");
    const done = controller.flush();
    await vi.advanceTimersByTimeAsync(1000);
    expect((await done).revision).toBe(1);
    expect(new Set(save.mock.calls.map(([body]) => body)).size).toBe(1);
    expect(save).toHaveBeenCalledTimes(3);
  });
  it("retains an exhausted save intent while coalescing newer edits until explicit retry", async () => {
    const { controller, edit, save } = fixture();
    const receipt = deferred<SurveyRecordView>();
    save.mockRejectedValue(new TypeError("Acknowledgement lost"));
    edit("Accepted first");
    const failed = expect(controller.flush()).rejects.toThrow("Acknowledgement lost");
    await vi.advanceTimersByTimeAsync(1000);
    await failed;
    expect(controller.snapshot()).toMatchObject({ phase: "retry", unsettled: true });
    const originalBody = save.mock.calls[0]![0];
    edit("Newer edits");
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).toHaveBeenCalledTimes(3);
    save.mockImplementationOnce(() => receipt.promise);
    save.mockImplementationOnce(async (body) => ({
      ...controller.snapshot().record,
      revision: 2,
      draft: JSON.parse(body).draft,
    }));
    const retried = controller.retry();
    expect(save.mock.calls[3]![0]).toBe(originalBody);
    receipt.resolve({
      ...controller.snapshot().record,
      revision: 1,
      draft: JSON.parse(originalBody).draft,
    });
    expect(await retried).toMatchObject({ revision: 2, draft: { title: "Newer edits" } });
    expect(JSON.parse(save.mock.calls[4]![0]).idempotencyKey).not.toBe(
      JSON.parse(originalBody).idempotencyKey,
    );
  });
  it("still reconciles an ambiguous save when the local draft was reverted to the old baseline", async () => {
    const { controller, edit, save } = fixture();
    save.mockRejectedValue(new TypeError("Offline"));
    edit("Accepted");
    const failure = expect(controller.flush()).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(1000);
    await failure;
    edit("Original");
    expect(controller.snapshot()).toMatchObject({ dirty: false, unsettled: true });
    save.mockImplementationOnce(async (body) => ({
      ...controller.snapshot().record,
      revision: 1,
      draft: JSON.parse(body).draft,
    }));
    save.mockImplementationOnce(async (body) => ({
      ...controller.snapshot().record,
      revision: 2,
      draft: JSON.parse(body).draft,
    }));
    expect(await controller.retry()).toMatchObject({ revision: 2, draft: { title: "Original" } });
  });
  it("pauses on revision conflicts and never overwrites local edits or automatically retries", async () => {
    const { controller, edit, save } = fixture();
    save.mockRejectedValue(new ApiClientError("Reload before editing", "STALE_DRAFT", 409));
    edit("Local edits");
    await expect(controller.flush()).rejects.toMatchObject({ code: "STALE_DRAFT" });
    edit("Keep these edits");
    await vi.advanceTimersByTimeAsync(5000);
    expect(controller.snapshot()).toMatchObject({
      phase: "conflict",
      draft: { title: "Keep these edits" },
      record: { revision: 0 },
    });
    await expect(controller.retry()).rejects.toMatchObject({ code: "STALE_DRAFT" });
    expect(save).toHaveBeenCalledTimes(1);
  });
  it("does not bypass a conflict when local edits are reverted to the stale baseline", async () => {
    const { controller, edit, save } = fixture();
    save.mockRejectedValue(new ApiClientError("Changed elsewhere", "STALE_DRAFT", 409));
    edit("Local");
    await expect(controller.flush()).rejects.toThrow();
    edit("Original");
    expect(controller.snapshot().dirty).toBe(false);
    await expect(controller.flush()).rejects.toMatchObject({ code: "STALE_DRAFT" });
  });
  it("does not send invalid drafts and resumes when a validation error is corrected", async () => {
    const { controller, edit, save } = fixture();
    edit("X".repeat(161));
    await expect(controller.flush()).rejects.toThrow("title:");
    expect(save).not.toHaveBeenCalled();
    expect(controller.snapshot().phase).toBe("error");
    edit("Valid");
    await vi.advanceTimersByTimeAsync(700);
    expect(controller.snapshot().phase).toBe("saved");
  });
  it("does not retry definitive server failures and uses a new key after correction", async () => {
    const { controller, edit, save } = fixture();
    save.mockRejectedValueOnce(new ApiClientError("Invalid content", "VALIDATION_ERROR", 422));
    edit("Invalid");
    await expect(controller.flush()).rejects.toThrow("Invalid content");
    edit("Corrected");
    await controller.flush();
    expect(save).toHaveBeenCalledTimes(2);
    expect(JSON.parse(save.mock.calls[0]![0]).idempotencyKey).not.toBe(
      JSON.parse(save.mock.calls[1]![0]).idempotencyKey,
    );
  });
  it("does not write for viewers or archived Surveys, and pauses queued edits after role revocation", async () => {
    const readonly = fixture(2, false);
    readonly.edit("Not permitted");
    await vi.advanceTimersByTimeAsync(2000);
    expect(readonly.save).not.toHaveBeenCalled();
    expect(readonly.controller.snapshot().draft.title).toBe("Original");
    const { controller, edit, save } = fixture();
    edit("Queued");
    controller.setEnabled(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).not.toHaveBeenCalled();
    await expect(controller.flush()).rejects.toThrow("unavailable");
    controller.setEnabled(true);
    await controller.flush();
    controller.acceptRecord({ ...controller.snapshot().record, status: "archived" });
    edit("Archived edit");
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).toHaveBeenCalledTimes(1);
  });
  it("rejects replacing a dirty record and accepts an acknowledged publication after flushing", async () => {
    const { controller, edit } = fixture();
    const old = controller.snapshot().record;
    edit("Pending");
    expect(() => controller.acceptRecord(old)).toThrow("Save the current edits");
    const saved = await controller.flush();
    controller.acceptRecord({ ...saved, status: "published", publishedRevision: saved.revision });
    expect(controller.snapshot().record.publishedRevision).toBe(1);
  });
  it("cancels debounce and fences late acknowledgements after editor disposal", async () => {
    const queued = fixture();
    queued.edit("Pending");
    queued.controller.dispose();
    await vi.advanceTimersByTimeAsync(5000);
    expect(queued.save).not.toHaveBeenCalled();
    await expect(queued.controller.flush()).rejects.toThrow("Editor closed");
    const { controller, edit, save, states } = fixture();
    const response = deferred<SurveyRecordView>();
    save.mockImplementationOnce(() => response.promise);
    edit("In flight");
    const done = controller.flush();
    const count = states.length;
    controller.dispose();
    response.resolve({
      ...controller.snapshot().record,
      revision: 1,
      draft: JSON.parse(save.mock.calls[0]![0]).draft,
    });
    await expect(done).rejects.toThrow("Editor closed");
    expect(states).toHaveLength(count);
    expect(controller.snapshot().record.revision).toBe(0);
  });
  it("stops retries after disposal and retains an unverifiable acknowledgement for exact retry", async () => {
    const { controller, edit, save } = fixture();
    save.mockImplementationOnce(async () => ({ ...controller.snapshot().record, revision: 99 }));
    edit("Changed");
    await expect(controller.flush()).rejects.toThrow("acknowledgement");
    expect(controller.snapshot().phase).toBe("retry");
    const body = save.mock.calls[0]![0];
    save.mockRejectedValue(new TypeError("Offline"));
    const retry = expect(controller.retry()).rejects.toThrow("Editor closed");
    await vi.advanceTimersByTimeAsync(0);
    controller.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    await retry;
    expect(save.mock.calls[1]![0]).toBe(body);
    expect(save).toHaveBeenCalledTimes(2);
  });
});
