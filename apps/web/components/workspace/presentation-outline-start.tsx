"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
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
  return (
    <section className={styles.panel} lang="en-CA" aria-labelledby="outline-start-title">
      <p className="eyebrow">Optional AI assistance</p>
      <h2 id="outline-start-title">Start from an outline</h2>
      <p>
        Create a saved draft first, then add your outline and review 3–8 proposed slides in the
        editor. Creating this draft does not use an AI job. Generation uses the allowance shown in
        the editor. Your draft stays in your Library if you cancel or generation fails.
      </p>
      <p>
        Only the outline you submit in the editor is sent for generation. Nothing is published
        automatically.
      </p>
      {!canEdit ? <p role="status">An owner or editor is required to create a draft.</p> : null}
      {state.error ? (
        <p className="error" role="alert">
          {state.error}
        </p>
      ) : null}
      {!state.ready && !authInvalid ? (
        <>
          <p role="status">
            {state.error
              ? "Recover tab storage before creating a draft."
              : "Checking draft recovery…"}
          </p>
          {state.error ? (
            <button
              className="button-quiet"
              type="button"
              onClick={() => controller.current?.restore()}
            >
              Retry tab recovery
            </button>
          ) : null}
        </>
      ) : recovery ? (
        <div className={styles.blankForm}>
          <p role="status">
            {recovery.presentationId
              ? `Your saved draft “${outlineDraftTitle(recovery)}” is ready. Open it to continue, or explicitly start another.`
              : recovery.deleted
                ? "The draft from this request was deleted. Start another explicitly to create a new draft."
                : "Draft creation is awaiting acknowledgement. Retry the saved request before changing its title or starting another."}
          </p>
          <label className="field">
            <span>Presentation title</span>
            <input className="input" value={outlineDraftTitle(recovery)} readOnly />
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
                    Open saved draft
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
                  Start another
                </button>
              </>
            ) : (
              <button
                className="button"
                type="button"
                disabled={disabled}
                onClick={() => void controller.current?.retry()}
              >
                {state.busy ? "Creating draft…" : "Retry draft creation"}
              </button>
            )}
          </div>
        </div>
      ) : state.ready ? (
        <form className={styles.blankForm} onSubmit={(event) => void submit(event)}>
          <label className="field">
            <span>Presentation title</span>
            <input
              className="input"
              required
              maxLength={160}
              value={sameActor ? title : ""}
              disabled={disabled}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <div>
            <button className="button" type="submit" disabled={disabled || !title.trim()}>
              Create draft and continue
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
