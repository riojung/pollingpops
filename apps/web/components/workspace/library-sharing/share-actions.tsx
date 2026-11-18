"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useLocale } from "../../locale-provider";
import { useWorkspace } from "../workspace-provider";
import { ApiClientError } from "../../../lib/api";
import { librarySharingMessages } from "../../../lib/i18n/library-sharing-messages";
import {
  copyLibraryShare,
  revokeLibraryShare,
  updateLibraryShareProgress,
  type LibraryShareSummary,
} from "./client";
import styles from "./library-sharing.module.css";
import {
  acquireLibraryCopyIntent,
  libraryCopyIntentKey,
  settleLibraryCopyIntent,
} from "./copy-intent";

export function LibraryShareActions({
  share,
  onChange,
  onRevoked,
  showOpen = true,
  onAccessChanged,
}: {
  share: LibraryShareSummary;
  onChange: (share: LibraryShareSummary) => void;
  onRevoked: () => void;
  showOpen?: boolean;
  onAccessChanged?: () => void;
}) {
  const { locale } = useLocale();
  const copy = librarySharingMessages(locale);
  const { creator } = useWorkspace();
  const copyKey =
    creator?.userId && creator?.workspaceId
      ? libraryCopyIntentKey(creator.userId, creator.workspaceId, share.id)
      : null;
  const contextKey = JSON.stringify([creator?.userId, creator?.workspaceId, share.id]);
  const currentContext = useRef(contextKey);
  currentContext.current = contextKey;
  const router = useRouter();
  const controller = useRef<AbortController | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState(false);
  useEffect(() => {
    const active = new AbortController();
    controller.current = active;
    setBusy("");
    setError(false);
    return () => active.abort();
  }, [contextKey]);

  async function perform(action: "copy" | "progress" | "revoke") {
    const active = controller.current;
    if (
      !active ||
      active.signal.aborted ||
      inFlight.current === active ||
      currentContext.current !== contextKey
    )
      return;
    if (action === "copy" && (!share.capabilities.copy || !copyKey)) return;
    if (action === "revoke" && (!share.capabilities.manage || !window.confirm(copy.revokeConfirm)))
      return;
    inFlight.current = active;
    setBusy(action);
    setError(false);
    let requestId: string | null = null;
    try {
      if (action === "copy" && copyKey) {
        requestId = acquireLibraryCopyIntent(copyKey);
        const result = await copyLibraryShare(share.id, requestId, active.signal);
        settleLibraryCopyIntent(copyKey, requestId);
        if (!active.signal.aborted && currentContext.current === contextKey) {
          router.push(result.href);
        }
      } else if (action === "progress") {
        const result = await updateLibraryShareProgress(share.id, "done", active.signal);
        if (!active.signal.aborted) onChange(result);
      } else {
        await revokeLibraryShare(share.id, active.signal);
        if (!active.signal.aborted) onRevoked();
      }
    } catch (caught) {
      if (
        action === "copy" &&
        copyKey &&
        requestId &&
        caught instanceof ApiClientError &&
        caught.status === 409 &&
        caught.code === "IDEMPOTENCY_CONFLICT"
      )
        settleLibraryCopyIntent(copyKey, requestId);
      // Authorization, availability, and validation can fail before receipt lookup;
      // they cannot settle an earlier request whose acknowledgement was lost.
      if (!active.signal.aborted && currentContext.current === contextKey) {
        setError(true);
        if (caught instanceof ApiClientError && [401, 403, 404].includes(caught.status))
          onAccessChanged?.();
      }
    } finally {
      if (inFlight.current === active) inFlight.current = null;
      if (!active.signal.aborted && currentContext.current === contextKey) setBusy("");
    }
  }
  return (
    <>
      <div className={styles.actions}>
        {showOpen && share.capabilities.view ? (
          <Link href={`/library/shared/${share.id}`} className="button-quiet small-button">
            {copy.open}
          </Link>
        ) : null}
        {share.capabilities.copy ? (
          <button
            type="button"
            className="button small-button"
            disabled={Boolean(busy) || !copyKey}
            onClick={() => void perform("copy")}
          >
            {busy === "copy" ? copy.loading : copy.copy}
          </button>
        ) : null}
        {share.progress !== "done" && share.capabilities.view ? (
          <button
            type="button"
            className="button-quiet small-button"
            disabled={Boolean(busy)}
            onClick={() => void perform("progress")}
          >
            {busy === "progress" ? copy.loading : copy.markReviewed}
          </button>
        ) : null}
      </div>
      {share.permission === "use" && !share.capabilities.copy ? (
        <p className={styles.help}>{copy.copyUnavailable}</p>
      ) : null}
      {share.capabilities.manage ? (
        <div className={styles.secondaryActions}>
          <button
            className={styles.textButton}
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void perform("revoke")}
          >
            {copy.revoke}
          </button>
        </div>
      ) : null}
      {error ? (
        <p className="error" role="alert">
          {copy.failed}
        </p>
      ) : null}
    </>
  );
}
