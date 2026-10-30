"use client";
import { useEffect, useRef, useState } from "react";
import type {
  CanvasObject,
  CanvasExportRegion,
  CanvasPresenterMutation,
} from "@openround/contracts";
import { clientUuid } from "../../lib/uuid";
import { AUTH_CHANGE_EVENT } from "../../lib/api";
import { canvasPresenterCopy } from "../../lib/i18n/canvas-presenter-messages";
import { useLocale } from "../locale-provider";
import { canvasObjectBounds } from "./canvas-hierarchy";
import { useCanvasPresenter } from "./use-canvas-presenter";
import styles from "./canvas-presenter.module.css";

interface Props {
  boardId: string;
  objects: CanvasObject[];
  canPresent?: boolean;
  viewportRegion?: CanvasExportRegion | null;
  publishedFrameId?: string | null;
  sourceBoardId?: string;
  guestToken?: string;
  cancelKey?: number;
  onFollow: (region: CanvasExportRegion | null) => void;
}
export function CanvasPresenterControls(props: Props) {
  return <Controls key={JSON.stringify([props.boardId, props.guestToken])} {...props} />;
}
function Controls({
  boardId,
  objects,
  canPresent = false,
  viewportRegion = null,
  publishedFrameId = null,
  sourceBoardId,
  guestToken,
  cancelKey = 0,
  onFollow,
}: Props) {
  const { locale } = useLocale();
  const copy = canvasPresenterCopy(locale);
  const state = useCanvasPresenter(
    boardId,
    guestToken !== undefined
      ? { sourceBoardId: sourceBoardId ?? "", token: guestToken }
      : undefined,
  );
  const view = state.view;
  const [ownedSession, setOwnedSession] = useState<string | null>(null);
  const mine = Boolean(view?.active && guestToken === undefined && view.sessionId === ownedSession);
  const [following, setFollowing] = useState<string | null>(null);
  const latest = useRef({ view, viewportRegion, publishedFrameId });
  latest.current = { view, viewportRegion, publishedFrameId };
  useEffect(() => {
    const changed = () => {
      setOwnedSession(null);
      setFollowing(null);
    };
    window.addEventListener(AUTH_CHANGE_EVENT, changed);
    return () => window.removeEventListener(AUTH_CHANGE_EVENT, changed);
  }, []);
  useEffect(() => setFollowing(null), [cancelKey]);
  useEffect(() => {
    if (!following) return;
    const leave = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFollowing(null);
    };
    window.addEventListener("keydown", leave);
    return () => window.removeEventListener("keydown", leave);
  }, [following]);
  const frame = view?.frameId
    ? objects.find((object) => object.id === view.frameId && object.type === "frame")
    : null;
  const target = view?.active
    ? view.audience === "published"
      ? frame
        ? canvasObjectBounds(frame, objects)
        : null
      : view.viewport
    : null;
  const targetKey = JSON.stringify(target);
  useEffect(() => {
    if (!following) {
      onFollow(null);
      return;
    }
    if (!view?.active || view.sessionId !== following || !target) {
      setFollowing(null);
      onFollow(null);
      return;
    }
    onFollow(target);
  }, [following, view?.active, view?.sessionId, targetKey, onFollow]);
  useEffect(() => () => onFollow(null), [onFollow]);
  useEffect(() => {
    if (!mine || !canPresent || !view?.sessionId) return;
    const sessionId = view.sessionId;
    const timer = setInterval(() => {
      const current = latest.current;
      if (!current.view?.active || current.view.sessionId !== sessionId) return;
      void state.command({
        schemaVersion: 1,
        operationId: clientUuid(),
        sessionId,
        expectedRevision: current.view.revision,
        command: {
          type: "update",
          audience: current.view.audience,
          frameId:
            current.view.audience === "published"
              ? (current.publishedFrameId ?? current.view.frameId)
              : null,
          viewport:
            current.view.audience === "team"
              ? (current.viewportRegion ?? current.view.viewport)
              : null,
        },
      });
    }, 2_000);
    return () => clearInterval(timer);
  }, [mine, canPresent, view?.sessionId, state.command]);
  function start(audience: "team" | "published") {
    if (!view || !canPresent || state.working) return;
    const operationId = clientUuid();
    setOwnedSession(operationId);
    const input: CanvasPresenterMutation = {
      schemaVersion: 1,
      operationId,
      sessionId: operationId,
      expectedRevision: view.revision,
      command: {
        type: "start",
        audience,
        frameId: audience === "published" ? publishedFrameId : null,
        viewport: audience === "team" ? viewportRegion : null,
      },
    };
    void state.command(input);
  }
  return (
    <section className={styles.controls} aria-label={copy.title}>
      <span role="status">{mine ? copy.own : view?.active ? copy.live : copy.idle}</span>
      {canPresent && guestToken === undefined ? (
        <>
          {!view?.active ? (
            <>
              <button
                type="button"
                className="button-quiet"
                disabled={!view || state.working || !viewportRegion}
                onClick={() => start("team")}
              >
                {copy.start}
              </button>
              {sourceBoardId ? (
                <button
                  type="button"
                  className="button-quiet"
                  disabled={!view || state.working || !publishedFrameId}
                  onClick={() => start("published")}
                >
                  {copy.publish}
                </button>
              ) : null}
            </>
          ) : (
            <button
              type="button"
              className="button-quiet"
              disabled={state.working || !view.sessionId}
              onClick={() => {
                if (view.sessionId)
                  void state.command({
                    schemaVersion: 1,
                    operationId: clientUuid(),
                    expectedRevision: view.revision,
                    sessionId: view.sessionId,
                    command: { type: "stop" },
                  });
              }}
            >
              {copy.stop}
            </button>
          )}
        </>
      ) : null}
      {view?.active && !mine ? (
        <button
          type="button"
          className="button-quiet"
          aria-pressed={following === view.sessionId}
          disabled={!target}
          onClick={() => setFollowing(following ? null : view.sessionId)}
        >
          {following ? copy.leave : copy.follow}
        </button>
      ) : null}
      {following ? <small>{copy.help}</small> : null}
      {state.error ? (
        <>
          <p role="alert">{copy.unavailable}</p>
          <button
            type="button"
            className="button-quiet"
            disabled={state.working}
            onClick={state.refresh}
          >
            {copy.refresh}
          </button>
        </>
      ) : null}
    </section>
  );
}
