"use client";

import { useEffect, useRef, useState } from "react";
import type { CanvasBoardView, IdeaBoardView } from "@openround/contracts";
import { ApiClientError } from "../../lib/api";
import { listIdeaBoards } from "../../lib/idea-board-client";
import { listCanvases } from "../canvas-boards/canvas-client";

export type BoardLibraryScope = "all" | "owned" | "shared" | "archived";
interface Page {
  boards: IdeaBoardView[];
  canvases: CanvasBoardView[];
  nextCursor: string | null;
  canvasNextCursor: string | null;
}
interface Snapshot {
  key: string;
  data: Page | null;
  busy: boolean;
  error: boolean;
}
export function useBoardLibrary({
  workspaceId,
  scope,
  search,
  refresh,
  canvasEnabled,
}: {
  workspaceId: string | undefined;
  scope: BoardLibraryScope;
  search: string;
  refresh: number;
  canvasEnabled: boolean;
}) {
  const query = search.normalize("NFC").trim();
  const key = JSON.stringify([workspaceId ?? null, scope, query, refresh, canvasEnabled]);
  const currentKey = useRef(key);
  currentKey.current = key;
  const controller = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const [snapshot, setSnapshot] = useState<Snapshot>({
    key: "",
    data: null,
    busy: true,
    error: false,
  });
  async function canvases(signal: AbortSignal, cursor?: string | null) {
    try {
      return await listCanvases(scope, signal, cursor, query);
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 404 && !canvasEnabled)
        return { boards: [], nextCursor: null };
      throw error;
    }
  }
  useEffect(() => {
    const active = new AbortController();
    controller.current = active;
    inFlight.current = true;
    setSnapshot({ key, data: null, busy: Boolean(workspaceId), error: false });
    async function load() {
      if (!workspaceId || active.signal.aborted) return;
      try {
        const [legacy, canvas] = await Promise.all([
          scope === "all" || scope === "owned"
            ? listIdeaBoards(query, active.signal)
            : Promise.resolve({ boards: [], nextCursor: null }),
          canvases(active.signal),
        ]);
        if (!active.signal.aborted && currentKey.current === key && controller.current === active)
          setSnapshot({
            key,
            data: {
              boards: legacy.boards,
              canvases: canvas.boards,
              nextCursor: legacy.nextCursor,
              canvasNextCursor: canvas.nextCursor,
            },
            busy: false,
            error: false,
          });
      } catch {
        if (!active.signal.aborted && currentKey.current === key && controller.current === active)
          setSnapshot({ key, data: null, busy: false, error: true });
      } finally {
        if (controller.current === active) inFlight.current = false;
      }
    }
    // A new query invalidates old rows immediately; only the request itself is debounced.
    const timer = query ? setTimeout(() => void load(), 300) : undefined;
    if (!query) void load();
    return () => {
      active.abort();
      if (timer) clearTimeout(timer);
    };
    // The key includes every request input; the helper only closes over those same inputs.
  }, [key]);
  const current = snapshot.key === key ? snapshot : null;
  async function more() {
    const page = current?.data,
      active = controller.current;
    if (
      !page ||
      currentKey.current !== key ||
      (!page.nextCursor && !page.canvasNextCursor) ||
      inFlight.current ||
      !active ||
      active.signal.aborted
    )
      return;
    inFlight.current = true;
    setSnapshot((previous) => ({ ...previous, busy: true, error: false }));
    try {
      const [legacy, canvas] = await Promise.all([
        page.nextCursor
          ? listIdeaBoards(query, active.signal, page.nextCursor)
          : Promise.resolve({ boards: [], nextCursor: null }),
        page.canvasNextCursor
          ? canvases(active.signal, page.canvasNextCursor)
          : Promise.resolve({ boards: [], nextCursor: null }),
      ]);
      if (!active.signal.aborted && currentKey.current === key && controller.current === active)
        setSnapshot({
          key,
          data: {
            boards: [...page.boards, ...legacy.boards],
            canvases: [...page.canvases, ...canvas.boards],
            nextCursor: legacy.nextCursor,
            canvasNextCursor: canvas.nextCursor,
          },
          busy: false,
          error: false,
        });
    } catch {
      if (!active.signal.aborted && currentKey.current === key && controller.current === active)
        setSnapshot((previous) => ({ ...previous, busy: false, error: true }));
    } finally {
      if (controller.current === active) inFlight.current = false;
    }
  }
  return {
    data: current?.data ?? null,
    error: current?.error ?? false,
    busy: current?.busy ?? true,
    more,
  };
}
