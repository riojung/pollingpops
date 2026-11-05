"use client";
import { useEffect, useRef, useState } from "react";
import type { PresentationReview, PresentationReviewBlock } from "@openround/contracts";
import { ContentSlideView } from "../presentation/content-slide-view";
import { Brand } from "../brand";
import {
  capturePresentationReviewToken,
  clearPresentationReviewToken,
  fetchPresentationReview,
  fetchPresentationReviewImage,
  fetchPresentationShareAccess,
  PresentationReviewImageError,
} from "../../lib/presentation-sharing-client";
import styles from "./sharing.module.css";
import { ApiClientError } from "../../lib/api";
export function PresentationReviewImageFallback({
  failed,
  retryable,
  onRetry,
}: {
  failed: boolean;
  retryable: boolean;
  onRetry: () => void;
}) {
  return (
    <div role="status">
      <p>{failed ? "Image unavailable" : "Loading image…"}</p>
      {failed && retryable ? (
        <button type="button" onClick={onRetry}>
          Retry image
        </button>
      ) : null}
    </div>
  );
}
function ReviewImage({
  shareId,
  token,
  mediaId,
  alt,
}: {
  shareId: string;
  token: string;
  mediaId: string;
  alt: string | null;
}) {
  const [source, setSource] = useState("");
  const [failed, setFailed] = useState(false);
  const [retryable, setRetryable] = useState(false),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setSource("");
    setFailed(false);
    setRetryable(false);
    const controller = new AbortController();
    let objectUrl = "";
    void fetchPresentationReviewImage(shareId, token, mediaId, controller.signal)
      .then((blob) => {
        if (!controller.signal.aborted) {
          objectUrl = URL.createObjectURL(blob);
          setSource(objectUrl);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setFailed(true);
          setRetryable(error instanceof PresentationReviewImageError && error.retryable);
        }
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [shareId, token, mediaId, attempt]);
  return source ? (
    <img className={styles.image} src={source} alt={alt ?? ""} />
  ) : (
    <PresentationReviewImageFallback
      failed={failed}
      retryable={retryable}
      onRetry={() => setAttempt((value) => value + 1)}
    />
  );
}
export function presentationReviewBlockTitle(block: PresentationReviewBlock, index: number) {
  return block.kind === "question"
    ? block.question.prompt
    : block.scene?.nodes.find((node) => node.type === "text" && node.role === "title")?.type ===
        "text"
      ? (
          block.scene.nodes.find((node) => node.type === "text" && node.role === "title") as {
            text: string;
          }
        ).text
      : block.textElements.find((element) => element.role === "title")?.text || `Page ${index + 1}`;
}
export function PresentationReviewQuestion({
  block,
}: {
  block: Extract<PresentationReviewBlock, { kind: "question" }>;
}) {
  return (
    <article className={styles.question}>
      <h2>{block.question.prompt}</h2>
      {block.question.choices ? (
        <ol>
          {block.question.choices.map((choice) => (
            <li key={choice.id}>{choice.label}</li>
          ))}
        </ol>
      ) : null}
      {block.question.unit ? <p>Unit: {block.question.unit}</p> : null}
      {block.question.rating ? (
        <p>
          {block.question.rating.minLabel ?? "Low"} ({block.question.rating.min}) —{" "}
          {block.question.rating.maxLabel ?? "High"} ({block.question.rating.max})
        </p>
      ) : null}
      <p className="muted">Review only. Responses are not collected.</p>
    </article>
  );
}
export function PresentationReviewPage({ shareId }: { shareId: string }) {
  const token = useRef<string | null>(null);
  const [review, setReview] = useState<PresentationReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [index, setIndex] = useState(0);
  const [navigationBusy, setNavigationBusy] = useState(false);
  const [navigationError, setNavigationError] = useState("");
  const navigationAbort = useRef<AbortController | null>(null),
    activeVersion = useRef<string | null>(null),
    retryTarget = useRef<number | null>(null);
  async function changePage(target: number) {
    if (!review || !token.current || navigationBusy || target < 0 || target >= review.blocks.length)
      return;
    const capturedToken = token.current,
      versionId = review.versionId,
      controller = new AbortController();
    navigationAbort.current?.abort();
    navigationAbort.current = controller;
    setNavigationBusy(true);
    setNavigationError("");
    retryTarget.current = target;
    try {
      const access = await fetchPresentationShareAccess(shareId, capturedToken, controller.signal);
      if (
        controller.signal.aborted ||
        token.current !== capturedToken ||
        activeVersion.current !== versionId
      )
        return;
      if (access.versionId !== versionId || Date.parse(access.expiresAt) <= Date.now())
        throw new ApiClientError("Presentation unavailable", "PRESENTATION_UNAVAILABLE", 404);
      setIndex(target);
      retryTarget.current = null;
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof ApiClientError && [401, 403, 404, 410].includes(error.status)) {
        setReview(null);
        token.current = null;
        activeVersion.current = null;
        clearPresentationReviewToken(shareId);
        retryTarget.current = null;
      } else setNavigationError("Could not verify access. Retry the page change.");
    } finally {
      if (!controller.signal.aborted) setNavigationBusy(false);
    }
  }
  useEffect(() => {
    let controller: AbortController;
    const load = () => {
      navigationAbort.current?.abort();
      activeVersion.current = null;
      setNavigationBusy(false);
      setNavigationError("");
      controller?.abort();
      controller = new AbortController();
      const current = controller;
      token.current = capturePresentationReviewToken({
        shareId,
        location: window.location,
        history: window.history,
        storage: {
          getItem: (key) => window.sessionStorage.getItem(key),
          setItem: (key, value) => window.sessionStorage.setItem(key, value),
          removeItem: (key) => window.sessionStorage.removeItem(key),
        },
      });
      setReview(null);
      setLoading(true);
      if (!token.current) {
        setLoading(false);
        return;
      }
      void fetchPresentationReview(shareId, token.current, current.signal)
        .then((value) => {
          if (!current.signal.aborted) {
            setReview(value);
            activeVersion.current = value.versionId;
            setIndex((previous) => Math.min(previous, value.blocks.length - 1));
          }
        })
        .catch((error) => {
          if (
            !current.signal.aborted &&
            error instanceof ApiClientError &&
            [401, 403, 404, 410].includes(error.status)
          ) {
            token.current = null;
            clearPresentationReviewToken(shareId);
          }
        })
        .finally(() => {
          if (!current.signal.aborted) setLoading(false);
        });
    };
    load();
    window.addEventListener("focus", load);
    window.addEventListener("hashchange", load);
    return () => {
      controller?.abort();
      navigationAbort.current?.abort();
      window.removeEventListener("focus", load);
      window.removeEventListener("hashchange", load);
      token.current = null;
    };
  }, [shareId]);
  useEffect(() => {
    if (!review) return;
    let timer: number;
    const expire = () => {
      const remaining = Date.parse(review.expiresAt) - Date.now();
      if (remaining <= 0) {
        setReview(null);
        token.current = null;
        clearPresentationReviewToken(shareId);
      } else timer = window.setTimeout(expire, Math.min(remaining, 2_147_483_647));
    };
    expire();
    return () => clearTimeout(timer);
  }, [review, shareId]);
  const block = review?.blocks[index];
  return (
    <div className={styles.review} lang="en-CA">
      <header className="shell topbar">
        <Brand />
      </header>
      <main className="shell page-main" id="main">
        {review && block && token.current ? (
          <>
            <h1>{review.title}</h1>
            <p>
              Private review · Published version {review.version} · Expires{" "}
              {new Date(review.expiresAt).toLocaleDateString("en-CA")}
            </p>
            <div className={styles.reviewLayout}>
              <nav aria-label="Presentation pages" className={styles.pageMap}>
                {review.sections.length ? (
                  <label>
                    Section
                    <select
                      defaultValue=""
                      onChange={(event) => {
                        const section = review.sections.find(
                          (section) => section.id === event.target.value,
                        );
                        const target = review.blocks.findIndex((block) =>
                          section?.blockIds.some(
                            (id) => id.toLowerCase() === block.id.toLowerCase(),
                          ),
                        );
                        if (target >= 0) void changePage(target);
                      }}
                    >
                      <option value="">Choose a section</option>
                      {review.sections.map((section) => (
                        <option key={section.id} value={section.id}>
                          {section.title}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <ol>
                  {review.blocks.map((page, pageIndex) => (
                    <li key={page.id}>
                      <button
                        type="button"
                        aria-current={index === pageIndex ? "page" : undefined}
                        disabled={navigationBusy}
                        onClick={() => void changePage(pageIndex)}
                      >
                        {pageIndex + 1}. {presentationReviewBlockTitle(page, pageIndex)}
                      </button>
                    </li>
                  ))}
                </ol>
              </nav>
              <section
                aria-label="Current presentation page"
                className={styles.viewer}
                key={block.id}
              >
                <p role="status">
                  Page {index + 1} of {review.blocks.length}
                </p>
                {block.kind === "content" ? (
                  <>
                    <ContentSlideView
                      block={block}
                      variant="preview"
                      interactionSourceKey={`${shareId}:${review.versionId}:${block.id}`}
                      interactionRuntime={{
                        mode: "review",
                        navigationTargets: review.blocks.map((block) => ({
                          blockId: block.id,
                          available: true,
                          blockedReason: null,
                        })),
                        onNavigate: (_nodeId, targetId) => {
                          const target = review.blocks.findIndex(
                            (block) => block.id.toLowerCase() === targetId.toLowerCase(),
                          );
                          if (target >= 0) void changePage(target);
                        },
                      }}
                      media={
                        block.mediaId ? (
                          <ReviewImage
                            shareId={shareId}
                            token={token.current}
                            mediaId={block.mediaId}
                            alt={block.mediaAlt}
                          />
                        ) : undefined
                      }
                      renderSceneImage={(mediaId, alt) => (
                        <ReviewImage
                          shareId={shareId}
                          token={token.current!}
                          mediaId={mediaId}
                          alt={alt}
                        />
                      )}
                    />
                    <details open className={styles.readable}>
                      <summary>Readable text</summary>
                      {block.scene
                        ? block.scene.nodes
                            .filter((node) => node.type === "text")
                            .map((node) =>
                              node.type === "text" ? <p key={node.id}>{node.text}</p> : null,
                            )
                        : block.textElements.map((element) => (
                            <p key={element.id}>{element.text}</p>
                          ))}
                    </details>
                  </>
                ) : (
                  <>
                    {block.question.mediaId ? (
                      <ReviewImage
                        shareId={shareId}
                        token={token.current}
                        mediaId={block.question.mediaId}
                        alt={block.question.mediaAlt}
                      />
                    ) : null}
                    <PresentationReviewQuestion block={block} />
                  </>
                )}
                <div className={styles.controls}>
                  <button
                    type="button"
                    disabled={navigationBusy || index === 0}
                    onClick={() => void changePage(index - 1)}
                  >
                    Previous page
                  </button>
                  <button
                    type="button"
                    disabled={navigationBusy || index === review.blocks.length - 1}
                    onClick={() => void changePage(index + 1)}
                  >
                    Next page
                  </button>
                </div>
                {navigationBusy ? <p role="status">Checking link access…</p> : null}
                {navigationError ? (
                  <div role="alert">
                    <p>{navigationError}</p>
                    <button
                      type="button"
                      onClick={() => {
                        if (retryTarget.current !== null) void changePage(retryTarget.current);
                      }}
                    >
                      Retry page change
                    </button>
                  </div>
                ) : null}
              </section>
            </div>
          </>
        ) : (
          <>
            <h1>Private presentation review</h1>
            <p role={loading ? "status" : "alert"}>
              {loading
                ? "Opening presentation…"
                : "This presentation link is unavailable or has expired."}
            </p>
          </>
        )}
      </main>
    </div>
  );
}
