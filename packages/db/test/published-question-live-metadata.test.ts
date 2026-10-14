import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { QuizDraft } from "@openround/contracts";
import {
  MemoryRepository,
  publishedQuestionTextOnlyLiveEligible,
  upcastPresentationSessionContent,
  assertRoundContentSchemaVersion,
} from "../src/index.js";
import {
  expectPublishedQuestionLiveMetadataConformance,
  expectPublishedQuestionLiveMetadataSchemaConformance,
  publishedQuestionFixture,
} from "./support/published-question-live-metadata-conformance.js";

describe("published question live metadata", () => {
  it("does not guess an unsupported published content schema for metadata reads", async () => {
    expect(() => assertRoundContentSchemaVersion(undefined)).not.toThrow();
    expect(() => assertRoundContentSchemaVersion(1)).not.toThrow();
    expect(() => assertRoundContentSchemaVersion(2)).not.toThrow();
    expect(() => assertRoundContentSchemaVersion(3)).not.toThrow();
    expect(() => assertRoundContentSchemaVersion(4)).not.toThrow();
    for (const version of [0, 5, 99, "1", 1.5]) {
      expect(() => assertRoundContentSchemaVersion(version)).toThrow(
        "Unsupported round content schema version",
      );
    }
    const repository = new MemoryRepository();
    const workspaceId = randomUUID();
    const now = new Date();
    const content = {
      title: "Future stored schema",
      description: "",
      questions: [publishedQuestionFixture()],
    };
    const quiz = await repository.createQuiz({
      id: randomUUID(),
      workspaceId,
      title: content.title,
      description: "",
      status: "draft",
      draft: content,
      currentVersionId: null,
      createdAt: now,
      updatedAt: now,
    });
    const version = await repository.publishQuiz({
      id: randomUUID(),
      workspaceId,
      quizId: quiz.id,
      version: 1,
      content,
      contentHash: "a".repeat(64),
      publishedAt: now,
    });
    repository.versions.get(version.id)!.contentSchemaVersion = 99;
    await expect(repository.listPublishedQuizQuestionMetadata(workspaceId)).rejects.toThrow(
      "Unsupported round content schema version",
    );
  });
  it("keeps the memory repository on the shared bounded catalog contract", async () => {
    await expectPublishedQuestionLiveMetadataConformance({
      repository: new MemoryRepository(),
      workspaceId: randomUUID(),
      otherWorkspaceId: randomUUID(),
    });
  });
  it("validates every eligible current schema before filtering the memory catalog", async () => {
    const repository = new MemoryRepository();
    await expectPublishedQuestionLiveMetadataSchemaConformance({
      repository,
      workspaceId: randomUUID(),
      otherWorkspaceId: randomUUID(),
      storeUnsupportedVersion: async ({ version, content, makeCurrent }) => {
        const futureVersionId = randomUUID();
        repository.versions.set(futureVersionId, {
          ...version,
          id: futureVersionId,
          version: version.version + 1,
          contentSchemaVersion: 99,
          content: structuredClone(content) as QuizDraft,
        });
        if (makeCurrent) repository.quizzes.get(version.quizId)!.currentVersionId = futureVersionId;
        return futureVersionId;
      },
    });
  });
  it("rejects media, Pack roles, both sides of a linked flow, and invalid published items", () => {
    const question = publishedQuestionFixture();
    expect(publishedQuestionTextOnlyLiveEligible(question)).toBe(true);
    for (const invalid of [
      { ...question, prompt: "" },
      { ...question, mediaId: randomUUID(), mediaAlt: "Synthetic media" },
      { ...question, delivery: "recheck" as const },
      { ...question, linkedRecheckQuestionId: randomUUID() },
      {
        ...question,
        recoveryPackSource: {
          artifactType: "recovery_pack" as const,
          packId: randomUUID(),
          packVersionId: randomUUID(),
          packVersion: 1,
          sourceItemId: randomUUID(),
          role: "diagnostic" as const,
          contentHash: "a".repeat(64),
        },
      },
    ])
      expect(publishedQuestionTextOnlyLiveEligible(invalid)).toBe(false);
    expect(
      publishedQuestionTextOnlyLiveEligible(question, [
        { ...publishedQuestionFixture(), linkedRecheckQuestionId: question.id },
        question,
      ]),
    ).toBe(false);
  });
  it("retains and validates live provenance on snapshot restore while preserving legacy drafts", () => {
    const selection = {
      sourceQuizId: randomUUID(),
      sourceQuizVersionId: randomUUID(),
      sourceQuizVersion: 1,
      sourceQuestionId: randomUUID(),
      contentHash: "a".repeat(64),
      commandId: randomUUID(),
      blockId: randomUUID(),
    };
    const content = {
      title: "Snapshot",
      description: "",
      schemaVersion: 2,
      blocks: [
        {
          id: selection.blockId,
          kind: "question",
          provenance: {
            sourceQuizVersionId: selection.sourceQuizVersionId,
            sourceQuestionId: selection.sourceQuestionId,
          },
          question: publishedQuestionFixture(),
        },
      ],
      livePublishedQuestions: [selection],
    };
    expect(upcastPresentationSessionContent(content).livePublishedQuestions).toEqual([selection]);
    expect(() =>
      upcastPresentationSessionContent({
        ...content,
        livePublishedQuestions: [{ ...selection, blockId: randomUUID() }],
      }),
    ).toThrow();
    expect(
      upcastPresentationSessionContent({ title: "", description: "", schemaVersion: 2, blocks: [] })
        .blocks,
    ).toEqual([]);
  });
});
