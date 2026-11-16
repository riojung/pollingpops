import { createHash, randomUUID } from "node:crypto";
import { expect } from "vitest";
import type { QuizDraft } from "@openround/contracts";
import type { QuizVersionRecord, Repository } from "../../src/index.js";

export function publishedQuestionFixture(prompt = "Synthetic standalone checkpoint") {
  return {
    id: randomUUID(),
    type: "numeric" as const,
    prompt,
    correctValue: "2",
    tolerance: "0",
    unit: null,
    timeLimitSeconds: 30,
    basePoints: 100,
    explanation: "Private synthetic rationale",
    mediaId: null,
    mediaAlt: null,
  };
}

/** Same bounded, safe, published-only catalog contract for memory and forced-RLS PostgreSQL. */
export async function expectPublishedQuestionLiveMetadataConformance(input: {
  repository: Repository;
  workspaceId: string;
  otherWorkspaceId: string;
}) {
  const { repository, workspaceId, otherWorkspaceId } = input;
  async function publish(content: QuizDraft, workspace = workspaceId) {
    const now = new Date();
    const quiz = await repository.createQuiz({
      id: randomUUID(),
      workspaceId: workspace,
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
      workspaceId: workspace,
      quizId: quiz.id,
      version: 1,
      content,
      contentHash: createHash("sha256").update(JSON.stringify(content)).digest("hex"),
      publishedAt: now,
    });
    return { quiz, version };
  }
  const standalone = publishedQuestionFixture("Synthetic literal 100%_ checkpoint");
  const recheck = {
    ...publishedQuestionFixture("Private recheck prompt"),
    delivery: "recheck" as const,
  };
  const diagnostic = {
    ...publishedQuestionFixture("Private linked diagnostic"),
    linkedRecheckQuestionId: recheck.id,
  };
  const first = await publish({
    title: "Immutable published title",
    description: "",
    questions: [standalone, diagnostic, recheck],
  });
  await repository.updateQuiz(
    workspaceId,
    first.quiz.id,
    {
      ...first.version.content,
      title: "Private draft title",
      questions: [publishedQuestionFixture("Private draft prompt")],
    },
    0,
  );
  await publish(
    {
      title: "Other tenant",
      description: "",
      questions: [publishedQuestionFixture("Other tenant prompt")],
    },
    otherWorkspaceId,
  );
  const catalog = await repository.listPublishedQuizQuestionMetadata(workspaceId);
  expect(catalog).toEqual({
    questions: [
      {
        sourceQuizId: first.quiz.id,
        sourceQuizVersionId: first.version.id,
        sourceQuizVersion: 1,
        sourceQuestionId: standalone.id,
        contentHash: first.version.contentHash,
        title: first.version.content.title,
        prompt: standalone.prompt,
        type: standalone.type,
      },
    ],
    hasMore: false,
  });
  expect(JSON.stringify(catalog)).not.toContain("Private");
  expect(await repository.listPublishedQuizQuestionMetadata(otherWorkspaceId)).toMatchObject({
    questions: [{ title: "Other tenant" }],
  });
  expect(await repository.listPublishedQuizQuestionMetadata(randomUUID())).toEqual({
    questions: [],
    hasMore: false,
  });
  expect(await repository.listPublishedQuizQuestionMetadata(workspaceId, "100%_")).toEqual(catalog);
  expect(await repository.listPublishedQuizQuestionMetadata(workspaceId, " IMMUTABLE ")).toEqual(
    catalog,
  );
  expect(await repository.listPublishedQuizQuestionMetadata(workspaceId, "Private draft")).toEqual({
    questions: [],
    hasMore: false,
  });
  // A caller cannot mutate catalog metadata or the retained version through a returned object.
  catalog.questions[0]!.prompt = "Caller mutation";
  expect(
    (await repository.listPublishedQuizQuestionMetadata(workspaceId)).questions[0]!.prompt,
  ).toBe(standalone.prompt);
  const second = await publish({
    title: "Second published Round",
    description: "",
    questions: [publishedQuestionFixture(), publishedQuestionFixture("Second checkpoint")],
  });
  expect(
    await repository.listPublishedQuizQuestionMetadata(workspaceId, "Second published", 1),
  ).toMatchObject({ questions: [{ sourceQuizId: second.quiz.id }], hasMore: true });
  expect(
    await repository.listPublishedQuizQuestionMetadata(workspaceId, "Second published", 2),
  ).toMatchObject({ questions: [{}, {}], hasMore: false });
  await repository.archiveQuiz(workspaceId, second.quiz.id, true);
  expect(
    await repository.listPublishedQuizQuestionMetadata(workspaceId, "Second published"),
  ).toEqual({ questions: [], hasMore: false });
  expect(await repository.getQuizVersion(workspaceId, second.version.id)).not.toBeNull();
  for (const limit of [0, 101, 1.5, NaN])
    await expect(
      repository.listPublishedQuizQuestionMetadata(workspaceId, "", limit),
    ).rejects.toThrow(RangeError);
  await expect(
    repository.listPublishedQuizQuestionMetadata(workspaceId, "x".repeat(101)),
  ).rejects.toThrow(RangeError);
  const many = await publish({
    title: "Bounded Round",
    description: "",
    questions: Array.from({ length: 101 }, (_, index) =>
      publishedQuestionFixture(`Bounded checkpoint ${index}`),
    ),
  });
  const bounded = await repository.listPublishedQuizQuestionMetadata(workspaceId, "Bounded Round");
  expect(bounded.questions).toHaveLength(100);
  expect(bounded.hasMore).toBe(true);
  expect(bounded.questions.map((question) => question.sourceQuestionId)).toEqual(
    many.version.content.questions.slice(0, 100).map((question) => question.id),
  );
  expect(
    await repository.listPublishedQuizQuestionMetadata(workspaceId, "Bounded checkpoint 100"),
  ).toMatchObject({ questions: [{ prompt: "Bounded checkpoint 100" }], hasMore: false });
  const opinionFields = {
    purpose: "opinion" as const,
    confidence: "off" as const,
    basePoints: 0,
    timeLimitSeconds: 30,
    explanation: "",
    mediaId: null,
    mediaAlt: null,
  };
  const ranking = {
    ...opinionFields,
    id: randomUUID(),
    type: "ranking" as const,
    prompt: "Rank the options",
    choices: ["One", "Two", "Three"].map((label) => ({
      id: randomUUID(),
      label,
      isCorrect: false,
    })),
    rankCount: 2,
  };
  const poll = {
    ...opinionFields,
    id: randomUUID(),
    type: "poll" as const,
    prompt: "Select priorities",
    choices: ["One", "Two", "Three"].map((label) => ({
      id: randomUUID(),
      label,
      isCorrect: false,
    })),
    maxSelections: 2,
  };
  const opinionVersion = await publish({
    title: "Opinion catalog",
    description: "",
    questions: [
      ...Array.from({ length: 10 }, (_, index) => ({
        ...opinionFields,
        id: randomUUID(),
        type: "open_text" as const,
        prompt: `Unsupported text ${index}`,
      })),
      ranking,
      poll,
    ],
  });
  // All supported opinion types remain safely bounded before pagination.
  expect(
    await repository.listPublishedQuizQuestionMetadata(workspaceId, "Opinion catalog", 1),
  ).toMatchObject({
    questions: [{ sourceQuizVersionId: opinionVersion.version.id, type: "open_text" }],
    hasMore: true,
  });
  const textCatalog = await repository.listPublishedQuizQuestionMetadata(
    workspaceId,
    "Opinion catalog",
    12,
  );
  expect(textCatalog.questions.map((entry) => entry.type)).toEqual([
    ...Array.from({ length: 10 }, () => "open_text"),
    "ranking",
    "poll",
  ]);
  expect(textCatalog.hasMore).toBe(false);
}

/** Unsupported current versions fail before JSON interpretation, filtering, or pagination. */
export async function expectPublishedQuestionLiveMetadataSchemaConformance(input: {
  repository: Repository;
  workspaceId: string;
  otherWorkspaceId: string;
  storeUnsupportedVersion: (input: {
    version: QuizVersionRecord;
    content: unknown;
    makeCurrent: boolean;
  }) => Promise<string>;
}) {
  const { repository, workspaceId, otherWorkspaceId, storeUnsupportedVersion } = input;
  async function publish(workspace = workspaceId, newest = false) {
    const now = new Date();
    const content = {
      title: "Supported catalog Round",
      description: "",
      questions: [publishedQuestionFixture(), publishedQuestionFixture("Second checkpoint")],
    };
    const quiz = await repository.createQuiz({
      // Break same-millisecond ties in memory so the pagination fixture is always newer.
      id: `${newest ? "f" : "0"}${randomUUID().slice(1)}`,
      workspaceId: workspace,
      title: content.title,
      description: "",
      status: "draft",
      draft: content,
      currentVersionId: null,
      createdAt: now,
      updatedAt: now,
    });
    return repository.publishQuiz({
      id: randomUUID(),
      workspaceId: workspace,
      quizId: quiz.id,
      version: 1,
      content,
      contentHash: createHash("sha256").update(JSON.stringify(content)).digest("hex"),
      publishedAt: now,
    });
  }
  const futureQuestion = publishedQuestionFixture("Future checkpoint");
  const futureContent = { title: "Future Round", description: "", questions: [futureQuestion] };
  const cases = [
    { content: { title: "Future Round", description: "" } },
    { content: { title: "Future Round", description: "", items: [futureQuestion] } },
    { content: { ...futureContent, questions: [] } },
    { content: { ...futureContent, questions: [{ ...futureQuestion, delivery: "recheck" }] } },
    { content: futureContent, search: "Supported catalog" },
    { content: futureContent, limit: 1 },
  ];
  for (const scenario of cases) {
    const version = await publish();
    const futureVersionId = await storeUnsupportedVersion({
      version,
      content: scenario.content,
      makeCurrent: true,
    });
    const newer = scenario.limit ? await publish(workspaceId, true) : null;
    await expect(
      repository.listPublishedQuizQuestionMetadata(workspaceId, scenario.search, scenario.limit),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_ARTIFACT_SCHEMA_VERSION", schemaVersion: 99 });
    await expect(repository.getQuizVersion(workspaceId, futureVersionId)).rejects.toMatchObject({
      code: "UNSUPPORTED_ARTIFACT_SCHEMA_VERSION",
    });
    await repository.archiveQuiz(workspaceId, version.quizId, true);
    if (newer) await repository.archiveQuiz(workspaceId, newer.quizId, true);
    expect(await repository.listPublishedQuizQuestionMetadata(workspaceId)).toEqual({
      questions: [],
      hasMore: false,
    });
  }
  const retained = await publish();
  await storeUnsupportedVersion({ version: retained, content: futureContent, makeCurrent: false });
  const other = await publish(otherWorkspaceId);
  await storeUnsupportedVersion({ version: other, content: futureContent, makeCurrent: true });
  expect(await repository.listPublishedQuizQuestionMetadata(workspaceId)).toMatchObject({
    questions: [{ sourceQuizVersionId: retained.id }, { sourceQuizVersionId: retained.id }],
    hasMore: false,
  });
}
