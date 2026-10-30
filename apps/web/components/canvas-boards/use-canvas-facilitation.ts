"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CanvasFacilitationCommand,
  CanvasFacilitationMutation,
  CanvasFacilitationView,
} from "@openround/contracts";
import { ApiClientError, AUTH_CHANGE_EVENT } from "../../lib/api";
import {
  facilitationIntent,
  readCanvasFacilitation,
  writeCanvasFacilitation,
} from "./canvas-facilitation-client";

export function useCanvasFacilitation(id: string, canvasSeq: number) {
  const [view, setView] = useState<CanvasFacilitationView | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<"read" | "save" | null>(null);
  const [authRevision, setAuthRevision] = useState(0);
  const [failure, setFailure] = useState<{
    id: string;
    operation: CanvasFacilitationMutation;
    conflict: boolean;
  } | null>(null);
  const current = useRef(id);
  current.current = id;
  const context = useRef<{ id: string; abort: AbortController } | null>(null);
  const pending = useRef<CanvasFacilitationMutation | null>(null);
  const writing = useRef(false);
  const reading = useRef<Promise<void> | null>(null);
  const dirtyRead = useRef(false);
  const observed = useRef({ id, canvasSeq });
  const accept = useCallback((next: CanvasFacilitationView) => {
    if (next.boardId !== current.current) return;
    setView((old) =>
      old?.boardId === next.boardId &&
      (old.canvasSeq > next.canvasSeq ||
        (old.canvasSeq === next.canvasSeq &&
          Date.parse(old.serverNow) > Date.parse(next.serverNow)))
        ? old
        : next,
    );
    setError(null);
  }, []);
  const refresh = useCallback(async () => {
    const active = context.current;
    if (!active || active.id !== id || active.abort.signal.aborted) return;
    dirtyRead.current = true;
    if (reading.current) return reading.current;
    const work = (async () => {
      do {
        dirtyRead.current = false;
        try {
          const next = await readCanvasFacilitation(id, active.abort.signal);
          if (context.current === active && !active.abort.signal.aborted) accept(next);
        } catch (cause) {
          if (context.current !== active || active.abort.signal.aborted) return;
          if (cause instanceof ApiClientError && [401, 403, 404, 410].includes(cause.status))
            setView(null);
          setError("read");
        } finally {
          if (context.current === active && !active.abort.signal.aborted) setLoading(false);
        }
      } while (dirtyRead.current && context.current === active && !active.abort.signal.aborted);
    })();
    reading.current = work;
    await work;
    if (reading.current === work) reading.current = null;
  }, [id, accept]);
  useEffect(() => {
    const active = { id, abort: new AbortController() };
    context.current = active;
    reading.current = null;
    pending.current = null;
    writing.current = false;
    setView(null);
    setFailure(null);
    setSaving(false);
    setLoading(true);
    void refresh();
    const interval = window.setInterval(() => void refresh(), 5000);
    const changed = () => {
      active.abort.abort();
      setView(null);
      setFailure(null);
      pending.current = null;
      setAuthRevision((revision) => revision + 1);
    };
    window.addEventListener(AUTH_CHANGE_EVENT, changed);
    return () => {
      active.abort.abort();
      window.clearInterval(interval);
      window.removeEventListener(AUTH_CHANGE_EVENT, changed);
    };
  }, [id, refresh, authRevision]);
  useEffect(() => {
    const previous = observed.current;
    observed.current = { id, canvasSeq };
    if (previous.id === id && previous.canvasSeq !== canvasSeq) void refresh();
  }, [id, canvasSeq, refresh]);
  async function execute(command?: CanvasFacilitationCommand) {
    const active = context.current;
    if (!active || active.id !== id || active.abort.signal.aborted || writing.current) return false;
    if (!pending.current && command) {
      try {
        pending.current = facilitationIntent(command);
      } catch {
        setError("save");
        return false;
      }
    }
    const operation = pending.current;
    if (!operation) return false;
    writing.current = true;
    setSaving(true);
    setFailure(null);
    try {
      const result = await writeCanvasFacilitation(id, operation, active.abort.signal);
      if (context.current !== active || active.abort.signal.aborted || current.current !== id)
        return false;
      pending.current = null;
      accept(result.facilitation);
      return true;
    } catch (cause) {
      if (context.current !== active || active.abort.signal.aborted) return false;
      setFailure({
        id,
        operation,
        conflict: cause instanceof ApiClientError && cause.status === 409,
      });
      await refresh();
      return false;
    } finally {
      if (context.current === active) {
        writing.current = false;
        setSaving(false);
      }
    }
  }
  function discard() {
    if (writing.current) return;
    pending.current = null;
    setFailure(null);
  }
  return {
    view: view?.boardId === id ? view : null,
    loading,
    saving,
    error,
    failure: failure?.id === id ? failure : null,
    refresh,
    execute,
    discard,
  };
}
