import { describe, it } from "vitest";
import { MemoryRepository } from "../src/index.js";
import {
  expectPresentationCreationRecovery,
  expectPresentationCreationAuthority,
  expectPresentationCreationDeletion,
} from "./support/presentation-creation-conformance.js";
describe("Presentation creation persistence", () => {
  it("deduplicates concurrent intent and returns the current edited publication without charging allowance", async () => {
    await expectPresentationCreationRecovery(new MemoryRepository());
  });
  it("binds account/workspace and current editor authority before creation or recovery", async () => {
    await expectPresentationCreationAuthority(new MemoryRepository());
  });
  it("retains compact creation identity after target deletion", async () => {
    await expectPresentationCreationDeletion(new MemoryRepository());
  });
});
