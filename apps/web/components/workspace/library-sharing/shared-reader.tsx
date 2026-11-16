"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "../../locale-provider";
import { ContentSlideView } from "../../presentation/content-slide-view";
import { AUTH_CHANGE_EVENT, ApiClientError } from "../../../lib/api";
import { librarySharingMessages } from "../../../lib/i18n/library-sharing-messages";
import { useWorkspace, WorkspaceProvider } from "../workspace-provider";
import { WorkspaceShell } from "../workspace-shell";
import { LibraryShareActions } from "./share-actions";
import { LibraryShareDue } from "./share-due";
import { fetchLibraryShareImage } from "./image-client";
import {
  libraryScopeHref,
  readLibraryShare,
  updateLibraryShareProgress,
  type SharedLibraryDetail,
  type SharedQuestion,
} from "./client";
import styles from "./library-sharing.module.css";

export function SharedLibraryImage({
  shareId,
  mediaId,
  alt,
}: {
  shareId: string;
  mediaId: string;
  alt: string | null;
}) {
  const { locale } = useLocale();
  const copy = librarySharingMessages(locale);
  const [source, setSource] = useState("");
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const active = new AbortController();
    let objectUrl = "";
    setSource("");
    setFailed(false);
    async function load() {
      const blob = await fetchLibraryShareImage(shareId, mediaId, active.signal);
      if (!active.signal.aborted) {
        objectUrl = URL.createObjectURL(blob);
        setSource(objectUrl);
      }
    }
    void load().catch(() => {
      if (!active.signal.aborted) setFailed(true);
    });
    return () => {
      active.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [shareId, mediaId, attempt]);
  return source ? (
    <img className={styles.image} src={source} alt={alt ?? ""} />
  ) : (
    <div className={styles.imageStatus} role="status">
      <p>{failed ? copy.imageUnavailable : copy.imageLoading}</p>
      {failed ? (
        <button
          type="button"
          className="button-quiet"
          onClick={() => setAttempt((value) => value + 1)}
        >
          {copy.retry}
        </button>
      ) : null}
    </div>
  );
}

export function SharedLibraryQuestion({
  question,
  shareId,
}: {
  question: SharedQuestion;
  shareId: string;
}) {
  return (
    <article className={styles.question}>
      {question.mediaId ? (
        <SharedLibraryImage shareId={shareId} mediaId={question.mediaId} alt={question.mediaAlt} />
      ) : null}
      <h2 lang="" dir="auto">
        {question.prompt}
      </h2>
      {question.choices?.length ? (
        <ol>
          {question.choices.map((choice) => (
            <li key={choice.id} lang="" dir="auto">
              {choice.label}
            </li>
          ))}
        </ol>
      ) : null}
      {question.unit ? (
        <p lang="" dir="auto">
          {question.unit}
        </p>
      ) : null}
      {question.min !== undefined && question.max !== undefined ? (
        <p>
          {question.minLabel ? <span lang="">{question.minLabel} </span> : null}({question.min}) —{" "}
          {question.maxLabel ? <span lang="">{question.maxLabel} </span> : null}({question.max})
        </p>
      ) : null}
    </article>
  );
}

function SharedLibraryReaderContent({ shareId }: { shareId: string }) {
  const { locale } = useLocale();
  const copy = librarySharingMessages(locale);
  const { creator } = useWorkspace();
  const key = JSON.stringify([shareId, creator?.userId, creator?.workspaceId]);
  const activeKey = useRef(key);
  activeKey.current = key;
  const controller = useRef<AbortController | null>(null);
  const [snapshot, setSnapshot] = useState<{ key: string; detail: SharedLibraryDetail | null }>({
    key: "",
    detail: null,
  });
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const detail = snapshot.key === key ? snapshot.detail : null;
  const [refresh, setRefresh] = useState(0);
  const load = useCallback(
    async (target?: number) => {
      controller.current?.abort();
      const active = new AbortController();
      controller.current = active;
      setLoading(true);
      setUnavailable(false);
      try {
        const result = await readLibraryShare(shareId, active.signal);
        if (active.signal.aborted || activeKey.current !== key) return;
        if (result.share.progress === "new" && !result.share.capabilities.manage) {
          try {
            result.share = await updateLibraryShareProgress(shareId, "in_progress", active.signal);
          } catch (caught) {
            if (caught instanceof ApiClientError && [401, 403, 404, 410].includes(caught.status))
              throw caught;
            /* Viewing remains available when progress cannot be saved. */
          }
        }
        if (active.signal.aborted || activeKey.current !== key) return;
        setSnapshot({ key, detail: result });
        const count = result.review?.blocks.length ?? result.questions?.length ?? 0;
        setIndex((previous) => Math.max(0, Math.min(target ?? previous, count - 1)));
      } catch {
        if (!active.signal.aborted && activeKey.current === key) {
          setSnapshot({ key, detail: null });
          setUnavailable(true);
        }
      } finally {
        if (!active.signal.aborted && activeKey.current === key) setLoading(false);
      }
    },
    [key, shareId],
  );

  useEffect(() => {
    setSnapshot({ key, detail: null });
    if (creator?.userId) void load();
    return () => controller.current?.abort();
  }, [creator?.userId, key, load, refresh]);
  useEffect(() => {
    const invalidate = () => {
      controller.current?.abort();
      setSnapshot({ key: "", detail: null });
      setRefresh((value) => value + 1);
    };
    window.addEventListener("focus", invalidate);
    window.addEventListener(AUTH_CHANGE_EVENT, invalidate);
    return () => {
      window.removeEventListener("focus", invalidate);
      window.removeEventListener(AUTH_CHANGE_EVENT, invalidate);
    };
  }, []);

  const share = detail?.share;
  const type =
    share?.artifactType === "presentation"
      ? "presentations"
      : share?.artifactType === "survey"
        ? "surveys"
        : "rounds";
  const block = detail?.review?.blocks[index];
  return (
    <WorkspaceShell
      title={share?.title ?? copy.shared}
      titleLanguage={share ? "" : undefined}
      eyebrow={copy.shared}
      translationLevel="full"
      actions={
        <Link className="button-quiet" href={libraryScopeHref("shared", type)}>
          {copy.back}
        </Link>
      }
    >
      {loading ? <p role="status">{copy.loading}</p> : null}
      {unavailable ? (
        <section className={styles.empty}>
          <h2>{copy.unavailable}</h2>
          <button
            type="button"
            className="button-quiet"
            onClick={() => setRefresh((value) => value + 1)}
          >
            {copy.retry}
          </button>
        </section>
      ) : null}
      {detail && share ? (
        <>
          <div className={styles.readerHeader}>
            <div className={styles.meta}>
              <span className={`${styles.badge} ${styles.permission}`}>
                {share.permission === "use" ? copy.canUse : copy.canView}
              </span>
              <span className={styles.badge}>{copy[share.progress]}</span>
            </div>
            <p className={styles.help}>
              {copy.from}:{" "}
              <span lang="" dir="auto">
                {share.sourceWorkspaceName} · {share.organizationName}
              </span>
            </p>
            {share.description ? (
              <p lang="" dir="auto">
                {share.description}
              </p>
            ) : null}
            {share.message ? (
              <p className={styles.message} lang="" dir="auto">
                {share.message}
              </p>
            ) : null}
            <LibraryShareDue dueAt={share.dueAt} progress={share.progress} />
            <p className={styles.help}>{copy.readOnly}</p>
            {share.permission === "use" ? <p className={styles.help}>{copy.copyHelp}</p> : null}
            <LibraryShareActions
              share={share}
              showOpen={false}
              onChange={(next) =>
                setSnapshot((previous) =>
                  previous.detail
                    ? { ...previous, detail: { ...previous.detail, share: next } }
                    : previous,
                )
              }
              onRevoked={() => {
                setSnapshot({ key, detail: null });
                setUnavailable(true);
              }}
            />
          </div>
          <section className={styles.reader}>
            {block ? (
              <>
                <div className={styles.readerControls}>
                  <button
                    type="button"
                    className="button-quiet"
                    disabled={loading || index === 0}
                    onClick={() => void load(index - 1)}
                  >
                    {copy.previous}
                  </button>
                  <p role="status">
                    {index + 1} / {detail.review!.blocks.length}
                  </p>
                  <button
                    type="button"
                    className="button-quiet"
                    disabled={loading || index === detail.review!.blocks.length - 1}
                    onClick={() => void load(index + 1)}
                  >
                    {copy.next}
                  </button>
                </div>
                {block.kind === "content" ? (
                  <div className={styles.slide} key={block.id}>
                    <ContentSlideView
                      block={block}
                      variant="preview"
                      interactionSourceKey={`${shareId}:${share.versionId}:${block.id}`}
                      interactionRuntime={{
                        mode: "review",
                        navigationTargets: detail.review!.blocks.map((page) => ({
                          blockId: page.id,
                          available: true,
                          blockedReason: null,
                        })),
                        onNavigate: (_nodeId, blockId) => {
                          const target = detail.review!.blocks.findIndex(
                            (page) => page.id === blockId,
                          );
                          if (target >= 0) void load(target);
                        },
                      }}
                      media={
                        block.mediaId ? (
                          <SharedLibraryImage
                            shareId={shareId}
                            mediaId={block.mediaId}
                            alt={block.mediaAlt}
                          />
                        ) : undefined
                      }
                      renderSceneImage={(mediaId, alt) => (
                        <SharedLibraryImage shareId={shareId} mediaId={mediaId} alt={alt} />
                      )}
                    />
                  </div>
                ) : (
                  <SharedLibraryQuestion
                    shareId={shareId}
                    question={{
                      id: block.id,
                      ...block.question,
                      min: block.question.rating?.min,
                      max: block.question.rating?.max,
                      minLabel: block.question.rating?.minLabel,
                      maxLabel: block.question.rating?.maxLabel,
                    }}
                  />
                )}
              </>
            ) : (
              detail.questions?.map((question) => (
                <SharedLibraryQuestion key={question.id} shareId={shareId} question={question} />
              ))
            )}
          </section>
        </>
      ) : null}
    </WorkspaceShell>
  );
}

export function SharedLibraryReader({ shareId }: { shareId: string }) {
  return (
    <WorkspaceProvider>
      <SharedLibraryReaderContent shareId={shareId} />
    </WorkspaceProvider>
  );
}
