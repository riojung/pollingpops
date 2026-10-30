"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { CanvasBoardMutation, CanvasBoardView } from "@openround/contracts";
import { useLocale } from "../locale-provider";
import { apiFetch, ApiClientError, humanError } from "../../lib/api";
import { clientUuid } from "../../lib/uuid";
import { canvasIntent, canvasPath, inviteCanvas, writeCanvas } from "./canvas-client";
import styles from "./canvas.module.css";

export function CanvasShareDialog({
  board,
  onClose,
  onRefresh,
}: {
  board: CanvasBoardView;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const { t } = useLocale();
  const dialog = useRef<HTMLDialogElement>(null);
  const emailInput = useRef<HTMLInputElement>(null);
  const pending = useRef<{
    email: string;
    role: "editor" | "viewer" | "facilitator";
    operationId: string;
  } | null>(null);
  const active = useRef(true);
  const pendingRole = useRef<CanvasBoardMutation | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"editor" | "viewer" | "facilitator">("editor");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [link, setLink] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    active.current = true;
    const previous = document.activeElement;
    dialog.current?.showModal();
    emailInput.current?.focus();
    return () => {
      active.current = false;
      dialog.current?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  async function invite(event: FormEvent) {
    event.preventDefault();
    if (busy || !board.capabilities.share) return;
    pending.current ??= { email: email.trim().toLowerCase(), role, operationId: clientUuid() };
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const operation = pending.current;
      const result = await inviteCanvas(
        board.id,
        operation.email,
        operation.role,
        operation.operationId,
      );
      if (!active.current) return;
      pending.current = null;
      setEmail("");
      setLink(`${window.location.origin}/canvas/invitations/${result.invitation.id}`);
      setNotice(t("canvas.inviteSent"));
      onRefresh();
    } catch (caught) {
      if (!active.current) return;
      if (caught instanceof ApiClientError && caught.status < 500 && caught.status !== 429)
        pending.current = null;
      setError(humanError(caught));
    } finally {
      if (active.current) setBusy(false);
    }
  }
  async function revoke(userId: string) {
    if (busy || pendingRole.current || pending.current) return;
    setBusy(true);
    setError("");
    try {
      await apiFetch(`${canvasPath(board.id)}/grants/${userId}`, { method: "DELETE" });
      if (active.current) onRefresh();
    } catch (caught) {
      if (active.current) setError(humanError(caught));
    } finally {
      if (active.current) setBusy(false);
    }
  }
  async function revokeInvitation(invitationId: string) {
    if (busy || pendingRole.current || pending.current || !board.capabilities.share) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await apiFetch(`${canvasPath(board.id)}/invitations/${invitationId}`, { method: "DELETE" });
      if (!active.current) return;
      if (link.endsWith(`/canvas/invitations/${invitationId}`)) setLink("");
      onRefresh();
    } catch (caught) {
      if (active.current) setError(humanError(caught));
    } finally {
      if (active.current) setBusy(false);
    }
  }
  async function changeRole(userId?: string, role?: "facilitator" | "editor" | "viewer") {
    if (busy || pending.current || !board.capabilities.share) return;
    if (!pendingRole.current && userId && role)
      pendingRole.current = canvasIntent({ type: "grant", userId, role });
    if (!pendingRole.current) return;
    setBusy(true);
    setError("");
    try {
      await writeCanvas(board.id, pendingRole.current);
      if (!active.current) return;
      pendingRole.current = null;
      onRefresh();
    } catch (caught) {
      if (!active.current) return;
      if (caught instanceof ApiClientError && caught.status < 500 && caught.status !== 429)
        pendingRole.current = null;
      setError(humanError(caught));
    } finally {
      if (active.current) setBusy(false);
    }
  }
  return (
    <dialog
      className={styles.dialog}
      ref={dialog}
      aria-labelledby="canvas-share-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header className={styles.dialogHeader}>
        <h2 id="canvas-share-title">{t("canvas.share")}</h2>
        <button type="button" className="button-quiet" disabled={busy} onClick={onClose}>
          {t("boards.cancel")}
        </button>
      </header>
      <p>{t("canvas.shareScope")}</p>
      <p className={styles.muted}>
        {t("canvas.origin")}:{" "}
        <span lang="">
          {board.organizationName ?? ""}
          {board.organizationName && board.workspaceName ? " · " : ""}
          {board.workspaceName ?? board.title}
        </span>
      </p>
      {error ? (
        <p className="error" role="alert" lang="en-CA">
          {error}
        </p>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
      <form onSubmit={(event) => void invite(event)} className={styles.form}>
        <label>
          {t("canvas.inviteEmail")}
          <input
            ref={emailInput}
            type="email"
            required
            maxLength={320}
            value={email}
            disabled={busy || pending.current !== null || pendingRole.current !== null}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          {t("canvas.inviteRole")}
          <select
            value={role}
            disabled={busy || pending.current !== null || pendingRole.current !== null}
            onChange={(event) => setRole(event.target.value as typeof role)}
          >
            {(["editor", "facilitator", "viewer"] as const).map((value) => (
              <option key={value} value={value}>
                {t(`canvas.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button"
          disabled={busy || !email.trim() || pendingRole.current !== null}
          type="submit"
        >
          {t(pending.current ? "boards.retry" : "canvas.invite")}
        </button>
      </form>
      {link ? (
        <div className={styles.form}>
          <label>
            {t("boards.link")}
            <input readOnly value={link} onFocus={(event) => event.currentTarget.select()} />
          </label>
          <button
            type="button"
            className="button-quiet"
            onClick={() => {
              void navigator.clipboard
                .writeText(link)
                .then(() => setNotice(t("boards.copied")))
                .catch(() => setNotice(t("boards.copyFailed")));
            }}
          >
            {t("canvas.copyLink")}
          </button>
        </div>
      ) : null}
      <ul className={styles.members}>
        {board.grants.map((grant) => (
          <li key={grant.userId}>
            <span lang="">{grant.label ?? t(`canvas.${grant.role}`)}</span>
            <select
              aria-label={`${t("canvas.inviteRole")} · ${grant.label ?? t(`canvas.${grant.role}`)}`}
              value={grant.role}
              disabled={busy || pending.current !== null || pendingRole.current !== null}
              onChange={(event) =>
                void changeRole(
                  grant.userId,
                  event.target.value as "facilitator" | "editor" | "viewer",
                )
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
              disabled={busy || pending.current !== null || pendingRole.current !== null}
              onClick={() => void revoke(grant.userId)}
            >
              {t("canvas.revoke")}
            </button>
          </li>
        ))}
      </ul>
      {pendingRole.current ? (
        <button type="button" className="button" disabled={busy} onClick={() => void changeRole()}>
          {t("boards.retry")}
        </button>
      ) : null}
      <ul className={styles.members}>
        {board.invitations
          .filter(
            (invitation) =>
              !invitation.acceptedAt &&
              !invitation.revokedAt &&
              Date.parse(invitation.expiresAt) > Date.now(),
          )
          .map((invitation) => (
            <li key={invitation.id}>
              <span lang="">{invitation.email}</span>
              <span>{t(`canvas.${invitation.role}`)}</span>
              <a href={`/canvas/invitations/${invitation.id}`}>{t("boards.link")}</a>
              <button
                type="button"
                className="button-quiet"
                disabled={busy || pending.current !== null || pendingRole.current !== null}
                onClick={() => void revokeInvitation(invitation.id)}
              >
                {t("canvas.invitation.revoke")}
              </button>
            </li>
          ))}
      </ul>
    </dialog>
  );
}
