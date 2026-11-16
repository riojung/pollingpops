import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MemoryRepository } from "../src/index.js";
import { expectReportHistoryEvidenceConformance } from "./support/report-history-evidence-conformance.js";

describe("Report history evidence in memory", () => {
  it("distinguishes missing assessed evidence from measured zero across retained report versions", async () => {
    const repository = new MemoryRepository();
    const now = new Date();
    const tokenHash = randomUUID();
    await repository.createMagicToken({
      id: randomUUID(),
      email: `${randomUUID()}@example.com`,
      segment: "workplace",
      tokenHash,
      policyVersion: "test-v1",
      expiresAt: new Date(now.getTime() + 60_000),
      consumedAt: null,
    });
    const owner = await repository.consumeMagicToken(tokenHash, now);
    expect(owner).not.toBeNull();
    await expectReportHistoryEvidenceConformance(repository, owner!);
  });
});
