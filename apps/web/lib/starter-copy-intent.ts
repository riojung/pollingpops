import {
  StarterCopyRequestSchema,
  type StarterCopyRequest,
  type SupportedLocale,
} from "@openround/contracts";
import { clientUuid } from "./uuid";

export interface StarterCopyActor {
  actorId: string;
  workspaceId: string;
}
export interface StarterCopyIntent {
  starterId: string;
  body: string;
  previousBodies: string[];
}
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;
export type StarterCopyFailure = "unknown" | "renew" | "replace" | "conflict";
const maxIntents = 16;
const maxHistory = 4;
const ttl = 24 * 60 * 60 * 1000;
const sourceId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class StarterCopyStorageError extends Error {
  constructor() {
    super("Starter copy recovery could not be read or saved");
  }
}

export function starterCopyStorageKey(actor: StarterCopyActor) {
  return `starter-copy-intents:v1:${actor.actorId}:${actor.workspaceId}`;
}
export function starterCopyFailure(error: unknown): StarterCopyFailure {
  const { code, status } = (error ?? {}) as { code?: unknown; status?: unknown };
  if (
    (status === 400 && code === "INVALID_INTENT") ||
    (status === 409 && code === "STARTER_CONTENT_CHANGED") ||
    (status === 410 && code === "STARTER_COPY_EXPIRED")
  )
    return "renew";
  if (status === 410 && code === "STARTER_COPY_TARGET_UNAVAILABLE") return "replace";
  if (status === 409 && code === "IDEMPOTENCY_CONFLICT") return "conflict";
  return "unknown";
}
export function starterCopyRequest(intent: StarterCopyIntent): StarterCopyRequest {
  return StarterCopyRequestSchema.parse(JSON.parse(intent.body));
}
function checkedBody(body: unknown, actor: StarterCopyActor) {
  if (typeof body !== "string" || body.length > 1_024) throw new StarterCopyStorageError();
  const request = StarterCopyRequestSchema.parse(JSON.parse(body));
  if (
    request.creationContext.actorId !== actor.actorId ||
    request.creationContext.workspaceId !== actor.workspaceId
  )
    throw new StarterCopyStorageError();
  return request;
}
export function parseStarterCopyIntents(
  raw: string | null,
  actor: StarterCopyActor,
): StarterCopyIntent[] {
  if (raw === null) return [];
  try {
    if (raw.length > 98_304) throw new StarterCopyStorageError();
    const value = JSON.parse(raw) as { version: number; intents: StarterCopyIntent[] };
    if (
      !value ||
      Object.keys(value).length !== 2 ||
      value.version !== 1 ||
      !Array.isArray(value.intents) ||
      value.intents.length > maxIntents
    )
      throw new StarterCopyStorageError();
    const identities = new Set<string>();
    const keys = new Set<string>();
    for (const intent of value.intents) {
      if (
        !intent ||
        Object.keys(intent).length !== 3 ||
        typeof intent.starterId !== "string" ||
        intent.starterId.length > 128 ||
        !sourceId.test(intent.starterId) ||
        !Array.isArray(intent.previousBodies) ||
        intent.previousBodies.length > maxHistory
      )
        throw new StarterCopyStorageError();
      const request = checkedBody(intent.body, actor);
      const identity = JSON.stringify([intent.starterId, request.locale]);
      if (
        identities.has(identity) ||
        keys.has(request.idempotencyKey) ||
        new Set([intent.body, ...intent.previousBodies]).size !== intent.previousBodies.length + 1
      )
        throw new StarterCopyStorageError();
      identities.add(identity);
      keys.add(request.idempotencyKey);
      for (const body of intent.previousBodies) {
        const previous = checkedBody(body, actor);
        if (
          previous.idempotencyKey !== request.idempotencyKey ||
          previous.locale !== request.locale
        )
          throw new StarterCopyStorageError();
      }
    }
    return value.intents;
  } catch {
    throw new StarterCopyStorageError();
  }
}

/** Stores only source identity and exact public request metadata, never template questions or answers. */
export function createStarterCopyIntentStore({
  actor,
  storage,
  now = Date.now,
  uuid = clientUuid,
}: {
  actor: StarterCopyActor;
  storage: Storage;
  now?: () => number;
  uuid?: () => string;
}) {
  const key = starterCopyStorageKey(actor);
  function read() {
    try {
      return parseStarterCopyIntents(storage.getItem(key), actor);
    } catch {
      throw new StarterCopyStorageError();
    }
  }
  function save(intents: StarterCopyIntent[]) {
    try {
      const raw = JSON.stringify({ version: 1, intents });
      parseStarterCopyIntents(raw, actor);
      if (intents.length) storage.setItem(key, raw);
      else storage.removeItem(key);
    } catch {
      throw new StarterCopyStorageError();
    }
  }
  function match(intents: StarterCopyIntent[], starterId: string, locale: SupportedLocale) {
    return intents.find(
      (intent) => intent.starterId === starterId && starterCopyRequest(intent).locale === locale,
    );
  }
  function replaceExact(intent: StarterCopyIntent, next: StarterCopyIntent | null) {
    const intents = read();
    const index = intents.findIndex(
      (entry) =>
        entry.starterId === intent.starterId &&
        entry.body === intent.body &&
        JSON.stringify(entry.previousBodies) === JSON.stringify(intent.previousBodies),
    );
    if (index < 0) throw new StarterCopyStorageError();
    if (next) intents[index] = next;
    else intents.splice(index, 1);
    save(intents);
    return next;
  }
  return {
    read,
    find(starterId: string, locale: SupportedLocale) {
      return match(read(), starterId, locale);
    },
    prepare(starterId: string, locale: SupportedLocale, contentVersion: string) {
      const intents = read();
      const existing = match(intents, starterId, locale);
      if (existing) return existing;
      const body = JSON.stringify(
        StarterCopyRequestSchema.parse({
          locale,
          idempotencyKey: uuid(),
          creationContext: actor,
          contentVersion,
          expiresAt: new Date(now() + ttl).toISOString(),
        }),
      );
      const intent = { starterId, body, previousBodies: [] };
      save([...intents, intent]);
      return intent;
    },
    renew(intent: StarterCopyIntent, contentVersion: string, reason: "renew" | "replace") {
      const previous = starterCopyRequest(intent);
      if (reason === "renew" && intent.previousBodies.length >= maxHistory)
        throw new StarterCopyStorageError();
      const renewedExpiry = now() + ttl;
      const request = StarterCopyRequestSchema.parse({
        ...previous,
        contentVersion,
        expiresAt: new Date(
          renewedExpiry === Date.parse(previous.expiresAt) ? renewedExpiry + 1 : renewedExpiry,
        ).toISOString(),
        ...(reason === "replace" ? { idempotencyKey: uuid() } : {}),
      });
      const next = {
        starterId: intent.starterId,
        body: JSON.stringify(request),
        previousBodies: reason === "replace" ? [] : [...intent.previousBodies, intent.body],
      };
      replaceExact(intent, next);
      return next;
    },
    recoverPrevious(intent: StarterCopyIntent) {
      const previous = intent.previousBodies.at(-1);
      if (!previous) return null;
      const next = {
        starterId: intent.starterId,
        body: previous,
        previousBodies: [intent.body, ...intent.previousBodies.slice(0, -1)],
      };
      replaceExact(intent, next);
      return next;
    },
    retire(intent: StarterCopyIntent) {
      const request = starterCopyRequest(intent);
      const existing = match(read(), intent.starterId, request.locale);
      if (!existing) return;
      replaceExact(intent, null);
    },
  };
}
