import { describe, expect, it, vi } from "vitest";
import {
  createStructuredImportSession,
  initialStructuredImportState,
  structuredImportRecoveryKey,
  StructuredImportRequestError,
  type StructuredImportPreview,
} from "./structured-import-session";

const actor = {
  actorId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000002",
};
const quiz = { id: "00000000-0000-4000-8000-000000000003", title: "Imported source title" };
const previewResult = (): StructuredImportPreview => ({
  draft: { title: quiz.title, description: "", questions: [] },
  validation: { format: "csv", importedCheckpoints: 0, errors: [], warnings: [] },
  previewFingerprint: "a".repeat(64),
  sourceDigest: "b".repeat(64),
  creationContext: { ...actor },
});
const gatedPreviewResult = (): StructuredImportPreview => ({
  ...previewResult(),
  draft: null,
  previewFingerprint: "c".repeat(64),
  validation: {
    format: "csv",
    importedCheckpoints: 0,
    errors: [
      {
        severity: "error",
        code: "ROUND_RESPONSE_UNAVAILABLE",
        message: "Extended response questions are unavailable in this workspace.",
      },
    ],
    warnings: [],
  },
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { resolve, reject, promise };
}
function harness(entries = new Map<string, string>()) {
  let state = initialStructuredImportState();
  let allowed = true;
  const storage = {
    getItem: vi.fn((key: string) => entries.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      entries.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      entries.delete(key);
    }),
  };
  const preview = vi.fn(async (_body: string, _signal: AbortSignal) => previewResult());
  const confirm = vi.fn(async (_body: string, _signal: AbortSignal) => ({ quiz }));
  const onCreated = vi.fn(async () => undefined);
  const started = vi.fn();
  const completed = vi.fn();
  const session = createStructuredImportSession({
    actor,
    storage,
    allowed: () => allowed,
    preview,
    confirm,
    confirmationBody: (sourceBody, result, idempotencyKey) =>
      JSON.stringify({
        ...JSON.parse(sourceBody),
        previewFingerprint: result.previewFingerprint,
        creationContext: result.creationContext,
        idempotencyKey,
      }),
    onState: (next) => {
      state = next;
    },
    onCreated,
    onCreationStarted: started,
    onCreationCompleted: completed,
  });
  session.restore();
  return {
    session,
    entries,
    storage,
    preview,
    confirm,
    onCreated,
    started,
    completed,
    state: () => state,
    forbid: () => {
      allowed = false;
    },
  };
}
async function ready(view: ReturnType<typeof harness>) {
  view.session.updateInput({ format: "csv" });
  view.session.updateInput({ title: "  A title  ", data: "private source with answers" });
  await view.session.preview();
}
async function lostAcknowledgement() {
  const first = harness();
  await ready(first);
  first.confirm.mockRejectedValueOnce(new TypeError("Connection lost"));
  await first.session.create();
  const originalBody = first.confirm.mock.calls[0]![0];
  first.session.dispose();
  return { entries: first.entries, originalBody };
}

describe("structured import session", () => {
  it("only previews until explicit create and sends the reviewed source and title", async () => {
    const view = harness();
    await view.session.create();
    await ready(view);
    expect(view.confirm).not.toHaveBeenCalled();
    expect(view.started).not.toHaveBeenCalled();
    expect(JSON.parse(view.preview.mock.calls[0]![0])).toEqual({
      format: "csv",
      data: "private source with answers",
      encoding: "text",
      title: "A title",
    });
    expect(view.state().phase).toBe("ready");
    await view.session.create();
    expect(JSON.parse(view.confirm.mock.calls[0]![0])).toMatchObject({
      format: "csv",
      title: "A title",
      data: "private source with answers",
      creationContext: actor,
      previewFingerprint: "a".repeat(64),
      idempotencyKey: expect.any(String),
    });
    expect(view.onCreated).toHaveBeenCalledWith(quiz);
    expect(view.started).toHaveBeenCalledOnce();
    expect(view.completed).toHaveBeenCalledOnce();
    expect(view.state().data).toBe("");
  });

  it.each(["title", "data", "format"] as const)(
    "invalidates preview after %s changes",
    async (field) => {
      const view = harness();
      await ready(view);
      view.session.updateInput(field === "format" ? { format: "bulk" } : { [field]: "Changed" });
      expect(view.state().preview).toBeNull();
      expect(view.state().validation).toBeNull();
      await view.session.create();
      expect(view.confirm).not.toHaveBeenCalled();
    },
  );

  it("keeps actionable row and field errors without enabling creation", async () => {
    const view = harness();
    const result = previewResult();
    result.draft = null;
    result.validation.errors.push({
      severity: "error",
      code: "missing",
      message: "Missing correct answer",
      row: 3,
      field: "correct",
    });
    view.preview.mockResolvedValue(result);
    await ready(view);
    expect(view.state().feedback).toBe("invalid");
    expect(view.state().validation?.errors[0]).toMatchObject({ row: 3, field: "correct" });
    await view.session.create();
    expect(view.confirm).not.toHaveBeenCalled();
  });

  it("retains warnings in a valid review", async () => {
    const view = harness();
    const result = previewResult();
    result.validation.warnings.push({
      severity: "warning",
      code: "stripped",
      message: "Removed external image",
      row: 2,
      field: "media",
    });
    view.preview.mockResolvedValue(result);
    await ready(view);
    expect(view.state().phase).toBe("ready");
    expect(view.state().preview?.validation.warnings).toHaveLength(1);
  });

  it("ignores an older preview after editing even when fetch ignores abort", async () => {
    const view = harness();
    const pending = deferred<StructuredImportPreview>();
    view.preview.mockReturnValueOnce(pending.promise);
    view.session.updateInput({ data: "old" });
    const waiting = view.session.preview();
    const signal = view.preview.mock.calls[0]![1];
    view.session.updateInput({ data: "new" });
    pending.resolve(previewResult());
    await waiting;
    expect(signal.aborted).toBe(true);
    expect(view.state().data).toBe("new");
    expect(view.state().preview).toBeNull();
  });

  it("fences stale file reads and clears old preview when a replacement file is too large", async () => {
    const view = harness();
    await ready(view);
    const first = deferred<string>();
    const second = deferred<string>();
    const readFirst = view.session.readFile({ name: "first.csv", size: 10 }, () => first.promise);
    expect(view.state().preview).toBeNull();
    const readSecond = view.session.readFile(
      { name: "second.csv", size: 10 },
      () => second.promise,
    );
    second.resolve("new file");
    await readSecond;
    first.resolve("old file");
    await readFirst;
    expect(view.state()).toMatchObject({ data: "new file", fileName: "second.csv" });
    await view.session.readFile({ name: "huge.csv", size: 2_000_001 }, async () => "never");
    expect(view.state()).toMatchObject({ data: "", fileName: "", feedback: "fileTooLarge" });
  });

  it.each(["title", "data", "format"] as const)(
    "fences pending file reads after %s changes",
    async (field) => {
      const view = harness();
      const file = deferred<string>();
      const read = view.session.readFile({ name: "late.json", size: 1 }, () => file.promise);
      view.session.updateInput(field === "format" ? { format: "qti3" } : { [field]: "new" });
      file.resolve("late");
      await read;
      expect(view.state().fileName).toBe("");
      expect(view.state().data).not.toBe("late");
    },
  );

  it("uses base64 source encoding for QTI", async () => {
    const view = harness();
    view.session.updateInput({ format: "qti3" });
    await view.session.readFile({ name: "source.zip", size: 5_000_000 }, async () => "cXQz");
    await view.session.preview();
    expect(JSON.parse(view.preview.mock.calls[0]![0])).toEqual({
      format: "qti3",
      data: "cXQz",
      encoding: "base64",
    });
  });

  it("singleflights confirmation and retains a byte-identical retry body", async () => {
    const view = harness();
    await ready(view);
    const response = deferred<{ quiz: typeof quiz }>();
    view.confirm.mockReturnValueOnce(response.promise);
    const first = view.session.create();
    await view.session.create();
    view.session.updateInput({ data: "should not replace uncertain source" });
    expect(view.confirm).toHaveBeenCalledOnce();
    response.reject(new TypeError("Connection lost"));
    await first;
    expect(view.state().phase).toBe("retry");
    await view.session.preview();
    expect(view.preview).toHaveBeenCalledOnce();
    await view.session.create();
    expect(view.confirm.mock.calls[1]![0]).toBe(view.confirm.mock.calls[0]![0]);
    expect(view.started).toHaveBeenCalledOnce();
  });

  it("persists only opaque recovery metadata and replays the original fingerprint after remount", async () => {
    const first = harness();
    await ready(first);
    first.confirm.mockRejectedValueOnce(new TypeError("Connection lost"));
    await first.session.create();
    const original = first.confirm.mock.calls[0]![0];
    const raw = first.entries.get(structuredImportRecoveryKey(actor))!;
    expect(JSON.parse(raw)).toEqual({
      version: 1,
      intents: [
        {
          idempotencyKey: JSON.parse(original).idempotencyKey,
          previewFingerprint: "a".repeat(64),
          sourceDigest: "b".repeat(64),
          creationContext: actor,
        },
      ],
    });
    expect(raw).not.toContain("private source");
    expect(raw).not.toContain("A title");
    first.session.dispose();
    const recovered = harness(first.entries);
    recovered.preview.mockResolvedValueOnce({
      ...previewResult(),
      previewFingerprint: "c".repeat(64),
    });
    await ready(recovered);
    expect(recovered.state().reusesIntent).toBe(true);
    await recovered.session.create();
    expect(recovered.confirm.mock.calls[0]![0]).toBe(original);
    expect(recovered.entries.size).toBe(0);
  });

  it("recovers the original committed import when a later preview has no draft because extended responses are disabled", async () => {
    const pending = await lostAcknowledgement();
    const recovered = harness(pending.entries);
    recovered.preview.mockResolvedValueOnce(gatedPreviewResult());
    await ready(recovered);
    expect(recovered.state()).toMatchObject({
      phase: "ready",
      reusesIntent: true,
      preview: { draft: null },
      feedback: "",
    });
    expect(recovered.confirm).not.toHaveBeenCalled();
    await recovered.session.create();
    expect(recovered.confirm).toHaveBeenCalledOnce();
    expect(recovered.confirm.mock.calls[0]![0]).toBe(pending.originalBody);
    expect(recovered.onCreated).toHaveBeenCalledWith(quiz);
    expect(recovered.state().created).toEqual(quiz);
    expect(recovered.entries.size).toBe(0);
  });

  it.each(["missing", "different-source"])(
    "never creates from a gated preview with a %s saved intent",
    async (kind) => {
      const pending = await lostAcknowledgement();
      const view = harness(kind === "missing" ? new Map() : pending.entries);
      const blocked = gatedPreviewResult();
      if (kind === "different-source") blocked.sourceDigest = "d".repeat(64);
      view.preview.mockResolvedValueOnce(blocked);
      await ready(view);
      await view.session.create();
      expect(view.state()).toMatchObject({
        phase: "idle",
        preview: null,
        reusesIntent: false,
        feedback: "invalid",
      });
      expect(view.confirm).not.toHaveBeenCalled();
      expect(view.storage.setItem).not.toHaveBeenCalled();
      expect(view.started).not.toHaveBeenCalled();
    },
  );

  it.each(["actorId", "workspaceId"] as const)(
    "does not recover a gated preview with a different %s",
    async (field) => {
      const pending = await lostAcknowledgement();
      const view = harness(pending.entries);
      const blocked = gatedPreviewResult();
      blocked.creationContext[field] = quiz.id;
      view.preview.mockResolvedValueOnce(blocked);
      await ready(view);
      await view.session.create();
      expect(view.state()).toMatchObject({ phase: "idle", preview: null, reusesIntent: false });
      expect(view.confirm).not.toHaveBeenCalled();
      expect(view.storage.setItem).not.toHaveBeenCalled();
    },
  );

  it("does not enable gated recovery when initial receipt storage cannot be read", async () => {
    const pending = await lostAcknowledgement();
    const view = harness(pending.entries);
    view.storage.getItem.mockImplementationOnce(() => {
      throw new Error("Storage denied");
    });
    view.session.restore();
    view.preview.mockResolvedValueOnce(gatedPreviewResult());
    await ready(view);
    await view.session.create();
    expect(view.state()).toMatchObject({
      recoveryReady: false,
      recoveryFailed: true,
      preview: null,
      reusesIntent: false,
    });
    expect(view.confirm).not.toHaveBeenCalled();
  });

  it.each(["read", "write"])(
    "blocks gated confirmation on receipt storage %s failure and retries only the original key",
    async (operation) => {
      const pending = await lostAcknowledgement();
      const view = harness(pending.entries);
      view.preview.mockResolvedValueOnce(gatedPreviewResult());
      await ready(view);
      if (operation === "read")
        view.storage.getItem.mockImplementationOnce(() => {
          throw new Error("Storage denied");
        });
      else
        view.storage.setItem.mockImplementationOnce(() => {
          throw new Error("Storage denied");
        });
      await view.session.create();
      expect(view.state()).toMatchObject({
        recoveryReady: false,
        recoveryFailed: true,
        feedback: "recovery",
      });
      expect(view.confirm).not.toHaveBeenCalled();
      view.session.restore();
      await view.session.create();
      expect(view.confirm.mock.calls[0]![0]).toBe(pending.originalBody);
    },
  );

  it("never substitutes a new key when the matched gated receipt disappears before confirmation", async () => {
    const pending = await lostAcknowledgement();
    const view = harness(pending.entries);
    view.preview.mockResolvedValueOnce(gatedPreviewResult());
    await ready(view);
    view.entries.clear();
    await view.session.create();
    expect(view.confirm).not.toHaveBeenCalled();
    expect(view.storage.setItem).not.toHaveBeenCalled();
    expect(view.state()).toMatchObject({
      phase: "idle",
      preview: null,
      reusesIntent: false,
      feedback: "invalid",
    });
  });

  it.each(["title", "data", "format", "file"])(
    "invalidates matched gated recovery when %s changes",
    async (field) => {
      const pending = await lostAcknowledgement();
      const view = harness(pending.entries);
      view.preview.mockResolvedValueOnce(gatedPreviewResult());
      await ready(view);
      if (field === "format") view.session.updateInput({ format: "bulk" });
      else if (field === "file")
        await view.session.readFile(
          { name: "replacement.csv", size: 1 },
          async () => "replacement",
        );
      else view.session.updateInput({ [field]: "replacement" });
      await view.session.create();
      expect(view.state()).toMatchObject({ preview: null, reusesIntent: false });
      expect(view.confirm).not.toHaveBeenCalled();
    },
  );

  it.each(["IMPORT_PREVIEW_STALE", "IMPORT_VALIDATION_FAILED"])(
    "safely stops gated recovery after definitive %s rejection",
    async (code) => {
      const pending = await lostAcknowledgement();
      const view = harness(pending.entries);
      view.preview.mockResolvedValue(gatedPreviewResult());
      await ready(view);
      view.confirm.mockRejectedValueOnce(
        new StructuredImportRequestError(
          code === "IMPORT_PREVIEW_STALE" ? 409 : 422,
          "Not created",
          undefined,
          code,
        ),
      );
      await view.session.create();
      expect(view.confirm.mock.calls[0]![0]).toBe(pending.originalBody);
      expect(view.state()).toMatchObject({ phase: "idle", preview: null, feedback: "expired" });
      await view.session.preview();
      await view.session.create();
      expect(view.confirm).toHaveBeenCalledOnce();
      expect(view.state().reusesIntent).toBe(false);
    },
  );

  it("blocks creation when receipt recovery is corrupt or unavailable and retries recovery", async () => {
    const view = harness();
    view.storage.getItem.mockImplementationOnce(() => {
      throw new Error("Denied");
    });
    view.session.restore();
    await ready(view);
    await view.session.create();
    expect(view.confirm).not.toHaveBeenCalled();
    expect(view.state().recoveryReady).toBe(false);
    view.session.restore();
    expect(view.state().recoveryReady).toBe(true);
    view.storage.setItem.mockImplementationOnce(() => {
      throw new Error("Denied");
    });
    await view.session.create();
    expect(view.confirm).not.toHaveBeenCalled();
    expect(view.state().feedback).toBe("recovery");
    view.session.restore();
    await view.session.create();
    expect(view.confirm).toHaveBeenCalledOnce();
  });

  it("does not trust a receipt from a different actor or workspace", async () => {
    const entries = new Map([
      [
        structuredImportRecoveryKey(actor),
        JSON.stringify({
          version: 1,
          intents: [
            {
              idempotencyKey: quiz.id,
              previewFingerprint: "a".repeat(64),
              sourceDigest: "b".repeat(64),
              creationContext: { ...actor, actorId: quiz.id },
            },
          ],
        }),
      ],
    ]);
    const view = harness(entries);
    await ready(view);
    await view.session.create();
    expect(view.state().recoveryReady).toBe(false);
    expect(view.confirm).not.toHaveBeenCalled();
  });

  it("releases only a definitively rejected stale intent before allowing a new preview", async () => {
    const view = harness();
    await ready(view);
    view.confirm.mockRejectedValueOnce(
      new StructuredImportRequestError(409, "Preview changed", undefined, "IMPORT_PREVIEW_STALE"),
    );
    await view.session.create();
    const rejectedBody = view.confirm.mock.calls[0]![0];
    expect(view.state()).toMatchObject({ phase: "idle", preview: null, feedback: "expired" });
    await view.session.create();
    expect(view.confirm).toHaveBeenCalledOnce();
    await view.session.preview();
    await view.session.create();
    expect(JSON.parse(view.confirm.mock.calls[1]![0]).idempotencyKey).not.toBe(
      JSON.parse(rejectedBody).idempotencyKey,
    );
  });

  it.each(["IMPORT_TARGET_UNAVAILABLE", "IDEMPOTENCY_CONFLICT"])(
    "retains the original intent for %s rather than recreating",
    async (code) => {
      const view = harness();
      await ready(view);
      view.confirm.mockRejectedValueOnce(
        new StructuredImportRequestError(409, "Unavailable", undefined, code),
      );
      await view.session.create();
      expect(view.state().phase).toBe("retry");
      await view.session.create();
      expect(view.confirm.mock.calls[1]![0]).toBe(view.confirm.mock.calls[0]![0]);
    },
  );

  it.each(["forbid", "dispose"] as const)(
    "ignores stale successful confirmation after %s",
    async (action) => {
      const view = harness();
      await ready(view);
      const result = deferred<{ quiz: typeof quiz }>();
      view.confirm.mockReturnValueOnce(result.promise);
      const creating = view.session.create();
      if (action === "forbid") view.forbid();
      else view.session.dispose();
      result.resolve({ quiz });
      await creating;
      expect(view.onCreated).not.toHaveBeenCalled();
      expect(view.completed).not.toHaveBeenCalled();
      expect(view.entries.size).toBe(1);
    },
  );

  it("retains known success and retries opening without another confirmation", async () => {
    const view = harness();
    await ready(view);
    view.onCreated.mockRejectedValueOnce(new Error("Navigation failed"));
    await view.session.create();
    expect(view.state()).toMatchObject({ phase: "created", created: quiz, feedback: "opening" });
    await view.session.create();
    await view.session.openCreated();
    expect(view.confirm).toHaveBeenCalledOnce();
    expect(view.onCreated).toHaveBeenCalledTimes(2);
    expect(view.state().feedback).toBe("");
  });

  it("requires an explicit new import after an acknowledged draft and uses a new key", async () => {
    const view = harness();
    await ready(view);
    await view.session.create();
    const firstBody = view.confirm.mock.calls[0]![0];
    await view.session.create();
    expect(view.confirm).toHaveBeenCalledOnce();
    view.session.startAnother();
    expect(view.state()).toMatchObject({ phase: "idle", created: null, preview: null, data: "" });
    await ready(view);
    await view.session.create();
    expect(JSON.parse(view.confirm.mock.calls[1]![0]).idempotencyKey).not.toBe(
      JSON.parse(firstBody).idempotencyKey,
    );
  });

  it("retains a tombstoned key until explicit import-another cleanup and requires a fresh preview and key", async () => {
    const view = harness();
    await ready(view);
    view.confirm.mockRejectedValueOnce(
      new StructuredImportRequestError(
        409,
        "The original draft is unavailable. Start a new import.",
        undefined,
        "IMPORT_TARGET_UNAVAILABLE",
      ),
    );
    await view.session.create();
    const oldBody = view.confirm.mock.calls[0]![0];
    expect(view.state()).toMatchObject({ phase: "retry", knownTargetUnavailable: true });
    expect(
      JSON.parse(view.entries.get(structuredImportRecoveryKey(actor))!).intents[0].idempotencyKey,
    ).toBe(JSON.parse(oldBody).idempotencyKey);
    view.session.updateInput({ data: "replacement must wait for explicit action" });
    expect(view.state().data).toBe("private source with answers");
    expect(view.confirm).toHaveBeenCalledOnce();
    view.session.startAnother();
    expect(view.entries.size).toBe(0);
    expect(view.state()).toMatchObject({
      phase: "idle",
      preview: null,
      data: "",
      knownTargetUnavailable: false,
    });
    await view.session.create();
    expect(view.confirm).toHaveBeenCalledOnce();
    expect(view.preview).toHaveBeenCalledOnce();
    await ready(view);
    await view.session.create();
    expect(JSON.parse(view.confirm.mock.calls[1]![0]).idempotencyKey).not.toBe(
      JSON.parse(oldBody).idempotencyKey,
    );
  });

  it("blocks restarting a tombstoned import until receipt cleanup succeeds", async () => {
    const view = harness();
    await ready(view);
    view.confirm.mockRejectedValueOnce(
      new StructuredImportRequestError(
        409,
        "Draft deleted",
        undefined,
        "IMPORT_TARGET_UNAVAILABLE",
      ),
    );
    await view.session.create();
    view.storage.removeItem.mockImplementationOnce(() => {
      throw new Error("Storage denied");
    });
    view.session.startAnother();
    expect(view.entries.size).toBe(1);
    expect(view.state()).toMatchObject({
      phase: "retry",
      knownTargetUnavailable: true,
      recoveryReady: false,
      recoveryFailed: true,
      feedback: "recovery",
    });
    await view.session.create();
    expect(view.confirm).toHaveBeenCalledOnce();
    view.session.restore();
    expect(view.entries.size).toBe(0);
    expect(view.state()).toMatchObject({
      phase: "idle",
      preview: null,
      data: "",
      recoveryReady: true,
      knownTargetUnavailable: false,
    });
    expect(view.preview).toHaveBeenCalledOnce();
    expect(view.confirm).toHaveBeenCalledOnce();
  });

  it.each([
    new TypeError("Lost acknowledgement"),
    new StructuredImportRequestError(409, "Conflict", undefined, "IDEMPOTENCY_CONFLICT"),
  ])(
    "cannot discard an uncertain or conflicting intent through import-another: %s",
    async (failure) => {
      const view = harness();
      await ready(view);
      view.confirm.mockRejectedValueOnce(failure);
      await view.session.create();
      const original = view.entries.get(structuredImportRecoveryKey(actor));
      view.session.startAnother();
      expect(view.entries.get(structuredImportRecoveryKey(actor))).toBe(original);
      expect(view.state()).toMatchObject({
        phase: "retry",
        knownTargetUnavailable: false,
        data: "private source with answers",
      });
      expect(view.confirm).toHaveBeenCalledOnce();
    },
  );
});
