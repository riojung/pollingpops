import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MemoryRepository, createSurveyRepository } from "../src/index.js";
import {
  expectSurveyLibraryConformance,
  expectFeedbackConformance,
  expectFeedbackPaginationConformance,
} from "./support/feedback-library-conformance.js";
import {
  expectSurveyConformance,
  expectSurveyCreationUpgradeConformance,
  expectSurveyPasswordConformance,
  surveyFixture,
} from "./support/survey-conformance.js";

async function fixture() {
  const repository = new MemoryRepository();
  const tokenHash = randomUUID();
  await repository.createMagicToken({
    id: randomUUID(),
    email: `survey-${randomUUID()}@example.com`,
    segment: "education",
    tokenHash,
    policyVersion: "test",
    expiresAt: new Date(Date.now() + 60000),
    consumedAt: null,
  });
  const creator = (await repository.consumeMagicToken(tokenHash, new Date()))!;
  return { repository, creator, surveys: createSurveyRepository(repository) };
}
describe("self-paced Survey storage", () => {
  it("persists room passwords and replays matching protected and legacy open creations", async () => {
    const { repository, creator } = await fixture();
    await expectSurveyPasswordConformance(repository, creator.workspaceId);
    const exported = JSON.stringify(await repository.exportAccount(creator.userId));
    expect(exported).not.toContain("stable-salted-verifier");
    expect(exported).not.toContain("joinPasswordHash");
  });
  it("orders private feedback newest-first with stable tied-time pagination and deleted anchors", async () => {
    const { repository, creator } = await fixture();
    await expectFeedbackPaginationConformance(repository, creator);
  });
  it("shares Library organization and private favorites without changing published evidence", async () => {
    const { repository, creator } = await fixture();
    await expectSurveyLibraryConformance(repository, creator);
  });
  it("persists private feedback with exact retries, contact permission, export, retention and deletion", async () => {
    const { repository, creator } = await fixture();
    await expectFeedbackConformance(repository, creator);
  });
  it("replays v1 creation receipts after a version-only writer upgrade without relaxing conflicts", async () => {
    const { repository, creator } = await fixture();
    await expectSurveyCreationUpgradeConformance(repository, creator.workspaceId);
  });
  it("conforms for revisions, frozen sharing, resume, finalization, privacy and retention", async () => {
    const { repository, creator } = await fixture();
    await expectSurveyConformance(repository, creator.workspaceId);
    await expectSurveyConformance(repository, creator.workspaceId, 2);
  });
  it("serializes concurrent publications and applies the shared Round/Survey quota", async () => {
    const { repository, creator, surveys } = await fixture();
    const draft = surveyFixture();
    const ids = Array.from({ length: 5 }, () => randomUUID());
    for (const id of ids) await surveys.create(creator.workspaceId, id, draft, randomUUID());
    const results = await Promise.allSettled(
      ids.map((id) => surveys.publish(creator.workspaceId, id, 0, randomUUID(), 4)),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(4);
    const quizId = randomUUID();
    const now = new Date();
    const content = { ...draft, questions: draft.items.map((item) => item.question) };
    await repository.createQuiz({
      id: quizId,
      workspaceId: creator.workspaceId,
      title: content.title,
      description: "",
      draft: content,
      status: "draft",
      currentVersionId: null,
      createdAt: now,
      updatedAt: now,
    });
    const version = {
      id: randomUUID(),
      workspaceId: creator.workspaceId,
      quizId,
      version: 1,
      content,
      contentHash: randomUUID(),
      publishedAt: now,
    };
    await expect(repository.publishQuiz(version, 4, 0)).rejects.toMatchObject({ limit: 4 });
    await repository.publishQuiz(version, 5, 0);
    const newId = randomUUID();
    await surveys.create(creator.workspaceId, newId, draft, randomUUID());
    await expect(
      surveys.publish(creator.workspaceId, newId, 0, randomUUID(), 5),
    ).rejects.toMatchObject({ limit: 5 });
    await repository.archiveQuiz(creator.workspaceId, quizId, true);
    await surveys.publish(creator.workspaceId, newId, 0, randomUUID(), 5);
    await expect(
      repository.archiveQuiz(creator.workspaceId, quizId, false, 5),
    ).rejects.toMatchObject({ limit: 5 });
  });
});
