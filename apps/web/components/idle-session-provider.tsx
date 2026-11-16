"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { apiFetch, AUTH_CHANGE_EVENT } from "../lib/api";
import { clearAllCanvasCreationSetups } from "../lib/canvas-creation-storage";
import {
  clearCreatorSessionAuthority,
  clearPendingSessionLogout,
  idleSessionPhase,
  isWorkspaceSessionPath,
  parseIdleSession,
  publishSessionSignal,
  readPendingSessionLogout,
  savePendingSessionLogout,
  SESSION_EXPIRED_EVENT,
  SESSION_LOGOUT_EVENT,
  SESSION_POLICY_UPDATED_EVENT,
  SESSION_SYNC_KEY,
  sessionClock,
  sessionNow,
  sessionReturnPath,
  sessionSecondsRemaining,
  type IdleSession,
  type SessionClock,
} from "../lib/idle-session";
import { idleSessionCopy } from "../lib/i18n/idle-session-messages";
import { useLocale } from "./locale-provider";
import styles from "./idle-session.module.css";
import {
  HOST_CREDENTIAL_CHANGE_EVENT,
  readHostCredential,
  roundHostSessionId,
} from "../lib/host-credential-recovery";

type Phase =
  "checking" | "active" | "warning" | "expired" | "error" | "signing-out" | "logout-error";
interface SessionView {
  phase: Phase;
  scope: string;
  seconds: number;
  busy: boolean;
  failed: boolean;
}
const initialView: SessionView = {
  phase: "checking",
  scope: "",
  seconds: 60,
  busy: false,
  failed: false,
};

/** One creator session boundary for the entire app, including editors without WorkspaceShell. */
export function IdleSessionProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const hostSessionId = roundHostSessionId(pathname);
  if (hostSessionId)
    return (
      <RoundHostIdleSessionBoundary key={hostSessionId} sessionId={hostSessionId}>
        {children}
      </RoundHostIdleSessionBoundary>
    );
  const protectedPage = isWorkspaceSessionPath(pathname);
  return (
    <IdleSessionBoundary key={protectedPage ? "private" : "public"} protectedPage={protectedPage}>
      {children}
    </IdleSessionBoundary>
  );
}

function RoundHostIdleSessionBoundary({
  sessionId,
  children,
}: {
  sessionId: string;
  children: ReactNode;
}) {
  const [mode, setMode] = useState<"checking" | "creator" | "cohost">("checking");
  const { locale } = useLocale();
  useEffect(() => {
    const resolve = () => {
      let storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
      try {
        storage = window.sessionStorage;
      } catch {
        storage = {
          getItem: () => null,
          setItem: () => {
            throw new Error("Storage unavailable");
          },
          removeItem: () => {},
        };
      }
      const credential = readHostCredential(storage, sessionId, window.location.hash, () =>
        window.history.replaceState(
          null,
          "",
          `${window.location.pathname}${window.location.search}`,
        ),
      );
      setMode(credential.kind);
    };
    resolve();
    window.addEventListener("hashchange", resolve);
    window.addEventListener(HOST_CREDENTIAL_CHANGE_EVENT, resolve);
    return () => {
      window.removeEventListener("hashchange", resolve);
      window.removeEventListener(HOST_CREDENTIAL_CHANGE_EVENT, resolve);
    };
  }, [sessionId]);
  if (mode === "checking")
    return (
      <main className="shell page-main" data-testid="idle-session-gate" lang={locale}>
        <p role="status">{idleSessionCopy(locale).checking}</p>
      </main>
    );
  return (
    <IdleSessionBoundary key={mode} protectedPage={mode === "creator"}>
      {children}
    </IdleSessionBoundary>
  );
}

function IdleSessionBoundary({
  children,
  protectedPage,
}: {
  children: ReactNode;
  protectedPage: boolean;
}) {
  const router = useRouter();
  const { locale } = useLocale();
  const copy = idleSessionCopy(locale);
  const [view, setView] = useState<SessionView>(initialView);
  const actions = useRef({ retry: () => {}, stay: () => {}, signOut: () => {} });
  const dialog = useRef<HTMLDialogElement>(null);
  const stayButton = useRef<HTMLButtonElement>(null);
  const privateBoundary = useRef<HTMLDivElement>(null);
  const gate = useRef<HTMLElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (protectedPage) return;
    let disposed = false;
    let pending = false;
    let reconcileAgain = false;
    let channel: BroadcastChannel | null = null;
    const request = new AbortController();
    const reconcileLogout = async (value: unknown) => {
      if (!value || typeof value !== "object" || !("kind" in value) || value.kind !== "logout")
        return;
      if (pending) {
        reconcileAgain = true;
        return;
      }
      pending = true;
      try {
        await apiFetch("/v1/auth/session", { signal: request.signal, cache: "no-store" });
      } catch (error) {
        if (!disposed && (error as { status?: number }).status === 401) {
          clearCreatorSessionAuthority();
          clearAllCanvasCreationSetups();
        }
      } finally {
        pending = false;
        if (reconcileAgain && !disposed) {
          reconcileAgain = false;
          void reconcileLogout({ kind: "logout" });
        }
      }
    };
    const onMessage = (event: MessageEvent) => void reconcileLogout(event.data);
    const onStorage = (event: StorageEvent) => {
      if (channel || event.key !== SESSION_SYNC_KEY || !event.newValue) return;
      try {
        void reconcileLogout(JSON.parse(event.newValue));
      } catch {
        /* Untrusted signals are ignored. */
      }
    };
    try {
      channel = new BroadcastChannel(SESSION_SYNC_KEY);
      channel.addEventListener("message", onMessage);
    } catch {
      /* Storage fallback. */
    }
    window.addEventListener("storage", onStorage);
    return () => {
      disposed = true;
      request.abort();
      channel?.close();
      window.removeEventListener("storage", onStorage);
    };
  }, [protectedPage]);

  useEffect(() => {
    if (!protectedPage) return;
    let disposed = false;
    let ended = false;
    let generation = 0;
    let requestNumber = 0;
    let acceptedRequest = 0;
    let session: IdleSession | null = null;
    let clock: SessionClock | null = null;
    let activityPending = false;
    let overdue = false;
    let currentPhase: Phase = "checking";
    let verifyOverdue = () => {};
    let lastActivitySent = -Infinity;
    let lastReconcile = -Infinity;
    let reconcileTimer: number | undefined;
    let channel: BroadcastChannel | null = null;
    let pendingLogout = readPendingSessionLogout();
    let logoutInFlight = false;
    const requests = new Set<AbortController>();
    setView(initialView);

    const now = () => (clock ? sessionNow(clock, Date.now(), performance.now()) : Date.now());
    const broadcast = (kind: "activity" | "policy" | "logout" = "activity") => {
      publishSessionSignal(kind, channel);
    };
    const end = (reason: "session-expired" | "signed-out", returnPath?: string) => {
      if (disposed || ended) return;
      ended = true;
      generation++;
      for (const request of requests) request.abort();
      requests.clear();
      if (privateBoundary.current) {
        privateBoundary.current.hidden = true;
        privateBoundary.current.inert = true;
      }
      setView({ ...initialView, phase: "expired", seconds: 0 });
      clearCreatorSessionAuthority();
      clearAllCanvasCreationSetups();
      window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
      broadcast("logout");
      const returnTo = returnPath ?? sessionReturnPath(window.location);
      // Client navigation removes editor blockers with the private subtree and cannot be
      // cancelled by an unsaved-work confirmation after authorization has already ended.
      router.replace(`/signin?reason=${reason}&returnTo=${encodeURIComponent(returnTo)}`);
    };
    const tick = () => {
      if (disposed || ended || overdue || pendingLogout || !session) return;
      const phase = idleSessionPhase(session, now());
      if (phase === "expired") {
        verifyOverdue();
        return;
      }
      const seconds = sessionSecondsRemaining(session, now());
      if (phase === "warning" && currentPhase !== "warning") {
        returnFocus.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
      }
      currentPhase = phase;
      setView((current) =>
        current.phase === phase && current.seconds === seconds
          ? current
          : { ...current, phase, seconds },
      );
    };
    const requestSession = async (intent?: "activity" | "continue") => {
      if (
        disposed ||
        ended ||
        (pendingLogout && intent) ||
        (intent === "activity" && activityPending)
      )
        return;
      const requestGeneration = generation;
      const number = ++requestNumber;
      const requestWall = Date.now();
      const requestMonotonic = performance.now();
      const controller = new AbortController();
      requests.add(controller);
      if (intent === "activity") activityPending = true;
      if (intent === "continue") setView((current) => ({ ...current, busy: true, failed: false }));
      try {
        const result = await apiFetch<{ session: unknown }>(
          intent ? "/v1/auth/session/activity" : "/v1/auth/session",
          {
            ...(intent ? { method: "POST", body: JSON.stringify({ intent }) } : {}),
            signal: controller.signal,
            cache: "no-store",
          },
        );
        if (disposed || ended || generation !== requestGeneration || number < acceptedRequest)
          return;
        const next = parseIdleSession(result.session);
        if (!next) throw new Error("Invalid session response");
        if (pendingLogout) {
          if (next.sessionId === pendingLogout.sessionId) {
            session = next;
            setView({ ...initialView, phase: "logout-error" });
            return;
          }
          // A fresh login supersedes an old intent. Never retry revocation against it.
          clearPendingSessionLogout(pendingLogout.sessionId);
          pendingLogout = null;
          session = null;
          clock = null;
        }
        if (session && session.sessionId !== next.sessionId) {
          // A different login must never reuse the previous account's private tree.
          end("session-expired");
          return;
        }
        if (session && Date.parse(next.serverNow) < Date.parse(session.serverNow)) return;
        const switchedWorkspace = session && session.workspaceId !== next.workspaceId;
        if (switchedWorkspace) {
          if (privateBoundary.current) {
            privateBoundary.current.hidden = true;
            privateBoundary.current.inert = true;
          }
          clearCreatorSessionAuthority();
        }
        acceptedRequest = number;
        session = next;
        // A delayed or cached response must not grant its transit time as extra access.
        clock = sessionClock(next, requestWall, requestMonotonic);
        if (idleSessionPhase(next, Date.parse(next.serverNow)) === "expired") {
          end("session-expired");
          return;
        }
        overdue = false;
        if (privateBoundary.current && !switchedWorkspace) {
          privateBoundary.current.hidden = false;
          privateBoundary.current.inert = idleSessionPhase(next, now()) === "warning";
        }
        setView((current) => ({
          ...current,
          scope: `${next.sessionId}:${next.workspaceId ?? "account"}`,
          busy: false,
          failed: false,
        }));
        tick();
        if (intent) broadcast();
      } catch (error) {
        if (disposed || ended || generation !== requestGeneration || controller.signal.aborted)
          return;
        if ((error as { status?: number }).status === 401) {
          const intent = pendingLogout;
          if (intent) {
            clearPendingSessionLogout(intent.sessionId);
            pendingLogout = null;
          }
          end(intent ? "signed-out" : "session-expired", intent?.returnTo);
          return;
        }
        if (pendingLogout) {
          setView({ ...initialView, phase: "logout-error" });
        } else if (intent === "continue") {
          setView((current) => ({ ...current, busy: false, failed: true }));
        } else if (!session || overdue) {
          setView((current) => ({ ...current, phase: "error", busy: false, failed: false }));
        }
      } finally {
        requests.delete(controller);
        if (intent === "activity") activityPending = false;
      }
    };
    verifyOverdue = () => {
      if (disposed || ended || overdue || pendingLogout) return;
      overdue = true;
      generation++;
      for (const request of requests) request.abort();
      activityPending = false;
      if (currentPhase === "active") {
        returnFocus.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
      }
      if (privateBoundary.current) {
        privateBoundary.current.hidden = true;
        privateBoundary.current.inert = true;
      }
      setView((current) => ({ ...current, phase: "checking", busy: false, failed: false }));
      // A sleeping tab may hold an old deadline while another tab has continued.
      // Hide private content now, then consult the server before revoking anything.
      void requestSession();
    };
    const reconcile = () => {
      tick();
      if (overdue || ended || pendingLogout) return;
      if (disposed) return;
      const wait = 500 - (performance.now() - lastReconcile);
      if (wait > 0) {
        reconcileTimer ??= window.setTimeout(() => {
          reconcileTimer = undefined;
          reconcile();
        }, wait);
        return;
      }
      lastReconcile = performance.now();
      void requestSession();
    };
    const activity = (event: Event) => {
      // Scripted events, API reads, socket messages, animation, focus, and visibility
      // changes never count as human activity. Check expiry before accepting input.
      tick();
      if (overdue || ended || pendingLogout) {
        if (event.type === "keydown") {
          const key = (event as KeyboardEvent).key;
          // Retained private components can still have window shortcuts. Stop
          // those handlers while preserving native Tab and explicit gate actions.
          event.stopImmediatePropagation();
          if (key !== "Tab") {
            if (event.cancelable) event.preventDefault();
            if ((key === "Enter" || key === " ") && !(event as KeyboardEvent).repeat) {
              const control = Array.from(
                gate.current?.querySelectorAll<HTMLButtonElement>("button") ?? [],
              ).find((button) => event.composedPath().includes(button));
              control?.click();
            }
          }
          return;
        }
        // Gate controls must keep keyboard and pointer access while the hidden
        // private tree cannot deliver an overdue event to a host/editor handler.
        if (privateBoundary.current && event.composedPath().includes(privateBoundary.current)) {
          if (event.cancelable) event.preventDefault();
          event.stopImmediatePropagation();
        }
        return;
      }
      if (
        !event.isTrusted ||
        disposed ||
        ended ||
        !session ||
        document.visibilityState !== "visible" ||
        !document.hasFocus() ||
        idleSessionPhase(session, now()) !== "active" ||
        performance.now() - lastActivitySent < 1000
      )
        return;
      lastActivitySent = performance.now();
      void requestSession("activity");
    };
    const resume = () => {
      tick();
      if (document.visibilityState === "visible") reconcile();
    };
    // Any request can finish after a newer login replaced its cookie. Treat expiry
    // as a hint: gate synchronously, then verify the browser's current session.
    // Verification's own 401 is handled by requestSession; overdue prevents recursion.
    const expired = () => verifyOverdue();
    const loggedOut = () => {
      if (pendingLogout) {
        clearPendingSessionLogout(pendingLogout.sessionId);
        pendingLogout = null;
      }
      broadcast("logout");
      end("signed-out");
    };
    const storage = (event: StorageEvent) => {
      if (!channel && event.key === SESSION_SYNC_KEY) reconcile();
    };
    const workspaceChanged = () => {
      broadcast("policy");
      reconcile();
    };
    try {
      channel = new BroadcastChannel(SESSION_SYNC_KEY);
      channel.addEventListener("message", reconcile);
    } catch {
      /* Browsers without BroadcastChannel use the storage event. */
    }
    const attemptLogout = async () => {
      if (disposed || ended || !pendingLogout || logoutInFlight) return;
      const intent = pendingLogout;
      const attemptGeneration = generation;
      const current = () =>
        !disposed &&
        !ended &&
        generation === attemptGeneration &&
        pendingLogout?.sessionId === intent.sessionId;
      const controller = new AbortController();
      requests.add(controller);
      logoutInFlight = true;
      setView({ ...initialView, phase: "signing-out" });
      const timeout = window.setTimeout(() => controller.abort(), 12_000);
      const acceptReplacement = (live: IdleSession, wall: number, monotonic: number) => {
        clearPendingSessionLogout(intent.sessionId);
        pendingLogout = null;
        session = live;
        clock = sessionClock(live, wall, monotonic);
        overdue = false;
        if (idleSessionPhase(live, Date.parse(live.serverNow)) === "expired") {
          end("session-expired");
          return;
        }
        setView({ ...initialView, scope: `${live.sessionId}:${live.workspaceId ?? "account"}` });
        tick();
      };
      try {
        // Reconcile a persisted intent against the current cookie before a retry.
        const readWall = Date.now();
        const readMonotonic = performance.now();
        const result = await apiFetch<{ session: unknown }>("/v1/auth/session", {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!current()) return;
        const live = parseIdleSession(result.session);
        if (!live) throw new Error("Invalid session response");
        if (live.sessionId !== intent.sessionId) {
          acceptReplacement(live, readWall, readMonotonic);
          return;
        }
        // The server guard also closes the GET-to-POST fresh-login race. Guarded
        // responses have no cookie/global auth side effects outside this owner.
        await apiFetch("/v1/auth/logout", {
          method: "POST",
          body: JSON.stringify({ expectedSessionId: intent.sessionId }),
          signal: controller.signal,
          cache: "no-store",
        });
        if (!current()) return;
        clearPendingSessionLogout(intent.sessionId);
        pendingLogout = null;
        end("signed-out", intent.returnTo);
      } catch (error) {
        if (!current()) return;
        if ((error as { status?: number }).status === 401) {
          clearPendingSessionLogout(intent.sessionId);
          pendingLogout = null;
          end("signed-out", intent.returnTo);
        } else if ((error as { status?: number }).status === 409) {
          try {
            const wall = Date.now(),
              monotonic = performance.now();
            const result = await apiFetch<{ session: unknown }>("/v1/auth/session", {
              signal: controller.signal,
              cache: "no-store",
            });
            if (!current()) return;
            const live = parseIdleSession(result.session);
            if (live && live.sessionId !== intent.sessionId)
              acceptReplacement(live, wall, monotonic);
            else setView({ ...initialView, phase: "logout-error" });
          } catch {
            if (current()) setView({ ...initialView, phase: "logout-error" });
          }
        } else {
          setView({ ...initialView, phase: "logout-error" });
        }
      } finally {
        window.clearTimeout(timeout);
        requests.delete(controller);
        logoutInFlight = false;
      }
    };
    const beginLogout = () => {
      if (disposed || ended || pendingLogout || !session) return;
      pendingLogout = {
        sessionId: session.sessionId,
        returnTo: sessionReturnPath(window.location),
      };
      savePendingSessionLogout(pendingLogout);
      generation++;
      for (const request of requests) request.abort();
      requests.clear();
      overdue = false;
      if (privateBoundary.current) {
        privateBoundary.current.hidden = true;
        privateBoundary.current.inert = true;
      }
      clearCreatorSessionAuthority();
      clearAllCanvasCreationSetups();
      void attemptLogout();
    };
    actions.current = {
      retry: () => {
        if (pendingLogout) void attemptLogout();
        else void requestSession();
      },
      stay: () => {
        tick();
        if (!ended && !overdue) void requestSession("continue");
      },
      signOut: beginLogout,
    };
    const inputs = ["pointerdown", "keydown", "input", "wheel", "touchstart"];
    for (const input of inputs)
      window.addEventListener(input, activity, { capture: true, passive: false });
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    window.addEventListener("pageshow", resume);
    window.addEventListener("storage", storage);
    window.addEventListener(SESSION_EXPIRED_EVENT, expired);
    window.addEventListener(SESSION_LOGOUT_EVENT, loggedOut);
    window.addEventListener("polling-pops:workspace-updated", workspaceChanged);
    window.addEventListener(SESSION_POLICY_UPDATED_EVENT, workspaceChanged);
    const timer = window.setInterval(tick, 250);
    const statusTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") reconcile();
    }, 15_000);
    void requestSession();
    return () => {
      disposed = true;
      generation++;
      for (const request of requests) request.abort();
      window.clearInterval(timer);
      window.clearInterval(statusTimer);
      window.clearTimeout(reconcileTimer);
      channel?.close();
      for (const input of inputs) window.removeEventListener(input, activity, true);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener("pageshow", resume);
      window.removeEventListener("storage", storage);
      window.removeEventListener(SESSION_EXPIRED_EVENT, expired);
      window.removeEventListener(SESSION_LOGOUT_EVENT, loggedOut);
      window.removeEventListener("polling-pops:workspace-updated", workspaceChanged);
      window.removeEventListener(SESSION_POLICY_UPDATED_EVENT, workspaceChanged);
    };
  }, [protectedPage, router]);

  const warning = protectedPage && view.phase === "warning";
  useEffect(() => {
    const modal = dialog.current;
    if (!modal || !warning) return;
    modal.showModal();
    stayButton.current?.focus();
    return () => {
      modal.close();
    };
  }, [warning]);
  useEffect(() => {
    if (view.phase !== "active") return;
    if (returnFocus.current?.isConnected) returnFocus.current.focus();
    returnFocus.current = null;
  }, [view.phase]);

  if (!protectedPage) return children;
  const allowed = view.phase === "active" || view.phase === "warning";
  const announcement = view.seconds <= 10 ? view.seconds : Math.ceil(view.seconds / 15) * 15;
  return (
    <>
      {view.scope && view.phase !== "expired" ? (
        <div
          hidden={!allowed}
          inert={!allowed || warning || undefined}
          key={view.scope}
          ref={privateBoundary}
        >
          {children}
        </div>
      ) : null}
      {!allowed ? (
        <main className="shell page-main" data-testid="idle-session-gate" lang={locale} ref={gate}>
          <p role={view.phase === "logout-error" ? "alert" : "status"}>
            {view.phase === "expired"
              ? copy.expired
              : view.phase === "signing-out"
                ? copy.signingOut
                : view.phase === "logout-error"
                  ? copy.signOutError
                  : view.phase === "error"
                    ? copy.checkError
                    : copy.checking}
          </p>
          {view.phase === "error" || view.phase === "logout-error" ? (
            <button className="button" onClick={() => actions.current.retry()} type="button">
              {view.phase === "logout-error" ? copy.retrySignOut : copy.retry}
            </button>
          ) : null}
        </main>
      ) : null}
      {warning ? (
        <dialog
          aria-describedby="idle-session-description idle-session-save-help"
          aria-labelledby="idle-session-title"
          aria-modal="true"
          className={styles.dialog}
          data-testid="idle-session-warning"
          lang={locale}
          onCancel={(event) => event.preventDefault()}
          ref={dialog}
          role="alertdialog"
        >
          <h2 id="idle-session-title">{copy.warningTitle}</h2>
          <p id="idle-session-description">{copy.warningBody}</p>
          <p className={styles.countdown} role="timer" aria-live="off">
            {copy.countdown.split("{seconds}")[0]}
            <span data-testid="idle-session-countdown">{view.seconds}</span>
            {copy.countdown.split("{seconds}")[1]}
          </p>
          <p id="idle-session-save-help">{copy.saveHelp}</p>
          <span className={styles.srOnly} role="status">
            {copy.countdown.replace("{seconds}", String(announcement))}
          </span>
          {view.failed ? (
            <p className="error" role="alert">
              {copy.continueError}
            </p>
          ) : null}
          <div className={styles.actions}>
            <button
              className="button"
              disabled={view.busy}
              onClick={() => actions.current.stay()}
              ref={stayButton}
              type="button"
            >
              {view.busy ? copy.continuing : copy.stay}
            </button>
            <button
              className="button-quiet"
              onClick={() => actions.current.signOut()}
              type="button"
            >
              {copy.signOut}
            </button>
          </div>
        </dialog>
      ) : null}
    </>
  );
}
