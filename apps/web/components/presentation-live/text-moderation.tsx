"use client";

import { useEffect, useRef, useState } from "react";
import type { PresentationTextModerationPage } from "@openround/contracts";
import { humanError } from "../../lib/api";
import { currentTextRead, type TextReadState } from "../../lib/text-response-client";
import {
  readPresentationTextModeration,
  retainPresentationTextModerationIntent,
  sendPresentationTextModeration,
  type PresentationTextModerationIntent,
} from "../../lib/presentation-text-client";
import { clientUuid } from "../../lib/uuid";
import { useLocale } from "../locale-provider";
import styles from "./text-results.module.css";

export interface PresentationTextModerationPanelProps {
  sessionId: string;
  blockId?: string | null;
  revision: number;
  seq: number;
  phase: string;
  credential: string;
  disabled: boolean;
  onChanged?: () => void;
}

type ReviewState = { intent: PresentationTextModerationIntent; busy: boolean; error: string };

export function PresentationTextModerationPanel({
  sessionId,
  blockId,
  revision,
  seq,
  phase,
  credential,
  disabled,
  onChanged,
}: PresentationTextModerationPanelProps) {
  const { locale, t } = useLocale();
  const [scope, setScope] = useState<"current" | "all">("current");
  const [status, setStatus] = useState<"pending" | "approved" | "removed">("pending");
  const [cursor, setCursor] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<string | null>>([]);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<TextReadState<PresentationTextModerationPage> | null>(null);
  const [review, setReview] = useState<ReviewState | null>(null);
  const pending = useRef<PresentationTextModerationIntent | null>(null);
  const sending = useRef<PresentationTextModerationIntent | null>(null);
  const finished = phase === "finished";
  const key = JSON.stringify([
    sessionId,
    blockId,
    revision,
    seq,
    phase,
    scope,
    status,
    cursor,
    retry,
  ]);
  const current = currentTextRead(state, key, credential);
  const activeReview =
    review?.intent.sessionId === sessionId && review.intent.credential === credential
      ? review
      : null;

  useEffect(() => {
    pending.current = null;
    sending.current = null;
    setReview(null);
    return () => {
      pending.current = null;
      sending.current = null;
    };
  }, [sessionId, credential]);
  useEffect(() => {
    setCursor(null);
    setHistory([]);
  }, [sessionId, blockId, revision, seq, credential, status, scope]);
  useEffect(() => {
    setState({ key, credential, data: null, error: "" });
    if (!credential || finished) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void readPresentationTextModeration({
        sessionId,
        revision,
        seq,
        credential,
        status,
        blockId: scope === "current" ? blockId : null,
        cursor,
        signal: controller.signal,
      })
        .then((data) => {
          if (!controller.signal.aborted) setState({ key, credential, data, error: "" });
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          if ((error as { status?: number }).status === 409 && cursor) {
            setCursor(null);
            setHistory([]);
          }
          setState({ key, credential, data: null, error: humanError(error) });
        });
    }, 100);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    sessionId,
    blockId,
    revision,
    seq,
    phase,
    credential,
    status,
    scope,
    cursor,
    retry,
    key,
    finished,
  ]);

  async function attempt(intent: PresentationTextModerationIntent) {
    if (sending.current || !credential || disabled) return;
    sending.current = intent;
    setReview({ intent, busy: true, error: "" });
    try {
      await sendPresentationTextModeration(intent);
      if (pending.current !== intent) return;
      pending.current = null;
      setReview(null);
      setRetry((value) => value + 1);
      onChanged?.();
    } catch (error) {
      if (pending.current === intent) setReview({ intent, busy: false, error: humanError(error) });
    } finally {
      if (sending.current === intent) sending.current = null;
    }
  }

  function moderate(
    item: PresentationTextModerationPage["items"][number],
    next: "approved" | "removed",
  ) {
    if (pending.current || disabled || !credential || finished) return;
    const intent = retainPresentationTextModerationIntent({
      sessionId,
      credential,
      responseId: item.responseId,
      blockId: item.blockId,
      request: {
        commandId: clientUuid(),
        expectedRevision: revision,
        expectedModerationVersion: item.moderationVersion,
        status: next,
      },
    });
    pending.current = intent;
    void attempt(intent);
  }

  return (
    <section
      className={`distribution-card ${styles.results}`}
      lang={locale}
      aria-label={t("live.text.moderation")}
    >
      <h2>{t("live.text.moderation")}</h2>
      <p className="muted">{t("live.text.moderationHelp")}</p>
      {activeReview ? (
        <div lang="en-CA" role="status">
          <p>
            {activeReview.busy
              ? "Updating response review…"
              : "Review update unconfirmed. Retry to check whether it was saved."}
          </p>
          {activeReview.error ? (
            <p className="error" role="alert">
              {activeReview.error}
            </p>
          ) : null}
          {!activeReview.busy ? (
            <div className="button-row">
              <button
                className="button-quiet small-button"
                type="button"
                disabled={disabled || !credential}
                onClick={() => void attempt(activeReview.intent)}
              >
                Retry review acknowledgement
              </button>
              <button
                className="button-quiet small-button"
                type="button"
                onClick={() => {
                  pending.current = null;
                  setReview(null);
                  setRetry((value) => value + 1);
                }}
              >
                Discard review retry
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {finished ? (
        <p className="notice">{t("live.text.moderationClosed")}</p>
      ) : (
        <>
          {blockId ? (
            <div className="button-row" aria-label={t("live.text.scope")}>
              <button
                className="button-quiet small-button"
                type="button"
                aria-pressed={scope === "current"}
                onClick={() => setScope("current")}
              >
                {t("live.text.currentQuestion")}
              </button>
              <button
                className="button-quiet small-button"
                type="button"
                aria-pressed={scope === "all"}
                onClick={() => setScope("all")}
              >
                {t("live.text.allQuestions")}
              </button>
            </div>
          ) : null}
          <div className="button-row" aria-label={t("live.text.filter")}>
            {(["pending", "approved", "removed"] as const).map((value) => (
              <button
                key={value}
                className="button-quiet small-button"
                type="button"
                aria-pressed={status === value}
                onClick={() => setStatus(value)}
              >
                {t(`live.text.status.${value}`)}
              </button>
            ))}
          </div>
          {!credential ? (
            <p role="status">{t("live.text.connectionRequired")}</p>
          ) : current?.error ? (
            <p className="error" role="alert" lang="en-CA">
              {current.error}
            </p>
          ) : !current?.data ? (
            <p role="status">{t("live.text.loading")}</p>
          ) : !current.data.items.length ? (
            <p>{t("live.text.emptyQueue")}</p>
          ) : (
            <ul className="text-moderation-list">
              {current.data.items.map((item) => (
                <li key={item.responseId}>
                  <p className="eyebrow" lang="">
                    {item.questionPrompt}
                  </p>
                  <small>
                    {blockId && item.blockId !== blockId ? (
                      <>{t("live.text.earlierQuestion")} · </>
                    ) : null}
                    <span lang="">{item.authorAlias ?? t("live.text.participant")}</span> ·{" "}
                    {new Date(item.submittedAt).toLocaleString(locale)}
                  </small>
                  <p lang={item.textValue === null ? undefined : ""}>
                    {item.textValue ?? t("live.text.removedBody")}
                  </p>
                  {item.status !== "removed" ? (
                    <div className="button-row">
                      {item.status === "pending" ? (
                        <button
                          className="button small-button"
                          type="button"
                          disabled={disabled || Boolean(activeReview)}
                          onClick={() => moderate(item, "approved")}
                        >
                          {t("live.text.approve")}
                        </button>
                      ) : null}
                      <button
                        className="button-quiet small-button"
                        type="button"
                        disabled={disabled || Boolean(activeReview)}
                        onClick={() => moderate(item, "removed")}
                      >
                        {t("live.text.remove")}
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {credential ? (
            <div className="button-row">
              <button
                className="button-quiet small-button"
                type="button"
                onClick={() => setRetry((value) => value + 1)}
              >
                {t("live.text.refresh")}
              </button>
              <button
                className="button-quiet small-button"
                type="button"
                disabled={!history.length}
                onClick={() => {
                  setCursor(history.at(-1) ?? null);
                  setHistory((pages) => pages.slice(0, -1));
                }}
              >
                {t("live.text.previousPage")}
              </button>
              <button
                className="button-quiet small-button"
                type="button"
                disabled={!current?.data?.nextCursor}
                onClick={() => {
                  setHistory((pages) => [...pages, cursor]);
                  setCursor(current!.data!.nextCursor);
                }}
              >
                {t("live.text.nextPage")}
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
