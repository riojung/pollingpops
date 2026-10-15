"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CreatorBrand } from "../../../../components/brand";
import type { Entitlements, WorkspaceProductFeatures } from "@openround/contracts";
import { RoomPasswordOption } from "../../../../components/room-password";
import {
  canProtectRoom,
  roomPasswordFields,
  validRoomPassword,
} from "../../../../lib/room-password";
import { EventCreditChoice } from "../../../../components/event-credit-choice";
import { useLocale } from "../../../../components/locale-provider";
import {
  useWorkspace,
  WorkspaceProvider,
} from "../../../../components/workspace/workspace-provider";
import { WorkspaceFeatureGate } from "../../../../components/workspace/workspace-shell";
import styles from "../../../../components/presentation-live/presentation-live.module.css";
import { recordAuthoringEvent } from "../../../../components/workspace/product-events";
import { apiFetch, humanError } from "../../../../lib/api";
import { formatNumber } from "../../../../lib/i18n/format";

interface PresentationRecord {
  id: string;
  title: string;
  description: string;
  currentVersionId: string | null;
  hasUnpublishedChanges: boolean;
  draft: { blocks: Array<{ kind: "content" | "question" }> };
}

interface PresentationSessionCreationControlsProps {
  busy: boolean;
  currentVersionId: string | null | undefined;
  error: string;
  errorIsRaw?: boolean;
  liveCreationAvailable: boolean;
  onStart: () => void;
}

export function PresentationSessionCreationControls({
  busy,
  currentVersionId,
  error,
  errorIsRaw = true,
  liveCreationAvailable,
  onStart,
}: PresentationSessionCreationControlsProps) {
  const { t } = useLocale();

  return (
    <>
      {!liveCreationAvailable ? (
        <p className="notice" role="status">
          {t("live.presentationHost.creationPaused")}
        </p>
      ) : null}
      {error ? (
        <p className="error" lang={errorIsRaw ? "en-CA" : undefined} role="alert">
          {error}
        </p>
      ) : null}
      <div className="button-row">
        <button
          className="button"
          disabled={busy || !currentVersionId || !liveCreationAvailable}
          onClick={onStart}
          type="button"
        >
          {busy ? t("live.presentationHost.starting") : t("live.presentationHost.start")}
        </button>
        <Link className="button-quiet" href="/sessions">
          {t("live.presentationHost.history")}
        </Link>
      </div>
    </>
  );
}

function PresentationHostSetupContent() {
  const { locale, t } = useLocale();
  const { productFeatures, entitlements } = useWorkspace();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [presentation, setPresentation] = useState<PresentationRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [errorIsRaw, setErrorIsRaw] = useState(true);
  const [timeMode, setTimeMode] = useState<"timed" | "flex">("timed");
  const [useEventCredit, setUseEventCredit] = useState(false);
  const [eventEntitlements, setEventEntitlements] = useState<Entitlements | null>(null);
  const [eventProductFeatures, setEventProductFeatures] = useState<WorkspaceProductFeatures | null>(
    null,
  );
  const [protectRoom, setProtectRoom] = useState(false);
  const [joinPassword, setJoinPassword] = useState("");
  const passwordAvailable = canProtectRoom(useEventCredit ? eventEntitlements : entitlements);
  const creationIntent = useRef<{ body: string; key: string } | null>(null);
  const launchFeatures = useEventCredit
    ? (eventProductFeatures ?? productFeatures)
    : productFeatures;
  const liveCreationAvailable = launchFeatures?.presentationRealtime === true;

  useEffect(() => {
    void apiFetch<{ presentation: PresentationRecord }>(`/v1/presentations/${id}`)
      .then(({ presentation: loaded }) => setPresentation(loaded))
      .catch((caught) => {
        if ((caught as { status?: number }).status === 401) router.replace("/signin");
        else setError(humanError(caught));
      });
  }, [id, router]);

  async function startSession() {
    if (busy) return;
    if (protectRoom && !passwordAvailable) {
      setErrorIsRaw(false);
      setError(t("live.protection.upgrade"));
      return;
    }
    if (passwordAvailable && protectRoom && !validRoomPassword(joinPassword)) {
      setErrorIsRaw(false);
      setError(t("live.protection.validation"));
      return;
    }
    setBusy(true);
    setError("");
    const body = JSON.stringify({
      presentationId: id,
      ...(launchFeatures?.liveFlexMode && timeMode === "flex" ? { timeMode: "flex" } : {}),
      useEventCredit,
      ...roomPasswordFields(passwordAvailable, protectRoom, joinPassword),
    });
    if (creationIntent.current?.body !== body)
      creationIntent.current = { body, key: crypto.randomUUID() };
    try {
      const { snapshot, controlToken } = await apiFetch<{
        snapshot: { sessionId?: string; id?: string };
        controlToken?: string;
      }>("/v1/presentation-sessions", {
        method: "POST",
        headers: { "x-idempotency-key": creationIntent.current.key },
        body,
      });
      const sessionId = snapshot.sessionId ?? snapshot.id;
      if (!sessionId) throw new Error("Presentation session identifier is missing");
      if (controlToken) {
        sessionStorage.setItem(`openround:presentation-host:${sessionId}`, controlToken);
      }
      recordAuthoringEvent("presentation_host_started", "presentation");
      router.push(`/presentation-session/${sessionId}/host`);
    } catch (caught) {
      setErrorIsRaw(true);
      setError(humanError(caught));
      setBusy(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.topbar}>
        <CreatorBrand productFeatures={productFeatures} />
        <Link href={`/presentation/${id}`}>{t("live.presentationHost.backEditor")}</Link>
      </div>
      <section className={styles.setup}>
        <EventCreditChoice
          checked={useEventCredit}
          disabled={busy}
          onChange={(checked, benefits, features) => {
            setUseEventCredit(checked);
            setEventEntitlements(benefits);
            setEventProductFeatures(features ?? null);
            if (!(checked ? (features ?? productFeatures) : productFeatures)?.liveFlexMode)
              setTimeMode("timed");
          }}
        />
        <span className={styles.statusPill}>{t("live.presentationHost.live")}</span>
        {presentation ? <h1 lang="">{presentation.title}</h1> : <h1>{t("common.loading")}</h1>}
        <p>{t("live.presentationHost.description")}</p>
        {presentation ? (
          <div className={styles.metricRow}>
            <div className={styles.metric}>
              <strong>{formatNumber(locale, presentation.draft.blocks.length)}</strong>
              <span>{t("live.presentationHost.totalBlocks")}</span>
            </div>
            <div className={styles.metric}>
              <strong>
                {formatNumber(
                  locale,
                  presentation.draft.blocks.filter((block) => block.kind === "question").length,
                )}
              </strong>
              <span>{t("live.presentationHost.interactiveQuestions")}</span>
            </div>
          </div>
        ) : null}
        {presentation?.hasUnpublishedChanges ? (
          <p className="notice">{t("live.presentationHost.unpublishedNotice")}</p>
        ) : null}
        {!presentation?.currentVersionId && presentation ? (
          <p className="error" role="alert">
            {t("live.presentationHost.publishFirst")}
          </p>
        ) : null}
        {launchFeatures?.liveFlexMode ? (
          <label className="field" htmlFor="presentation-time-mode">
            <span>{t("live.common.timeMode")}</span>
            <select
              className="select"
              disabled={busy || !liveCreationAvailable}
              id="presentation-time-mode"
              onChange={(event) => setTimeMode(event.target.value as "timed" | "flex")}
              value={timeMode}
            >
              <option value="timed">{t("live.common.timedMode")}</option>
              <option value="flex">{t("live.common.flexMode")}</option>
            </select>
            <small className="muted">{t("live.common.flexSetupHelp")}</small>
          </label>
        ) : null}
        <RoomPasswordOption
          available={passwordAvailable}
          enabled={protectRoom}
          password={joinPassword}
          disabled={busy || !liveCreationAvailable}
          onEnabledChange={setProtectRoom}
          onPasswordChange={setJoinPassword}
        />
        <PresentationSessionCreationControls
          busy={busy}
          currentVersionId={presentation?.currentVersionId}
          error={error}
          errorIsRaw={errorIsRaw}
          liveCreationAvailable={liveCreationAvailable}
          onStart={() => void startSession()}
        />
      </section>
    </main>
  );
}

export default function PresentationHostSetupPage() {
  return (
    <WorkspaceProvider>
      <WorkspaceFeatureGate feature="presentations">
        <PresentationHostSetupContent />
      </WorkspaceFeatureGate>
    </WorkspaceProvider>
  );
}
