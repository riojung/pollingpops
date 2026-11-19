import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { MemoryRepository } from "../src/index.js";
import {
  branchingMemoryStore,
  expectBranchingLifecycle,
  expectBranchingReaderAndResponses,
  expectBranchingReaderLegacyCompatibility,
  expectBranchingWriterAndResultsBoundary,
  seedBranchingSurvey,
} from "./support/survey-branching-conformance.js";

describe("conditional Survey runtime readers in memory", () => {
  it("negotiates v4, clears cascades by replacement and keeps older exact retries from restoring them", () =>
    expectBranchingReaderAndResponses(new MemoryRepository()));
  it("accepts historical v1-v3 attempts with the newer reader without upgrading their stored versions", () =>
    expectBranchingReaderLegacyCompatibility(new MemoryRepository()));
  it("fences every author writer, downgrades and unqualified aggregate results", () =>
    expectBranchingWriterAndResultsBoundary(new MemoryRepository()));
  it.each(["room", "expiry", "account"] as const)(
    "preserves private export and %s erasure",
    async (mode) => {
      const repository = new MemoryRepository();
      const f = await expectBranchingLifecycle(repository, mode);
      const store = branchingMemoryStore(repository);
      expect([...store.survey_guests.values()].filter((row) => row.roomId === f.room.id)).toEqual(
        [],
      );
      expect([...store.receipts.values()].filter((row) => row.roomId === f.room.id)).toEqual([]);
    },
  );
  it("rejects stored future versions, mismatched content versions and mismatched guest versions", async () => {
    const repository = new MemoryRepository();
    const f = await seedBranchingSurvey(repository);
    const store = branchingMemoryStore(repository);
    const room = store.survey_feedback_rooms.get(f.room.id)!;
    store.survey_feedback_rooms.set(f.room.id, { ...room, schemaVersion: 3 });
    await expect(f.surveys.getRoom(f.room.id)).rejects.toThrow("schema versions must match");
    store.survey_feedback_rooms.set(f.room.id, { ...room, schemaVersion: 5 as never });
    await expect(f.surveys.getRoom(f.room.id)).rejects.toThrow("Unsupported stored");
    store.survey_feedback_rooms.set(f.room.id, room);
    const token = randomUUID();
    await f.surveys.admit(f.room.id, token, f.now, 4);
    const guest = [...store.survey_guests.values()][0]!;
    guest.schemaVersion = 3;
    await expect(f.surveys.attempt(f.room.id, token, f.now, 4)).rejects.toThrow(
      "matching scope and schema",
    );
    await expect(
      f.surveys.respond(f.room.id, token, f.shut, 0, randomUUID(), false, f.now, 4),
    ).rejects.toThrow("matching scope and schema");
  });
  it("expands only the four storage discriminators in a forward migration", async () => {
    const sql = await readFile(
      new URL("../migrations/118_survey_branching_readers.sql", import.meta.url),
      "utf8",
    );
    for (const table of ["surveys", "survey_versions", "survey_feedback_rooms", "survey_guests"])
      expect(sql).toContain(`ALTER TABLE ${table} ADD CONSTRAINT ${table}_data_check`);
    expect(sql.match(/IN \(1, 2, 3, 4\)/gu)).toHaveLength(4);
    expect(sql).not.toMatch(/UPDATE |INSERT |DELETE |DISABLE ROW LEVEL SECURITY/iu);
  });
});
