"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CanvasArtifactLinkListSchema } from "@openround/contracts";
import { ApiClientError, AUTH_CHANGE_EVENT } from "../../lib/api";
import {
  listCanvasArtifactLinks,
  writeCanvasArtifactLink,
  type CanvasArtifactPending,
  type CanvasArtifactTarget,
} from "./client";
type List = ReturnType<typeof CanvasArtifactLinkListSchema.parse>;
export function useCanvasArtifactLinks(target: CanvasArtifactTarget) {
  const [list, setList] = useState<List | null>(null);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<{ conflict: boolean; retryable: boolean } | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [accessEpoch, setAccessEpoch] = useState(0);
  const pending = useRef<CanvasArtifactPending | null>(null);
  const writing = useRef(false),
    generation = useRef(0);
  const lifetime = useRef<AbortController | null>(null);
  const reading = useRef<Promise<void> | null>(null),
    again = useRef(false);
  const kind = target.kind,
    targetId = target.targetId;
  const refresh = useCallback(async () => {
    const active = lifetime.current;
    if (!active || active.signal.aborted || writing.current) return;
    again.current = true;
    if (reading.current) return reading.current;
    const work = (async () => {
      do {
        again.current = false;
        const version = generation.current;
        try {
          const next = await listCanvasArtifactLinks({ kind, targetId }, active.signal);
          if (lifetime.current !== active || active.signal.aborted) return;
          if (version !== generation.current) {
            again.current = true;
            continue;
          }
          setList(next);
          setError(false);
        } catch {
          if (lifetime.current !== active || active.signal.aborted) return;
          setList(null);
          setError(true);
          setAccessEpoch((value) => value + 1);
        }
      } while (again.current && !writing.current && !active.signal.aborted);
    })();
    reading.current = work;
    await work;
    if (reading.current === work) reading.current = null;
  }, [kind, targetId]);
  useEffect(() => {
    const active = new AbortController();
    lifetime.current = active;
    pending.current = null;
    writing.current = false;
    reading.current = null;
    generation.current++;
    setList(null);
    setFailure(null);
    setError(false);
    setSaving(false);
    setAccessEpoch((value) => value + 1);
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    const changed = () => {
      active.abort();
      pending.current = null;
      setList(null);
      setFailure(null);
      setAccessEpoch((value) => value + 1);
      setEpoch((value) => value + 1);
    };
    window.addEventListener(AUTH_CHANGE_EVENT, changed);
    return () => {
      active.abort();
      clearInterval(timer);
      window.removeEventListener(AUTH_CHANGE_EVENT, changed);
    };
  }, [kind, targetId, refresh, epoch]);
  async function execute(intent?: CanvasArtifactPending) {
    const active = lifetime.current;
    if (!active || active.signal.aborted || writing.current) return false;
    if (intent && !pending.current) pending.current = intent;
    const operation = pending.current;
    if (!operation) return false;
    writing.current = true;
    generation.current++;
    setSaving(true);
    setFailure(null);
    setAccessEpoch((value) => value + 1);
    let success = false;
    try {
      await writeCanvasArtifactLink({ kind, targetId }, operation, active.signal);
      if (lifetime.current !== active || active.signal.aborted) return false;
      pending.current = null;
      success = true;
    } catch (error) {
      if (lifetime.current !== active || active.signal.aborted) return false;
      setFailure({
        conflict: error instanceof ApiClientError && error.status === 409,
        retryable:
          !(error instanceof ApiClientError) || error.status === 429 || error.status >= 500,
      });
      setList(null);
      setAccessEpoch((value) => value + 1);
    } finally {
      if (lifetime.current === active && !active.signal.aborted) {
        writing.current = false;
        setSaving(false);
        await refresh();
      }
    }
    return success;
  }
  function discard() {
    if (!writing.current) {
      pending.current = null;
      setFailure(null);
    }
  }
  return {
    list,
    error,
    saving,
    failure,
    accessEpoch,
    pending: pending.current,
    refresh,
    execute,
    discard,
  };
}
