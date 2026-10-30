"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CanvasBoardViewSchema } from "@openround/contracts";
import { apiFetch, ApiClientError, humanError } from "../../../../lib/api";
import { useLocale } from "../../../../components/locale-provider";
import { Brand } from "../../../../components/brand";
import styles from "../../../../components/canvas-boards/canvas.module.css";

export default function CanvasInvitationPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [signIn, setSignIn] = useState(false);
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const active = new AbortController();
    controller.current = active;
    inFlight.current = false;
    setBusy(false);
    setError("");
    setSignIn(false);
    return () => active.abort();
  }, [id]);
  async function accept() {
    if (inFlight.current || !/^[0-9a-f-]{36}$/i.test(id)) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    const active = controller.current;
    try {
      const response = await apiFetch<{ board: unknown }>(
        `/v1/canvas-boards/invitations/${id}/accept`,
        { method: "POST", body: "{}", signal: active?.signal },
      );
      if (active?.signal.aborted) return;
      const board = CanvasBoardViewSchema.parse(response.board);
      window.location.assign(`/canvas/${board.id}`);
    } catch (caught) {
      if (active?.signal.aborted) return;
      setSignIn(caught instanceof ApiClientError && caught.status === 401);
      setError(humanError(caught));
      setBusy(false);
      inFlight.current = false;
    }
  }
  return (
    <main className={styles.access}>
      <Brand />
      <h1>{t("canvas.accept")}</h1>
      <p>{t("canvas.inviteHelp")}</p>
      {error ? (
        <p className="error" role="alert" lang="en-CA">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        className="button"
        disabled={busy || !/^[0-9a-f-]{36}$/i.test(id)}
        onClick={() => void accept()}
      >
        {t("canvas.accept")}
      </button>
      {signIn ? (
        <Link href={`/signin?returnTo=${encodeURIComponent(`/canvas/invitations/${id}`)}`}>
          {t("canvas.signIn")}
        </Link>
      ) : null}
      <Link href="/boards">{t("boards.title")}</Link>
    </main>
  );
}
