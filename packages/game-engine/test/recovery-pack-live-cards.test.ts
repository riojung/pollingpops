import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  RecoveryPackContentSchema,
  recoveryPackContentHash,
  type RecoveryPackInsertion,
} from "@openround/contracts";
import {
  acceptAnswer,
  addParticipant,
  applyHostCommand,
  createGameState,
  snapshotForRole,
  upgradeGameState,
  type GameState,
} from "../src/index.js";

function fixture(enabled = true) {
  const question = (prompt: string) => ({
    id: randomUUID(),
    type: "single_select" as const,
    prompt,
    purpose: "practice" as const,
    confidence: "optional" as const,
    delivery: "main" as const,
    conceptKeys: ["isolation"],
    linkedRecheckQuestionId: null as string | null,
    choices: [
      { id: randomUUID(), label: "Physically isolate", isCorrect: true },
      { id: randomUUID(), label: "Post a warning", isCorrect: false },
    ],
    timeLimitSeconds: 30,
    basePoints: 1_000,
    explanation: "Private diagnostic rationale.",
    mediaId: null,
    mediaAlt: null,
  });
  const recheck = {
    ...question("Which action secures the new machine?"),
    delivery: "recheck" as const,
  };
  const content = RecoveryPackContentSchema.parse({
    schemaVersion: 1,
    title: "Isolation Pack",
    description: "",
    diagnostic: {
      ...question("Which action actually isolates energy?"),
      purpose: "diagnostic",
      linkedRecheckQuestionId: recheck.id,
    },
    recheck,
    delayedProbe: question("How would you secure a different machine tomorrow?"),
    interventions: [
      {
        id: randomUUID(),
        title: "Explanation",
        body: "Explain physical separation.",
        citations: [
          {
            sourceName: "Safety manual",
            sourceDigest: "b".repeat(64),
            locator: "Page 2",
            excerpt: "Isolate physically.",
          },
        ],
      },
      {
        id: randomUUID(),
        title: "Unselected future card",
        body: "Secret alternative example.",
        citations: [],
      },
    ],
    conceptKeys: ["isolation"],
    misconceptionKeys: [],
    citations: [],
  });
  const insertion: RecoveryPackInsertion = {
    id: randomUUID(),
    packId: randomUUID(),
    packVersionId: randomUUID(),
    packVersion: 1,
    contentHash: recoveryPackContentHash(content),
    diagnosticQuestionId: randomUUID(),
    recheckQuestionId: randomUUID(),
    originalContent: structuredClone(content),
  };
  const state = createGameState({
    sessionId: randomUUID(),
    code: "1234567",
    recoveryPackCardsEnabled: enabled,
    quiz: {
      title: "Frozen Round",
      description: "",
      recoveryPackInsertions: [insertion],
      questions: [
        {
          ...structuredClone(content.diagnostic),
          id: insertion.diagnosticQuestionId,
          linkedRecheckQuestionId: insertion.recheckQuestionId,
        },
        { ...structuredClone(content.recheck), id: insertion.recheckQuestionId },
        question("Unrelated later checkpoint?"),
      ],
    },
    settings: {
      audienceLimit: 20,
      scoringMode: "accuracy",
      resultVisibility: "private",
      allowLateJoin: true,
      nicknamePolicy: "custom",
    },
  });
  return {
    state,
    insertion,
    content,
    selection: { insertionId: insertion.id, cardId: content.interventions[0]!.id },
  };
}

function command(
  state: GameState,
  action: Parameters<typeof applyHostCommand>[1]["action"],
  extra: Partial<Parameters<typeof applyHostCommand>[1]> = {},
) {
  return applyHostCommand(state, {
    commandId: randomUUID(),
    expectedVersion: state.version,
    action,
    nowMs: 1_000 + state.version * 1_000,
    newRoundId: randomUUID,
    ...extra,
  });
}

function revealed(state: GameState) {
  return command(command(command(state, "start").state, "lock").state, "reveal").state;
}

// Exact newer-schema guard in the pre-live-card engine at commit 7f0a5d8.
function historicalV5Read(input: Pick<GameState, "stateSchemaVersion">) {
  if ((input.stateSchemaVersion ?? 1) > 5) {
    throw new Error(
      `Game state schema ${input.stateSchemaVersion} is newer than supported schema 5`,
    );
  }
  return input;
}

describe("frozen live Recovery Pack cards", () => {
  it("freezes creation enablement and explicitly upcasts legacy sessions without enabling cards", () => {
    const { state } = fixture();
    expect(state.stateSchemaVersion).toBe(6);
    expect(state.recoveryPackCardsEnabled).toBe(true);
    expect(fixture(false).state.recoveryPackCardsEnabled).toBe(false);
    const old = { ...state, stateSchemaVersion: 5 };
    expect(upgradeGameState(old)).toMatchObject({
      stateSchemaVersion: 5,
      recoveryPackCardsEnabled: false,
    });
    const missing = { ...state };
    delete missing.recoveryPackCardsEnabled;
    expect(upgradeGameState(missing).recoveryPackCardsEnabled).toBe(false);
    expect(upgradeGameState(state).recoveryPackCardsEnabled).toBe(true);
  });

  it("keeps disabled creations, persisted transitions, and role snapshots readable by v5 instances", () => {
    let { state } = fixture(false);
    const participantId = randomUUID();
    state = addParticipant(state, {
      id: participantId,
      nickname: "Learner",
      score: 0,
      correctCount: 0,
      acceptedResponseMs: 0,
      connected: true,
      kicked: false,
    }).state;
    const assertCompatible = (current: GameState) => {
      expect(current.stateSchemaVersion).toBe(5);
      expect(current.recoveryPackCardsEnabled).toBe(false);
      expect(() => historicalV5Read(current)).not.toThrow();
      const restored = upgradeGameState(JSON.parse(JSON.stringify(current)) as GameState);
      expect(restored.stateSchemaVersion).toBe(5);
      for (const role of ["host", "participant", "presenter"] as const) {
        const snapshot = snapshotForRole(restored, { role, participantId });
        expect(snapshot.stateSchemaVersion).toBe(5);
        expect(snapshot).not.toHaveProperty("recoveryPackCards");
        expect(snapshot).not.toHaveProperty("recoveryPackCard");
      }
    };
    assertCompatible(state);
    state = command(state, "start").state;
    assertCompatible(state);
    const question = state.quiz.questions[state.questionIndex!]!;
    if (!("choices" in question)) throw new Error("Expected a choice fixture");
    state = acceptAnswer(state, {
      participantId,
      roundId: state.roundId!,
      choiceId: question.choices.find((choice) => choice.isCorrect)!.id,
      idempotencyKey: randomUUID(),
      answerId: randomUUID(),
      nowMs: state.openedAtMs! + 100,
    }).state;
    assertCompatible(state);
    for (const action of [
      "lock",
      "reveal",
      "intervention.start",
      "intervention.finish",
      "next",
    ] as const) {
      state = command(
        state,
        action,
        action === "intervention.start" ? { interventionType: "explain" } : {},
      ).state;
      assertCompatible(state);
    }
  });

  it("fences enabled v6 state from the historical v5 guard while defaults and old states stay disabled", () => {
    const enabled = fixture().state;
    expect(() => historicalV5Read(enabled)).toThrow("newer than supported schema 5");
    expect(snapshotForRole(enabled, { role: "host" }).stateSchemaVersion).toBe(6);
    const omitted = createGameState({
      sessionId: randomUUID(),
      code: "1234567",
      quiz: enabled.quiz,
      settings: enabled.settings,
    });
    expect(omitted).toMatchObject({ stateSchemaVersion: 5, recoveryPackCardsEnabled: false });
    expect(() => historicalV5Read(omitted)).not.toThrow();
    for (const stateSchemaVersion of [1, 2, 3, 4, 5]) {
      const legacy = upgradeGameState({ ...enabled, stateSchemaVersion });
      expect(legacy).toMatchObject({ stateSchemaVersion: 5, recoveryPackCardsEnabled: false });
      expect(snapshotForRole(revealed(legacy), { role: "host" })).not.toHaveProperty(
        "recoveryPackCards",
      );
    }
    expect(upgradeGameState({ ...enabled, recoveryPackCardsEnabled: false })).toMatchObject({
      stateSchemaVersion: 6,
      recoveryPackCardsEnabled: false,
    });
    expect(() => upgradeGameState({ ...enabled, stateSchemaVersion: 8 })).toThrow(
      "newer than supported schema 7",
    );
  });

  it("offers only the current diagnostic cards to the host after reveal", () => {
    const { state, insertion, content } = fixture();
    const open = command(state, "start").state;
    const locked = command(open, "lock").state;
    for (const phase of [state, open, locked]) {
      for (const role of ["host", "participant", "presenter"] as const) {
        expect(snapshotForRole(phase, { role })).not.toHaveProperty("recoveryPackCards");
        expect(snapshotForRole(phase, { role })).not.toHaveProperty("recoveryPackCard");
      }
    }
    const reveal = command(locked, "reveal").state;
    expect(snapshotForRole(reveal, { role: "host" }).recoveryPackCards).toEqual(
      content.interventions.map(({ id, ...card }) => ({
        ...card,
        reference: {
          insertionId: insertion.id,
          packId: insertion.packId,
          packVersionId: insertion.packVersionId,
          packVersion: 1,
          contentHash: insertion.contentHash,
          cardId: id,
        },
      })),
    );
    for (const role of ["participant", "presenter"] as const) {
      const snapshot = snapshotForRole(reveal, { role });
      expect(snapshot).not.toHaveProperty("recoveryPackCards");
      expect(JSON.stringify(snapshot)).not.toContain(content.delayedProbe!.prompt);
      expect(JSON.stringify(snapshot)).not.toContain(content.recheck.prompt);
      expect(JSON.stringify(snapshot)).not.toContain(content.interventions[1]!.body);
    }
  });

  it("never offers another Pack's later diagnostic or its cards for the current checkpoint", () => {
    const current = fixture();
    const future = fixture();
    current.state.quiz.questions.push(...future.state.quiz.questions.slice(0, 2));
    current.state.quiz.recoveryPackInsertions!.push(future.insertion);
    const reveal = revealed(current.state);
    const hostCards = snapshotForRole(reveal, { role: "host" }).recoveryPackCards!;
    expect(hostCards.every((card) => card.reference.insertionId === current.insertion.id)).toBe(
      true,
    );
    expect(() =>
      command(reveal, "intervention.start", {
        interventionType: "example",
        recoveryPackCard: future.selection,
      }),
    ).toThrow();
  });

  it("publishes only the selected card while its intervention is active and records only a reference", () => {
    const { state, selection, content } = fixture();
    const active = command(revealed(state), "intervention.start", {
      interventionType: "explain",
      recoveryPackCard: selection,
    }).state;
    expect(active.intervention).toHaveProperty("recoveryPackCard.cardId", selection.cardId);
    expect(active.intervention).not.toHaveProperty("body");
    for (const role of ["host", "participant", "presenter"] as const) {
      const snapshot = snapshotForRole(active, { role });
      expect(snapshot.recoveryPackCard).toMatchObject({
        title: content.interventions[0]!.title,
        body: content.interventions[0]!.body,
        citations: content.interventions[0]!.citations,
      });
      expect(snapshot).not.toHaveProperty("recoveryPackCards");
      expect(JSON.stringify(snapshot)).not.toContain(content.interventions[1]!.body);
      expect(JSON.stringify(snapshot)).not.toContain(content.delayedProbe!.prompt);
    }
    const finished = command(active, "intervention.finish").state;
    for (const role of ["host", "participant", "presenter"] as const)
      expect(snapshotForRole(finished, { role })).not.toHaveProperty("recoveryPackCard");
    expect(finished.interventions[active.intervention!.id]?.recoveryPackCard).toEqual(
      active.intervention!.recoveryPackCard,
    );
    const recheck = command(finished, "recheck.open", { recheckMode: "linked" }).state;
    expect(snapshotForRole(recheck, { role: "host" })).not.toHaveProperty("recoveryPackCards");
    expect(snapshotForRole(recheck, { role: "participant" })).not.toHaveProperty(
      "recoveryPackCard",
    );
    expect(
      snapshotForRole(command(active, "end").state, { role: "participant" }),
    ).not.toHaveProperty("recoveryPackCard");
  });

  it("resolves the accepted update baseline, retaining original history and ignoring later source changes", () => {
    const { state, insertion, content } = fixture();
    const accepted = structuredClone(content);
    accepted.interventions[0]!.id = randomUUID();
    accepted.interventions[0]!.body = "Accepted revised example.";
    insertion.updateBaseline = {
      packVersionId: randomUUID(),
      packVersion: 2,
      contentHash: recoveryPackContentHash(accepted),
      content: accepted,
    };
    content.interventions[0]!.body = "Latest source changed after the Round was frozen.";
    const reveal = revealed(state);
    const card = snapshotForRole(reveal, { role: "host" }).recoveryPackCards![0]!;
    expect(card).toMatchObject({
      body: "Accepted revised example.",
      reference: {
        packVersionId: insertion.updateBaseline.packVersionId,
        packVersion: 2,
        contentHash: insertion.updateBaseline.contentHash,
      },
    });
    expect(insertion.originalContent.interventions[0]!.body).toBe("Explain physical separation.");
    expect(() =>
      command(reveal, "intervention.start", {
        interventionType: "example",
        recoveryPackCard: {
          insertionId: insertion.id,
          cardId: insertion.originalContent.interventions[0]!.id,
        },
      }),
    ).toThrow();
    const active = command(reveal, "intervention.start", {
      interventionType: "example",
      recoveryPackCard: { insertionId: insertion.id, cardId: accepted.interventions[0]!.id },
    }).state;
    expect(snapshotForRole(active, { role: "participant" }).recoveryPackCard).toEqual(card);
  });

  it("rejects disabled, unrelated, ambiguous, pre-reveal and unsupported card selections", () => {
    const current = fixture();
    const reveal = revealed(current.state);
    const invoke = (state = reveal, extra = {}) =>
      command(state, "intervention.start", {
        interventionType: "explain",
        recoveryPackCard: current.selection,
        ...extra,
      });
    expect(() => invoke(revealed({ ...current.state, recoveryPackCardsEnabled: false }))).toThrow();
    expect(() => invoke(command(command(current.state, "start").state, "lock").state)).toThrow();
    expect(() => invoke(reveal, { interventionType: "break" })).toThrow();
    expect(() => command(reveal, "next", { recoveryPackCard: current.selection })).toThrow();
    expect(() =>
      invoke(reveal, { recoveryPackCard: { ...current.selection, insertionId: randomUUID() } }),
    ).toThrow();
    expect(() =>
      invoke(reveal, { recoveryPackCard: { ...current.selection, cardId: randomUUID() } }),
    ).toThrow();
    for (const malformed of [
      { ...current.insertion, diagnosticQuestionId: randomUUID() },
      {
        ...current.insertion,
        originalContent: {
          ...current.insertion.originalContent,
          interventions: [current.content.interventions[0]!, current.content.interventions[0]!],
        },
      },
    ]) {
      const corrupt = { ...reveal, quiz: { ...reveal.quiz, recoveryPackInsertions: [malformed] } };
      expect(snapshotForRole(corrupt, { role: "host" })).not.toHaveProperty("recoveryPackCards");
      expect(() => invoke(corrupt)).toThrow();
    }
    const duplicate = {
      ...reveal,
      quiz: {
        ...reveal.quiz,
        recoveryPackInsertions: [current.insertion, { ...current.insertion, id: randomUUID() }],
      },
    };
    expect(() => invoke(duplicate)).toThrow();
    const repeatedId = {
      ...reveal,
      quiz: {
        ...reveal.quiz,
        recoveryPackInsertions: [
          current.insertion,
          { ...current.insertion, diagnosticQuestionId: randomUUID() },
        ],
      },
    };
    expect(() => invoke(repeatedId)).toThrow();
    const collidingRole = {
      ...reveal,
      quiz: {
        ...reveal.quiz,
        recoveryPackInsertions: [
          current.insertion,
          {
            ...current.insertion,
            id: randomUUID(),
            diagnosticQuestionId: randomUUID(),
            recheckQuestionId: current.insertion.diagnosticQuestionId,
          },
        ],
      },
    };
    expect(() => invoke(collidingRole)).toThrow();
    const unrelated = command(reveal, "next").state;
    const unrelatedReveal = command(command(unrelated, "lock").state, "reveal").state;
    expect(() => invoke(unrelatedReveal)).toThrow();
  });

  it("preserves command idempotency before stale fencing and leaves ordinary interventions unchanged", () => {
    const { state, selection } = fixture();
    const reveal = revealed(state);
    const input = {
      commandId: randomUUID(),
      expectedVersion: reveal.version,
      action: "intervention.start" as const,
      interventionType: "example" as const,
      recoveryPackCard: selection,
      nowMs: 4_000,
      newRoundId: randomUUID,
    };
    const first = applyHostCommand(reveal, input);
    const retry = applyHostCommand(first.state, input);
    expect(retry).toMatchObject({ duplicate: true, events: [] });
    expect(retry.state.intervention).toEqual(first.state.intervention);
    expect(() => applyHostCommand(first.state, { ...input, commandId: randomUUID() })).toThrow(
      "Session state changed",
    );
    const ordinary = command(reveal, "intervention.start", { interventionType: "explain" }).state;
    expect(ordinary.intervention).not.toHaveProperty("recoveryPackCard");
    expect(snapshotForRole(ordinary, { role: "participant" })).not.toHaveProperty(
      "recoveryPackCard",
    );
  });
});
