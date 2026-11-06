import {
  ApplyPresentationTextAssistanceSchema,
  CreatePresentationTextAssistanceJobSchema,
  PresentationDraftSchema,
  PresentationTextAssistanceJobSchema,
  presentationTextAssistanceProposalHash,
  presentationTextAssistanceSourceDigest,
  type PresentationTextAssistanceJob,
  type PresentationDraft,
} from "@openround/contracts";
import { ApiClientError, apiFetch, humanError } from "./api";
import { clientUuid } from "./uuid";

export interface TextAssistanceTarget {
  blockId: string;
  nodeId: string;
  role: "title" | "body";
  operation: "rewrite" | "shorten";
  text: string;
  expectedRevision: number;
}
export interface TextAssistanceAppliedReceipt {
  blockId: string;
  nodeId: string;
  role: "title" | "body";
  sourceDigest: string;
  acceptedRevision: number;
  acceptedDraft: PresentationDraft;
}

export interface TextAssistanceStatus {
  enabled: boolean;
  monthlyLimit: number | null;
  used: number;
  remaining: number | null;
  active: number;
  maxActiveJobs: number;
}
export interface TextAssistanceRecovery {
  schemaVersion: 1;
  actorKey: string;
  presentationId: string;
  blockId: string;
  nodeId: string;
  role: "title" | "body";
  operation: "rewrite" | "shorten";
  sourceDigest: string;
  sourceRevision: number;
  expectedRevision: number;
  jobId: string;
  createBody: string;
  createUncertain: boolean;
  applyBody: string | null;
  outputDigest: string | null;
  provenanceDigest: string | null;
}
export interface TextAssistanceState {
  job: PresentationTextAssistanceJob | null;
  recovery: TextAssistanceRecovery | null;
  reviewed: boolean;
  busy: "generate" | "refresh" | "apply" | null;
  pending: boolean;
  error: string;
  message: string;
}
export const initialTextAssistanceState = (): TextAssistanceState => ({
  job: null,
  recovery: null,
  reviewed: false,
  busy: null,
  pending: false,
  error: "",
  message: "",
});
type Request = <T>(path: string, init?: RequestInit) => Promise<T>;
const base = "/v1/presentation-text-assistance";
const invalidRecovery =
  "The saved text assistance request could not be verified. No request was sent.";
const keys = [
  "schemaVersion",
  "actorKey",
  "presentationId",
  "blockId",
  "nodeId",
  "role",
  "operation",
  "sourceDigest",
  "sourceRevision",
  "expectedRevision",
  "jobId",
  "createBody",
  "createUncertain",
  "applyBody",
  "outputDigest",
  "provenanceDigest",
];

/** Session recovery stores identities, digests and exact mutation JSON, never either text. */
export function parseTextAssistanceRecovery(
  value: unknown,
  actorKey: string,
  presentationId: string,
): TextAssistanceRecovery {
  try {
    if (
      !value ||
      typeof value !== "object" ||
      Object.keys(value).length !== keys.length ||
      Object.keys(value).some((key) => !keys.includes(key))
    )
      throw new Error();
    const recovery = value as TextAssistanceRecovery;
    const create = CreatePresentationTextAssistanceJobSchema.parse(JSON.parse(recovery.createBody));
    if (
      recovery.schemaVersion !== 1 ||
      recovery.actorKey !== actorKey ||
      recovery.presentationId !== presentationId ||
      create.presentationId !== presentationId ||
      create.requestId !== recovery.jobId ||
      create.blockId !== recovery.blockId ||
      create.nodeId !== recovery.nodeId ||
      create.operation !== recovery.operation ||
      create.sourceDigest !== recovery.sourceDigest ||
      create.expectedRevision !== recovery.sourceRevision ||
      !["title", "body"].includes(recovery.role) ||
      !Number.isInteger(recovery.expectedRevision) ||
      recovery.expectedRevision < recovery.sourceRevision ||
      typeof recovery.createUncertain !== "boolean" ||
      (recovery.applyBody !== null && typeof recovery.applyBody !== "string") ||
      (recovery.outputDigest !== null && !/^[a-f0-9]{64}$/.test(recovery.outputDigest)) ||
      (recovery.provenanceDigest !== null && !/^[a-f0-9]{64}$/.test(recovery.provenanceDigest)) ||
      Boolean(recovery.applyBody) !== Boolean(recovery.provenanceDigest) ||
      Boolean(recovery.applyBody) !== Boolean(recovery.outputDigest)
    )
      throw new Error();
    if (recovery.applyBody) {
      const apply = ApplyPresentationTextAssistanceSchema.parse(JSON.parse(recovery.applyBody));
      if (
        apply.jobId !== recovery.jobId ||
        apply.blockId !== recovery.blockId ||
        apply.nodeId !== recovery.nodeId ||
        apply.sourceDigest !== recovery.sourceDigest ||
        apply.expectedRevision !== recovery.expectedRevision ||
        recovery.createUncertain
      )
        throw new Error();
    }
    return structuredClone(recovery);
  } catch {
    throw new Error(invalidRecovery);
  }
}

export async function fetchTextAssistanceStatus(
  presentationId: string,
  signal?: AbortSignal,
  request: Request = apiFetch,
) {
  const { status } = await request<{ status: TextAssistanceStatus }>(
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
    !Number.isInteger(status.maxActiveJobs) ||
    status.maxActiveJobs < 1
  )
    throw new Error(
      "The AI allowance could not be verified. Retry availability before generating.",
    );
  return status;
}

function provenanceDigest(value: {
  schemaVersion: 1;
  nodeId: string;
  role: "title" | "body";
  operation: "rewrite" | "shorten";
  sourceDigest: string;
  outputDigest: string;
  provider: string;
  model: string;
  generatedAt: string;
  reviewWarning: string;
}) {
  return presentationTextAssistanceSourceDigest(
    JSON.stringify({
      schemaVersion: value.schemaVersion,
      nodeId: value.nodeId,
      role: value.role,
      operation: value.operation,
      sourceDigest: value.sourceDigest,
      outputDigest: value.outputDigest,
      provider: value.provider,
      model: value.model,
      generatedAt: value.generatedAt,
      reviewWarning: value.reviewWarning,
    }),
  );
}

/** Block IDs are UUIDs; native node IDs below remain exact and case-sensitive. */
export const sameTextAssistanceBlockId = (left: string, right: string) =>
  left.toLowerCase() === right.toLowerCase();

export function textAssistanceTargetMatches(
  target: TextAssistanceTarget,
  recovery: Pick<TextAssistanceRecovery, "blockId" | "nodeId" | "role" | "sourceDigest">,
) {
  return (
    sameTextAssistanceBlockId(target.blockId, recovery.blockId) &&
    target.nodeId === recovery.nodeId &&
    target.role === recovery.role &&
    presentationTextAssistanceSourceDigest(target.text) === recovery.sourceDigest
  );
}

export function createPresentationTextAssistance({
  actorKey,
  presentationId,
  canEdit,
  persist,
  onState,
  onApplied,
  request = apiFetch,
}: {
  actorKey: string;
  presentationId: string;
  canEdit: () => boolean;
  persist: (value: TextAssistanceRecovery | null) => void;
  onState: (value: TextAssistanceState) => void;
  onApplied: (receipt: TextAssistanceAppliedReceipt) => Promise<void> | void;
  request?: Request;
}) {
  let state = initialTextAssistanceState();
  let cancelled = false;
  let generation = 0;
  let abort: AbortController | null = null;
  const publish = (next: TextAssistanceState) => {
    state = next;
    onState(next);
  };
  const current = (captured: number) => !cancelled && generation === captured && canEdit();
  const write = (recovery: TextAssistanceRecovery | null) => {
    persist(recovery);
    state = { ...state, recovery };
  };
  const begin = () => {
    abort?.abort();
    abort = new AbortController();
    return { captured: ++generation, signal: abort.signal };
  };
  const jobPath = (id: string) =>
    `${base}/jobs/${encodeURIComponent(id)}?presentationId=${encodeURIComponent(presentationId)}`;
  function acceptJob(raw: unknown) {
    const job = PresentationTextAssistanceJobSchema.parse(raw);
    const saved = state.recovery;
    if (
      !saved ||
      job.id !== saved.jobId ||
      job.presentationId !== presentationId ||
      !sameTextAssistanceBlockId(job.blockId, saved.blockId) ||
      job.nodeId !== saved.nodeId ||
      job.operation !== saved.operation ||
      job.role !== saved.role ||
      job.sourceRevision !== saved.sourceRevision ||
      job.sourceDigest !== saved.sourceDigest
    )
      throw new Error(
        "The text proposal does not match the saved target. Retry the saved request.",
      );
    const proposal = job.proposal;
    if (
      proposal &&
      saved.applyBody &&
      ApplyPresentationTextAssistanceSchema.parse(JSON.parse(saved.applyBody)).proposalHash !==
        job.proposalHash
    )
      throw new Error("The saved application does not match the recovered proposal.");
    if (
      proposal &&
      (!sameTextAssistanceBlockId(proposal.blockId, saved.blockId) ||
        proposal.nodeId !== saved.nodeId ||
        proposal.role !== saved.role ||
        proposal.operation !== saved.operation ||
        proposal.sourceDigest !== saved.sourceDigest ||
        presentationTextAssistanceSourceDigest(proposal.originalText) !== saved.sourceDigest ||
        presentationTextAssistanceSourceDigest(proposal.text) !== proposal.outputDigest ||
        presentationTextAssistanceProposalHash(proposal) !== job.proposalHash ||
        proposal.text === proposal.originalText ||
        (saved.operation === "shorten" && proposal.text.length >= proposal.originalText.length))
    )
      throw new Error("The text proposal receipt could not be verified. Retry the saved request.");
    write({ ...saved, createUncertain: false });
    publish({
      ...state,
      job,
      busy: null,
      pending: Boolean(saved.applyBody),
      error: "",
      message:
        job.status === "ready"
          ? "Proposal ready. Review the complete original and proposed wording."
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
    let attemptedPost = false;
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
        const status = await fetchTextAssistanceStatus(presentationId, signal, request);
        if (!current(captured)) return;
        if (!status.enabled || status.remaining === 0 || status.active >= status.maxActiveJobs)
          throw new Error(
            "AI generation is unavailable with the current allowance. Retry availability later.",
            { cause: error },
          );
        // Persist uncertainty only when creation can reach the server. A failed fresh
        // preflight can be discarded; an earlier unacknowledged POST must stay recoverable.
        write({ ...saved, createUncertain: true });
        publish({ ...state, pending: true });
        attemptedPost = true;
        result = await request<{ job: unknown }>(`${base}/jobs`, {
          method: "POST",
          body: saved.createBody,
          signal,
        });
      }
      if (current(captured)) acceptJob(result.job);
    } catch (error) {
      if (!current(captured)) return;
      const admissionRejected =
        attemptedPost &&
        error instanceof ApiClientError &&
        ([400, 401, 403, 404, 409, 410, 413, 415, 422, 429].includes(error.status) ||
          (error.status === 503 && error.code === "AUTHORING_DISABLED"));
      const definitive =
        !saved.createUncertain && !saved.applyBody && (!attemptedPost || admissionRejected);
      if (definitive) write({ ...saved, createUncertain: false });
      publish({
        ...state,
        busy: null,
        pending: definitive ? false : state.pending,
        error: humanError(error),
        message: definitive
          ? attemptedPost
            ? "This request was rejected. Discard it and select the current saved text for a new request."
            : "No new generation request was sent. Retry recovery, or discard this request to continue editing."
          : "The exact saved request is retained. Retry recovery before starting another request.",
      });
    }
  }
  return {
    state: () => state,
    restore(value: unknown) {
      const recovery = parseTextAssistanceRecovery(value, actorKey, presentationId);
      publish({
        ...initialTextAssistanceState(),
        recovery,
        pending: recovery.createUncertain || Boolean(recovery.applyBody),
        message: "A saved text request is available. Recover and review it explicitly.",
      });
    },
    refresh: () => recover(false),
    retry: () => recover(true),
    review(reviewed: boolean) {
      if (!cancelled && canEdit() && !state.busy && !state.pending) publish({ ...state, reviewed });
    },
    reset() {
      if (cancelled || !canEdit() || state.busy || state.pending) return false;
      write(null);
      publish(initialTextAssistanceState());
      return true;
    },
    cancel() {
      cancelled = true;
      generation++;
      abort?.abort();
    },
    async generate(target: TextAssistanceTarget) {
      if (cancelled || !canEdit() || state.busy || state.recovery) return;
      if (!target.text.trim() || target.text.length > (target.role === "title" ? 160 : 4000))
        throw new Error("Select non-empty plain text within the title or body limit.");
      const candidate = CreatePresentationTextAssistanceJobSchema.parse({
        schemaVersion: 1,
        requestId: clientUuid(),
        presentationId,
        blockId: target.blockId,
        nodeId: target.nodeId,
        operation: target.operation,
        expectedRevision: target.expectedRevision,
        sourceDigest: presentationTextAssistanceSourceDigest(target.text),
      });
      const recovery: TextAssistanceRecovery = {
        schemaVersion: 1,
        actorKey,
        presentationId,
        blockId: candidate.blockId,
        nodeId: candidate.nodeId,
        role: target.role,
        operation: candidate.operation,
        sourceDigest: candidate.sourceDigest,
        sourceRevision: candidate.expectedRevision,
        expectedRevision: candidate.expectedRevision,
        jobId: candidate.requestId,
        createBody: JSON.stringify(candidate),
        createUncertain: false,
        applyBody: null,
        outputDigest: null,
        provenanceDigest: null,
      };
      write(recovery);
      publish({ ...state, pending: true, reviewed: false });
      await recover(true);
    },
    rebase(target: TextAssistanceTarget) {
      const saved = state.recovery;
      if (!saved || state.busy || state.pending || !canEdit()) return false;
      if (
        !Number.isInteger(target.expectedRevision) ||
        target.expectedRevision < saved.sourceRevision ||
        !textAssistanceTargetMatches(target, saved)
      )
        throw new Error(
          "The selected text was changed or deleted. Start a new request for the exact target.",
        );
      write({ ...saved, expectedRevision: target.expectedRevision });
      publish({
        ...state,
        reviewed: false,
        error: "",
        message: "The exact target is unchanged in the saved deck. Review again before applying.",
      });
      return true;
    },
    async apply(target: TextAssistanceTarget | null) {
      if (cancelled || !canEdit() || state.busy || !state.recovery) return;
      const saved = state.recovery;
      if (!saved.applyBody && (!state.reviewed || !state.job?.proposal || !target)) return;
      if (
        !saved.applyBody &&
        (!textAssistanceTargetMatches(target!, saved) ||
          target!.expectedRevision !== saved.expectedRevision)
      )
        throw new Error("Reload and review the exact unchanged target before applying.");
      const input = saved.applyBody
        ? ApplyPresentationTextAssistanceSchema.parse(JSON.parse(saved.applyBody))
        : ApplyPresentationTextAssistanceSchema.parse({
            schemaVersion: 1,
            jobId: saved.jobId,
            proposalHash: state.job!.proposalHash,
            blockId: saved.blockId,
            nodeId: saved.nodeId,
            sourceDigest: saved.sourceDigest,
            reviewed: true,
            expectedRevision: saved.expectedRevision,
            mutationId: clientUuid(),
          });
      const outputDigest = saved.outputDigest ?? state.job!.proposal!.outputDigest;
      write({
        ...saved,
        applyBody: saved.applyBody ?? JSON.stringify(input),
        outputDigest,
        provenanceDigest: saved.provenanceDigest ?? provenanceDigest(state.job!.proposal!),
      });
      const { captured, signal } = begin();
      publish({
        ...state,
        busy: "apply",
        pending: true,
        error: "",
        message: "Applying the reviewed text…",
      });
      try {
        const result = await request<{
          presentation: { id: string; draft: unknown; draftRevision: number };
          jobId: string;
          blockId: string;
          nodeId: string;
          proposalHash: string;
          sourceDigest: string;
          outputDigest: string;
        }>(`/v1/presentations/${presentationId}/text-assistance/apply`, {
          method: "POST",
          body: state.recovery!.applyBody!,
          signal,
        });
        if (!current(captured)) return;
        const draft = PresentationDraftSchema.parse(result.presentation?.draft);
        const block = draft.blocks.find((block) =>
          sameTextAssistanceBlockId(block.id, saved.blockId),
        );
        const node =
          block?.kind === "content"
            ? block.scene?.nodes.find((node) => node.id === saved.nodeId)
            : null;
        const metadata = block?.kind === "content" ? block.textAssistance : null;
        if (
          result.presentation.id !== presentationId ||
          !Number.isInteger(result.presentation.draftRevision) ||
          result.presentation.draftRevision < input.expectedRevision + 1 ||
          result.jobId !== saved.jobId ||
          !sameTextAssistanceBlockId(result.blockId, saved.blockId) ||
          result.nodeId !== saved.nodeId ||
          result.proposalHash !== input.proposalHash ||
          result.sourceDigest !== saved.sourceDigest ||
          result.outputDigest !== outputDigest ||
          node?.type !== "text" ||
          node.richText ||
          node.role !== saved.role ||
          presentationTextAssistanceSourceDigest(node.text) !== outputDigest ||
          !metadata ||
          metadata.nodeId !== saved.nodeId ||
          metadata.role !== saved.role ||
          metadata.operation !== saved.operation ||
          metadata.sourceDigest !== saved.sourceDigest ||
          metadata.outputDigest !== outputDigest ||
          provenanceDigest(metadata) !== state.recovery!.provenanceDigest ||
          (state.job?.proposal &&
            (metadata.provider !== state.job.proposal.provider ||
              metadata.model !== state.job.proposal.model ||
              metadata.generatedAt !== state.job.proposal.generatedAt ||
              metadata.reviewWarning !== state.job.proposal.reviewWarning))
        )
          throw new Error(
            "The text application receipt could not be verified. Retry the exact saved application.",
          );
        await onApplied({
          blockId: saved.blockId,
          nodeId: saved.nodeId,
          role: saved.role,
          sourceDigest: saved.sourceDigest,
          acceptedRevision: result.presentation.draftRevision,
          acceptedDraft: draft,
        });
        if (!current(captured)) return;
        write(null);
        publish({ ...initialTextAssistanceState(), message: "Reviewed text applied." });
      } catch (error) {
        if (!current(captured)) return;
        const definitive =
          error instanceof ApiClientError && [400, 409, 422].includes(error.status);
        if (definitive)
          write({
            ...state.recovery!,
            applyBody: null,
            outputDigest: null,
            provenanceDigest: null,
          });
        publish({
          ...state,
          busy: null,
          pending: !definitive,
          reviewed: false,
          error: humanError(error),
          message: definitive
            ? "The proposal is retained. Reload the saved deck and review the same unchanged target before retrying."
            : "Application was not confirmed. Retry the exact saved application before editing or resetting.",
        });
      }
    },
  };
}
