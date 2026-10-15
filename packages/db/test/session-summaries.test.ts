import { randomUUID } from "node:crypto";
import { describe, it } from "vitest";
import { MemoryRepository } from "../src/index.js";
import {
  expectSessionSummaryAccountLifecycle,
  expectSessionSummaryConformance,
  expectSessionSummaryRetention,
  expectSurveySummaryCompletionFence,
  expectSessionSummaryShareManagement,
} from "./support/session-summary-conformance.js";

async function fixture() {
  const repository = new MemoryRepository();
  const users = [];
  for (let index = 0; index < 3; index++) {
    const tokenHash = randomUUID();
    await repository.createMagicToken({
      id: randomUUID(),
      email: `summary-${randomUUID()}@example.com`,
      segment: "workplace",
      tokenHash,
      policyVersion: "test",
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    });
    users.push((await repository.consumeMagicToken(tokenHash, new Date()))!);
  }
  return { repository, owner: users[0]!, member: users[1]!, outsider: users[2]! };
}

describe("aggregate session summary storage", () => {
  it("keeps older active capabilities manageable ahead of revoked and expired history", async () => {
    const { repository, owner } = await fixture();
    await expectSessionSummaryShareManagement(repository, owner);
  });
  it("conforms for all completed sources, immutable snapshots, capability authorization and deletion", async () => {
    const { repository, owner, member, outsider } = await fixture();
    await expectSessionSummaryConformance(repository, owner, member, outsider);
  });
  it("removes departing publishers' capabilities and cascades owner deletion", async () => {
    const { repository, owner, member } = await fixture();
    await expectSessionSummaryAccountLifecycle(repository, owner, member);
  });
  it("denies expiry before purge and removes every source's retained capabilities", async () => {
    const { repository, owner } = await fixture();
    await expectSessionSummaryRetention(repository, owner);
  });
  it("stabilizes Survey completion timestamps and fences stale submissions after final aggregates", async () => {
    const { repository, owner } = await fixture();
    await expectSurveySummaryCompletionFence(repository, owner);
  });
});
