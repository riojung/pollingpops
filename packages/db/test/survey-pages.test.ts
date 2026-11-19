import { describe, it } from "vitest";
import { MemoryRepository } from "../src/index.js";
import {
  expectSurveyPagesAudience,
  expectSurveyPagesWriterBoundary,
} from "./support/survey-pages-conformance.js";

describe("Survey page reader foundation in memory", () => {
  it("preserves frozen v3 content and exact receipts while fencing fresh writers and downgrades", () =>
    expectSurveyPagesWriterBoundary(new MemoryRepository()));
  it("negotiates readers before admission and receipt replay without changing aggregate privacy or deletion", () =>
    expectSurveyPagesAudience(new MemoryRepository()));
});
