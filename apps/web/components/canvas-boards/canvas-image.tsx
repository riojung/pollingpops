"use client";

import { useEffect, useRef, useState } from "react";
import { AUTH_CHANGE_EVENT } from "../../lib/api";
import { useLocale } from "../locale-provider";
import { readCanvasImage } from "./canvas-image-resource";

export function CanvasImage({
  canvasId,
  mediaId,
  altText,
  width,
  height,
  sourceBoardId,
  guestToken,
  versionId,
}: {
  canvasId: string;
  mediaId: string;
  altText: string;
  width: number;
  height: number;
  sourceBoardId?: string;
  guestToken?: string;
  versionId?: string;
}) {
  const { t } = useLocale();
  const element = useRef<SVGGElement>(null);
  const [visible, setVisible] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const [state, setState] = useState<{ key: string; url: string | null; failed: boolean }>({
    key: "",
    url: null,
    failed: false,
  });
  const key = JSON.stringify([canvasId, mediaId, sourceBoardId, guestToken, versionId, epoch]);
  useEffect(() => {
    if (!element.current || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(Boolean(entry?.isIntersecting)),
      { rootMargin: "240px" },
    );
    observer.observe(element.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const changed = () => {
      setState({ key: "", url: null, failed: false });
      setEpoch((value) => value + 1);
    };
    window.addEventListener(AUTH_CHANGE_EVENT, changed);
    return () => window.removeEventListener(AUTH_CHANGE_EVENT, changed);
  }, []);
  useEffect(() => {
    setState({ key, url: null, failed: Boolean(guestToken && !sourceBoardId) });
    if (!visible || (guestToken && !sourceBoardId)) return;
    const read = readCanvasImage(
      canvasId,
      mediaId,
      guestToken && sourceBoardId ? { sourceBoardId, token: guestToken } : undefined,
      versionId,
    );
    let active = true,
      url: string | null = null;
    void read.promise
      .then((blob) => {
        if (!active) return;
        url = URL.createObjectURL(blob);
        setState({ key, url, failed: false });
      })
      .catch(() => {
        if (active) setState({ key, url: null, failed: true });
      });
    return () => {
      active = false;
      read.release();
      if (url) URL.revokeObjectURL(url);
    };
  }, [visible, key, canvasId, mediaId, sourceBoardId, guestToken, versionId]);
  const current = state.key === key ? state : null;
  return (
    <g ref={element} role="img" aria-label={altText}>
      <rect width={width} height={height} fill="var(--ui-surface-soft)" />
      {current?.url ? (
        <image
          href={current.url}
          width={width}
          height={height}
          preserveAspectRatio="xMidYMid meet"
        />
      ) : (
        <text x="12" y="28" fill="var(--ui-text)" fontSize="14">
          {t(current?.failed ? "canvas.assets.imageUnavailable" : "canvas.assets.imageLoading")}
        </text>
      )}
    </g>
  );
}
