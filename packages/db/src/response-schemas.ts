import { ResponsePayloadSchema, type ResponsePayload } from "@openround/contracts";

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
