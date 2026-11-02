"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type {
  CanvasBoardMutation,
  CanvasBoardShareGroups,
  CanvasBoardSharing,
  CanvasBoardView,
} from "@openround/contracts";
import { useLocale } from "../locale-provider";
import { apiFetch, ApiClientError, AUTH_CHANGE_EVENT } from "../../lib/api";
import { clientUuid } from "../../lib/uuid";
import { canvasSharingMessages } from "../../lib/i18n/canvas-sharing-messages";
import { BoardEmailInvitations } from "../idea-boards/guest-invitation-dialog";
import { canvasIntent, canvasPath, writeCanvas } from "./canvas-client";
import { readCanvasSharing, revokeCanvasGroup, shareCanvasGroups } from "./canvas-sharing-client";
import styles from "./canvas-sharing.module.css";

type ShareAction =
  | { kind: "groups"; intent: CanvasBoardShareGroups }
  | { kind: "revokeGroup"; groupId: string; operationId: string }
  | { kind: "role"; operation: CanvasBoardMutation }
  | { kind: "revoke"; userId: string }
  | { kind: "revokeInvitation"; invitationId: string };
type Tab = "groups" | "collaborators" | "guests";

export function CanvasShareDialog(props: {
  board: CanvasBoardView;
  onClose: () => void;
  onRefresh: () => void;
}) {
  return props.board.capabilities.share ? (
    <CanvasShareDialogContent key={props.board.id} {...props} />
  ) : null;
}
function CanvasShareDialogContent({
  board,
  onClose,
  onRefresh,
}: {
  board: CanvasBoardView;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const { t, locale } = useLocale();
  const copy = canvasSharingMessages(locale);
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const closeOnAuthChange = useRef(onClose);
  closeOnAuthChange.current = onClose;
  const controller = useRef<AbortController | null>(null);
  const sharingReads = useRef(new Set<AbortController>());
  const pending = useRef<ShareAction | null>(null);
  const inFlight = useRef(false);
  const readSequence = useRef(0);
  const [tab, setTab] = useState<Tab>("collaborators");
  const [sharing, setSharing] = useState<CanvasBoardSharing | null>(null);
  const [groupsAvailable, setGroupsAvailable] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [role, setRole] = useState<"editor" | "viewer" | "facilitator">("viewer");
  const [busy, setBusy] = useState(false);
  const [emailLocked, setEmailLocked] = useState(false);
  const [guestLocked, setGuestLocked] = useState(false);
  const [error, setError] = useState(false);
  const [notice, setNotice] = useState(false);
  const [revokedInvitationIds, setRevokedInvitationIds] = useState<string[]>([]);
  const blocked = busy || pending.current !== null || emailLocked || guestLocked;
  const tabs: Tab[] = [
    ...(groupsAvailable ? ["groups" as const] : []),
    "collaborators",
    ...(board.sourceBoardId ? ["guests" as const] : []),
  ];
  const activeTab = tabs.includes(tab) ? tab : "collaborators";
  function close() {
    if (busy || emailLocked || guestLocked) return;
    if (pending.current && !window.confirm(copy.closePendingConfirm)) return;
    onClose();
  }

  const refreshGroups = useCallback(
    async (signal: AbortSignal) => {
      const sequence = ++readSequence.current;
      setLoading(true);
      try {
        const result = await readCanvasSharing(board.id, signal);
        if (!signal.aborted && sequence === readSequence.current) {
          setSharing(result);
          setLoadError(false);
          setGroupsAvailable(true);
        }
      } catch (caught) {
        if (!signal.aborted && sequence === readSequence.current) {
          const unavailable =
            caught instanceof ApiClientError && [401, 403, 404, 410].includes(caught.status);
          setGroupsAvailable(!unavailable);
          setLoadError(!unavailable);
          if (unavailable) {
            setSharing(null);
            setSelectedGroups([]);
          }
        }
      } finally {
        if (!signal.aborted && sequence === readSequence.current) setLoading(false);
      }
    },
    [board.id],
  );
  useEffect(() => {
    const active = new AbortController();
    controller.current = active;
    const previous = document.activeElement;
    const element = dialog.current;
    element?.showModal();
    element?.querySelector<HTMLTextAreaElement>("[data-autofocus]")?.focus();
    const authorizationChanged = () => {
      active.abort();
      for (const read of sharingReads.current) read.abort();
      ++readSequence.current;
      closeOnAuthChange.current();
    };
    window.addEventListener(AUTH_CHANGE_EVENT, authorizationChanged);
    return () => {
      active.abort();
      window.removeEventListener(AUTH_CHANGE_EVENT, authorizationChanged);
      element?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  useEffect(() => {
    const active = new AbortController();
    sharingReads.current.add(active);
    void refreshGroups(active.signal);
    return () => {
      sharingReads.current.delete(active);
      active.abort();
    };
  }, [refreshGroups]);
  useEffect(() => {
    if (activeTab !== "groups") return;
    const active = new AbortController();
    sharingReads.current.add(active);
    void refreshGroups(active.signal);
    return () => {
      sharingReads.current.delete(active);
      active.abort();
    };
  }, [activeTab, board.canvasSeq, refreshGroups]);

  async function perform(next?: ShareAction) {
    if (inFlight.current || emailLocked || guestLocked || !board.capabilities.share) return;
    if (!pending.current && next) pending.current = next;
    const action = pending.current;
    const active = controller.current;
    if (!action || !active || active.signal.aborted) return;
    inFlight.current = true;
    setBusy(true);
    setError(false);
    setNotice(false);
    try {
      let result: CanvasBoardSharing | undefined;
      if (action.kind === "groups")
        result = await shareCanvasGroups(board.id, action.intent, active.signal);
      else if (action.kind === "revokeGroup")
        result = await revokeCanvasGroup(
          board.id,
          action.groupId,
          action.operationId,
          active.signal,
        );
      else if (action.kind === "role") await writeCanvas(board.id, action.operation, active.signal);
      else if (action.kind === "revoke")
        await apiFetch(`${canvasPath(board.id)}/grants/${action.userId}`, {
          method: "DELETE",
          signal: active.signal,
        });
      else
        await apiFetch(`${canvasPath(board.id)}/invitations/${action.invitationId}`, {
          method: "DELETE",
          signal: active.signal,
        });
      if (active.signal.aborted || controller.current !== active) return;
      pending.current = null;
      if (action.kind === "revokeInvitation")
        setRevokedInvitationIds((current) => [...new Set([...current, action.invitationId])]);
      if (result) {
        ++readSequence.current;
        setSharing(result);
        setLoading(false);
        setLoadError(false);
        setSelectedGroups([]);
        setNotice(true);
      }
      onRefresh();
    } catch (caught) {
      if (active.signal.aborted || controller.current !== active) return;
      if (caught instanceof ApiClientError && caught.status < 500 && caught.status !== 429)
        pending.current = null;
      setError(true);
    } finally {
      if (!active.signal.aborted && controller.current === active) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }
  function tabKeys(event: KeyboardEvent<HTMLButtonElement>, current: Tab) {
    if (blocked || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = tabs.indexOf(current);
    const next =
      event.key === "Home"
        ? tabs[0]!
        : event.key === "End"
          ? tabs[tabs.length - 1]!
          : tabs[(index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length]!;
    setTab(next);
    dialog.current?.querySelector<HTMLButtonElement>(`[data-share-tab="${next}"]`)?.focus();
  }
  const visibleGroups =
    sharing?.availableGroups.filter((group) =>
      group.name.toLocaleLowerCase(locale).includes(search.trim().toLocaleLowerCase(locale)),
    ) ?? [];
  return (
    <dialog
      className={styles.dialog}
      ref={dialog}
      aria-labelledby={`${id}-title`}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header className={styles.header}>
        <div>
          <h2 id={`${id}-title`}>{t("canvas.share")}</h2>
          <p lang="">{board.title}</p>
        </div>
        <button
          type="button"
          className="button-quiet"
          disabled={busy || emailLocked || guestLocked}
          onClick={close}
        >
          {copy.close}
        </button>
      </header>
      <p className={styles.origin}>
        {t("canvas.origin")}:{" "}
        <span lang="">
          {[board.organizationName, board.workspaceName ?? board.title].filter(Boolean).join(" · ")}
        </span>
      </p>
      <div role="tablist" aria-label={t("canvas.share")} className={styles.tabs}>
        {tabs.map((key) => (
          <button
            key={key}
            id={`${id}-tab-${key}`}
            data-share-tab={key}
            type="button"
            role="tab"
            aria-selected={activeTab === key}
            aria-controls={`${id}-panel-${key}`}
            tabIndex={activeTab === key ? 0 : -1}
            disabled={blocked}
            onClick={() => setTab(key)}
            onKeyDown={(event) => tabKeys(event, key)}
          >
            {copy[key]}
          </button>
        ))}
      </div>
      <div className={styles.body}>
        {error ? (
          <p className="error" role="alert">
            {copy.requestFailed}
          </p>
        ) : null}
        {pending.current ? (
          <button
            className="button-quiet"
            type="button"
            disabled={busy}
            onClick={() => void perform()}
          >
            {t("boards.retry")}
          </button>
        ) : null}
        {notice ? (
          <p className={styles.notice} role="status">
            {copy.groupSaved}
          </p>
        ) : null}
        {groupsAvailable ? (
          <section
            role="tabpanel"
            aria-labelledby={`${id}-tab-groups`}
            id={`${id}-panel-groups`}
            hidden={activeTab !== "groups"}
            aria-busy={loading}
          >
            <p className={styles.help}>{copy.groupHelp}</p>
            {loading && !sharing ? <p role="status">{copy.loadingGroups}</p> : null}
            {loadError ? (
              <p role="alert">
                {copy.loadFailed}{" "}
                <button
                  className="button-quiet"
                  type="button"
                  disabled={blocked || loading}
                  onClick={() =>
                    controller.current && void refreshGroups(controller.current.signal)
                  }
                >
                  {t("boards.retry")}
                </button>
              </p>
            ) : null}
            {!loadError && sharing ? (
              <>
                <label className={styles.field}>
                  <span>{copy.searchGroups}</span>
                  <input
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </label>
                <fieldset className={styles.groupPicker} disabled={blocked}>
                  <legend className="sr-only">{copy.groups}</legend>
                  {visibleGroups.map((group) => (
                    <label key={group.id} className={styles.groupOption}>
                      <input
                        type="checkbox"
                        checked={selectedGroups.includes(group.id)}
                        disabled={!selectedGroups.includes(group.id) && selectedGroups.length >= 20}
                        onChange={(event) =>
                          setSelectedGroups((current) =>
                            event.target.checked
                              ? [...current, group.id]
                              : current.filter((value) => value !== group.id),
                          )
                        }
                      />
                      <span>
                        <strong lang="">{group.name}</strong>
                        <small>
                          {copy.memberCount.replace("{count}", String(group.memberCount))}
                        </small>
                      </span>
                    </label>
                  ))}
                  {!visibleGroups.length ? <p className={styles.help}>{copy.noGroups}</p> : null}
                </fieldset>
                <div className={styles.groupSubmit}>
                  <label className={styles.field}>
                    <span>{t("canvas.inviteRole")}</span>
                    <select
                      value={role}
                      disabled={blocked}
                      onChange={(event) => setRole(event.target.value as typeof role)}
                    >
                      {(["viewer", "editor", "facilitator"] as const).map((value) => (
                        <option key={value} value={value}>
                          {t(`canvas.${value}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="button"
                    type="button"
                    disabled={blocked || !selectedGroups.length}
                    onClick={() =>
                      void perform({
                        kind: "groups",
                        intent: { operationId: clientUuid(), groupIds: [...selectedGroups], role },
                      })
                    }
                  >
                    {copy.shareGroups}
                  </button>
                </div>
                <p className={styles.help} role="status">
                  {copy.selected.replace("{count}", String(selectedGroups.length))}
                </p>
                <h3>{copy.sharedGroups}</h3>
                <ul className={styles.rows}>
                  {sharing.groups.map((group) => (
                    <li key={group.groupId}>
                      <span className={styles.person} lang="">
                        {group.name}
                      </span>
                      <span>{t(`canvas.${group.role}`)}</span>
                      <button
                        type="button"
                        className="button-quiet"
                        disabled={blocked}
                        onClick={() =>
                          void perform({
                            kind: "revokeGroup",
                            groupId: group.groupId,
                            operationId: clientUuid(),
                          })
                        }
                      >
                        {t("canvas.revoke")}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>
        ) : null}
        <section
          role="tabpanel"
          aria-labelledby={`${id}-tab-collaborators`}
          id={`${id}-panel-collaborators`}
          hidden={activeTab !== "collaborators"}
        >
          <BoardEmailInvitations
            target={{ kind: "collaborators", id: board.id }}
            disabled={busy || pending.current !== null}
            onLockChange={setEmailLocked}
            onRefresh={onRefresh}
            revokedInvitationIds={[
              ...revokedInvitationIds,
              ...board.invitations
                .filter((invitation) => invitation.revokedAt)
                .map((invitation) => invitation.id),
            ]}
          />
          <h3>{copy.directAccess}</h3>
          <p className={styles.help}>{copy.groupAccessNote}</p>
          <ul className={styles.rows}>
            {board.grants.map((grant) => (
              <li key={grant.userId}>
                <span className={styles.person} lang="">
                  {grant.label ?? t(`canvas.${grant.role}`)}
                </span>
                <select
                  aria-label={`${t("canvas.inviteRole")} · ${grant.label ?? t(`canvas.${grant.role}`)}`}
                  value={grant.role}
                  disabled={blocked}
                  onChange={(event) =>
                    void perform({
                      kind: "role",
                      operation: canvasIntent({
                        type: "grant",
                        userId: grant.userId,
                        role: event.target.value as "facilitator" | "editor" | "viewer",
                      }),
                    })
                  }
                >
                  {(["editor", "facilitator", "viewer"] as const).map((value) => (
                    <option key={value} value={value}>
                      {t(`canvas.${value}`)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="button-quiet"
                  disabled={blocked}
                  onClick={() => void perform({ kind: "revoke", userId: grant.userId })}
                >
                  {t("canvas.revoke")}
                </button>
              </li>
            ))}
          </ul>
          <h3>{copy.pendingInvitations}</h3>
          <ul className={styles.rows}>
            {board.invitations
              .filter(
                (invitation) =>
                  !invitation.acceptedAt &&
                  !invitation.revokedAt &&
                  Date.parse(invitation.expiresAt) > Date.now(),
              )
              .map((invitation) => (
                <li key={invitation.id}>
                  <span className={styles.person} lang="">
                    {invitation.email}
                  </span>
                  <span>{t(`canvas.${invitation.role}`)}</span>
                  <a href={`/canvas/invitations/${invitation.id}`}>{t("boards.link")}</a>
                  <button
                    type="button"
                    className="button-quiet"
                    disabled={blocked}
                    onClick={() =>
                      void perform({ kind: "revokeInvitation", invitationId: invitation.id })
                    }
                  >
                    {t("canvas.invitation.revoke")}
                  </button>
                </li>
              ))}
          </ul>
        </section>
        {board.sourceBoardId ? (
          <section
            role="tabpanel"
            aria-labelledby={`${id}-tab-guests`}
            id={`${id}-panel-guests`}
            hidden={activeTab !== "guests"}
          >
            <BoardEmailInvitations
              target={{ kind: "guests", id: board.sourceBoardId }}
              disabled={busy || pending.current !== null}
              onLockChange={setGuestLocked}
            />
          </section>
        ) : null}
      </div>
    </dialog>
  );
}
