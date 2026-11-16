"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  CreatePresentationVisualImportSchema,
  InsertPresentationVisualImportSchema,
  type PresentationVisualImportJob,
  type PresentationVisualImportPage,
  type SupportedLocale,
} from "@openround/contracts";
import { apiFetch, humanError } from "../../lib/api";
import { loadBuilderRecovery, saveBuilderRecovery } from "../../lib/builder-recovery";
import { clientUuid } from "../../lib/uuid";
import {
  defaultVisualImportLimits,
  moveVisualPage,
  RetainedVisualImportRequest,
  visualImportDefinitivelyRejected,
  visualImportFileError,
  visualReviewComplete,
  type VisualImportLimits,
  type VisualPageReview,
} from "../../lib/presentation-visual-import";
import { useWorkspace } from "../workspace/workspace-provider";
import styles from "./presentation-visual-import.module.css";
import {
  visualImportCopy,
  visualImportFeedback,
  type VisualImportCopyKey,
} from "./visual-import-copy";

interface Props {
  locale?: SupportedLocale;
  presentationId: string;
  open: boolean;
  preparationBlocked?: boolean;
  afterBlockId: string | null;
  prepareInsert: () => Promise<number>;
  onInserted: (blockIds: string[]) => Promise<void> | void;
  onReloadDraft: () => Promise<void>;
  onClose: () => void;
  onResumeRequired: () => void;
  onPendingChange: (pending: boolean) => void;
}
interface Recovery {
  createBody: string | null;
  insertBody: string | null;
  insertJobId: string | null;
  jobId: string;
  order: number[];
  reviews: Record<number, VisualPageReview>;
  fidelity: boolean;
}
const emptyRecovery: Recovery = {
  createBody: null,
  insertBody: null,
  insertJobId: null,
  jobId: "",
  order: [],
  reviews: {},
  fidelity: false,
};
const focusableSelector =
  'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex="0"]';

function SystemFeedback({ locale, raw }: { locale: SupportedLocale; raw: string }) {
  const feedback = visualImportFeedback(locale, raw);
  return <span lang={feedback.lang}>{feedback.text}</span>;
}

function readFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("This file could not be read. Choose it again."));
    reader.onload = () => {
      const data = typeof reader.result === "string" ? reader.result : "";
      const separator = data.indexOf(",");
      if (separator < 0) reject(new Error("This file could not be prepared for conversion."));
      else resolve(data.slice(separator + 1));
    };
    reader.readAsDataURL(file);
  });
}

export function PagePreview({
  path,
  page,
  locale = "en-CA",
}: {
  path: string;
  page: PresentationVisualImportPage;
  locale?: SupportedLocale;
}) {
  const copy = visualImportCopy(locale);
  const [source, setSource] = useState("");
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void apiFetch<{ downloadUrl: string }>(`${path}/pages/${page.pageNumber}`, {
      signal: controller.signal,
    })
      .then(({ downloadUrl }) => {
        if (active) {
          setSource(downloadUrl);
          setError(false);
        }
      })
      .catch(() => {
        if (active) {
          setSource("");
          setError(true);
        }
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [path, page.pageNumber, retry]);
  return (
    <div className={styles.preview} lang={locale}>
      {source ? (
        // Private signed media is authorized by the page-preview endpoint.
        <img
          src={source}
          alt={copy("Visual conversion preview of page {page}. Review its meaning below.", {
            page: page.pageNumber,
          })}
        />
      ) : (
        <p role="status">{copy(error ? "Preview unavailable." : "Loading private preview…")}</p>
      )}
      {error ? (
        <button type="button" onClick={() => setRetry((value) => value + 1)}>
          {copy("Retry page preview")}
        </button>
      ) : null}
    </div>
  );
}

export function VisualPageReviewFields({
  locale = "en-CA",
  pageNumber,
  review,
  disabled,
  onChange,
}: {
  locale?: SupportedLocale;
  pageNumber: number;
  review: VisualPageReview;
  disabled: boolean;
  onChange: (review: VisualPageReview) => void;
}) {
  const copy = visualImportCopy(locale);
  function change(field: "title" | "alternativeText" | "accessibleText", value: string) {
    onChange({ ...review, [field]: value, readingOrderReviewed: false });
  }
  return (
    <fieldset disabled={disabled} className={styles.review} lang={locale}>
      <legend>{copy("Accessible reading version for page {page}", { page: pageNumber })}</legend>
      <label>
        {copy("Slide title")}
        <input
          lang=""
          maxLength={160}
          value={review.title}
          onChange={(event) => change("title", event.target.value)}
        />
      </label>
      <label>
        {copy("Image description")}
        <textarea
          lang=""
          maxLength={300}
          value={review.alternativeText}
          onChange={(event) => change("alternativeText", event.target.value)}
        />
      </label>
      <p>
        {copy(
          "A short description identifies the visual. The separate reading slide must explain its meaningful content.",
        )}
      </p>
      <label>
        {copy("Accessible text")}
        <textarea
          lang=""
          rows={7}
          maxLength={3000}
          value={review.accessibleText}
          onChange={(event) => change("accessibleText", event.target.value)}
        />
      </label>
      <p>
        {copy(
          "{count} / 3000 characters. Check reading order, charts, labels and meaning. Text extraction is a suggestion, not an accessible equivalent. Scanned pages may have no extracted text; write the reading version yourself.",
          { count: review.accessibleText.length },
        )}
      </p>
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={review.readingOrderReviewed}
          onChange={(event) => onChange({ ...review, readingOrderReviewed: event.target.checked })}
        />
        {copy("I reviewed the reading order and meaning of this page.")}
      </label>
    </fieldset>
  );
}

export function PresentationVisualImport({
  locale = "en-CA",
  presentationId,
  open,
  afterBlockId,
  prepareInsert,
  onInserted,
  onReloadDraft,
  onClose,
  onResumeRequired,
  onPendingChange,
  preparationBlocked = false,
}: Props) {
  const copy = visualImportCopy(locale);
  const { creator } = useWorkspace();
  const base = `/v1/presentations/${presentationId}/visual-imports`;
  const recoveryKey = `visual-import:${creator?.userId ?? ""}:${creator?.workspaceId ?? ""}:${presentationId}`;
  const [loaded, setLoaded] = useState(false);
  const [available, setAvailable] = useState(false);
  const [limits, setLimits] = useState<VisualImportLimits>(defaultVisualImportLimits);
  const [jobs, setJobs] = useState<PresentationVisualImportJob[]>([]);
  const [state, setState] = useState<Recovery>(emptyRecovery);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [receiptPending, setReceiptPending] = useState(false);
  const [revisionConflict, setRevisionConflict] = useState(false);
  const mounted = useRef(false);
  const flight = useRef(false);
  const createRequest = useRef(new RetainedVisualImportRequest());
  const insertRequest = useRef(new RetainedVisualImportRequest());
  const writes = useRef(Promise.resolve());
  const dialogRef = useRef<HTMLDivElement>(null);
  const deferredResume = useRef(false);
  const callbacks = useRef({ onResumeRequired, onPendingChange });
  callbacks.current = { onResumeRequired, onPendingChange };

  const persist = useCallback(
    (next: Recovery) => {
      const write = writes.current
        .catch(() => undefined)
        .then(() => saveBuilderRecovery(recoveryKey, 0, next));
      writes.current = write;
      return write;
    },
    [recoveryKey],
  );

  useEffect(() => {
    mounted.current = true;
    let active = true;
    callbacks.current.onPendingChange(true);
    void loadBuilderRecovery<Recovery>(recoveryKey)
      .then((saved) => {
        if (!active) return;
        if (saved) {
          const value = saved.draft;
          if (value.createBody) {
            CreatePresentationVisualImportSchema.parse(JSON.parse(value.createBody));
            createRequest.current.restore(value.createBody);
          }
          if (value.insertBody) {
            InsertPresentationVisualImportSchema.parse(JSON.parse(value.insertBody));
            insertRequest.current.restore(value.insertBody);
          }
          setState(value);
          if (value.createBody || value.insertBody) {
            setReceiptPending(true);
            callbacks.current.onPendingChange(true);
            deferredResume.current = true;
          }
        }
        callbacks.current.onPendingChange(
          Boolean(createRequest.current.body || insertRequest.current.body),
        );
        setLoaded(true);
      })
      .catch(() => {
        if (active) {
          deferredResume.current = true;
          setError(
            "The local import receipt could not be recovered. Keep this tab open and reload before starting another import.",
          );
        }
      });
    return () => {
      active = false;
      mounted.current = false;
    };
  }, [recoveryKey]);

  useEffect(() => {
    if (!preparationBlocked && deferredResume.current) {
      deferredResume.current = false;
      callbacks.current.onResumeRequired();
    }
  }, [preparationBlocked, loaded, error]);

  useEffect(() => {
    if (!loaded) return;
    void persist(state).catch(() =>
      setError("The review could not be saved on this device. Keep this tab open."),
    );
  }, [loaded, persist, state]);

  useEffect(() => {
    if (!open || !loaded) return;
    let active = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const result = await apiFetch<{
          available: boolean;
          jobs: PresentationVisualImportJob[];
          limits: VisualImportLimits;
        }>(base, { signal: controller.signal });
        if (!active) return;
        setAvailable(result.available);
        setLimits(result.limits);
        setJobs(result.jobs);
        if (result.jobs.some((job) => job.status === "pending" || job.status === "processing"))
          timer = setTimeout(() => void refresh(), 2000);
      } catch (caught) {
        if (active) setError(humanError(caught));
      }
    }
    void refresh();
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [base, open, loaded, refreshKey]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    return () => previous?.focus();
  }, [open]);

  useEffect(() => {
    if (!receiptPending) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [receiptPending]);

  const job = jobs.find((item) => item.id === state.jobId);
  const locked = busy || receiptPending;
  const selectedReady =
    job?.status === "ready" &&
    state.order.length > 0 &&
    state.order.every((number) => visualReviewComplete(state.reviews[number]));

  function update(next: Recovery) {
    setState(next);
  }
  function pending(value: boolean) {
    setReceiptPending(value);
    callbacks.current.onPendingChange(value);
  }
  function chooseJob(next: PresentationVisualImportJob) {
    if (locked || state.jobId === next.id) return;
    setError("");
    setRevisionConflict(false);
    setState({
      ...emptyRecovery,
      jobId: next.id,
      order: next.pages.map((page) => page.pageNumber),
      reviews: Object.fromEntries(
        next.pages.map((page) => [
          page.pageNumber,
          {
            title: `Page ${page.pageNumber}`,
            alternativeText: "",
            accessibleText: page.extractedText,
            readingOrderReviewed: false,
          },
        ]),
      ),
    });
  }

  // A processing job gains its review defaults only once its immutable pages are ready.
  useEffect(() => {
    if (!job || job.status !== "ready" || Object.keys(state.reviews).length > 0 || receiptPending)
      return;
    setState((current) => ({
      ...current,
      order: job.pages.map((page) => page.pageNumber),
      reviews: Object.fromEntries(
        job.pages.map((page) => [
          page.pageNumber,
          {
            title: `Page ${page.pageNumber}`,
            alternativeText: "",
            accessibleText: page.extractedText,
            readingOrderReviewed: false,
          },
        ]),
      ),
    }));
  }, [job, state.reviews, receiptPending]);

  async function create() {
    if (flight.current || !loaded) return;
    flight.current = true;
    setBusy(true);
    setError("");
    try {
      if (!createRequest.current.body) {
        const validation = visualImportFileError(files, limits);
        if (validation) throw new Error(validation);
        const request = CreatePresentationVisualImportSchema.parse({
          requestId: clientUuid(),
          retainOriginal: false,
          files: await Promise.all(
            files.map(async (file) => ({
              name: file.name,
              mimeType: file.type,
              base64: await readFile(file),
            })),
          ),
        });
        if (!mounted.current) return;
        createRequest.current.retain(request);
      }
      if (!mounted.current) return;
      const retained = { ...stateRef.current, createBody: createRequest.current.body };
      pending(true);
      setState(retained);
      await persist(retained);
      if (!mounted.current) return;
      const result = await apiFetch<{ job: PresentationVisualImportJob }>(base, {
        method: "POST",
        body: createRequest.current.body,
      });
      const next = { ...emptyRecovery, jobId: result.job.id };
      await persist(next);
      createRequest.current.clear();
      if (!mounted.current) return;
      pending(false);
      setState(next);
      setFiles([]);
      setJobs((current) => [result.job, ...current.filter((item) => item.id !== result.job.id)]);
      setRefreshKey((value) => value + 1);
    } catch (caught) {
      if (visualImportDefinitivelyRejected(caught)) {
        createRequest.current.clear();
        const next = { ...stateRef.current, createBody: null };
        await persist(next).catch(() => undefined);
        if (mounted.current) {
          setState(next);
          pending(false);
        }
      }
      if (mounted.current) setError(humanError(caught));
    } finally {
      flight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function insert() {
    if (
      flight.current ||
      preparationBlocked ||
      !loaded ||
      (!insertRequest.current.body && (!selectedReady || !state.fidelity || !job))
    )
      return;
    flight.current = true;
    setBusy(true);
    setError("");
    try {
      let next = stateRef.current;
      if (!insertRequest.current.body) {
        const expectedRevision = await prepareInsert();
        if (!mounted.current) return;
        const request = InsertPresentationVisualImportSchema.parse({
          expectedRevision,
          mutationId: clientUuid(),
          afterBlockId,
          fidelityAccepted: true,
          pages: state.order.map((pageNumber) => ({ pageNumber, ...state.reviews[pageNumber] })),
        });
        insertRequest.current.retain(request);
        next = { ...next, insertBody: insertRequest.current.body, insertJobId: job!.id };
      }
      pending(true);
      setState(next);
      await persist(next);
      if (!mounted.current) return;
      const result = await apiFetch<{ insertedBlockIds: string[] }>(
        `${base}/${next.insertJobId}/insert`,
        { method: "POST", body: insertRequest.current.body },
      );
      // The persisted request is recovered by the next mount if this editor has left its scope.
      if (!mounted.current) return;
      // Recover the authoritative draft before allowing any local edits or a second insertion.
      await onInserted(result.insertedBlockIds);
      const settled = { ...emptyRecovery };
      await persist(settled);
      insertRequest.current.clear();
      if (!mounted.current) return;
      setState(settled);
      pending(false);
      onClose();
    } catch (caught) {
      if (visualImportDefinitivelyRejected(caught)) {
        setRevisionConflict((caught as { status?: number }).status === 409);
        insertRequest.current.clear();
        const next = { ...stateRef.current, insertBody: null, insertJobId: null };
        await persist(next).catch(() => undefined);
        if (mounted.current) {
          setState(next);
          pending(false);
        }
      }
      if (mounted.current)
        setError(
          `${humanError(caught)}${visualImportDefinitivelyRejected(caught) ? " Your review is retained. Reload the latest draft before confirming the insertion position again." : ""}`,
        );
    } finally {
      flight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function cancelJob() {
    if (!job || locked || flight.current) return;
    flight.current = true;
    setBusy(true);
    setError("");
    try {
      await apiFetch(`${base}/${job.id}`, { method: "DELETE" });
      const next = { ...emptyRecovery };
      await persist(next);
      if (mounted.current) {
        setState(next);
        setRefreshKey((value) => value + 1);
      }
    } catch (caught) {
      if (mounted.current) setError(humanError(caught));
    } finally {
      flight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function close() {
    if (!busy && !receiptPending) onClose();
  }
  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
    if (event.key !== "Tab") return;
    const elements = [
      ...event.currentTarget.querySelectorAll<HTMLElement>(focusableSelector),
    ].filter((element) => element.offsetParent !== null);
    const first = elements[0];
    const last = elements.at(-1);
    if (!first) {
      event.preventDefault();
      dialogRef.current?.focus();
    } else if (
      event.shiftKey &&
      (document.activeElement === first || document.activeElement === dialogRef.current)
    ) {
      event.preventDefault();
      last?.focus();
    } else if (
      !event.shiftKey &&
      (document.activeElement === last || document.activeElement === dialogRef.current)
    ) {
      event.preventDefault();
      first.focus();
    }
  }

  if (!open) return null;
  const retainedSuffix =
    " Your review is retained. Reload the latest draft before confirming the insertion position again.";
  const reviewRetained = error.endsWith(retainedSuffix);
  const feedback = visualImportFeedback(
    locale,
    reviewRetained ? error.slice(0, -retainedSuffix.length) : error,
  );
  const statuses = {
    pending: "Pending",
    processing: "Processing",
    ready: "Ready",
    failed: "Failed",
    canceled: "Canceled",
  } as const satisfies Record<PresentationVisualImportJob["status"], VisualImportCopyKey>;
  return (
    <div className={styles.backdrop}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="visual-import-title"
        tabIndex={-1}
        onKeyDown={keyboard}
        className={styles.dialog}
        lang={locale}
      >
        <header className={styles.heading}>
          <div>
            <p>{copy("Review before insertion")}</p>
            <h2 id="visual-import-title">{copy("Import visual slides")}</h2>
          </div>
          <button type="button" disabled={locked} onClick={close}>
            {copy("Close visual import")}
          </button>
        </header>
        <p>
          {copy("Import one PDF or an image set. Each selected page becomes")}{" "}
          <strong>{copy("2 slides: a visual and an editable reading version")}</strong>
          {copy(
            ". The page image contains no editable source objects. Add or reorder native slides and activities between them after insertion.",
          )}
        </p>
        <p>
          {copy(
            "This visual conversion is separate from trusted-source proposals. Animations, transitions, audio, video and interactive content are not preserved. Links and reading order may be lost. There is no OCR guarantee.",
          )}
        </p>
        <p>
          {copy(
            "Original files are not retained: they are deleted after conversion, failure or cancellation, or within 24 hours. Uninserted converted pages expire with the job. A local recovery copy of an upload request is kept only until its acknowledgement is recovered.",
          )}
        </p>
        {error ? (
          <p role="alert" className={styles.error}>
            <span lang={feedback.lang}>{feedback.text}</span>
            {reviewRetained ? (
              <>
                {" "}
                <span lang={locale}>
                  {copy(
                    "Your review is retained. Reload the latest draft before confirming the insertion position again.",
                  )}
                </span>
              </>
            ) : null}
          </p>
        ) : null}
        {revisionConflict && !receiptPending ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (flight.current) return;
              flight.current = true;
              setBusy(true);
              void onReloadDraft()
                .then(() => {
                  if (mounted.current) {
                    setRevisionConflict(false);
                    setError("");
                  }
                })
                .catch((caught) => {
                  if (mounted.current) setError(humanError(caught));
                })
                .finally(() => {
                  flight.current = false;
                  if (mounted.current) setBusy(false);
                });
            }}
          >
            {copy("Reload latest draft and keep review")}
          </button>
        ) : null}
        {!loaded ? <p role="status">{copy("Recovering import receipts…")}</p> : null}
        {receiptPending ? (
          <section className={styles.notice} aria-label={copy("Pending import acknowledgement")}>
            <p>
              {copy(
                "Editing is paused until this exact request is acknowledged. Retrying uses the same request and cannot insert duplicate slides. Keep this tab open.",
              )}
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void (state.insertBody ? insert() : create())}
            >
              {copy(state.insertBody ? "Retry same insertion" : "Retry same upload")}
            </button>
          </section>
        ) : null}
        {!available && loaded ? (
          <p role="status">
            {copy(
              "Visual import is currently unavailable. Ask a workspace operator to check availability, or continue editing native slides.",
            )}
          </p>
        ) : null}
        <section aria-label={copy("Upload visual slides")} className={styles.upload}>
          <label>
            {copy("PDF or images")}
            <input
              disabled={!loaded || !available || locked}
              type="file"
              multiple
              accept="application/pdf,image/png,image/jpeg,image/webp"
              onChange={(event) => {
                setFiles(Array.from(event.target.files ?? []));
                setError("");
                event.target.value = "";
              }}
            />
          </label>
          <p>
            {copy(
              "PDF: up to {pdfMb} MB and {pages} pages. Images: up to {pages}, 10 MiB each and {totalMb} MB total.",
              {
                pdfMb: limits.maxPdfBytes / 1_000_000,
                pages: limits.maxPages,
                totalMb: limits.maxImageSetBytes / 1_000_000,
              },
            )}
          </p>
          {files.length ? <p lang="">{files.map((file) => file.name).join(", ")}</p> : null}
          <button
            type="button"
            disabled={!loaded || !available || locked || !files.length}
            onClick={() => void create()}
          >
            {copy("Convert for review")}
          </button>
        </section>
        <section aria-label={copy("Visual import jobs")} className={styles.jobs}>
          <h3>{copy("Resume a conversion")}</h3>
          <button
            type="button"
            disabled={locked}
            onClick={() => setRefreshKey((value) => value + 1)}
          >
            {copy("Refresh conversions")}
          </button>
          {!jobs.length ? (
            <p>{copy("No conversions available.")}</p>
          ) : (
            <ul>
              {jobs.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    disabled={locked}
                    aria-pressed={state.jobId === item.id}
                    onClick={() => chooseJob(item)}
                  >
                    <span lang="">{item.sourceName}</span> · {copy(statuses[item.status])}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        {job ? (
          <section aria-label={copy("Conversion review")}>
            <h3 lang="">{job.sourceName}</h3>
            <p role="status">
              {job.status === "pending" || job.status === "processing"
                ? copy("Converting privately. Nothing has been inserted.")
                : copy("Conversion {status}.", { status: copy(statuses[job.status]) })}
            </p>
            <p>
              {copy("Review available until {date}.", {
                date: new Date(job.expiresAt).toLocaleString(locale),
              })}
            </p>
            {job.error ? (
              <p role="alert">
                <SystemFeedback locale={locale} raw={job.error.message} />{" "}
                {copy("Try an unencrypted PDF export or a smaller batch.")}
              </p>
            ) : null}
            {job.warnings.length ? (
              <section aria-label={copy("Conversion loss report")}>
                <h4>{copy("Conversion loss report")}</h4>
                <ul>
                  {job.warnings.map((warning, index) => (
                    <li key={index}>
                      <SystemFeedback locale={locale} raw={warning} />
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {job.status === "ready" ? (
              <>
                <p>
                  {copy(
                    "Select pages, then use Move up or Move down to set insertion order. Review the accessible text for every selected page. Nothing is inserted until you confirm.",
                  )}
                </p>
                <div className={styles.pageSelection}>
                  {job.pages.map((page) => (
                    <label key={page.pageNumber}>
                      <input
                        type="checkbox"
                        disabled={locked}
                        checked={state.order.includes(page.pageNumber)}
                        onChange={() =>
                          update({
                            ...state,
                            order: state.order.includes(page.pageNumber)
                              ? state.order.filter((number) => number !== page.pageNumber)
                              : [...state.order, page.pageNumber],
                          })
                        }
                      />
                      {copy("Page {page}", { page: page.pageNumber })}
                    </label>
                  ))}
                </div>
                <p role="status">
                  {copy("Selected page order: {order}.", {
                    order: state.order.length ? state.order.join(", ") : copy("none"),
                  })}
                </p>
                <ol className={styles.pages}>
                  {state.order.map((pageNumber, index) => {
                    const page = job.pages.find((item) => item.pageNumber === pageNumber)!;
                    const review = state.reviews[pageNumber];
                    return review ? (
                      <li key={`${job.id}:${pageNumber}`}>
                        <article aria-label={copy("Review page {page}", { page: pageNumber })}>
                          <h4>
                            {copy("Page {page} · position {position}", {
                              page: pageNumber,
                              position: index + 1,
                            })}
                          </h4>
                          <div className={styles.actions}>
                            <button
                              type="button"
                              disabled={locked || index === 0}
                              onClick={() =>
                                update({
                                  ...state,
                                  order: moveVisualPage(state.order, pageNumber, -1),
                                })
                              }
                              aria-label={copy("Move up page {page}", { page: pageNumber })}
                            >
                              {copy("Move up")}
                            </button>
                            <button
                              type="button"
                              disabled={locked || index === state.order.length - 1}
                              onClick={() =>
                                update({
                                  ...state,
                                  order: moveVisualPage(state.order, pageNumber, 1),
                                })
                              }
                              aria-label={copy("Move down page {page}", { page: pageNumber })}
                            >
                              {copy("Move down")}
                            </button>
                          </div>
                          <PagePreview path={`${base}/${job.id}`} page={page} locale={locale} />
                          {page.warnings.map((warning, i) => (
                            <p key={i}>
                              <SystemFeedback locale={locale} raw={warning} />
                            </p>
                          ))}
                          <VisualPageReviewFields
                            locale={locale}
                            pageNumber={pageNumber}
                            review={review}
                            disabled={locked}
                            onChange={(value) =>
                              update({
                                ...state,
                                reviews: { ...state.reviews, [pageNumber]: value },
                              })
                            }
                          />
                        </article>
                      </li>
                    ) : null;
                  })}
                </ol>
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    disabled={locked}
                    checked={state.fidelity}
                    onChange={(event) => update({ ...state, fidelity: event.target.checked })}
                  />
                  {copy(
                    "I accept the conversion losses and understand that visual images are not editable source objects.",
                  )}
                </label>
                <p role="status">
                  {copy("{pages} selected pages · {slides} slides. Insert {position}.", {
                    pages: state.order.length,
                    slides: state.order.length * 2,
                    position: copy(
                      afterBlockId
                        ? "after the selected slide or activity"
                        : "at the end of this Presentation",
                    ),
                  })}
                </p>
                <button
                  type="button"
                  disabled={locked || revisionConflict || !selectedReady || !state.fidelity}
                  onClick={() => void insert()}
                >
                  {copy("Insert {count} reviewed slides", { count: state.order.length * 2 })}
                </button>
              </>
            ) : null}
            {job.status !== "canceled" ? (
              <button type="button" disabled={locked} onClick={() => void cancelJob()}>
                {copy("Cancel conversion and remove uninserted pages")}
              </button>
            ) : null}
          </section>
        ) : null}
        {busy ? <p role="status">{copy("Working…")}</p> : null}
      </div>
    </div>
  );
}
