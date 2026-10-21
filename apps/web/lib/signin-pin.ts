import {
  EmailPinRequestSchema,
  EmailPinVerifySchema,
  LocalReturnPathSchema,
  OidcStartSchema,
} from "@openround/contracts";

export const PIN_RESUME_STORAGE_KEY = "pollingpops:signin-pin:v1";
const pinLifetime = 10 * 60_000;
const maximumRetryDelay = 15 * 60_000;

export interface PinContext {
  apiUrl: string;
  returnTo?: string;
  workspaceId?: string;
}

export interface PinChallenge {
  challengeId: string;
  expiresAt: number;
}

export type PinDelivery = "requesting" | "requested" | "uncertain" | "throttled" | "failed";

export interface PinEntry {
  email: string;
  context: PinContext;
  challenge: PinChallenge | null;
  delivery: PinDelivery;
  resendAt: number;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function challenge(value: unknown, now: number): PinChallenge | null {
  if (!record(value)) return null;
  const id = EmailPinVerifySchema.shape.challengeId.safeParse(value.challengeId);
  if (!id.success || typeof value.expiresAt !== "number" || !Number.isFinite(value.expiresAt))
    return null;
  if (value.expiresAt <= now || value.expiresAt > now + pinLifetime) return null;
  return { challengeId: id.data, expiresAt: value.expiresAt };
}

function sameContext(value: unknown, expected: PinContext) {
  if (!record(value) || value.apiUrl !== expected.apiUrl) return false;
  if (
    (value.returnTo ?? undefined) !== expected.returnTo ||
    (value.workspaceId ?? undefined) !== expected.workspaceId
  )
    return false;
  return (
    (value.returnTo === undefined || LocalReturnPathSchema.safeParse(value.returnTo).success) &&
    (value.workspaceId === undefined ||
      OidcStartSchema.shape.workspaceId.safeParse(value.workspaceId).success)
  );
}

function parseEntry(value: unknown, context: PinContext, now: number): PinEntry | null {
  if (!record(value) || value.version !== 1 || !sameContext(value.context, context)) return null;
  const email = EmailPinRequestSchema.shape.email.safeParse(value.email);
  if (!email.success || typeof value.resendAt !== "number" || !Number.isFinite(value.resendAt))
    return null;
  if (value.resendAt < 0 || value.resendAt > now + maximumRetryDelay) return null;
  const deliveries: PinDelivery[] = ["requesting", "requested", "uncertain", "throttled", "failed"];
  if (!deliveries.includes(value.delivery as PinDelivery)) return null;
  const current = challenge(value.challenge, now);
  if (!current) return null;
  return {
    email: email.data,
    context,
    challenge: current,
    delivery: value.delivery === "requesting" ? "uncertain" : (value.delivery as PinDelivery),
    resendAt: value.resendAt,
  };
}

export function clearPinEntry() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(PIN_RESUME_STORAGE_KEY);
  } catch {
    /* Storage may be unavailable. */
  }
}

export function savePinEntry(entry: PinEntry) {
  if (typeof window === "undefined") return;
  if (!entry.challenge) {
    clearPinEntry();
    return;
  }
  // Whitelist only the challenge and its bounded context. Never persist a PIN,
  // debug credentials, API response, or signed-in session.
  const stored = {
    version: 1,
    email: entry.email,
    context: {
      apiUrl: entry.context.apiUrl,
      ...(entry.context.returnTo ? { returnTo: entry.context.returnTo } : {}),
      ...(entry.context.workspaceId ? { workspaceId: entry.context.workspaceId } : {}),
    },
    challenge: entry.challenge
      ? { challengeId: entry.challenge.challengeId, expiresAt: entry.challenge.expiresAt }
      : null,
    delivery: entry.delivery,
    resendAt: entry.resendAt,
  };
  try {
    window.sessionStorage.setItem(PIN_RESUME_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    /* Keep the current page usable without storage. */
  }
}

export function readPinEntry(context: PinContext, now = Date.now()): PinEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(PIN_RESUME_STORAGE_KEY);
    const parsed = raw && raw.length <= 8192 ? parseEntry(JSON.parse(raw), context, now) : null;
    if (!parsed) clearPinEntry();
    return parsed;
  } catch {
    clearPinEntry();
    return null;
  }
}
