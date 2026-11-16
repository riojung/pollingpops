import { expectPresentationOpinionCountsConformance } from "./support/presentation-insights-conformance.js";
import { describe, it } from "vitest";
import {
  MemoryRepository,
  createPresentationSessionRepository,
  type PresentationSessionTimelineRecord,
} from "../src/index.js";
import {
  expectPresentationQnaCountsConformance,
  expectPresentationRevealCountsConformance,
} from "./support/presentation-insights-conformance.js";
describe("Presentation session insights counts", () => {
  it("keeps Q&A counts public, current, scoped and read-only", async () => {
    await expectPresentationQnaCountsConformance(new MemoryRepository());
  });
  it("distinguishes missing legacy rosters, empty rosters and distinct canonical members", async () => {
    const repository = new MemoryRepository(),
      sessions = createPresentationSessionRepository(repository);
    await expectPresentationRevealCountsConformance(repository, async (events) => {
      const timeline = (
        sessions as unknown as { timeline: Map<string, PresentationSessionTimelineRecord> }
      ).timeline;
      for (const event of events) timeline.set(event.id, event);
    });
  });
  it("aggregates ordinary poll and rating buckets with frozen bindings and no private rows", async () => {
    await expectPresentationOpinionCountsConformance(new MemoryRepository());
  });
});
