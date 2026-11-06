import {
  CreatePresentationAssistanceJobSchema,
  CreatePresentationSchema,
} from "@openround/contracts";
import { ApiClientError, apiFetch, humanError } from "./api";
import { clientUuid } from "./uuid";

interface Actor {
  userId: string;
  workspaceId: string;
}

export interface OutlineDraftRecovery extends Actor {
  schemaVersion: 1;
  body: string;
  presentationId: string | null;
  deleted: boolean;
}

export interface OutlineDraftCreationState {
  ready: boolean;
  recovery: OutlineDraftRecovery | null;
  busy: boolean;
  error: string;
}

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;
type Request = <T>(path: string, init?: RequestInit) => Promise<T>;
const uuid = CreatePresentationAssistanceJobSchema.shape.presentationId;
const recoveryError = "The saved draft request could not be verified. No new request was sent.";
const storageError =
  "This browser cannot save draft creation recovery. Allow tab storage and retry.";

export const initialOutlineDraftCreationState = (): OutlineDraftCreationState => ({
  ready: false,
  recovery: null,
  busy: false,
  error: "",
});

export function outlineDraftRecoveryKey(actor: Actor) {
  return `presentation-outline-start:v1:${actor.userId}:${actor.workspaceId}`;
}

function parseBody(body: string) {
  const value = JSON.parse(body) as Record<string, unknown>;
  if (
    !value ||
    typeof value !== "object" ||
    Object.keys(value).length !== 5 ||
    Object.keys(value).some(
      (key) =>
        !["creationRequestId", "creationContext", "title", "description", "initialSlide"].includes(
          key,
        ),
    ) ||
    uuid.parse(value.creationRequestId) !== value.creationRequestId ||
    CreatePresentationSchema.shape.title.parse(value.title) !== value.title ||
    value.description !== "" ||
    value.initialSlide !== "native"
  )
    throw new Error(recoveryError);
  const context = value.creationContext as Record<string, unknown>;
  if (
    !context ||
    typeof context !== "object" ||
    Object.keys(context).length !== 2 ||
    Object.keys(context).some((key) => !["actorId", "workspaceId"].includes(key)) ||
    uuid.parse(context.actorId) !== context.actorId ||
    uuid.parse(context.workspaceId) !== context.workspaceId
  )
    throw new Error(recoveryError);
  return value as {
    creationRequestId: string;
    creationContext: { actorId: string; workspaceId: string };
    title: string;
    description: "";
    initialSlide: "native";
  };
}

export function parseOutlineDraftRecovery(raw: string, actor: Actor): OutlineDraftRecovery {
  try {
    if (raw.length > 4_096) throw new Error(recoveryError);
    const value = JSON.parse(raw) as OutlineDraftRecovery;
    if (
      !value ||
      typeof value !== "object" ||
      Object.keys(value).length !== 6 ||
      Object.keys(value).some(
        (key) =>
          !["schemaVersion", "userId", "workspaceId", "body", "presentationId", "deleted"].includes(
            key,
          ),
      ) ||
      value.schemaVersion !== 1 ||
      value.userId !== actor.userId ||
      value.workspaceId !== actor.workspaceId ||
      typeof value.body !== "string" ||
      typeof value.deleted !== "boolean" ||
      (value.deleted && value.presentationId !== null) ||
      (value.presentationId !== null && uuid.parse(value.presentationId) !== value.presentationId)
    )
      throw new Error(recoveryError);
    const body = parseBody(value.body);
    if (
      body.creationContext.actorId !== actor.userId ||
      body.creationContext.workspaceId !== actor.workspaceId
    )
      throw new Error(recoveryError);
    return value;
  } catch {
    throw new Error(recoveryError);
  }
}

export function outlineDraftTitle(recovery: OutlineDraftRecovery) {
  return parseBody(recovery.body).title;
}

/** Creation recovery contains only the exact title/identity request and its known deck ID. */
export function createOutlineDraftCreation({
  actor,
  storage,
  canEdit,
  onState,
  onCreated,
  request = apiFetch,
}: {
  actor: Actor;
  storage: Storage;
  canEdit: () => boolean;
  onState: (state: OutlineDraftCreationState) => void;
  onCreated: (presentationId: string) => void;
  request?: Request;
}) {
  const key = outlineDraftRecoveryKey(actor);
  let state = initialOutlineDraftCreationState();
  let cancelled = false;
  let abort: AbortController | null = null;
  const current = () => !cancelled && canEdit();
  const publish = (next: OutlineDraftCreationState) => {
    state = next;
    onState(next);
  };
  function persist(value: OutlineDraftRecovery | null) {
    try {
      if (value) storage.setItem(key, JSON.stringify(value));
      else storage.removeItem(key);
    } catch {
      throw new Error(storageError);
    }
  }
  async function attempt() {
    if (!current() || !state.ready || state.busy || !state.recovery || state.recovery.deleted)
      return;
    if (state.recovery.presentationId) {
      onCreated(state.recovery.presentationId);
      return;
    }
    // Verify recovery remains writable before any network mutation, including an exact retry.
    try {
      persist(state.recovery);
    } catch (error) {
      publish({ ...state, error: humanError(error) });
      return;
    }
    abort = new AbortController();
    publish({ ...state, busy: true, error: "" });
    try {
      const response = await request<{ presentation: { id: unknown } }>(
        "/v1/presentations/outline-drafts",
        {
          method: "POST",
          body: state.recovery!.body,
          signal: abort.signal,
        },
      );
      if (!current()) return;
      const parsed = uuid.safeParse(response?.presentation?.id);
      if (!parsed.success)
        throw new Error(
          "The draft creation acknowledgement could not be verified. Retry draft creation.",
        );
      const recovery = { ...state.recovery!, presentationId: parsed.data };
      // Keep the known ID in memory even if storage became unavailable after the server accepted.
      publish({ ...state, recovery, busy: false });
      persist(recovery);
      if (current()) onCreated(recovery.presentationId);
    } catch (error) {
      if (!current()) return;
      if (error instanceof ApiClientError && error.status === 410) {
        const recovery = { ...state.recovery!, deleted: true };
        publish({ ...state, recovery, busy: false, error: humanError(error) });
        try {
          persist(recovery);
        } catch (storageFailure) {
          publish({ ...state, error: humanError(storageFailure) });
        }
      } else publish({ ...state, busy: false, error: humanError(error) });
    }
  }
  return {
    state: () => state,
    restore() {
      if (cancelled || state.busy) return;
      try {
        let raw: string | null;
        try {
          raw = storage.getItem(key);
        } catch {
          throw new Error(storageError);
        }
        const recovery = raw ? parseOutlineDraftRecovery(raw, actor) : null;
        publish({ ready: true, recovery, busy: false, error: "" });
      } catch (error) {
        publish({ ...state, ready: false, error: humanError(error) });
      }
    },
    async create(title: string) {
      if (!current() || !state.ready || state.busy || state.recovery) return;
      try {
        const body = JSON.stringify({
          creationRequestId: uuid.parse(clientUuid()),
          creationContext: {
            actorId: uuid.parse(actor.userId),
            workspaceId: uuid.parse(actor.workspaceId),
          },
          title: CreatePresentationSchema.shape.title.parse(title.trim()),
          description: "",
          initialSlide: "native",
        });
        const recovery: OutlineDraftRecovery = {
          schemaVersion: 1,
          ...actor,
          body,
          presentationId: null,
          deleted: false,
        };
        persist(recovery);
        publish({ ...state, recovery, error: "" });
        await attempt();
      } catch (error) {
        if (current()) publish({ ...state, error: humanError(error) });
      }
    },
    retry: attempt,
    openSaved() {
      if (current() && !state.busy && state.recovery?.presentationId)
        onCreated(state.recovery.presentationId);
    },
    startAnother() {
      if (!current() || state.busy || !(state.recovery?.presentationId || state.recovery?.deleted))
        return false;
      try {
        persist(null);
        publish({ ready: true, recovery: null, busy: false, error: "" });
        return true;
      } catch (error) {
        publish({ ...state, error: humanError(error) });
        return false;
      }
    },
    cancel() {
      cancelled = true;
      abort?.abort();
    },
  };
}
