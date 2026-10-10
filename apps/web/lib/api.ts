const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
export const API_URL = configuredApiUrl ? configuredApiUrl.replace(/\/+$/, "") : "";

export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly code = "INTERNAL_ERROR",
    public readonly status = 500,
  ) {
    super(message);
  }
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
      error?: { code?: string; message?: string };
    } | null;
    throw new ApiClientError(
      body?.error?.message ?? `Request failed (${response.status})`,
      body?.error?.code,
      response.status,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
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
