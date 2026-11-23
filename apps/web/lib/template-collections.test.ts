import {
  PresentationContentSchema,
  StarterGuideSchema,
  StarterIdSchema,
  supportedLocales,
  type SupportedLocale,
} from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { instantiatePresentationTemplate, presentationTemplates } from "./presentation-templates";
import { loadPresentationTemplateLocale } from "./presentation-template-locales";
import {
  collectionTemplateIds,
  parseTemplateCollection,
  teamMeetingTemplateIds,
  templateCollectionGuide,
  templateCollectionGuideKeys,
  templateCollectionIds,
  templateCollectionMemberships,
  templateCollectionPresentationGuides,
  trainingOnboardingTemplateIds,
  type TemplateCollectionKind,
} from "./template-collections";
import { trainingOnboardingPresentationGuides } from "./training-onboarding-guides";

describe("Template collections", () => {
  it("recognizes only exact collection IDs", () => {
    expect(templateCollectionIds).toEqual(["team-meetings", "training-onboarding"]);
    for (const id of templateCollectionIds) expect(parseTemplateCollection(id)).toBe(id);
    for (const value of [
      null,
      undefined,
      "",
      "all",
      "meeting",
      "Team-meetings",
      " team-meetings",
      "team-meetings ",
      "team-meetings,other",
      "Training-onboarding",
      "training-onboarding ",
      "toString",
      "__proto__",
    ])
      expect(parseTemplateCollection(value), String(value)).toBeNull();
  });

  it("contains five existing, unique format-and-ID memberships per collection", () => {
    expect(templateCollectionMemberships).toEqual([
      { collectionId: "team-meetings", kind: "round", templateId: "meeting-priorities" },
      { collectionId: "team-meetings", kind: "round", templateId: "team-retrospective" },
      { collectionId: "team-meetings", kind: "presentation", templateId: "meeting" },
      { collectionId: "team-meetings", kind: "presentation", templateId: "retrospective" },
      { collectionId: "team-meetings", kind: "survey", templateId: "team-collaboration" },
      {
        collectionId: "training-onboarding",
        kind: "round",
        templateId: "new-hire-knowledge-check",
      },
      { collectionId: "training-onboarding", kind: "round", templateId: "feedback-skills" },
      { collectionId: "training-onboarding", kind: "presentation", templateId: "training" },
      { collectionId: "training-onboarding", kind: "presentation", templateId: "onboarding" },
      { collectionId: "training-onboarding", kind: "survey", templateId: "onboarding-experience" },
    ]);
    expect(
      new Set(
        templateCollectionMemberships.map(
          ({ collectionId, kind, templateId }) => `${collectionId}:${kind}:${templateId}`,
        ),
      ).size,
    ).toBe(10);
    for (const { kind, templateId } of templateCollectionMemberships) {
      if (kind === "presentation")
        expect(presentationTemplates.some(({ id }) => id === templateId)).toBe(true);
      else expect(StarterIdSchema.safeParse(templateId).success).toBe(true);
    }
  });

  it("filters each format without changing the all-templates default", () => {
    for (const kind of ["round", "presentation", "survey"] as const) {
      expect(collectionTemplateIds(kind, "team-meetings")).toEqual(teamMeetingTemplateIds[kind]);
      expect(collectionTemplateIds(kind, "training-onboarding")).toEqual(
        trainingOnboardingTemplateIds[kind],
      );
      expect(collectionTemplateIds(kind, null)).toBeUndefined();
      expect(collectionTemplateIds(kind, undefined)).toBeUndefined();
      expect(collectionTemplateIds(kind, parseTemplateCollection("unknown"))).toBeUndefined();
      expect(Object.isFrozen(collectionTemplateIds(kind, "team-meetings"))).toBe(true);
      expect(Object.isFrozen(collectionTemplateIds(kind, "training-onboarding"))).toBe(true);
    }
  });

  it.each(supportedLocales)("provides complete authored Presentation guides in %s", (locale) => {
    const raw = templateCollectionPresentationGuides[locale];
    expect(Object.keys(raw).sort()).toEqual(["meeting", "retrospective"]);
    for (const id of teamMeetingTemplateIds.presentation) {
      const guide = templateCollectionGuide("presentation", id, locale)!;
      expect(guide).toEqual(raw[id]);
      expect(StarterGuideSchema.safeParse(guide).success).toBe(true);
      expect(Object.keys(guide).sort()).toEqual([...templateCollectionGuideKeys].sort());
      expect(guide.minutes).toBe(id === "meeting" ? 20 : 25);
      const english = templateCollectionPresentationGuides["en-CA"][id];
      for (const key of templateCollectionGuideKeys) {
        if (key === "minutes") continue;
        expect(guide[key].trim(), `${id}:${key}`).not.toBe("");
        expect(guide[key].match(/\{\w+\}/g) ?? [], `${id}:${key}`).toEqual(
          english[key].match(/\{\w+\}/g) ?? [],
        );
        if (locale !== "en-CA") expect(guide[key], `${id}:${key}`).not.toBe(english[key]);
      }
    }
  });

  it("keeps the raw catalog complete without fallback merging", () => {
    expect(Object.keys(templateCollectionPresentationGuides).sort()).toEqual(
      [...supportedLocales].sort(),
    );
    expect(templateCollectionGuideKeys).toEqual([
      "audience",
      "minutes",
      "preparation",
      "facilitation",
      "interpretation",
      "followUp",
    ]);
  });

  it("leaves Round and Survey guide ownership with the existing starter helpers", () => {
    for (const kind of ["round", "survey"] satisfies TemplateCollectionKind[])
      for (const id of [...teamMeetingTemplateIds[kind], ...teamMeetingTemplateIds.presentation])
        expect(templateCollectionGuide(kind, id)).toBeUndefined();
    for (const id of ["", "kickoff", "Meeting", "toString", "__proto__", "meeting-priorities"])
      expect(templateCollectionGuide("presentation", id)).toBeUndefined();
  });

  it("returns independent guides and safely falls back for unsupported locales", () => {
    for (const id of [
      ...teamMeetingTemplateIds.presentation,
      ...trainingOnboardingTemplateIds.presentation,
    ]) {
      const english = templateCollectionGuide("presentation", id, "en-CA")!;
      expect(templateCollectionGuide("presentation", id)).toEqual(english);
      for (const locale of ["unknown", "toString", "__proto__"])
        expect(templateCollectionGuide("presentation", id, locale as SupportedLocale)).toEqual(
          english,
        );
      for (const locale of supportedLocales) {
        const first = templateCollectionGuide("presentation", id, locale)!;
        const second = templateCollectionGuide("presentation", id, locale)!;
        expect(first).not.toBe(second);
        first.preparation = "Changed by a consumer";
        first.minutes = 1;
        expect(templateCollectionGuide("presentation", id, locale)).toEqual(second);
      }
    }
  });

  it("gives concrete planning and follow-up advice without outcome or anonymity promises", () => {
    const meeting = templateCollectionGuide("presentation", "meeting")!;
    expect(meeting.audience).toContain("3–12 colleagues with a real decision");
    expect(meeting.preparation).toContain("practical options and constraints");
    expect(meeting.facilitation).toContain("decision, owner, deadline and update location");
    expect(meeting.followUp).toContain("within one working day");
    const retrospective = templateCollectionGuide("presentation", "retrospective")!;
    expect(retrospective.audience).toContain("completed work cycle");
    expect(retrospective.facilitation).toContain("facts and observations without assigning blame");
    expect(retrospective.followUp).toContain(
      "experiment, owner, observable signal and review date",
    );
    const source = JSON.stringify(templateCollectionPresentationGuides["en-CA"]);
    expect(source).not.toMatch(
      /anonymous|guarantee|proven|popular|used by|native.reviewed|human.reviewed/i,
    );
  });

  it.each(supportedLocales)(
    "instantiates the existing unscored Presentation activities with a neutral retrospective choice in %s",
    async (locale) => {
      await loadPresentationTemplateLocale(locale);
      for (const id of teamMeetingTemplateIds.presentation) {
        const draft = instantiatePresentationTemplate(id, locale);
        expect(PresentationContentSchema.safeParse(draft).success).toBe(true);
        expect(draft.blocks).toHaveLength(id === "meeting" ? 5 : 6);
        const activities = draft.blocks.filter((block) => block.kind === "question");
        expect(activities).toHaveLength(id === "meeting" ? 2 : 3);
        for (const { question } of activities) {
          expect(["poll", "rating"]).toContain(question.type);
          expect(question.purpose).toBe("opinion");
          expect(question.basePoints).toBe(0);
          expect(question.linkedRecheckQuestionId).toBeNull();
          if ("choices" in question)
            expect(question.choices.every((choice) => !choice.isCorrect)).toBe(true);
        }
        if (id !== "retrospective") continue;
        const friction = activities[1]!.question;
        expect(friction.type).toBe("poll");
        if (friction.type !== "poll") throw new Error("Expected the existing friction poll");
        const neutralChoices: Record<SupportedLocale, string> = {
          "en-CA": "Nothing to raise",
          "fr-FR": "Rien à signaler",
          "de-DE": "Nichts anzusprechen",
          "es-ES": "Nada que plantear",
          "it-IT": "Nulla da segnalare",
          "pt-PT": "Nada a assinalar",
          "ja-JP": "特になし",
          "ko-KR": "제기할 사항 없음",
          "zh-CN": "没有需要提出的问题",
          "zh-TW": "沒有需要提出的問題",
        };
        expect(friction.choices).toHaveLength(4);
        expect(friction.choices[3]!.label).toBe(neutralChoices[locale]);
      }
    },
  );
});

describe("Training and onboarding collection", () => {
  it.each(supportedLocales)("provides original Presentation guides in %s", (locale) => {
    const raw = trainingOnboardingPresentationGuides[locale];
    expect(Object.keys(raw).sort()).toEqual(["onboarding", "training"]);
    for (const id of trainingOnboardingTemplateIds.presentation) {
      const guide = templateCollectionGuide("presentation", id, locale)!;
      expect(guide).toEqual(raw[id]);
      expect(StarterGuideSchema.parse(guide)).toEqual(guide);
      expect(guide.minutes).toBe(id === "training" ? 15 : 20);
      if (locale === "en-CA") continue;
      for (const key of templateCollectionGuideKeys) {
        if (key !== "minutes")
          expect(guide[key]).not.toBe(trainingOnboardingPresentationGuides["en-CA"][id][key]);
      }
    }
  });

  it.each(supportedLocales)(
    "preserves the Training answer keys and unscored onboarding activities in %s",
    async (locale) => {
      await loadPresentationTemplateLocale(locale);
      const training = instantiatePresentationTemplate("training", locale);
      const onboarding = instantiatePresentationTemplate("onboarding", locale);
      expect(training.blocks).toHaveLength(6);
      expect(onboarding.blocks).toHaveLength(5);
      const checks = training.blocks.filter((block) => block.kind === "question");
      expect(checks.map(({ question }) => question.type)).toEqual([
        "single_select",
        "single_select",
        "rating",
      ]);
      expect(checks[0]!.question.linkedRecheckQuestionId).toBe(checks[1]!.question.id);
      for (const { question } of checks.slice(0, 2)) {
        if (question.type !== "single_select") throw new Error("Expected a scored knowledge check");
        expect(question.choices.map(({ isCorrect }) => isCorrect)).toEqual([false, true, false]);
        expect(question.explanation?.trim()).toBeTruthy();
      }
      const feedback = [
        checks[2]!,
        ...onboarding.blocks.filter((block) => block.kind === "question"),
      ].map(({ question }) => question);
      expect(feedback.map(({ type }) => type)).toEqual(["rating", "poll", "rating"]);
      for (const question of feedback) {
        expect(question.purpose).toBe("opinion");
        expect(question.basePoints).toBe(0);
      }
    },
  );
});
