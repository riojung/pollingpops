"use client";

import { useEffect, useRef, useState } from "react";
import type {
  PresentationPracticePreview,
  PresentationPracticeAttempt,
  PresentationPracticeProgress,
} from "@openround/contracts";
import { ApiClientError } from "../../lib/api";
import { clientUuid } from "../../lib/uuid";
import {
  capturePracticeCredentials,
  fetchPracticeAccess,
  fetchPracticeAttempt,
  fetchPracticePreview,
  newPracticeAttempt,
  parsePracticeLink,
  practiceResumeUrl,
  recordPracticeProgress,
  startPracticeAttempt,
  verifyPracticeAnswers,
  type PracticeCredentials,
} from "../../lib/presentation-practice-client";

const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const denied = (error: unknown) =>
  error instanceof ApiClientError && [401, 403, 404, 410].includes(error.status);
interface ReaderState {
  preview: PresentationPracticePreview | null;
  attempt: PresentationPracticeAttempt | null;
  hasResume: boolean;
  resumeUrl: string;
  index: number;
  busy: boolean;
  loading: boolean;
  pending: "start" | "progress" | null;
  error: string;
}
const initial: ReaderState = {
  preview: null,
  attempt: null,
  hasResume: false,
  resumeUrl: "",
  index: 0,
  busy: false,
  loading: true,
  pending: null,
  error: "",
};

/** Credentials and uncertain commands exist only for this mounted recipient. */
export function usePracticeReader(assignmentId: string) {
  const memory = useRef({
    credentials: null as PracticeCredentials | null,
    preview: null as PresentationPracticePreview | null,
    attempt: null as PresentationPracticeAttempt | null,
    version: null as string | null,
    epoch: 0,
    working: false,
    controller: null as AbortController | null,
    pendingStart: false,
    progress: null as PresentationPracticeProgress | null,
  });
  const [state, setState] = useState<ReaderState>(initial);
  const patch = (value: Partial<ReaderState>) => setState((current) => ({ ...current, ...value }));
  function resetReader(clearAccess = false) {
    const m = memory.current;
    m.epoch++;
    m.controller?.abort();
    m.working = false;
    m.attempt = null;
    m.progress = null;
    m.pendingStart = false;
    m.credentials =
      !clearAccess && m.credentials ? { token: m.credentials.token, reader: null } : null;
    if (clearAccess) {
      m.preview = null;
      m.version = null;
    }
    patch({
      attempt: null,
      hasResume: false,
      resumeUrl: "",
      pending: null,
      busy: false,
      error: "",
      index: 0,
      ...(clearAccess ? { preview: null, loading: false } : {}),
    });
  }
  function verify(value: PresentationPracticePreview) {
    const m = memory.current;
    if (
      value.assignment.revokedAt ||
      Date.parse(value.assignment.expiresAt) <= Date.now() ||
      (m.version && !sameId(m.version, value.review.versionId))
    )
      throw new ApiClientError(
        "Practice assignment unavailable",
        "PRESENTATION_PRACTICE_UNAVAILABLE",
        404,
      );
  }
  function merge(value: PresentationPracticeAttempt) {
    const m = memory.current;
    if (m.attempt && sameId(m.attempt.id, value.id) && value.revision < m.attempt.revision)
      return false;
    const review = m.preview?.review;
    if (
      !review ||
      !m.credentials?.reader ||
      !sameId(value.id, m.credentials.reader.attemptId) ||
      !sameId(value.assignmentId, assignmentId) ||
      value.readBlockIds.some((id) => !review.blocks.some((b) => sameId(b.id, id)))
    )
      throw new Error("The practice progress could not be verified.");
    verifyPracticeAnswers(value, review);
    if (
      m.attempt &&
      (m.attempt.readBlockIds.some((id) => !value.readBlockIds.some((next) => sameId(id, next))) ||
        m.attempt.answers.some(
          (answer) =>
            !value.answers.some(
              (next) =>
                sameId(answer.blockId, next.blockId) &&
                sameId(answer.choiceId, next.choiceId) &&
                answer.correct === next.correct &&
                answer.submittedAt === next.submittedAt &&
                sameId(answer.feedback.correctChoiceId, next.feedback.correctChoiceId) &&
                answer.feedback.explanation === next.feedback.explanation &&
                answer.feedback.selectedFeedback === next.feedback.selectedFeedback,
            ),
        ))
    )
      throw new Error(
        "The accepted practice progress changed unexpectedly. Retry saving progress.",
      );
    m.attempt = value;
    patch({ attempt: value });
    return true;
  }
  async function run(
    action: (signal: AbortSignal, valid: () => boolean) => Promise<void>,
    failure: (error: unknown, signal: AbortSignal, valid: () => boolean) => Promise<void> | void,
  ) {
    const m = memory.current;
    if (m.working) return;
    m.working = true;
    m.controller?.abort();
    const controller = new AbortController(),
      epoch = m.epoch;
    m.controller = controller;
    const valid = () => !controller.signal.aborted && m.epoch === epoch;
    patch({ busy: true, error: "" });
    try {
      await action(controller.signal, valid);
    } catch (error) {
      if (valid()) {
        if (denied(error)) resetReader(true);
        else await failure(error, controller.signal, valid);
      }
    } finally {
      if (valid()) {
        m.working = false;
        patch({ busy: false });
      }
    }
  }
  async function refresh(signal: AbortSignal, valid: () => boolean) {
    const m = memory.current,
      captured = m.credentials;
    if (!captured?.reader) return null;
    const value = await fetchPracticeAttempt(assignmentId, captured.reader, signal);
    if (!valid() || m.credentials !== captured) return null;
    verify(value);
    const preview = { assignment: value.assignment, review: value.review };
    m.preview = preview;
    m.version = value.review.versionId;
    merge(value.attempt);
    patch({ preview });
    return value;
  }
  async function loadPreview() {
    const m = memory.current;
    if (!m.credentials) {
      patch({ preview: null, loading: false });
      return;
    }
    await run(
      async (signal, valid) => {
        patch({ loading: true });
        const value = await fetchPracticePreview(assignmentId, m.credentials!.token, signal);
        if (!valid()) return;
        verify(value);
        m.preview = value;
        m.version = value.review.versionId;
        patch({ preview: value, loading: false });
      },
      () => patch({ loading: false, error: "Could not open this practice assignment. Try again." }),
    );
  }
  async function start(fresh: boolean) {
    const m = memory.current;
    if (!m.preview || !m.credentials || m.working || m.progress) return;
    if (fresh) {
      resetReader();
      m.credentials = { token: m.credentials!.token, reader: newPracticeAttempt() };
    }
    const captured = m.credentials;
    if (!captured?.reader) return;
    m.pendingStart = true;
    patch({
      pending: "start",
      resumeUrl: practiceResumeUrl(window.location.origin, assignmentId, captured),
    });
    await run(
      async (signal, valid) => {
        const result = await startPracticeAttempt(
          assignmentId,
          captured.token,
          captured.reader!,
          signal,
        );
        if (!valid() || m.credentials !== captured) return;
        if (result.replayed) await refresh(signal, valid);
        else merge(result.attempt);
        if (!valid()) return;
        m.pendingStart = false;
        patch({ pending: null, hasResume: false });
      },
      () =>
        patch({
          error:
            "Could not confirm your practice attempt. Save your private resume link and retry starting practice.",
        }),
    );
  }
  async function resume() {
    const m = memory.current;
    if (!m.credentials?.reader || m.pendingStart) return;
    await run(
      async (signal, valid) => {
        let value;
        try {
          value = await refresh(signal, valid);
        } catch (error) {
          // A saved start intent may outlive a request that never reached the server.
          // Confirm the assignment independently before offering an explicit exact retry.
          if (!(error instanceof ApiClientError) || error.status !== 404) throw error;
          const access = await fetchPracticeAccess(assignmentId, m.credentials!.token, signal);
          if (!valid()) return;
          if (!sameId(access.versionId, m.version!) || Date.parse(access.expiresAt) <= Date.now()) {
            resetReader(true);
            return;
          }
          m.pendingStart = true;
          patch({
            hasResume: false,
            pending: "start",
            resumeUrl: practiceResumeUrl(window.location.origin, assignmentId, m.credentials!),
            error:
              "This saved attempt could not be confirmed. Retry starting practice to recover the same attempt.",
          });
          return;
        }
        if (!value || !valid()) return;
        patch({
          hasResume: false,
          resumeUrl: practiceResumeUrl(window.location.origin, assignmentId, m.credentials!),
          index: Math.max(
            0,
            value.review.blocks.findIndex((b) => sameId(b.id, value.attempt.currentBlockId ?? "")),
          ),
        });
      },
      () =>
        patch({ error: "Could not resume practice. Try again with your personal resume link." }),
    );
  }
  async function progress(
    kind?: "read" | "answer" | "complete",
    blockId?: string,
    choiceId?: string,
  ) {
    const m = memory.current,
      captured = m.credentials,
      current = m.attempt;
    if (!captured?.reader || !current || !m.preview || m.working) return;
    if (!m.progress) {
      if (!kind || (kind !== "complete" && !blockId) || (kind === "answer" && !choiceId)) return;
      const base = { requestId: clientUuid(), expectedRevision: current.revision };
      m.progress =
        kind === "complete"
          ? { ...base, kind }
          : kind === "read"
            ? { ...base, kind, blockId: blockId! }
            : { ...base, kind, blockId: blockId!, choiceId: choiceId! };
    }
    const request = m.progress;
    patch({ pending: "progress" });
    await run(
      async (signal, valid) => {
        const result = await recordPracticeProgress(
          assignmentId,
          captured.reader!,
          request,
          signal,
        );
        if (!valid() || m.credentials !== captured) return;
        if (!merge(result.attempt)) await refresh(signal, valid);
        if (!valid()) return;
        m.progress = null;
        patch({ pending: null });
      },
      async (error, signal, valid) => {
        if (
          error instanceof ApiClientError &&
          ((error.status === 409 &&
            /(?:REVISION_CONFLICT|COMPLETED|INCOMPLETE|ALREADY_ANSWERED)$/.test(error.code)) ||
            (error.status === 422 && /(?:INVALID_RESPONSE|INVALID_BLOCK)$/.test(error.code)))
        ) {
          try {
            const value = await refresh(signal, valid);
            if (!value || !valid()) return;
            m.progress = null;
            patch({
              pending: null,
              error: "Your practice progress changed. Review it before continuing.",
            });
          } catch (caught) {
            if (valid()) {
              if (denied(caught)) resetReader(true);
              else
                patch({
                  error: "Could not refresh your progress. Retry saving progress to recover it.",
                });
            }
          }
        } else
          patch({
            error: "Could not confirm that your progress was saved. Retry saving progress.",
          });
      },
    );
  }
  async function changePage(index: number) {
    const m = memory.current;
    if (
      !m.credentials ||
      !m.preview ||
      m.progress ||
      m.pendingStart ||
      index < 0 ||
      index >= m.preview.review.blocks.length
    )
      return;
    await run(
      async (signal, valid) => {
        const access = await fetchPracticeAccess(assignmentId, m.credentials!.token, signal);
        if (!valid()) return;
        if (!sameId(access.versionId, m.version!) || Date.parse(access.expiresAt) <= Date.now())
          resetReader(true);
        else patch({ index });
      },
      () => patch({ error: "Could not verify access. Try the page change again." }),
    );
  }
  function openResume(href: string) {
    const value = parsePracticeLink(href, assignmentId, window.location.origin);
    if (!value?.reader) {
      patch({ error: "Enter your complete personal resume link for this assignment." });
      return false;
    }
    resetReader(true);
    memory.current.credentials = value;
    patch({ hasResume: true });
    void loadPreview();
    return true;
  }
  useEffect(() => {
    const m = memory.current;
    const launch = () => {
      const incoming = capturePracticeCredentials({
        assignmentId,
        location: window.location,
        history: window.history,
      });
      if (incoming.provided) {
        resetReader(true);
        m.credentials = incoming.credentials;
        patch({ hasResume: !!incoming.credentials?.reader });
      }
      void loadPreview();
    };
    const focus = () => {
      if (!m.credentials || m.working) return;
      const captured = m.credentials,
        epoch = m.epoch,
        controller = new AbortController();
      m.controller?.abort();
      m.controller = controller;
      void fetchPracticeAccess(assignmentId, captured.token, controller.signal)
        .then((value) => {
          if (
            !controller.signal.aborted &&
            m.epoch === epoch &&
            m.credentials === captured &&
            ((m.version && !sameId(m.version, value.versionId)) ||
              Date.parse(value.expiresAt) <= Date.now())
          )
            resetReader(true);
        })
        .catch((error) => {
          if (!controller.signal.aborted && m.epoch === epoch && denied(error)) resetReader(true);
        });
    };
    launch();
    window.addEventListener("hashchange", launch);
    window.addEventListener("focus", focus);
    return () => {
      m.epoch++;
      m.controller?.abort();
      m.working = false;
      window.removeEventListener("hashchange", launch);
      window.removeEventListener("focus", focus);
    };
    // Handlers intentionally read the current private memory, never browser storage.
  }, [assignmentId]);
  useEffect(() => {
    if (!state.preview) return;
    let timer: ReturnType<typeof setTimeout>;
    const expire = () => {
      const remaining = Date.parse(state.preview!.assignment.expiresAt) - Date.now();
      if (remaining <= 0) resetReader(true);
      else timer = setTimeout(expire, Math.min(remaining, 2_147_483_647));
    };
    expire();
    return () => clearTimeout(timer);
  }, [state.preview]);
  return {
    ...state,
    token: memory.current.credentials?.token ?? null,
    start,
    resume,
    progress,
    changePage,
    resetReader: () => resetReader(),
    loadPreview,
    openResume,
    setError: (error: string) => patch({ error }),
  };
}
