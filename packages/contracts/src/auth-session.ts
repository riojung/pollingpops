import { z } from "zod";

export const DEFAULT_SESSION_POLICY = {
  idleTimeoutMinutes: 5,
  warningDurationSeconds: 60,
} as const;

export const SessionPolicySchema = z
  .object({
    idleTimeoutMinutes: z.number().int().min(1).max(240).default(5),
    warningDurationSeconds: z.literal(60).default(60),
  })
  .strict();
export type SessionPolicy = z.infer<typeof SessionPolicySchema>;

export const SessionActivitySchema = z
  .object({ intent: z.enum(["activity", "continue"]) })
  .strict();
export type SessionActivity = z.infer<typeof SessionActivitySchema>;

export const AuthLogoutSchema = z
  .object({ expectedSessionId: z.string().uuid().optional() })
  .strict();
export type AuthLogout = z.infer<typeof AuthLogoutSchema>;

export const AuthSessionStateSchema = z.object({
  sessionId: z.string().uuid(),
  workspaceId: z.string().uuid().nullable(),
  serverNow: z.iso.datetime(),
  lastActivityAt: z.iso.datetime(),
  warningAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  absoluteExpiresAt: z.iso.datetime(),
  policy: SessionPolicySchema,
});
export type AuthSessionState = z.infer<typeof AuthSessionStateSchema>;
