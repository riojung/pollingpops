"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "../locale-provider";
import { presentationStartCopy, localizedOutlineError } from "./presentation-start-copy";
import { AUTH_CHANGE_EVENT } from "../../lib/api";
import {
  createOutlineDraftCreation,
  initialOutlineDraftCreationState,
  outlineDraftTitle,
} from "../../lib/presentation-outline-start";
import { useWorkspace } from "./workspace-provider";
import styles from "./workspace-content.module.css";

type Controller = ReturnType<typeof createOutlineDraftCreation>;

export function PresentationOutlineStart() {
  const router = useRouter();
  const { locale, t } = useLocale();
  const copy = presentationStartCopy(locale);
  const { creator, canEdit, productFeatures } = useWorkspace();
  const userId = creator?.userId ?? "";
  const workspaceId = creator?.workspaceId ?? "";
  const actorKey = `${userId}:${workspaceId}`;
  const featureEnabled = productFeatures?.presentations === true;
  const [title, setTitle] = useState("");
  const [storedState, setState] = useState(initialOutlineDraftCreationState);
  const [authInvalid, setAuthInvalid] = useState(false);
  const controller = useRef<Controller | null>(null);
  const allowed = useRef(false);
  const currentActor = useRef(actorKey);
  const visibleActor = useRef(actorKey);
  currentActor.current = actorKey;
  const sameActor = visibleActor.current === actorKey;
  const state = sameActor ? storedState : initialOutlineDraftCreationState();
  allowed.current = Boolean(userId && workspaceId && canEdit && featureEnabled && !authInvalid);

  useEffect(() => {
    if (!userId || !workspaceId || authInvalid) return;
    visibleActor.current = actorKey;
    const session = createOutlineDraftCreation({
      actor: { userId, workspaceId },
      // Access storage inside the controller so a restricted browser displays recovery feedback.
      storage: {
        getItem: (key) => window.sessionStorage.getItem(key),
        setItem: (key, value) => window.sessionStorage.setItem(key, value),
        removeItem: (key) => window.sessionStorage.removeItem(key),
      },
      canEdit: () => allowed.current && currentActor.current === actorKey,
      onState: setState,
      onCreated: (id) => router.push(`/presentation/${id}?start=outline`),
    });
    controller.current = session;
    setTitle("");
    session.restore();
    const authChanged = () => {
      allowed.current = false;
      session.cancel();
      setAuthInvalid(true);
      setTitle("");
      setState({
        ...initialOutlineDraftCreationState(),
        error: "Your sign-in changed. Reload before creating or opening a draft.",
      });
    };
    window.addEventListener(AUTH_CHANGE_EVENT, authChanged);
    return () => {
      session.cancel();
      window.removeEventListener(AUTH_CHANGE_EVENT, authChanged);
    };
  }, [userId, workspaceId, actorKey, canEdit, featureEnabled, authInvalid, router]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    await controller.current?.create(title);
  }
  const disabled = !allowed.current || !state.ready || state.busy;
  const recovery = state.recovery;
  const localError = localizedOutlineError(state.error, copy);
  return (
    <section className={styles.panel} lang={locale} aria-labelledby="outline-start-title">
      <p className="eyebrow">{copy.optionalAI}</p>
      <h2 id="outline-start-title">{copy.startOutline}</h2>
      <p>{copy.outlineDescription}</p>
      <p>{copy.outlinePrivacy}</p>
      {!canEdit ? <p role="status">{copy.editorRequired}</p> : null}
      {state.error ? (
        <div className="error" role="alert">
          <p>{localError ?? copy.requestError}</p>
          {!localError ? (
            <details>
              <summary>{copy.details}</summary>
              <p lang="en-CA">{state.error}</p>
            </details>
          ) : null}
        </div>
      ) : null}
      {!state.ready && !authInvalid ? (
        <>
          <p role="status">{state.error ? copy.recoverStorage : copy.checkingRecovery}</p>
          {state.error ? (
            <button
              className="button-quiet"
              type="button"
              onClick={() => controller.current?.restore()}
            >
              {copy.retryRecovery}
            </button>
          ) : null}
        </>
      ) : recovery ? (
        <div className={styles.blankForm}>
          <p role="status">
            {recovery.presentationId
              ? copy.savedDraft.replace("{title}", outlineDraftTitle(recovery))
              : recovery.deleted
                ? copy.deletedDraft
                : copy.pendingDraft}
          </p>
          <label className="field">
            <span>{t("delivery.presentationBuilder.titleLabel")}</span>
            <input className="input" lang="" value={outlineDraftTitle(recovery)} readOnly />
          </label>
          <div className="button-row">
            {recovery.presentationId || recovery.deleted ? (
              <>
                {recovery.presentationId ? (
                  <button
                    className="button"
                    type="button"
                    disabled={disabled}
                    onClick={() => controller.current?.openSaved()}
                  >
                    {copy.openDraft}
                  </button>
                ) : null}
                <button
                  className="button-quiet"
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    if (controller.current?.startAnother()) setTitle("");
                  }}
                >
                  {copy.startAnother}
                </button>
              </>
            ) : (
              <button
                className="button"
                type="button"
                disabled={disabled}
                onClick={() => void controller.current?.retry()}
              >
                {state.busy ? copy.creatingDraft : copy.retryDraft}
              </button>
            )}
          </div>
        </div>
      ) : state.ready ? (
        <form className={styles.blankForm} onSubmit={(event) => void submit(event)}>
          <label className="field">
            <span>{t("delivery.presentationBuilder.titleLabel")}</span>
            <input
              className="input"
              lang=""
              required
              maxLength={160}
              value={sameActor ? title : ""}
              disabled={disabled}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <div>
            <button className="button" type="submit" disabled={disabled || !title.trim()}>
              {copy.createDraft}
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
