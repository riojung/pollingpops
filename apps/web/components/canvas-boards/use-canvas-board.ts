"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CanvasBoardCommand,
  CanvasBoardMutation,
  CanvasBoardView,
} from "@openround/contracts";
import { AUTH_CHANGE_EVENT, ApiClientError, humanError } from "../../lib/api";
import { canvasIntent, readCanvas, watchCanvas, writeCanvas } from "./canvas-client";

interface Snapshot {
  id: string;
  board: CanvasBoardView | null;
  error: string;
  loading: boolean;
}
function retryAfter(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
  });
}
export function useCanvasBoard(id: string) {
  const [snapshot, setSnapshot] = useState<Snapshot>({
    id: "",
    board: null,
    error: "",
    loading: true,
  });
  const [saving, setSaving] = useState(false);
  const [authRevision, setAuthRevision] = useState(0);
  const [connection, setConnection] = useState<"saved" | "reconnecting" | "offline" | "polling">(
    "reconnecting",
  );
  const [failure, setFailure] = useState<{
    id: string;
    operation: CanvasBoardMutation;
    conflict: boolean;
    error: string;
  } | null>(null);
  const current = useRef(id);
  current.current = id;
  const controller = useRef<AbortController | null>(null);
  const pending = useRef<CanvasBoardMutation | null>(null);
  const inFlight = useRef(false);
  const refreshInFlight = useRef<Promise<void> | null>(null);
  const refreshRequested = useRef(false);
  const liveState = useRef<"live" | "reconnecting" | "polling">("reconnecting");
  const snapshotAvailable = useRef(false);
  const accessRevision = useRef(0);
  const accept = useCallback(
    (board: CanvasBoardView) => {
      if (current.current !== board.id || controller.current?.signal.aborted) return;
      setSnapshot((previous) =>
        previous.id === id &&
        previous.board &&
        (previous.board.canvasSeq > board.canvasSeq ||
          (previous.board.canvasSeq === board.canvasSeq &&
            (previous.board.sourceBoard?.revision ?? 0) > (board.sourceBoard?.revision ?? 0)))
          ? previous
          : { id, board, error: "", loading: false },
      );
      snapshotAvailable.current = true;
      setConnection(liveState.current === "live" ? "saved" : liveState.current);
    },
    [id],
  );
  const refresh = useCallback(async () => {
    refreshRequested.current = true;
    if (refreshInFlight.current) return refreshInFlight.current;
    const active = controller.current;
    const work = (async () => {
      do {
        refreshRequested.current = false;
        const revision = accessRevision.current;
        try {
          const board = await readCanvas(id, active?.signal);
          if (!active?.signal.aborted && revision === accessRevision.current) accept(board);
        } catch (error) {
          if (current.current !== id || active?.signal.aborted) return;
          if (revision !== accessRevision.current) continue;
          const denied =
            error instanceof ApiClientError && [401, 403, 404, 410].includes(error.status);
          setSnapshot((previous) => ({
            id,
            board: denied ? null : previous.id === id ? previous.board : null,
            loading: false,
            error: humanError(error),
          }));
          setConnection("offline");
          snapshotAvailable.current = false;
          if (denied) {
            pending.current = null;
            setFailure(null);
            active?.abort();
          }
        }
      } while (refreshRequested.current && current.current === id && !active?.signal.aborted);
    })();
    refreshInFlight.current = work;
    await work;
    if (refreshInFlight.current === work) refreshInFlight.current = null;
  }, [accept, id]);
  useEffect(() => {
    const active = new AbortController();
    controller.current = active;
    let notificationTimer: ReturnType<typeof setTimeout> | undefined;
    pending.current = null;
    inFlight.current = false;
    refreshInFlight.current = null;
    setFailure(null);
    setSaving(false);
    snapshotAvailable.current = false;
    liveState.current = "reconnecting";
    setConnection("reconnecting");
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    const stopTimers = () => {
      window.clearInterval(timer);
      if (notificationTimer) clearTimeout(notificationTimer);
    };
    active.signal.addEventListener("abort", stopTimers, { once: true });
    async function watch() {
      let retryMs = 1000;
      while (!active.signal.aborted) {
        let revoked = false;
        let polling = false;
        try {
          await watchCanvas(
            id,
            active.signal,
            () => {
              if (active.signal.aborted) return;
              retryMs = 1000;
              liveState.current = "live";
              setConnection(snapshotAvailable.current ? "saved" : "reconnecting");
              if (notificationTimer) return;
              notificationTimer = setTimeout(() => {
                notificationTimer = undefined;
                void refresh();
              }, 350);
            },
            () => {
              if (active.signal.aborted) return;
              revoked = true;
              accessRevision.current += 1;
              snapshotAvailable.current = false;
              setSnapshot({ id, board: null, loading: true, error: "" });
              pending.current = null;
              setFailure(null);
            },
          );
        } catch (error) {
          if (active.signal.aborted) return;
          polling = error instanceof ApiClientError && [403, 404].includes(error.status);
          if (error instanceof ApiClientError && [401, 403, 404, 410].includes(error.status))
            revoked = true;
        }
        if (active.signal.aborted) return;
        liveState.current = polling ? "polling" : "reconnecting";
        setConnection(snapshotAvailable.current ? liveState.current : "offline");
        // Stream policy pauses and lost authorization share a denial shape. Only a
        // fresh authorized snapshot can restore content after a revocation event.
        if (revoked) await refresh();
        if (active.signal.aborted) return;
        await retryAfter(polling ? 30000 : retryMs, active.signal);
        retryMs = Math.min(retryMs * 2, 15000);
      }
    }
    void watch();
    const authorizationChanged = () => {
      active.abort();
      setSnapshot({ id, board: null, error: "", loading: true });
      setAuthRevision((value) => value + 1);
    };
    window.addEventListener(AUTH_CHANGE_EVENT, authorizationChanged);
    return () => {
      active.abort();
      active.signal.removeEventListener("abort", stopTimers);
      window.removeEventListener(AUTH_CHANGE_EVENT, authorizationChanged);
    };
  }, [id, refresh, authRevision]);

  async function execute(command?: CanvasBoardCommand) {
    if (inFlight.current || current.current !== id || controller.current?.signal.aborted)
      return false;
    if (!pending.current && command) pending.current = canvasIntent(command);
    const operation = pending.current;
    if (!operation) return false;
    inFlight.current = true;
    setSaving(true);
    setFailure(null);
    const active = controller.current;
    try {
      const result = await writeCanvas(id, operation, active?.signal);
      if (current.current !== id || active?.signal.aborted) return false;
      pending.current = null;
      accept(result.board);
      return true;
    } catch (error) {
      if (current.current !== id || active?.signal.aborted) return false;
      const conflict = error instanceof ApiClientError && error.status === 409;
      const denied = error instanceof ApiClientError && [401, 403, 404, 410].includes(error.status);
      if (denied) {
        pending.current = null;
        setFailure(null);
        await refresh();
      } else {
        setFailure({ id, operation, conflict, error: humanError(error) });
        await refresh();
      }
      return false;
    } finally {
      if (controller.current === active) {
        inFlight.current = false;
        if (current.current === id) setSaving(false);
      }
    }
  }
  function discard() {
    pending.current = null;
    setFailure(null);
  }
  return {
    board: snapshot.id === id ? snapshot.board : null,
    loading: snapshot.id !== id || snapshot.loading,
    error: snapshot.id === id ? snapshot.error : "",
    saving,
    connection,
    failure: failure?.id === id ? failure : null,
    refresh,
    execute,
    discard,
  };
}
