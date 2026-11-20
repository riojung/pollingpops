import { useCallback, useEffect, useRef, useState } from "react";
import type { AccountCreator } from "./load-account-settings";

export interface SettingsAuthority {
  creator: AccountCreator;
  signal: AbortSignal;
}

export type SectionReadState<T> = { status: "loading" | "error" } | { status: "ready"; data: T };

interface SectionScope<T> {
  authority: SettingsAuthority;
  state: SectionReadState<T>;
  selected: boolean;
  needsRead: boolean;
  request: AbortController | null;
}

function cancelRead<T>(scope: SectionScope<T>) {
  scope.request?.abort();
  scope.request = null;
}

export function useOwnerSettingsSection<T>(
  authority: SettingsAuthority | null,
  selected: boolean,
  read: (workspaceId: string, signal: AbortSignal) => Promise<T>,
) {
  const current = useRef<SectionScope<T> | null>(null);
  const [snapshot, setSnapshot] = useState<{
    authority: SettingsAuthority;
    state: SectionReadState<T>;
  } | null>(null);

  const publish = useCallback((scope: SectionScope<T>, state: SectionReadState<T>) => {
    scope.state = state;
    setSnapshot({ authority: scope.authority, state });
  }, []);

  const load = useCallback(
    async (scope: SectionScope<T>) => {
      if (scope.authority.signal.aborted || current.current !== scope || scope.request) return;
      const request = new AbortController();
      const acceptsResult = () =>
        current.current === scope &&
        scope.request === request &&
        !request.signal.aborted &&
        !scope.authority.signal.aborted;
      scope.request = request;
      scope.needsRead = false;
      publish(scope, { status: "loading" });
      try {
        const data = await read(scope.authority.creator.workspaceId, request.signal);
        if (acceptsResult()) publish(scope, { status: "ready", data });
      } catch {
        if (acceptsResult()) publish(scope, { status: "error" });
      } finally {
        if (scope.request === request) scope.request = null;
      }
    },
    [publish, read],
  );

  useEffect(() => {
    if (!authority || authority.signal.aborted) return;
    const scope: SectionScope<T> = {
      authority,
      state: { status: "loading" },
      selected: false,
      needsRead: true,
      request: null,
    };
    current.current = scope;
    const abort = () => cancelRead(scope);
    authority.signal.addEventListener("abort", abort, { once: true });
    // Both eligible sections start as soon as the required account snapshot is trusted.
    void load(scope);
    return () => {
      authority.signal.removeEventListener("abort", abort);
      current.current = null;
      abort();
    };
  }, [authority, load]);

  useEffect(() => {
    const scope = current.current;
    if (!scope || !selected) return;
    scope.selected = true;
    if (scope.needsRead) void load(scope);
    return () => {
      scope.selected = false;
      if (!scope.request) return;
      cancelRead(scope);
      scope.needsRead = true;
    };
  }, [authority, selected, load]);

  function currentScope() {
    const scope = current.current;
    return scope && scope.authority === authority && !scope.authority.signal.aborted ? scope : null;
  }

  function retry() {
    const scope = currentScope();
    if (scope?.selected && scope.state.status === "error") void load(scope);
  }

  function refresh() {
    const scope = currentScope();
    if (!scope) return;
    if (scope.selected) {
      void load(scope);
      return;
    }
    // A committed mutation can finish off-tab. Drop the old view and read again on return.
    scope.needsRead = true;
    publish(scope, { status: "loading" });
  }

  const state: SectionReadState<T> =
    snapshot && snapshot.authority === authority ? snapshot.state : { status: "loading" };
  return {
    state,
    retry,
    refresh,
    isCurrent: () => currentScope() !== null,
    isReady: () => {
      const scope = currentScope();
      return scope?.selected === true && scope.state.status === "ready";
    },
  };
}
