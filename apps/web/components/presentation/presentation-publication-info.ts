import { useEffect, useState } from "react";
import { apiFetch, AUTH_CHANGE_EVENT } from "../../lib/api";

export interface PresentationPublicationInfo {
  id: string;
  version: number;
  publishedAt: string;
}
type PublicationState = {
  key: string;
  status: "loading" | "unavailable" | "ready";
  publication?: PresentationPublicationInfo;
};

/** Exact publication identity prevents a newer coauthor publication being labelled as this one. */
export function parsePublicationInfo(
  value: unknown,
  expectedId: string,
): PresentationPublicationInfo | null {
  if (!value || typeof value !== "object") return null;
  const candidate = (value as { publication?: unknown }).publication;
  if (!candidate || typeof candidate !== "object") return null;
  const info = candidate as Partial<PresentationPublicationInfo>;
  return info.id === expectedId &&
    Number.isSafeInteger(info.version) &&
    info.version! > 0 &&
    typeof info.publishedAt === "string" &&
    Number.isFinite(Date.parse(info.publishedAt))
    ? { id: info.id, version: info.version!, publishedAt: info.publishedAt }
    : null;
}

export function usePresentationPublicationInfo(
  actorKey: string,
  presentationId: string,
  versionId: string,
) {
  const key = JSON.stringify([actorKey, presentationId, versionId]);
  const [state, setState] = useState<PublicationState | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setState({ key, status: "loading" });
    const invalidate = () => {
      current = false;
      controller.abort();
      setState({ key, status: "unavailable" });
    };
    window.addEventListener(AUTH_CHANGE_EVENT, invalidate);
    void apiFetch<unknown>(`/v1/presentations/${encodeURIComponent(presentationId)}/publication`, {
      signal: controller.signal,
      cache: "no-store",
    }).then(
      (response) => {
        if (!current || controller.signal.aborted) return;
        const publication = parsePublicationInfo(response, versionId);
        setState(
          publication ? { key, status: "ready", publication } : { key, status: "unavailable" },
        );
      },
      () => {
        if (current && !controller.signal.aborted) setState({ key, status: "unavailable" });
      },
    );
    return () => {
      current = false;
      controller.abort();
      window.removeEventListener(AUTH_CHANGE_EVENT, invalidate);
    };
  }, [key, presentationId, versionId, attempt]);
  const visibleState: PublicationState = state?.key === key ? state : { key, status: "loading" };
  return { state: visibleState, retry: () => setAttempt((value) => value + 1) };
}
