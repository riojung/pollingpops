import { describe, expect, it, vi } from "vitest";
import {
  PRESENTATION_QUESTION_SUGGESTIONS_REVIEW_WARNING,
  buildPresentationQuestionSuggestionBlock,
  presentationQuestionSuggestionSource,
  presentationQuestionSuggestionsProposalHash,
  presentationQuestionSuggestionsSourceDigest,
  type PresentationDraft,
  type PresentationQuestionSuggestionsJob,
  type PresentationQuestionSuggestionsProposal,
} from "@openround/contracts";
import { ApiClientError } from "./api";
import { createNativeContentBlock } from "./presentation-native-scene";
import {
  createPresentationQuestionSuggestions,
  fetchQuestionSuggestionsStatus,
  parseQuestionSuggestionsRecovery,
  type QuestionSuggestionsRecovery,
  type QuestionSuggestionsStatus,
  type QuestionSuggestionsTarget,
} from "./presentation-question-suggestions-client";

const id = (n: number) => `aabbccdd-0000-4000-8000-${String(n).padStart(12, "0")}`;
const presentationId = id(1);
const time = "2026-11-07T12:00:00.000Z";
const sourceBlock = createNativeContentBlock();
sourceBlock.id = id(2).toUpperCase();
sourceBlock.scene!.schemaVersion = 7;
const heading = sourceBlock.scene!.nodes[0]!;
if (heading.type !== "text") throw new Error("Expected title");
heading.text = "Préparer le lancement";
heading.lang = "fr";
sourceBlock.scene!.nodes.push({
  id: "Body:ExactCase",
  type: "text",
  role: "body",
  lang: "fr",
  text: "Clarifier le périmètre\nChoisir une équipe",
  frame: { x: 10, y: 35, width: 80, height: 50 },
});
sourceBlock.scene!.readingOrder.push("Body:ExactCase");
sourceBlock.speakerNotes = "PRIVATE_NOTES_NOT_SENT";
const projection = presentationQuestionSuggestionSource(sourceBlock);
if (!projection.supported) throw new Error("Expected source");
const target: QuestionSuggestionsTarget = {
  blockId: sourceBlock.id,
  expectedRevision: 4,
  source: projection.source,
  sourceDigest: presentationQuestionSuggestionsSourceDigest(projection.source),
};

function proposal(): PresentationQuestionSuggestionsProposal {
  return {
    schemaVersion: 1,
    blockId: target.blockId.toLowerCase(),
    source: structuredClone(target.source),
    sourceDigest: target.sourceDigest,
    outputLanguage: "en",
    provider: "fixture",
    model: "fixture-model",
    generatedAt: time,
    reviewWarning: PRESENTATION_QUESTION_SUGGESTIONS_REVIEW_WARNING,
    suggestions: [
      {
        id: id(31),
        kind: "discussion",
        type: "open_text",
        prompt: "How would clarifying scope help your launch team?",
        citations: [{ locator: "body 1 paragraph 1", excerpt: "Clarifier le périmètre" }],
      },
      {
        id: id(32),
        kind: "reflection",
        type: "open_text",
        prompt: "What would you consider when choosing your launch team?",
        citations: [{ locator: "body 1 paragraph 2", excerpt: "Choisir une équipe" }],
      },
    ],
  };
}
function fixture() {
  let saved: QuestionSuggestionsRecovery | null = null;
  let created = false;
  let hiddenJob = false;
  let lostCreate = false;
  let lostInsert = false;
  let canEdit = true;
  let persistError = false;
  let statusError: Error | null = null;
  let createError: Error | null = null;
  let insertError: Error | null = null;
  let tamperJob: ((job: PresentationQuestionSuggestionsJob) => unknown) | null = null;
  let tamperReceipt: ((receipt: Receipt) => void) | null = null;
  let accepted: Receipt | null = null;
  let status: QuestionSuggestionsStatus = {
    enabled: true,
    monthlyLimit: 10,
    used: 0,
    remaining: 10,
    active: 0,
    maxActiveJobs: 2,
  };
  const inserted = vi.fn();
  const changed = vi.fn();
  type Receipt = {
    presentation: { id: string; draft: PresentationDraft; draftRevision: number };
    insertedBlockId: string;
    insertedQuestionId: string;
    jobId: string;
    proposalHash: string;
    suggestionId: string;
    sourceDigest: string;
    sourceBlockId: string;
  };
  const calls: { path: string; init: RequestInit }[] = [];
  function job(): PresentationQuestionSuggestionsJob {
    const value = proposal();
    return {
      schemaVersion: 1,
      id: saved!.jobId,
      requestId: saved!.jobId,
      presentationId,
      blockId: target.blockId.toLowerCase(),
      sourceRevision: 4,
      sourceDigest: target.sourceDigest,
      outputLanguage: "en",
      status: "ready",
      attempts: 1,
      proposal: value,
      proposalHash: presentationQuestionSuggestionsProposalHash(value),
      error: null,
      createdAt: time,
      updatedAt: time,
      expiresAt: "2026-11-08T12:00:00.000Z",
    };
  }
  const request = vi.fn(async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    calls.push({ path, init });
    if (path.includes("/status?")) {
      if (statusError) throw statusError;
      return { status } as T;
    }
    if (path.includes("/jobs/") && !init.method) {
      if (!created || hiddenJob) throw new ApiClientError("Missing", "NOT_FOUND", 404);
      const value = job();
      return { job: tamperJob ? tamperJob(value) : value } as T;
    }
    if (path.endsWith("/jobs") && init.method === "POST") {
      expect(saved?.createUncertain).toBe(true);
      expect(saved?.createBody).toBe(init.body);
      expect(JSON.parse(String(init.body))).not.toHaveProperty("source");
      if (createError) throw createError;
      created = true;
      if (lostCreate) throw new Error("Lost generation acknowledgement");
      const value = job();
      return { job: tamperJob ? tamperJob(value) : value } as T;
    }
    if (path.endsWith("/question-suggestions/insert")) {
      expect(saved?.insertBody).toBe(init.body);
      expect(saved?.insertProjectionHash).toMatch(/^[a-f0-9]{64}$/);
      if (insertError) throw insertError;
      const input = JSON.parse(String(init.body));
      if (!accepted) {
        const block = buildPresentationQuestionSuggestionBlock({
          proposal: proposal(),
          jobId: input.jobId,
          suggestionId: input.suggestionId,
          mutationId: input.mutationId,
        });
        const draft: PresentationDraft = {
          schemaVersion: 16,
          title: "Deck",
          description: "",
          experiencePreset: { id: "focus", version: 1 },
          sections: [],
          blocks: [structuredClone(sourceBlock), block],
        };
        accepted = {
          presentation: { id: presentationId, draft, draftRevision: input.expectedRevision + 1 },
          insertedBlockId: block.id,
          insertedQuestionId: block.question.id,
          jobId: input.jobId,
          proposalHash: input.proposalHash,
          suggestionId: input.suggestionId,
          sourceDigest: input.sourceDigest,
          sourceBlockId: input.blockId,
        };
      }
      if (lostInsert) throw new Error("Lost insertion acknowledgement");
      const result = structuredClone(accepted);
      tamperReceipt?.(result);
      return result as T;
    }
    throw new Error(`Unexpected path ${path}`);
  });
  const make = () =>
    createPresentationQuestionSuggestions({
      actorKey: "actor:workspace",
      presentationId,
      canEdit: () => canEdit,
      persist: (value) => {
        if (persistError) throw new Error("Storage denied");
        saved = structuredClone(value);
      },
      onState: changed,
      onInserted: inserted,
      request: <T>(path: string, init?: RequestInit) => request(path, init) as Promise<T>,
    });
  return {
    make,
    request,
    inserted,
    changed,
    calls,
    get saved() {
      return saved;
    },
    set lostCreate(value: boolean) {
      lostCreate = value;
    },
    set lostInsert(value: boolean) {
      lostInsert = value;
    },
    set hiddenJob(value: boolean) {
      hiddenJob = value;
    },
    set canEdit(value: boolean) {
      canEdit = value;
    },
    set persistError(value: boolean) {
      persistError = value;
    },
    set statusError(value: Error | null) {
      statusError = value;
    },
    set createError(value: Error | null) {
      createError = value;
    },
    set insertError(value: Error | null) {
      insertError = value;
    },
    set status(value: QuestionSuggestionsStatus) {
      status = value;
    },
    get status() {
      return status;
    },
    set tamperJob(value: typeof tamperJob) {
      tamperJob = value;
    },
    set tamperReceipt(value: typeof tamperReceipt) {
      tamperReceipt = value;
    },
  };
}
const posts = (f: ReturnType<typeof fixture>, suffix: string) =>
  f.calls.filter((call) => call.path.endsWith(suffix) && call.init.method === "POST");

describe("reviewed discussion suggestion controller", () => {
  it("does nothing until explicit generation and persists no source or generated prompt", async () => {
    const f = fixture(),
      c = f.make();
    expect(f.calls).toEqual([]);
    await c.generate(target);
    expect(c.state().job?.proposal?.suggestions).toHaveLength(2);
    expect(c.state().reviewed).toBe(false);
    expect(c.state().pending).toBe(false);
    expect(posts(f, "/jobs")).toHaveLength(1);
    const stored = JSON.stringify(f.saved);
    expect(stored).not.toContain(target.source.title.text);
    expect(stored).not.toContain(target.source.body[0]!.text);
    expect(stored).not.toContain(proposal().suggestions[0]!.prompt);
    expect(stored).not.toContain("PRIVATE_NOTES");
    expect(parseQuestionSuggestionsRecovery(f.saved, "actor:workspace", presentationId)).toEqual(
      f.saved,
    );
  });
  it.each(["disabled", "empty", "active", "status-error"])(
    "unlocks fresh preflight %s failures without posting",
    async (kind) => {
      const f = fixture(),
        c = f.make();
      if (kind === "disabled") f.status = { ...f.status, enabled: false };
      if (kind === "empty") f.status = { ...f.status, remaining: 0 };
      if (kind === "active") f.status = { ...f.status, active: 2 };
      if (kind === "status-error") f.statusError = new Error("Unavailable");
      await c.generate(target);
      expect(posts(f, "/jobs")).toHaveLength(0);
      expect(c.state().pending).toBe(false);
      expect(f.saved?.createUncertain).toBe(false);
      const remounted = f.make();
      remounted.restore(f.saved);
      expect(remounted.state().pending).toBe(false);
      expect(remounted.reset()).toBe(true);
    },
  );
  it.each([429, 503])(
    "allows discard after a fresh conclusive admission rejection %s",
    async (status) => {
      const f = fixture(),
        c = f.make();
      f.createError = new ApiClientError(
        "Rejected",
        status === 503 ? "AUTHORING_DISABLED" : "LIMIT_EXCEEDED",
        status,
      );
      await c.generate(target);
      expect(posts(f, "/jobs")).toHaveLength(1);
      expect(f.saved?.createUncertain).toBe(false);
      expect(c.state().pending).toBe(false);
      expect(c.reset()).toBe(true);
    },
  );
  it("retains ambiguity for dependency failures and lost generation responses", async () => {
    const f = fixture(),
      c = f.make();
    f.createError = new ApiClientError("Dependency", "DEPENDENCY_UNAVAILABLE", 503);
    await c.generate(target);
    expect(c.state().pending).toBe(true);
    expect(c.reset()).toBe(false);
    f.createError = null;
    await c.retry();
    expect(c.state().job?.status).toBe("ready");
    expect(posts(f, "/jobs")[1]!.init.body).toBe(posts(f, "/jobs")[0]!.init.body);
  });
  it("recovers a lost generation response by stable ID after remount even with no allowance", async () => {
    const f = fixture(),
      c = f.make();
    f.lostCreate = true;
    await c.generate(target);
    const body = f.saved?.createBody;
    expect(c.reset()).toBe(false);
    c.cancel();
    f.status = { ...f.status, enabled: false, remaining: 0 };
    const next = f.make();
    next.restore(f.saved);
    await next.retry();
    expect(next.state().job?.status).toBe("ready");
    expect(f.saved?.createBody).toBe(body);
    expect(posts(f, "/jobs")).toHaveLength(1);
  });
  it.each(["preflight", "rejection"])(
    "does not unlock prior lost creation after later %s failure",
    async (kind) => {
      const f = fixture(),
        c = f.make();
      f.lostCreate = true;
      await c.generate(target);
      f.hiddenJob = true;
      if (kind === "preflight") f.status = { ...f.status, remaining: 0 };
      else f.createError = new ApiClientError("Rejected", "LIMIT_EXCEEDED", 429);
      await c.retry();
      expect(c.state().pending).toBe(true);
      expect(f.saved?.createUncertain).toBe(true);
      expect(c.reset()).toBe(false);
    },
  );
  it("requires complete review, clears it on radio selection, and inserts only that one question", async () => {
    const f = fixture(),
      c = f.make();
    await c.generate(target);
    await c.insert(target);
    expect(posts(f, "/question-suggestions/insert")).toHaveLength(0);
    c.review(true);
    c.select(id(32));
    expect(c.state().reviewed).toBe(false);
    c.review(true);
    await c.insert(target);
    expect(f.inserted).toHaveBeenCalledOnce();
    expect(f.inserted.mock.calls[0]![0]).toMatchObject({
      suggestionId: id(32),
      sourceDigest: target.sourceDigest,
      acceptedRevision: 5,
    });
    expect(f.saved).toBeNull();
    expect(posts(f, "/jobs")).toHaveLength(1);
  });
  it("recovers lost insertion byte-for-byte after reload without the proposal or new AI admission", async () => {
    const f = fixture(),
      c = f.make();
    await c.generate(target);
    c.select(id(32));
    c.review(true);
    f.lostInsert = true;
    await c.insert(target);
    const body = f.saved!.insertBody;
    expect(c.reset()).toBe(false);
    expect(JSON.stringify(f.saved)).not.toContain(proposal().suggestions[1]!.prompt);
    c.cancel();
    f.lostInsert = false;
    f.hiddenJob = true;
    f.statusError = new Error("No AI status");
    const next = f.make();
    next.restore(f.saved);
    await next.insert(null);
    expect(posts(f, "/question-suggestions/insert").map((call) => call.init.body)).toEqual([
      body,
      body,
    ]);
    expect(f.inserted).toHaveBeenCalledOnce();
    expect(f.saved).toBeNull();
    expect(posts(f, "/jobs")).toHaveLength(1);
  });
  it.each(["question", "provenance", "binding", "identity", "source", "position"])(
    "retains a receipt with tampered %s instead of adopting it",
    async (kind) => {
      const f = fixture(),
        c = f.make();
      await c.generate(target);
      c.review(true);
      f.tamperReceipt = (receipt) => {
        const block = receipt.presentation.draft.blocks[1]!;
        if (block.kind !== "question") throw new Error();
        if (kind === "question") block.question.prompt += " changed";
        if (kind === "provenance") block.sourceDisclosure!.provider = "other";
        if (kind === "binding") receipt.sourceDigest = "0".repeat(64);
        if (kind === "identity") receipt.insertedQuestionId = id(99);
        if (kind === "source") {
          const source = receipt.presentation.draft.blocks[0]!;
          if (source.kind === "content") {
            const title = source.scene!.nodes[0]!;
            if (title.type === "text") title.text += " changed";
          }
        }
        if (kind === "position") receipt.presentation.draft.blocks.reverse();
      };
      await c.insert(target);
      expect(f.inserted).not.toHaveBeenCalled();
      expect(c.state().pending).toBe(true);
      expect(c.reset()).toBe(false);
    },
  );
  it("keeps a lost receipt locked after a later conclusive rejection", async () => {
    const f = fixture(),
      c = f.make();
    await c.generate(target);
    c.review(true);
    f.lostInsert = true;
    await c.insert(target);
    const body = f.saved!.insertBody;
    f.insertError = new ApiClientError("Conflict", "REVISION_CONFLICT", 409);
    await c.insert(null);
    expect(f.saved?.insertBody).toBe(body);
    expect(c.state().pending).toBe(true);
    expect(c.reset()).toBe(false);
  });
  it("retains accepted insertion until the parent safely adopts its latest draft", async () => {
    const f = fixture(),
      c = f.make();
    await c.generate(target);
    c.review(true);
    f.inserted.mockRejectedValueOnce(new Error("Reload failed"));
    await c.insert(target);
    expect(c.state().pending).toBe(true);
    const body = f.saved!.insertBody;
    await c.insert(null);
    expect(f.inserted).toHaveBeenCalledTimes(2);
    expect(f.saved).toBeNull();
    expect(posts(f, "/question-suggestions/insert")[1]!.init.body).toBe(body);
  });
  it("rebases only the same unchanged source after a definitive revision conflict and requires review again", async () => {
    const f = fixture(),
      c = f.make();
    await c.generate(target);
    c.review(true);
    f.insertError = new ApiClientError("Conflict", "REVISION_CONFLICT", 409);
    await c.insert(target);
    expect(c.state().pending).toBe(false);
    expect(c.state().reviewed).toBe(false);
    expect(c.rebase({ ...target, expectedRevision: 7 })).toBe(true);
    expect(c.state().reviewed).toBe(false);
    f.insertError = null;
    c.review(true);
    await c.insert({ ...target, expectedRevision: 7 });
    expect(f.inserted.mock.calls[0]![0].acceptedRevision).toBe(8);
  });
  it.each(["text", "language", "reading-order", "block"])(
    "refuses changed %s instead of choosing another source",
    async (kind) => {
      const f = fixture(),
        c = f.make();
      await c.generate(target);
      const changed = structuredClone(target);
      changed.expectedRevision++;
      if (kind === "text") changed.source.title.text += " changed";
      if (kind === "language") changed.source.body[0]!.lang = "de";
      if (kind === "reading-order") changed.source.readingOrder.reverse();
      if (kind === "block") changed.blockId = id(9);
      expect(() => c.rebase(changed)).toThrow();
      c.review(true);
      await expect(c.insert(changed)).rejects.toThrow();
      expect(posts(f, "/question-suggestions/insert")).toHaveLength(0);
    },
  );
  it("rejects a malformed or mismatched generation acknowledgement", async () => {
    const f = fixture(),
      c = f.make();
    f.tamperJob = (job) => ({ ...job, blockId: id(9) });
    await c.generate(target);
    expect(c.state().job).toBeNull();
    expect(c.state().pending).toBe(true);
    expect(c.reset()).toBe(false);
  });
  it("sends no request if tab persistence fails", async () => {
    const f = fixture(),
      c = f.make();
    f.persistError = true;
    await expect(c.generate(target)).rejects.toThrow("Storage denied");
    expect(f.calls).toEqual([]);
  });
  it("fences late generated output after permission or actor cancellation", async () => {
    const f = fixture(),
      c = f.make();
    f.request.mockImplementationOnce(async () => {
      throw new ApiClientError("Missing", "NOT_FOUND", 404);
    });
    let resolve: (value: unknown) => void = () => undefined;
    f.request.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = c.generate(target);
    await vi.waitFor(() => expect(f.request).toHaveBeenCalledTimes(2));
    c.cancel();
    f.canEdit = false;
    resolve({ status: f.status });
    await pending;
    expect(posts(f, "/jobs")).toHaveLength(0);
    expect(c.state().job).toBeNull();
    expect(f.inserted).not.toHaveBeenCalled();
  });
  it("strictly rejects unknown recovery fields and another actor/deck", async () => {
    const f = fixture(),
      c = f.make();
    await c.generate(target);
    expect(() =>
      parseQuestionSuggestionsRecovery(
        { ...f.saved, prompt: "private" },
        "actor:workspace",
        presentationId,
      ),
    ).toThrow();
    expect(() =>
      parseQuestionSuggestionsRecovery(f.saved, "another:actor", presentationId),
    ).toThrow();
    expect(() => parseQuestionSuggestionsRecovery(f.saved, "actor:workspace", id(90))).toThrow();
    expect(() =>
      parseQuestionSuggestionsRecovery(
        { ...f.saved, insertBody: "" },
        "actor:workspace",
        presentationId,
      ),
    ).toThrow();
    expect(() =>
      parseQuestionSuggestionsRecovery(
        { ...f.saved, suggestionId: "not-a-uuid" },
        "actor:workspace",
        presentationId,
      ),
    ).toThrow();
  });
  it("never rebases backwards after the source was explicitly advanced", async () => {
    const f = fixture(),
      c = f.make();
    await c.generate(target);
    expect(c.rebase({ ...target, expectedRevision: 9 })).toBe(true);
    expect(() => c.rebase({ ...target, expectedRevision: 8 })).toThrow();
    expect(f.saved?.expectedRevision).toBe(9);
  });
  it("validates the shared allowance response before it can authorize generation", async () => {
    const request = vi.fn(async () => ({
      status: {
        enabled: true,
        used: 0,
        monthlyLimit: 5,
        remaining: 5,
        active: 0,
        maxActiveJobs: 3,
      },
    }));
    await expect(
      fetchQuestionSuggestionsStatus(presentationId, undefined, request as never),
    ).rejects.toThrow("could not be verified");
  });
});
