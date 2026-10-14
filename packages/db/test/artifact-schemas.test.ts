import { describe, expect, it } from "vitest";
import {
  createPresentationRepository,
  MemoryPresentationRepository,
  MemoryRepository,
  UnsupportedArtifactSchemaVersionError,
  upcastPresentationContent,
  upcastPresentationDraft,
  upcastRoundContent,
  upcastRoundDraft,
} from "../src/index.js";

const questionId = "00000000-0000-4000-8000-000000000001";
const choiceAId = "00000000-0000-4000-8000-000000000002";
const choiceBId = "00000000-0000-4000-8000-000000000003";
const blockId = "00000000-0000-4000-8000-000000000004";

function validQuestion() {
  return {
    id: questionId,
    type: "single_select" as const,
    prompt: "Which response is correct?",
    timeLimitSeconds: 30,
    basePoints: 1_000,
    explanation: "The first response is correct.",
    mediaId: null,
    mediaAlt: null,
    choices: [
      { id: choiceAId, label: "First", isCorrect: true },
      { id: choiceBId, label: "Second", isCorrect: false },
    ],
  };
}

describe("persisted artifact schema upcasters", () => {
  it("normalizes v1 Round and Presentation draft defaults", () => {
    expect(upcastRoundDraft({ title: "Round", questions: [] }, 1)).toEqual({
      title: "Round",
      description: "",
      category: "general",
      experiencePreset: { id: "focus", version: 1 },
      questions: [],
    });

    expect(upcastPresentationDraft({ title: "Deck", blocks: [] }, 1)).toEqual({
      title: "Deck",
      description: "",
      experiencePreset: { id: "focus", version: 1 },
      schemaVersion: 2,
      blocks: [],
    });
  });

  it("upcasts legacy Presentation title/body fields deterministically", () => {
    const legacySlideId = "00000000-0000-4000-8000-000000000099";
    const legacy = {
      title: "Deck",
      description: "",
      schemaVersion: 1,
      blocks: [
        {
          id: legacySlideId,
          kind: "content",
          layout: "quote",
          title: "A quote",
          body: "A response",
          mediaId: "00000000-0000-4000-8000-000000000098",
          mediaAlt: "A helpful image",
          speakerNotes: "Facilitator note",
          citations: [{ locator: "Page 4", excerpt: "Source excerpt" }],
        },
      ],
    };
    const first = upcastPresentationDraft(legacy, 1);
    const second = upcastPresentationDraft(legacy, 1);
    expect(first).toEqual(second);
    expect(first.blocks[0]).toMatchObject({
      id: legacySlideId,
      layout: "quote",
      textElements: [
        {
          id: `${legacySlideId}:title`,
          role: "title",
          text: "A quote",
          region: "middle_center",
        },
        {
          id: `${legacySlideId}:body`,
          role: "body",
          text: "A response",
          region: "bottom_center",
        },
      ],
      mediaId: "00000000-0000-4000-8000-000000000098",
      mediaAlt: "A helpful image",
      speakerNotes: "Facilitator note",
      citations: [{ locator: "Page 4", excerpt: "Source excerpt" }],
    });
  });

  it("strictly parses v1 immutable published content", () => {
    const question = validQuestion();
    expect(
      upcastRoundContent({ title: "Published Round", questions: [question] }, 1),
    ).toMatchObject({
      title: "Published Round",
      category: "general",
      questions: [{ id: questionId }],
    });
    expect(
      upcastPresentationContent(
        {
          title: "Published deck",
          blocks: [{ id: blockId, kind: "question", question }],
        },
        1,
      ),
    ).toMatchObject({
      title: "Published deck",
      schemaVersion: 2,
      blocks: [{ id: blockId, kind: "question" }],
    });
    expect(() => upcastRoundContent({ title: "Incomplete", questions: [] }, 1)).toThrow();
  });

  it("upcasts stored v1 drafts, history, and published versions when read", async () => {
    const workspaceId = "00000000-0000-4000-8000-000000000021";
    const presentationId = "00000000-0000-4000-8000-000000000022";
    const versionId = "00000000-0000-4000-8000-000000000023";
    const legacySlide = {
      id: blockId,
      kind: "content",
      layout: "quote",
      title: "A source-backed quote",
      body: "A sentence to discuss",
      mediaId: "00000000-0000-4000-8000-000000000024",
      mediaAlt: "A page excerpt",
      speakerNotes: "Ask what the sentence implies.",
      citations: [{ locator: "Page 4", excerpt: "Source excerpt" }],
    };
    const legacyDraft = {
      title: "Legacy deck",
      description: "",
      experiencePreset: { id: "focus", version: 1 },
      schemaVersion: 1,
      blocks: [legacySlide],
    };
    const legacyContent = {
      ...legacyDraft,
      blocks: [legacySlide, { id: questionId, kind: "question", question: validQuestion() }],
    };
    const repository = new MemoryPresentationRepository();
    const now = new Date("2026-09-20T12:00:00.000Z");
    repository.presentations.set(presentationId, {
      id: presentationId,
      workspaceId,
      title: "Legacy deck",
      description: "",
      status: "published",
      draft: legacyDraft as never,
      draftRevision: 1,
      draftSchemaVersion: 1,
      currentVersionId: versionId,
      folderId: null,
      publishedDraftRevision: 1,
      lastEditedBy: null,
      createdAt: now,
      updatedAt: now,
    });
    repository.history.set(`${presentationId}:1`, {
      id: "00000000-0000-4000-8000-000000000025",
      workspaceId,
      presentationId,
      revision: 1,
      draft: legacyDraft as never,
      draftSchemaVersion: 1,
      savedBy: null,
      mutationId: null,
      createdAt: now,
    });
    repository.versions.set(versionId, {
      id: versionId,
      workspaceId,
      presentationId,
      version: 1,
      content: legacyContent as never,
      contentSchemaVersion: 1,
      contentHash: "legacy-content-hash",
      sourceDraftRevision: 1,
      publishedAt: now,
    });

    const presentations = repository;
    const expectedText = expect.arrayContaining([
      expect.objectContaining({
        id: `${blockId}:title`,
        role: "title",
        text: "A source-backed quote",
        region: "middle_center",
      }),
      expect.objectContaining({
        id: `${blockId}:body`,
        role: "body",
        text: "A sentence to discuss",
        region: "bottom_center",
      }),
    ]);
    await expect(presentations.getPresentation(workspaceId, presentationId)).resolves.toMatchObject(
      {
        draft: {
          schemaVersion: 2,
          blocks: [{ textElements: expectedText, speakerNotes: legacySlide.speakerNotes }],
        },
      },
    );
    await expect(
      presentations.listPresentationHistory(workspaceId, presentationId),
    ).resolves.toMatchObject([
      { draft: { schemaVersion: 2, blocks: [{ textElements: expectedText }] } },
    ]);
    await expect(
      presentations.getPresentationVersion(workspaceId, versionId),
    ).resolves.toMatchObject({
      content: {
        schemaVersion: 2,
        blocks: [
          {
            textElements: expectedText,
            citations: legacySlide.citations,
            mediaId: legacySlide.mediaId,
          },
          { id: questionId, kind: "question" },
        ],
      },
    });
  });

  it.each([
    ["Round draft", () => upcastRoundDraft({}, 5)],
    ["Round content", () => upcastRoundContent({}, 5)],
    ["Presentation draft", () => upcastPresentationDraft({}, 4)],
    ["Presentation content", () => upcastPresentationContent({}, 4)],
  ])("rejects an unknown schema version for %s", (label, parse) => {
    expect(parse).toThrow(UnsupportedArtifactSchemaVersionError);
    try {
      parse();
    } catch (error) {
      expect(error).toMatchObject({
        code: "UNSUPPORTED_ARTIFACT_SCHEMA_VERSION",
        schemaVersion: label.startsWith("Round") ? 5 : 4,
        supportedVersions: label.startsWith("Round") ? [1, 2, 3, 4] : [1, 2, 3],
      });
    }
  });

  it("enforces schema versions at Memory repository write and recovery boundaries", async () => {
    const repository = new MemoryRepository();
    const workspaceId = "00000000-0000-4000-8000-000000000010";
    const quizId = "00000000-0000-4000-8000-000000000011";
    const now = new Date("2026-09-20T12:00:00.000Z");
    const draft = { title: "Round", description: "", questions: [] };

    await expect(
      repository.createQuiz({
        id: quizId,
        workspaceId,
        title: draft.title,
        description: "",
        status: "draft",
        draft,
        draftSchemaVersion: 5,
        currentVersionId: null,
        createdAt: now,
        updatedAt: now,
      }),
    ).rejects.toBeInstanceOf(UnsupportedArtifactSchemaVersionError);

    await repository.createQuiz({
      id: quizId,
      workspaceId,
      title: draft.title,
      description: "",
      status: "draft",
      draft,
      currentVersionId: null,
      createdAt: now,
      updatedAt: now,
    });
    repository.quizDraftHistory.set(`${quizId}:99`, {
      id: "00000000-0000-4000-8000-000000000012",
      workspaceId,
      quizId,
      revision: 99,
      draft,
      draftSchemaVersion: 5,
      savedBy: null,
      mutationId: null,
      createdAt: now,
    });
    await expect(repository.listQuizDraftHistory(workspaceId, quizId)).rejects.toBeInstanceOf(
      UnsupportedArtifactSchemaVersionError,
    );

    const presentations = createPresentationRepository(repository);
    const presentationId = "00000000-0000-4000-8000-000000000013";
    const presentationDraft = upcastPresentationDraft({ title: "Deck", blocks: [] }, 1);
    await presentations.createPresentation({
      id: presentationId,
      workspaceId,
      title: presentationDraft.title,
      description: presentationDraft.description,
      status: "draft",
      draft: presentationDraft,
      draftRevision: 0,
      draftSchemaVersion: 2,
      currentVersionId: null,
      folderId: null,
      publishedDraftRevision: null,
      lastEditedBy: null,
      createdAt: now,
      updatedAt: now,
    });
    const question = validQuestion();
    await expect(
      presentations.publishPresentation(
        {
          id: "00000000-0000-4000-8000-000000000014",
          workspaceId,
          presentationId,
          version: 1,
          content: upcastPresentationContent(
            {
              title: "Deck",
              blocks: [{ id: blockId, kind: "question", question }],
            },
            1,
          ),
          contentSchemaVersion: 4,
          contentHash: "unknown-version",
          sourceDraftRevision: 0,
          publishedAt: now,
        },
        0,
      ),
    ).rejects.toBeInstanceOf(UnsupportedArtifactSchemaVersionError);
  });
});
