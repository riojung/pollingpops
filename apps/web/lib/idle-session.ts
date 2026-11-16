import {
  AuthSessionStateSchema,
  LocalReturnPathSchema,
  type AuthSessionState,
  type SessionPolicy,
} from "@openround/contracts";

export type IdleSessionPolicy = SessionPolicy;
export type IdleSession = AuthSessionState;

export const SESSION_EXPIRED_EVENT = "pollingpops:session-expired";
export const SESSION_LOGOUT_EVENT = "pollingpops:session-logout";
export const SESSION_POLICY_UPDATED_EVENT = "pollingpops:session-policy-updated";
export const SESSION_SYNC_KEY = "pollingpops:session-sync:v1";
export const PENDING_SESSION_LOGOUT_KEY = "pollingpops:pending-session-logout:v1";
export interface PendingSessionLogout {
  sessionId: string;
  returnTo: string;
}
let pendingLogoutFallback: PendingSessionLogout | null = null;

export function readPendingSessionLogout(): PendingSessionLogout | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(PENDING_SESSION_LOGOUT_KEY);
    if (raw) {
      const value = JSON.parse(raw) as Partial<PendingSessionLogout>;
      if (
        AuthSessionStateSchema.shape.sessionId.safeParse(value.sessionId).success &&
        LocalReturnPathSchema.safeParse(value.returnTo).success
      ) {
        pendingLogoutFallback = value as PendingSessionLogout;
        return pendingLogoutFallback;
      }
    }
  } catch {
    /* The in-memory intent still locks this running app when storage is unavailable. */
  }
  return pendingLogoutFallback;
}

export function savePendingSessionLogout(intent: PendingSessionLogout) {
  pendingLogoutFallback = intent;
  try {
    window.sessionStorage.setItem(PENDING_SESSION_LOGOUT_KEY, JSON.stringify(intent));
  } catch {
    /* Keep the running boundary locked. */
  }
}

export function clearPendingSessionLogout(expectedSessionId?: string) {
  if (expectedSessionId && readPendingSessionLogout()?.sessionId !== expectedSessionId) return;
  pendingLogoutFallback = null;
  try {
    window.sessionStorage.removeItem(PENDING_SESSION_LOGOUT_KEY);
  } catch {
    /* Best effort cleanup. */
  }
}

export function publishSessionSignal(
  kind: "activity" | "policy" | "logout",
  channel?: BroadcastChannel | null,
) {
  if (typeof window === "undefined") return;
  const signal = { kind, nonce: Math.random().toString(36).slice(2) };
  let temporary: BroadcastChannel | null = null;
  try {
    if (channel) channel.postMessage(signal);
    else {
      temporary = new BroadcastChannel(SESSION_SYNC_KEY);
      temporary.postMessage(signal);
    }
  } catch {
    /* The storage event remains available without BroadcastChannel. */
  } finally {
    temporary?.close();
  }
  try {
    // Signals never contain credentials, session IDs, user data, drafts, or deadlines.
    window.localStorage.setItem(SESSION_SYNC_KEY, JSON.stringify(signal));
  } catch {
    /* Resume reconciliation remains available without browser storage. */
  }
}

/** Public audience passes have their own lifetime and never join creator idle tracking. */
export function isWorkspaceSessionPath(path: string) {
  if (path === "/") return false;
  if (
    /^\/(?:signin|join|play|present|embed|board|followup|presentation-assignment|presentation-practice|presentation-review|summary|survey|invite|help|status|pricing|privacy|terms)(?:\/|$)/.test(
      path,
    )
  )
    return false;
  if (
    /^\/(?:canvas\/invitations|presentation\/join|organization\/invite|dev\/presentation-scene)(?:\/|$)/.test(
      path,
    )
  )
    return false;
  return !/^\/presentation-session\/[^/]+\/(?:play|stage|companion)(?:\/|$)/.test(path);
}

export function parseIdleSession(value: unknown): IdleSession | null {
  const result = AuthSessionStateSchema.safeParse(value);
  if (!result.success || Date.parse(result.data.warningAt) > Date.parse(result.data.expiresAt))
    return null;
  return result.data;
}

export interface SessionClock {
  server: number;
  wall: number;
  monotonic: number;
}

export function sessionClock(session: IdleSession, wall: number, monotonic: number): SessionClock {
  return { server: Date.parse(session.serverNow), wall, monotonic };
}

/** Wall time covers suspended devices; monotonic time prevents a backwards clock extending access. */
export function sessionNow(clock: SessionClock, wall: number, monotonic: number) {
  return clock.server + Math.max(0, wall - clock.wall, monotonic - clock.monotonic);
}

export function idleSessionPhase(session: IdleSession, now: number) {
  if (now >= Math.min(Date.parse(session.expiresAt), Date.parse(session.absoluteExpiresAt)))
    return "expired";
  return now >= Date.parse(session.warningAt) ? "warning" : "active";
}

export function sessionSecondsRemaining(session: IdleSession, now: number) {
  return Math.max(
    0,
    Math.ceil(
      (Math.min(Date.parse(session.expiresAt), Date.parse(session.absoluteExpiresAt)) - now) / 1000,
    ),
  );
}

export function sessionReturnPath(location: Pick<Location, "pathname" | "search" | "hash">) {
  const path = `${location.pathname}${location.search}${location.hash}`;
  const hasControl = Array.from(path).some((character) => {
    const point = character.codePointAt(0) ?? 0;
    return point <= 31 || point === 127;
  });
  return path.length <= 500 &&
    path.startsWith("/") &&
    !/^\/\//.test(path) &&
    !path.includes("\\") &&
    !hasControl
    ? path
    : "/home";
}

/** Remove only creator authority; independently joined audience and display passes survive. */
export function clearCreatorSessionAuthority() {
  try {
    const storage = window.sessionStorage;
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
    for (const key of keys) {
      if (
        key &&
        (/^openround:host:/.test(key) ||
          /^openround:presentation-host:/.test(key) ||
          key === "openround_lti_link_token")
      )
        storage.removeItem(key);
    }
  } catch {
    // Cookie revocation and the private content gate do not depend on browser storage.
  }
}
