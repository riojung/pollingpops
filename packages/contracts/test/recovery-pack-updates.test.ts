import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ApplyRecoveryPackUpdateSchema,
  OpenRoundCheckpointSetExportSchema,
  QuizContentSchema,
  QuizDraftSchema,
  RecoveryPackContentSchema,
  RecoveryPackInsertionSchema,
  RecoveryPackUpdateBaselineSchema,
  RecoveryPackUpdateError,
  RecoveryPackUpdatePreviewSchema,
  applyRecoveryPackUpdate,
  buildRecoveryPackUpdatePreview,
  recoveryPackContentHash,
  recoveryPackUpdateLinkIssue,
  type QuizDraft,
  type RecoveryPackUpdateComparison,
  type RecoveryPackUpdateErrorCode,
  type RecoveryPackUpdateTarget,
} from "../src/index.js";

function question(prompt: string) {
  return {
    id: randomUUID(),
    type: "single_select" as const,
    prompt,
    purpose: "diagnostic" as const,
    confidence: "off" as const,
    delivery: "main" as const,
    conceptKeys: ["evidence"],
    linkedRecheckQuestionId: null as string | null,
    timeLimitSeconds: 30,
    basePoints: 100,
    explanation: "Use observed evidence",
    mediaId: null,
    mediaAlt: null,
    choices: [
      { id: randomUUID(), label: "Observation", isCorrect: true },
      { id: randomUUID(), label: "Assumption", isCorrect: false },
    ],
  };
}

function fixture() {
  const recheck = {
    ...question("What evidence supports this different scenario?"),
    delivery: "recheck" as const,
  };
  const content = RecoveryPackContentSchema.parse({
    schemaVersion: 1,
    title: "Evidence Pack",
    description: "",
    diagnostic: {
      ...question("Which evidence supports this conclusion?"),
      linkedRecheckQuestionId: recheck.id,
    },
    recheck,
    interventions: [
      {
        id: randomUUID(),
        title: "Compare signals",
        body: "Compare observation with assumption",
        citations: [],
      },
    ],
    conceptKeys: ["evidence"],
  });
  const insertion = RecoveryPackInsertionSchema.parse({
    id: randomUUID(),
    packId: randomUUID(),
    packVersionId: randomUUID(),
    packVersion: 1,
    contentHash: recoveryPackContentHash(content),
    diagnosticQuestionId: randomUUID(),
    recheckQuestionId: randomUUID(),
    originalContent: content,
  });
  const copied = (["diagnostic", "recheck"] as const).map((role) => {
    const item = structuredClone(content[role]);
    item.id = role === "diagnostic" ? insertion.diagnosticQuestionId : insertion.recheckQuestionId;
    item.linkedRecheckQuestionId = role === "diagnostic" ? insertion.recheckQuestionId : null;
    if ("choices" in item)
      item.choices = item.choices.map((choice) => ({ ...choice, id: randomUUID() }));
    item.recoveryPackSource = {
      artifactType: "recovery_pack",
      packId: insertion.packId,
      packVersionId: insertion.packVersionId,
      packVersion: 1,
      sourceItemId: content[role].id,
      role,
      contentHash: "a".repeat(64),
    };
    return item;
  });
  const draft: QuizDraft = {
    title: "Round",
    description: "",
    questions: copied,
    recoveryPackInsertions: [insertion],
  };
  const target: RecoveryPackUpdateTarget = {
    id: randomUUID(),
    version: 2,
    content: structuredClone(content),
  };
  return { draft, insertion, target };
}

function expectCode(work: () => unknown, code: RecoveryPackUpdateErrorCode) {
  try {
    work();
  } catch (error) {
    expect(error).toBeInstanceOf(RecoveryPackUpdateError);
    expect((error as RecoveryPackUpdateError).code).toBe(code);
    return;
  }
  throw new Error(`Expected ${code}`);
}

describe("Recovery Pack update contracts", () => {
  it("accepts hash-validated update baselines without changing the original insertion", () => {
    const { insertion, target } = fixture();
    const updateBaseline = {
      packVersionId: target.id,
      packVersion: target.version,
      contentHash: recoveryPackContentHash(target.content),
      content: target.content,
    };
    const parsed = RecoveryPackInsertionSchema.parse({ ...insertion, updateBaseline });
    expect(parsed.originalContent).toEqual(insertion.originalContent);
    expect(parsed.contentHash).toBe(insertion.contentHash);
    expect(parsed.updateBaseline).toEqual(updateBaseline);
    const changed = structuredClone(updateBaseline);
    changed.content.interventions[0]!.body = "Altered baseline";
    expect(RecoveryPackUpdateBaselineSchema.safeParse(changed).success).toBe(false);
    expect(
      RecoveryPackInsertionSchema.safeParse({ ...insertion, updateBaseline: changed }).success,
    ).toBe(false);
  });

  it("requires version/revision/idempotency fencing and unique role choices", () => {
    const { insertion, target } = fixture();
    const payload = {
      quizId: randomUUID(),
      insertionId: insertion.id,
      packVersionId: target.id,
      expectedRevision: 3,
      mutationId: randomUUID(),
      choices: [],
    };
    expect(ApplyRecoveryPackUpdateSchema.parse(payload)).toEqual(payload);
    expect(
      ApplyRecoveryPackUpdateSchema.safeParse({
        ...payload,
        choices: [
          { role: "diagnostic", action: "keep_local" },
          { role: "diagnostic", action: "use_latest" },
        ],
      }).success,
    ).toBe(false);
    expect(
      ApplyRecoveryPackUpdateSchema.safeParse({ ...payload, expectedRevision: -1 }).success,
    ).toBe(false);
    expect(
      ApplyRecoveryPackUpdateSchema.safeParse({ ...payload, mutationId: undefined }).success,
    ).toBe(false);
  });

  it("requires one preview item per role", () => {
    const { draft, insertion, target } = fixture();
    const comparison = buildRecoveryPackUpdatePreview(draft, insertion, target);
    const preview = { ...comparison, quizId: randomUUID(), draftRevision: 0 };
    expect(RecoveryPackUpdatePreviewSchema.parse(preview)).toEqual(preview);
    expect(
      RecoveryPackUpdatePreviewSchema.safeParse({
        ...preview,
        items: [preview.items[0], preview.items[0]],
      }).success,
    ).toBe(false);
  });

  it("round-trips accepted update baselines through native v4 while parsing legacy envelopes", () => {
    const { draft, insertion, target } = fixture();
    target.content.interventions[0]!.body = "Accepted new facilitator context";
    const updated = applyRecoveryPackUpdate(
      draft,
      buildRecoveryPackUpdatePreview(draft, insertion, target),
      target,
      [],
    );
    const envelope = {
      format: "openround.checkpoint-set",
      version: 4,
      exportedAt: new Date().toISOString(),
      checkpointSet: updated,
    };
    const parsed = OpenRoundCheckpointSetExportSchema.parse(JSON.parse(JSON.stringify(envelope)));
    expect(parsed.checkpointSet.recoveryPackInsertions![0]!.updateBaseline).toEqual(
      updated.recoveryPackInsertions![0]!.updateBaseline,
    );
    expect(parsed.checkpointSet.recoveryPackInsertions![0]!.originalContent).toEqual(
      insertion.originalContent,
    );
    for (const version of [1, 2, 3]) {
      const old = OpenRoundCheckpointSetExportSchema.parse({
        ...envelope,
        version,
        checkpointSet: draft,
      });
      expect(old.checkpointSet.recoveryPackInsertions![0]!.updateBaseline).toBeUndefined();
      expect(old.checkpointSet.recoveryPackInsertions![0]!.originalContent).toEqual(
        insertion.originalContent,
      );
    }
  });
});

describe("Recovery Pack three-way comparison", () => {
  it("ignores copied question/choice IDs and provenance while preserving role links", () => {
    const { draft, insertion, target } = fixture();
    target.content.diagnostic.id = randomUUID();
    target.content.recheck.id = randomUUID();
    target.content.diagnostic.linkedRecheckQuestionId = target.content.recheck.id;
    for (const item of [target.content.diagnostic, target.content.recheck]) {
      if ("choices" in item)
        item.choices = item.choices.map((choice) => ({ ...choice, id: randomUUID() }));
    }
    expect(
      buildRecoveryPackUpdatePreview(draft, insertion, target).items.map((item) => item.status),
    ).toEqual(["unchanged", "unchanged"]);
  });

  it("classifies source-only, local-only and divergent changes separately", () => {
    const { draft, insertion, target } = fixture();
    target.content.diagnostic.prompt = "Updated source diagnostic?";
    draft.questions[1]!.timeLimitSeconds = 60;
    expect(
      buildRecoveryPackUpdatePreview(draft, insertion, target).items.map((item) => item.status),
    ).toEqual(["source_changed", "local_changed"]);
    draft.questions[0]!.prompt = "Locally edited diagnostic?";
    expect(buildRecoveryPackUpdatePreview(draft, insertion, target).items[0]!.status).toBe(
      "conflict",
    );
  });

  it("normalizes optional defaults and numeric decimal representations", () => {
    const { draft, insertion, target } = fixture();
    draft.questions[0]!.confidence = undefined;
    draft.questions[0]!.delivery = undefined;
    expect(buildRecoveryPackUpdatePreview(draft, insertion, target).items[0]!.status).toBe(
      "unchanged",
    );
    const numeric = {
      ...target.content.recheck,
      type: "numeric" as const,
      correctValue: "1",
      tolerance: "0",
      unit: null,
    };
    const content = RecoveryPackContentSchema.parse({ ...target.content, recheck: numeric });
    const numericInsertion = {
      ...insertion,
      originalContent: content,
      contentHash: recoveryPackContentHash(content),
    };
    draft.recoveryPackInsertions = [numericInsertion];
    draft.questions[1] = {
      ...content.recheck,
      id: insertion.recheckQuestionId,
      type: "numeric",
      correctValue: "+01.000",
      tolerance: "0.00",
      unit: null,
      maxSelections: undefined,
    };
    expect(
      buildRecoveryPackUpdatePreview(draft, numericInsertion, { ...target, content }).items[1]!
        .status,
    ).toBe("unchanged");
  });

  it.each(["delivery", "link"])("treats a real local %s edit as a change", (field) => {
    const { draft, insertion, target } = fixture();
    if (field === "delivery") draft.questions[0]!.delivery = "recheck";
    else draft.questions[0]!.linkedRecheckQuestionId = randomUUID();
    expect(buildRecoveryPackUpdatePreview(draft, insertion, target).items[0]!.status).toBe(
      "local_changed",
    );
  });

  it("reports deleted questions as conflicts even when the source has not changed", () => {
    const { draft, insertion, target } = fixture();
    draft.questions = draft.questions.slice(1);
    const item = buildRecoveryPackUpdatePreview(draft, insertion, target).items[0]!;
    expect(item).toMatchObject({
      status: "conflict",
      local: null,
      questionId: insertion.diagnosticQuestionId,
    });
  });

  it("recognizes converged local/source edits without overwriting local provenance", () => {
    const { draft, insertion, target } = fixture();
    target.content.diagnostic.prompt = "Same independently changed prompt?";
    draft.questions[0]!.prompt = target.content.diagnostic.prompt;
    const preview = buildRecoveryPackUpdatePreview(draft, insertion, target);
    expect(preview.items[0]!.status).toBe("unchanged");
    const updated = applyRecoveryPackUpdate(draft, preview, target, []);
    expect(updated.questions[0]).toEqual(draft.questions[0]);
  });

  it("reports card/probe/metadata context separately from checkpoint changes", () => {
    const { draft, insertion, target } = fixture();
    target.content.interventions[0]!.body = "A revised intervention";
    const preview = buildRecoveryPackUpdatePreview(draft, insertion, target);
    expect(preview.contextChanged).toBe(true);
    expect(preview.items.map((item) => item.status)).toEqual(["unchanged", "unchanged"]);
    target.content.interventions[0]!.body = insertion.originalContent.interventions[0]!.body;
    target.content.interventions[0]!.id = randomUUID();
    expect(buildRecoveryPackUpdatePreview(draft, insertion, target).contextChanged).toBe(false);
  });
});

describe("Recovery Pack update application", () => {
  it("automatically replaces only unchanged local copies and advances accepted baseline", () => {
    const { draft, insertion, target } = fixture();
    target.content.diagnostic.prompt = "Revised source diagnostic?";
    target.content.interventions[0]!.body = "Revised card";
    draft.questions[1]!.prompt = "Locally adapted recheck?";
    const before = structuredClone(draft);
    const preview = buildRecoveryPackUpdatePreview(draft, insertion, target);
    const updated = applyRecoveryPackUpdate(draft, preview, target, []);
    expect(updated.questions[0]).toMatchObject({
      id: insertion.diagnosticQuestionId,
      prompt: target.content.diagnostic.prompt,
      linkedRecheckQuestionId: insertion.recheckQuestionId,
      recoveryPackSource: {
        packVersionId: target.id,
        packVersion: 2,
        sourceItemId: target.content.diagnostic.id,
      },
    });
    expect(updated.questions[1]).toEqual(draft.questions[1]);
    expect(updated.recoveryPackInsertions![0]).toMatchObject({
      ...insertion,
      updateBaseline: {
        packVersionId: target.id,
        packVersion: 2,
        contentHash: recoveryPackContentHash(target.content),
        content: target.content,
      },
    });
    expect(draft).toEqual(before);
  });

  it("requires an explicit choice for divergence and preserves kept local content", () => {
    const { draft, insertion, target } = fixture();
    target.content.diagnostic.prompt = "Source revision?";
    draft.questions[0]!.prompt = "Local revision?";
    const preview = buildRecoveryPackUpdatePreview(draft, insertion, target);
    expectCode(
      () => applyRecoveryPackUpdate(draft, preview, target, []),
      "CONFLICT_CHOICE_REQUIRED",
    );
    const kept = applyRecoveryPackUpdate(draft, preview, target, [
      { role: "diagnostic", action: "keep_local" },
    ]);
    expect(kept.questions[0]).toEqual(draft.questions[0]);
    expect(kept.recoveryPackInsertions![0]!.originalContent).toEqual(insertion.originalContent);
    expect(kept.recoveryPackInsertions![0]!.updateBaseline!.content).toEqual(target.content);
  });

  it("allows explicit replacement and remaps choice IDs deterministically by destination/version", () => {
    const { draft, insertion, target } = fixture();
    draft.questions[0]!.prompt = "Local revision?";
    target.content.diagnostic.prompt = "Source revision?";
    const preview = buildRecoveryPackUpdatePreview(draft, insertion, target);
    const choices = [{ role: "diagnostic" as const, action: "use_latest" as const }];
    const first = applyRecoveryPackUpdate(draft, preview, target, choices);
    expect(applyRecoveryPackUpdate(draft, preview, target, choices)).toEqual(first);
    const item = first.questions[0]!;
    if (!("choices" in item) || !("choices" in target.content.diagnostic))
      throw new Error("Expected choice questions");
    expect(item.choices.map((choice) => choice.id)).not.toEqual(
      target.content.diagnostic.choices.map((choice) => choice.id),
    );
    expect(new Set(item.choices.map((choice) => choice.id)).size).toBe(item.choices.length);
    expect(item.id).toBe(insertion.diagnosticQuestionId);
    expect(QuizDraftSchema.safeParse(first).success).toBe(true);
  });

  it.each(["diagnostic", "recheck"] as const)(
    "never auto-restores deleted %s, but explicit replacement restores its recorded ID",
    (role) => {
      const { draft, insertion, target } = fixture();
      const id =
        role === "diagnostic" ? insertion.diagnosticQuestionId : insertion.recheckQuestionId;
      draft.questions = draft.questions.filter((item) => item.id !== id);
      const preview = buildRecoveryPackUpdatePreview(draft, insertion, target);
      expectCode(
        () => applyRecoveryPackUpdate(draft, preview, target, []),
        "CONFLICT_CHOICE_REQUIRED",
      );
      const kept = applyRecoveryPackUpdate(draft, preview, target, [
        { role, action: "keep_local" },
      ]);
      expect(kept.questions.some((item) => item.id === id)).toBe(false);
      const restored = applyRecoveryPackUpdate(draft, preview, target, [
        { role, action: "use_latest" },
      ]);
      expect(restored.questions.map((item) => item.id)).toEqual([
        insertion.diagnosticQuestionId,
        insertion.recheckQuestionId,
      ]);
    },
  );

  it("restores both deleted items only after two explicit choices", () => {
    const { draft, insertion, target } = fixture();
    draft.questions = [];
    const preview = buildRecoveryPackUpdatePreview(draft, insertion, target);
    const updated = applyRecoveryPackUpdate(draft, preview, target, [
      { role: "diagnostic", action: "use_latest" },
      { role: "recheck", action: "use_latest" },
    ]);
    expect(updated.questions.map((item) => item.id)).toEqual([
      insertion.diagnosticQuestionId,
      insertion.recheckQuestionId,
    ]);
  });

  it("requires an explicit linked diagnostic replacement after normal recheck deletion", () => {
    const { draft, insertion, target } = fixture();
    draft.questions = draft.questions.filter((item) => item.id !== insertion.recheckQuestionId);
    draft.questions[0]!.linkedRecheckQuestionId = null;
    draft.questions[0]!.prompt = "Locally adapted diagnostic?";
    target.content.recheck.prompt = "Updated published transfer scenario?";
    const before = structuredClone(draft);
    const preview = buildRecoveryPackUpdatePreview(draft, insertion, target);
    expect(preview.items.map((item) => item.status)).toEqual(["local_changed", "conflict"]);
    const restoreOnly = [{ role: "recheck" as const, action: "use_latest" as const }];
    expect(recoveryPackUpdateLinkIssue(preview, restoreOnly)).toContain(
      "Keeping the unlinked local diagnostic",
    );
    expectCode(
      () => applyRecoveryPackUpdate(draft, preview, target, restoreOnly),
      "INVALID_LINKED_PAIR",
    );
    expect(draft).toEqual(before);
    const restored = applyRecoveryPackUpdate(draft, preview, target, [
      { role: "diagnostic", action: "use_latest" },
      ...restoreOnly,
    ]);
    expect(restored.questions[0]).toMatchObject({
      prompt: target.content.diagnostic.prompt,
      linkedRecheckQuestionId: insertion.recheckQuestionId,
    });
    expect(QuizContentSchema.safeParse(restored).success).toBe(true);
  });

  it("preserves an adapted diagnostic when the author explicitly repairs its link first", () => {
    const { draft, insertion, target } = fixture();
    draft.questions = draft.questions.filter((item) => item.id !== insertion.recheckQuestionId);
    draft.questions[0]!.prompt = "Keep this local diagnostic content?";
    const local = structuredClone(draft.questions[0]!);
    const preview = buildRecoveryPackUpdatePreview(draft, insertion, target);
    const restored = applyRecoveryPackUpdate(draft, preview, target, [
      { role: "diagnostic", action: "keep_local" },
      { role: "recheck", action: "use_latest" },
    ]);
    expect(restored.questions[0]).toEqual(local);
    expect(QuizContentSchema.safeParse(restored).success).toBe(true);
  });

  it.each(["diagnostic", "recheck"] as const)(
    "rejects restoring only %s while explicitly keeping its counterpart deleted",
    (role) => {
      const { draft, insertion, target } = fixture();
      draft.questions = [];
      const preview = buildRecoveryPackUpdatePreview(draft, insertion, target);
      expectCode(
        () =>
          applyRecoveryPackUpdate(draft, preview, target, [
            { role, action: "use_latest" },
            { role: role === "diagnostic" ? "recheck" : "diagnostic", action: "keep_local" },
          ]),
        "INVALID_LINKED_PAIR",
      );
    },
  );

  it("rejects replacement that links to a kept non-recheck checkpoint", () => {
    const { draft, insertion, target } = fixture();
    draft.questions[1]!.delivery = "main";
    const preview = buildRecoveryPackUpdatePreview(draft, insertion, target);
    expectCode(
      () =>
        applyRecoveryPackUpdate(draft, preview, target, [
          { role: "diagnostic", action: "use_latest" },
          { role: "recheck", action: "keep_local" },
        ]),
      "INVALID_LINKED_PAIR",
    );
  });

  it.each(["order", "shared"] as const)(
    "rejects replacing an invalid %s-linked pair without changing local questions",
    (kind) => {
      const { draft, insertion, target } = fixture();
      if (kind === "order") draft.questions.reverse();
      else
        draft.questions.splice(1, 0, {
          ...question("Other diagnostic?"),
          linkedRecheckQuestionId: insertion.recheckQuestionId,
        });
      const before = structuredClone(draft);
      const preview = buildRecoveryPackUpdatePreview(draft, insertion, target);
      expectCode(
        () =>
          applyRecoveryPackUpdate(draft, preview, target, [
            { role: "recheck", action: "use_latest" },
          ]),
        "INVALID_LINKED_PAIR",
      );
      expect(draft).toEqual(before);
    },
  );

  it("uses the accepted update baseline for later comparisons without rewriting the insertion origin", () => {
    const { draft, insertion, target } = fixture();
    target.content.diagnostic.prompt = "Revision two?";
    const second = applyRecoveryPackUpdate(
      draft,
      buildRecoveryPackUpdatePreview(draft, insertion, target),
      target,
      [],
    );
    const next = { id: randomUUID(), version: 3, content: structuredClone(target.content) };
    next.content.diagnostic.prompt = "Revision three?";
    const nextPreview = buildRecoveryPackUpdatePreview(
      second,
      second.recoveryPackInsertions![0]!,
      next,
    );
    expect(nextPreview).toMatchObject({
      baselineVersionId: target.id,
      baselineVersion: 2,
      latestVersion: 3,
    });
    expect(nextPreview.items[0]!.status).toBe("source_changed");
    const third = applyRecoveryPackUpdate(second, nextPreview, next, []);
    expect(third.recoveryPackInsertions![0]!.originalContent).toEqual(insertion.originalContent);
    expect(third.recoveryPackInsertions![0]!.packVersionId).toBe(insertion.packVersionId);
    expect(third.recoveryPackInsertions![0]!.updateBaseline!.packVersion).toBe(3);
  });

  it("rejects stale or forged preview question content rather than applying client payload", () => {
    const { draft, insertion, target } = fixture();
    const preview = buildRecoveryPackUpdatePreview(draft, insertion, target);
    const forged = structuredClone(preview);
    forged.items[0]!.latest.prompt = "Client-injected question?";
    expectCode(() => applyRecoveryPackUpdate(draft, forged, target, []), "REVIEW_STALE");
    draft.questions[0]!.prompt = "Edited after review?";
    expectCode(() => applyRecoveryPackUpdate(draft, preview, target, []), "REVIEW_STALE");
  });

  it("rejects duplicate choices even when callers bypass request validation", () => {
    const { draft, insertion, target } = fixture();
    const preview = buildRecoveryPackUpdatePreview(draft, insertion, target);
    expectCode(
      () =>
        applyRecoveryPackUpdate(draft, preview, target, [
          { role: "diagnostic", action: "keep_local" },
          { role: "diagnostic", action: "use_latest" },
        ]),
      "INVALID_CHOICES",
    );
  });

  it("rejects restoring past the 200-checkpoint capacity", () => {
    const { draft, insertion, target } = fixture();
    draft.questions = Array.from({ length: 200 }, (_, index) =>
      question(`Unrelated checkpoint ${index}?`),
    );
    const preview = buildRecoveryPackUpdatePreview(draft, insertion, target);
    expectCode(
      () =>
        applyRecoveryPackUpdate(draft, preview, target, [
          { role: "diagnostic", action: "use_latest" },
          { role: "recheck", action: "keep_local" },
        ]),
      "QUESTION_CAPACITY_EXCEEDED",
    );
  });
});

describe("Recovery Pack update identity safety", () => {
  it("rejects ambiguous duplicate destination/question IDs and cross-insertion ownership", () => {
    const { draft, insertion, target } = fixture();
    const duplicate = { ...insertion, recheckQuestionId: insertion.diagnosticQuestionId };
    expectCode(
      () =>
        buildRecoveryPackUpdatePreview(
          { ...draft, recoveryPackInsertions: [duplicate] },
          duplicate,
          target,
        ),
      "INVALID_INSERTION",
    );
    expectCode(
      () =>
        buildRecoveryPackUpdatePreview(
          { ...draft, questions: [draft.questions[0]!, draft.questions[0]!] },
          insertion,
          target,
        ),
      "INVALID_INSERTION",
    );
    const overlap = { ...insertion, id: randomUUID() };
    expectCode(
      () =>
        buildRecoveryPackUpdatePreview(
          { ...draft, recoveryPackInsertions: [insertion, overlap] },
          insertion,
          target,
        ),
      "INVALID_INSERTION",
    );
    expectCode(
      () =>
        buildRecoveryPackUpdatePreview(
          { ...draft, recoveryPackInsertions: [insertion, insertion] },
          insertion,
          target,
        ),
      "INVALID_INSERTION",
    );
  });

  it("accepts a republished older immutable version while retaining local edits and the insertion origin", () => {
    const { draft, insertion, target } = fixture();
    target.content.diagnostic.prompt = "Published revision two?";
    target.content.interventions[0]!.body = "Published revision two context";
    draft.questions[1]!.prompt = "Locally adapted recheck?";
    const accepted = applyRecoveryPackUpdate(
      draft,
      buildRecoveryPackUpdatePreview(draft, insertion, target),
      target,
      [],
    );
    const acceptedInsertion = accepted.recoveryPackInsertions![0]!;
    const republished = {
      id: insertion.packVersionId,
      version: insertion.packVersion,
      content: insertion.originalContent,
    };
    const preview = buildRecoveryPackUpdatePreview(accepted, acceptedInsertion, republished);
    expect(preview).toMatchObject({
      baselineVersionId: target.id,
      baselineVersion: 2,
      latestVersionId: insertion.packVersionId,
      latestVersion: 1,
      contextChanged: true,
    });
    expect(preview.items.map((item) => item.status)).toEqual(["source_changed", "local_changed"]);
    const restored = applyRecoveryPackUpdate(accepted, preview, republished, []);
    expect(restored.questions[0]).toMatchObject({
      id: insertion.diagnosticQuestionId,
      prompt: insertion.originalContent.diagnostic.prompt,
      recoveryPackSource: { packVersionId: insertion.packVersionId, packVersion: 1 },
    });
    expect(restored.questions[1]).toEqual(accepted.questions[1]);
    expect(restored.recoveryPackInsertions![0]).toMatchObject({
      ...insertion,
      updateBaseline: {
        packVersionId: insertion.packVersionId,
        packVersion: 1,
        contentHash: insertion.contentHash,
        content: insertion.originalContent,
      },
    });
    expect(accepted.recoveryPackInsertions![0]!.updateBaseline!.packVersion).toBe(2);
  });

  it("rejects impossible same-version IDs or altered metadata/content for the same immutable ID", () => {
    const { draft, insertion, target } = fixture();
    expectCode(
      () => buildRecoveryPackUpdatePreview(draft, insertion, { ...target, version: 1 }),
      "TARGET_MISMATCH",
    );
    expectCode(
      () =>
        buildRecoveryPackUpdatePreview(draft, insertion, {
          ...target,
          id: insertion.packVersionId,
        }),
      "TARGET_MISMATCH",
    );
    const changed = structuredClone(target.content);
    changed.diagnostic.prompt = "Changed immutable content?";
    expectCode(
      () =>
        buildRecoveryPackUpdatePreview(draft, insertion, {
          id: insertion.packVersionId,
          version: 1,
          content: changed,
        }),
      "TARGET_MISMATCH",
    );
  });

  it("returns insertion-not-found when a prior review's insertion was removed", () => {
    const { draft, insertion, target } = fixture();
    const preview: RecoveryPackUpdateComparison = buildRecoveryPackUpdatePreview(
      draft,
      insertion,
      target,
    );
    draft.recoveryPackInsertions = [];
    expectCode(() => applyRecoveryPackUpdate(draft, preview, target, []), "INSERTION_NOT_FOUND");
  });
});
