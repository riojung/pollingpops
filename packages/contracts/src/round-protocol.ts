import { z } from "zod";

/** Reserved capability: current clients must not advertise it until the full poll journey ships. */
export const RoundCapabilitySchema = z.enum(["poll.multiselect"]);
const capabilities = z
  .array(RoundCapabilitySchema)
  .max(1)
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

/** The legacy response formats are still the only formats accepted in this reader-first release. */
export function legacyRoundProtocol(): RoundProtocol {
  return { schemaVersion: 1, minimumClientVersion: 2, requiredCapabilities: [] };
}
export function currentRoundClientCapabilities(): RoundClientCapabilities {
  return { protocolVersion: 2, capabilities: [] };
}
export function canUseRoundProtocol(
  protocol: RoundProtocol | undefined,
  client: RoundClientCapabilities | undefined,
): boolean {
  const requirements = RoundProtocolSchema.safeParse(protocol ?? legacyRoundProtocol());
  const supported = RoundClientCapabilitiesSchema.safeParse(
    client ?? currentRoundClientCapabilities(),
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
