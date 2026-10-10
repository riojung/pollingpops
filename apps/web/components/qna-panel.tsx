"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  QnaPage,
  QnaQuestion,
  QnaSettings,
  ScopedQnaCommand,
  ScopedQnaPage,
} from "@openround/contracts";
import { apiFetch, ApiClientError, humanError, isRetryableReadError } from "../lib/api";
import { createPresentationQnaClient } from "../lib/presentation-qna";
import { clientUuid } from "../lib/uuid";
import { createInFlightRefreshCoalescer, createReadRetryScheduler } from "../lib/refresh-queue";
import { useLocale } from "./locale-provider";

type QnaPanelProps = {
  role: "participant" | "moderator" | "observer";
  sessionId: string;
  token: string;
  revision: number;
  scopeKind?: "round" | "presentation";
};

type PanelPage = QnaPage & Partial<Pick<ScopedQnaPage, "audienceSeq" | "lifecycle">>;
type PendingAction = { key: string; command: ScopedQnaCommand; success: string; done?: () => void };

export function QnaPanel({ role, sessionId, token, revision, scopeKind = "round" }: QnaPanelProps) {
  const { t } = useLocale();
  const [page, setPage] = useState<PanelPage | null>(null);
  const [questionBody, setQuestionBody] = useState("");
  const [replyBodies, setReplyBodies] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<PendingAction | null>(null);
  const loadRequest = useRef(0);
  const refreshQueue = useRef(createInFlightRefreshCoalescer<void>());
  const readRetry = useRef(createReadRetryScheduler());
  const pageSequence = useRef<number | undefined>(undefined);
  const generation = useRef(0);
  const pendingRef = useRef<PendingAction | null>(null);
  const writeInFlight = useRef(false);
  const scoped = useMemo(
    () => (scopeKind === "presentation" ? createPresentationQnaClient(sessionId, token) : null),
    [scopeKind, sessionId, token],
  );
  const statusLabel = (status: QnaQuestion["status"]) => t(`live.qna.status.${status}`);

  const request = useCallback(
    <T,>(path: string, init: RequestInit = {}) =>
      apiFetch<T>(path, {
        ...init,
        headers: { ...init.headers, authorization: `Bearer ${token}` },
      }),
    [token],
  );

  const load = useCallback(
    async (cursor?: string, append = false): Promise<void> => {
      if (!token) return;
      const currentGeneration = generation.current;
      await refreshQueue.current.run(
        `${scopeKind}:${sessionId}:${token}`,
        async () => {
          if (currentGeneration !== generation.current) return;
          // Invalidate only when a read starts, not when another refresh is queued.
          const requestId = ++loadRequest.current;
          readRetry.current.clearPending();
          try {
            const query = new URLSearchParams({ limit: "30" });
            if (cursor) query.set("cursor", cursor);
            let loaded: PanelPage = scoped
              ? await scoped.page(cursor)
              : await request<QnaPage>(
                  `/v1/sessions/${sessionId}/qna/questions?${query.toString()}`,
                );
            if (requestId !== loadRequest.current || currentGeneration !== generation.current)
              return;
            if (scoped && append && loaded.audienceSeq !== pageSequence.current) {
              // A changed sequence invalidates older pages: they may contain removed content.
              loaded = await scoped.page();
              append = false;
              if (requestId !== loadRequest.current || currentGeneration !== generation.current)
                return;
            }
            if (
              loaded.audienceSeq !== undefined &&
              pageSequence.current !== undefined &&
              loaded.audienceSeq < pageSequence.current
            )
              return;
            pageSequence.current = loaded.audienceSeq;
            setPage((current) =>
              loaded &&
              loaded.audienceSeq !== undefined &&
              current?.audienceSeq &&
              loaded.audienceSeq < current.audienceSeq
                ? current
                : append && current
                  ? {
                      ...loaded,
                      questions: [
                        ...new Map(
                          [...current.questions, ...loaded.questions].map((question) => [
                            question.id,
                            question,
                          ]),
                        ).values(),
                      ],
                    }
                  : loaded,
            );
            setError("");
            readRetry.current.reset();
          } catch (caught) {
            if (requestId !== loadRequest.current || currentGeneration !== generation.current)
              return;
            if (
              scoped ||
              (caught instanceof ApiClientError && [401, 403, 404].includes(caught.status))
            )
              setPage(null);
            setError(humanError(caught));
            if (isRetryableReadError(caught)) {
              readRetry.current.schedule(() => {
                if (currentGeneration === generation.current) void load();
              });
            } else readRetry.current.reset();
          }
        },
        true,
      );
    },
    [request, scoped, scopeKind, sessionId, token],
  );

  useEffect(() => {
    generation.current += 1;
    pageSequence.current = undefined;
    readRetry.current.reset();
    setPage(null);
    pendingRef.current = null;
    writeInFlight.current = false;
    setPending(null);
    setQuestionBody("");
    setReplyBodies({});
    setBusyKey("");
    setError("");
    setNotice("");
    return () => {
      generation.current += 1;
      loadRequest.current += 1;
      readRetry.current.reset();
    };
  }, [sessionId, token, scopeKind]);

  useEffect(() => {
    void load();
  }, [load, revision]);

  async function runScoped(action: PendingAction) {
    if (!scoped || writeInFlight.current) return;
    writeInFlight.current = true;
    const currentGeneration = generation.current;
    pendingRef.current = action;
    setPending(action);
    setBusyKey(action.key);
    setError("");
    setNotice("");
    try {
      await scoped.command(action.command);
      if (currentGeneration !== generation.current) return;
      pendingRef.current = null;
      setPending(null);
      action.done?.();
      setNotice(action.success);
      await load();
    } catch (caught) {
      if (currentGeneration !== generation.current) return;
      // Keep the exact command/key on uncertain delivery; never synthesize a second intent.
      if (caught instanceof ApiClientError && caught.status < 500) {
        pendingRef.current = null;
        setPending(null);
        await load();
      }
      setError(humanError(caught));
    } finally {
      if (currentGeneration === generation.current) {
        writeInFlight.current = false;
        setBusyKey("");
      }
    }
  }

  async function perform(key: string, action: () => Promise<unknown>, success = "") {
    setBusyKey(key);
    setError("");
    setNotice("");
    try {
      await action();
      if (success) setNotice(success);
      await load();
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusyKey("");
    }
  }

  async function submitQuestion(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = questionBody.trim();
    if (!body) return;
    if (scoped) {
      if (pendingRef.current) return;
      await runScoped({
        key: "new-question",
        command: { type: "question.create", body, idempotencyKey: clientUuid() },
        success:
          page?.settings.moderationMode === "pre"
            ? t("live.qna.questionSentForReview")
            : t("live.qna.questionShared"),
        done: () => setQuestionBody(""),
      });
      return;
    }
    await perform(
      "new-question",
      async () => {
        await request(`/v1/sessions/${sessionId}/qna/questions`, {
          method: "POST",
          body: JSON.stringify({ body }),
        });
        setQuestionBody("");
      },
      page?.settings.moderationMode === "pre"
        ? t("live.qna.questionSentForReview")
        : t("live.qna.questionShared"),
    );
  }

  async function submitReply(questionId: string) {
    const body = replyBodies[questionId]?.trim();
    if (!body) return;
    await perform(
      `reply:${questionId}`,
      async () => {
        await request(`/v1/sessions/${sessionId}/qna/questions/${questionId}/replies`, {
          method: "POST",
          body: JSON.stringify({ body }),
        });
        setReplyBodies((current) => ({ ...current, [questionId]: "" }));
      },
      role === "moderator" ? t("live.qna.replyPublished") : t("live.qna.replySubmitted"),
    );
  }

  async function setVote(question: QnaQuestion) {
    if (scoped) {
      if (pendingRef.current) return;
      await runScoped({
        key: `vote:${question.id}`,
        command: {
          type: "vote.set",
          questionId: question.id,
          voted: !question.votedByMe,
          idempotencyKey: clientUuid(),
        },
        success: "",
      });
      return;
    }
    await perform(`vote:${question.id}`, () =>
      request(`/v1/sessions/${sessionId}/qna/questions/${question.id}/vote`, {
        method: question.votedByMe ? "DELETE" : "POST",
      }),
    );
  }

  async function moderate(
    question: QnaQuestion,
    status: QnaQuestion["status"],
    banParticipant = false,
  ) {
    if (scoped) {
      if (pendingRef.current || !page?.audienceSeq) return;
      await runScoped({
        key: `moderate:${question.id}`,
        command: {
          type: "question.moderate",
          questionId: question.id,
          status,
          label: question.label,
          banAuthor: banParticipant,
          expectedAudienceSeq: page.audienceSeq,
          idempotencyKey: clientUuid(),
        },
        success: "",
      });
      return;
    }
    await perform(`moderate:${question.id}`, () =>
      request(`/v1/sessions/${sessionId}/qna/questions/${question.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status, label: question.label, banParticipant }),
      }),
    );
  }

  async function moderateReply(replyId: string, status: "pending" | "published" | "removed") {
    await perform(`moderate-reply:${replyId}`, () =>
      request(`/v1/sessions/${sessionId}/qna/replies/${replyId}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    );
  }

  async function updateSettings(update: Partial<QnaSettings>) {
    if (scoped) {
      if (pendingRef.current || !page?.audienceSeq) return;
      await runScoped({
        key: "settings",
        command: {
          type: "settings.update",
          settings: { ...page.settings, ...update, participantReplies: false },
          expectedAudienceSeq: page.audienceSeq,
          idempotencyKey: clientUuid(),
        },
        success: "",
      });
      return;
    }
    await perform("settings", async () => {
      const settings = await request<QnaSettings>(`/v1/sessions/${sessionId}/qna/settings`, {
        method: "PATCH",
        body: JSON.stringify(update),
      });
      setPage((current) => (current ? { ...current, settings } : current));
    });
  }

  const settings = page?.settings;
  const visibleQuestions = page?.questions ?? [];
  const closed = page?.lifecycle === "closed";
  const mutationDisabled = closed || !!busyKey || !!pending;

  return (
    <section className="panel qna-panel" aria-labelledby={`qna-heading-${role}`}>
      <div className="qna-heading">
        <div>
          <p className="eyebrow">{t("live.qna.eyebrow")}</p>
          <h2 id={`qna-heading-${role}`}>{t("live.qna.title")}</h2>
        </div>
        <button className="button-quiet small-button" onClick={() => void load()} type="button">
          {t("live.qna.refresh")}
        </button>
      </div>

      {error ? (
        <p className="error" lang="en-CA" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="success" role="status">
          {notice}
        </p>
      ) : null}
      {scoped ? (
        <p className="notice" lang="en-CA">
          {t("live.presentationQna.disclosure")}
        </p>
      ) : null}
      {closed ? (
        <p className="notice" lang="en-CA">
          {t("live.presentationQna.closed")}
        </p>
      ) : null}
      {pending && !busyKey ? (
        <button
          className="button"
          lang="en-CA"
          onClick={() => void runScoped(pending)}
          type="button"
        >
          {t("live.presentationQna.retry")}
        </button>
      ) : null}

      {role === "moderator" && settings ? (
        <fieldset
          className="qna-settings"
          disabled={scoped ? mutationDisabled : busyKey === "settings"}
        >
          <legend>{t("live.qna.controls")}</legend>
          <label className="checkbox-field">
            <input
              checked={settings.enabled}
              onChange={(event) => void updateSettings({ enabled: event.target.checked })}
              type="checkbox"
            />
            {t("live.qna.enable")}
          </label>
          <label className="field qna-setting-field">
            <span className="field-label">{t("live.qna.publicNames")}</span>
            <select
              className="select"
              onChange={(event) =>
                void updateSettings({
                  displayMode: event.target.value as QnaSettings["displayMode"],
                })
              }
              value={settings.displayMode}
            >
              <option value="anonymous_public">{t("live.qna.anonymousToParticipants")}</option>
              <option value="alias_public">{t("live.qna.showAliases")}</option>
            </select>
          </label>
          <label className="field qna-setting-field">
            <span className="field-label">{t("live.qna.moderation")}</span>
            <select
              className="select"
              onChange={(event) =>
                void updateSettings({
                  moderationMode: event.target.value as QnaSettings["moderationMode"],
                })
              }
              value={settings.moderationMode}
            >
              <option value="pre">{t("live.qna.reviewBeforePublishing")}</option>
              <option value="post">{t("live.qna.publishImmediately")}</option>
            </select>
          </label>
          {!scoped ? (
            <label className="checkbox-field">
              <input
                checked={settings.participantReplies}
                onChange={(event) =>
                  void updateSettings({ participantReplies: event.target.checked })
                }
                type="checkbox"
              />
              {t("live.qna.allowParticipantReplies")}
            </label>
          ) : null}
        </fieldset>
      ) : null}

      {role === "participant" && settings?.enabled && !closed ? (
        <form className="qna-compose" onSubmit={(event) => void submitQuestion(event)}>
          <label className="field" htmlFor="qna-question-body">
            <span className="field-label">{t("live.qna.askFacilitator")}</span>
            <textarea
              className="textarea"
              id="qna-question-body"
              maxLength={1_000}
              onChange={(event) => setQuestionBody(event.target.value)}
              placeholder={t("live.qna.questionPlaceholder")}
              value={questionBody}
            />
          </label>
          <div className="button-row">
            <button
              className="button"
              disabled={
                (scoped ? mutationDisabled : busyKey === "new-question") || !questionBody.trim()
              }
              type="submit"
            >
              {busyKey === "new-question" ? t("live.qna.sending") : t("live.qna.askQuestion")}
            </button>
            <small className="muted">
              {settings.moderationMode === "pre"
                ? t("live.qna.reviewNotice")
                : t("live.qna.immediateNotice")}
            </small>
          </div>
        </form>
      ) : role === "participant" && settings && !closed ? (
        <p className="notice">{t("live.qna.paused")}</p>
      ) : null}

      {!page ? <p className="muted">{t("live.qna.loading")}</p> : null}
      {page && visibleQuestions.length === 0 ? (
        <p className="qna-empty">{t("live.qna.empty")}</p>
      ) : null}
      <ol className="qna-list">
        {visibleQuestions.map((question) => (
          <li className="qna-question" key={question.id}>
            <div className="qna-question-meta">
              <span>
                <strong lang="">{question.author.displayName}</strong> ·{" "}
                {statusLabel(question.status)}
              </span>
              <span>{t("live.qna.votes", { count: question.voteCount })}</span>
            </div>
            <p className="qna-question-body" lang="">
              {question.body}
            </p>
            {question.label ? (
              <span className="status-pill" lang="">
                {question.label}
              </span>
            ) : null}

            {role === "participant" &&
            ["published", "answered"].includes(question.status) &&
            !closed ? (
              <button
                aria-pressed={question.votedByMe}
                className="button-quiet small-button"
                disabled={scoped ? mutationDisabled : busyKey === `vote:${question.id}`}
                onClick={() => void setVote(question)}
                type="button"
              >
                {question.votedByMe ? t("live.qna.removeVote") : t("live.qna.sameQuestion")}
              </button>
            ) : null}

            {role === "moderator" ? (
              <fieldset
                className="button-row qna-moderation-actions"
                disabled={scoped ? mutationDisabled : false}
              >
                <legend className="sr-only">{t("live.qna.controls")}</legend>
                {scoped && question.status === "published" ? (
                  <button
                    className="button-quiet small-button"
                    lang="en-CA"
                    onClick={() => void moderate(question, "answered")}
                    type="button"
                  >
                    {t("live.presentationQna.markAnswered")}
                  </button>
                ) : null}
                {question.status === "pending" ? (
                  <button
                    className="button small-button"
                    disabled={busyKey === `moderate:${question.id}`}
                    onClick={() => void moderate(question, "published")}
                    type="button"
                  >
                    {t("live.qna.publish")}
                  </button>
                ) : null}
                {!["dismissed", "removed"].includes(question.status) ? (
                  <button
                    className="button-quiet small-button"
                    disabled={busyKey === `moderate:${question.id}`}
                    onClick={() => void moderate(question, "dismissed")}
                    type="button"
                  >
                    {t("live.qna.dismiss")}
                  </button>
                ) : null}
                {question.status !== "removed" ? (
                  <button
                    className="button-danger small-button"
                    disabled={busyKey === `moderate:${question.id}`}
                    onClick={() => void moderate(question, "removed")}
                    type="button"
                  >
                    {t("live.qna.remove")}
                  </button>
                ) : null}
                {(question.moderationParticipantId || scoped) && question.status !== "removed" ? (
                  <button
                    className="button-danger small-button"
                    disabled={busyKey === `moderate:${question.id}`}
                    onClick={() =>
                      window.confirm(t("live.qna.removeAndBlockConfirm")) &&
                      void moderate(question, "removed", true)
                    }
                    type="button"
                  >
                    {t("live.qna.removeAndBlock")}
                  </button>
                ) : null}
              </fieldset>
            ) : null}

            {question.replies.length > 0 ? (
              <ul className="qna-replies" aria-label={t("live.qna.replies")}>
                {question.replies.map((reply) => (
                  <li key={reply.id}>
                    <p>
                      <strong lang="">{reply.author.displayName}</strong> ·{" "}
                      <span lang="">{reply.body}</span>
                    </p>
                    {role === "moderator" && reply.status === "pending" ? (
                      <div className="button-row">
                        <button
                          className="button-quiet small-button"
                          disabled={busyKey === `moderate-reply:${reply.id}`}
                          onClick={() => void moderateReply(reply.id, "published")}
                          type="button"
                        >
                          {t("live.qna.publishReply")}
                        </button>
                        <button
                          className="button-danger small-button"
                          disabled={busyKey === `moderate-reply:${reply.id}`}
                          onClick={() => void moderateReply(reply.id, "removed")}
                          type="button"
                        >
                          {t("live.qna.removeReply")}
                        </button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}

            {!scoped &&
            (role === "moderator" ||
              (settings?.participantReplies &&
                ["published", "answered"].includes(question.status))) &&
            question.status !== "removed" ? (
              <div className="qna-reply-compose">
                <label className="field" htmlFor={`qna-reply-${question.id}`}>
                  <span className="field-label">
                    {role === "moderator" ? t("live.qna.facilitatorReply") : t("live.qna.addReply")}
                  </span>
                  <textarea
                    className="textarea"
                    id={`qna-reply-${question.id}`}
                    maxLength={1_000}
                    onChange={(event) =>
                      setReplyBodies((current) => ({
                        ...current,
                        [question.id]: event.target.value,
                      }))
                    }
                    value={replyBodies[question.id] ?? ""}
                  />
                </label>
                <button
                  className="button-quiet small-button"
                  disabled={busyKey === `reply:${question.id}` || !replyBodies[question.id]?.trim()}
                  onClick={() => void submitReply(question.id)}
                  type="button"
                >
                  {t("live.qna.reply")}
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ol>
      {page?.nextCursor ? (
        <button
          className="button-quiet"
          onClick={() => void load(page.nextCursor ?? undefined, true)}
          type="button"
        >
          {t("live.qna.loadOlder")}
        </button>
      ) : null}
    </section>
  );
}
