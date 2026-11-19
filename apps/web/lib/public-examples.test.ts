import { describe, expect, it } from "vitest";
import { LocalReturnPathSchema } from "@openround/contracts";
import {
  filterPublicExamples,
  findPublicExample,
  publicExampleContinueHref,
  publicExampleDestination,
  publicExamples,
  publicTemplateContext,
} from "./public-examples";
import { meetingStarter, meetingStarterGuide } from "../../server/src/starter-meeting-collection";
import { presentationTemplates } from "./presentation-templates";
import { CANVAS_TEMPLATES } from "@openround/contracts";

describe("public original examples", () => {
  it("keeps the public meeting previews aligned with authored originals", () => {
    for (const id of ["meeting-priorities", "team-retrospective", "team-collaboration"] as const) {
      const source = meetingStarter(id, "en-CA")!;
      const example = publicExamples.find((value) => value.sourceId === id)!;
      expect(example.title).toBe(source.title);
      expect(example.preview.map((block) => block.title)).toEqual(
        source.questions.map((question) => question.prompt),
      );
      expect(example.guide).toEqual(meetingStarterGuide(id, "en-CA", example.kind === "survey"));
      source.questions.forEach((question, index) => {
        if (question.type === "poll")
          expect(example.preview[index]!.options).toEqual(
            question.choices.map((choice) => choice.label),
          );
      });
    }
  });

  it("uses full original presentation structure and board instructions", () => {
    for (const id of ["meeting", "retrospective"]) {
      const source = presentationTemplates.find((value) => value.id === id)!;
      const example = publicExamples.find((value) => value.sourceId === id)!;
      expect(example.preview.map((block) => block.title)).toEqual(
        source.blocks.map((block) => (block.kind === "content" ? block.title : block.prompt)),
      );
    }
    for (const source of CANVAS_TEMPLATES.filter((value) =>
      ["possibility-map", "learning-reflection"].includes(value.id),
    )) {
      const example = publicExamples.find((value) => value.sourceId === source.id)!;
      expect(
        example.preview.map((block) => ({
          title: block.title,
          body: block.body,
          options: block.options,
        })),
      ).toEqual(
        source.sections.map((section) => ({
          title: section.title,
          body: section.guidance,
          options: [...section.prompts],
        })),
      );
    }
  });

  it("combines search, format and use-case filters across the complete public collection", () => {
    expect(
      filterPublicExamples({ kind: "round", useCase: "meetings" }).map((value) => value.id),
    ).toEqual(["meeting-priorities", "team-retrospective"]);
    expect(
      filterPublicExamples({ search: "  NEXT   cycle ", kind: "presentation" }).map(
        (value) => value.id,
      ),
    ).toEqual(["retrospective-presentation"]);
    expect(
      filterPublicExamples({ useCase: "events", kind: "survey" }).map((value) => value.sourceId),
    ).toEqual(["event-feedback"]);
    expect(filterPublicExamples({ search: "not-a-real-template" })).toEqual([]);
    expect(findPublicExample("unknown")).toBeUndefined();
  });

  it("retains the exact template context through safe sign-in return paths", () => {
    for (const example of publicExamples) {
      const continuation = new URL(publicExampleContinueHref(example), "https://polling.example");
      expect(continuation.pathname).toBe("/signin");
      const path = continuation.searchParams.get("returnTo");
      expect(LocalReturnPathSchema.safeParse(path).success).toBe(true);
      expect(path).toBe(publicExampleDestination(example));
      const target = new URL(path!, "https://polling.example");
      if (example.kind === "board") {
        expect(target.pathname).toBe("/boards");
        expect(target.searchParams.get("create")).toBe("1");
      } else {
        expect(target.pathname).toBe("/templates");
        expect(
          publicTemplateContext(
            target.searchParams.get("sourceId"),
            target.searchParams.get("type")!,
          ),
        ).toBe(example);
      }
    }
    expect(publicTemplateContext("meeting-priorities", "surveys")).toBeUndefined();
    expect(publicTemplateContext("unknown", "rounds")).toBeUndefined();
    expect(publicTemplateContext("possibility-map", "board")).toBeUndefined();
  });
});
