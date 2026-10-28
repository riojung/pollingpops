"use client";

import Link from "next/link";
import { CompetitionDashboard } from "../../../components/competition-dashboard";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  EventEnvelope,
  HostAction,
  InterventionType,
  RecoveryPackCardSelection,
  SessionStaffCredential,
  SessionSnapshot,
} from "@openround/contracts";
import { currentRoundClientCapabilities, ROUND_CLIENT_UPDATE_MESSAGE } from "@openround/contracts";
import { Brand, creatorLandingHref } from "../../../components/brand";
import {
  AudiencePanel,
  enqueueAudienceRealtimeUpdate,
  type AudienceRealtimeBatch,
} from "../../../components/audience-panel";
import { ExperiencePreferences } from "../../../components/experience-preferences";
import { Countdown } from "../../../components/countdown";
import {
  HostCommandBar,
  HostStage,
  RecoveryCompass,
} from "../../../components/host-command-center";
import { JoinAccess } from "../../../components/join-access";
import { useLocale } from "../../../components/locale-provider";
import { confidenceControlCopy } from "../../../lib/i18n/confidence-control-copy";
import { ParticipantIdentity } from "../../../components/participant-avatar";
import { QuestionMedia } from "../../../components/question-media";
import {
  RecoveryPackCardPicker,
  RecoveryPackLiveCardView,
} from "../../../components/recovery-pack-live-card";
import { ResponseDistributionView } from "../../../components/response-distribution";
import { TextModerationPanel } from "../../../components/text-moderation-panel";
import { TextLiveResults } from "../../../components/text-live-results";
import { isTextQuestion } from "../../../lib/text-response";
import { QnaPanel } from "../../../components/qna-panel";
import { apiFetch, humanError } from "../../../lib/api";
import {
  createHostCredentialRecovery,
  hostCredentialStorageKey,
} from "../../../lib/host-credential-recovery";
import {
  audienceContextKey,
  createAudienceRealtimeReceipt,
  createRealtimeClient,
  withRealtimeReceipt,
} from "../../../lib/realtime";
import {
  createAckRecoveryController,
  HOST_ACK_CHECKING_MESSAGE,
  HOST_ACK_TIMEOUT_MESSAGE,
} from "../../../lib/realtime-mutation-recovery";
import { experienceThemeStyle } from "../../../lib/theme";
import { clientUuid } from "../../../lib/uuid";
import { createHostCommandController, type HostPhaseCommand } from "../../../lib/host-phase";
import {
  getLegacyPhaseActions,
  getLegacyRecoveryActions,
  type LegacyHostCommand,
} from "../../../lib/legacy-host-phase";

type Ack<T> = { data?: T; error?: { code: string; message: string } };

const ACK_TIMEOUT_MS = 10_000;
const SYNC_GRACE_MS = 5_000;

const HOST_PHASE_MESSAGE_KEYS = {
  Lobby: "live.host.phase.lobby",
  "Question open": "live.host.phase.questionOpen",
  "Recheck open": "live.host.phase.recheckOpen",
  Paused: "live.host.phase.paused",
  Diagnose: "live.host.phase.diagnose",
  "Recheck locked": "live.host.phase.recheckLocked",
  "Recheck evidence": "live.host.phase.recheckEvidence",
  "Verify recovery": "live.host.phase.verifyRecovery",
  "Choose the next step": "live.host.phase.chooseNext",
  "Intervention in progress": "live.host.phase.intervention",
  Standings: "live.host.phase.standings",
  Complete: "live.host.phase.complete",
} as const;

const LEGACY_COMMAND_MESSAGE_KEYS = {
  "Start round": "live.host.command.startRound",
  "Lock answers": "live.host.command.lockAnswers",
  Pause: "live.host.command.pause",
  Resume: "live.host.command.resume",
  "Reveal answer": "live.host.command.revealAnswer",
  "Show standings": "live.host.command.showStandings",
  "Continue after recheck": "live.host.command.continueAfterRecheck",
  "Finish round": "live.host.command.finishRound",
  "Finish intervention": "live.host.command.finishIntervention",
  "Start peer discussion": "live.host.command.startDiscussion",
  "Work an example": "live.host.command.example",
  "Open linked recheck": "live.host.command.openLinkedRecheck",
  "Recheck by revote": "live.host.command.recheckByRevote",
} as const;

function hostCredential(sessionId: string) {
  const storageKey = hostCredentialStorageKey(sessionId);
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const cohostToken = fragment.get("cohost");
  if (cohostToken) {
    sessionStorage.setItem(storageKey, cohostToken);
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    return cohostToken;
  }
  return sessionStorage.getItem(storageKey);
}

export default function HostPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { locale, t } = useLocale();
  const confidenceCopy = confidenceControlCopy[locale];
  const socket = useMemo(createRealtimeClient, []);
  const numberFormatter = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const timeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
    [locale],
  );
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const snapshotRef = useRef<SessionSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [commandPending, setCommandPending] = useState(false);
  const [pendingConfidence, setPendingConfidence] = useState<boolean | null>(null);
  const [staffPending, setStaffPending] = useState(false);
  const [presenterPending, setPresenterPending] = useState(false);
  const [error, setError] = useState("");
  const [reportId, setReportId] = useState("");
  const [mediaCredential, setMediaCredential] = useState("");
  const [textReadAuthorized, setTextReadAuthorized] = useState(false);
  const [textReadEpoch, setTextReadEpoch] = useState(0);
  const [qnaRevision, setQnaRevision] = useState(0);
  const [audienceSyncRevision, setAudienceSyncRevision] = useState(0);
  const [audienceRealtimeBatch, setAudienceRealtimeBatch] = useState<AudienceRealtimeBatch | null>(
    null,
  );
  const audiencePanelKey = useMemo(
    () => (mediaCredential ? `${sessionId}:moderator:${clientUuid()}` : `${sessionId}:moderator`),
    [mediaCredential, sessionId],
  );
  const [staffCredentials, setStaffCredentials] = useState<SessionStaffCredential[]>([]);
  const [cohostLabel, setCohostLabel] = useState("");
  const [cohostLink, setCohostLink] = useState("");
  const [embedLink, setEmbedLink] = useState("");
  const [embedCopyStatus, setEmbedCopyStatus] = useState("");
  const [staffManagementAvailable, setStaffManagementAvailable] = useState(false);
  const [cohostingAvailable, setCohostingAvailable] = useState(false);
  const [creatorHref, setCreatorHref] = useState<"/" | "/home" | "/dashboard">("/");
  const [audienceOpen, setAudienceOpen] = useState(false);
  const [audienceTab, setAudienceTab] = useState<"participants" | "pulse" | "qna" | "chat">(
    "participants",
  );
  const audienceButtonRef = useRef<HTMLButtonElement>(null);
  const audienceDrawerRef = useRef<HTMLDivElement>(null);
  const audienceCloseRef = useRef<HTMLButtonElement>(null);
  const syncHostRef = useRef<() => void>(() => undefined);
  const commandRecoveryRef = useRef<ReturnType<typeof createAckRecoveryController<null>> | null>(
    null,
  );
  const recoverHostCredentialRef = useRef<
    ((error: NonNullable<Ack<unknown>["error"]>, rejectedToken: string) => Promise<boolean>) | null
  >(null);

  if (!commandRecoveryRef.current) {
    commandRecoveryRef.current = createAckRecoveryController({
      acknowledgementTimeoutMs: ACK_TIMEOUT_MS,
      reconciliationTimeoutMs: SYNC_GRACE_MS,
      onPendingChange: (pending) => {
        setCommandPending(pending);
        if (!pending) setPendingConfidence(null);
      },
      onReconciliationRequested: () => {
        setError(HOST_ACK_CHECKING_MESSAGE);
        syncHostRef.current();
      },
      onExpired: () => setError(HOST_ACK_TIMEOUT_MESSAGE),
    });
  }

  function clearPendingCommand(commandId?: string) {
    return Boolean(commandRecoveryRef.current?.settle(commandId));
  }

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    let disposed = false;
    let activeHostToken = "";
    let sync: () => void = () => undefined;
    const recovery = createHostCredentialRecovery(sessionStorage, sessionId);

    const missingCredentialMessage =
      "This tab does not have a host credential. Sign in as a workspace owner or editor, or open the original host link.";

    const requestControlPass = async () => {
      const { token } = await apiFetch<{ token: string }>(
        `/v1/sessions/${sessionId}/control-pass`,
        {
          method: "POST",
          body: "{}",
        },
      );
      if (disposed) return null;
      recovery.save(token);
      activeHostToken = token;
      setMediaCredential(token);
      return token;
    };

    const setControlPassError = (caught: unknown) => {
      if (disposed) return;
      setError(
        (caught as { status?: number }).status === 401
          ? missingCredentialMessage
          : humanError(caught),
      );
    };

    const recoverHostCredential = async (
      syncError: NonNullable<Ack<unknown>["error"]>,
      rejectedToken: string,
    ) => {
      if (disposed || rejectedToken !== activeHostToken) return false;
      if (!recovery.claim(syncError.code, rejectedToken)) {
        setError(syncError.message);
        return false;
      }
      try {
        const token = await requestControlPass();
        if (!token) return false;
        sync();
        return true;
      } catch (caught) {
        setControlPassError(caught);
        return false;
      }
    };
    recoverHostCredentialRef.current = recoverHostCredential;

    const connect = (hostToken: string) => {
      if (disposed) return;
      activeHostToken = hostToken;
      setMediaCredential(hostToken);
      sync = () => {
        const attemptedToken = activeHostToken;
        socket.emit(
          "sync.request",
          {
            sessionId,
            role: "host",
            clientCapabilities: currentRoundClientCapabilities(),
            hostToken: attemptedToken,
            lastSeq: snapshotRef.current?.seq ?? 0,
          },
          (response: Ack<{ snapshot: SessionSnapshot }>) => {
            if (disposed || attemptedToken !== activeHostToken) return;
            if (response.error) {
              setTextReadAuthorized(false);
              setTextReadEpoch((current) => current + 1);
              void recoverHostCredential(response.error, attemptedToken);
              return;
            }
            if (response.data) {
              recovery.succeeded();
              setTextReadAuthorized(socket.connected);
              if (!commandRecoveryRef.current?.current()) setError("");
              setSnapshot(response.data.snapshot);
            }
          },
        );
      };
      const update = withRealtimeReceipt(
        (envelope: EventEnvelope<{ snapshot: SessionSnapshot; reportId?: string }>) => {
          if (
            envelope.type === "lobby.updated" ||
            audienceContextKey(envelope.payload.snapshot) !==
              audienceContextKey(snapshotRef.current)
          ) {
            setAudienceSyncRevision((current) => current + 1);
          }
          setSnapshot(envelope.payload.snapshot);
          if (envelope.payload.reportId) setReportId(envelope.payload.reportId);
        },
      );
      const qnaUpdate = withRealtimeReceipt(() => setQnaRevision((current) => current + 1));
      const audienceUpdate = createAudienceRealtimeReceipt((gap, envelope) => {
        setAudienceRealtimeBatch((current) =>
          enqueueAudienceRealtimeUpdate(current, { gap, envelope }),
        );
        if (envelope.type.startsWith("qna.")) setQnaRevision((current) => current + 1);
      });
      socket.on("connect", () => {
        setTextReadAuthorized(false);
        setConnected(true);
        if (!commandRecoveryRef.current?.current()) setError("");
        setAudienceSyncRevision((current) => current + 1);
        sync();
      });
      socket.on("disconnect", () => {
        setConnected(false);
        setTextReadAuthorized(false);
        setTextReadEpoch((current) => current + 1);
      });
      for (const event of [
        "lobby.updated",
        "question.open",
        "question.locked",
        "question.reveal",
        "checkpoint.insight",
        "intervention.updated",
        "recheck.open",
        "leaderboard.updated",
        "game.finished",
        "session.snapshot",
        "response.moderated",
      ])
        socket.on(event, update);
      for (const event of [
        "qna.question.created",
        "qna.question.updated",
        "qna.reply.created",
        "qna.reply.updated",
        "qna.vote.updated",
        "qna.settings.updated",
      ])
        socket.on(event, qnaUpdate);
      for (const event of [
        "audience.settings.updated",
        "audience.signal.updated",
        "audience.summary.updated",
        "chat.message.created",
        "chat.message.updated",
        "chat.message.removed",
        "chat.message.pinned",
        "chat.reaction.updated",
        "audience.moderation.updated",
        "audience.event",
      ])
        socket.on(event, audienceUpdate);
      syncHostRef.current = sync;
      socket.on("client.update.required", () => setError(ROUND_CLIENT_UPDATE_MESSAGE));
      socket.connect();
    };

    const existingToken = hostCredential(sessionId);
    if (existingToken) {
      connect(existingToken);
    } else {
      void requestControlPass()
        .then((token) => {
          if (token) connect(token);
        })
        .catch(setControlPassError);
    }

    return () => {
      disposed = true;
      commandRecoveryRef.current?.dispose();
      syncHostRef.current = () => undefined;
      if (recoverHostCredentialRef.current === recoverHostCredential) {
        recoverHostCredentialRef.current = null;
      }
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [sessionId, socket]);

  const loadStaff = useCallback(async () => {
    try {
      const response = await apiFetch<{ credentials: SessionStaffCredential[] }>(
        `/v1/sessions/${sessionId}/staff`,
      );
      setStaffCredentials(response.credentials);
      setStaffManagementAvailable(true);
    } catch {
      setStaffManagementAvailable(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void loadStaff();
  }, [loadStaff]);

  useEffect(() => {
    apiFetch<{
      entitlements: { cohosting?: boolean };
      productFeatures?: { workspaceShell?: boolean };
    }>("/v1/auth/me")
      .then(async ({ entitlements, productFeatures }) => {
        setCreatorHref(
          creatorLandingHref({ workspaceShell: productFeatures?.workspaceShell === true }),
        );
        const room = await apiFetch<{ entitlements: { cohosting?: boolean } }>(
          `/v1/sessions/${sessionId}/entitlements`,
        );
        setCohostingAvailable(Boolean(room.entitlements.cohosting ?? entitlements.cohosting));
      })
      .catch(() => {
        setCreatorHref("/");
        setCohostingAvailable(false);
      });
  }, [sessionId]);

  useEffect(() => {
    if (!audienceOpen) return;
    const focusCloseControl = () => audienceCloseRef.current?.focus();
    const focusFrame = window.requestAnimationFrame(focusCloseControl);
    const focusFallback = window.setTimeout(focusCloseControl, 200);
    const manageDrawerFocus = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setAudienceOpen(false);
        window.requestAnimationFrame(() => audienceButtonRef.current?.focus());
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [
        ...(audienceDrawerRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]):not([tabindex="-1"]), a[href]:not([tabindex="-1"]), input:not([disabled]):not([tabindex="-1"]), select:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]):not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])',
        ) ?? []),
      ].filter((element) => element.offsetParent !== null);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (!audienceDrawerRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", manageDrawerFocus);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.clearTimeout(focusFallback);
      window.removeEventListener("keydown", manageDrawerFocus);
    };
  }, [audienceOpen]);

  useEffect(() => {
    if (snapshot?.phase !== "finished" || reportId) return;
    apiFetch<{ report: { id: string } }>(`/v1/sessions/${sessionId}/report`)
      .then(({ report }) => setReportId(report.id))
      .catch(() => undefined);
  }, [reportId, sessionId, snapshot?.phase]);

  function command(
    action: HostAction,
    options: {
      participantId?: string;
      interventionType?: InterventionType;
      recheckMode?: "linked" | "revote";
      recoveryPackCard?: RecoveryPackCardSelection;
      answerId?: string;
      responseStatus?: "approved" | "removed";
      confidenceEnabled?: boolean;
    } = {},
  ) {
    if (!snapshot || commandPending) return;
    if (!connected) {
      setError("Wait for the connection to recover before using host controls.");
      return;
    }
    const hostToken = sessionStorage.getItem(`openround:host:${sessionId}`);
    if (!hostToken) return;
    setError("");
    const commandId = clientUuid();
    if (!commandRecoveryRef.current?.begin(commandId, null)) return;
    setPendingConfidence(action === "confidence.set" ? (options.confidenceEnabled ?? null) : null);
    socket.emit(
      "host.command",
      {
        sessionId,
        hostToken,
        commandId,
        expectedVersion: snapshot.version,
        clientCapabilities: currentRoundClientCapabilities(),
        action,
        ...options,
      },
      (response: Ack<{ snapshot: SessionSnapshot }>) => {
        if (!clearPendingCommand(commandId)) return;
        if (response.error) {
          if (response.error.code === "UNAUTHORIZED" && recoverHostCredentialRef.current) {
            void recoverHostCredentialRef.current(response.error, hostToken);
            return;
          }
          setError(response.error.message);
          socket.emit(
            "sync.request",
            {
              sessionId,
              role: "host",
              hostToken,
              lastSeq: snapshotRef.current?.seq ?? 0,
              clientCapabilities: currentRoundClientCapabilities(),
            },
            (sync: Ack<{ snapshot: SessionSnapshot }>) => {
              if (sync.data) setSnapshot(sync.data.snapshot);
            },
          );
        } else if (response.data) {
          setSnapshot(response.data.snapshot);
        } else {
          setError(HOST_ACK_TIMEOUT_MESSAGE);
          syncHostRef.current();
        }
      },
    );
  }

  async function presenterAccess(requireEmbedPolicy: boolean) {
    let token = sessionStorage.getItem(`openround:presenter:${sessionId}`);
    let embedPolicyKey = sessionStorage.getItem(`openround:presenter-policy:${sessionId}`);
    let embedAllowedOrigins: string[];
    try {
      embedAllowedOrigins = JSON.parse(
        sessionStorage.getItem(`openround:presenter-origins:${sessionId}`) ?? "[]",
      ) as string[];
    } catch {
      embedAllowedOrigins = [];
    }
    if (!token || requireEmbedPolicy) {
      const created = await apiFetch<{
        token: string;
        credential: SessionStaffCredential;
        embedPolicyKey?: string;
        embedAllowedOrigins?: string[];
      }>(`/v1/sessions/${sessionId}/staff`, {
        method: "POST",
        body: JSON.stringify({
          role: "presenter",
          label: requireEmbedPolicy ? "Secure presenter embed" : "Presenter popout",
        }),
      });
      token = created.token;
      embedPolicyKey = created.embedPolicyKey ?? null;
      embedAllowedOrigins = created.embedAllowedOrigins ?? [];
      sessionStorage.setItem(`openround:presenter:${sessionId}`, token);
      if (embedPolicyKey) {
        sessionStorage.setItem(`openround:presenter-policy:${sessionId}`, embedPolicyKey);
        sessionStorage.setItem(
          `openround:presenter-origins:${sessionId}`,
          JSON.stringify(embedAllowedOrigins),
        );
      }
      await loadStaff();
    }
    return { token, embedPolicyKey, embedAllowedOrigins };
  }

  async function presenter() {
    setError("");
    setPresenterPending(true);
    try {
      await presenterAccess(false);
      window.open(
        `/present/${sessionId}`,
        `openround-presenter-${sessionId}`,
        "popup,width=1440,height=900",
      );
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setPresenterPending(false);
    }
  }

  async function createEmbedLink() {
    setError("");
    setEmbedCopyStatus("");
    setPresenterPending(true);
    try {
      const access = await presenterAccess(true);
      if (!access.embedPolicyKey) throw new Error("A secure embed policy could not be created.");
      if (access.embedAllowedOrigins.length === 0) {
        throw new Error(
          "Ask a workspace owner to add at least one HTTPS embed origin in Account settings, then create a new embed link.",
        );
      }
      const url = new URL(
        `/embed/present/${sessionId}/${access.embedPolicyKey}`,
        window.location.origin,
      );
      url.hash = new URLSearchParams({ credential: access.token }).toString();
      setEmbedLink(url.toString());
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setPresenterPending(false);
    }
  }

  async function copyEmbedLink() {
    if (!embedLink) return;
    try {
      await navigator.clipboard.writeText(embedLink);
      setEmbedCopyStatus("Secure embed link copied.");
    } catch {
      setEmbedCopyStatus("Copy was blocked. Select and copy the link below.");
    }
  }

  async function createCohost() {
    setError("");
    setStaffPending(true);
    try {
      const created = await apiFetch<{ token: string; credential: SessionStaffCredential }>(
        `/v1/sessions/${sessionId}/staff`,
        {
          method: "POST",
          body: JSON.stringify({
            role: "cohost",
            label: cohostLabel.trim() || "Cohost",
            expiresInMinutes: 240,
          }),
        },
      );
      const url = new URL(`/host/${sessionId}`, window.location.origin);
      url.hash = new URLSearchParams({ cohost: created.token }).toString();
      setCohostLink(url.toString());
      setCohostLabel("");
      await loadStaff();
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setStaffPending(false);
    }
  }

  async function revokeStaff(credentialId: string) {
    setError("");
    setStaffPending(true);
    try {
      await apiFetch(`/v1/sessions/${sessionId}/staff/${credentialId}`, { method: "DELETE" });
      await loadStaff();
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setStaffPending(false);
    }
  }

  function sendHostPhaseCommand(item: HostPhaseCommand) {
    command(item.action, {
      ...(item.interventionType ? { interventionType: item.interventionType } : {}),
      ...(item.recheckMode ? { recheckMode: item.recheckMode } : {}),
    });
  }
  const phaseController = snapshot
    ? createHostCommandController({
        getSnapshot: () => snapshot,
        execute: sendHostPhaseCommand,
      })
    : null;
  const phaseView = phaseController?.view() ?? null;
  const phaseMessageKey = phaseView
    ? HOST_PHASE_MESSAGE_KEYS[phaseView.phaseLabel as keyof typeof HOST_PHASE_MESSAGE_KEYS]
    : undefined;
  const localizedPhaseLabel = phaseMessageKey ? t(phaseMessageKey) : phaseView?.phaseLabel;
  function runPhaseCommand(item: HostPhaseCommand) {
    phaseController?.execute(item);
  }
  function runLegacyCommand(item: LegacyHostCommand) {
    sendHostPhaseCommand(item);
  }
  const uxBeta = snapshot?.uxBeta === true;
  const standingsStage =
    snapshot?.phase === "finished" ||
    (snapshot?.phase === "leaderboard" &&
      snapshot.roundKind === "main" &&
      Boolean(
        snapshot.competitionStandings || snapshot.settings.resultVisibility === "leaderboard",
      ));
  const legacyPhaseActions = snapshot ? getLegacyPhaseActions(snapshot) : [];
  const legacyRecoveryActions = snapshot ? getLegacyRecoveryActions(snapshot) : [];
  const legacyCommandLabel = (item: LegacyHostCommand) => {
    const messageKey =
      LEGACY_COMMAND_MESSAGE_KEYS[item.label as keyof typeof LEGACY_COMMAND_MESSAGE_KEYS];
    return (
      <span lang={messageKey ? locale : "en-CA"}>{messageKey ? t(messageKey) : item.label}</span>
    );
  };

  const pendingConfidenceValue = commandPending ? pendingConfidence : null;
  const inheritedConfidence =
    pendingConfidenceValue === null &&
    snapshot?.settings.confidenceEnabled === undefined &&
    !snapshot?.question;
  const confidenceControl = snapshot ? (
    <div className="host-confidence-control" lang={locale}>
      <label htmlFor="live-confidence-enabled" title={confidenceCopy.help}>
        <input
          aria-label={confidenceCopy.label}
          aria-checked={inheritedConfidence ? "mixed" : undefined}
          aria-describedby="live-confidence-help"
          checked={
            pendingConfidenceValue ??
            snapshot.settings.confidenceEnabled ??
            (snapshot.question ? (snapshot.question.confidence ?? "off") !== "off" : true)
          }
          disabled={commandPending || !connected || snapshot.phase === "finished"}
          id="live-confidence-enabled"
          onChange={(event) =>
            command("confidence.set", { confidenceEnabled: event.target.checked })
          }
          ref={(input) => {
            if (input) input.indeterminate = inheritedConfidence;
          }}
          type="checkbox"
        />
        <span>{confidenceCopy.shortLabel}</span>
      </label>
      <span className="sr-only" id="live-confidence-help">
        {confidenceCopy.help}
        {inheritedConfidence ? ` ${confidenceCopy.inherited}` : ""}
      </span>
    </div>
  ) : null;

  return (
    <div
      className="live-shell"
      data-corners={snapshot?.experienceTheme.tokens.corners}
      data-motion={snapshot?.experienceTheme.motion}
      data-pattern={snapshot?.experienceTheme.tokens.pattern}
      data-typography={snapshot?.experienceTheme.tokens.typography}
      data-ux-beta={uxBeta}
      style={experienceThemeStyle(snapshot?.experienceTheme)}
    >
      <header className="shell live-topbar" inert={audienceOpen}>
        <span lang="">
          <Brand href={creatorHref} inverted name={snapshot?.brandTheme?.organizationName} />
        </span>
        <div className="button-row">
          <ExperiencePreferences />
          <span
            className="connection"
            data-connected={connected}
            lang={connected ? locale : "en-CA"}
            role="status"
          >
            <span className="connection-dot" aria-hidden="true" />
            {connected ? t("live.common.connected") : "Reconnecting…"}
          </span>
          <button
            className="button-quiet small-button"
            disabled={presenterPending}
            lang="en-CA"
            onClick={() => void presenter()}
            type="button"
          >
            Presenter view
          </button>
        </div>
      </header>
      <main
        className={uxBeta ? "shell host-command-center" : "shell"}
        id="main"
        inert={audienceOpen}
        style={uxBeta ? undefined : { padding: "26px 0 70px" }}
      >
        <p aria-atomic="true" aria-live="polite" className="sr-only">
          {phaseView ? (
            <>
              <span lang="en-CA">Host phase: </span>
              <span lang={phaseMessageKey ? locale : "en-CA"}>{localizedPhaseLabel}</span>.
            </>
          ) : (
            <span lang="en-CA">Connecting host controls.</span>
          )}
        </p>
        {error ? (
          <p className="error" lang="en-CA" role="alert">
            {error}
          </p>
        ) : null}
        {!snapshot ? (
          <section className="live-card" lang="en-CA">
            <p>Synchronizing host controls…</p>
            <Link href="/dashboard">Return to dashboard</Link>
          </section>
        ) : (
          <>
            {uxBeta && !standingsStage ? (
              <section aria-label="Room readiness" className="room-readiness" lang="en-CA">
                <span>
                  <strong lang={connected ? locale : "en-CA"}>
                    {connected ? t("live.common.connected") : "Reconnecting"}
                  </strong>
                  <small>connection</small>
                </span>
                <span>
                  <strong>{snapshot.code}</strong>
                  <small>round code</small>
                </span>
                <span>
                  <strong>{numberFormatter.format(snapshot.participants.length)}</strong>
                  <small lang={locale}>{t("live.host.joined")}</small>
                </span>
                <span>
                  <strong>{numberFormatter.format(snapshot.answerCount)}</strong>
                  <small lang={locale}>{t("live.host.answered")}</small>
                </span>
                <span>
                  {snapshot.settings.timeMode === "flex" ? (
                    <>
                      <strong lang={locale}>{t("live.common.flexMode")}</strong>
                      <small lang={locale}>{t("live.common.timeMode")}</small>
                    </>
                  ) : (
                    <>
                      <strong
                        lang={
                          snapshot.questionPosition === null ||
                          snapshot.questionPosition === undefined
                            ? locale
                            : undefined
                        }
                      >
                        {snapshot.deadline
                          ? timeFormatter.format(new Date(snapshot.deadline))
                          : "None"}
                      </strong>
                      <small>deadline</small>
                    </>
                  )}
                </span>
                <span>
                  <strong>
                    {snapshot.questionPosition === null || snapshot.questionPosition === undefined
                      ? t("live.host.phase.lobby")
                      : `${numberFormatter.format(snapshot.questionPosition + 1)}/${numberFormatter.format(snapshot.questionCount)}`}
                  </strong>
                  <small>progress</small>
                </span>
                <span>
                  <strong lang={phaseMessageKey ? locale : "en-CA"}>
                    {localizedPhaseLabel ?? snapshot.phase.replaceAll("_", " ")}
                  </strong>
                  <small>phase</small>
                </span>
              </section>
            ) : null}
            <div
              className={uxBeta ? "host-grid host-layout" : "host-grid"}
              data-phase={snapshot.phase}
              data-results-stage={standingsStage || undefined}
              data-testid="host-session"
            >
              <HostStage enhanced={uxBeta} className={standingsStage ? "host-results-stage" : ""}>
                {snapshot.phase === "lobby" ? (
                  <>
                    <p className="eyebrow" lang="en-CA">
                      Round code
                    </p>
                    <h1 className="live-lobby-heading" lang="en-CA">
                      Join this round
                    </h1>
                    <div
                      className="session-code"
                      aria-label={`Round code ${snapshot.code.split("").join(" ")}`}
                      lang="en-CA"
                    >
                      {snapshot.code}
                    </div>
                    <p className="lead" lang="en-CA">
                      Share the code or QR. Start when the room is ready.
                    </p>
                    <ul className="roster" aria-label="Participant roster" lang="en-CA">
                      {snapshot.participants.map((participant) => (
                        <li key={participant.id}>
                          <span>
                            <span lang="">
                              <ParticipantIdentity
                                avatarId={participant.avatarId}
                                nickname={participant.nickname}
                              />
                            </span>
                            {participant.connected ? "" : ` · ${t("live.audience.offline")}`}
                          </span>
                          <button
                            aria-label={`Remove ${participant.nickname}`}
                            className="roster-kick"
                            disabled={commandPending}
                            onClick={() => command("kick", { participantId: participant.id })}
                            type="button"
                          >
                            {t("live.audience.remove")}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
                {snapshot.question && !standingsStage ? (
                  <>
                    <div
                      className="page-heading"
                      style={{ alignItems: "center", marginBottom: 18 }}
                    >
                      <span className="status-pill" lang={phaseMessageKey ? locale : "en-CA"}>
                        {localizedPhaseLabel ?? snapshot.phase.replaceAll("_", " ")}
                      </span>
                      {snapshot.phase === "question_open" ? (
                        snapshot.settings.timeMode === "flex" ? (
                          <span className="muted" lang={locale} role="status">
                            {t("live.common.flexOpen")}
                          </span>
                        ) : (
                          <Countdown deadline={snapshot.deadline} />
                        )
                      ) : null}
                    </div>
                    <h1 className="host-question-prompt" lang="">
                      {snapshot.question.prompt}
                    </h1>
                    <QuestionMedia
                      altText={snapshot.question.mediaAlt}
                      credential={mediaCredential}
                      mediaId={snapshot.question.mediaId}
                      sessionId={sessionId}
                    />
                    {snapshot.question.type === "poll" &&
                    (snapshot.question.maxSelections ?? 1) > 1 ? (
                      <p className="muted">
                        {t("live.roundPlay.pollSelectionInstructions", {
                          limit: snapshot.question.maxSelections ?? 1,
                        })}
                      </p>
                    ) : null}
                    {snapshot.question.type === "ranking" ? (
                      <p className="muted">
                        {t("live.ranking.instructions", {
                          count: snapshot.question.rankCount ?? snapshot.question.choices.length,
                          total: snapshot.question.choices.length,
                        })}
                      </p>
                    ) : null}
                    {snapshot.question.choices.length > 0 ? (
                      <div className="answer-grid">
                        {snapshot.question.choices.map((choice, index) => (
                          <div
                            className="answer-button"
                            data-correct={
                              snapshot.correctResponse?.kind === "choice" &&
                              snapshot.correctResponse.choiceIds.includes(choice.id)
                                ? true
                                : undefined
                            }
                            key={choice.id}
                          >
                            <span aria-hidden="true">{String.fromCharCode(65 + index)}.</span>{" "}
                            <span lang="">{choice.label}</span>
                          </div>
                        ))}
                      </div>
                    ) : snapshot.question.type === "numeric" ? (
                      <p className="notice" lang="en-CA">
                        Participants enter a numeric response
                        {snapshot.question.unit ? (
                          <>
                            {" "}
                            in <span lang="">{snapshot.question.unit}</span>
                          </>
                        ) : (
                          ""
                        )}
                        .
                        {snapshot.correctResponse?.kind === "numeric"
                          ? ` Accepted value: ${snapshot.correctResponse.value}.`
                          : ""}
                      </p>
                    ) : snapshot.question.rating ? (
                      <p className="notice" lang="en-CA">
                        Rating {numberFormatter.format(snapshot.question.rating.min)}–
                        {numberFormatter.format(snapshot.question.rating.max)}:{" "}
                        <span lang="">{snapshot.question.rating.minLabel}</span> to{" "}
                        <span lang="">{snapshot.question.rating.maxLabel}</span>.
                      </p>
                    ) : null}
                    {snapshot.explanation ? (
                      <p className="notice" lang="">
                        {snapshot.explanation}
                      </p>
                    ) : null}
                    {snapshot.phase === "intervention" && snapshot.recoveryPackCard ? (
                      <RecoveryPackLiveCardView card={snapshot.recoveryPackCard} />
                    ) : null}
                  </>
                ) : null}
                {snapshot.phase === "finished" && !(uxBeta && snapshot.competitionStandings) ? (
                  <div className="host-completion-summary">
                    <div>
                      <p className="eyebrow">{t("live.presenter.roundComplete")}</p>
                      <h1 className="host-complete-heading" lang="en-CA">
                        Results are ready.
                      </h1>
                      <p className="lead" lang="en-CA">
                        {numberFormatter.format(snapshot.participants.length)} participants
                        completed this live round.
                      </p>
                    </div>
                    {reportId ? (
                      <Link className="button" href={`/report/${reportId}`}>
                        Open report
                      </Link>
                    ) : (
                      <p className="notice">Finalizing the report…</p>
                    )}
                  </div>
                ) : null}
                {snapshot.competitionStandings && snapshot.phase !== "lobby" ? (
                  <CompetitionDashboard
                    variant="host"
                    headingLevel={standingsStage ? 1 : 2}
                    standings={snapshot.competitionStandings}
                    finished={snapshot.phase === "finished"}
                    compact={!standingsStage}
                    summary={!standingsStage}
                  />
                ) : snapshot.settings.resultVisibility === "leaderboard" &&
                  snapshot.phase !== "lobby" ? (
                  <ol style={{ paddingLeft: 24, lineHeight: 1.8 }}>
                    {snapshot.participants.slice(0, 5).map((participant) => (
                      <li key={participant.id}>
                        <ParticipantIdentity
                          avatarId={participant.avatarId}
                          nickname={participant.nickname}
                        />
                        {" · "}
                        {numberFormatter.format(participant.score)}
                      </li>
                    ))}
                  </ol>
                ) : null}
                {snapshot.roundProtocol?.requiredCapabilities.some(
                  (capability) =>
                    capability === "response.open_text" || capability === "response.word_cloud",
                ) ? (
                  <TextModerationPanel
                    sessionId={sessionId}
                    roundId={
                      snapshot.question && isTextQuestion(snapshot.question.type)
                        ? snapshot.roundId
                        : null
                    }
                    version={snapshot.version}
                    phase={snapshot.phase}
                    credential={textReadAuthorized ? mediaCredential : ""}
                    freshness={textReadEpoch}
                    disabled={commandPending || !connected || snapshot.phase === "finished"}
                    onModerate={(answerId, responseStatus) =>
                      command("response.moderate", { answerId, responseStatus })
                    }
                  />
                ) : null}
              </HostStage>
              <RecoveryCompass
                collapsible={uxBeta && standingsStage}
                phaseView={phaseView!}
                showSteps={uxBeta}
                snapshot={snapshot}
              >
                {snapshot.phase === "question_reveal" &&
                snapshot.roundKind === "main" &&
                snapshot.recoveryPackCards?.length ? (
                  <RecoveryPackCardPicker
                    key={snapshot.roundId}
                    cards={snapshot.recoveryPackCards}
                    disabled={commandPending || !connected}
                    onStart={(recoveryPackCard, interventionType) =>
                      command("intervention.start", { recoveryPackCard, interventionType })
                    }
                  />
                ) : null}
                {snapshot.phase === "lobby" ? <JoinAccess code={snapshot.code} editable /> : null}
                {snapshot.question && isTextQuestion(snapshot.question.type) && snapshot.roundId ? (
                  <TextLiveResults
                    sessionId={sessionId}
                    roundId={snapshot.roundId}
                    version={snapshot.version}
                    phase={snapshot.phase}
                    credential={textReadAuthorized ? mediaCredential : ""}
                    freshness={textReadEpoch}
                    headingLevel={3}
                    role="host"
                  />
                ) : null}
                {(uxBeta ||
                  snapshot.question?.type === "ranking" ||
                  (snapshot.question?.type === "poll" &&
                    (snapshot.question.maxSelections ?? 1) > 1)) &&
                snapshot.responseDistribution ? (
                  <ResponseDistributionView distribution={snapshot.responseDistribution} />
                ) : null}
                {!uxBeta && legacyRecoveryActions.length > 0 ? (
                  <div className="host-controls" lang="en-CA" style={{ marginBottom: 18 }}>
                    <strong>
                      {snapshot.phase === "question_locked"
                        ? "Recover understanding"
                        : "Intervene and verify"}
                    </strong>
                    {legacyRecoveryActions.map((item) => (
                      <button
                        className={item.className}
                        disabled={commandPending}
                        key={`${item.action}:${item.interventionType ?? item.recheckMode ?? ""}`}
                        onClick={() => runLegacyCommand(item)}
                        type="button"
                      >
                        {legacyCommandLabel(item)}
                      </button>
                    ))}
                  </div>
                ) : null}
                {snapshot.phase === "intervention" && snapshot.intervention ? (
                  <p className="notice" lang="en-CA">
                    Active intervention: {snapshot.intervention.type.replaceAll("_", " ")}. Finish
                    it before revealing or rechecking.
                  </p>
                ) : null}
                {!uxBeta ? (
                  <div className="host-controls" lang="en-CA">
                    {confidenceControl}
                    {legacyPhaseActions.map((item) => (
                      <button
                        className={item.className}
                        disabled={
                          commandPending ||
                          (item.action === "start" && snapshot.participants.length === 0)
                        }
                        key={item.action}
                        onClick={() => runLegacyCommand(item)}
                        type="button"
                      >
                        {legacyCommandLabel(item)}
                      </button>
                    ))}
                    {snapshot.phase === "lobby" ? (
                      <button
                        className="button-quiet"
                        disabled={commandPending}
                        onClick={() =>
                          command(snapshot.lobbyLocked ? "unlock_lobby" : "lock_lobby")
                        }
                        type="button"
                      >
                        {snapshot.lobbyLocked ? "Unlock lobby" : "Lock lobby"}
                      </button>
                    ) : null}
                    {snapshot.phase !== "lobby" && snapshot.phase !== "finished" ? (
                      <button
                        className="button-danger"
                        disabled={commandPending}
                        onClick={() => window.confirm("End this session now?") && command("end")}
                        type="button"
                      >
                        End session
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {staffManagementAvailable ? (
                  <details className="staff-management" lang="en-CA">
                    <summary>Round staff</summary>
                    <p className="muted">
                      Cohosts can run this round. Presenter credentials remain read-only. Links
                      expire automatically and can be revoked here.
                    </p>
                    {cohostingAvailable ? (
                      <>
                        <label className="field" htmlFor="cohost-label">
                          <span>Co-host label</span>
                          <input
                            className="input"
                            id="cohost-label"
                            lang=""
                            maxLength={80}
                            onChange={(event) => setCohostLabel(event.target.value)}
                            placeholder="Teaching assistant"
                            value={cohostLabel}
                          />
                        </label>
                        <button
                          className="button-quiet small-button"
                          disabled={staffPending}
                          onClick={() => void createCohost()}
                          type="button"
                        >
                          Create cohost link
                        </button>
                        {cohostLink ? (
                          <div className="notice staff-share-link" role="status">
                            <strong>Share this link once</strong>
                            <a href={cohostLink}>{cohostLink}</a>
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <p className="notice">
                        Shareable cohost links are available on Pro, Team, and Community plans.{" "}
                        <Link href="/pricing">Compare plans</Link>.
                      </p>
                    )}
                    <hr className="staff-divider" />
                    <h3>Presenter embed</h3>
                    <p className="muted">
                      Creates a read-only presenter link restricted to the workspace&apos;s
                      configured HTTPS origins. The credential is carried in the URL fragment and
                      removed after opening.
                    </p>
                    <button
                      className="button-quiet small-button"
                      disabled={presenterPending}
                      onClick={() => void createEmbedLink()}
                      type="button"
                    >
                      Create secure embed link
                    </button>
                    {embedLink ? (
                      <div className="notice staff-share-link" role="status">
                        <strong>Embed this read-only presenter URL</strong>
                        <a href={embedLink}>{embedLink}</a>
                        <button
                          className="button-quiet small-button"
                          onClick={() => void copyEmbedLink()}
                          type="button"
                        >
                          Copy embed link
                        </button>
                        {embedCopyStatus ? <span>{embedCopyStatus}</span> : null}
                      </div>
                    ) : null}
                    {staffCredentials.length > 0 ? (
                      <ul className="staff-list">
                        {staffCredentials.map((credential) => (
                          <li key={credential.id}>
                            <span>
                              <strong lang="">{credential.label || credential.role}</strong> ·{" "}
                              {credential.role}
                              {credential.revokedAt ? " · revoked" : ""}
                            </span>
                            {!credential.revokedAt ? (
                              <button
                                className="button-danger small-button"
                                disabled={staffPending}
                                onClick={() => void revokeStaff(credential.id)}
                                type="button"
                              >
                                Revoke
                              </button>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </details>
                ) : null}
              </RecoveryCompass>
            </div>
            {!uxBeta && mediaCredential ? (
              <>
                {snapshot.phase !== "finished" ? (
                  <AudiencePanel
                    key={audiencePanelKey}
                    onKick={(participantId) => command("kick", { participantId })}
                    realtimeBatch={audienceRealtimeBatch}
                    role="moderator"
                    sessionId={sessionId}
                    syncRevision={audienceSyncRevision}
                    token={mediaCredential}
                  />
                ) : null}
                <QnaPanel
                  revision={qnaRevision}
                  role="moderator"
                  sessionId={sessionId}
                  token={mediaCredential}
                />
              </>
            ) : null}
            {uxBeta && phaseView ? (
              <HostCommandBar
                busy={commandPending}
                fallback={
                  reportId ? (
                    <Link className="button" href={`/report/${reportId}`} lang="en-CA">
                      Open report
                    </Link>
                  ) : null
                }
                leading={
                  <>
                    {confidenceControl}
                    <button
                      aria-controls="host-audience-drawer"
                      aria-expanded={audienceOpen}
                      className="button-quiet"
                      lang="en-CA"
                      onClick={() => {
                        if (!audienceOpen) setAudienceSyncRevision((current) => current + 1);
                        setAudienceOpen((open) => !open);
                      }}
                      ref={audienceButtonRef}
                      type="button"
                    >
                      Audience
                    </button>
                    {snapshot.phase === "lobby" ? (
                      <button
                        className="button-quiet"
                        disabled={commandPending}
                        lang="en-CA"
                        onClick={() =>
                          command(snapshot.lobbyLocked ? "unlock_lobby" : "lock_lobby")
                        }
                        type="button"
                      >
                        {snapshot.lobbyLocked ? "Unlock lobby" : "Lock lobby"}
                      </button>
                    ) : null}
                  </>
                }
                onCommand={runPhaseCommand}
                phaseView={phaseView}
                primaryDisabled={
                  phaseView.primary?.action === "start" && snapshot.participants.length === 0
                }
                trailing={
                  snapshot.phase !== "lobby" && snapshot.phase !== "finished" ? (
                    <button
                      className="button-danger"
                      disabled={commandPending}
                      lang="en-CA"
                      onClick={() => window.confirm("End this session now?") && command("end")}
                      type="button"
                    >
                      End
                    </button>
                  ) : null
                }
              />
            ) : null}
          </>
        )}
      </main>
      {snapshot && mediaCredential && uxBeta ? (
        <div
          aria-hidden={!audienceOpen}
          aria-labelledby="audience-drawer-title"
          aria-modal="true"
          className="audience-drawer"
          data-open={audienceOpen || undefined}
          data-testid="audience-drawer"
          id="host-audience-drawer"
          inert={!audienceOpen}
          ref={audienceDrawerRef}
          role="dialog"
        >
          <div className="audience-drawer-heading">
            <div>
              <p className="eyebrow" lang="en-CA">
                Audience
              </p>
              <h2 id="audience-drawer-title" lang="en-CA">
                Participants and conversation
              </h2>
            </div>
            <button
              aria-label="Close audience tools"
              className="button-quiet small-button"
              onClick={() => {
                setAudienceOpen(false);
                window.requestAnimationFrame(() => audienceButtonRef.current?.focus());
              }}
              ref={audienceCloseRef}
              type="button"
            >
              {t("delivery.site.close")}
            </button>
          </div>
          <div
            aria-label="Audience views"
            className="audience-tabs"
            lang="en-CA"
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
              event.preventDefault();
              const tabs = ["participants", "pulse", "qna", "chat"] as const;
              const currentIndex = tabs.indexOf(audienceTab);
              const direction = event.key === "ArrowRight" ? 1 : -1;
              const next = tabs[(currentIndex + direction + tabs.length) % tabs.length]!;
              setAudienceTab(next);
              document.getElementById(`audience-tab-${next}`)?.focus();
            }}
            role="tablist"
          >
            <button
              aria-controls="host-audience-panel"
              aria-selected={audienceTab === "participants"}
              id="audience-tab-participants"
              onClick={() => setAudienceTab("participants")}
              role="tab"
              tabIndex={audienceTab === "participants" ? 0 : -1}
              type="button"
            >
              <span lang={locale}>
                {t("live.common.participants")} (
                {numberFormatter.format(snapshot.participants.length)})
              </span>
            </button>
            <button
              aria-controls="host-audience-panel"
              aria-selected={audienceTab === "pulse"}
              id="audience-tab-pulse"
              onClick={() => setAudienceTab("pulse")}
              role="tab"
              tabIndex={audienceTab === "pulse" ? 0 : -1}
              type="button"
            >
              <span lang={locale}>{t("live.audience.pulseShort")}</span>
            </button>
            <button
              aria-controls="host-qna-panel"
              aria-selected={audienceTab === "qna"}
              id="audience-tab-qna"
              onClick={() => setAudienceTab("qna")}
              role="tab"
              tabIndex={audienceTab === "qna" ? 0 : -1}
              type="button"
            >
              Q&amp;A
            </button>
            <button
              aria-controls="host-audience-panel"
              aria-selected={audienceTab === "chat"}
              id="audience-tab-chat"
              onClick={() => setAudienceTab("chat")}
              role="tab"
              tabIndex={audienceTab === "chat" ? 0 : -1}
              type="button"
            >
              <span lang={locale}>{t("live.audience.chat")}</span>
            </button>
          </div>
          <div
            aria-labelledby={`audience-tab-${audienceTab}`}
            hidden={audienceTab === "qna"}
            id="host-audience-panel"
            role="tabpanel"
          >
            {snapshot.phase !== "finished" ? (
              <AudiencePanel
                key={audiencePanelKey}
                onKick={(participantId) => command("kick", { participantId })}
                realtimeBatch={audienceRealtimeBatch}
                role="moderator"
                sessionId={sessionId}
                syncRevision={audienceSyncRevision}
                token={mediaCredential}
                view={audienceTab === "qna" ? "participants" : audienceTab}
              />
            ) : (
              <p className="muted" lang="en-CA">
                Audience controls close when the round finishes.
              </p>
            )}
          </div>
          <div
            aria-labelledby="audience-tab-qna"
            hidden={audienceTab !== "qna"}
            id="host-qna-panel"
            role="tabpanel"
          >
            <QnaPanel
              revision={qnaRevision}
              role="moderator"
              sessionId={sessionId}
              token={mediaCredential}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
