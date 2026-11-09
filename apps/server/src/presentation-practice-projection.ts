import {
  PresentationPracticeAttemptSchema,
  PresentationPracticeInsightsSchema,
} from "@openround/contracts";
import { evaluateResponse } from "@openround/game-engine";
import type {
  PresentationPracticeAssignmentRecord,
  PresentationPracticeAttemptRecord,
  PresentationVersionRecord,
} from "@openround/db";

export function practiceAssignmentMetadata(record: PresentationPracticeAssignmentRecord) {
  return {
    id: record.id,
    mode: "practice" as const,
    versionId: record.versionId,
    createdAt: record.createdAt.toISOString(),
    expiresAt: record.expiresAt.toISOString(),
    revokedAt: record.revokedAt?.toISOString() ?? null,
  };
}

/** Feedback is available only for this credential's durably accepted answers. Never copy a question object. */
export function practiceAttemptMetadata(
  record: PresentationPracticeAttemptRecord,
  version: PresentationVersionRecord,
) {
  const answers = version.content.blocks.flatMap((block) => {
    const accepted = record.answers[block.id.toLowerCase()];
    if (!accepted) return [];
    if (
      block.kind !== "question" ||
      !["single_select", "true_false"].includes(block.question.type) ||
      !("choices" in block.question)
    )
      throw new Error("Practice accepted answer does not match its frozen question");
    const q = block.question;
    const selected = q.choices.find(
      (choice) => choice.id.toLowerCase() === accepted.choiceId.toLowerCase(),
    );
    const correct = q.choices.find((choice) => choice.isCorrect);
    if (
      !selected ||
      !correct ||
      evaluateResponse(q, { kind: "choice", choiceIds: [selected.id] }).correct !== accepted.correct
    )
      throw new Error("Practice accepted answer does not match its frozen evaluation");
    return [
      {
        blockId: block.id,
        choiceId: selected.id,
        correct: accepted.correct,
        submittedAt: accepted.submittedAt.toISOString(),
        feedback: {
          correctChoiceId: correct.id,
          explanation: q.explanation.trim() || null,
          selectedFeedback: selected.feedback?.trim() || null,
        },
      },
    ];
  });
  return PresentationPracticeAttemptSchema.parse({
    id: record.id,
    assignmentId: record.assignmentId,
    revision: record.revision,
    readBlockIds: [...record.readBlockIds],
    currentBlockId: record.currentBlockId,
    startedAt: record.startedAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    completedAt: record.completedAt?.toISOString() ?? null,
    answers,
  });
}
export function projectPresentationPracticeInsights(value: {
  assignment: PresentationPracticeAssignmentRecord;
  generatedAt: Date;
  started: number;
  completed: number;
}) {
  const enough = value.started >= 5;
  const pair =
    enough &&
    (value.completed === 0 || value.completed >= 5) &&
    (value.started - value.completed === 0 || value.started - value.completed >= 5);
  return PresentationPracticeInsightsSchema.parse({
    schemaVersion: 1,
    assignment: practiceAssignmentMetadata(value.assignment),
    generatedAt: value.generatedAt.toISOString(),
    minimumAttempts: 5,
    startedAttempts: enough ? value.started : null,
    completedAttempts: pair ? value.completed : null,
    inProgressAttempts: pair ? value.started - value.completed : null,
  });
}
