"use client";

import { useEffect, useRef, useState } from "react";
import { PresentationStagePassResponseSchema } from "@openround/contracts";
import { apiFetch, humanError } from "../../lib/api";
import { isolatePresentationCompanionWindow } from "../../lib/presentation-companion-pass";
import { presentationStageLaunchUrl } from "../../lib/presentation-stage-pass";
import styles from "./presentation-delivery.module.css";

export function PresentationStageLauncher({
  sessionId,
  canEdit,
  finished,
}: {
  sessionId: string;
  canEdit: boolean;
  finished: boolean;
}) {
  const [credentialId, setCredentialId] = useState<string | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const key = `openround:presentation-stage-credential:${sessionId}`;
  useEffect(() => {
    mounted.current = true;
    try {
      setCredentialId(sessionStorage.getItem(key));
    } catch {
      /* A pass can still be revoked in this visit. */
    }
    return () => {
      mounted.current = false;
    };
  }, [key]);
  if (!canEdit) return null;

  async function launch() {
    if (inFlight.current || finished) return;
    inFlight.current = true;
    setBusy(true);
    setFallback(null);
    setError("");
    let popup: Window | null = null;
    try {
      popup = isolatePresentationCompanionWindow(
        window.open("about:blank", "_blank", "popup,width=1280,height=800"),
      );
      const pass = PresentationStagePassResponseSchema.parse(
        await apiFetch(`/v1/presentation-sessions/${sessionId}/stage-pass`, { method: "POST" }),
      );
      if (!mounted.current) {
        popup?.close();
        return;
      }
      setCredentialId(pass.credentialId);
      try {
        sessionStorage.setItem(key, pass.credentialId);
      } catch {
        /* Optional refresh convenience. */
      }
      const url = presentationStageLaunchUrl(window.location.origin, sessionId, pass.stageToken);
      if (popup && !popup.closed) popup.location.replace(url);
      else setFallback(url);
    } catch (caught) {
      popup?.close();
      if (mounted.current) setError(humanError(caught));
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function revoke() {
    if (inFlight.current || !credentialId) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await apiFetch(`/v1/presentation-sessions/${sessionId}/stage-passes/${credentialId}`, {
        method: "DELETE",
      });
      if (!mounted.current) return;
      setCredentialId(null);
      setFallback(null);
      try {
        sessionStorage.removeItem(key);
      } catch {
        /* Server revocation is authoritative. */
      }
    } catch (caught) {
      if (mounted.current) setError(humanError(caught));
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <section aria-label="Audience stage controls" className={styles.launch} lang="en-CA">
      <button
        type="button"
        className="button-quiet full-width"
        disabled={busy || finished}
        onClick={() => void launch()}
      >
        {busy ? "Updating stage access…" : "Open audience stage"}
      </button>
      <p>Share the audience stage window. Presenter notes and controls stay in this workspace.</p>
      {fallback ? (
        <>
          <p role="status">
            Your browser blocked the stage window. Open it using this link, then share that tab.
          </p>
          <a href={fallback} target="_blank" rel="noopener noreferrer">
            Open audience stage in a new tab
          </a>
        </>
      ) : null}
      {credentialId ? (
        <button
          type="button"
          className="button-quiet full-width"
          disabled={busy}
          onClick={() => void revoke()}
        >
          Revoke audience stage access
        </button>
      ) : null}
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
    </section>
  );
}
