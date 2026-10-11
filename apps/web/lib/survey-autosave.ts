import {
  SurveyDraftSchema,
  upgradeSurveyDraft,
  type SurveyDraft,
} from "@openround/contracts/surveys";
import { ApiClientError, humanError } from "./api";
import { isRetryableSaveError, retryWithBackoff } from "./retry";
import { surveyMutationKey, type SurveyRecordView } from "./survey-client";

export type SurveySavePhase =
  "idle" | "waiting" | "saving" | "saved" | "retry" | "error" | "conflict";
export interface SurveyAutosaveSnapshot {
  record: SurveyRecordView;
  draft: SurveyDraft;
  phase: SurveySavePhase;
  dirty: boolean;
  unsettled: boolean;
  error: string;
}
interface SaveIntent {
  body: string;
  expectedRevision: number;
}
interface Options {
  save: (body: string) => Promise<SurveyRecordView>;
  changed: (snapshot: SurveyAutosaveSnapshot) => void;
  enabled?: boolean;
  debounceMs?: number;
  key?: () => string;
  sleep?: (delayMs: number) => Promise<void>;
}

function draftJson(draft: SurveyDraft) {
  const parsed = SurveyDraftSchema.safeParse(draft);
  return JSON.stringify(parsed.success ? parsed.data : draft);
}

/** One in-flight write, one latest draft, and an exact retained intent after ambiguous failures. */
export class SurveyAutosave {
  private record: SurveyRecordView;
  private draft: SurveyDraft;
  private phase: SurveySavePhase = "idle";
  private failure: unknown;
  private pending: SaveIntent | null = null;
  private flight: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private enabled: boolean;
  private disposed = false;

  constructor(
    record: SurveyRecordView,
    private readonly options: Options,
  ) {
    this.record = structuredClone(record);
    this.draft = upgradeSurveyDraft(record.draft);
    this.enabled = options.enabled ?? true;
  }
  snapshot(): SurveyAutosaveSnapshot {
    const dirty = draftJson(this.draft) !== draftJson(upgradeSurveyDraft(this.record.draft));
    return {
      record: structuredClone(this.record),
      draft: structuredClone(this.draft),
      phase: this.phase,
      dirty,
      unsettled: dirty || this.pending !== null,
      error: this.failure ? humanError(this.failure) : "",
    };
  }
  private emit() {
    if (!this.disposed) this.options.changed(this.snapshot());
  }
  private clearTimer() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
  private schedule() {
    this.clearTimer();
    if (
      this.disposed ||
      !this.enabled ||
      this.record.status === "archived" ||
      this.flight ||
      this.pending ||
      ["retry", "error", "conflict"].includes(this.phase)
    )
      return;
    if (!this.snapshot().dirty) return;
    this.phase = "waiting";
    this.emit();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.startSave().catch(() => undefined);
    }, this.options.debounceMs ?? 700);
  }
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    this.schedule();
  }
  edit(draft: SurveyDraft) {
    if (this.disposed || !this.enabled || this.record.status === "archived") return;
    this.draft = structuredClone(draft);
    // Definitive validation/permission failures may be corrected; conflicts require reload.
    if (this.phase === "error") {
      this.phase = "idle";
      this.failure = undefined;
    }
    if (!this.flight && !this.pending && this.phase !== "conflict" && !this.snapshot().dirty)
      this.phase = this.record.revision ? "saved" : "idle";
    this.schedule();
    this.emit();
  }
  private startSave(): Promise<void> {
    if (this.flight) return this.flight;
    this.clearTimer();
    if (this.disposed || !this.enabled || this.record.status === "archived")
      return Promise.reject(new Error("Saving is unavailable for this editor"));
    if (["retry", "error", "conflict"].includes(this.phase))
      return Promise.reject(this.failure ?? new Error("Resolve the save error before continuing"));
    if (!this.pending) {
      const parsed = SurveyDraftSchema.safeParse(this.draft);
      if (!parsed.success) {
        this.failure = new Error(
          parsed.error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join(". "),
        );
        this.phase = "error";
        this.emit();
        return Promise.reject(this.failure);
      }
      this.pending = {
        body: JSON.stringify({
          draft: parsed.data,
          expectedRevision: this.record.revision,
          idempotencyKey: (this.options.key ?? surveyMutationKey)(),
        }),
        expectedRevision: this.record.revision,
      };
    }
    const intent = this.pending;
    this.phase = "saving";
    this.failure = undefined;
    this.emit();
    this.flight = this.persist(intent).finally(() => {
      this.flight = null;
      this.schedule();
    });
    return this.flight;
  }
  private async persist(intent: SaveIntent) {
    try {
      const record = await retryWithBackoff(
        () => {
          if (this.disposed) throw new Error("Editor closed");
          return this.options.save(intent.body);
        },
        {
          shouldRetry: (error) => !this.disposed && isRetryableSaveError(error),
          sleep: this.options.sleep,
        },
      );
      if (this.disposed) return;
      if (record.id !== this.record.id || record.revision !== intent.expectedRevision + 1)
        throw new TypeError("The save acknowledgement could not be verified. Retry the same save.");
      // Validate the acknowledged schema without replacing raw text in the active editor.
      // Normalized dirty comparison keeps whitespace-only differences from triggering writes.
      upgradeSurveyDraft(record.draft);
      this.record = structuredClone(record);
      this.pending = null;
      this.phase = "saved";
      this.emit();
    } catch (error) {
      if (this.disposed) throw error;
      this.failure = error;
      if (error instanceof ApiClientError && !isRetryableSaveError(error)) {
        this.pending = null;
        this.phase = error.code === "STALE_DRAFT" || error.status === 409 ? "conflict" : "error";
      } else {
        this.phase = "retry";
      }
      this.emit();
      throw error;
    }
  }
  /** Publishing and sharing must await this barrier and use its acknowledged revision. */
  async flush(): Promise<SurveyRecordView> {
    this.clearTimer();
    if (this.disposed) throw new Error("Editor closed");
    if (["retry", "error", "conflict"].includes(this.phase))
      throw this.failure ?? new Error("Resolve the save error before continuing");
    while (this.snapshot().unsettled) {
      if (this.disposed) throw new Error("Editor closed");
      if (this.flight) await this.flight;
      else await this.startSave();
      this.clearTimer();
    }
    return structuredClone(this.record);
  }
  async retry() {
    if (this.phase === "conflict") throw this.failure;
    this.failure = undefined;
    if (!this.flight) this.phase = "idle";
    return this.flush();
  }
  acceptRecord(record: SurveyRecordView) {
    if (this.flight || this.snapshot().unsettled || record.id !== this.record.id)
      throw new Error("Save the current edits before replacing the editor record");
    this.record = structuredClone(record);
    this.draft = upgradeSurveyDraft(record.draft);
    this.phase = "saved";
    this.failure = undefined;
    this.emit();
  }
  dispose() {
    this.disposed = true;
    this.clearTimer();
  }
}
