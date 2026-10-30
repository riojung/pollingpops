"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CanvasGuestPresenterViewSchema,
  CanvasPresenterViewSchema,
  CanvasPresenterMutationSchema,
  type CanvasPresenterMutation,
  type CanvasPresenterView,
  type CanvasGuestPresenterView,
} from "@openround/contracts";
import { API_URL, AUTH_CHANGE_EVENT, ApiClientError, apiFetch } from "../../lib/api";
import { canvasPath } from "./canvas-client";

type View = CanvasPresenterView | CanvasGuestPresenterView;
export function useCanvasPresenter(
  boardId: string,
  guest?: { sourceBoardId: string; token: string },
) {
  const guestMode = guest !== undefined;
  const sourceId = guest?.sourceBoardId,
    token = guest?.token;
  const [epoch, setEpoch] = useState(0);
  const [state, setState] = useState<{ key: string; view: View | null; expires: number | null }>({
    key: "",
    view: null,
    expires: null,
  });
  const [error, setError] = useState(false);
  const [working, setWorking] = useState(false);
  const writing = useRef<AbortController | null>(null);
  const mutationGeneration = useRef(0);
  const lifetime = useRef<AbortController | null>(null);
  const key = JSON.stringify([boardId, sourceId, token, epoch]);
  const refresh = useCallback(() => setEpoch((value) => value + 1), []);
  const request = useCallback(
    async (signal: AbortSignal, input?: CanvasPresenterMutation): Promise<View> => {
      const path = canvasPath(boardId);
      const controller = new AbortController();
      const abort = () => controller.abort();
      if (signal.aborted) abort();
      signal.addEventListener("abort", abort, { once: true });
      const timeout = setTimeout(abort, 8_000);
      try {
        let response: unknown;
        if (guestMode) {
          if (!token || !sourceId) throw new Error("Workshop credential is required");
          if (input) throw new Error("Guest presentation is read only");
          canvasPath(sourceId);
          if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("Invalid workshop credential");
          const result = await fetch(
            `${API_URL}/v1/canvas-boards/workshop/${sourceId}/guest/presenter`,
            {
              credentials: "omit",
              cache: "no-store",
              referrerPolicy: "no-referrer",
              signal: controller.signal,
              headers: { authorization: `Bearer ${token}` },
            },
          );
          if (!result.ok)
            throw new ApiClientError(
              "Presentation unavailable",
              "PRESENTATION_UNAVAILABLE",
              result.status,
            );
          response = await result.json();
        } else {
          response = await apiFetch(`${path}/presenter`, {
            signal: controller.signal,
            ...(input
              ? { method: "POST", body: JSON.stringify(CanvasPresenterMutationSchema.parse(input)) }
              : {}),
          });
        }
        const raw = (response as { presenter?: unknown })?.presenter;
        const parsed = guestMode
          ? CanvasGuestPresenterViewSchema.parse(raw)
          : CanvasPresenterViewSchema.parse(raw);
        if (parsed.boardId !== boardId) throw new Error("Presentation belongs to another board");
        return parsed;
      } finally {
        clearTimeout(timeout);
        signal.removeEventListener("abort", abort);
      }
    },
    [boardId, sourceId, token, guestMode],
  );
  const accept = useCallback((view: View, activeKey: string) => {
    const ttl =
      view.active && view.expiresAt
        ? Date.parse(view.expiresAt) - Date.parse(view.serverNow)
        : null;
    setState((previous) => {
      if (
        previous.key === activeKey &&
        view.sessionId &&
        previous.view?.sessionId === view.sessionId &&
        previous.view.revision > view.revision
      )
        return previous;
      return {
        key: activeKey,
        view: ttl !== null && ttl <= 0 ? null : view,
        expires: ttl === null ? null : performance.now() + ttl,
      };
    });
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    writing.current = null;
    setWorking(false);
    let reading = false;
    setError(false);
    setState({ key, view: null, expires: null });
    async function read() {
      if (reading || writing.current || controller.signal.aborted) return;
      const generation = mutationGeneration.current;
      reading = true;
      try {
        const view = await request(controller.signal);
        if (
          !controller.signal.aborted &&
          generation === mutationGeneration.current &&
          !writing.current
        ) {
          accept(view, key);
          setError(false);
        }
      } catch (failure) {
        if (
          !controller.signal.aborted &&
          generation === mutationGeneration.current &&
          !writing.current
        ) {
          setError(true);
          if (failure instanceof ApiClientError && [401, 403, 404, 410].includes(failure.status)) {
            setState({ key, view: null, expires: null });
            controller.abort();
          }
        }
      } finally {
        reading = false;
      }
    }
    void read();
    const timer = setInterval(() => {
      setState((previous) =>
        previous.key === key && previous.expires !== null && previous.expires <= performance.now()
          ? { ...previous, view: null, expires: null }
          : previous,
      );
      void read();
    }, 1_000);
    const changed = () => {
      controller.abort();
      setState({ key: "", view: null, expires: null });
      refresh();
    };
    if (!guestMode) window.addEventListener(AUTH_CHANGE_EVENT, changed);
    return () => {
      controller.abort();
      clearInterval(timer);
      if (!guestMode) window.removeEventListener(AUTH_CHANGE_EVENT, changed);
      if (lifetime.current === controller) lifetime.current = null;
    };
  }, [key, request, accept, refresh, guestMode]);
  const command = useCallback(
    async (input: CanvasPresenterMutation) => {
      const controller = lifetime.current;
      if (writing.current || !controller || controller.signal.aborted || guestMode) return false;
      writing.current = controller;
      mutationGeneration.current++;
      setWorking(true);
      try {
        const view = await request(controller.signal, input);
        if (controller.signal.aborted || lifetime.current !== controller) return false;
        accept(view, key);
        setError(false);
        return true;
      } catch {
        if (!controller.signal.aborted) {
          setError(true);
          refresh();
        }
        return false;
      } finally {
        if (writing.current === controller) writing.current = null;
        if (lifetime.current === controller && !controller.signal.aborted) setWorking(false);
      }
    },
    [request, key, accept, refresh, guestMode],
  );
  return { view: state.key === key ? state.view : null, error, working, command, refresh };
}
