import {
  AudienceScopeSnapshotSchema,
  PresentationAudienceAvailabilitySchema,
  ScopedQnaCommandSchema,
  ScopedQnaAcknowledgementSchema,
  ScopedQnaPageSchema,
  type ScopedQnaCommand,
} from "@openround/contracts";
import { apiFetch } from "./api";

/** Use only the native room pass, never a creator cookie or a credential-bearing URL. */
export function createPresentationQnaClient(sessionId: string, token: string) {
  const request = (path: string, init: RequestInit = {}) =>
    apiFetch<unknown>(path, {
      ...init,
      credentials: "omit",
      headers: { authorization: `Bearer ${token}` },
    });
  const base = `/v1/audience-scopes/${sessionId}`;
  return {
    async availability() {
      return PresentationAudienceAvailabilitySchema.parse(
        await request(`${base}/availability?kind=presentation`),
      );
    },
    async activate(idempotencyKey: string) {
      const response = await request("/v1/audience-scopes", {
        method: "POST",
        body: JSON.stringify({ kind: "presentation", sessionId, idempotencyKey }),
      });
      return AudienceScopeSnapshotSchema.parse((response as { scope?: unknown } | null)?.scope);
    },
    async page(cursor?: string) {
      const query = new URLSearchParams({ kind: "presentation", limit: "30" });
      if (cursor) query.set("cursor", cursor);
      return ScopedQnaPageSchema.parse(await request(`${base}/qna/questions?${query}`));
    },
    async command(command: ScopedQnaCommand) {
      return ScopedQnaAcknowledgementSchema.parse(
        await request(`${base}/qna/commands`, {
          method: "POST",
          body: JSON.stringify({
            kind: "presentation",
            command: ScopedQnaCommandSchema.parse(command),
          }),
        }),
      );
    },
  };
}
