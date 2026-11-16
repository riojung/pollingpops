import { describe, expect, it, vi } from "vitest";
import {
  PRESENTATION_ASSISTANCE_REVIEW_WARNING,
  presentationAssistanceProposalHash,
  presentationAssistanceSourceDigest,
  type PresentationAssistanceJob,
  type PresentationAssistanceProposal,
} from "@openround/contracts";
import { ApiClientError } from "./api";
import {
  createPresentationAssistance,
  parseAssistanceRecovery,
  type AssistanceRecovery,
} from "./presentation-assistance-client";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const presentationId = id(1);
const outline =
  "The project starts with a customer interview. Review the findings with the team. Select a focused next step.";
const input = { sourceName: "Project outline", outline, slideCount: 3 };
const time = "2026-11-05T12:00:00.000Z";

function ready(jobId: string): PresentationAssistanceJob {
  const proposal: PresentationAssistanceProposal = {
    schemaVersion: 1 as const,
    sourceName: input.sourceName,
    sourceDigest: presentationAssistanceSourceDigest(outline),
    slides: [10, 11, 12].map((n) => ({
      id: id(n),
      title: `Slide ${n}`,
      body: `Reviewed project action ${n}.`,
      citations: [
        { locator: "outline line 1", excerpt: "The project starts with a customer interview." },
      ],
    })),
    generatedAt: time,
    provider: "fixture",
    model: "fixture",
    reviewWarning: PRESENTATION_ASSISTANCE_REVIEW_WARNING,
  };
  return {
    schemaVersion: 1,
    id: jobId,
    requestId: jobId,
    presentationId,
    sourceName: input.sourceName,
    sourceDigest: proposal.sourceDigest,
    slideCount: 3,
    status: "ready",
    attempts: 1,
    proposal,
    proposalHash: presentationAssistanceProposalHash(proposal),
    error: null,
    createdAt: time,
    updatedAt: time,
    expiresAt: "2026-11-06T12:00:00.000Z",
  };
}

function fixture() {
  let recovery: AssistanceRecovery | null = null;
  let created = false;
  let editable = true;
  let createLost = false;
  let insertError: Error | null = null;
  let malformed = false;
  let expired = false;
  const calls: Array<{ path: string; init: RequestInit }> = [];
  const inserted = vi.fn();
  function receipt(body: string) {
    const intent = JSON.parse(body);
    const job = ready(recovery!.jobId);
    const selected = job.proposal!.slides.filter((slide) =>
      intent.selectedSlideIds.includes(slide.id),
    );
    const blocks = selected.map((slide, index) => ({
      id: id(100 + index),
      kind: "content",
      layout: "title_body",
      textElements: [],
      mediaId: null,
      mediaAlt: null,
      speakerNotes: "",
      citations: slide.citations,
      scene: {
        schemaVersion: 1,
        aspectRatio: "16:9",
        nodes: [
          {
            id: id(200 + index),
            type: "text",
            role: "title",
            text: slide.title,
            frame: { x: 8, y: 8, width: 84, height: 20 },
          },
          {
            id: id(300 + index),
            type: "text",
            role: "body",
            text: slide.body,
            frame: { x: 8, y: 35, width: 84, height: 50 },
          },
        ],
        readingOrder: [id(200 + index), id(300 + index)],
      },
    }));
    return {
      presentation: {
        id: presentationId,
        draftRevision: intent.expectedRevision + 1,
        draft: {
          schemaVersion: 5,
          title: "Existing deck",
          description: "",
          experiencePreset: { id: "focus", version: 1 },
          blocks,
        },
      },
      insertedBlockIds: blocks.map((block) => block.id),
    };
  }
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    calls.push({ path, init });
    if (path.endsWith("/blocks/assistance-proposals")) {
      if (insertError) throw insertError;
      return (
        malformed
          ? { ...receipt(init.body as string), insertedBlockIds: [id(999)] }
          : receipt(init.body as string)
      ) as T;
    }
    if (init.method === "POST") {
      created = true;
      if (createLost) throw new TypeError("Connection lost after acceptance");
    } else if (!created) throw new ApiClientError("Not found", "NOT_FOUND", 404);
    return {
      job: expired
        ? {
            ...ready(recovery!.jobId),
            status: "expired",
            proposal: null,
            proposalHash: null,
            error: {
              code: "EXPIRED",
              message: "This draft has expired. Its private source and proposals have been erased.",
            },
          }
        : malformed
          ? { ...ready(recovery!.jobId), unexpected: "unreviewed field" }
          : ready(recovery!.jobId),
    } as T;
  }
  const make = () =>
    createPresentationAssistance({
      presentationId,
      canEdit: () => editable,
      persist: (value) => {
        recovery = value;
      },
      onState: vi.fn(),
      onInserted: inserted,
      request,
    });
  return {
    make,
    calls,
    inserted,
    receipt,
    recovery: () => recovery,
    setCreateLost: () => {
      createLost = true;
    },
    setInsertError: (value: Error | null) => {
      insertError = value;
    },
    setMalformed: (value: boolean) => {
      malformed = value;
    },
    expire: () => {
      expired = true;
    },
    revoke: () => {
      editable = false;
    },
  };
}

describe("Outline assistance retained requests", () => {
  it("recovers an accepted create after a lost acknowledgement without another job or stored outline", async () => {
    const f = fixture();
    const client = f.make();
    f.setCreateLost();
    await client.generate(input);
    expect(client.state().error).toContain("Connection lost");
    expect(JSON.stringify(f.recovery())).not.toContain(outline);
    const retainedId = f.recovery()!.jobId;
    client.cancel();
    const reloaded = f.make();
    reloaded.restore(f.recovery());
    await reloaded.refresh();
    expect(reloaded.state().job?.id).toBe(retainedId);
    expect(f.calls.filter(({ init }) => init.method === "POST")).toHaveLength(1);
    expect(f.inserted).not.toHaveBeenCalled();
  });

  it("requires explicit review and insertion; a changed selection resets review and survives recovery", async () => {
    const f = fixture();
    const client = f.make();
    await client.generate(input);
    await client.insert(7, null);
    expect(f.calls.filter(({ path }) => path.includes("assistance-proposals"))).toHaveLength(0);
    client.review(true);
    client.select(id(10));
    expect(client.state().reviewed).toBe(false);
    for (const slideId of [...client.state().selectedSlideIds]) client.select(slideId);
    await client.refresh();
    expect(client.state().selectedSlideIds).toEqual([]);
    client.select(id(11));
    client.review(true);
    await client.insert(7, id(8));
    expect(f.inserted).toHaveBeenCalledWith([id(100)]);
    expect(f.recovery()).toBeNull();
    const mutation = JSON.parse(
      f.calls.find(({ path }) => path.includes("assistance-proposals"))!.init.body as string,
    );
    expect(mutation).toMatchObject({
      expectedRevision: 7,
      afterBlockId: id(8),
      selectedSlideIds: [id(11)],
      reviewed: true,
    });
  });

  it("retains exact uncertain insertion JSON across reload and ignores new revision/anchor parameters", async () => {
    const f = fixture();
    const client = f.make();
    await client.generate(input);
    client.review(true);
    f.setInsertError(new TypeError("Lost insertion acknowledgement"));
    await client.insert(7, id(8));
    const exactBody = f.recovery()!.insertBody;
    expect(client.state().pendingInsert).toBe(true);
    client.select(id(10));
    expect(client.state().selectedSlideIds).toHaveLength(3);
    client.cancel();
    const reloaded = f.make();
    reloaded.restore(f.recovery());
    await reloaded.refresh();
    f.setInsertError(null);
    await reloaded.insert(99, null);
    const applies = f.calls.filter(({ path }) => path.includes("assistance-proposals"));
    expect(applies).toHaveLength(2);
    expect(applies.map(({ init }) => init.body)).toEqual([exactBody, exactBody]);
    expect(f.inserted).toHaveBeenCalledOnce();
  });

  it("preserves proposal and selection after stale revision without applying or clearing the deck", async () => {
    const f = fixture();
    const client = f.make();
    await client.generate(input);
    client.select(id(10));
    client.review(true);
    f.setInsertError(new ApiClientError("Saved revision changed", "STALE_DRAFT", 409));
    await client.insert(7, null);
    expect(client.state()).toMatchObject({
      pendingInsert: false,
      selectedSlideIds: [id(11), id(12)],
      error: "Saved revision changed",
    });
    expect(client.state().job?.proposal).not.toBeNull();
    expect(f.inserted).not.toHaveBeenCalled();
    expect(f.recovery()!.insertBody).toBeNull();
  });

  it("recovers an exact insertion receipt after the private proposal has expired using only a compact projection hash", async () => {
    const f = fixture();
    const client = f.make();
    await client.generate(input);
    client.review(true);
    f.setInsertError(new TypeError("Lost acknowledgement"));
    await client.insert(7, null);
    const saved = f.recovery()!;
    expect(saved.insertProjectionHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(saved)).not.toContain("Reviewed project action");
    client.cancel();
    f.expire();
    const restored = f.make();
    restored.restore(saved);
    await restored.refresh();
    expect(restored.state().job?.status).toBe("expired");
    f.setInsertError(null);
    await restored.insert(99, null);
    expect(f.inserted).toHaveBeenCalledOnce();
    expect(f.recovery()).toBeNull();
  });

  it("rejects malformed ready and apply receipts and keeps the uncertain insertion identity", async () => {
    const f = fixture();
    const client = f.make();
    f.setMalformed(true);
    await client.generate(input);
    expect(client.state().job).toBeNull();
    expect(client.state().error).toContain("verified");
    f.setMalformed(false);
    await client.refresh();
    client.review(true);
    f.setMalformed(true);
    await client.insert(7, null);
    expect(client.state().pendingInsert).toBe(true);
    expect(f.recovery()!.insertBody).not.toBeNull();
    expect(f.inserted).not.toHaveBeenCalled();
  });

  it("rejects altered source metadata and unknown recovery fields", async () => {
    const f = fixture();
    const client = f.make();
    await client.generate(input);
    expect(() => parseAssistanceRecovery({ ...f.recovery(), outline }, presentationId)).toThrow(
      "verified",
    );
    const changed = { ...f.recovery()!, sourceDigest: "a".repeat(64) };
    const restored = f.make();
    restored.restore(changed);
    await restored.refresh();
    expect(restored.state().job).toBeNull();
    expect(restored.state().error).toContain("match");
  });

  it("fences late create receipts after permission loss or account disposal", async () => {
    let finish!: (value: unknown) => void;
    let recovery: AssistanceRecovery | null = null;
    let editable = true;
    const inserted = vi.fn();
    const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
      if (init?.method !== "POST") throw new ApiClientError("Not found", "NOT_FOUND", 404);
      return new Promise((resolve) => {
        finish = (value) => resolve(value as T);
      });
    };
    const client = createPresentationAssistance({
      presentationId,
      canEdit: () => editable,
      persist: (value) => {
        recovery = value;
      },
      onState: vi.fn(),
      onInserted: inserted,
      request,
    });
    const running = client.generate(input);
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    editable = false;
    finish({ job: ready((recovery as AssistanceRecovery | null)!.jobId) });
    await running;
    expect(client.state().job).toBeNull();
    expect(inserted).not.toHaveBeenCalled();
    client.cancel();
    editable = true;
    await client.insert(1, null);
    expect(inserted).not.toHaveBeenCalled();
  });

  it("starts a fresh explicit source intent only after resetting a recoverable proposal", async () => {
    const f = fixture();
    const client = f.make();
    await client.generate(input);
    const first = f.recovery()!.jobId;
    expect(client.reset()).toBe(true);
    await client.generate({ ...input, sourceName: "Another outline" });
    expect(f.recovery()!.jobId).not.toBe(first);
    expect(client.state().job).toBeNull(); // A mismatched server source cannot replace the new proposal.
  });
});
