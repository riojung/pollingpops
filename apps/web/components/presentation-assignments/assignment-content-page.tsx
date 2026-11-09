"use client";
import { useEffect, useState } from "react";
import type { PresentationReview, PresentationReviewBlock } from "@openround/contracts";
import { ContentSlideView } from "../presentation/content-slide-view";
import { PresentationReviewImageError } from "../../lib/presentation-sharing-client";
import { PresentationReviewImageFallback } from "../presentation-sharing/review-page";
import styles from "../presentation-sharing/sharing.module.css";
const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export function AssignmentImage({
  sourceId,
  token,
  mediaId,
  alt,
  fetchImage,
}: {
  sourceId: string;
  token: string;
  mediaId: string;
  alt: string | null;
  fetchImage: (id: string, token: string, mediaId: string, signal: AbortSignal) => Promise<Blob>;
}) {
  const [source, setSource] = useState(""),
    [failed, setFailed] = useState(false),
    [retryable, setRetryable] = useState(false),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = "";
    setSource("");
    setFailed(false);
    setRetryable(false);
    void fetchImage(sourceId, token, mediaId, controller.signal)
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
  }, [sourceId, token, mediaId, retry, fetchImage]);
  return source ? (
    <img className={styles.image} src={source} alt={alt ?? ""} />
  ) : (
    <PresentationReviewImageFallback
      failed={failed}
      retryable={retryable}
      onRetry={() => setRetry((value) => value + 1)}
    />
  );
}

/** Shared safe content renderer; recipient modes retain their own access and progression rules. */
export function AssignmentContentPage({
  block,
  review,
  sourceId,
  token,
  fetchImage,
  onNavigate,
}: {
  block: Extract<PresentationReviewBlock, { kind: "content" }>;
  review: PresentationReview;
  sourceId: string;
  token: string;
  fetchImage: (id: string, token: string, mediaId: string, signal: AbortSignal) => Promise<Blob>;
  onNavigate: (index: number) => void;
}) {
  return (
    <>
      <ContentSlideView
        block={block}
        variant="preview"
        interactionSourceKey={`${sourceId}:${review.versionId}:${block.id}`}
        interactionRuntime={{
          mode: "review",
          navigationTargets: review.blocks.map((page) => ({
            blockId: page.id,
            available: true,
            blockedReason: null,
          })),
          onNavigate: (_nodeId, id) => {
            const target = review.blocks.findIndex((page) => sameId(page.id, id));
            if (target >= 0) onNavigate(target);
          },
        }}
        media={
          block.mediaId ? (
            <AssignmentImage
              sourceId={sourceId}
              token={token}
              mediaId={block.mediaId}
              alt={block.mediaAlt}
              fetchImage={fetchImage}
            />
          ) : undefined
        }
        renderSceneImage={(mediaId, alt) => (
          <AssignmentImage
            sourceId={sourceId}
            token={token}
            mediaId={mediaId}
            alt={alt}
            fetchImage={fetchImage}
          />
        )}
      />
      <details open className={styles.readable}>
        <summary>Readable text</summary>
        {block.scene
          ? block.scene.nodes.map((node) =>
              node.type === "text" ? <p key={node.id}>{node.text}</p> : null,
            )
          : block.textElements.map((element) => <p key={element.id}>{element.text}</p>)}
      </details>
    </>
  );
}
