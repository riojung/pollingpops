import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { legacyRoundProtocol } from "@openround/contracts";
import {
  createGameState,
  snapshotForRole,
  upgradeGameState,
  applyHostCommand,
  addParticipant,
} from "../src/index";

function fixture() {
  return createGameState({
    sessionId: randomUUID(),
    code: "1234567",
    quiz: {
      title: "Compatibility",
      description: "",
      questions: [
        {
          id: randomUUID(),
          type: "numeric",
          prompt: "Two plus two?",
          correctValue: "4",
          tolerance: "0",
          unit: null,
          timeLimitSeconds: 30,
          basePoints: 100,
          explanation: "Two pairs.",
          mediaId: null,
          mediaAlt: null,
        },
      ],
    },
    settings: {
      audienceLimit: 20,
      scoringMode: "accuracy",
      resultVisibility: "private",
      nicknamePolicy: "custom",
      allowLateJoin: true,
    },
    roundProtocol: legacyRoundProtocol(),
    recoveryPackCardsEnabled: true,
  });
}
describe("protocol-aware game state", () => {
  it("freezes requirements at creation and projects them for all roles without an answer key", () => {
    const state = fixture();
    expect(state.stateSchemaVersion).toBe(7);
    expect(upgradeGameState(structuredClone(state))).toMatchObject({
      roundProtocol: legacyRoundProtocol(),
      recoveryPackCardsEnabled: true,
    });
    const opened = applyHostCommand(state, {
      commandId: randomUUID(),
      expectedVersion: state.version,
      action: "start",
      nowMs: 1000,
      newRoundId: randomUUID,
    }).state;
    for (const role of ["host", "presenter", "participant"] as const) {
      const snapshot = snapshotForRole(opened, { role });
      expect(snapshot.roundProtocol).toEqual(legacyRoundProtocol());
      expect(snapshot.question).not.toHaveProperty("correctValue");
    }
  });
  it("preserves host progress and participants after serialization and upgrade", () => {
    const state = addParticipant(fixture(), {
      id: randomUUID(),
      nickname: "Synthetic",
      score: 0,
      correctCount: 0,
      acceptedResponseMs: 0,
      connected: true,
      kicked: false,
    }).state;
    const opened = applyHostCommand(state, {
      commandId: randomUUID(),
      expectedVersion: state.version,
      action: "start",
      nowMs: 1000,
      newRoundId: randomUUID,
    }).state;
    expect(upgradeGameState(JSON.parse(JSON.stringify(opened)))).toEqual(opened);
  });
  it("keeps legacy v5/v6 rooms readable without inventing protocol requirements", () => {
    for (const version of [5, 6]) {
      const state = fixture();
      delete state.roundProtocol;
      state.stateSchemaVersion = version;
      expect(upgradeGameState(state)).toMatchObject({
        stateSchemaVersion: version,
        recoveryPackCardsEnabled: version === 6,
      });
      expect(snapshotForRole(state, { role: "host" })).not.toHaveProperty("roundProtocol");
    }
  });
  it("fails closed on missing, future or downgraded protocol metadata", () => {
    const state = fixture();
    expect(() => upgradeGameState({ ...state, roundProtocol: undefined })).toThrow();
    expect(() => upgradeGameState({ ...state, stateSchemaVersion: 6 })).toThrow(
      "requires game state schema 7",
    );
    expect(() => upgradeGameState({ ...state, stateSchemaVersion: 10 })).toThrow(
      "newer than supported schema 9",
    );
    expect(() =>
      upgradeGameState({
        ...state,
        roundProtocol: { ...state.roundProtocol!, minimumClientVersion: 99 } as never,
      }),
    ).toThrow();
  });
});
