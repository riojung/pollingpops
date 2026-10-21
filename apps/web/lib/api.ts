const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
export const API_URL = configuredApiUrl ? configuredApiUrl.replace(/\/+$/, "") : "";
export const AUTH_CHANGE_EVENT = "pollingpops:auth-change";
export const LOGOUT_WARNING_STORAGE_KEY = "pollingpops:logout-revocation-warning";
export const LOGOUT_REVOCATION_WARNING =
  "Product sign-out completed, but admin session revocation could not be confirmed. Check the management service before leaving this device.";

function persistLogoutWarning(warning: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (warning) window.sessionStorage.setItem(LOGOUT_WARNING_STORAGE_KEY, warning);
    else window.sessionStorage.removeItem(LOGOUT_WARNING_STORAGE_KEY);
  } catch {
    // Restricted storage must not turn a completed product logout into another failure.
  }
}

export function readLogoutWarning(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(LOGOUT_WARNING_STORAGE_KEY) === LOGOUT_REVOCATION_WARNING
      ? LOGOUT_REVOCATION_WARNING
      : null;
  } catch {
    return null;
  }
}

function notifyAuthChange() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
}

export function dismissLogoutWarning() {
  persistLogoutWarning(null);
  notifyAuthChange();
}

export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly code = "INTERNAL_ERROR",
    public readonly status = 500,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

function retryDelaySeconds(structured: unknown, header: string | null | undefined) {
  if (typeof structured === "number" && Number.isFinite(structured) && structured >= 0) {
    return Math.ceil(structured);
  }
  if (!header?.trim()) return undefined;
  const value = header.trim();
  if (/^\d+(?:\.\d+)?$/.test(value)) {
    const seconds = Number(value);
    return Number.isFinite(seconds) ? Math.ceil(seconds) : undefined;
  }
  // HTTP dates are supported without accepting arbitrary numeric/date-like strings.
  if (!/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), /i.test(value)) return undefined;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, Math.ceil((date - Date.now()) / 1000)) : undefined;
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: init.credentials ?? "include",
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: {
        code?: string;
        message?: string;
        retryAfterSeconds?: unknown;
        details?: { retryAfterSeconds?: unknown };
      };
    } | null;
    throw new ApiClientError(
      body?.error?.message ?? `Request failed (${response.status})`,
      body?.error?.code,
      response.status,
      retryDelaySeconds(
        body?.error?.details?.retryAfterSeconds ?? body?.error?.retryAfterSeconds,
        response.headers?.get("retry-after"),
      ),
    );
  }
  const loggedOut = path === "/v1/auth/logout" && init.method?.toUpperCase() === "POST";
  if (response.status === 204) {
    return undefined as T;
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    if (loggedOut) notifyAuthChange();
    throw error;
  }
  const uncertainRevocation =
    loggedOut &&
    typeof body === "object" &&
    body !== null &&
    "operatorSessionRevoked" in body &&
    body.operatorSessionRevoked === false;
  if (uncertainRevocation) {
    // After cookies clear, later logouts cannot confirm revocation of the original token.
    // Keep this warning until explicitly dismissed; successful callers still redirect.
    persistLogoutWarning(LOGOUT_REVOCATION_WARNING);
    notifyAuthChange();
    throw new ApiClientError(
      LOGOUT_REVOCATION_WARNING,
      "OPERATOR_SESSION_REVOCATION_UNCONFIRMED",
      response.status,
    );
  }
  return body as T;
}

export function humanError(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Try again.";
}

/** Only reads may automatically retry; writes must preserve their idempotent intent. */
export function isRetryableReadError(error: unknown): boolean {
  return error instanceof ApiClientError
    ? error.status === 429 || error.status >= 500
    : error instanceof TypeError;
}
