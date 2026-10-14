import { normalizeTextResponse, textResponseCharacterLimit } from "@openround/contracts";

export type TextQuestionType = "open_text" | "word_cloud";

export function isTextQuestion(type: string): type is TextQuestionType {
  return type === "open_text" || type === "word_cloud";
}

export function textResponseError(
  type: TextQuestionType,
  value: string,
): "empty" | "length" | "characters" | null {
  const normalized = value.normalize("NFC").trim();
  if (!normalized) return "empty";
  if (normalized.length > textResponseCharacterLimit(type)) return "length";
  try {
    normalizeTextResponse(value, type);
    return null;
  } catch {
    return "characters";
  }
}

export function textResponseReceipt(status: "pending" | "approved" | "removed" | null | undefined) {
  return status === "approved"
    ? "live.text.receiptApproved"
    : status === "removed"
      ? "live.text.receiptRemoved"
      : "live.text.receiptPending";
}
