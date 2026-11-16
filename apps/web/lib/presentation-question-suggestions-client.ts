import {
  CreatePresentationQuestionSuggestionsJobSchema,
  InsertPresentationQuestionSuggestionSchema,
  PresentationDraftSchema,
  PresentationQuestionSuggestionsJobSchema,
  buildPresentationQuestionSuggestionBlock,
  presentationQuestionSuggestionInsertedBlockHash,
  presentationQuestionSuggestionSource,
  presentationQuestionSuggestionsProposalHash,
  presentationQuestionSuggestionsSourceDigest,
  type PresentationDraft,
  type PresentationQuestionSuggestionsJob,
  type PresentationQuestionSuggestionsProposal,
} from "@openround/contracts";
import { ApiClientError, apiFetch, humanError } from "./api";
import { clientUuid } from "./uuid";

export interface QuestionSuggestionsTarget {
  blockId: string;
  expectedRevision: number;
  source: PresentationQuestionSuggestionsProposal["source"];
  sourceDigest: string;
}
export interface QuestionSuggestionsInsertedReceipt {
  jobId: string;
  proposalHash: string;
  suggestionId: string;
  sourceBlockId: string;
  sourceDigest: string;
  insertedBlockId: string;
  insertedQuestionId: string;
  acceptedRevision: number;
  acceptedDraft: PresentationDraft;
}
export interface QuestionSuggestionsStatus {
  enabled: boolean;
  monthlyLimit: number | null;
  used: number;
  remaining: number | null;
  active: number;
  maxActiveJobs: number;
}
export interface QuestionSuggestionsRecovery {
  schemaVersion: 1;
  actorKey: string;
  presentationId: string;
  blockId: string;
  sourceDigest: string;
  sourceRevision: number;
  expectedRevision: number;
  jobId: string;
  createBody: string;
  createUncertain: boolean;
  suggestionId: string | null;
  insertBody: string | null;
  insertProjectionHash: string | null;
}
export interface QuestionSuggestionsState {
  job: PresentationQuestionSuggestionsJob | null;
  recovery: QuestionSuggestionsRecovery | null;
  reviewed: boolean;
  busy: "generate" | "refresh" | "insert" | null;
  pending: boolean;
  error: string;
  message: string;
}
export const initialQuestionSuggestionsState = (): QuestionSuggestionsState => ({
  job: null,
  recovery: null,
  reviewed: false,
  busy: null,
  pending: false,
  error: "",
  message: "",
});
type Request = <T>(path: string, init?: RequestInit) => Promise<T>;
const base = "/v1/presentation-question-suggestions";
const sameId = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();
const digest = /^[a-f0-9]{64}$/;
const recoveryKeys = [
  "schemaVersion",
  "actorKey",
  "presentationId",
  "blockId",
  "sourceDigest",
  "sourceRevision",
  "expectedRevision",
  "jobId",
  "createBody",
  "createUncertain",
  "suggestionId",
  "insertBody",
  "insertProjectionHash",
];

/** The tab retains identities and exact mutation JSON, never the source or generated questions. */
export function parseQuestionSuggestionsRecovery(
  value: unknown,
  actorKey: string,
  presentationId: string,
): QuestionSuggestionsRecovery {
  try {
    if (!value || typeof value !== "object") throw new Error();
    const saved = value as QuestionSuggestionsRecovery;
    if (
      Object.keys(value).length !== recoveryKeys.length ||
      Object.keys(value).some((key) => !recoveryKeys.includes(key))
    )
      throw new Error();
    const create = CreatePresentationQuestionSuggestionsJobSchema.parse(
      JSON.parse(saved.createBody),
    );
    if (
      saved.schemaVersion !== 1 ||
      saved.actorKey !== actorKey ||
      saved.presentationId !== presentationId ||
      create.presentationId !== presentationId ||
      create.requestId !== saved.jobId ||
      create.blockId !== saved.blockId ||
      create.sourceDigest !== saved.sourceDigest ||
      create.expectedRevision !== saved.sourceRevision ||
      !Number.isInteger(saved.expectedRevision) ||
      saved.expectedRevision < saved.sourceRevision ||
      typeof saved.createUncertain !== "boolean" ||
      (saved.suggestionId !== null &&
        !InsertPresentationQuestionSuggestionSchema.shape.suggestionId.safeParse(saved.suggestionId)
          .success) ||
      (saved.insertBody !== null && (typeof saved.insertBody !== "string" || !saved.insertBody)) ||
      (saved.insertProjectionHash !== null && !digest.test(saved.insertProjectionHash)) ||
      Boolean(saved.insertBody) !== Boolean(saved.insertProjectionHash)
    )
      throw new Error();
    if (saved.insertBody) {
      const insert = InsertPresentationQuestionSuggestionSchema.parse(JSON.parse(saved.insertBody));
      if (
        insert.jobId !== saved.jobId ||
        insert.blockId !== saved.blockId ||
        insert.sourceDigest !== saved.sourceDigest ||
        insert.suggestionId !== saved.suggestionId ||
        insert.expectedRevision !== saved.expectedRevision ||
        saved.createUncertain
      )
        throw new Error();
    }
    return structuredClone(saved);
  } catch {
    throw new Error(
      "The saved discussion suggestion request could not be verified. No request was sent.",
    );
  }
}

export async function fetchQuestionSuggestionsStatus(
  presentationId: string,
  signal?: AbortSignal,
  request: Request = apiFetch,
) {
  const { status } = await request<{ status: QuestionSuggestionsStatus }>(
    `${base}/status?presentationId=${encodeURIComponent(presentationId)}`,
    { signal, cache: "no-store" },
  );
  if (
    !status ||
    typeof status.enabled !== "boolean" ||
    !Number.isInteger(status.used) ||
    status.used < 0 ||
    (status.monthlyLimit !== null &&
      (!Number.isInteger(status.monthlyLimit) || status.monthlyLimit < 0)) ||
    (status.remaining !== null && (!Number.isInteger(status.remaining) || status.remaining < 0)) ||
    !Number.isInteger(status.active) ||
    status.active < 0 ||
    status.maxActiveJobs !== 2
  )
    throw new Error(
      "The AI allowance could not be verified. Retry availability before generating.",
    );
  return status;
}

export function questionSuggestionsTargetMatches(
  target: QuestionSuggestionsTarget,
  saved: Pick<QuestionSuggestionsRecovery, "blockId" | "sourceDigest">,
) {
  return (
    sameId(target.blockId, saved.blockId) &&
    sameId(target.source.blockId, saved.blockId) &&
    target.sourceDigest === saved.sourceDigest &&
    presentationQuestionSuggestionsSourceDigest(target.source) === saved.sourceDigest
  );
}

/** One actor/deck/source-bound intent. Lost acknowledgements retain byte-identical requests. */
export function createPresentationQuestionSuggestions({
  actorKey,
  presentationId,
  canEdit,
  persist,
  onState,
  onInserted,
  request = apiFetch,
}: {
  actorKey: string;
  presentationId: string;
  canEdit: () => boolean;
  persist: (saved: QuestionSuggestionsRecovery | null) => void;
  onState: (state: QuestionSuggestionsState) => void;
  onInserted: (receipt: QuestionSuggestionsInsertedReceipt) => Promise<void> | void;
  request?: Request;
}) {
  let state = initialQuestionSuggestionsState();
  let cancelled = false;
  let generation = 0;
  let abort: AbortController | null = null;
  const publish = (next: QuestionSuggestionsState) => {
    state = next;
    onState(next);
  };
  const write = (saved: QuestionSuggestionsRecovery | null) => {
    persist(saved);
    state = { ...state, recovery: saved };
  };
  const current = (captured: number) => !cancelled && captured === generation && canEdit();
  const begin = () => {
    abort?.abort();
    abort = new AbortController();
    return { captured: ++generation, signal: abort.signal };
  };
  const jobPath = (id: string) =>
    `${base}/jobs/${encodeURIComponent(id)}?presentationId=${encodeURIComponent(presentationId)}`;
  function acceptJob(raw: unknown) {
    const job = PresentationQuestionSuggestionsJobSchema.parse(raw);
    const saved = state.recovery;
    if (
      !saved ||
      job.id !== saved.jobId ||
      job.requestId !== saved.jobId ||
      !sameId(job.presentationId, presentationId) ||
      !sameId(job.blockId, saved.blockId) ||
      job.sourceRevision !== saved.sourceRevision ||
      job.sourceDigest !== saved.sourceDigest ||
      job.outputLanguage !== "en"
    )
      throw new Error("The discussion proposal does not match the saved source request.");
    if (
      job.proposal &&
      (presentationQuestionSuggestionsProposalHash(job.proposal) !== job.proposalHash ||
        job.proposal.sourceDigest !== saved.sourceDigest ||
        presentationQuestionSuggestionsSourceDigest(job.proposal.source) !== saved.sourceDigest ||
        !sameId(job.proposal.source.blockId, saved.blockId))
    )
      throw new Error(
        "The discussion proposal receipt could not be verified. Recover the saved request.",
      );
    const suggestionId = saved.suggestionId ?? job.proposal?.suggestions[0]?.id ?? null;
    if (
      job.proposal &&
      suggestionId &&
      !job.proposal.suggestions.some((suggestion) => suggestion.id === suggestionId)
    )
      throw new Error("The saved choice does not match the recovered proposal.");
    if (
      saved.insertBody &&
      InsertPresentationQuestionSuggestionSchema.parse(JSON.parse(saved.insertBody))
        .proposalHash !== job.proposalHash
    )
      throw new Error("The recovered proposal does not match the exact saved insertion.");
    write({ ...saved, createUncertain: false, suggestionId });
    publish({
      ...state,
      job,
      reviewed: false,
      busy: null,
      pending: Boolean(saved.insertBody),
      error: "",
      message:
        job.status === "ready"
          ? "Both questions are ready. Review them and choose one to insert."
          : "",
    });
  }
  async function recover(createIfMissing: boolean) {
    if (cancelled || !canEdit() || state.busy || !state.recovery) return;
    const saved = state.recovery;
    try {
      persist(saved);
    } catch (error) {
      publish({ ...state, error: humanError(error) });
      return;
    }
    const { captured, signal } = begin();
    publish({ ...state, busy: createIfMissing ? "generate" : "refresh", error: "" });
    let posted = false;
    try {
      let result: { job: unknown };
      try {
        result = await request<{ job: unknown }>(jobPath(saved.jobId), {
          signal,
          cache: "no-store",
        });
      } catch (error) {
        if (!createIfMissing || !(error instanceof ApiClientError && error.status === 404))
          throw error;
        if (!current(captured)) return;
        const status = await fetchQuestionSuggestionsStatus(presentationId, signal, request);
        if (!current(captured)) return;
        if (!status.enabled || status.remaining === 0 || status.active >= status.maxActiveJobs)
          throw new Error(
            "AI generation is unavailable with the current allowance. Continue manually or retry availability later.",
            { cause: error },
          );
        write({ ...saved, createUncertain: true });
        publish({ ...state, pending: true });
        posted = true;
        result = await request<{ job: unknown }>(`${base}/jobs`, {
          method: "POST",
          body: saved.createBody,
          signal,
        });
      }
      if (current(captured)) acceptJob(result.job);
    } catch (error) {
      if (!current(captured)) return;
      const rejected =
        posted &&
        error instanceof ApiClientError &&
        ([400, 401, 403, 404, 409, 410, 413, 415, 422, 429].includes(error.status) ||
          (error.status === 503 && error.code === "AUTHORING_DISABLED"));
      const definitive = !saved.createUncertain && !saved.insertBody && (!posted || rejected);
      if (definitive) write({ ...saved, createUncertain: false });
      publish({
        ...state,
        busy: null,
        pending: definitive ? false : state.pending,
        error: humanError(error),
        message: definitive
          ? "No generation was accepted. Retry or discard this proposal to continue manually."
          : "The exact saved request is retained. Recover it before starting another.",
      });
    }
  }
  return {
    state: () => state,
    restore(value: unknown) {
      const recovery = parseQuestionSuggestionsRecovery(value, actorKey, presentationId);
      publish({
        ...initialQuestionSuggestionsState(),
        recovery,
        pending: recovery.createUncertain || Boolean(recovery.insertBody),
        message: "A saved discussion request is available. Recover and review it explicitly.",
      });
    },
    refresh: () => recover(false),
    retry: () => recover(true),
    cancel() {
      cancelled = true;
      generation++;
      abort?.abort();
    },
    reset() {
      if (cancelled || !canEdit() || state.busy || state.pending) return false;
      write(null);
      publish(initialQuestionSuggestionsState());
      return true;
    },
    select(suggestionId: string) {
      if (
        cancelled ||
        !canEdit() ||
        state.busy ||
        state.pending ||
        !state.recovery ||
        !state.job?.proposal?.suggestions.some((suggestion) => suggestion.id === suggestionId)
      )
        return;
      write({ ...state.recovery, suggestionId });
      publish({ ...state, reviewed: false });
    },
    review(reviewed: boolean) {
      if (!cancelled && canEdit() && !state.busy && !state.pending && state.job?.proposal)
        publish({ ...state, reviewed });
    },
    async generate(target: QuestionSuggestionsTarget) {
      if (cancelled || !canEdit() || state.busy || state.recovery) return;
      if (!questionSuggestionsTargetMatches(target, target))
        throw new Error("The selected source could not be verified. Reload the exact slide.");
      const create = CreatePresentationQuestionSuggestionsJobSchema.parse({
        schemaVersion: 1,
        requestId: clientUuid(),
        presentationId,
        blockId: target.blockId,
        expectedRevision: target.expectedRevision,
        sourceDigest: target.sourceDigest,
        outputLanguage: "en",
      });
      write({
        schemaVersion: 1,
        actorKey,
        presentationId,
        blockId: create.blockId,
        sourceDigest: create.sourceDigest,
        sourceRevision: create.expectedRevision,
        expectedRevision: create.expectedRevision,
        jobId: create.requestId,
        createBody: JSON.stringify(create),
        createUncertain: false,
        suggestionId: null,
        insertBody: null,
        insertProjectionHash: null,
      });
      publish({ ...state, pending: true, reviewed: false });
      await recover(true);
    },
    rebase(target: QuestionSuggestionsTarget) {
      const saved = state.recovery;
      if (!saved || cancelled || !canEdit() || state.busy || state.pending) return false;
      if (
        !questionSuggestionsTargetMatches(target, saved) ||
        !Number.isInteger(target.expectedRevision) ||
        target.expectedRevision < saved.expectedRevision
      )
        throw new Error(
          "The source slide text, language or reading order changed. Start a new request for that exact source.",
        );
      write({ ...saved, expectedRevision: target.expectedRevision });
      publish({
        ...state,
        reviewed: false,
        error: "",
        message: "The exact source is unchanged. Review both questions again before inserting.",
      });
      return true;
    },
    async insert(target: QuestionSuggestionsTarget | null) {
      if (cancelled || !canEdit() || state.busy || !state.recovery) return;
      const saved = state.recovery;
      if (
        !saved.insertBody &&
        (!state.reviewed || !state.job?.proposal || !saved.suggestionId || !target)
      )
        return;
      if (
        !saved.insertBody &&
        (!questionSuggestionsTargetMatches(target!, saved) ||
          target!.expectedRevision !== saved.expectedRevision)
      )
        throw new Error("Reload and review the exact unchanged source before inserting.");
      const input = saved.insertBody
        ? InsertPresentationQuestionSuggestionSchema.parse(JSON.parse(saved.insertBody))
        : InsertPresentationQuestionSuggestionSchema.parse({
            schemaVersion: 1,
            jobId: saved.jobId,
            proposalHash: state.job!.proposalHash,
            blockId: saved.blockId,
            sourceDigest: saved.sourceDigest,
            suggestionId: saved.suggestionId,
            reviewed: true,
            expectedRevision: saved.expectedRevision,
            mutationId: clientUuid(),
          });
      const projectionHash =
        saved.insertProjectionHash ??
        presentationQuestionSuggestionInsertedBlockHash(
          buildPresentationQuestionSuggestionBlock({
            proposal: state.job!.proposal!,
            jobId: input.jobId,
            suggestionId: input.suggestionId,
            mutationId: input.mutationId,
          }),
        );
      write({
        ...saved,
        insertBody: saved.insertBody ?? JSON.stringify(input),
        insertProjectionHash: projectionHash,
      });
      const { captured, signal } = begin();
      publish({
        ...state,
        busy: "insert",
        pending: true,
        error: "",
        message: "Inserting the one reviewed discussion question…",
      });
      try {
        const result = await request<{
          presentation: { id: string; draft: unknown; draftRevision: number };
          insertedBlockId: string;
          insertedQuestionId: string;
          jobId: string;
          proposalHash: string;
          suggestionId: string;
          sourceDigest: string;
          sourceBlockId: string;
        }>(`/v1/presentations/${presentationId}/question-suggestions/insert`, {
          method: "POST",
          body: state.recovery!.insertBody!,
          signal,
        });
        if (!current(captured)) return;
        const draft = PresentationDraftSchema.parse(result.presentation?.draft);
        const block = draft.blocks.find((block) => sameId(block.id, result.insertedBlockId));
        const sourceIndex = draft.blocks.findIndex((block) => sameId(block.id, saved.blockId));
        const sourceBlock = draft.blocks[sourceIndex];
        const source = sourceBlock ? presentationQuestionSuggestionSource(sourceBlock) : null;
        if (
          !sameId(result.presentation.id, presentationId) ||
          !Number.isInteger(result.presentation.draftRevision) ||
          result.presentation.draftRevision < input.expectedRevision + 1 ||
          result.jobId !== saved.jobId ||
          result.proposalHash !== input.proposalHash ||
          result.suggestionId !== input.suggestionId ||
          result.sourceDigest !== saved.sourceDigest ||
          !sameId(result.sourceBlockId, saved.blockId) ||
          !source?.supported ||
          presentationQuestionSuggestionsSourceDigest(source.source) !== saved.sourceDigest ||
          !sameId(draft.blocks[sourceIndex + 1]?.id ?? "", result.insertedBlockId) ||
          block?.kind !== "question" ||
          !sameId(block.question.id, result.insertedQuestionId) ||
          sameId(block.id, saved.blockId) ||
          presentationQuestionSuggestionInsertedBlockHash(block) !== projectionHash
        )
          throw new Error(
            "The insertion receipt could not be verified. Retry the exact saved insertion.",
          );
        await onInserted({
          jobId: result.jobId,
          proposalHash: result.proposalHash,
          suggestionId: result.suggestionId,
          sourceBlockId: saved.blockId,
          sourceDigest: saved.sourceDigest,
          insertedBlockId: block.id,
          insertedQuestionId: block.question.id,
          acceptedRevision: result.presentation.draftRevision,
          acceptedDraft: draft,
        });
        if (!current(captured)) return;
        write(null);
        publish({
          ...initialQuestionSuggestionsState(),
          message: "Reviewed discussion question inserted. It remains editable.",
        });
        return true;
      } catch (error) {
        if (!current(captured)) return;
        // A later rejection cannot disprove an earlier unacknowledged insertion.
        const definitive =
          !saved.insertBody &&
          error instanceof ApiClientError &&
          [400, 401, 403, 404, 409, 410, 413, 415, 422, 429].includes(error.status);
        if (definitive) write({ ...state.recovery!, insertBody: null, insertProjectionHash: null });
        publish({
          ...state,
          busy: null,
          pending: !definitive,
          reviewed: false,
          error: humanError(error),
          message: definitive
            ? "Your proposal is retained. Reload the exact saved source and review both questions before retrying."
            : "Insertion was not confirmed. Retry the exact insertion before editing or discarding.",
        });
      }
    },
  };
}
