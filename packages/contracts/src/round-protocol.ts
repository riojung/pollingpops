import { z } from "zod";

/** Capabilities required by extended live response formats. */
export const RoundCapabilitySchema = z.enum([
  "poll.multiselect",
  "response.ranking",
  "response.open_text",
  "response.word_cloud",
]);
const capabilities = z
  .array(RoundCapabilitySchema)
  .max(4)
  .refine((values) => new Set(values).size === values.length, "Declare each capability once");
export const RoundClientCapabilitiesSchema = z
  .object({
    protocolVersion: z.union([z.literal(2), z.literal(3)]),
    capabilities,
  })
  .strict()
  .refine(
    (client) => client.protocolVersion === 3 || client.capabilities.length === 0,
    "Additional response formats require protocol version 3",
  );
export type RoundClientCapabilities = z.infer<typeof RoundClientCapabilitiesSchema>;
export const RoundClientCapabilitiesQuerySchema = z
  .string()
  .max(256)
  .transform((value, context) => {
    try {
      return JSON.parse(value);
    } catch {
      context.addIssue({ code: "custom", message: "Invalid client capabilities JSON" });
      return z.NEVER;
    }
  })
  .pipe(RoundClientCapabilitiesSchema)
  .optional();
export const ROUND_CLIENT_UPDATE_MESSAGE =
  "This browser cannot use this round's response formats. Refresh Polling Pops to load the latest version, then rejoin. Your saved answers are retained.";

/** Requirements are frozen with a room, not supplied by an untrusted client. */
export const RoundProtocolSchema = z
  .object({
    schemaVersion: z.literal(1),
    minimumClientVersion: z.union([z.literal(2), z.literal(3)]),
    requiredCapabilities: capabilities,
  })
  .strict()
  .refine(
    (protocol) => protocol.minimumClientVersion === 3 || protocol.requiredCapabilities.length === 0,
    "Additional response formats require protocol version 3",
  );
export type RoundProtocol = z.infer<typeof RoundProtocolSchema>;

export function legacyRoundProtocol(): RoundProtocol {
  return { schemaVersion: 1, minimumClientVersion: 2, requiredCapabilities: [] };
}
type RoundResponseContent = {
  questions: readonly { type: string; maxSelections?: number }[];
};
export function requiresExtendedRoundResponses(content: RoundResponseContent): boolean {
  return content.questions.some(
    (question) =>
      question.type === "ranking" ||
      question.type === "open_text" ||
      question.type === "word_cloud" ||
      (question.type === "poll" && (question.maxSelections ?? 1) > 1),
  );
}
export function hasRankingQuestions(content: RoundResponseContent): boolean {
  return content.questions.some((question) => question.type === "ranking");
}
/** Derive requirements from the immutable content rather than the creating client's profile. */
export function deriveRoundProtocol(content: RoundResponseContent): RoundProtocol {
  const requiredCapabilities: RoundProtocol["requiredCapabilities"] = [];
  if (
    content.questions.some(
      (question) => question.type === "poll" && (question.maxSelections ?? 1) > 1,
    )
  )
    requiredCapabilities.push("poll.multiselect");
  if (hasRankingQuestions(content)) requiredCapabilities.push("response.ranking");
  if (content.questions.some((question) => question.type === "open_text"))
    requiredCapabilities.push("response.open_text");
  if (content.questions.some((question) => question.type === "word_cloud"))
    requiredCapabilities.push("response.word_cloud");
  return requiredCapabilities.length
    ? { schemaVersion: 1, minimumClientVersion: 3, requiredCapabilities }
    : legacyRoundProtocol();
}
export function currentRoundClientCapabilities(): RoundClientCapabilities {
  return {
    protocolVersion: 3,
    capabilities: [
      "poll.multiselect",
      "response.ranking",
      "response.open_text",
      "response.word_cloud",
    ],
  };
}
export function canUseRoundProtocol(
  protocol: RoundProtocol | undefined,
  client: RoundClientCapabilities | undefined,
): boolean {
  const requirements = RoundProtocolSchema.safeParse(protocol ?? legacyRoundProtocol());
  const supported = RoundClientCapabilitiesSchema.safeParse(
    client ?? { protocolVersion: 2, capabilities: [] },
  );
  return (
    requirements.success &&
    supported.success &&
    supported.data.protocolVersion >= requirements.data.minimumClientVersion &&
    requirements.data.requiredCapabilities.every((capability) =>
      supported.data.capabilities.includes(capability),
    )
  );
}
