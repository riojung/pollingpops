import {
  PresentationDraftMutationSchema,
  PresentationDraftSchema,
  type PresentationDraft,
  type PresentationDraftMutation,
} from "@openround/contracts";

export interface PresentationSaveOperations<T> {
  revision: () => number;
  savedJson: () => string;
  mutationId: () => string;
  beforeNewAttempt?: () => void;
  persist: (pending: PresentationDraftMutation | null) => Promise<void>;
  send: (pending: PresentationDraftMutation) => Promise<T>;
  accepted: (response: T, pending: PresentationDraftMutation) => void;
  definitiveFailure?: (error: unknown) => boolean;
}

function matchesSaved(candidate: PresentationDraft, savedJson: string) {
  if (JSON.stringify(candidate) === savedJson) return true;
  try {
    return (
      JSON.stringify(PresentationDraftSchema.parse(candidate)) ===
      JSON.stringify(PresentationDraftSchema.parse(JSON.parse(savedJson)))
    );
  } catch {
    return false;
  }
}

/** A transport failure keeps its exact immutable request until the receipt is recovered. */
export class RetainedPresentationSave {
  private attempt: PresentationDraftMutation | null = null;

  get pending(): PresentationDraftMutation | null {
    return this.attempt;
  }

  restore(value: unknown) {
    PresentationDraftMutationSchema.parse(value);
    // Validate without reordering the already attempted envelope's serialized fields.
    this.attempt = structuredClone(value as PresentationDraftMutation);
  }

  clear() {
    this.attempt = null;
  }

  async save<T>(candidate: PresentationDraft, operations: PresentationSaveOperations<T>) {
    if (this.attempt) await this.settle(operations);
    if (matchesSaved(candidate, operations.savedJson())) return;
    operations.beforeNewAttempt?.();
    this.attempt = structuredClone({
      draft: candidate,
      expectedRevision: operations.revision(),
      mutationId: operations.mutationId(),
      schemaVersion: 2 as const,
    });
    await this.settle(operations);
  }

  private async settle<T>(operations: PresentationSaveOperations<T>) {
    const pending = this.attempt!;
    await operations.persist(pending);
    let response: T;
    try {
      response = await operations.send(pending);
    } catch (error) {
      if (operations.definitiveFailure?.(error)) {
        this.attempt = null;
        await operations.persist(null).catch(() => undefined);
      }
      throw error;
    }
    // Keep autosave aware of the attempt until its receipt updates the saved revision/JSON.
    // No asynchronous gap may expose an idle coordinator with the previous saved state.
    await operations.persist(null).catch(() => undefined);
    this.attempt = null;
    operations.accepted(response, pending);
  }
}
