import {
  IdeaBoardGuestViewSchema,
  IdeaBoardPublicInfoSchema,
  IdeaBoardViewSchema,
  type IdeaBoardCreate,
  type IdeaBoardHostCommand,
} from "@openround/contracts";
import { apiFetch } from "./api";
import { clientUuid } from "./uuid";

export function ideaBoardPath(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    throw new Error("Invalid board");
  return `/v1/idea-boards/${id}`;
}

export function ideaBoardCredential(id: string, create = false) {
  ideaBoardPath(id);
  const key = `pollingpops:idea-board:${id}`;
  const existing = window.localStorage.getItem(key);
  if (existing && /^[a-f0-9]{64}$/.test(existing)) return existing;
  if (!create) return null;
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  window.localStorage.setItem(key, token);
  return token;
}

function guestOptions(token?: string): RequestInit {
  return {
    credentials: "omit",
    cache: "no-store",
    referrerPolicy: "no-referrer",
    ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
  };
}

export async function fetchIdeaBoard(id: string, signal?: AbortSignal) {
  const result = await apiFetch<{ board: unknown }>(ideaBoardPath(id), {
    signal,
    cache: "no-store",
  });
  const board = IdeaBoardViewSchema.parse(result.board);
  if (board.id !== id) throw new Error("Mismatched board");
  return board;
}

export async function fetchPublicIdeaBoard(id: string, signal?: AbortSignal) {
  const result = await apiFetch<{ board: unknown }>(`${ideaBoardPath(id)}/public`, {
    ...guestOptions(),
    signal,
  });
  const board = IdeaBoardPublicInfoSchema.parse(result.board);
  if (board.id !== id) throw new Error("Mismatched board");
  return board;
}

export async function fetchGuestIdeaBoard(id: string, token: string, signal?: AbortSignal) {
  const guest = IdeaBoardGuestViewSchema.parse(
    await apiFetch(`${ideaBoardPath(id)}/guest`, {
      ...guestOptions(token),
      signal,
    }),
  );
  if (guest.board.id !== id) throw new Error("Mismatched board");
  return guest;
}

export async function joinIdeaBoard(
  id: string,
  token: string,
  alias?: string,
  signal?: AbortSignal,
) {
  return IdeaBoardGuestViewSchema.parse(
    await apiFetch(`${ideaBoardPath(id)}/join`, {
      ...guestOptions(token),
      method: "POST",
      signal,
      body: JSON.stringify(alias === undefined ? {} : { alias }),
    }),
  );
}

export function ideaBoardCreateIntent(input: IdeaBoardCreate) {
  return { ...input, schemaVersion: 1 as const, idempotencyKey: clientUuid() };
}

export async function createIdeaBoard(
  input: ReturnType<typeof ideaBoardCreateIntent>,
  signal?: AbortSignal,
) {
  const result = await apiFetch<{ board: unknown }>("/v1/idea-boards", {
    method: "POST",
    body: JSON.stringify(input),
    signal,
  });
  return IdeaBoardViewSchema.parse(result.board);
}

export function ideaBoardCommandIntent(revision: number, command: IdeaBoardHostCommand) {
  return {
    schemaVersion: 1 as const,
    idempotencyKey: clientUuid(),
    expectedRevision: revision,
    command,
  };
}

export async function commandIdeaBoard(
  id: string,
  input: ReturnType<typeof ideaBoardCommandIntent>,
  signal?: AbortSignal,
) {
  const result = await apiFetch<{ board: unknown }>(`${ideaBoardPath(id)}/commands`, {
    method: "POST",
    body: JSON.stringify(input),
    signal,
  });
  return IdeaBoardViewSchema.parse(result.board);
}

export async function submitBoardIdea(
  id: string,
  token: string,
  input: { schemaVersion: 1; idempotencyKey: string; body: string },
  signal?: AbortSignal,
) {
  return IdeaBoardGuestViewSchema.parse(
    await apiFetch(`${ideaBoardPath(id)}/ideas`, {
      ...guestOptions(token),
      method: "POST",
      body: JSON.stringify(input),
      signal,
    }),
  );
}

export async function submitBoardVotes(
  id: string,
  token: string,
  input: { schemaVersion: 1; idempotencyKey: string; expectedRevision: number; ideaIds: string[] },
  signal?: AbortSignal,
) {
  return IdeaBoardGuestViewSchema.parse(
    await apiFetch(`${ideaBoardPath(id)}/votes`, {
      ...guestOptions(token),
      method: "PUT",
      body: JSON.stringify(input),
      signal,
    }),
  );
}
