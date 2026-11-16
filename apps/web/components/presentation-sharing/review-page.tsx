"use client";
import { useEffect, useRef, useState } from "react";
import type { PresentationReview, PresentationReviewBlock } from "@openround/contracts";
import { ContentSlideView } from "../presentation/content-slide-view";
import { Brand } from "../brand";
import { EditorIcon } from "../presentation/presentation-editor-chrome";
import {
  capturePresentationReviewToken,
  clearPresentationReviewToken,
  fetchPresentationReview,
  fetchPresentationReviewImage,
  fetchPresentationShareAccess,
  PresentationReviewImageError,
} from "../../lib/presentation-sharing-client";
import styles from "./review-workspace.module.css";
import { ApiClientError } from "../../lib/api";
import { PresentationFeedbackPanel, clearPresentationFeedbackRecovery } from "./feedback-panel";
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
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [readableOpen, setReadableOpen] = useState(false);
  useEffect(() => {
    if (window.matchMedia?.("(max-width: 760px)").matches) setOutlineOpen(false);
  }, []);
  const [navigationBusy, setNavigationBusy] = useState(false);
  const [navigationError, setNavigationError] = useState("");
  const navigationAbort = useRef<AbortController | null>(null),
    activeVersion = useRef<string | null>(null),
    retryTarget = useRef<number | null>(null);
  function clearAccess() {
    navigationAbort.current?.abort();
    setReview(null);
    token.current = null;
    activeVersion.current = null;
    retryTarget.current = null;
    clearPresentationReviewToken(shareId);
    clearPresentationFeedbackRecovery("reviewer", shareId);
  }
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
        clearAccess();
      } else setNavigationError("Could not verify access. Retry the page change.");
    } finally {
      if (!controller.signal.aborted) setNavigationBusy(false);
    }
  }
  useEffect(() => {
    let controller: AbortController;
    const load = () => {
      navigationAbort.current?.abort();
      setNavigationBusy(false);
      setNavigationError("");
      controller?.abort();
      controller = new AbortController();
      const current = controller;
      const incomingUrl = new URL(window.location.href);
      const hasIncomingCredential =
        incomingUrl.hash !== "" || incomingUrl.searchParams.has("token");
      const capturedToken = capturePresentationReviewToken({
        shareId,
        location: window.location,
        history: window.history,
        storage: {
          getItem: (key) => window.sessionStorage.getItem(key),
          setItem: (key, value) => window.sessionStorage.setItem(key, value),
          removeItem: (key) => window.sessionStorage.removeItem(key),
        },
      });
      const previousToken = token.current;
      // Focus revalidation keeps the current source and discussion drafts mounted.
      // A new incoming credential clears them before any replacement is fetched.
      token.current = capturedToken ?? (hasIncomingCredential ? null : token.current);
      const retainSource =
        !hasIncomingCredential &&
        token.current !== null &&
        previousToken === token.current &&
        activeVersion.current !== null;
      if (!retainSource) {
        activeVersion.current = null;
        setReview(null);
        if (previousToken !== null) clearPresentationFeedbackRecovery("reviewer", shareId);
      }
      setLoading(true);
      if (!token.current) {
        clearPresentationFeedbackRecovery("reviewer", shareId);
        setLoading(false);
        return;
      }
      const expectedVersion = activeVersion.current;
      void fetchPresentationReview(shareId, token.current, current.signal)
        .then((value) => {
          if (!current.signal.aborted) {
            if (
              Date.parse(value.expiresAt) <= Date.now() ||
              (expectedVersion !== null &&
                expectedVersion.toLowerCase() !== value.versionId.toLowerCase())
            ) {
              clearAccess();
              return;
            }
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
            clearAccess();
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
        clearPresentationFeedbackRecovery("reviewer", shareId);
      } else timer = window.setTimeout(expire, Math.min(remaining, 2_147_483_647));
    };
    expire();
    return () => clearTimeout(timer);
  }, [review, shareId]);
  const block = review?.blocks[index];
  return (
    <div className={styles.review} lang="en-CA">
      <header className={styles.header}>
        <div className={styles.brand}>
          <Brand />
        </div>
        {review ? (
          <div className={styles.heading}>
            <h1>{review.title}</h1>
            <p>
              Published version {review.version}
              <span aria-hidden="true"> · </span>
              <span>
                Expires{" "}
                <time dateTime={review.expiresAt}>
                  {new Date(review.expiresAt).toLocaleDateString("en-CA")}
                </time>
              </span>
            </p>
          </div>
        ) : null}
        <span className={styles.privateBadge}>
          <EditorIcon name="eye-off" /> Private review
        </span>
      </header>
      <main className={styles.main} id="main">
        {review && block && token.current ? (
          <>
            <div className={styles.workspaceBar}>
              <button
                type="button"
                className={styles.outlineToggle}
                aria-label="Slides"
                aria-expanded={outlineOpen}
                aria-controls="review-page-outline"
                onClick={() => setOutlineOpen((open) => !open)}
              >
                <EditorIcon name="slides" />
                <span>Slides</span>
              </button>
              <p className={styles.reviewHint}>
                Explore at your own pace. Questions are read-only.
              </p>
            </div>
            <div className={styles.reviewLayout} data-outline-open={outlineOpen}>
              <nav
                id="review-page-outline"
                aria-label="Presentation pages"
                className={styles.pageMap}
                hidden={!outlineOpen}
              >
                <div className={styles.outlineHeading}>
                  <h2>Slide outline</h2>
                  <span>{review.blocks.length} pages</span>
                </div>

                {review.sections.length ? (
                  <label>
                    Section
                    <select
                      value={
                        review.sections.find((section) =>
                          section.blockIds.some(
                            (id) => id.toLowerCase() === block.id.toLowerCase(),
                          ),
                        )?.id ?? ""
                      }
                      disabled={navigationBusy}
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
                        aria-label={`${pageIndex + 1}. ${presentationReviewBlockTitle(page, pageIndex)}`}
                        aria-current={index === pageIndex ? "page" : undefined}
                        disabled={navigationBusy}
                        onClick={() => void changePage(pageIndex)}
                      >
                        <span className={styles.pageNumber} aria-hidden="true">
                          {pageIndex + 1}
                        </span>
                        <span className={styles.pageLabel}>
                          <span className="sr-only">{pageIndex + 1}. </span>
                          <span className={styles.pageTitle}>
                            {presentationReviewBlockTitle(page, pageIndex)}
                          </span>
                          <span className={styles.pageKind} aria-hidden="true">
                            <EditorIcon
                              name={page.kind === "content" ? "content" : "interaction"}
                            />
                            {page.kind === "content" ? "Slide" : "Question"}
                          </span>
                        </span>
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
                <div className={styles.viewerBar}>
                  <p role="status">
                    Page {index + 1} of {review.blocks.length}
                  </p>
                  <span className={styles.viewerKind}>
                    <EditorIcon name={block.kind === "content" ? "content" : "interaction"} />
                    {block.kind === "content" ? "Content slide" : "Read-only question"}
                  </span>
                </div>
                <div className={styles.slideFrame}>
                  {block.kind === "content" ? (
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
                </div>
                <div className={styles.controls}>
                  <button
                    type="button"
                    disabled={navigationBusy || index === 0}
                    onClick={() => void changePage(index - 1)}
                  >
                    <EditorIcon name="back" />
                    <span>Previous page</span>
                  </button>
                  <span className={styles.progress} aria-hidden="true">
                    <span style={{ width: `${((index + 1) / review.blocks.length) * 100}%` }} />
                  </span>
                  <button
                    type="button"
                    disabled={navigationBusy || index === review.blocks.length - 1}
                    onClick={() => void changePage(index + 1)}
                  >
                    <span>Next page</span>
                    <span className={styles.nextIcon}>
                      <EditorIcon name="back" />
                    </span>
                  </button>
                </div>
                {block.kind === "content" ? (
                  <details
                    open={readableOpen}
                    onToggle={(event) => setReadableOpen(event.currentTarget.open)}
                    className={styles.readable}
                  >
                    <summary>
                      <EditorIcon name="text" />
                      <span>Readable text</span>
                      <EditorIcon name="chevron-down" />
                    </summary>
                    {block.scene
                      ? block.scene.nodes
                          .filter((node) => node.type === "text")
                          .map((node) =>
                            node.type === "text" ? <p key={node.id}>{node.text}</p> : null,
                          )
                      : block.textElements.map((element) => <p key={element.id}>{element.text}</p>)}
                  </details>
                ) : null}
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
            <div className={styles.feedback}>
              <PresentationFeedbackPanel
                mode="reviewer"
                shareId={shareId}
                versionId={review.versionId}
                token={token.current}
                blockId={block.id}
                blockIndex={index}
                onAccessLost={clearAccess}
              />
            </div>
          </>
        ) : (
          <section className={styles.emptyState}>
            <span className={styles.emptyIcon}>
              <EditorIcon name="eye-off" />
            </span>
            <h1>Private presentation review</h1>
            <p role={loading ? "status" : "alert"}>
              {loading
                ? "Opening presentation…"
                : "This presentation link is unavailable or has expired."}
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
