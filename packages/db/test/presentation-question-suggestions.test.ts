import { describe, it } from "vitest";
import { MemoryRepository } from "../src/index.js";
import {
  expectQuestionSuggestionsLifecycle,
  expectQuestionSuggestionsRevocation,
  expectQuestionSuggestionsConformance,
  expectQuestionSuggestionsCapacity,
  expectQuestionSuggestionsSourceFence,
  expectQuestionSuggestionsInsertionFence,
} from "./support/presentation-question-suggestions-conformance.js";
describe("Presentation question suggestions memory", () => {
  it("preserves source, exact admissions, normal opinion insertion and historical accepted receipts", async () => {
    await expectQuestionSuggestionsConformance(new MemoryRepository());
  });
  it("shares monthly usage and the two-active cap across all three presentation queues", async () => {
    await expectQuestionSuggestionsCapacity(new MemoryRepository());
  });
  it("binds exact wording, languages, paragraph kind and semantic order even after revision rebase", async () => {
    await expectQuestionSuggestionsSourceFence(new MemoryRepository());
  });
  it("rejects unreviewed prompt/suggestion substitutions and expired new insertions", async () => {
    await expectQuestionSuggestionsInsertionFence(new MemoryRepository());
  });
  it("fences expired claims and the three-attempt budget", async () => {
    await expectQuestionSuggestionsLifecycle(new MemoryRepository());
  });
  it("erases private proposal data after creator revocation/deletion while recovering exact accepted receipts", async () => {
    await expectQuestionSuggestionsRevocation(new MemoryRepository());
  });
});
