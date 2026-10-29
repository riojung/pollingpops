import { describe, expect, it } from "vitest";
import { PresentationContentSchema } from "@openround/contracts";
import { instantiatePresentationTemplate, presentationTemplates } from "./presentation-templates";
import { presentationReadiness } from "./presentation-builder";

describe("original presentation templates", () => {
  it("creates nine complete presentations with substantive slides, questions, and speaker notes", () => {
    expect(presentationTemplates).toHaveLength(9);
    for (const template of presentationTemplates) {
      const draft = instantiatePresentationTemplate(template.id);
      const content = PresentationContentSchema.safeParse(draft);
      expect(content.success, `${template.id}: ${JSON.stringify(content.error?.issues)}`).toBe(
        true,
      );
      expect(presentationReadiness(draft), template.id).toEqual([]);
      expect(draft.blocks.length).toBeGreaterThanOrEqual(5);
      expect(draft.blocks.some((block) => block.kind === "question")).toBe(true);
      const slides = draft.blocks.filter((block) => block.kind === "content");
      expect(slides.length).toBeGreaterThanOrEqual(3);
      for (const slide of slides) {
        expect(slide.speakerNotes.length).toBeGreaterThan(20);
        expect(slide.textElements.every((element) => element.text.trim().length > 0)).toBe(true);
      }
      expect(JSON.stringify(draft)).not.toMatch(/Option one|Option two|Replace this|Replace with/i);
    }
  });

  it("gives copies independent block, text, and question IDs and correctly remaps the training recheck", () => {
    const first = instantiatePresentationTemplate("training");
    const second = instantiatePresentationTemplate("training");
    const ids = (draft: typeof first) =>
      draft.blocks.flatMap((block) =>
        block.kind === "content"
          ? [block.id, ...block.textElements.map((element) => element.id)]
          : [
              block.id,
              block.question.id,
              ...("choices" in block.question
                ? block.question.choices.map((choice) => choice.id)
                : []),
            ],
      );
    expect(ids(first).some((id) => ids(second).includes(id))).toBe(false);
    const questions = first.blocks.filter((block) => block.kind === "question");
    expect(questions[0]!.question.linkedRecheckQuestionId).toBe(questions[1]!.question.id);
    expect(questions[1]!.question.delivery).toBe("recheck");
  });
});
