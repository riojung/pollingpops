"use client";

import { useEffect, useState } from "react";
import {
  currentRoundClientCapabilities,
  RoundResponseModerationPageSchema,
} from "@openround/contracts";
import { apiFetch, humanError } from "../lib/api";
import {
  currentTextRead,
  type TextModerationPage,
  type TextReadState,
} from "../lib/text-response-client";
import { useLocale } from "./locale-provider";

export function TextModerationPanel({
  sessionId,
  roundId,
  version,
  phase,
  credential,
  disabled,
  onModerate,
  freshness = 0,
}: {
  sessionId: string;
  roundId?: string | null;
  version: number;
  phase: string;
  credential: string;
  freshness?: number;
  disabled: boolean;
  onModerate: (answerId: string, responseStatus: "approved" | "removed") => void;
}) {
  const { locale, t } = useLocale();
  const [scope, setScope] = useState<"current" | "all">("current");
  const [status, setStatus] = useState<"pending" | "approved" | "removed">("pending");
  const [cursor, setCursor] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<string | null>>([]);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<TextReadState<TextModerationPage> | null>(null);
  const key = JSON.stringify([
    sessionId,
    roundId,
    version,
    phase,
    scope,
    status,
    cursor,
    retry,
    freshness,
  ]);
  const current = currentTextRead(state, key, credential);
  const finished = phase === "finished";

  useEffect(() => {
    setCursor(null);
    setHistory([]);
  }, [sessionId, roundId, version, credential, status, scope]);
  useEffect(() => {
    setState({ key, credential, data: null, error: "" });
    if (!credential || finished) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams({
        status,
        limit: "10",
        clientCapabilities: JSON.stringify(currentRoundClientCapabilities()),
        ...(scope === "current" && roundId ? { roundId } : {}),
        ...(cursor ? { cursor } : {}),
      });
      void apiFetch<TextModerationPage>(`/v1/sessions/${sessionId}/response-moderation?${query}`, {
        headers: { authorization: `Bearer ${credential}` },
        signal: controller.signal,
        cache: "no-store",
      })
        .then((data) => {
          if (!controller.signal.aborted)
            setState({
              key,
              credential,
              data: RoundResponseModerationPageSchema.parse(data),
              error: "",
            });
        })
        .catch((error) => {
          if (!controller.signal.aborted) {
            if ((error as { status?: number }).status === 409 && cursor) {
              setCursor(null);
              setHistory([]);
            }
            setState({ key, credential, data: null, error: humanError(error) });
          }
        });
    }, 100);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [sessionId, roundId, version, phase, credential, status, scope, cursor, retry, finished, key]);

  return (
    <section lang={locale} className="distribution-card" aria-label={t("live.text.moderation")}>
      <h2 style={{ fontSize: "1.2rem" }}>{t("live.text.moderation")}</h2>
      <p className="muted">{t("live.text.moderationHelp")}</p>
      {finished ? (
        <p className="notice">{t("live.text.moderationClosed")}</p>
      ) : (
        <>
          {roundId ? (
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
                className="button-quiet small-button"
                type="button"
                key={value}
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
          ) : current.data.items.length === 0 ? (
            <p>{t("live.text.emptyQueue")}</p>
          ) : (
            <ul className="text-moderation-list">
              {current.data.items.map((item) => (
                <li key={item.answerId}>
                  <p className="eyebrow" lang="">
                    {item.questionPrompt}
                  </p>
                  <small>
                    {roundId && item.roundId !== roundId ? (
                      <>{t("live.text.earlierQuestion")} · </>
                    ) : null}
                    <span lang="">{item.authorAlias ?? t("live.text.participant")}</span> ·{" "}
                    {new Date(item.submittedAt).toLocaleString(locale)}
                  </small>
                  <p lang={item.body === null ? undefined : ""}>
                    {item.body ?? t("live.text.removedBody")}
                  </p>
                  {item.status !== "removed" ? (
                    <div className="button-row">
                      {item.status === "pending" ? (
                        <button
                          className="button small-button"
                          disabled={disabled}
                          type="button"
                          onClick={() => onModerate(item.answerId, "approved")}
                        >
                          {t("live.text.approve")}
                        </button>
                      ) : null}
                      <button
                        className="button-quiet small-button"
                        disabled={disabled}
                        type="button"
                        onClick={() => onModerate(item.answerId, "removed")}
                      >
                        {t("live.text.remove")}
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
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
        </>
      )}
    </section>
  );
}
