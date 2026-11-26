import { describe, it } from "vitest";
import { MemoryRepository } from "../src/index.js";
import { expectPresentationResultsHistoryConformance } from "./support/presentation-results-history-conformance.js";

describe("Presentation results history in memory", () => {
  it("paginates and aggregates retained Presentation sessions by workspace", async () => {
    await expectPresentationResultsHistoryConformance(new MemoryRepository());
  });
});
