import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MemoryRepository } from "../src/index.js";
import { expectSessionHistoryConformance } from "./support/session-history-conformance.js";

describe("Sessions Library history in memory", () => {
  it("counts retained rooms exactly and searches before pagination within one workspace", async () => {
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
    await expectSessionHistoryConformance(repository, await creator(), await creator());
  });
});
