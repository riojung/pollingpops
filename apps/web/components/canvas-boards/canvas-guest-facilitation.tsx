"use client";
import { useEffect, useRef, useState } from "react";
import {
  CanvasGuestFacilitationViewSchema,
  type CanvasGuestFacilitationView,
  type CanvasObject,
  type CanvasExportRegion,
} from "@openround/contracts";
import { API_URL } from "../../lib/api";
import { canvasPath } from "./canvas-client";
import { CanvasTimerDisplay } from "./canvas-timer";
import { CanvasPresenterControls } from "./canvas-presenter-controls";

interface Props {
  boardId: string;
  sourceBoardId: string;
  token: string;
  canvasSeq: number;
  objects: CanvasObject[];
  cancelKey: number;
  onFollow: (region: CanvasExportRegion | null) => void;
}
export function CanvasGuestFacilitation({
  boardId,
  sourceBoardId,
  token,
  canvasSeq,
  objects,
  cancelKey,
  onFollow,
}: Props) {
  const key = JSON.stringify([boardId, sourceBoardId, token]);
  const [state, setState] = useState<{ key: string; view: CanvasGuestFacilitationView } | null>(
    null,
  );
  const refresh = useRef<() => void>(() => {});
  useEffect(() => {
    const controller = new AbortController();
    let inFlight = false,
      again = false;
    async function read() {
      if (controller.signal.aborted) return;
      if (inFlight) {
        again = true;
        return;
      }
      inFlight = true;
      do {
        again = false;
        const attempt = new AbortController();
        const abort = () => attempt.abort();
        controller.signal.addEventListener("abort", abort, { once: true });
        const timeout = setTimeout(abort, 8_000);
        try {
          canvasPath(sourceBoardId);
          if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("Invalid workshop credential");
          const response = await fetch(
            `${API_URL}/v1/canvas-boards/workshop/${sourceBoardId}/guest/facilitation`,
            {
              credentials: "omit",
              cache: "no-store",
              referrerPolicy: "no-referrer",
              signal: attempt.signal,
              headers: { authorization: `Bearer ${token}` },
            },
          );
          if (!response.ok) {
            if ([401, 403, 404, 410].includes(response.status)) {
              setState(null);
              controller.abort();
            }
            break;
          }
          const view = CanvasGuestFacilitationViewSchema.parse(
            (await response.json()).facilitation,
          );
          if (view.boardId !== boardId) throw new Error("Timer belongs to another board");
          if (!controller.signal.aborted) setState({ key, view });
        } catch {
          if (!controller.signal.aborted) setState(null);
        } finally {
          clearTimeout(timeout);
          controller.signal.removeEventListener("abort", abort);
        }
      } while (again && !controller.signal.aborted);
      inFlight = false;
    }
    refresh.current = () => void read();
    void read();
    const timer = setInterval(() => void read(), 5_000);
    return () => {
      controller.abort();
      clearInterval(timer);
      refresh.current = () => {};
    };
  }, [key, boardId, sourceBoardId, token]);
  useEffect(() => refresh.current(), [canvasSeq]);
  const view = state?.key === key ? state.view : null;
  return (
    <>
      {view && view.timer.status !== "idle" ? (
        <CanvasTimerDisplay timer={view.timer} serverNow={view.serverNow} />
      ) : null}
      <CanvasPresenterControls
        boardId={boardId}
        objects={objects}
        sourceBoardId={sourceBoardId}
        guestToken={token}
        cancelKey={cancelKey}
        onFollow={onFollow}
      />
    </>
  );
}
