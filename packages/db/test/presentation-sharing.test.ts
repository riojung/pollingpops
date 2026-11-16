import { describe, expect, it } from "vitest";
import { MemoryRepository, createPresentationShareRepository } from "../src/index.js";
import {
  expectPresentationSharingConformance,
  presentationSharingFixture,
  expectPresentationShareExpiryConformance,
} from "./support/presentation-sharing-conformance.js";
describe("private Presentation sharing", () => {
  it("classifies only unaccepted expired intents while replaying an accepted receipt before expiry checks", async () => {
    await expectPresentationShareExpiryConformance(new MemoryRepository());
  });
  it("pins immutable content and preserves receipts, revocation, tenant isolation and concurrent caps", async () => {
    await expectPresentationSharingConformance(new MemoryRepository());
  });
  it("revalidates publisher roles and deletes links with the source without exporting secrets", async () => {
    const repository = new MemoryRepository(),
      f = await presentationSharingFixture(repository),
      input = f.request(),
      { share } = await f.shares.createShare(input);
    const exported = await repository.exportAccount(f.actor.userId);
    expect(JSON.stringify(exported.presentationShares)).not.toMatch(/tokenHash|intentHash/);
    const actor = repository.users.get(f.actor.userId)!;
    actor.role = "viewer";
    expect(await f.shares.getPublicShare(share.id, input.tokenHash, f.now)).toBeNull();
    await expect(
      f.shares.revokeShare(f.actor.workspaceId, f.presentation.id, share.id, f.actor.userId, f.now),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
    actor.role = "owner";
    await f.presentations.archivePresentation(f.actor.workspaceId, f.presentation.id, true);
    expect(await f.presentations.deletePresentation(f.actor.workspaceId, f.presentation.id)).toBe(
      "deleted",
    );
    expect(await f.shares.getPublicShare(share.id, input.tokenHash, f.now)).toBeNull();
    expect(
      await createPresentationShareRepository(repository).listShares(
        f.actor.workspaceId,
        f.presentation.id,
        f.actor.userId,
      ),
    ).toEqual([]);
  });
  it("bounds retained metadata and never mints a fresh link from an expired pruned intent", async () => {
    const repository = new MemoryRepository(),
      f = await presentationSharingFixture(repository),
      old = f.request();
    await f.shares.createShare(old);
    for (let i = 1; i < 100; i++) {
      const { share } = await f.shares.createShare(f.request());
      await f.shares.revokeShare(
        f.actor.workspaceId,
        f.presentation.id,
        share.id,
        f.actor.userId,
        f.now,
      );
    }
    await expect(f.shares.createShare(f.request())).rejects.toMatchObject({ code: "LINK_LIMIT" });
    const later = new Date(f.now.getTime() + 15 * 86_400_000);
    await repository.purgeExpired(later);
    await expect(f.shares.createShare({ ...old, now: later })).rejects.toMatchObject({
      code: "REQUEST_EXPIRED",
    });
    expect(
      await f.shares.listShares(f.actor.workspaceId, f.presentation.id, f.actor.userId),
    ).toEqual([]);
  });
});
