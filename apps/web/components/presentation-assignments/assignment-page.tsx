"use client";
import { useEffect, useRef, useState } from "react";
import type {
  PresentationAssignmentPreview,
  PresentationReadingAttempt,
  PresentationReadingProgress,
} from "@openround/contracts";
import { ApiClientError } from "../../lib/api";
import { clientUuid } from "../../lib/uuid";
import {
  captureReadingCredentials,
  fetchReadingAccess,
  fetchReadingAttempt,
  fetchReadingImage,
  fetchReadingPreview,
  newReadingAttempt,
  parseReadingLink,
  readingResumeUrl,
  recordReadingProgress,
  startReadingAttempt,
  type ReadingCredentials,
} from "../../lib/presentation-assignments-client";
import { Brand } from "../brand";
import { ContentSlideView } from "../presentation/content-slide-view";
import { PresentationReviewImageError } from "../../lib/presentation-sharing-client";
import {
  presentationReviewBlockTitle,
  PresentationReviewImageFallback,
  PresentationReviewQuestion,
} from "../presentation-sharing/review-page";
import styles from "../presentation-sharing/sharing.module.css";
import readingStyles from "./assignment.module.css";

const denied = (error: unknown) =>
  error instanceof ApiClientError && [401, 403, 404, 410].includes(error.status);
const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
function ReadingImage({
  assignmentId,
  token,
  mediaId,
  alt,
}: {
  assignmentId: string;
  token: string;
  mediaId: string;
  alt: string | null;
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
    void fetchReadingImage(assignmentId, token, mediaId, controller.signal)
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
  }, [assignmentId, token, mediaId, retry]);
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

/** Only explicit reader actions create attempts or acknowledge pages. */
export function PresentationAssignmentPage({ assignmentId }: { assignmentId: string }) {
  const credentials = useRef<ReadingCredentials | null>(null),
    generation = useRef(0),
    abort = useRef<AbortController | null>(null),
    working = useRef(false),
    currentAttempt = useRef<PresentationReadingAttempt | null>(null),
    pendingProgress = useRef<PresentationReadingProgress | null>(null),
    pendingStart = useRef(false),
    activeVersion = useRef<string | null>(null);
  const [preview, setPreview] = useState<PresentationAssignmentPreview | null>(null),
    [attempt, setAttempt] = useState<PresentationReadingAttempt | null>(null),
    [hasResume, setHasResume] = useState(false),
    [resumeUrl, setResumeUrl] = useState(""),
    [pastedLink, setPastedLink] = useState(""),
    [index, setIndex] = useState(0),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [pending, setPending] = useState<"start" | "progress" | null>(null);

  function resetReader() {
    generation.current++;
    abort.current?.abort();
    working.current = false;
    currentAttempt.current = null;
    pendingProgress.current = null;
    pendingStart.current = false;
    if (credentials.current)
      credentials.current = { token: credentials.current.token, reader: null };
    setAttempt(null);
    setHasResume(false);
    setResumeUrl("");
    setPending(null);
    setBusy(false);
    setError("");
    setIndex(0);
    setPastedLink("");
  }
  function clearAccess() {
    resetReader();
    credentials.current = null;
    activeVersion.current = null;
    setPreview(null);
    setLoading(false);
  }
  function begin() {
    if (working.current) return null;
    working.current = true;
    setBusy(true);
    setError("");
    abort.current?.abort();
    const controller = new AbortController(),
      epoch = generation.current;
    abort.current = controller;
    return { controller, valid: () => !controller.signal.aborted && generation.current === epoch };
  }
  function end(operation: NonNullable<ReturnType<typeof begin>>) {
    if (operation.valid()) {
      working.current = false;
      setBusy(false);
    }
  }
  function verify(value: PresentationAssignmentPreview) {
    if (
      value.assignment.revokedAt ||
      Date.parse(value.assignment.expiresAt) <= Date.now() ||
      (activeVersion.current && !sameId(activeVersion.current, value.review.versionId))
    )
      throw new ApiClientError(
        "Reading assignment unavailable",
        "PRESENTATION_ASSIGNMENT_UNAVAILABLE",
        404,
      );
  }
  function mergeAttempt(value: PresentationReadingAttempt) {
    const existing = currentAttempt.current;
    if (existing && sameId(existing.id, value.id) && value.revision < existing.revision)
      return false;
    const source = preview?.review;
    if (
      source &&
      value.readBlockIds.some((id) => !source.blocks.some((block) => sameId(block.id, id)))
    )
      throw new Error("The reading progress could not be verified.");
    currentAttempt.current = value;
    setAttempt(value);
    return true;
  }
  async function loadPreview() {
    const operation = begin();
    if (!operation) return;
    const captured = credentials.current;
    setLoading(true);
    try {
      if (!captured) {
        setPreview(null);
        return;
      }
      const value = await fetchReadingPreview(
        assignmentId,
        captured.token,
        operation.controller.signal,
      );
      if (!operation.valid() || credentials.current !== captured) return;
      verify(value);
      activeVersion.current = value.review.versionId;
      setPreview(value);
    } catch (caught) {
      if (!operation.valid()) return;
      if (denied(caught)) clearAccess();
      else setError("Could not open this reading assignment. Try again.");
    } finally {
      if (operation.valid()) setLoading(false);
      end(operation);
    }
  }
  async function refreshAttempt(operation: NonNullable<ReturnType<typeof begin>>) {
    const captured = credentials.current;
    if (!captured?.reader) return null;
    const value = await fetchReadingAttempt(
      assignmentId,
      captured.reader,
      operation.controller.signal,
    );
    if (!operation.valid() || credentials.current !== captured) return null;
    verify(value);
    mergeAttempt(value.attempt);
    setPreview(value);
    return value;
  }
  async function start(fresh: boolean) {
    if (!preview || working.current || !credentials.current || pendingProgress.current) return;
    if (fresh) {
      resetReader();
      credentials.current = { token: credentials.current!.token, reader: newReadingAttempt() };
      pendingStart.current = true;
      setPending("start");
      setResumeUrl(readingResumeUrl(window.location.origin, assignmentId, credentials.current));
    }
    const captured = credentials.current;
    if (!captured?.reader) return;
    const operation = begin();
    if (!operation) return;
    try {
      const result = await startReadingAttempt(
        assignmentId,
        captured.token,
        captured.reader,
        operation.controller.signal,
      );
      if (!operation.valid() || credentials.current !== captured) return;
      if (result.replayed) await refreshAttempt(operation);
      else mergeAttempt(result.attempt);
      if (!operation.valid()) return;
      pendingStart.current = false;
      setPending(null);
      setHasResume(false);
    } catch (caught) {
      if (!operation.valid()) return;
      if (denied(caught)) clearAccess();
      else
        setError(
          "Could not confirm your reader. Save your private resume link and retry starting this reader.",
        );
    } finally {
      end(operation);
    }
  }
  async function resume() {
    if (!credentials.current?.reader || pendingStart.current) return;
    const operation = begin();
    if (!operation) return;
    try {
      const value = await refreshAttempt(operation);
      if (!value || !operation.valid()) return;
      setHasResume(false);
      setResumeUrl(readingResumeUrl(window.location.origin, assignmentId, credentials.current!));
      const current = value.review.blocks.findIndex((block) =>
        sameId(block.id, value.attempt.currentBlockId ?? ""),
      );
      setIndex(Math.max(0, current));
    } catch (caught) {
      if (!operation.valid()) return;
      if (denied(caught)) clearAccess();
      else setError("Could not resume this reader. Try again with your personal resume link.");
    } finally {
      end(operation);
    }
  }
  async function progress(kind?: "read" | "complete") {
    const captured = credentials.current,
      current = currentAttempt.current;
    if (!captured?.reader || !current || !preview || working.current) return;
    if (!pendingProgress.current) {
      if (!kind) return;
      pendingProgress.current =
        kind === "read"
          ? {
              kind,
              requestId: clientUuid(),
              expectedRevision: current.revision,
              blockId: preview.review.blocks[index]!.id,
            }
          : { kind, requestId: clientUuid(), expectedRevision: current.revision };
    }
    const request = pendingProgress.current,
      operation = begin();
    if (!operation) return;
    setPending("progress");
    try {
      const result = await recordReadingProgress(
        assignmentId,
        captured.reader,
        request,
        operation.controller.signal,
      );
      if (
        !operation.valid() ||
        credentials.current !== captured ||
        !currentAttempt.current ||
        !sameId(currentAttempt.current.id, captured.reader.attemptId)
      )
        return;
      if (!mergeAttempt(result.attempt)) await refreshAttempt(operation);
      if (!operation.valid()) return;
      pendingProgress.current = null;
      setPending(null);
    } catch (caught) {
      if (!operation.valid()) return;
      if (denied(caught)) {
        clearAccess();
        return;
      }
      if (
        caught instanceof ApiClientError &&
        caught.status === 409 &&
        [
          "PRESENTATION_ASSIGNMENT_REVISION_CONFLICT",
          "PRESENTATION_ASSIGNMENT_COMPLETED",
          "PRESENTATION_ASSIGNMENT_INCOMPLETE",
        ].includes(caught.code)
      ) {
        try {
          const value = await refreshAttempt(operation);
          if (!value || !operation.valid()) return;
          pendingProgress.current = null;
          setPending(null);
          setError(
            "Your reading progress changed. Review it before marking another page or finishing.",
          );
        } catch (refreshError) {
          if (!operation.valid()) return;
          if (denied(refreshError)) clearAccess();
          else setError("Could not refresh your progress. Retry saving progress to recover it.");
        }
      } else setError("Could not confirm that your progress was saved. Retry saving progress.");
    } finally {
      end(operation);
    }
  }
  async function changePage(target: number) {
    if (
      !preview ||
      !credentials.current ||
      working.current ||
      pending ||
      target < 0 ||
      target >= preview.review.blocks.length
    )
      return;
    const captured = credentials.current,
      operation = begin();
    if (!operation) return;
    try {
      const access = await fetchReadingAccess(
        assignmentId,
        captured.token,
        operation.controller.signal,
      );
      if (!operation.valid() || credentials.current !== captured) return;
      if (
        !sameId(access.versionId, preview.review.versionId) ||
        Date.parse(access.expiresAt) <= Date.now()
      )
        throw new ApiClientError(
          "Reading assignment unavailable",
          "PRESENTATION_ASSIGNMENT_UNAVAILABLE",
          404,
        );
      setIndex(target);
    } catch (caught) {
      if (!operation.valid()) return;
      if (denied(caught)) clearAccess();
      else setError("Could not verify access. Try the page change again.");
    } finally {
      end(operation);
    }
  }
  useEffect(() => {
    const launch = () => {
      const incoming = captureReadingCredentials({
        assignmentId,
        location: window.location,
        history: window.history,
      });
      if (incoming.provided) {
        resetReader();
        credentials.current = incoming.credentials;
        activeVersion.current = null;
        setPreview(null);
        setHasResume(!!incoming.credentials?.reader);
      }
      void loadPreview();
    };
    const focus = () => {
      if (!credentials.current || working.current) return;
      const captured = credentials.current,
        epoch = generation.current,
        controller = new AbortController();
      abort.current?.abort();
      abort.current = controller;
      void fetchReadingAccess(assignmentId, captured.token, controller.signal)
        .then((value) => {
          if (
            controller.signal.aborted ||
            generation.current !== epoch ||
            credentials.current !== captured
          )
            return;
          if (
            (activeVersion.current && !sameId(value.versionId, activeVersion.current)) ||
            Date.parse(value.expiresAt) <= Date.now()
          )
            clearAccess();
        })
        .catch((caught) => {
          if (!controller.signal.aborted && generation.current === epoch && denied(caught))
            clearAccess();
        });
    };
    launch();
    window.addEventListener("hashchange", launch);
    window.addEventListener("focus", focus);
    return () => {
      generation.current++;
      abort.current?.abort();
      working.current = false;
      window.removeEventListener("hashchange", launch);
      window.removeEventListener("focus", focus);
    };
    // The launch handlers intentionally read the current credential refs.
  }, [assignmentId]);
  useEffect(() => {
    if (!preview) return;
    let timer: number;
    const expire = () => {
      const remaining = Date.parse(preview.assignment.expiresAt) - Date.now();
      if (remaining <= 0) clearAccess();
      else timer = window.setTimeout(expire, Math.min(remaining, 2_147_483_647));
    };
    expire();
    return () => clearTimeout(timer);
  }, [preview]);
  const block = preview?.review.blocks[index],
    review = preview?.review;
  const readIds = new Set(attempt?.readBlockIds.map((id) => id.toLowerCase()));
  return (
    <div className={styles.review} lang="en-CA">
      <header className="shell topbar">
        <Brand />
      </header>
      <main className="shell page-main" id="main">
        {preview && review && block && credentials.current ? (
          <>
            <h1>{review.title}</h1>
            <p>
              Reading assignment · Published version {review.version} · Deadline{" "}
              {new Date(preview.assignment.expiresAt).toLocaleString("en-CA")}
            </p>
            <p>
              Reading completion is self-reported; identity is not verified. Questions are
              read-only. Responses, scores and mastery are not collected.
            </p>
            <section className={readingStyles.reader} aria-label="Your reader">
              {attempt ? (
                <>
                  <p role="status">
                    {attempt.readBlockIds.length} of {review.blocks.length} pages read
                  </p>
                  {attempt.completedAt ? (
                    <p role="status">
                      <strong>Reading complete</strong> — you marked every page read and finished
                      this reading assignment.
                    </p>
                  ) : (
                    <p>Mark each page read, then finish when you are ready.</p>
                  )}
                </>
              ) : (
                <>
                  <p>Previewing does not start a reader or mark any page read.</p>
                  {hasResume ? (
                    <button type="button" disabled={busy} onClick={() => void resume()}>
                      Resume reading
                    </button>
                  ) : null}
                  {!pending ? (
                    <button type="button" disabled={busy} onClick={() => void start(true)}>
                      {hasResume ? "Start a new reader" : "Start reading"}
                    </button>
                  ) : null}
                </>
              )}
              {resumeUrl ? (
                <div className={readingStyles.resume}>
                  <p>
                    Keep your personal resume link to continue after refreshing or on another
                    device. Anyone with this link can access your reading progress.
                  </p>
                  <label>
                    Your private resume link
                    <textarea
                      readOnly
                      rows={3}
                      value={resumeUrl}
                      onFocus={(event) => event.currentTarget.select()}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      if (!navigator.clipboard?.writeText) {
                        setError("Select and copy your private resume link.");
                        return;
                      }
                      void navigator.clipboard
                        .writeText(resumeUrl)
                        .catch(() => setError("Select and copy your private resume link."));
                    }}
                  >
                    Copy private resume link
                  </button>
                </div>
              ) : null}
              {attempt || hasResume || pendingStart.current ? (
                <>
                  <p>
                    Clear reader before someone else uses this browser. Keep your private resume
                    link first.
                  </p>
                  <button type="button" onClick={resetReader}>
                    Clear reader
                  </button>
                </>
              ) : null}
              {pending === "start" ? (
                <button type="button" disabled={busy} onClick={() => void start(false)}>
                  Retry starting reader
                </button>
              ) : null}
              {pending === "progress" ? (
                <button type="button" disabled={busy} onClick={() => void progress()}>
                  Retry saving progress
                </button>
              ) : null}
            </section>
            <div className={styles.reviewLayout}>
              <nav aria-label="Presentation pages" className={styles.pageMap}>
                <ol>
                  {review.blocks.map((page, pageIndex) => (
                    <li key={page.id}>
                      <button
                        type="button"
                        aria-current={index === pageIndex ? "page" : undefined}
                        disabled={busy || !!pending}
                        onClick={() => void changePage(pageIndex)}
                      >
                        {pageIndex + 1}. {presentationReviewBlockTitle(page, pageIndex)}
                        {readIds.has(page.id.toLowerCase()) ? " · Read" : ""}
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
                      interactionSourceKey={`${assignmentId}:${review.versionId}:${block.id}`}
                      interactionRuntime={{
                        mode: "review",
                        navigationTargets: review.blocks.map((page) => ({
                          blockId: page.id,
                          available: true,
                          blockedReason: null,
                        })),
                        onNavigate: (_nodeId, id) => {
                          const target = review.blocks.findIndex((page) => sameId(page.id, id));
                          if (target >= 0) void changePage(target);
                        },
                      }}
                      media={
                        block.mediaId ? (
                          <ReadingImage
                            assignmentId={assignmentId}
                            token={credentials.current.token}
                            mediaId={block.mediaId}
                            alt={block.mediaAlt}
                          />
                        ) : undefined
                      }
                      renderSceneImage={(mediaId, alt) => (
                        <ReadingImage
                          assignmentId={assignmentId}
                          token={credentials.current!.token}
                          mediaId={mediaId}
                          alt={alt}
                        />
                      )}
                    />
                    <details open className={styles.readable}>
                      <summary>Readable text</summary>
                      {block.scene
                        ? block.scene.nodes.map((node) =>
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
                      <ReadingImage
                        assignmentId={assignmentId}
                        token={credentials.current.token}
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
                    disabled={busy || !!pending || index === 0}
                    onClick={() => void changePage(index - 1)}
                  >
                    Previous page
                  </button>
                  <button
                    type="button"
                    disabled={busy || !!pending || index === review.blocks.length - 1}
                    onClick={() => void changePage(index + 1)}
                  >
                    Next page
                  </button>
                </div>
                {attempt && !attempt.completedAt ? (
                  <div className={styles.controls}>
                    <button
                      type="button"
                      disabled={busy || !!pending || readIds.has(block.id.toLowerCase())}
                      onClick={() => void progress("read")}
                    >
                      {readIds.has(block.id.toLowerCase())
                        ? "Page marked read"
                        : "Mark page as read"}
                    </button>
                    <button
                      type="button"
                      disabled={busy || !!pending || readIds.size !== review.blocks.length}
                      onClick={() => void progress("complete")}
                    >
                      Finish reading
                    </button>
                  </div>
                ) : null}
              </section>
            </div>
          </>
        ) : (
          <>
            <h1>Private reading assignment</h1>
            <p role={loading ? "status" : "alert"}>
              {loading
                ? "Opening reading assignment…"
                : "This reading assignment is unavailable or has expired."}
            </p>
            {credentials.current ? (
              <button type="button" disabled={busy} onClick={() => void loadPreview()}>
                Retry opening assignment
              </button>
            ) : null}
          </>
        )}
        {busy ? <p role="status">Checking and saving…</p> : null}
        {error ? <p role="alert">{error}</p> : null}
        <details className={readingStyles.resume}>
          <summary>Use a personal resume link</summary>
          <label>
            Personal resume link
            <textarea
              value={pastedLink}
              rows={3}
              onChange={(event) => setPastedLink(event.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const value = parseReadingLink(pastedLink, assignmentId, window.location.origin);
              if (!value?.reader) {
                setError("Enter your complete personal resume link for this assignment.");
                return;
              }
              resetReader();
              credentials.current = value;
              activeVersion.current = null;
              setPreview(null);
              setHasResume(true);
              void loadPreview();
            }}
          >
            Open resume link
          </button>
        </details>
      </main>
    </div>
  );
}
