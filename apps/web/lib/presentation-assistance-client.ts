import {
  CreatePresentationAssistanceJobSchema,
  InsertPresentationAssistanceProposalsSchema,
  PresentationAssistanceJobSchema,
  PresentationDraftSchema,
  presentationAssistanceProposalHash,
  presentationAssistanceSourceDigest,
  presentationAssistanceSlideProjectionHash,
  type PresentationAssistanceJob,
} from "@openround/contracts";
import { ApiClientError, apiFetch, humanError } from "./api";
import { clientUuid } from "./uuid";

export interface PresentationAssistanceStatus {
  enabled: boolean;
  monthlyLimit: number | null;
  used: number;
  remaining: number | null;
  active: number;
  maxActiveJobs: number;
  minimumSlides: number;
  maximumSlides: number;
}

export interface AssistanceRecovery {
  schemaVersion: 1;
  jobId: string;
  sourceName: string;
  slideCount: number;
  sourceDigest: string;
  selectionInitialized: boolean;
  selectedSlideIds: string[];
  insertBody: string | null;
  insertProjectionHash: string | null;
}

export interface AssistanceState {
  job: PresentationAssistanceJob | null;
  selectedSlideIds: string[];
  reviewed: boolean;
  busy: "generate" | "refresh" | "insert" | null;
  pendingInsert: boolean;
  error: string;
  message: string;
}

const initialState = (): AssistanceState => ({
  job: null,
  selectedSlideIds: [],
  reviewed: false,
  busy: null,
  pendingInsert: false,
  error: "",
  message: "",
});

type Request = <T>(path: string, init?: RequestInit) => Promise<T>;
const base = "/v1/presentation-assistance";

/** Recovery contains request identities and review choices, never the pasted outline. */
export function parseAssistanceRecovery(
  value: unknown,
  presentationId: string,
): AssistanceRecovery {
  if (!value || typeof value !== "object") throw new Error("Invalid assistance recovery.");
  const recovery = value as AssistanceRecovery;
  const keys = [
    "schemaVersion",
    "jobId",
    "sourceName",
    "slideCount",
    "sourceDigest",
    "selectionInitialized",
    "selectedSlideIds",
    "insertBody",
    "insertProjectionHash",
  ];
  if (
    Object.keys(recovery).some((key) => !keys.includes(key)) ||
    recovery.schemaVersion !== 1 ||
    !PresentationAssistanceJobSchema.shape.id.safeParse(recovery.jobId).success ||
    typeof recovery.sourceName !== "string" ||
    !recovery.sourceName.trim() ||
    recovery.sourceName.length > 160 ||
    !Number.isInteger(recovery.slideCount) ||
    recovery.slideCount < 3 ||
    recovery.slideCount > 8 ||
    !/^[a-f0-9]{64}$/.test(recovery.sourceDigest) ||
    typeof recovery.selectionInitialized !== "boolean" ||
    !Array.isArray(recovery.selectedSlideIds) ||
    recovery.selectedSlideIds.length > 8 ||
    new Set(recovery.selectedSlideIds).size !== recovery.selectedSlideIds.length ||
    recovery.selectedSlideIds.some(
      (id) => !PresentationAssistanceJobSchema.shape.id.safeParse(id).success,
    ) ||
    (recovery.insertBody !== null && typeof recovery.insertBody !== "string") ||
    (recovery.insertProjectionHash !== null &&
      !/^[a-f0-9]{64}$/.test(recovery.insertProjectionHash)) ||
    Boolean(recovery.insertBody) !== Boolean(recovery.insertProjectionHash)
  )
    throw new Error("The saved assistance request could not be verified.");
  if (recovery.insertBody) {
    const input = InsertPresentationAssistanceProposalsSchema.parse(
      JSON.parse(recovery.insertBody),
    );
    if (input.jobId !== recovery.jobId || !presentationId)
      throw new Error("Invalid insertion recovery.");
  }
  return structuredClone(recovery);
}

export async function fetchPresentationAssistanceStatus(
  presentationId: string,
  signal?: AbortSignal,
) {
  const result = await apiFetch<{ status: PresentationAssistanceStatus }>(
    `${base}/status?presentationId=${encodeURIComponent(presentationId)}`,
    { signal, cache: "no-store" },
  );
  const status = result?.status;
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
    status.maxActiveJobs < 1 ||
    status.minimumSlides !== 3 ||
    status.maximumSlides !== 8
  )
    throw new Error(
      "The AI allowance could not be verified. Retry availability before generating.",
    );
  return status;
}

/** A controller owns one actor/deck-bound intent and fences all late asynchronous replies. */
export function createPresentationAssistance({
  presentationId,
  canEdit,
  persist,
  onState,
  onInserted,
  request = apiFetch,
}: {
  presentationId: string;
  canEdit: () => boolean;
  persist: (recovery: AssistanceRecovery | null) => void;
  onState: (state: AssistanceState) => void;
  onInserted: (ids: string[]) => Promise<void> | void;
  request?: Request;
}) {
  let state = initialState();
  let recovery: AssistanceRecovery | null = null;
  let createBody: string | null = null;
  let generation = 0;
  let cancelled = false;
  let abort: AbortController | null = null;
  const publish = (next: AssistanceState) => {
    state = next;
    onState(next);
  };
  const current = (captured: number) => !cancelled && generation === captured && canEdit();
  const begin = () => {
    abort?.abort();
    abort = new AbortController();
    return { captured: ++generation, signal: abort.signal };
  };
  const write = (next: AssistanceRecovery | null) => {
    persist(next);
    recovery = next;
  };
  const jobPath = (id: string) =>
    `${base}/jobs/${encodeURIComponent(id)}?presentationId=${encodeURIComponent(presentationId)}`;
  function acceptJob(raw: unknown) {
    const parsed = PresentationAssistanceJobSchema.safeParse(raw);
    if (!parsed.success || !recovery)
      throw new Error("The AI proposal receipt could not be verified. Retry the saved request.");
    const job = parsed.data;
    if (
      job.id !== recovery.jobId ||
      job.requestId !== recovery.jobId ||
      job.presentationId !== presentationId ||
      job.sourceName !== recovery.sourceName ||
      job.slideCount !== recovery.slideCount ||
      job.sourceDigest !== recovery.sourceDigest ||
      (job.proposal &&
        (job.proposal.sourceDigest !== job.sourceDigest ||
          job.proposal.sourceName !== job.sourceName ||
          job.proposal.slides.length !== job.slideCount ||
          presentationAssistanceProposalHash(job.proposal) !== job.proposalHash))
    )
      throw new Error(
        "The AI proposal does not match this outline request. Retry the saved request.",
      );
    const ids = recovery.insertBody
      ? InsertPresentationAssistanceProposalsSchema.parse(JSON.parse(recovery.insertBody))
          .selectedSlideIds
      : recovery.selectionInitialized
        ? recovery.selectedSlideIds
        : (job.proposal?.slides.map((slide) => slide.id) ?? []);
    if (job.proposal && ids.some((id) => !job.proposal!.slides.some((slide) => slide.id === id)))
      throw new Error("The saved slide selection does not match this proposal.");
    write({
      ...recovery,
      selectedSlideIds: ids,
      selectionInitialized: Boolean(job.proposal) || recovery.selectionInitialized,
    });
    publish({
      ...state,
      job,
      selectedSlideIds: ids,
      busy: null,
      error: "",
      message:
        job.status === "ready"
          ? "Proposal ready. Review the text and exact excerpts before inserting."
          : "",
    });
  }
  async function refresh() {
    if (cancelled || !canEdit() || !recovery || state.busy) return;
    const { captured, signal } = begin();
    publish({ ...state, busy: "refresh", error: "" });
    try {
      const result = await request<{ job: unknown }>(jobPath(recovery.jobId), {
        signal,
        cache: "no-store",
      });
      if (current(captured)) acceptJob(result.job);
    } catch (error) {
      if (current(captured))
        publish({
          ...state,
          busy: null,
          error: humanError(error),
          message: "The saved request is retained. Retry proposal recovery; no new job is created.",
        });
    }
  }
  return {
    state: () => state,
    refresh,
    restore(value: unknown) {
      recovery = parseAssistanceRecovery(value, presentationId);
      publish({
        ...state,
        selectedSlideIds: recovery.selectedSlideIds,
        pendingInsert: Boolean(recovery.insertBody),
        message: "A previous outline request was found. Recover it before starting another.",
      });
    },
    cancel() {
      cancelled = true;
      generation++;
      abort?.abort();
    },
    reset() {
      if (state.pendingInsert || state.busy || cancelled) return false;
      generation++;
      abort?.abort();
      createBody = null;
      write(null);
      publish(initialState());
      return true;
    },
    select(id: string) {
      if (state.busy || state.pendingInsert || !canEdit() || !state.job?.proposal || !recovery)
        return;
      if (!state.job.proposal.slides.some((slide) => slide.id === id)) return;
      const selected = new Set(state.selectedSlideIds);
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      const selectedSlideIds = state.job.proposal.slides
        .filter((slide) => selected.has(slide.id))
        .map((slide) => slide.id);
      write({ ...recovery, selectedSlideIds });
      publish({ ...state, selectedSlideIds, reviewed: false, error: "" });
    },
    review(reviewed: boolean) {
      if (!state.busy && !state.pendingInsert && canEdit()) publish({ ...state, reviewed });
    },
    async generate(input: { sourceName: string; outline: string; slideCount: number }) {
      if (cancelled || !canEdit() || state.busy || state.pendingInsert) return;
      const candidate = CreatePresentationAssistanceJobSchema.parse({
        schemaVersion: 1,
        presentationId,
        requestId: recovery?.jobId ?? clientUuid(),
        ...input,
      });
      if (recovery && !createBody) {
        await refresh();
        return;
      }
      const serialized = JSON.stringify(candidate);
      if (createBody && serialized !== createBody)
        throw new Error("Recover the previous request before changing the outline.");
      createBody ??= serialized;
      write({
        schemaVersion: 1,
        jobId: candidate.requestId,
        sourceName: candidate.sourceName,
        slideCount: candidate.slideCount,
        sourceDigest: presentationAssistanceSourceDigest(candidate.outline),
        selectionInitialized: false,
        selectedSlideIds: [],
        insertBody: null,
        insertProjectionHash: null,
      });
      const { captured, signal } = begin();
      publish({
        ...state,
        busy: "generate",
        error: "",
        message: "Creating a review proposal. Your deck is unchanged.",
      });
      try {
        // A stable-ID read recovers an accepted request before any retry can spend another allowance.
        let result: { job: unknown };
        try {
          result = await request<{ job: unknown }>(jobPath(candidate.requestId), {
            signal,
            cache: "no-store",
          });
        } catch (error) {
          if (!(error instanceof ApiClientError && error.status === 404)) throw error;
          if (!current(captured)) return;
          result = await request<{ job: unknown }>(`${base}/jobs`, {
            method: "POST",
            body: createBody,
            signal,
          });
        }
        if (current(captured)) acceptJob(result.job);
      } catch (error) {
        if (current(captured))
          publish({
            ...state,
            busy: null,
            error: humanError(error),
            message:
              "Generation was not confirmed. Retry this request to recover its result without creating a second job.",
          });
      }
    },
    async insert(expectedRevision: number, afterBlockId: string | null) {
      if (
        cancelled ||
        !canEdit() ||
        state.busy ||
        !recovery ||
        (!state.job?.proposal && !state.pendingInsert) ||
        (!state.pendingInsert && (!state.reviewed || !state.selectedSlideIds.length))
      )
        return;
      const job = state.job;
      const input = recovery.insertBody
        ? InsertPresentationAssistanceProposalsSchema.parse(JSON.parse(recovery.insertBody))
        : InsertPresentationAssistanceProposalsSchema.parse({
            schemaVersion: 1,
            jobId: job!.id,
            proposalHash: job!.proposalHash,
            selectedSlideIds: state.selectedSlideIds,
            reviewed: true,
            expectedRevision,
            mutationId: clientUuid(),
            afterBlockId,
          });
      if (job?.proposal && input.proposalHash !== job.proposalHash)
        throw new Error("The retained insertion does not match this proposal.");
      const insertProjectionHash =
        recovery.insertProjectionHash ??
        presentationAssistanceSlideProjectionHash(
          job!.proposal!.slides.filter((slide) => input.selectedSlideIds.includes(slide.id)),
        );
      write({
        ...recovery,
        insertBody: recovery.insertBody ?? JSON.stringify(input),
        insertProjectionHash,
      });
      const { captured, signal } = begin();
      publish({
        ...state,
        busy: "insert",
        pendingInsert: true,
        error: "",
        message: "Inserting only the reviewed slides…",
      });
      try {
        const result = await request<{
          presentation: { id: string; draft: unknown; draftRevision: number };
          insertedBlockIds: string[];
        }>(`/v1/presentations/${presentationId}/blocks/assistance-proposals`, {
          method: "POST",
          body: recovery!.insertBody!,
          signal,
        });
        if (!current(captured)) return;
        const draft = PresentationDraftSchema.parse(result.presentation?.draft);
        const ids = result.insertedBlockIds;
        if (
          result.presentation.id !== presentationId ||
          !Number.isInteger(result.presentation.draftRevision) ||
          result.presentation.draftRevision < input.expectedRevision + 1 ||
          !Array.isArray(ids) ||
          ids.length !== input.selectedSlideIds.length ||
          new Set(ids).size !== ids.length ||
          ids.some(
            (id) =>
              !draft.blocks.some(
                (block) => block.id === id && block.kind === "content" && block.scene,
              ),
          )
        )
          throw new Error(
            "The insertion receipt could not be verified. Retry the exact insertion to recover its acknowledgement.",
          );
        const insertedSlides = [];
        for (const [index, id] of ids.entries()) {
          const block = draft.blocks.find((candidate) => candidate.id === id);
          if (!block || block.kind !== "content" || !block.scene || block.scene.nodes.length !== 2)
            throw new Error("The inserted slides do not match the reviewed proposal.");
          const title = block.scene.nodes.find(
            (node) => node.type === "text" && node.role === "title",
          );
          const body = block.scene.nodes.find(
            (node) => node.type === "text" && node.role === "body",
          );
          if (title?.type !== "text" || body?.type !== "text")
            throw new Error("The inserted text could not be verified.");
          insertedSlides.push({
            id: input.selectedSlideIds[index],
            title: title.text,
            body: body.text,
            citations: block.citations,
          });
        }
        if (presentationAssistanceSlideProjectionHash(insertedSlides) !== insertProjectionHash)
          throw new Error(
            "The inserted text or citations do not match the reviewed slides. Retry the exact insertion acknowledgement.",
          );
        await onInserted(ids);
        if (!current(captured)) return;
        write(null);
        createBody = null;
        publish({
          ...initialState(),
          message: "Reviewed slides inserted. You can edit their text and layout on the canvas.",
        });
      } catch (error) {
        if (!current(captured)) return;
        const definitive =
          error instanceof ApiClientError && [400, 409, 422].includes(error.status);
        if (definitive) write({ ...recovery!, insertBody: null, insertProjectionHash: null });
        publish({
          ...state,
          busy: null,
          reviewed: definitive ? false : state.reviewed,
          pendingInsert: !definitive,
          error: humanError(error),
          message: definitive
            ? "Your proposal and selection are retained. Reload the saved deck explicitly to resolve a changed revision, then review before inserting again."
            : "Insertion was not confirmed. Retry the exact insertion before editing the deck or changing the selection.",
        });
      }
    },
  };
}
