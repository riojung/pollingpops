interface SessionCredentialStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

export function hostCredentialStorageKey(sessionId: string) {
  return `openround:host:${sessionId}`;
}

export const HOST_CREDENTIAL_CHANGE_EVENT = "pollingpops:host-credential-change";

export function cohostCredentialStorageKey(sessionId: string) {
  return `openround:cohost:${sessionId}`;
}

export function roundHostSessionId(pathname: string) {
  return /^\/host\/([^/]+)\/?$/.exec(pathname)?.[1] ?? null;
}

function cohostFragment(hash: string) {
  const values = new URLSearchParams(hash.replace(/^#/, "")).getAll("cohost");
  return values.length === 1 && /^[A-Za-z0-9_-]{20,512}$/.test(values[0] ?? "") ? values[0]! : null;
}

/** An explicit capability route is independent of creator authentication. */
export function scopedCohostCredential(
  storage: Pick<SessionCredentialStorage, "getItem">,
  sessionId: string,
  hash: string,
) {
  const fragment = cohostFragment(hash);
  try {
    // The legacy owner key also held cohost grants. Only an explicit fragment or
    // the distinct cohost namespace declares capability mode; equality cannot.
    const stored = storage.getItem(cohostCredentialStorageKey(sessionId));
    return fragment ?? (stored && /^[A-Za-z0-9_-]{20,512}$/.test(stored) ? stored : null);
  } catch {
    return fragment;
  }
}

export function readHostCredential(
  storage: SessionCredentialStorage,
  sessionId: string,
  hash: string,
  clearFragment: () => void,
) {
  const cohost = scopedCohostCredential(storage, sessionId, hash);
  if (cohost) {
    if (cohostFragment(hash) === cohost) {
      try {
        storage.setItem(cohostCredentialStorageKey(sessionId), cohost);
        storage.removeItem(hostCredentialStorageKey(sessionId));
        clearFragment();
      } catch {
        // Keep the fragment usable when storage is unavailable, including on reload.
      }
    }
    return { kind: "cohost" as const, token: cohost };
  }
  if (new URLSearchParams(hash.replace(/^#/, "")).has("cohost")) clearFragment();
  try {
    return {
      kind: "creator" as const,
      token: storage.getItem(hostCredentialStorageKey(sessionId)),
    };
  } catch {
    return { kind: "creator" as const, token: null };
  }
}

export function saveCreatorHostCredential(
  storage: SessionCredentialStorage,
  sessionId: string,
  token: string,
) {
  storage.setItem(hostCredentialStorageKey(sessionId), token);
  storage.removeItem(cohostCredentialStorageKey(sessionId));
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function")
    window.dispatchEvent(new Event(HOST_CREDENTIAL_CHANGE_EVENT));
}

export function createHostCredentialRecovery(storage: SessionCredentialStorage, sessionId: string) {
  const key = hostCredentialStorageKey(sessionId);
  let recoveryClaimed = false;

  return {
    save(token: string) {
      saveCreatorHostCredential(storage, sessionId, token);
    },
    claim(errorCode: string, rejectedToken: string) {
      if (errorCode !== "UNAUTHORIZED") return false;
      if (storage.getItem(key) === rejectedToken) storage.removeItem(key);
      if (recoveryClaimed) return false;
      recoveryClaimed = true;
      return true;
    },
    succeeded() {
      recoveryClaimed = false;
    },
  };
}
