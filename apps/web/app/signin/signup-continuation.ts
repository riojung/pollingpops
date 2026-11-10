import { EmailPinRequestSchema } from "@openround/contracts";
import type { PinContext } from "../../lib/signin-pin";

export const SIGNUP_CONTINUATION_KEY = "pollingpops:signup-continuation:v1";
const lifetime = 15 * 60_000;

interface SignupContinuation {
  email: string;
  accountType: "personal" | "organization";
  segment: "education" | "workplace";
}

function contextKey(context: PinContext) {
  return JSON.stringify([context.apiUrl, context.returnTo ?? null, context.workspaceId ?? null]);
}

export function clearSignupContinuation() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(SIGNUP_CONTINUATION_KEY);
  } catch {
    /* Storage is optional. */
  }
}

// Convenience information only: this cannot authenticate or assert verification.
// No email, verification token, or PIN is added to a URL or persistent storage.
export function saveSignupContinuation(
  context: PinContext,
  value: SignupContinuation,
  now = Date.now(),
) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      SIGNUP_CONTINUATION_KEY,
      JSON.stringify({
        version: 1,
        context: contextKey(context),
        ...value,
        expiresAt: now + lifetime,
      }),
    );
  } catch {
    /* Keep the current page usable without storage. */
  }
}

export function readSignupContinuation(
  context: PinContext,
  now = Date.now(),
): SignupContinuation | null {
  if (typeof window === "undefined") return null;
  const discard = () => {
    clearSignupContinuation();
    return null;
  };
  try {
    const raw = window.sessionStorage.getItem(SIGNUP_CONTINUATION_KEY);
    if (!raw) return null;
    if (raw.length > 2048) return discard();
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return discard();
    const saved = value as Record<string, unknown>;
    const email = EmailPinRequestSchema.shape.email.safeParse(saved.email);
    if (
      saved.version !== 1 ||
      saved.context !== contextKey(context) ||
      !email.success ||
      typeof saved.expiresAt !== "number" ||
      !Number.isFinite(saved.expiresAt) ||
      saved.expiresAt <= now ||
      saved.expiresAt > now + lifetime ||
      (saved.accountType !== "personal" && saved.accountType !== "organization") ||
      (saved.segment !== "workplace" && saved.segment !== "education")
    )
      return discard();
    return { email: email.data, accountType: saved.accountType, segment: saved.segment };
  } catch {
    return discard();
  }
}
