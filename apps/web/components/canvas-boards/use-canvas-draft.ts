"use client";

import { useEffect, useState } from "react";
import type { CanvasBoardView } from "@openround/contracts";
import { AUTH_CHANGE_EVENT } from "../../lib/api";
import { resolveCanvasDraft, type CanvasObjectDraft } from "./canvas-draft";

export function useCanvasDraft(
  boardId: string,
  board: CanvasBoardView | null,
  options: {
    locked: boolean;
    pending: boolean;
    confirmDiscard: () => boolean;
    onDiscardPending: () => void;
  },
) {
  const [state, setState] = useState<{
    selectedId: string | null;
    draft: CanvasObjectDraft | null;
  }>({ selectedId: null, draft: null });
  useEffect(() => {
    const reset = () => setState({ selectedId: null, draft: null });
    reset();
    window.addEventListener(AUTH_CHANGE_EVENT, reset);
    return () => window.removeEventListener(AUTH_CHANGE_EVENT, reset);
  }, [boardId]);
  function select(next: string | null) {
    if (next === state.selectedId) return true;
    if (options.locked) return false;
    if ((state.draft || options.pending) && !options.confirmDiscard()) return false;
    if (options.pending) options.onDiscardPending();
    setState({ selectedId: next, draft: null });
    return true;
  }
  return {
    ...state,
    ...resolveCanvasDraft(board, state.selectedId, state.draft),
    select,
    /** Use only after an accepted local operation whose draft replacement was authorized. */
    acceptSelection: (selectedId: string | null) => setState({ selectedId, draft: null }),
    setDraft: (draft: CanvasObjectDraft | null) => setState((current) => ({ ...current, draft })),
  };
}
