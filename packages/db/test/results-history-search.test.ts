import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MemoryRepository } from "../src/index.js";
import { expectResultsHistorySearchConformance } from "./support/results-history-search-conformance.js";

describe("Results history search in memory", () => {
  it("searches frozen Round and practice titles before pagination with literal tenant-scoped filters", async () => {
    const repository = new MemoryRepository();
    async function creator() {
      const tokenHash = randomUUID();
      const now = new Date();
      await repository.createMagicToken({
        id: randomUUID(),
        email: `${randomUUID()}@example.com`,
        segment: "workplace",
        tokenHash,
        policyVersion: "test-v1",
        expiresAt: new Date(now.getTime() + 60_000),
        consumedAt: null,
      });
      const actor = await repository.consumeMagicToken(tokenHash, now);
      expect(actor).not.toBeNull();
      return actor!;
    }
    await expectResultsHistorySearchConformance(repository, await creator(), await creator());
  });
});
