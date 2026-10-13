import { randomUUID } from "node:crypto";
import { describe, it } from "vitest";
import { MemoryRepository } from "../src/index.js";
import { expectFolderConformance } from "./support/folder-conformance.js";

async function owner(repository: MemoryRepository) {
  const tokenHash = randomUUID();
  await repository.createMagicToken({
    id: randomUUID(),
    email: `${randomUUID()}@example.com`,
    segment: "workplace",
    tokenHash,
    policyVersion: "test",
    expiresAt: new Date(Date.now() + 60000),
    consumedAt: null,
  });
  return (await repository.consumeMagicToken(tokenHash, new Date()))!;
}
describe("scoped nested folders", () => {
  it("conforms for type/workspace isolation, moves, order, promotion and concurrent cycle prevention", async () => {
    const repository = new MemoryRepository();
    await expectFolderConformance(repository, await owner(repository), await owner(repository));
  });
});
