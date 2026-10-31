"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  CANVAS_SCHEMA_VERSION,
  getCanvasTemplate,
  type CanvasBoardCreate,
  type CanvasTemplateId,
  type IdeaBoardCreate,
} from "@openround/contracts";
import { ApiClientError } from "../../lib/api";
import { createIdeaBoard, ideaBoardCreateIntent } from "../../lib/idea-board-client";
import { clientUuid } from "../../lib/uuid";
import { createCanvas } from "../canvas-boards/canvas-client";
import {
  readCanvasCreationSetup,
  removeCanvasCreationSetup,
  saveCanvasCreationSetup,
  CanvasCreationStorageError,
  canvasCreationSetupEpoch,
} from "../../lib/canvas-creation-storage";
import { canvasTemplateMessages } from "../../lib/i18n/canvas-template-messages";
import {
  finishWorkshopTemplate,
  parseWorkshopTemplateIntent,
  workshopTemplateIntent,
  type WorkshopTemplateIntent,
} from "./canvas-template-creation";
import { CanvasTemplateChooser } from "./canvas-template-chooser";
import { useBoardLibrary, type BoardLibraryScope } from "./use-board-library";
import { useLocale } from "../locale-provider";
import { useWorkspace } from "../workspace/workspace-provider";
import { WorkspaceShell } from "../workspace/workspace-shell";
import styles from "./boards.module.css";
import canvasStyles from "../canvas-boards/canvas.module.css";
import templateStyles from "./canvas-templates.module.css";

type Intent =
  | { kind: "team"; value: CanvasBoardCreate }
  | { kind: "workshop"; value: ReturnType<typeof ideaBoardCreateIntent> }
  | { kind: "template"; value: WorkshopTemplateIntent };
class SetupStorageError extends Error {}
const defaults: IdeaBoardCreate = {
  schemaVersion: 1,
  title: "",
  description: "",
  identityMode: "anonymous",
  moderationEnabled: true,
  voteBudget: 3,
  windowDays: 7,
  ideasVisible: false,
};

export function BoardLibrary() {
  const { t, locale } = useLocale();
  const copy = canvasTemplateMessages(locale);
  const router = useRouter();
  const { creator, canEdit, productFeatures } = useWorkspace();
  const workspaceId = creator?.workspaceId;
  const userId = creator?.userId;
  const contextKey = `${userId ?? ""}:${workspaceId ?? ""}`;
  const [scope, setScope] = useState<BoardLibraryScope>("all");
  const [search, setSearch] = useState("");
  const [input, setInput] = useState<IdeaBoardCreate>(defaults);
  const [kind, setKind] = useState<"team" | "workshop">("team");
  const [templateId, setTemplateId] = useState<CanvasTemplateId | null>(null);
  const [setupError, setSetupError] = useState<"storage" | "invalid" | "context" | null>(null);
  const [formContext, setFormContext] = useState(contextKey);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const pending = useRef<Intent | null>(null);
  const controller = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const currentContext = useRef(contextKey);
  currentContext.current = contextKey;
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useRef<HTMLInputElement>(null);
  const canCreate = canEdit && (productFeatures?.canvasBoards || productFeatures?.ideaBoards);
  const library = useBoardLibrary({
    workspaceId,
    scope,
    search,
    refresh,
    canvasEnabled: Boolean(productFeatures?.canvasBoards),
  });
  useEffect(() => {
    const active = new AbortController();
    controller.current = active;
    return () => active.abort();
  }, [contextKey]);
  useEffect(() => {
    pending.current = null;
    inFlight.current = false;
    setBusy(false);
    setError(false);
    setCreating(false);
    setInput(defaults);
    setTemplateId(null);
    setSetupError(null);
    setFormContext(contextKey);
    if (!userId || !workspaceId) return;
    try {
      const saved = readCanvasCreationSetup(userId, workspaceId);
      if (!saved) return;
      const value = parseWorkshopTemplateIntent(saved, userId, workspaceId);
      pending.current = { kind: "template", value };
      setInput({
        schemaVersion: 1,
        title: value.source.title,
        description: value.source.description,
        identityMode: value.source.identityMode,
        moderationEnabled: value.source.moderationEnabled,
        ideasVisible: value.source.ideasVisible,
        voteBudget: value.source.voteBudget,
        windowDays: value.source.windowDays,
      });
      setTemplateId(value.templateId);
      setKind("workshop");
      setCreating(true);
    } catch (caught) {
      // Block malformed stored inputs; unavailable storage still permits the blank workflow.
      if (!(caught instanceof CanvasCreationStorageError)) {
        setSetupError("invalid");
        setCreating(true);
      }
    }
  }, [contextKey, userId, workspaceId]);
  useEffect(() => {
    if (!creating || formContext !== contextKey) return;
    const previous = document.activeElement;
    const node = dialog.current;
    node?.showModal();
    title.current?.focus();
    return () => {
      node?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [creating, formContext, contextKey]);
  const current = library.data;
  const canvases = current?.canvases ?? [];
  const attachedSources = new Set(canvases.map((board) => board.sourceBoardId).filter(Boolean));
  const boards = current?.boards.filter((board) => !attachedSources.has(board.id)) ?? [];
  const templatePending =
    pending.current?.kind === "template" &&
    pending.current.value.userId === userId &&
    pending.current.value.workspaceId === workspaceId
      ? pending.current.value
      : null;

  function chooseTemplate(id: CanvasTemplateId | null) {
    setTemplateId(id);
    setSetupError(null);
    if (!id) {
      setInput(defaults);
      return;
    }
    const template = getCanvasTemplate(id);
    setInput({
      schemaVersion: 1,
      title: template.title,
      description: template.prompt,
      ...template.workshop,
    });
  }

  function keepWorkshop() {
    if (!userId || !workspaceId || !templatePending?.sourceBoardId || busy) return;
    try {
      removeCanvasCreationSetup(userId, workspaceId);
      const sourceId = templatePending.sourceBoardId;
      pending.current = null;
      setCreating(false);
      router.push(`/boards/${sourceId}`);
    } catch {
      setSetupError("storage");
    }
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    if (
      inFlight.current ||
      !workspaceId ||
      !userId ||
      setupError === "invalid" ||
      (!pending.current &&
        (!canCreate ||
          (kind === "team" ? !productFeatures?.canvasBoards : !productFeatures?.ideaBoards) ||
          (kind === "workshop" && templateId && !productFeatures?.canvasBoards)))
    )
      return;
    const newlyPrepared = pending.current === null;
    try {
      pending.current ??=
        kind === "team"
          ? {
              kind,
              value: {
                schemaVersion: CANVAS_SCHEMA_VERSION,
                workspaceId,
                title: input.title.trim(),
                boardType: "team",
                operationId: clientUuid(),
                ...(templateId ? { templateId } : {}),
              },
            }
          : templateId
            ? {
                kind: "template",
                value: workshopTemplateIntent(userId, workspaceId, input, templateId),
              }
            : { kind, value: ideaBoardCreateIntent(input) };
    } catch {
      setError(true);
      return;
    }
    const active = controller.current;
    const setupEpoch = canvasCreationSetupEpoch();
    inFlight.current = true;
    setBusy(true);
    setError(false);
    setSetupError(null);
    try {
      const intent = pending.current;
      const board =
        intent.kind === "team"
          ? await createCanvas(intent.value, active?.signal, { userId, workspaceId })
          : intent.kind === "template"
            ? await finishWorkshopTemplate(
                intent.value,
                (checkpoint) => {
                  if (
                    currentContext.current !== contextKey ||
                    active?.signal.aborted ||
                    setupEpoch !== canvasCreationSetupEpoch()
                  )
                    throw new DOMException("Creation interrupted", "AbortError");
                  try {
                    saveCanvasCreationSetup(userId, workspaceId, checkpoint);
                  } catch {
                    throw new SetupStorageError();
                  }
                },
                active?.signal,
              )
            : await createIdeaBoard(intent.value, active?.signal, { userId, workspaceId });
      if (
        currentContext.current === contextKey &&
        !active?.signal.aborted &&
        setupEpoch === canvasCreationSetupEpoch()
      ) {
        if (intent.kind === "template") {
          try {
            removeCanvasCreationSetup(userId, workspaceId);
          } catch {
            /* Exact retry stays safe. */
          }
        }
        pending.current = null;
        router.push((intent.kind === "workshop" ? "/boards/" : "/canvas/") + board.id);
      }
    } catch (caught) {
      if (
        !active?.signal.aborted &&
        currentContext.current === contextKey &&
        setupEpoch === canvasCreationSetupEpoch()
      ) {
        if (caught instanceof SetupStorageError) {
          setSetupError("storage");
          // The first checkpoint failed before any POST; blank creation remains available.
          if (
            newlyPrepared &&
            pending.current?.kind === "template" &&
            !pending.current.value.sourceBoardId
          )
            pending.current = null;
        } else if (
          caught instanceof ApiClientError &&
          (caught.code === "SETUP_CONTEXT_CHANGED" || caught.status === 401)
        ) {
          setSetupError("context");
        } else if (
          pending.current?.kind !== "template" &&
          caught instanceof ApiClientError &&
          caught.status < 500 &&
          caught.status !== 429
        )
          pending.current = null;
        setError(true);
      }
    } finally {
      if (controller.current === active) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <WorkspaceShell
      title={t("boards.title")}
      description={t("canvas.description")}
      requireBeta={false}
      translationLevel="full"
    >
      <div className={canvasStyles.libraryToolbar}>
        <label>
          {t("canvas.search")}
          <input
            type="search"
            maxLength={160}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        {canCreate ? (
          <button
            type="button"
            className="button"
            onClick={() => {
              if (!pending.current) setKind(productFeatures?.canvasBoards ? "team" : "workshop");
              setCreating(true);
            }}
          >
            {t("canvas.create")}
          </button>
        ) : null}
      </div>
      {templatePending && !creating ? (
        <aside className={templateStyles.recovery} role="status">
          <p>{templatePending.sourceBoardId ? copy.sourceCreated : copy.pending}</p>
          <button type="button" className="button-quiet" onClick={() => setCreating(true)}>
            {copy.retry}
          </button>
          {templatePending.sourceBoardId ? (
            <Link href={`/boards/${templatePending.sourceBoardId}`}>{copy.openSource}</Link>
          ) : null}
        </aside>
      ) : null}
      <div className={canvasStyles.filters} role="group" aria-label={t("boards.title")}>
        {(["all", "owned", "shared", "archived"] as const).map((value) => (
          <button
            type="button"
            className="button-quiet"
            key={value}
            aria-pressed={scope === value}
            disabled={busy}
            onClick={() => setScope(value)}
          >
            {t(("canvas." + value) as "canvas.all")}
          </button>
        ))}
      </div>
      {error || library.error ? (
        <p className="error" role="alert">
          {t("boards.error")}{" "}
          <button
            type="button"
            className="button-quiet"
            disabled={busy || library.busy}
            onClick={() => setRefresh((value) => value + 1)}
          >
            {t("boards.refresh")}
          </button>
        </p>
      ) : null}
      {!current && !error && !library.error ? <p role="status">{t("boards.loading")}</p> : null}
      {current && !canvases.length && !boards.length ? <p>{t("canvas.noBoards")}</p> : null}
      <ul className={canvasStyles.libraryGrid}>
        {canvases.map((board) => (
          <li className={canvasStyles.libraryCard} key={board.id}>
            <div className={canvasStyles.thumbnail} aria-hidden="true">
              <svg viewBox="0 0 320 140">
                <path d="M92 62L205 83" stroke="currentColor" strokeWidth="2" />
                <rect x="35" y="23" width="92" height="80" rx="6" fill="#fff1a8" />
                <rect x="190" y="49" width="90" height="65" rx="6" fill="#cde7ff" />
                <path d="M50 42h55M50 55h44M205 68h55M205 81h42" stroke="#48566b" strokeWidth="3" />
              </svg>
            </div>
            <Link href={"/canvas/" + board.id}>
              <strong lang="" dir="auto">
                {board.title}
              </strong>
            </Link>
            <p>
              {t(board.boardType === "team" ? "canvas.team" : "canvas.workshop")} ·{" "}
              {t(
                board.role === "owner"
                  ? "role.owner"
                  : (("canvas." + board.role) as "canvas.editor"),
              )}
            </p>
            <p className={styles.muted} lang="">
              {board.organizationName ? board.organizationName + " · " : ""}
              {board.workspaceName ?? ""}
            </p>
          </li>
        ))}
        {boards.map((board) => (
          <li className={canvasStyles.libraryCard} key={board.id}>
            <div className={canvasStyles.thumbnail} aria-hidden="true">
              <svg viewBox="0 0 320 140">
                <rect x="35" y="29" width="65" height="80" rx="6" fill="#ccebdc" />
                <rect x="127" y="29" width="65" height="80" rx="6" fill="#e5dcf8" />
                <rect x="219" y="29" width="65" height="80" rx="6" fill="#f9d9e4" />
                <path d="M48 48h38M140 48h38M232 48h38" stroke="#48566b" strokeWidth="3" />
              </svg>
            </div>
            <Link href={"/boards/" + board.id}>
              <strong lang="" dir="auto">
                {board.title}
              </strong>
            </Link>
            <p>
              {t("canvas.workshop")} · {t(("boards." + board.status) as "boards.collecting")}
            </p>
            <p className={styles.muted}>{t("boards.richTypes")}</p>
          </li>
        ))}
      </ul>
      {current?.nextCursor || current?.canvasNextCursor ? (
        <button
          type="button"
          className="button-quiet"
          disabled={busy || library.busy}
          onClick={() => void library.more()}
        >
          {t("boards.more")}
        </button>
      ) : null}
      {!productFeatures?.canvasBoards ? (
        <p className={styles.muted}>{t("canvas.creationPaused")}</p>
      ) : null}
      {creating && formContext === contextKey ? (
        <dialog
          ref={dialog}
          className={canvasStyles.dialog}
          aria-labelledby="new-board-heading"
          onCancel={(event) => {
            event.preventDefault();
            if (!busy) setCreating(false);
          }}
        >
          <header className={canvasStyles.dialogHeader}>
            <h2 id="new-board-heading">{t("canvas.create")}</h2>
            <button
              type="button"
              className="button-quiet"
              disabled={busy}
              onClick={() => setCreating(false)}
            >
              {pending.current ? copy.closePending : t("boards.cancel")}
            </button>
          </header>
          {error ? (
            <p className="error" role="alert">
              {t("boards.error")}
            </p>
          ) : null}
          {setupError ? (
            <div className={templateStyles.recovery} role="alert">
              <p>
                {
                  copy[
                    setupError === "storage"
                      ? "storageError"
                      : setupError === "context"
                        ? "contextError"
                        : "recoveryError"
                  ]
                }
              </p>
              {setupError === "invalid" ? (
                <button
                  type="button"
                  className="button-quiet"
                  onClick={() => {
                    if (!userId || !workspaceId) return;
                    try {
                      removeCanvasCreationSetup(userId, workspaceId);
                      setSetupError(null);
                    } catch {
                      setError(true);
                    }
                  }}
                >
                  {copy.discardSetup}
                </button>
              ) : null}
            </div>
          ) : null}
          {templatePending ? (
            <aside className={templateStyles.recovery} role="status">
              <p>{templatePending.sourceBoardId ? copy.sourceCreated : copy.pending}</p>
              {templatePending.sourceBoardId ? (
                <>
                  <Link href={`/boards/${templatePending.sourceBoardId}`}>{copy.openSource}</Link>
                  <button
                    type="button"
                    className="button-quiet"
                    disabled={busy}
                    onClick={keepWorkshop}
                  >
                    {copy.keepSource}
                  </button>
                </>
              ) : null}
              <button
                type="button"
                className="button-quiet"
                disabled={busy}
                onClick={() => setCreating(false)}
              >
                {copy.closePending}
              </button>
            </aside>
          ) : null}
          <form className={styles.form} onSubmit={(event) => void create(event)}>
            <fieldset
              className={styles.form}
              disabled={busy || pending.current !== null || setupError === "invalid"}
            >
              <div
                className={canvasStyles.typeChoices}
                role="group"
                aria-label={t("canvas.create")}
              >
                <button
                  type="button"
                  className="button-quiet"
                  aria-pressed={kind === "team"}
                  disabled={!productFeatures?.canvasBoards}
                  onClick={() => setKind("team")}
                >
                  {t("canvas.team")}
                </button>
                <button
                  type="button"
                  className="button-quiet"
                  aria-pressed={kind === "workshop"}
                  disabled={!productFeatures?.ideaBoards}
                  onClick={() => setKind("workshop")}
                >
                  {t("canvas.workshop")}
                </button>
              </div>
              {productFeatures?.canvasBoards ? (
                <CanvasTemplateChooser value={templateId} onChange={chooseTemplate} />
              ) : null}
              <label>
                {t("boards.boardTitle")}
                <input
                  ref={title}
                  required
                  maxLength={160}
                  value={input.title}
                  onChange={(event) => setInput({ ...input, title: event.target.value })}
                />
              </label>
              {kind === "workshop" ? (
                <>
                  <label>
                    {t("boards.prompt")}
                    <textarea
                      maxLength={2000}
                      value={input.description}
                      onChange={(event) => setInput({ ...input, description: event.target.value })}
                    />
                  </label>
                  <details>
                    <summary>{t("canvas.workshopSettings")}</summary>
                    <div className={styles.form}>
                      <label>
                        {t("boards.identity")}
                        <select
                          value={input.identityMode}
                          onChange={(event) =>
                            setInput({
                              ...input,
                              identityMode: event.target.value as "anonymous" | "alias",
                            })
                          }
                        >
                          <option value="anonymous">{t("boards.anonymous")}</option>
                          <option value="alias">{t("boards.alias")}</option>
                        </select>
                      </label>
                      <p className={styles.muted}>{t("boards.identityNote")}</p>
                      <label className={styles.check}>
                        <input
                          type="checkbox"
                          checked={input.moderationEnabled}
                          onChange={(event) =>
                            setInput({ ...input, moderationEnabled: event.target.checked })
                          }
                        />
                        {t("boards.moderation")}
                      </label>
                      <label className={styles.check}>
                        <input
                          type="checkbox"
                          checked={input.ideasVisible}
                          onChange={(event) =>
                            setInput({ ...input, ideasVisible: event.target.checked })
                          }
                        />
                        {t("boards.visible")}
                      </label>
                      <label>
                        {t("boards.budget")}
                        <input
                          type="number"
                          required
                          min={1}
                          max={10}
                          value={input.voteBudget}
                          onChange={(event) =>
                            setInput({ ...input, voteBudget: Number(event.target.value) })
                          }
                        />
                      </label>
                      <label>
                        {t("boards.days")}
                        <input
                          type="number"
                          required
                          min={1}
                          max={30}
                          value={input.windowDays}
                          onChange={(event) =>
                            setInput({ ...input, windowDays: Number(event.target.value) })
                          }
                        />
                      </label>
                    </div>
                  </details>
                </>
              ) : (
                <p>{t("canvas.shareScope")}</p>
              )}
            </fieldset>
            <button
              className="button"
              type="submit"
              disabled={busy || !input.title.trim() || setupError === "invalid"}
            >
              {t(pending.current ? "boards.retry" : "boards.create")}
            </button>
          </form>
        </dialog>
      ) : null}
    </WorkspaceShell>
  );
}
