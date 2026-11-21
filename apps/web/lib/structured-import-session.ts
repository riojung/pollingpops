import type {
  CheckpointSetImportUnavailableReason,
  ImportValidationReport,
  QuizDraft,
} from "@openround/contracts";
import { clientUuid } from "./uuid";

export type StructuredImportFormat = ImportValidationReport["format"];
export interface StructuredImportDraft {
  id: string;
  title: string;
}

export interface StructuredImportPreview {
  draft: QuizDraft | null;
  validation: ImportValidationReport;
  previewFingerprint: string;
  sourceDigest: string;
  creationContext: { actorId: string; workspaceId: string };
}

export class StructuredImportRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly diagnostic = "",
    public readonly validation?: ImportValidationReport,
    public readonly code?: string,
    public readonly unavailableReason?: CheckpointSetImportUnavailableReason,
  ) {
    super(diagnostic);
  }

  get unavailableFeedback(): CheckpointSetImportUnavailableReason | "unavailable" | undefined {
    if (this.status === 402 && this.code === "ENTITLEMENT_LIMIT")
      return this.unavailableReason ?? "unavailable";
  }
}

export interface StructuredImportState {
  format: StructuredImportFormat;
  title: string;
  data: string;
  fileName: string;
  phase: "idle" | "reading" | "previewing" | "ready" | "creating" | "retry" | "created" | "opening";
  preview: StructuredImportPreview | null;
  validation: ImportValidationReport | null;
  created: StructuredImportDraft | null;
  knownTargetUnavailable: boolean;
  recoveryReady: boolean;
  recoveryFailed: boolean;
  recoveryCount: number;
  reusesIntent: boolean;
  feedback:
    | ""
    | "fileRead"
    | "fileTooLarge"
    | "preview"
    | "invalid"
    | "creation"
    | "expired"
    | "unavailable"
    | CheckpointSetImportUnavailableReason
    | "opening"
    | "recovery";
  diagnostic: string;
}

export const initialStructuredImportState = (): StructuredImportState => ({
  format: "openround_json",
  title: "",
  data: "",
  fileName: "",
  phase: "idle",
  preview: null,
  validation: null,
  created: null,
  knownTargetUnavailable: false,
  recoveryReady: false,
  recoveryFailed: false,
  recoveryCount: 0,
  reusesIntent: false,
  feedback: "",
  diagnostic: "",
});

interface StructuredImportSessionOptions {
  actor: { actorId: string; workspaceId: string };
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  allowed: () => boolean;
  preview: (body: string, signal: AbortSignal) => Promise<StructuredImportPreview>;
  confirmationBody: (
    sourceBody: string,
    preview: StructuredImportPreview,
    idempotencyKey: string,
  ) => string;
  confirm: (body: string, signal: AbortSignal) => Promise<{ quiz: StructuredImportDraft }>;
  onState: (state: StructuredImportState) => void;
  onCreated: (quiz: StructuredImportDraft) => Promise<void>;
  onCreationStarted?: () => void;
  onCreationCompleted?: (count: number) => void;
}

interface ImportIntent {
  idempotencyKey: string;
  previewFingerprint: string;
  creationContext: { actorId: string; workspaceId: string };
  sourceDigest: string;
}

export function structuredImportRecoveryKey(actor: StructuredImportSessionOptions["actor"]) {
  return `structured-import-intents:v1:${actor.actorId}:${actor.workspaceId}`;
}

function parseIntents(
  raw: string | null,
  actor: StructuredImportSessionOptions["actor"],
): ImportIntent[] {
  if (raw === null) return [];
  if (raw.length > 32_768) throw new Error("Invalid import confirmation recovery");
  const value = JSON.parse(raw) as { version: unknown; intents: ImportIntent[] };
  if (
    !value ||
    Object.keys(value).length !== 2 ||
    value.version !== 1 ||
    !Array.isArray(value.intents) ||
    value.intents.length > 64
  )
    throw new Error("Invalid import confirmation recovery");
  for (const intent of value.intents) {
    if (
      !intent ||
      Object.keys(intent).length !== 4 ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        intent.idempotencyKey,
      ) ||
      !/^[0-9a-f]{64}$/.test(intent.previewFingerprint) ||
      !/^[0-9a-f]{64}$/.test(intent.sourceDigest) ||
      !intent.creationContext ||
      Object.keys(intent.creationContext).length !== 2 ||
      intent.creationContext.actorId !== actor.actorId ||
      intent.creationContext.workspaceId !== actor.workspaceId
    )
      throw new Error("Invalid import confirmation recovery");
  }
  return value.intents;
}

/** Sensitive source and answer content live only for this mounted import session. */
export function createStructuredImportSession(options: StructuredImportSessionOptions) {
  let state = initialStructuredImportState();
  let disposed = false;
  let generation = 0;
  let request: AbortController | null = null;
  let pendingBody: string | null = null;
  let previewBody: string | null = null;
  let intents: ImportIntent[] = [];
  let pendingIntent: ImportIntent | null = null;
  let previewDigest: string | null = null;
  let acknowledgedIntentId: string | null = null;
  let restartPending = false;
  const rejectedIntentIds = new Set<string>();
  const recoveryKey = structuredImportRecoveryKey(options.actor);

  const current = (version: number) => !disposed && generation === version && options.allowed();
  const locked = () => pendingBody !== null || state.created !== null;
  function publish(next: StructuredImportState) {
    state = next;
    if (!disposed) options.onState(next);
  }
  function invalidate() {
    generation += 1;
    request?.abort();
    request = null;
    previewBody = null;
    previewDigest = null;
  }
  function restore() {
    if (restartPending) {
      startAnother();
      return;
    }
    if (disposed || !options.allowed() || pendingBody) return;
    try {
      intents = parseIntents(options.storage.getItem(recoveryKey), options.actor);
      if (intents.some((intent) => rejectedIntentIds.has(intent.idempotencyKey))) {
        intents = intents.filter((intent) => !rejectedIntentIds.has(intent.idempotencyKey));
        options.storage.setItem(recoveryKey, JSON.stringify({ version: 1, intents }));
      }
      publish({
        ...state,
        recoveryReady: true,
        recoveryFailed: false,
        recoveryCount: intents.length,
        feedback: state.feedback === "recovery" ? "" : state.feedback,
      });
    } catch {
      publish({ ...state, recoveryReady: false, recoveryFailed: true, feedback: "recovery" });
    }
  }
  function updateInput(update: Partial<Pick<StructuredImportState, "format" | "title" | "data">>) {
    if (disposed || !options.allowed() || locked()) return;
    invalidate();
    publish({
      ...state,
      ...update,
      ...(update.format ? { data: "" } : {}),
      fileName: "",
      phase: "idle",
      preview: null,
      validation: null,
      reusesIntent: false,
      feedback: "",
      diagnostic: "",
    });
  }

  async function readFile(file: { name: string; size: number }, read: () => Promise<string>) {
    if (disposed || !options.allowed() || locked()) return;
    invalidate();
    const version = generation;
    const limit = state.format === "qti3" ? 6_000_000 : 2_000_000;
    publish({
      ...state,
      data: "",
      fileName: "",
      phase: file.size > limit ? "idle" : "reading",
      preview: null,
      validation: null,
      reusesIntent: false,
      feedback: file.size > limit ? "fileTooLarge" : "",
      diagnostic: "",
    });
    if (file.size > limit) return;
    try {
      const data = await read();
      if (!current(version)) return;
      publish({ ...state, data, fileName: file.name, phase: "idle" });
    } catch {
      if (current(version)) publish({ ...state, phase: "idle", feedback: "fileRead" });
    }
  }

  async function preview() {
    if (
      disposed ||
      !options.allowed() ||
      locked() ||
      state.phase === "reading" ||
      state.phase === "previewing" ||
      !state.data.trim()
    )
      return;
    invalidate();
    const version = generation;
    request = new AbortController();
    const body = JSON.stringify({
      format: state.format,
      data: state.data,
      encoding: state.format === "qti3" ? "base64" : "text",
      ...(state.title.trim() ? { title: state.title.trim() } : {}),
    });
    publish({
      ...state,
      phase: "previewing",
      preview: null,
      validation: null,
      feedback: "",
      diagnostic: "",
    });
    try {
      const result = await options.preview(body, request.signal);
      if (!current(version)) return;
      const digest = result.sourceDigest;
      const trustedContext = Boolean(
        /^[0-9a-f]{64}$/.test(digest) &&
        /^[0-9a-f]{64}$/.test(result.previewFingerprint) &&
        result.creationContext.actorId === options.actor.actorId &&
        result.creationContext.workspaceId === options.actor.workspaceId,
      );
      const valid = trustedContext && Boolean(result.draft && !result.validation.errors.length);
      const reusesIntent =
        trustedContext &&
        state.recoveryReady &&
        intents.some((intent) => intent.sourceDigest === digest);
      const ready = valid || reusesIntent;
      previewBody = ready ? body : null;
      previewDigest = ready ? digest : null;
      publish({
        ...state,
        phase: ready ? "ready" : "idle",
        preview: ready ? result : null,
        validation: result.validation,
        reusesIntent,
        feedback: ready ? "" : "invalid",
      });
    } catch (caught) {
      if (!current(version)) return;
      const error = caught instanceof StructuredImportRequestError ? caught : undefined;
      const unavailable = error?.unavailableFeedback;
      publish({
        ...state,
        phase: "idle",
        feedback: unavailable ?? (error?.validation?.errors.length ? "invalid" : "preview"),
        validation: error?.validation ?? null,
        diagnostic: unavailable ? "" : (error?.diagnostic ?? ""),
      });
    } finally {
      if (current(version)) request = null;
    }
  }

  async function openCreated() {
    if (disposed || !options.allowed() || !state.created || state.phase === "opening") return;
    const version = generation;
    publish({ ...state, phase: "opening", feedback: "", diagnostic: "" });
    try {
      await options.onCreated(state.created!);
      if (current(version)) publish({ ...state, phase: "created" });
    } catch {
      if (current(version)) publish({ ...state, phase: "created", feedback: "opening" });
    }
  }

  async function create() {
    if (
      disposed ||
      !options.allowed() ||
      !state.recoveryReady ||
      state.phase === "creating" ||
      state.created
    )
      return;
    if (!pendingBody) {
      if (state.phase !== "ready" || !state.preview || !previewBody || !previewDigest) return;
      try {
        // Re-read to retain receipts written by another mounted importer in this tab.
        intents = parseIntents(options.storage.getItem(recoveryKey), options.actor);
        const savedIntent = intents.find((intent) => intent.sourceDigest === previewDigest);
        if (!savedIntent && (!state.preview.draft || state.preview.validation.errors.length)) {
          invalidate();
          publish({
            ...state,
            phase: "idle",
            preview: null,
            reusesIntent: false,
            feedback: "invalid",
          });
          return;
        }
        pendingIntent = savedIntent ?? {
          idempotencyKey: clientUuid(),
          previewFingerprint: state.preview.previewFingerprint,
          creationContext: { ...options.actor },
          sourceDigest: previewDigest,
        };
        const nextIntents = intents.some(
          (intent) => intent.idempotencyKey === pendingIntent!.idempotencyKey,
        )
          ? intents
          : [...intents, pendingIntent];
        if (nextIntents.length > 64) throw new Error("Import confirmation recovery is full");
        options.storage.setItem(recoveryKey, JSON.stringify({ version: 1, intents: nextIntents }));
        intents = nextIntents;
        pendingBody = options.confirmationBody(
          previewBody,
          {
            ...state.preview,
            previewFingerprint: pendingIntent.previewFingerprint,
            creationContext: pendingIntent.creationContext,
          },
          pendingIntent.idempotencyKey,
        );
      } catch {
        pendingIntent = null;
        publish({ ...state, recoveryReady: false, recoveryFailed: true, feedback: "recovery" });
        return;
      }
      options.onCreationStarted?.();
    }
    const version = generation;
    const count = state.preview?.draft?.questions.length ?? 0;
    request = new AbortController();
    publish({
      ...state,
      phase: "creating",
      knownTargetUnavailable: false,
      feedback: "",
      diagnostic: "",
    });
    try {
      const result = await options.confirm(pendingBody, request.signal);
      if (!current(version)) return;
      pendingBody = null;
      previewBody = null;
      acknowledgedIntentId = pendingIntent?.idempotencyKey ?? null;
      intents = intents.filter((intent) => intent.idempotencyKey !== pendingIntent?.idempotencyKey);
      pendingIntent = null;
      try {
        if (intents.length)
          options.storage.setItem(recoveryKey, JSON.stringify({ version: 1, intents }));
        else options.storage.removeItem(recoveryKey);
      } catch {
        // A retained key safely replays the acknowledged draft if this tab reloads.
      }
      publish({
        ...state,
        phase: "created",
        data: "",
        title: "",
        fileName: "",
        preview: null,
        created: result.quiz,
        recoveryCount: intents.length,
      });
      options.onCreationCompleted?.(count);
      await openCreated();
    } catch (caught) {
      if (!current(version)) return;
      const error = caught instanceof StructuredImportRequestError ? caught : undefined;
      const unavailable = error?.unavailableFeedback;
      const rejected =
        error?.status === 402 ||
        error?.code === "IMPORT_PREVIEW_STALE" ||
        error?.code === "IMPORT_VALIDATION_FAILED";
      let recoveryReady: boolean = state.recoveryReady;
      if (rejected) {
        if (pendingIntent) {
          rejectedIntentIds.add(pendingIntent.idempotencyKey);
          intents = intents.filter(
            (intent) => intent.idempotencyKey !== pendingIntent!.idempotencyKey,
          );
          try {
            options.storage.setItem(recoveryKey, JSON.stringify({ version: 1, intents }));
          } catch {
            recoveryReady = false;
          }
        }
        pendingBody = null;
        previewBody = null;
        previewDigest = null;
        pendingIntent = null;
      }
      publish({
        ...state,
        phase: rejected ? "idle" : "retry",
        preview: rejected ? null : state.preview,
        validation: error?.validation ?? state.validation,
        feedback: recoveryReady ? (unavailable ?? (rejected ? "expired" : "creation")) : "recovery",
        recoveryReady,
        recoveryFailed: !recoveryReady,
        recoveryCount: intents.length,
        knownTargetUnavailable: error?.code === "IMPORT_TARGET_UNAVAILABLE",
        diagnostic: unavailable ? "" : (error?.diagnostic ?? ""),
      });
    } finally {
      if (current(version)) request = null;
    }
  }

  function startAnother() {
    if (
      disposed ||
      !options.allowed() ||
      (!state.created && !state.knownTargetUnavailable) ||
      state.phase === "opening" ||
      state.phase === "creating"
    )
      return;
    const previousIntentId = pendingIntent?.idempotencyKey ?? acknowledgedIntentId;
    try {
      const storedIntents = parseIntents(options.storage.getItem(recoveryKey), options.actor);
      const nextIntents = storedIntents.filter(
        (intent) => intent.idempotencyKey !== previousIntentId,
      );
      if (nextIntents.length)
        options.storage.setItem(recoveryKey, JSON.stringify({ version: 1, intents: nextIntents }));
      else options.storage.removeItem(recoveryKey);
      intents = nextIntents;
    } catch {
      restartPending = true;
      publish({ ...state, recoveryReady: false, recoveryFailed: true, feedback: "recovery" });
      return;
    }
    restartPending = false;
    pendingBody = null;
    pendingIntent = null;
    acknowledgedIntentId = null;
    invalidate();
    publish({
      ...initialStructuredImportState(),
      format: state.format,
      recoveryReady: true,
      recoveryCount: intents.length,
    });
  }

  return {
    updateInput,
    restore,
    readFile,
    preview,
    create,
    openCreated,
    startAnother,
    dispose() {
      disposed = true;
      invalidate();
      pendingBody = null;
      state = initialStructuredImportState();
    },
  };
}
