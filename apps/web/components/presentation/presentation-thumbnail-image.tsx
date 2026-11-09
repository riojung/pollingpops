"use client";

import { useEffect, useRef, useState } from "react";
import {
  readPresentationThumbnailMedia,
  type PresentationThumbnailMediaScope,
  type ThumbnailMediaSnapshot,
} from "./presentation-thumbnail-media";
import styles from "./presentation-editor-chrome.module.css";

export function ThumbnailImagePlaceholder({ failed = false }: { failed?: boolean }) {
  return (
    <div
      title={failed ? "Image unavailable" : "Loading image"}
      className={styles.imagePlaceholder}
      data-thumbnail-image-state={failed ? "unavailable" : "loading"}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      >
        <path d="M3 4h18v16H3z m0 12 6-6 6 6 3-3 3 3 M16 8h.01" />
      </svg>
    </div>
  );
}

export function PresentationThumbnailImage({
  scope,
  mediaId,
  altText,
}: {
  scope: PresentationThumbnailMediaScope;
  mediaId: string;
  altText: string | null;
}) {
  const key = JSON.stringify([scope.actorKey, scope.presentationId, mediaId]);
  const [stored, setStored] = useState<{ key: string; snapshot: ThumbnailMediaSnapshot } | null>(
    null,
  );
  const read = useRef<ReturnType<typeof readPresentationThumbnailMedia> | null>(null);
  const snapshot = stored?.key === key ? stored.snapshot : { status: "loading" as const };
  useEffect(() => {
    const current = readPresentationThumbnailMedia(scope, mediaId, (snapshot) =>
      setStored({ key, snapshot }),
    );
    read.current = current;
    return () => {
      current.release();
      if (read.current === current) read.current = null;
    };
  }, [key, scope.actorKey, scope.presentationId, mediaId]);
  return snapshot.status === "ready" ? (
    <img
      alt={altText ?? ""}
      src={snapshot.source}
      referrerPolicy="no-referrer"
      decoding="async"
      draggable={false}
      data-thumbnail-image-state="ready"
      onError={() => read.current?.imageFailed(snapshot.source)}
    />
  ) : (
    <ThumbnailImagePlaceholder failed={snapshot.status === "unavailable"} />
  );
}
