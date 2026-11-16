import { describe, expect, it, vi } from "vitest";
import {
  PRESENTATION_TEXT_ASSISTANCE_REVIEW_WARNING,
  presentationTextAssistanceSourceDigest,
  presentationTextAssistanceProposalHash,
  type PresentationTextAssistanceJob,
  type PresentationTextAssistanceProposal,
  type PresentationTextLanguage,
} from "@openround/contracts";
import { ApiClientError } from "./api";
import { createNativeContentBlock } from "./presentation-native-scene";
import {
  createPresentationTextAssistance,
  parseTextAssistanceRecovery,
  type TextAssistanceRecovery,
  type TextAssistanceTarget,
  type TextAssistanceStatus,
} from "./presentation-text-assistance-client";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const presentationId = id(1);
const target: TextAssistanceTarget = {
  blockId: "aabbccdd-0000-4000-8000-000000000002",
  nodeId: "Imported Title / CASE-sensitive",
  role: "title",
  operation: "shorten",
  text: "  A longer original title  ",
  expectedRevision: 4,
};
const time = "2026-11-06T12:00:00.000Z";
function ready(
  jobId: string,
  input: TextAssistanceTarget = target,
  output = "Short title",
): PresentationTextAssistanceJob {
  const proposal: PresentationTextAssistanceProposal = {
    schemaVersion: 1,
    blockId: input.blockId,
    nodeId: input.nodeId,
    role: input.role,
    operation: input.operation,
    originalText: input.text,
    text: output,
    sourceDigest: presentationTextAssistanceSourceDigest(input.text),
    outputDigest: presentationTextAssistanceSourceDigest(output),
    provider: "fixture",
    model: "fixture-model",
    generatedAt: time,
    reviewWarning: PRESENTATION_TEXT_ASSISTANCE_REVIEW_WARNING,
    ...(input.operation === "translate"
      ? { targetLanguage: input.targetLanguage, sourceLanguage: input.sourceLanguage }
      : {}),
  };
  return {
    schemaVersion: 1,
    id: jobId,
    requestId: jobId,
    presentationId,
    blockId: input.blockId,
    nodeId: input.nodeId,
    role: input.role,
    operation: input.operation,
    sourceDigest: proposal.sourceDigest,
    sourceRevision: 4,
    status: "ready",
    attempts: 1,
    proposal,
    proposalHash: presentationTextAssistanceProposalHash(proposal),
    error: null,
    createdAt: time,
    updatedAt: time,
    expiresAt: "2026-11-07T12:00:00.000Z",
    ...(input.operation === "translate"
      ? { targetLanguage: input.targetLanguage, sourceLanguage: input.sourceLanguage }
      : {}),
  };
}
function fixture(input: TextAssistanceTarget = target, output = "Short title") {
  let saved: TextAssistanceRecovery | null = null;
  let created = false;
  let lostCreate = false;
  let lostApply = false;
  let badReceipt = false;
  let badNodeLanguage = false;
  let wrongJobLanguage: PresentationTextLanguage | null = null;
  let edited = true;
  let persistError = false;
  let jobVisible = true;
  let statusError: Error | null = null;
  let admissionError: Error | null = null;
  let status: TextAssistanceStatus = {
    enabled: true,
    monthlyLimit: 10,
    used: 0,
    remaining: 10,
    active: 0,
    maxActiveJobs: 2,
  };
  function readyJob() {
    const targetLanguage = wrongJobLanguage ?? saved?.targetLanguage ?? input.targetLanguage;
    const source = {
      ...input,
      ...(input.operation === "translate"
        ? { targetLanguage, sourceLanguage: saved?.sourceLanguage ?? input.sourceLanguage }
        : {}),
    };
    return ready(saved!.jobId, source, output);
  }
  const stateChanged = vi.fn();
  const applied = vi.fn();
  const calls: Array<{ path: string; init: RequestInit }> = [];
  const request = vi.fn(async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    calls.push({ path, init });
    if (path.includes("/status?")) {
      if (statusError) throw statusError;
      return { status } as T;
    }
    if (path.includes("/jobs/") && !init.method) {
      if (!created || !jobVisible) throw new ApiClientError("Not found", "NOT_FOUND", 404);
      return { job: readyJob() } as T;
    }
    if (path.endsWith("/jobs") && init.method === "POST") {
      expect(saved?.createBody).toBe(init.body);
      expect(saved?.createUncertain).toBe(true);
      expect(JSON.parse(String(init.body))).not.toHaveProperty("text");
      if (admissionError) throw admissionError;
      created = true;
      if (lostCreate) throw new Error("Connection lost");
      return { job: readyJob() } as T;
    }
    if (path.endsWith("/text-assistance/apply")) {
      expect(saved?.applyBody).toBe(init.body);
      if (lostApply) throw new Error("Connection lost");
      const job = readyJob();
      const {
        blockId: omittedBlock,
        originalText: omittedOriginal,
        text,
        ...metadata
      } = job.proposal!;
      void omittedBlock;
      void omittedOriginal;
      const block = createNativeContentBlock();
      block.id = input.blockId.toUpperCase();
      if (input.operation === "translate") block.scene!.schemaVersion = 7;
      block.scene!.nodes = [
        {
          id: input.nodeId,
          type: "text",
          role: input.role,
          text,
          frame: { x: 5, y: 5, width: 80, height: 20 },
          ...(input.operation === "translate"
            ? { lang: badNodeLanguage ? ("en" as const) : saved!.targetLanguage }
            : {}),
        },
      ];
      block.scene!.readingOrder = [input.nodeId];
      const draft = {
        schemaVersion: input.operation === "translate" ? 16 : 15,
        title: "Deck",
        description: "",
        experiencePreset: { id: "focus", version: 1 },
        sections: [],
        blocks: [
          {
            ...block,
            textAssistance: { ...metadata, model: badReceipt ? "wrong-model" : metadata.model },
          },
        ],
      };
      return {
        presentation: { id: presentationId, draftRevision: input.expectedRevision + 1, draft },
        jobId: job.id,
        blockId: input.blockId,
        nodeId: input.nodeId,
        sourceDigest: job.sourceDigest,
        outputDigest: job.proposal!.outputDigest,
        proposalHash: job.proposalHash,
      } as T;
    }
    throw new Error(`Unexpected ${path}`);
  });
  const make = () =>
    createPresentationTextAssistance({
      actorKey: "actor:workspace",
      presentationId,
      canEdit: () => edited,
      persist: (value) => {
        if (persistError) throw new Error("Storage unavailable");
        saved = structuredClone(value);
      },
      onState: stateChanged,
      onApplied: applied,
      request: request as NonNullable<
        Parameters<typeof createPresentationTextAssistance>[0]["request"]
      >,
    });
  return {
    controller: make(),
    make,
    request,
    calls,
    applied,
    stateChanged,
    setStatus(value: Partial<TextAssistanceStatus>) {
      status = { ...status, ...value };
    },
    failStatus(error: Error) {
      statusError = error;
    },
    rejectAdmission(error: Error | null) {
      admissionError = error;
    },
    setJobVisible(value: boolean) {
      jobVisible = value;
    },
    get saved() {
      return saved;
    },
    loseCreate(value = true) {
      lostCreate = value;
    },
    loseApply(value = true) {
      lostApply = value;
    },
    wrongJobLanguage(value: PresentationTextLanguage | null) {
      wrongJobLanguage = value;
    },
    wrongNodeLanguage(value = true) {
      badNodeLanguage = value;
    },
    badReceipt(value = true) {
      badReceipt = value;
    },
    revoke() {
      edited = false;
    },
    storageFailure() {
      persistError = true;
    },
  };
}
describe("selected text assistance controller", () => {
  it("saves an identity-only stable request before POST and preserves exact whitespace and case", async () => {
    const f = fixture();
    await f.controller.generate({ ...target, blockId: target.blockId.toUpperCase() });
    expect(f.controller.state().job?.nodeId).toBe(target.nodeId);
    expect(f.saved?.sourceDigest).toBe(presentationTextAssistanceSourceDigest(target.text));
    expect(f.saved?.sourceDigest).not.toBe(
      presentationTextAssistanceSourceDigest(target.text.trim()),
    );
    expect(JSON.stringify(f.saved)).not.toContain(target.text);
    expect(JSON.stringify(f.saved)).not.toContain("Short title");
    expect(
      f.calls.map((call) =>
        call.path.includes("/status?") ? "status" : (call.init.method ?? "GET"),
      ),
    ).toEqual(["GET", "status", "POST"]);
    expect(f.applied).not.toHaveBeenCalled();
  });
  it("recovers an accepted lost create response with a stable read and prevents reset while uncertain", async () => {
    const f = fixture();
    f.loseCreate();
    await f.controller.generate(target);
    expect(f.controller.state().pending).toBe(true);
    expect(f.controller.reset()).toBe(false);
    const recovered = f.make();
    recovered.restore(f.saved);
    await recovered.retry();
    expect(recovered.state().job?.status).toBe("ready");
    expect(f.calls.filter((call) => call.init.method === "POST")).toHaveLength(1);
  });
  it.each([
    ["provider disabled", { enabled: false }],
    ["monthly allowance exhausted", { remaining: 0 }],
    ["active job cap reached", { active: 2 }],
  ] as const)(
    "leaves a fresh %s request discardable when preflight prevents any POST",
    async (_reason, denial) => {
      const f = fixture();
      f.setStatus(denial);
      await f.controller.generate(target);
      expect(f.calls.some((call) => call.path.includes("/jobs/") && !call.init.method)).toBe(true);
      expect(f.calls.filter((call) => call.init.method === "POST")).toHaveLength(0);
      expect(f.controller.state()).toMatchObject({
        busy: null,
        pending: false,
        recovery: { createUncertain: false },
      });
      expect(f.controller.state().error).toContain("unavailable");
      expect(f.stateChanged).toHaveBeenLastCalledWith(expect.objectContaining({ pending: false }));
      expect(f.saved?.createUncertain).toBe(false);
      const remounted = f.make();
      remounted.restore(f.saved);
      expect(remounted.state().pending).toBe(false);
      expect(remounted.reset()).toBe(true);
      expect(f.saved).toBeNull();
      expect(f.controller.reset()).toBe(true);
    },
  );
  it.each([
    new ApiClientError("Availability could not be read", "UNAVAILABLE", 503),
    new TypeError("Availability connection failed"),
  ])(
    "leaves a fresh request discardable when status reading fails before POST: %s",
    async (error) => {
      const f = fixture();
      f.failStatus(error);
      await f.controller.generate(target);
      expect(f.calls.filter((call) => call.init.method === "POST")).toHaveLength(0);
      expect(f.controller.state()).toMatchObject({
        busy: null,
        pending: false,
        recovery: { createUncertain: false },
        error: error.message,
      });
      expect(f.saved?.createUncertain).toBe(false);
      const remounted = f.make();
      remounted.restore(f.saved);
      expect(remounted.state().pending).toBe(false);
      expect(remounted.reset()).toBe(true);
      expect(f.saved).toBeNull();
    },
  );
  it("unlocks discard after a fresh POST receives an explicit admission 429", async () => {
    const f = fixture();
    f.rejectAdmission(new ApiClientError("AI allowance reached", "RATE_LIMITED", 429));
    await f.controller.generate(target);
    expect(f.calls.filter((call) => call.init.method === "POST")).toHaveLength(1);
    expect(f.controller.state()).toMatchObject({
      busy: null,
      pending: false,
      recovery: { createUncertain: false },
      error: "AI allowance reached",
    });
    expect(f.stateChanged).toHaveBeenLastCalledWith(expect.objectContaining({ pending: false }));
    expect(f.saved?.createUncertain).toBe(false);
    const remounted = f.make();
    remounted.restore(f.saved);
    expect(remounted.state().pending).toBe(false);
    expect(remounted.reset()).toBe(true);
    expect(f.saved).toBeNull();
  });
  it("allows discarding a fresh AUTHORING_DISABLED 503 admission rejection", async () => {
    const f = fixture();
    f.rejectAdmission(new ApiClientError("AI assistance is disabled", "AUTHORING_DISABLED", 503));
    await f.controller.generate(target);
    expect(f.calls.filter((call) => call.init.method === "POST")).toHaveLength(1);
    expect(f.controller.state()).toMatchObject({
      busy: null,
      pending: false,
      recovery: { createUncertain: false },
    });
    expect(f.saved?.createUncertain).toBe(false);
    const remounted = f.make();
    remounted.restore(f.saved);
    expect(remounted.state().pending).toBe(false);
    expect(remounted.reset()).toBe(true);
    expect(f.saved).toBeNull();
  });
  it("keeps a fresh dependency 503 POST failure uncertain because admission could have committed", async () => {
    const f = fixture();
    f.rejectAdmission(new ApiClientError("Dependency unavailable", "DEPENDENCY_UNAVAILABLE", 503));
    await f.controller.generate(target);
    expect(f.calls.filter((call) => call.init.method === "POST")).toHaveLength(1);
    expect(f.controller.state()).toMatchObject({
      busy: null,
      pending: true,
      recovery: { createUncertain: true },
    });
    expect(f.saved?.createUncertain).toBe(true);
    expect(f.controller.reset()).toBe(false);
    const remounted = f.make();
    remounted.restore(f.saved);
    expect(remounted.state().pending).toBe(true);
    expect(remounted.reset()).toBe(false);
  });
  it.each([
    ["provider disabled", { enabled: false }],
    ["monthly allowance exhausted", { remaining: 0 }],
    ["active job cap reached", { active: 2 }],
  ] as const)(
    "retains an earlier uncertain POST despite GET404 and a later %s preflight",
    async (_reason, denial) => {
      const f = fixture();
      f.loseCreate();
      await f.controller.generate(target);
      const originalBody = f.saved!.createBody;
      expect(f.saved?.createUncertain).toBe(true);
      const remounted = f.make();
      remounted.restore(f.saved);
      expect(remounted.state().pending).toBe(true);
      f.setJobVisible(false);
      f.setStatus(denial);
      await remounted.retry();
      expect(f.calls.filter((call) => call.init.method === "POST")).toHaveLength(1);
      expect(f.saved).toMatchObject({ createBody: originalBody, createUncertain: true });
      expect(remounted.state()).toMatchObject({ busy: null, pending: true });
      expect(remounted.reset()).toBe(false);
      const reopened = f.make();
      reopened.restore(f.saved);
      expect(reopened.state().pending).toBe(true);
      expect(reopened.reset()).toBe(false);
      f.setJobVisible(true);
      await reopened.retry();
      expect(reopened.state()).toMatchObject({ job: { status: "ready" }, pending: false });
      expect(f.calls.filter((call) => call.init.method === "POST")).toHaveLength(1);
    },
  );
  it("keeps repeated lost POST acknowledgements locked across reload with the same exact intent", async () => {
    const f = fixture();
    f.loseCreate();
    await f.controller.generate(target);
    const originalBody = f.saved!.createBody;
    const remounted = f.make();
    remounted.restore(f.saved);
    f.setJobVisible(false);
    await remounted.retry();
    expect(
      f.calls.filter((call) => call.init.method === "POST").map((call) => call.init.body),
    ).toEqual([originalBody, originalBody]);
    expect(f.saved?.createUncertain).toBe(true);
    expect(remounted.state().pending).toBe(true);
    expect(remounted.reset()).toBe(false);
    const reopened = f.make();
    reopened.restore(f.saved);
    expect(reopened.state().pending).toBe(true);
    expect(reopened.reset()).toBe(false);
    f.setJobVisible(true);
    await reopened.retry();
    expect(reopened.state()).toMatchObject({ job: { status: "ready" }, pending: false });
    expect(f.calls.filter((call) => call.init.method === "POST")).toHaveLength(2);
  });
  it("retains the old uncertain POST when a later exact retry receives admission 429", async () => {
    const f = fixture();
    f.loseCreate();
    await f.controller.generate(target);
    const originalBody = f.saved!.createBody;
    const remounted = f.make();
    remounted.restore(f.saved);
    f.setJobVisible(false);
    f.rejectAdmission(new ApiClientError("AI allowance reached", "RATE_LIMITED", 429));
    await remounted.retry();
    const bodies = f.calls
      .filter((call) => call.init.method === "POST")
      .map((call) => call.init.body);
    expect(bodies).toEqual([originalBody, originalBody]);
    expect(f.saved?.createUncertain).toBe(true);
    expect(remounted.state().pending).toBe(true);
    expect(remounted.reset()).toBe(false);
    const reopened = f.make();
    reopened.restore(f.saved);
    expect(reopened.state().pending).toBe(true);
    expect(reopened.reset()).toBe(false);
    f.setJobVisible(true);
    f.rejectAdmission(null);
    await reopened.retry();
    expect(reopened.state()).toMatchObject({ job: { status: "ready" }, pending: false });
    expect(f.calls.filter((call) => call.init.method === "POST")).toHaveLength(2);
  });
  it("requires explicit review and retries the byte-identical apply after remount", async () => {
    const f = fixture();
    await f.controller.generate(target);
    await f.controller.apply(target);
    expect(f.applied).not.toHaveBeenCalled();
    f.controller.review(true);
    f.loseApply();
    await f.controller.apply(target);
    const body = f.saved!.applyBody;
    expect(body).toBeTruthy();
    expect(f.controller.reset()).toBe(false);
    expect(JSON.stringify(f.saved)).not.toContain("Short title");
    const recovered = f.make();
    recovered.restore(f.saved);
    f.loseApply(false);
    await recovered.apply(null);
    const bodies = f.calls
      .filter((call) => call.path.endsWith("/text-assistance/apply"))
      .map((call) => call.init.body);
    expect(bodies).toEqual([body, body]);
    expect(f.applied).toHaveBeenCalledWith(
      expect.objectContaining({
        blockId: target.blockId,
        nodeId: target.nodeId,
        role: target.role,
        sourceDigest: presentationTextAssistanceSourceDigest(target.text),
        acceptedRevision: 5,
      }),
    );
    expect(f.saved).toBeNull();
  });
  it("keeps a known uncertain application locked when recovering its job read fails", async () => {
    const f = fixture();
    await f.controller.generate(target);
    f.controller.review(true);
    f.loseApply();
    await f.controller.apply(target);
    const originalBody = f.saved!.applyBody;
    const remounted = f.make();
    remounted.restore(f.saved);
    f.setJobVisible(false);
    await remounted.refresh();
    expect(remounted.state()).toMatchObject({
      busy: null,
      pending: true,
      recovery: { createUncertain: false, applyBody: originalBody },
    });
    expect(remounted.reset()).toBe(false);
    expect(f.saved?.applyBody).toBe(originalBody);
    f.loseApply(false);
    await remounted.apply(null);
    expect(
      f.calls
        .filter((call) => call.path.endsWith("/text-assistance/apply"))
        .map((call) => call.init.body),
    ).toEqual([originalBody, originalBody]);
    expect(f.applied).toHaveBeenCalledOnce();
    expect(f.saved).toBeNull();
  });
  it("keeps an uncertain application when provenance or output receipts differ", async () => {
    const f = fixture();
    await f.controller.generate(target);
    f.controller.review(true);
    f.badReceipt();
    await f.controller.apply(target);
    expect(f.controller.state().pending).toBe(true);
    expect(f.controller.state().error).toContain("receipt");
    expect(f.applied).not.toHaveBeenCalled();
    f.badReceipt(false);
    await f.controller.apply(null);
    expect(f.applied).toHaveBeenCalledOnce();
  });
  it("advances revision only for the exact same case-sensitive target and role", async () => {
    const f = fixture();
    await f.controller.generate(target);
    f.controller.review(true);
    expect(() =>
      f.controller.rebase({ ...target, nodeId: target.nodeId.toLowerCase(), expectedRevision: 9 }),
    ).toThrow("changed or deleted");
    expect(() => f.controller.rebase({ ...target, role: "body", expectedRevision: 9 })).toThrow();
    expect(() =>
      f.controller.rebase({ ...target, text: "Changed", expectedRevision: 9 }),
    ).toThrow();
    expect(
      f.controller.rebase({
        ...target,
        blockId: target.blockId.toUpperCase(),
        expectedRevision: 9,
      }),
    ).toBe(true);
    expect(f.controller.state().reviewed).toBe(false);
    expect(f.saved?.expectedRevision).toBe(9);
  });
  it("fences responses and mutations after creator permission is lost", async () => {
    const f = fixture();
    await f.controller.generate(target);
    f.controller.review(true);
    f.revoke();
    await f.controller.apply(target);
    expect(f.calls.some((call) => call.path.endsWith("/text-assistance/apply"))).toBe(false);
    expect(f.controller.reset()).toBe(false);
  });
  it("keeps ready proposal recovery and application available without another allowance check", async () => {
    const f = fixture();
    await f.controller.generate(target);
    const recovered = f.make();
    recovered.restore(f.saved);
    const statusReads = f.calls.filter((call) => call.path.includes("/status?")).length;
    await recovered.retry();
    recovered.review(true);
    await recovered.apply(target);
    expect(f.calls.filter((call) => call.path.includes("/status?"))).toHaveLength(statusReads);
    expect(f.applied).toHaveBeenCalledOnce();
  });
  it("ignores a proposal response arriving after editor permission is revoked", async () => {
    const f = fixture();
    await f.controller.generate(target);
    let allowed = true;
    let release!: (value: unknown) => void;
    const reply = new Promise<unknown>((resolve) => {
      release = resolve;
    });
    const session = createPresentationTextAssistance({
      actorKey: "actor:workspace",
      presentationId,
      canEdit: () => allowed,
      persist: () => undefined,
      onState: () => undefined,
      onApplied: vi.fn(),
      request: async <T>() => (await reply) as T,
    });
    session.restore(f.saved);
    const pending = session.refresh();
    allowed = false;
    release({ job: ready(f.saved!.jobId) });
    await pending;
    expect(session.state().job).toBeNull();
  });
  it("does not send a mutation when complete recovery cannot be saved", async () => {
    const f = fixture();
    f.storageFailure();
    await expect(f.controller.generate(target)).rejects.toThrow("Storage unavailable");
    expect(f.request).not.toHaveBeenCalled();
  });
  it("rejects cross-actor, cross-deck, text-bearing and mismatched application recovery", async () => {
    const f = fixture();
    await f.controller.generate(target);
    expect(() => parseTextAssistanceRecovery(f.saved, "other:workspace", presentationId)).toThrow();
    expect(() => parseTextAssistanceRecovery(f.saved, "actor:workspace", id(99))).toThrow();
    expect(() =>
      parseTextAssistanceRecovery(
        { ...f.saved, originalText: target.text },
        "actor:workspace",
        presentationId,
      ),
    ).toThrow();
    f.controller.review(true);
    f.loseApply();
    await f.controller.apply(target);
    const body = JSON.parse(f.saved!.applyBody!);
    body.nodeId = "other-node";
    expect(() =>
      parseTextAssistanceRecovery(
        { ...f.saved, applyBody: JSON.stringify(body) },
        "actor:workspace",
        presentationId,
      ),
    ).toThrow();
  });
  const translationTarget: TextAssistanceTarget = {
    ...target,
    operation: "translate",
    sourceLanguage: "en",
    targetLanguage: "fr",
  };
  it("binds both canonical languages without persisting either text in translation recovery", async () => {
    const f = fixture(translationTarget, "Titre traduit");
    await f.controller.generate(
      { ...translationTarget, targetLanguage: undefined },
      { targetLanguage: "fr" },
    );
    const body = JSON.parse(f.saved!.createBody);
    expect(body).toMatchObject({
      schemaVersion: 1,
      operation: "translate",
      targetLanguage: "fr",
      sourceLanguage: "en",
    });
    expect(Object.keys(body).slice(-2)).toEqual(["targetLanguage", "sourceLanguage"]);
    expect(f.saved).toMatchObject({ targetLanguage: "fr", sourceLanguage: "en" });
    expect(JSON.stringify(f.saved)).not.toContain(target.text);
    expect(JSON.stringify(f.saved)).not.toContain("Titre traduit");
    expect(f.controller.state().job?.proposal).toMatchObject({
      targetLanguage: "fr",
      sourceLanguage: "en",
    });
    expect(f.applied).not.toHaveBeenCalled();
  });
  it("retains the exact target language across lost translation creation and application receipts", async () => {
    const f = fixture(translationTarget, "Titre traduit");
    f.loseCreate();
    await f.controller.generate(translationTarget);
    expect(f.controller.reset()).toBe(false);
    const recovered = f.make();
    recovered.restore(f.saved);
    await recovered.retry();
    expect(recovered.state().job?.targetLanguage).toBe("fr");
    expect(f.calls.filter((call) => call.init.method === "POST")).toHaveLength(1);
    recovered.review(true);
    f.loseApply();
    await recovered.apply(translationTarget);
    const applyBody = f.saved!.applyBody;
    expect(JSON.parse(applyBody!)).toMatchObject({ targetLanguage: "fr", sourceLanguage: "en" });
    expect(JSON.stringify(f.saved)).not.toContain("Titre traduit");
    const remounted = f.make();
    remounted.restore(f.saved);
    f.loseApply(false);
    await remounted.apply(null);
    expect(
      f.calls
        .filter((call) => call.path.endsWith("/text-assistance/apply"))
        .map((call) => call.init.body),
    ).toEqual([applyBody, applyBody]);
    expect(f.applied).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "translate",
        targetLanguage: "fr",
        sourceLanguage: "en",
        acceptedDraft: expect.objectContaining({ schemaVersion: 16 }),
      }),
    );
    expect(f.saved).toBeNull();
  });
  it("allows unchanged proper-noun wording when the reviewed object language changes", async () => {
    const source: TextAssistanceTarget = {
      ...translationTarget,
      text: "OpenAI",
      sourceLanguage: null,
      targetLanguage: "ja",
    };
    const f = fixture(source, "OpenAI");
    await f.controller.generate(source);
    f.controller.review(true);
    await f.controller.apply(source);
    expect(f.applied).toHaveBeenCalledOnce();
    expect(f.applied.mock.calls[0]![0].acceptedDraft.blocks[0].scene.nodes[0]).toMatchObject({
      text: "OpenAI",
      lang: "ja",
    });
  });
  it("rejects a proposal for a different target language even when its hash is otherwise valid", async () => {
    const f = fixture(translationTarget, "Titre traduit");
    f.wrongJobLanguage("de");
    await f.controller.generate(translationTarget);
    expect(f.controller.state().job).toBeNull();
    expect(f.controller.state().pending).toBe(true);
    expect(f.controller.state().error).toContain("saved target");
    expect(f.controller.reset()).toBe(false);
  });
  it("refuses same-text source-language corrections and destination changes during reload review", async () => {
    const f = fixture(translationTarget, "Titre traduit");
    await f.controller.generate(translationTarget);
    expect(() =>
      f.controller.rebase({ ...translationTarget, sourceLanguage: null, expectedRevision: 6 }),
    ).toThrow("changed or deleted");
    expect(() =>
      f.controller.rebase({ ...translationTarget, sourceLanguage: "de", expectedRevision: 6 }),
    ).toThrow();
    expect(() =>
      f.controller.rebase({ ...translationTarget, targetLanguage: "es", expectedRevision: 6 }),
    ).toThrow();
    expect(f.controller.rebase({ ...translationTarget, expectedRevision: 6 })).toBe(true);
    expect(f.saved?.expectedRevision).toBe(6);
  });
  it("keeps an Apply uncertain if its returned node is missing the reviewed language annotation", async () => {
    const f = fixture(translationTarget, "Titre traduit");
    await f.controller.generate(translationTarget);
    f.controller.review(true);
    f.wrongNodeLanguage();
    await f.controller.apply(translationTarget);
    expect(f.applied).not.toHaveBeenCalled();
    expect(f.controller.state().pending).toBe(true);
    expect(f.controller.reset()).toBe(false);
    f.wrongNodeLanguage(false);
    await f.controller.apply(null);
    expect(f.applied).toHaveBeenCalledOnce();
  });
  it("rejects malformed, alias, missing and same-source translation languages before any request", async () => {
    for (const fields of [
      { targetLanguage: undefined },
      { targetLanguage: "FR" },
      { targetLanguage: "zh-CN" },
      { sourceLanguage: undefined },
      { sourceLanguage: "EN" },
      { targetLanguage: "en" },
    ]) {
      const f = fixture(translationTarget, "Titre traduit");
      await expect(
        f.controller.generate({ ...translationTarget, ...fields } as TextAssistanceTarget),
      ).rejects.toThrow();
      expect(f.calls).toHaveLength(0);
      expect(f.saved).toBeNull();
    }
  });
  it("rejects translation recovery when either bound language or exact Apply language is changed", async () => {
    const f = fixture(translationTarget, "Titre traduit");
    await f.controller.generate(translationTarget);
    for (const update of [
      { targetLanguage: "de" },
      { sourceLanguage: null },
      { sourceLanguage: undefined },
    ])
      expect(() =>
        parseTextAssistanceRecovery({ ...f.saved, ...update }, "actor:workspace", presentationId),
      ).toThrow();
    f.controller.review(true);
    f.loseApply();
    await f.controller.apply(translationTarget);
    const apply = JSON.parse(f.saved!.applyBody!);
    apply.targetLanguage = "es";
    expect(() =>
      parseTextAssistanceRecovery(
        { ...f.saved, applyBody: JSON.stringify(apply) },
        "actor:workspace",
        presentationId,
      ),
    ).toThrow();
  });
  it("preserves the exact legacy rewrite/shorten request, Apply and recovery shape", async () => {
    const f = fixture();
    await f.controller.generate(target);
    expect(f.saved!.createBody).toBe(
      JSON.stringify({
        schemaVersion: 1,
        requestId: f.saved!.jobId,
        presentationId,
        blockId: target.blockId,
        nodeId: target.nodeId,
        operation: "shorten",
        expectedRevision: 4,
        sourceDigest: presentationTextAssistanceSourceDigest(target.text),
      }),
    );
    expect(Object.keys(f.saved!)).not.toContain("targetLanguage");
    expect(Object.keys(f.saved!)).not.toContain("sourceLanguage");
    f.controller.review(true);
    f.loseApply();
    await f.controller.apply(target);
    expect(f.saved!.provenanceDigest).toBe(
      "9c26bbcedc7064cb69e89a94e8f527c81342d6671bbdecdeb5437302e8ebfa44",
    );
    const apply = JSON.parse(f.saved!.applyBody!);
    expect(Object.keys(apply)).toEqual([
      "schemaVersion",
      "jobId",
      "proposalHash",
      "blockId",
      "nodeId",
      "sourceDigest",
      "reviewed",
      "expectedRevision",
      "mutationId",
    ]);
    const remounted = f.make();
    remounted.restore(JSON.parse(JSON.stringify(f.saved)));
    expect(remounted.state().pending).toBe(true);
    expect(() =>
      parseTextAssistanceRecovery(
        { ...f.saved, targetLanguage: "fr", sourceLanguage: "en" },
        "actor:workspace",
        presentationId,
      ),
    ).toThrow();
  });
});
