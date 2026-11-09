import type {
  PresentationPracticePreview,
  PresentationPracticeAttempt,
  PresentationPracticeAnswer,
} from "@openround/contracts";
export const practiceIds = {
  assignment: "aaaaaaaa-0000-4000-8000-000000000001",
  version: "aaaaaaaa-0000-4000-8000-000000000002",
  attempt: "aaaaaaaa-0000-4000-8000-000000000003",
  first: "aaaaaaaa-0000-4000-8000-000000000004",
  second: "aaaaaaaa-0000-4000-8000-000000000005",
  choice: "aaaaaaaa-0000-4000-8000-000000000006",
  other: "aaaaaaaa-0000-4000-8000-000000000007",
  presentation: "aaaaaaaa-0000-4000-8000-000000000008",
};
export const practiceToken = "A".repeat(43);
export const practiceReader = { attemptId: practiceIds.attempt, token: "B".repeat(43) };
export function practicePreview(): PresentationPracticePreview {
  const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
  return {
    assignment: {
      id: practiceIds.assignment,
      mode: "practice",
      versionId: practiceIds.version,
      createdAt: new Date().toISOString(),
      expiresAt,
      revokedAt: null,
    },
    review: {
      schemaVersion: 1,
      versionId: practiceIds.version,
      version: 1,
      title: "Private practice",
      expiresAt,
      sections: [],
      blocks: [practiceIds.first, practiceIds.second].map((id, index) => ({
        id,
        kind: "question",
        question: {
          type: "single_select",
          prompt: `Check ${index + 1}`,
          mediaId: null,
          mediaAlt: null,
          choices: [
            { id: practiceIds.choice, label: "Correct public choice" },
            { id: practiceIds.other, label: "Other public choice" },
          ],
        },
      })),
    },
  };
}
export function practiceAnswer(blockId = practiceIds.first): PresentationPracticeAnswer {
  return {
    blockId,
    choiceId: practiceIds.choice,
    correct: true,
    submittedAt: new Date().toISOString(),
    feedback: {
      correctChoiceId: practiceIds.choice,
      explanation: "Accepted personal explanation",
      selectedFeedback: "Selected personal feedback",
    },
  };
}
export function practiceAttempt(
  revision = 0,
  readBlockIds: string[] = [],
  id = practiceIds.attempt,
  answers: PresentationPracticeAnswer[] = [],
): PresentationPracticeAttempt {
  const now = new Date().toISOString();
  return {
    id,
    assignmentId: practiceIds.assignment,
    revision,
    readBlockIds,
    currentBlockId: readBlockIds.at(-1) ?? null,
    startedAt: now,
    updatedAt: now,
    completedAt: null,
    answers,
  };
}
