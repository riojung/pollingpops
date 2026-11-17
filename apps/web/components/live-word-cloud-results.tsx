"use client";

import { useEffect, useRef, useState } from "react";
import {
  currentRoundClientCapabilities,
  RoundLiveWordCloudResultsSchema,
  type RoundLiveWordCloudResults,
} from "@openround/contracts";
import { apiFetch, humanError } from "../lib/api";
import { formatNumber } from "../lib/i18n/format";
import { liveWordCloudCopy } from "../lib/i18n/live-word-cloud-copy";
import { currentTextRead, type TextReadState } from "../lib/text-response-client";
import { WORD_CLOUD_VISIBLE_LIMIT } from "../lib/word-cloud-layout";
import { useLocale } from "./locale-provider";
import { WordCloudVisual } from "./word-cloud-visual";

export function LiveWordCloudResults({
  sessionId,
  roundId,
  version,
  phase,
  credential,
  role,
  freshness = 0,
  headingLevel = 2,
}: {
  sessionId: string;
  roundId: string;
  version: number;
  phase: string;
  credential: string;
  role: "host" | "presenter" | "participant";
  freshness?: number;
  headingLevel?: 2 | 3;
}) {
  const { locale, t } = useLocale();
  const copy = (key: Parameters<typeof liveWordCloudCopy>[1], values = {}) =>
    liveWordCloudCopy(locale, key, values);
  const Heading = headingLevel === 3 ? "h3" : "h2";
  const enabled = Boolean(credential && phase !== "lobby");
  const key = JSON.stringify([sessionId, roundId, role, freshness]);
  const [state, setState] = useState<TextReadState<RoundLiveWordCloudResults> | null>(null);
  const [retry, setRetry] = useState(0);
  const requiredVersion = useRef(version);
  const wake = useRef<() => void>(() => {});
  const current = enabled ? currentTextRead(state, key, credential) : null;

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let reading = false;
    let again = false;
    let wakeScheduled = false;
    let acceptedVersion = -1;
    let timer: number | undefined;
    let controller: AbortController | undefined;

    async function read() {
      if (disposed || document.hidden) return;
      if (reading) {
        again = true;
        return;
      }
      if (timer !== undefined) window.clearTimeout(timer);
      wakeScheduled = false;
      reading = true;
      again = false;
      controller = new AbortController();
      try {
        const query = new URLSearchParams({
          roundId,
          role,
          clientCapabilities: JSON.stringify(currentRoundClientCapabilities()),
        });
        const result = RoundLiveWordCloudResultsSchema.parse(
          await apiFetch(`/v1/sessions/${sessionId}/word-cloud?${query}`, {
            headers: { authorization: `Bearer ${credential}` },
            signal: controller.signal,
            cache: "no-store",
          }),
        );
        if (disposed || controller.signal.aborted) return;
        if (result.sessionId !== sessionId || result.roundId !== roundId)
          throw new Error("Word cloud belongs to a different question");
        if (result.version < requiredVersion.current || result.version < acceptedVersion) {
          again = true;
        } else {
          acceptedVersion = result.version;
          setState((previous) =>
            previous?.key === key &&
            previous.credential === credential &&
            previous.data &&
            previous.data.version > result.version
              ? previous
              : { key, credential, data: result, error: "" },
          );
        }
      } catch (error) {
        if (!disposed && !controller.signal.aborted)
          setState({ key, credential, data: null, error: humanError(error) });
      } finally {
        reading = false;
        if (!disposed && !document.hidden && (phase !== "finished" || again))
          timer = window.setTimeout(() => void read(), again ? 150 : 5_000);
      }
    }

    // A single in-flight read coalesces bursts without starving the growing cloud.
    // Normal version changes retain matching keyed words; scope/credential changes
    // and moderation invalidation fence the prior projection immediately.
    wake.current = () => {
      if (reading) again = true;
      else if (!wakeScheduled) {
        if (timer !== undefined) window.clearTimeout(timer);
        wakeScheduled = true;
        timer = window.setTimeout(() => void read(), 60);
      }
    };
    const onVisibility = () => {
      if (!document.hidden) void read();
      else if (timer !== undefined) {
        window.clearTimeout(timer);
        wakeScheduled = false;
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    void read();
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
      controller?.abort();
      wake.current = () => {};
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [sessionId, roundId, role, credential, key, enabled, retry, phase]);

  useEffect(() => {
    if (requiredVersion.current === version) return;
    requiredVersion.current = version;
    wake.current();
  }, [version]);

  return (
    <section
      className="distribution-card"
      data-testid="live-word-cloud-results"
      data-version={current?.data?.version}
      lang={locale}
      aria-label={copy("title")}
    >
      <Heading style={{ fontSize: "1.2rem" }}>
        {copy(phase === "finished" ? "closed" : "title")}
      </Heading>
      <p className="muted">{copy("help")}</p>
      {!enabled ? (
        <p role="status">{t("live.text.connectionRequired")}</p>
      ) : current?.error ? (
        <div>
          <p className="error" role="alert" lang="en-CA">
            {current.error}
          </p>
          <button
            className="button-quiet"
            onClick={() => setRetry((value) => value + 1)}
            type="button"
          >
            {copy("refresh")}
          </button>
        </div>
      ) : !current?.data ? (
        <p role="status">{copy("updating")}</p>
      ) : (
        <>
          <p role="status" aria-live="polite" data-testid="word-cloud-response-count">
            {copy("responses", { count: formatNumber(locale, current.data.respondents) })}
          </p>
          {!current.data.terms.length ? (
            <div className="notice" role="status">
              <strong>{copy("waiting")}</strong>
              <p>{copy("waitingHelp")}</p>
            </div>
          ) : (
            <>
              <WordCloudVisual terms={current.data.terms} />
              {current.data.terms.length > WORD_CLOUD_VISIBLE_LIMIT ? (
                <p className="muted">
                  {copy("showing", {
                    count: formatNumber(locale, WORD_CLOUD_VISIBLE_LIMIT),
                    total: formatNumber(locale, current.data.totalTerms),
                  })}
                </p>
              ) : null}
              <details>
                <summary>{copy("counts")}</summary>
                <div
                  role="region"
                  aria-label={t("live.text.wordCounts")}
                  style={{ overflowX: "auto" }}
                  tabIndex={0}
                >
                  <table className="report-table">
                    <caption>{t("live.text.wordCounts")}</caption>
                    <thead>
                      <tr>
                        <th scope="col">{t("live.text.term")}</th>
                        <th scope="col">{t("live.text.count")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {current.data.terms.map((term) => (
                        <tr key={term.value}>
                          <th scope="row" lang="">
                            {term.label}
                          </th>
                          <td>{formatNumber(locale, term.count)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          )}
        </>
      )}
    </section>
  );
}
