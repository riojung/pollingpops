"use client";
import { useEffect, useState } from "react";
import type { CanvasArtifactLink, CanvasVersionView } from "@openround/contracts";
import { useLocale } from "../locale-provider";
import { canvasArtifactLinkCopy } from "../../lib/i18n/canvas-artifact-link-messages";
import { CanvasReadOnlySurface } from "../canvas-boards/canvas-surface";
import { watchCanvas } from "../canvas-boards/canvas-client";
import { ApiClientError } from "../../lib/api";
import { readCanvasArtifactPreview, type CanvasArtifactTarget } from "./client";
import styles from "./links.module.css";
export function CanvasArtifactPreview({
  target,
  link,
  onClose,
  onUnavailable,
}: {
  target: CanvasArtifactTarget;
  link: CanvasArtifactLink;
  onClose: () => void;
  onUnavailable: () => void;
}) {
  const { locale } = useLocale(),
    copy = canvasArtifactLinkCopy(locale);
  const [view, setView] = useState<CanvasVersionView | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let reading = false,
      again = false,
      generation = 0;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const invalidate = () => {
      generation++;
      clearTimeout(expiry);
      setView(null);
    };
    async function read(clear = false) {
      if (controller.signal.aborted) return;
      if (clear) invalidate();
      again = true;
      if (reading) return;
      reading = true;
      do {
        again = false;
        const version = generation;
        try {
          const next = await readCanvasArtifactPreview(target, link, controller.signal);
          if (controller.signal.aborted) return;
          if (version !== generation) {
            again = true;
            continue;
          }
          setView(next);
          clearTimeout(expiry);
          expiry = setTimeout(invalidate, 5000);
        } catch {
          if (!controller.signal.aborted) {
            invalidate();
            onUnavailable();
            controller.abort();
          }
          return;
        }
      } while (again && !controller.signal.aborted);
      reading = false;
    }
    void read();
    const interval = setInterval(() => void read(), 5000);
    async function watch() {
      while (!controller.signal.aborted) {
        try {
          await watchCanvas(
            link.boardId,
            controller.signal,
            () => void read(true),
            () => {
              invalidate();
              onUnavailable();
              controller.abort();
            },
          );
        } catch (error) {
          if (controller.signal.aborted) return;
          if (error instanceof ApiClientError && [401, 403, 404, 410].includes(error.status)) {
            invalidate();
            onUnavailable();
            controller.abort();
          } else {
            // A stream outage does not revoke a still-fresh authorized snapshot.
            void read();
          }
        }
        if (!controller.signal.aborted)
          await new Promise<void>((resolve) => {
            const done = () => {
              clearTimeout(timer);
              controller.signal.removeEventListener("abort", done);
              resolve();
            };
            const timer = setTimeout(done, 1000);
            controller.signal.addEventListener("abort", done, { once: true });
          });
      }
    }
    void watch();
    return () => {
      controller.abort();
      clearInterval(interval);
      clearTimeout(expiry);
    };
  }, [target.kind, target.targetId, link.id, link.boardId, link.versionId, onUnavailable]);
  return (
    <section className={styles.preview} aria-label={copy.preview}>
      <header className={styles.header}>
        <h3 dir="auto" lang="">
          {link.name}
        </h3>
        <button type="button" className="button-quiet" onClick={onClose}>
          {copy.close}
        </button>
      </header>
      <p>{copy.snapshotHelp}</p>
      {view ? (
        <CanvasReadOnlySurface
          objects={view.objects}
          canvasId={view.boardId}
          versionId={link.versionId}
          label={link.name}
          artifactLink={{ ...target, linkId: link.id }}
        />
      ) : (
        <p role="status">{copy.snapshotLoading}</p>
      )}
    </section>
  );
}
