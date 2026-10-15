import type { Entitlements } from "@openround/contracts";
import { ApiClientError } from "./api";

/** Use the entitlement of the funding explicitly selected for this run. */
export function canProtectRoom(
  entitlements: Pick<Entitlements, "plan" | "passwordProtection"> | null | undefined,
) {
  return Boolean(entitlements && (entitlements.passwordProtection ?? entitlements.plan !== "free"));
}

export function validRoomPassword(password: string) {
  return password.length >= 8 && password.length <= 128 && /\S/u.test(password);
}

export function roomPasswordFields(available: boolean, enabled: boolean, password: string) {
  if (enabled && !available) throw new Error("Password protection is not available for this run");
  return enabled ? { joinPassword: password } : {};
}

export function roomPasswordErrorKey(error: unknown) {
  if (error instanceof ApiClientError) {
    if (error.code === "PASSWORD_REQUIRED") return "live.protection.required" as const;
    if (error.code === "INVALID_PASSWORD") return "live.protection.invalid" as const;
  }
  return null;
}
