"use client";

import { useEffect, useRef, useState } from "react";
import type { SharedSessionSummary } from "@openround/contracts";
import { Brand } from "../brand";
import { useLocale } from "../locale-provider";
import { formatDateTime } from "../../lib/i18n/format";
import { fetchSharedSummary, summaryTokenFromFragment } from "../../lib/session-summary-client";
import { SessionSummaryDownloads } from "./summary-downloads";
import { SessionSummaryView } from "./summary-view";
import styles from "./summary.module.css";

export function PublicSessionSummary({ shareId }: { shareId: string }) {
  const { locale, t } = useLocale();
  const token = useRef<string | null>(null);
  const [shared, setShared] = useState<SharedSessionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let controller: AbortController | undefined;
    const load = () => {
      controller?.abort();
      controller = new AbortController();
      const current = controller;
      token.current = summaryTokenFromFragment(window.location.hash);
      setShared(null);
      setLoading(true);
      if (!token.current) {
        setLoading(false);
        return;
      }
      void fetchSharedSummary(shareId, token.current, current.signal)
        .then((value) => {
          if (!current.signal.aborted) setShared(value);
        })
        .catch(() => undefined)
        .finally(() => {
          if (!current.signal.aborted) setLoading(false);
        });
    };
    load();
    window.addEventListener("hashchange", load);
    return () => {
      controller?.abort();
      token.current = null;
      window.removeEventListener("hashchange", load);
    };
  }, [shareId]);
  useEffect(() => {
    if (!shared) return;
    let timeout: number;
    const checkExpiry = () => {
      const remaining = Date.parse(shared.expiresAt) - Date.now();
      if (remaining <= 0) {
        setShared(null);
        token.current = null;
        return;
      }
      timeout = window.setTimeout(checkExpiry, Math.min(remaining, 2_147_483_647));
    };
    checkExpiry();
    return () => window.clearTimeout(timeout);
  }, [shared]);
  return (
    <>
      <header className="shell topbar">
        <Brand />
      </header>
      <main className={`shell page-main ${styles.publicPage}`} id="main" lang={locale}>
        {shared ? (
          <>
            <SessionSummaryView summary={shared.summary} />
            <p className="muted">
              {t("summary.expires", { date: formatDateTime(locale, shared.expiresAt) })}
            </p>
            {token.current ? (
              <section className={styles.publicActions} aria-label={t("summary.downloads")}>
                <h2>{t("summary.downloads")}</h2>
                <SessionSummaryDownloads
                  access={{ shareId, token: token.current }}
                  summary={shared.summary}
                  formats={shared.downloadFormats}
                />
              </section>
            ) : null}
          </>
        ) : (
          <>
            <h1>{t("summary.title")}</h1>
            {loading ? (
              <p role="status">{t("summary.loading")}</p>
            ) : (
              <p role="alert">{t("summary.unavailable")}</p>
            )}
          </>
        )}
      </main>
    </>
  );
}
