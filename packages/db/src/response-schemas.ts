import {
  PresentationSessionResponseSchema,
  isPresentationOpinionResultQuestion,
  type PresentationSessionResponse,
  type QuestionType,
  ResponsePayloadSchema,
  type ResponsePayload,
} from "@openround/contracts";

export function roundResponseSchemaVersion(response: ResponsePayload): 2 | 3 | 4 | 5 {
  return response.kind === "text"
    ? 5
    : response.kind === "ranking"
      ? 4
      : response.kind === "poll" && response.choiceIds.length > 1
        ? 3
        : 2;
}

/** Stored response versions must be checked before broad current contracts parse their payload. */
export function upcastRoundResponse(value: unknown, schemaVersion: unknown = 1): ResponsePayload {
  if (
    schemaVersion !== 1 &&
    schemaVersion !== 2 &&
    schemaVersion !== 3 &&
    schemaVersion !== 4 &&
    schemaVersion !== 5
  ) {
    throw new Error(`Unsupported Round response schema version ${String(schemaVersion)}`);
  }
  const response = ResponsePayloadSchema.parse(value);
  if (schemaVersion < 5 && response.kind === "text")
    throw new Error("Text opinion responses require response schema version 5");
  if (schemaVersion < 4 && response.kind === "ranking") {
    throw new Error("Ranking responses require response schema version 4");
  }
  if (schemaVersion < 3 && response.kind === "poll" && response.choiceIds.length > 1) {
    throw new Error("Multiple-selection poll responses require response schema version 3");
  }
  if (schemaVersion === 1 && (response.kind !== "choice" || response.choiceIds.length !== 1)) {
    throw new Error("Legacy response schema version 1 requires one choice");
  }
  return response;
}

/** Presentation retains unordered legacy choice responses separately from explicit rankings. */
export function presentationResponseSchemaVersion(
  response: PresentationSessionResponse,
  question?: { type?: QuestionType; maxSelections?: number },
): 1 | 2 | 3 {
  if (response.textValue !== undefined) return 3;
  return response.orderedChoiceIds !== undefined ||
    (question && isPresentationOpinionResultQuestion(question))
    ? 2
    : 1;
}

export function upcastPresentationResponse(
  value: unknown,
  schemaVersion: unknown = 1,
  textContext?: { moderationStatus?: string | null; moderationVersion?: number | null },
): PresentationSessionResponse {
  if (schemaVersion === 3) {
    if (
      !textContext ||
      !["pending", "approved", "removed"].includes(textContext.moderationStatus ?? "") ||
      !Number.isInteger(textContext.moderationVersion) ||
      textContext.moderationVersion! < 0 ||
      textContext.moderationVersion! > 2 ||
      (textContext.moderationStatus === "pending" && textContext.moderationVersion !== 0) ||
      (textContext.moderationStatus === "approved" && textContext.moderationVersion !== 1) ||
      (textContext.moderationStatus === "removed" && textContext.moderationVersion! < 1) ||
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).length !== 0
    )
      throw new Error("Text response storage version 3 requires body-free metadata");
    return {};
  }
  if (schemaVersion !== 1 && schemaVersion !== 2) {
    throw new Error(`Unsupported Presentation response schema version ${String(schemaVersion)}`);
  }
  if (value && typeof value === "object" && "textValue" in value)
    throw new Error("Text responses require Presentation response schema version 3");
  if (schemaVersion === 1 && value && typeof value === "object" && "orderedChoiceIds" in value) {
    throw new Error("Ordered rankings require Presentation response schema version 2");
  }
  return PresentationSessionResponseSchema.parse(value);
}
