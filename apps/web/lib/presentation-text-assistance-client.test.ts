import { describe, expect, it, vi } from "vitest";
import {
  PRESENTATION_TEXT_ASSISTANCE_REVIEW_WARNING,
  presentationTextAssistanceSourceDigest,
  presentationTextAssistanceProposalHash,
  type PresentationTextAssistanceJob,
  type PresentationTextAssistanceProposal,
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
function ready(jobId: string): PresentationTextAssistanceJob {
  const proposal: PresentationTextAssistanceProposal = {
    schemaVersion: 1,
    blockId: target.blockId,
    nodeId: target.nodeId,
    role: target.role,
    operation: target.operation,
    originalText: target.text,
    text: "Short title",
    sourceDigest: presentationTextAssistanceSourceDigest(target.text),
    outputDigest: presentationTextAssistanceSourceDigest("Short title"),
    provider: "fixture",
    model: "fixture-model",
    generatedAt: time,
    reviewWarning: PRESENTATION_TEXT_ASSISTANCE_REVIEW_WARNING,
  };
  return {
    schemaVersion: 1,
    id: jobId,
    requestId: jobId,
    presentationId,
    blockId: target.blockId,
    nodeId: target.nodeId,
    role: target.role,
    operation: target.operation,
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
  };
}
function fixture() {
  let saved: TextAssistanceRecovery | null = null;
  let created = false;
  let lostCreate = false;
  let lostApply = false;
  let badReceipt = false;
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
      return { job: ready(saved!.jobId) } as T;
    }
    if (path.endsWith("/jobs") && init.method === "POST") {
      expect(saved?.createBody).toBe(init.body);
      expect(saved?.createUncertain).toBe(true);
      expect(JSON.parse(String(init.body))).not.toHaveProperty("text");
      if (admissionError) throw admissionError;
      created = true;
      if (lostCreate) throw new Error("Connection lost");
      return { job: ready(saved!.jobId) } as T;
    }
    if (path.endsWith("/text-assistance/apply")) {
      expect(saved?.applyBody).toBe(init.body);
      if (lostApply) throw new Error("Connection lost");
      const job = ready(saved!.jobId);
      const {
        blockId: omittedBlock,
        originalText: omittedOriginal,
        text,
        ...metadata
      } = job.proposal!;
      void omittedBlock;
      void omittedOriginal;
      const block = createNativeContentBlock();
      block.id = target.blockId.toUpperCase();
      block.scene!.nodes = [
        {
          id: target.nodeId,
          type: "text",
          role: target.role,
          text,
          frame: { x: 5, y: 5, width: 80, height: 20 },
        },
      ];
      block.scene!.readingOrder = [target.nodeId];
      const draft = {
        schemaVersion: 15,
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
        presentation: { id: presentationId, draftRevision: target.expectedRevision + 1, draft },
        jobId: job.id,
        blockId: target.blockId,
        nodeId: target.nodeId,
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
});
