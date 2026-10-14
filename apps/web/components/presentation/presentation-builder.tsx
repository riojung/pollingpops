"use client";

import { isTextQuestion } from "../../lib/text-response";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type SetStateAction,
} from "react";
import {
  InsertRecoveryPackIntoPresentationSchema,
  ApplyPresentationRecoveryPackUpdateSchema,
  PresentationRecoveryPackUpdatePreviewSchema,
  resolveContentSlideFrames,
  regionForContentSlideFrame,
  type ContentSlideFrame,
  type ContentSlideLayout,
  type ContentSlideRegion,
  type PresentationBlockDraft,
  type PresentationDraft,
  type QuestionDraft,
  type QuestionType,
  type ApplyPresentationRecoveryPackUpdate,
  type PresentationRecoveryPackUpdatePreview,
} from "@openround/contracts";
import { ApiClientError, apiFetch, humanError } from "../../lib/api";
import {
  clearBuilderRecovery,
  loadBuilderRecovery,
  saveBuilderRecovery,
  type BuilderRecoverySnapshot,
} from "../../lib/builder-recovery";
import { formatDateTime } from "../../lib/i18n/format";
import {
  addContentTextElement,
  applyContentSlideLayout,
  changePresentationQuestionType,
  contentSlideTitle,
  createContentBlock,
  createContentTextElement,
  createQuestionBlock,
  duplicatePresentationBlock,
  movePresentationBlock,
  moveContentTextElement,
  normalizePresentationRecoveryDraft,
  presentationReadiness,
  removeContentTextElement,
  reorderContentTextElement,
  setContentTextElementFrame,
  setContentSlideMedia,
  removePresentationBlock,
  updateContentTextElement,
} from "../../lib/presentation-builder";
import { RecoverableOperationQueue } from "../../lib/recoverable-operation-queue";
import { isRetryableSaveError, retryWithBackoff } from "../../lib/retry";
import {
  presentationPackDraftIsCurrent,
  presentationPackSelectedBlock,
} from "../../lib/presentation-pack-update-ui";
import { AuthoringAssistant } from "../authoring-assistant";
import { ResponseEditor } from "../editor/response-editor";
import { MediaEditor } from "../editor/media-editor";
import type { RecoveryPackUpdateUndo } from "../editor/recovery-pack-update-panel";
import { ContentSlideView, contentSlideRegionLabels } from "./content-slide-view";
import { isChoiceQuestion } from "../editor/types";
import { useLocale } from "../locale-provider";
import { questionTypeOptions, responseTypeLabel } from "../workspace/workspace-model";
import { multipleSelectionPoll } from "../../lib/participant-response";
import { recordAuthoringEvent } from "../workspace/product-events";
import { useWorkspace } from "../workspace/workspace-provider";
import {
  RecoveryPackPresentationPicker,
  RecoveryPackPresentationReferences,
} from "./recovery-pack-insertion";
import {
  PresentationRecoveryPackUpdateReview,
  type PresentationRecoveryPackUpdateApplied,
} from "./recovery-pack-update-review";
import styles from "./presentation-builder.module.css";

interface PresentationRecord {
  id: string;
  title: string;
  description: string;
  status: "draft" | "published" | "archived";
  draft: PresentationDraft;
  draftRevision: number;
  currentVersionId: string | null;
  updatedAt: string;
  hasUnpublishedChanges: boolean;
}

interface RoundSource {
  id: string;
  title: string;
  currentVersionId: string | null;
}

interface PublishedRoundQuestionSource {
  versionId: string;
  questions: QuestionDraft[];
}

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error" | "conflict";
type InspectorTab =
  | "build"
  | "diagnose"
  | "recover"
  | "content"
  | "layout"
  | "media"
  | "notes"
  | "accessibility"
  | "readiness";

const HISTORY_LIMIT = 40;
const TEXT_EDIT_COALESCE_MS = 750;
const slideLayouts: Array<{ id: ContentSlideLayout; label: string }> = [
  { id: "title", label: "Title" },
  { id: "title_body", label: "Title + body" },
  { id: "media", label: "Media" },
  { id: "quote", label: "Quote" },
  { id: "section", label: "Section" },
  { id: "callout", label: "Callout" },
];
const questionTypeMessageKeys = {
  single_select: "delivery.builder.type.single_select",
  true_false: "delivery.builder.type.true_false",
  multi_select: "delivery.builder.type.multi_select",
  numeric: "delivery.builder.type.numeric",
  rating: "delivery.builder.type.rating",
  poll: "delivery.builder.type.poll",
  ranking: "delivery.builder.type.ranking",
  open_text: "delivery.builder.type.open_text",
  word_cloud: "delivery.builder.type.word_cloud",
} as const satisfies Record<QuestionType, string>;

function updateBlock(
  draft: PresentationDraft,
  blockId: string,
  updater: (block: PresentationBlockDraft) => PresentationBlockDraft,
) {
  return {
    ...draft,
    blocks: draft.blocks.map((block) => (block.id === blockId ? updater(block) : block)),
  };
}

const modalFocusable =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusModal(container: HTMLElement | null) {
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const first = container?.querySelector<HTMLElement>(modalFocusable) ?? container;
  first?.focus();
  return () => previous?.focus();
}

function handleModalKeyDown(event: KeyboardEvent<HTMLElement>, onClose: () => void) {
  if (event.key === "Escape") {
    event.preventDefault();
    onClose();
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>(modalFocusable)].filter(
    (element) => element.offsetParent !== null,
  );
  if (focusable.length === 0) {
    event.preventDefault();
    event.currentTarget.focus();
    return;
  }
  const first = focusable[0]!;
  const last = focusable.at(-1)!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function AuthenticatedMedia({ mediaId, altText }: { mediaId: string; altText: string | null }) {
  const [source, setSource] = useState("");
  useEffect(() => {
    let active = true;
    void apiFetch<{ downloadUrl: string }>(`/v1/media/${mediaId}`)
      .then(({ downloadUrl }) => {
        if (active) setSource(downloadUrl);
      })
      .catch(() => {
        if (active) setSource("");
      });
    return () => {
      active = false;
    };
  }, [mediaId]);
  return source ? (
    <img alt={altText ?? ""} className={styles.builderMedia} lang="" src={source} />
  ) : (
    <div className={styles.mediaPlaceholder} lang="en-CA" role="status">
      Loading instructional image…
    </div>
  );
}

function PresentationPreview({
  draft,
  onClose,
}: {
  draft: PresentationDraft;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const block = draft.blocks[index];
  useEffect(() => focusModal(dialogRef.current), []);
  return (
    <div
      ref={dialogRef}
      className={styles.previewBackdrop}
      role="dialog"
      aria-modal="true"
      aria-label="Presentation preview"
      lang="en-CA"
      onKeyDown={(event) => handleModalKeyDown(event, onClose)}
      tabIndex={-1}
    >
      <div className={styles.previewStage}>
        <div className={styles.previewBar}>
          <strong lang={draft.title ? "" : "en-CA"}>
            {draft.title || "Untitled presentation"}
          </strong>
          <span>{draft.blocks.length ? `${index + 1} / ${draft.blocks.length}` : "No slides"}</span>
          <button className={styles.iconButton} onClick={onClose} type="button">
            Close preview
          </button>
        </div>
        <div className={styles.previewCanvas}>
          {!block ? (
            <p>Add a slide to preview this presentation.</p>
          ) : block.kind === "content" ? (
            <ContentSlideView
              block={block}
              media={
                block.mediaId ? (
                  <AuthenticatedMedia altText={block.mediaAlt} mediaId={block.mediaId} />
                ) : undefined
              }
              variant="preview"
            />
          ) : (
            <article className={styles.previewQuestion}>
              <span className={styles.previewEyebrow}>Audience question</span>
              <h1 lang={block.question.prompt ? "" : "en-CA"}>
                {block.question.prompt || "Untitled question"}
              </h1>
              {"choices" in block.question ? (
                <div className={styles.previewChoices}>
                  {block.question.choices.map((choice, choiceIndex) => (
                    <div key={choice.id}>
                      <span>{String.fromCharCode(65 + choiceIndex)}</span>
                      <span lang={choice.label ? "" : "en-CA"}>
                        {choice.label || `Answer ${choiceIndex + 1}`}
                      </span>
                    </div>
                  ))}
                </div>
              ) : block.question.type === "numeric" ? (
                <div className={styles.previewAnswer}>Participants enter a number</div>
              ) : block.question.type === "rating" ? (
                <div className={styles.previewAnswer}>
                  {block.question.min} — {block.question.max}
                </div>
              ) : (
                <p>This response format is available in live Rounds only.</p>
              )}
            </article>
          )}
        </div>
        <div className={styles.previewControls}>
          <button
            disabled={index === 0}
            onClick={() => setIndex((value) => value - 1)}
            type="button"
          >
            Previous
          </button>
          <button
            disabled={index >= draft.blocks.length - 1}
            onClick={() => setIndex((value) => value + 1)}
            type="button"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

export function PresentationBuilder({ presentationId }: { presentationId: string }) {
  const { creator, error, refreshAccount } = useWorkspace();
  const [retryingAccount, setRetryingAccount] = useState(false);
  const { t } = useLocale();
  return creator ? (
    <PresentationEditor
      key={`${creator.workspaceId}:${presentationId}`}
      presentationId={presentationId}
    />
  ) : (
    <main className={styles.loading}>
      <div className={styles.loadingMark} aria-hidden="true" />
      <p lang={error ? "en-CA" : undefined} role={error ? "alert" : "status"}>
        {error || t("delivery.presentationBuilder.opening")}
      </p>
      {error ? (
        <button
          disabled={retryingAccount}
          lang="en-CA"
          onClick={() => {
            setRetryingAccount(true);
            void refreshAccount().finally(() => setRetryingAccount(false));
          }}
          type="button"
        >
          {retryingAccount ? "Retrying workspace…" : "Retry workspace"}
        </button>
      ) : null}
    </main>
  );
}

function PresentationEditor({ presentationId }: { presentationId: string }) {
  const { canEdit, productFeatures } = useWorkspace();
  const { locale, t } = useLocale();
  const router = useRouter();
  const recoveryKey = `presentation:${presentationId}`;
  const [record, setRecord] = useState<PresentationRecord | null>(null);
  const [draft, setDraft] = useState<PresentationDraft | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [selectedTextElementId, setSelectedTextElementId] = useState<string | null>(null);
  const [showLayoutGuides, setShowLayoutGuides] = useState(true);
  const [mapOpen, setMapOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("build");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [recovery, setRecovery] = useState<BuilderRecoverySnapshot<PresentationDraft> | null>(null);
  const [undoStack, setUndoStack] = useState<PresentationDraft[]>([]);
  const [redoStack, setRedoStack] = useState<PresentationDraft[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [roundSources, setRoundSources] = useState<RoundSource[]>([]);
  const [roundImportOpen, setRoundImportOpen] = useState(false);
  const [sourceImportOpen, setSourceImportOpen] = useState(false);
  const [selectedRoundId, setSelectedRoundId] = useState("");
  const [publishedRound, setPublishedRound] = useState<PublishedRoundQuestionSource | null>(null);
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<string[]>([]);
  const [importingQuestions, setImportingQuestions] = useState(false);
  const [preparingImport, setPreparingImport] = useState(false);
  const importPreparation = useRef(false);
  const [mediaUploadsEnabled, setMediaUploadsEnabled] = useState(false);
  const [mediaState, setMediaState] = useState<"idle" | "uploading" | "scanning">("idle");
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState("");
  const [packImportOpen, setPackImportOpen] = useState(false);
  const [packBusy, setPackBusy] = useState(false);
  const [packError, setPackError] = useState("");
  const [packRetryVersionId, setPackRetryVersionId] = useState<string | null>(null);
  const packOperation = useRef(false);
  const packPending = useRef<{ body: string; draftJson: string; versionId: string } | null>(null);
  const [packUpdateBusy, setPackUpdateBusy] = useState(false);
  const [packUpdateReceiptPending, setPackUpdateReceiptPending] = useState(false);
  const packUpdateOperation = useRef(false);
  const packUpdatePending = useRef<{
    path: string;
    body: string;
    draftJson: string;
    expectedRevision: number;
  } | null>(null);
  const alive = useRef(true);
  const revisionRef = useRef(0);
  const lastSavedJson = useRef("");
  const latestDraftJson = useRef("");
  const saveQueue = useRef(new RecoverableOperationQueue());
  const lastHistoryCommit = useRef<{ key: string; at: number } | null>(null);
  const roundImportDialogRef = useRef<HTMLDivElement>(null);
  const sourceImportDialogRef = useRef<HTMLDivElement>(null);
  const firstBlockTracked = useRef(false);
  const previousBlockCount = useRef<number | null>(null);
  const canInsertPack =
    canEdit && Boolean(productFeatures?.presentations && productFeatures?.recoveryPacks);
  const builderMutationBlocked = packImportOpen || packUpdateBusy || packUpdateReceiptPending;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const selectedBlock = draft?.blocks.find((block) => block.id === selectedBlockId) ?? null;
  const selectedTextElement =
    selectedBlock?.kind === "content"
      ? (selectedBlock.textElements.find((element) => element.id === selectedTextElementId) ?? null)
      : null;
  const selectedTextFrame =
    selectedBlock?.kind === "content" && selectedTextElement
      ? resolveContentSlideFrames(selectedBlock)[selectedTextElement.id]
      : null;
  const selectedMediaId =
    selectedBlock?.kind === "content"
      ? selectedBlock.mediaId
      : selectedBlock?.kind === "question"
        ? selectedBlock.question.mediaId
        : null;
  const issues = useMemo(() => (draft ? presentationReadiness(draft) : []), [draft]);
  const issuesByBlock = useMemo(() => {
    const map = new Map<string, number>();
    for (const issue of issues) {
      if (issue.blockId) map.set(issue.blockId, (map.get(issue.blockId) ?? 0) + 1);
    }
    return map;
  }, [issues]);

  useEffect(() => {
    if (selectedBlock?.kind !== "content") {
      if (selectedTextElementId !== null) setSelectedTextElementId(null);
      return;
    }
    if (selectedBlock.textElements.some((element) => element.id === selectedTextElementId)) return;
    setSelectedTextElementId(
      selectedBlock.textElements.find((element) => element.role === "title")?.id ??
        selectedBlock.textElements[0]?.id ??
        null,
    );
  }, [selectedBlock, selectedTextElementId]);

  useEffect(() => {
    firstBlockTracked.current = false;
    previousBlockCount.current = null;
    let active = true;
    void Promise.all([
      apiFetch<{ presentation: PresentationRecord }>(`/v1/presentations/${presentationId}`),
      loadBuilderRecovery<unknown>(recoveryKey),
    ])
      .then(([response, local]) => {
        if (!active) return;
        setRecord(response.presentation);
        previousBlockCount.current = response.presentation.draft.blocks.length;
        firstBlockTracked.current = response.presentation.draft.blocks.length > 0;
        setDraft(response.presentation.draft);
        setSelectedBlockId(response.presentation.draft.blocks[0]?.id ?? null);
        revisionRef.current = response.presentation.draftRevision;
        lastSavedJson.current = JSON.stringify(response.presentation.draft);
        latestDraftJson.current = lastSavedJson.current;
        if (local) {
          try {
            const localDraft = normalizePresentationRecoveryDraft(local.draft);
            if (JSON.stringify(localDraft) !== lastSavedJson.current) {
              setRecovery({ ...local, draft: localDraft });
            }
          } catch {
            setError(
              "The saved local copy could not be restored. Your saved presentation is available.",
            );
          }
        }
        setLoaded(true);
      })
      .catch((caught) => {
        if ((caught as { status?: number }).status === 401) router.replace("/signin");
        else setError(humanError(caught));
      });
    return () => {
      active = false;
    };
  }, [presentationId, recoveryKey, router]);

  useEffect(() => {
    if (!loaded || !draft) return;
    const count = draft.blocks.length;
    if (!firstBlockTracked.current && previousBlockCount.current === 0 && count > 0) {
      firstBlockTracked.current = true;
      recordAuthoringEvent("first_block_created", "presentation");
    }
    previousBlockCount.current = count;
  }, [draft, loaded]);

  useEffect(() => {
    void apiFetch<{ quizzes: RoundSource[] }>("/v1/quizzes")
      .then(({ quizzes }) => setRoundSources(quizzes.filter((quiz) => quiz.currentVersionId)))
      .catch(() => setRoundSources([]));
  }, []);

  useEffect(() => {
    if (!roundImportOpen) return;
    return focusModal(roundImportDialogRef.current);
  }, [roundImportOpen]);

  useEffect(() => {
    if (!sourceImportOpen) return;
    return focusModal(sourceImportDialogRef.current);
  }, [sourceImportOpen]);

  useEffect(() => {
    void apiFetch<{ mediaUploads: boolean }>("/v1/features")
      .then(({ mediaUploads }) => setMediaUploadsEnabled(mediaUploads))
      .catch(() => setMediaUploadsEnabled(false));
  }, []);

  useEffect(() => {
    if (!selectedMediaId) {
      setMediaPreviewUrl("");
      return;
    }
    let active = true;
    void apiFetch<{ downloadUrl: string }>(`/v1/media/${selectedMediaId}`)
      .then(({ downloadUrl }) => {
        if (active) setMediaPreviewUrl(downloadUrl);
      })
      .catch(() => {
        if (active) setMediaPreviewUrl("");
      });
    return () => {
      active = false;
    };
  }, [selectedMediaId]);

  useEffect(() => {
    if (!selectedBlock) return;
    const contentTabs: InspectorTab[] = [
      "content",
      "layout",
      "media",
      "notes",
      "accessibility",
      "readiness",
    ];
    const questionTabs: InspectorTab[] = ["build", "diagnose", "recover", "readiness"];
    if (selectedBlock.kind === "content" && !contentTabs.includes(inspectorTab)) {
      setInspectorTab("content");
    }
    if (selectedBlock.kind === "question" && !questionTabs.includes(inspectorTab)) {
      setInspectorTab("build");
    }
  }, [inspectorTab, selectedBlock]);

  useEffect(() => {
    if (!selectedRoundId) {
      setPublishedRound(null);
      setSelectedQuestionIds([]);
      return;
    }
    let active = true;
    void apiFetch<{
      quiz: RoundSource;
      currentVersion: { id: string; content: { questions: QuestionDraft[] } } | null;
    }>(`/v1/quizzes/${selectedRoundId}`)
      .then(({ currentVersion }) => {
        if (!active) return;
        setPublishedRound(
          currentVersion
            ? { versionId: currentVersion.id, questions: currentVersion.content.questions }
            : null,
        );
        setSelectedQuestionIds([]);
      })
      .catch((caught) => {
        if (active) setError(humanError(caught));
      });
    return () => {
      active = false;
    };
  }, [selectedRoundId]);

  const commit = useCallback(
    (value: SetStateAction<PresentationDraft>, historyKey?: string) => {
      if (
        packOperation.current ||
        packPending.current ||
        packUpdateOperation.current ||
        packUpdatePending.current
      )
        return;
      setDraft((current) => {
        if (!current) return current;
        const next = typeof value === "function" ? value(current) : value;
        if (next === current || JSON.stringify(next) === JSON.stringify(current)) return current;
        const now = Date.now();
        const previousHistoryCommit = lastHistoryCommit.current;
        const coalescesWithPreviousEdit =
          historyKey !== undefined &&
          previousHistoryCommit?.key === historyKey &&
          now - previousHistoryCommit.at <= TEXT_EDIT_COALESCE_MS;
        if (!coalescesWithPreviousEdit) {
          setUndoStack((history) => [...history, current].slice(-HISTORY_LIMIT));
        }
        lastHistoryCommit.current = historyKey ? { key: historyKey, at: now } : null;
        setRedoStack([]);
        latestDraftJson.current = JSON.stringify(next);
        setSaveState("dirty");
        void saveBuilderRecovery(recoveryKey, revisionRef.current, next).catch(() => undefined);
        return next;
      });
    },
    [recoveryKey],
  );

  const enqueueSave = useCallback(
    (candidate: PresentationDraft): Promise<void> => {
      const serialized = JSON.stringify(candidate);
      if (serialized === lastSavedJson.current) return Promise.resolve();
      const mutationId = crypto.randomUUID();
      setSaveState("saving");
      void saveBuilderRecovery(recoveryKey, revisionRef.current, candidate).catch(() => undefined);
      const queued = saveQueue.current.enqueue(async () => {
        const response = await retryWithBackoff(() =>
          apiFetch<{ presentation: PresentationRecord }>(
            `/v1/presentations/${presentationId}/draft`,
            {
              method: "PUT",
              body: JSON.stringify({
                draft: candidate,
                expectedRevision: revisionRef.current,
                mutationId,
                schemaVersion: 2,
              }),
            },
          ),
        );
        revisionRef.current = response.presentation.draftRevision;
        lastSavedJson.current = serialized;
        setRecord(response.presentation);
        setSaveState("saved");
        setError("");
        if (latestDraftJson.current === serialized) {
          await clearBuilderRecovery(recoveryKey).catch(() => undefined);
        }
      });
      void queued.catch((caught) => {
        const conflict =
          caught instanceof ApiClientError &&
          (caught.code === "STALE_DRAFT" || caught.status === 409 || caught.status === 412);
        recordAuthoringEvent(conflict ? "draft_conflict" : "draft_save_failed", "presentation");
        setSaveState(conflict ? "conflict" : "error");
        setError(humanError(caught));
      });
      return queued;
    },
    [presentationId, recoveryKey],
  );

  useEffect(() => {
    if (!loaded || !draft || packImportOpen || packUpdateBusy || packUpdateReceiptPending) return;
    const serialized = JSON.stringify(draft);
    if (serialized === lastSavedJson.current) return;
    setSaveState("dirty");
    const timer = window.setTimeout(() => void enqueueSave(draft), 700);
    return () => window.clearTimeout(timer);
  }, [draft, enqueueSave, loaded, packImportOpen, packUpdateBusy, packUpdateReceiptPending]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (
        saveState === "dirty" ||
        saveState === "saving" ||
        saveState === "error" ||
        saveState === "conflict" ||
        packPending.current !== null ||
        packUpdatePending.current !== null
      ) {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saveState, packRetryVersionId, packUpdateReceiptPending]);

  function guardBuilderExit(event: MouseEvent<HTMLAnchorElement>) {
    if (!draft) return;
    const needsRecovery =
      latestDraftJson.current !== lastSavedJson.current ||
      saveState === "dirty" ||
      saveState === "saving" ||
      saveState === "error" ||
      saveState === "conflict";
    if (!needsRecovery) return;
    void saveBuilderRecovery(recoveryKey, revisionRef.current, draft).catch(() => undefined);
    if (
      !window.confirm(
        "This Presentation still has changes that are pending, failed, or conflicted. A recovery copy has been kept on this device. Leave the Builder?",
      )
    ) {
      event.preventDefault();
    }
  }

  function moveInspectorTab(event: KeyboardEvent<HTMLDivElement>) {
    const currentIndex = inspectorTabs.findIndex(({ id }) => id === inspectorTab);
    const nextIndex =
      event.key === "ArrowRight"
        ? (currentIndex + 1) % inspectorTabs.length
        : event.key === "ArrowLeft"
          ? (currentIndex - 1 + inspectorTabs.length) % inspectorTabs.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? inspectorTabs.length - 1
              : null;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = inspectorTabs[nextIndex];
    if (!next) return;
    setInspectorTab(next.id);
    window.requestAnimationFrame(() =>
      document.getElementById(`inspector-tab-${next.id}`)?.focus(),
    );
  }

  function updateSelected(
    updater: (block: PresentationBlockDraft) => PresentationBlockDraft,
    historyField?: string,
  ) {
    if (!selectedBlockId) return;
    commit(
      (current) => updateBlock(current, selectedBlockId, updater),
      historyField ? `${selectedBlockId}:${historyField}` : undefined,
    );
  }

  function updateQuestion(
    updater: (question: QuestionDraft) => QuestionDraft,
    historyField?: string,
  ) {
    updateSelected(
      (block) =>
        block.kind === "question" ? { ...block, question: updater(block.question) } : block,
      historyField ? `question:${historyField}` : undefined,
    );
  }

  function addTextBox() {
    if (selectedBlock?.kind !== "content" || selectedBlock.textElements.length >= 8) return;
    const element = createContentTextElement();
    updateSelected((block) =>
      block.kind === "content" ? addContentTextElement(block, element) : block,
    );
    setSelectedTextElementId(element.id);
    setInspectorTab("content");
  }

  function changeTextElement(elementId: string, text: string) {
    updateSelected(
      (block) =>
        block.kind === "content"
          ? updateContentTextElement(block, elementId, (element) => ({ ...element, text }))
          : block,
      `text:${elementId}`,
    );
  }

  function moveTextElement(elementId: string, region: ContentSlideRegion) {
    updateSelected((block) =>
      block.kind === "content" ? moveContentTextElement(block, elementId, region) : block,
    );
    setSelectedTextElementId(elementId);
  }

  function changeTextFrame(elementId: string, frame: ContentSlideFrame, historyField?: string) {
    updateSelected(
      (block) =>
        block.kind === "content" ? setContentTextElementFrame(block, elementId, frame) : block,
      historyField,
    );
    setSelectedTextElementId(elementId);
  }

  function deleteSelectedTextBox() {
    if (selectedBlock?.kind !== "content" || !selectedTextElement) return;
    if (selectedTextElement.role === "title") return;
    const remaining = selectedBlock.textElements.filter(
      (element) => element.id !== selectedTextElement.id,
    );
    const index = selectedBlock.textElements.findIndex(
      (element) => element.id === selectedTextElement.id,
    );
    updateSelected((block) =>
      block.kind === "content" ? removeContentTextElement(block, selectedTextElement.id) : block,
    );
    setSelectedTextElementId(remaining[Math.min(index, remaining.length - 1)]?.id ?? null);
  }

  function addBlock(block: PresentationBlockDraft) {
    commit((current) => {
      const selectedIndex = current.blocks.findIndex((item) => item.id === selectedBlockId);
      const blocks = [...current.blocks];
      blocks.splice(selectedIndex < 0 ? blocks.length : selectedIndex + 1, 0, block);
      return { ...current, blocks };
    });
    setSelectedBlockId(block.id);
    setInspectorTab(block.kind === "content" ? "content" : "build");
  }

  function undo() {
    if (
      packOperation.current ||
      packPending.current ||
      packUpdateOperation.current ||
      packUpdatePending.current
    )
      return;
    const previous = undoStack.at(-1);
    if (!previous || !draft) return;
    setRedoStack((history) => [...history, draft].slice(-HISTORY_LIMIT));
    setUndoStack((history) => history.slice(0, -1));
    lastHistoryCommit.current = null;
    setDraft(previous);
    latestDraftJson.current = JSON.stringify(previous);
    setSaveState("dirty");
    void saveBuilderRecovery(recoveryKey, revisionRef.current, previous).catch(() => undefined);
    if (!previous.blocks.some((block) => block.id === selectedBlockId)) {
      setSelectedBlockId(previous.blocks[0]?.id ?? null);
    }
  }

  function redo() {
    if (
      packOperation.current ||
      packPending.current ||
      packUpdateOperation.current ||
      packUpdatePending.current
    )
      return;
    const next = redoStack.at(-1);
    if (!next || !draft) return;
    setUndoStack((history) => [...history, draft].slice(-HISTORY_LIMIT));
    setRedoStack((history) => history.slice(0, -1));
    lastHistoryCommit.current = null;
    setDraft(next);
    latestDraftJson.current = JSON.stringify(next);
    setSaveState("dirty");
    void saveBuilderRecovery(recoveryKey, revisionRef.current, next).catch(() => undefined);
  }

  async function reloadLatestDraft(preferredBlockId?: string) {
    setSaveState("saving");
    setError("");
    try {
      const response = await apiFetch<{ presentation: PresentationRecord }>(
        `/v1/presentations/${presentationId}`,
      );
      setRecord(response.presentation);
      setDraft(response.presentation.draft);
      setSelectedBlockId(
        preferredBlockId &&
          response.presentation.draft.blocks.some((block) => block.id === preferredBlockId)
          ? preferredBlockId
          : (response.presentation.draft.blocks[0]?.id ?? null),
      );
      setUndoStack([]);
      setRedoStack([]);
      lastHistoryCommit.current = null;
      revisionRef.current = response.presentation.draftRevision;
      lastSavedJson.current = JSON.stringify(response.presentation.draft);
      latestDraftJson.current = lastSavedJson.current;
      setSaveState("saved");
      await clearBuilderRecovery(recoveryKey);
    } catch (caught) {
      setError(humanError(caught));
      setSaveState("error");
    }
  }

  function preserveLocalCopy() {
    if (!draft) return;
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${draft.title.trim() || "untitled-presentation"}-local-copy.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function duplicateLocalDraft() {
    if (!draft) return;
    setError("");
    try {
      const title = `${draft.title.trim() || t("delivery.presentationBuilder.untitled")} — ${formatDateTime(locale, Date.now())}`;
      const created = await apiFetch<{ presentation: PresentationRecord }>("/v1/presentations", {
        method: "POST",
        body: JSON.stringify({ title, description: draft.description ?? "" }),
      });
      await apiFetch<{ presentation: PresentationRecord }>(
        `/v1/presentations/${created.presentation.id}/draft`,
        {
          method: "PUT",
          body: JSON.stringify({
            draft: { ...draft, title },
            expectedRevision: created.presentation.draftRevision,
            mutationId: crypto.randomUUID(),
            schemaVersion: 2,
          }),
        },
      );
      await clearBuilderRecovery(recoveryKey);
      router.push(`/presentation/${created.presentation.id}`);
    } catch (caught) {
      setError(humanError(caught));
    }
  }

  async function uploadSelectedImage(file: File | null) {
    if (!file || !selectedBlock || mediaState !== "idle") return;
    const altText =
      selectedBlock.kind === "content"
        ? selectedBlock.mediaAlt?.trim()
        : selectedBlock.question.mediaAlt?.trim();
    if (!altText) {
      setError("Describe the instructional image before uploading it.");
      return;
    }
    const blockId = selectedBlock.id;
    setError("");
    setMediaState("uploading");
    try {
      const ticket = await apiFetch<{
        mediaId: string;
        uploadUrl: string;
        scanStatus: "pending";
      }>("/v1/media", {
        method: "POST",
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          altText,
        }),
      });
      const uploaded = await fetch(ticket.uploadUrl, {
        method: "PUT",
        headers: { "content-type": file.type },
        body: file,
      });
      if (!uploaded.ok) throw new Error(`Image upload failed (${uploaded.status})`);
      setMediaState("scanning");
      const finalized = await apiFetch<{
        media: { id: string; scanStatus: "clean" | "rejected" };
        downloadUrl?: string;
      }>(`/v1/media/${ticket.mediaId}/complete`, { method: "POST", body: "{}" });
      if (finalized.media.scanStatus !== "clean" || !finalized.downloadUrl) {
        throw new Error("The image did not pass security validation.");
      }
      commit((current) =>
        updateBlock(current, blockId, (block) =>
          block.kind === "content"
            ? setContentSlideMedia(block, ticket.mediaId, altText)
            : {
                ...block,
                question: { ...block.question, mediaId: ticket.mediaId, mediaAlt: altText },
              },
        ),
      );
      setMediaPreviewUrl(finalized.downloadUrl);
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setMediaState("idle");
    }
  }

  function removeSelectedImage() {
    if (!selectedBlock) return;
    updateSelected((block) =>
      block.kind === "content"
        ? setContentSlideMedia(block, null, null)
        : { ...block, question: { ...block.question, mediaId: null, mediaAlt: null } },
    );
    setMediaPreviewUrl("");
  }

  function openRoundImport() {
    if (
      importPreparation.current ||
      packOperation.current ||
      packImportOpen ||
      sourceImportOpen ||
      packUpdateOperation.current ||
      packUpdatePending.current
    )
      return;
    const first = roundSources[0]?.id ?? "";
    setSelectedRoundId((current) => current || first);
    setRoundImportOpen(true);
    setError("");
  }

  async function openPackImport() {
    if (
      !draft ||
      !canInsertPack ||
      packOperation.current ||
      packUpdateOperation.current ||
      packUpdatePending.current ||
      importPreparation.current ||
      sourceImportOpen ||
      roundImportOpen ||
      mediaState !== "idle"
    )
      return;
    packOperation.current = true;
    setPackImportOpen(true);
    setPackBusy(true);
    setPackError("");
    try {
      // Drain already queued autosaves before deciding whether another save is needed.
      await saveQueue.current.enqueue(async () => undefined);
      if (!alive.current) return;
      await enqueueSave(draft);
      await saveQueue.current.enqueue(async () => undefined);
      if (
        lastSavedJson.current !== JSON.stringify(draft) ||
        latestDraftJson.current !== lastSavedJson.current
      ) {
        throw new Error("Save the latest Presentation changes before inserting a Pack.");
      }
    } catch (caught) {
      if (alive.current) setPackError(humanError(caught));
    } finally {
      packOperation.current = false;
      if (alive.current) setPackBusy(false);
    }
  }

  async function insertRecoveryPack(versionId: string) {
    if (
      !draft ||
      (!canInsertPack && !packPending.current) ||
      packOperation.current ||
      packUpdateOperation.current ||
      packUpdatePending.current
    )
      return;
    packOperation.current = true;
    setPackBusy(true);
    setPackError("");
    try {
      if (!packPending.current) {
        const draftJson = JSON.stringify(draft);
        if (latestDraftJson.current !== draftJson || lastSavedJson.current !== draftJson) {
          throw new Error("Save the latest Presentation changes before inserting a Pack.");
        }
        const request = InsertRecoveryPackIntoPresentationSchema.parse({
          packVersionId: versionId,
          afterBlockId: selectedBlockId,
          expectedRevision: revisionRef.current,
          mutationId: crypto.randomUUID(),
        });
        packPending.current = { body: JSON.stringify(request), draftJson, versionId };
      }
      const pending = packPending.current;
      const response = await apiFetch<{
        presentation: PresentationRecord;
        insertedBlockIds: string[];
      }>(`/v1/presentations/${presentationId}/recovery-packs/insert`, {
        method: "POST",
        body: pending.body,
      });
      if (!alive.current) return;
      if (latestDraftJson.current !== pending.draftJson) {
        throw new ApiClientError(
          "Your local changes were preserved. Reload the current draft after preserving a local copy.",
          "STALE_DRAFT",
          409,
        );
      }
      setUndoStack((history) => [...history, draft].slice(-HISTORY_LIMIT));
      setRedoStack([]);
      lastHistoryCommit.current = null;
      setRecord(response.presentation);
      setDraft(response.presentation.draft);
      revisionRef.current = response.presentation.draftRevision;
      lastSavedJson.current = JSON.stringify(response.presentation.draft);
      latestDraftJson.current = lastSavedJson.current;
      setSelectedBlockId(response.insertedBlockIds[0] ?? selectedBlockId);
      setInspectorTab("build");
      setSaveState("saved");
      setError("");
      packPending.current = null;
      setPackRetryVersionId(null);
      setPackImportOpen(false);
      await clearBuilderRecovery(recoveryKey).catch(() => undefined);
    } catch (caught) {
      if (!alive.current) return;
      if (
        packPending.current &&
        (isRetryableSaveError(caught) || !(caught instanceof ApiClientError))
      ) {
        setPackRetryVersionId(packPending.current.versionId);
      } else {
        packPending.current = null;
        setPackRetryVersionId(null);
        if (caught instanceof ApiClientError && (caught.status === 409 || caught.status === 412)) {
          setSaveState("conflict");
          setError(humanError(caught));
        }
      }
      setPackError(humanError(caught));
    } finally {
      packOperation.current = false;
      if (alive.current) setPackBusy(false);
    }
  }

  function assertPackDraftCurrent(signature: string, expectedRevision: number) {
    if (
      !alive.current ||
      !presentationPackDraftIsCurrent({
        expectedSignature: signature,
        currentSignature: latestDraftJson.current,
        savedSignature: lastSavedJson.current,
        expectedRevision,
        currentRevision: revisionRef.current,
      })
    ) {
      throw new ApiClientError(
        "The Presentation changed. Your local work was preserved; save or reload before reviewing again.",
        "STALE_DRAFT",
        409,
      );
    }
  }

  async function reviewPackUpdate(
    insertionId: string,
  ): Promise<PresentationRecoveryPackUpdatePreview> {
    if (
      !draft ||
      packUpdateOperation.current ||
      packUpdatePending.current ||
      packOperation.current ||
      packPending.current ||
      importPreparation.current ||
      roundImportOpen ||
      sourceImportOpen ||
      packImportOpen ||
      mediaState !== "idle" ||
      saveState === "conflict"
    )
      throw new Error("Finish saving or reload this Presentation before reviewing a Pack update.");
    const captured = draft;
    const signature = JSON.stringify(captured);
    packUpdateOperation.current = true;
    setPackUpdateBusy(true);
    try {
      await saveQueue.current.enqueue(async () => undefined);
      if (!alive.current || latestDraftJson.current !== signature) {
        throw new Error("The local Presentation changed before review. Review its latest draft.");
      }
      if (lastSavedJson.current !== signature) {
        if (!canEdit)
          throw new Error("Reload the saved Presentation before reviewing a Pack update.");
        await enqueueSave(captured);
      }
      await saveQueue.current.enqueue(async () => undefined);
      const expectedRevision = revisionRef.current;
      assertPackDraftCurrent(signature, expectedRevision);
      const response = await apiFetch<{ review: unknown }>(
        `/v1/presentations/${presentationId}/recovery-packs/update-review`,
        { method: "POST", body: JSON.stringify({ insertionId }) },
      );
      const review = PresentationRecoveryPackUpdatePreviewSchema.parse(response.review);
      assertPackDraftCurrent(signature, expectedRevision);
      if (
        review.presentationId !== presentationId ||
        review.insertionId !== insertionId ||
        review.draftRevision !== expectedRevision
      ) {
        throw new Error(
          "The Presentation changed during review. Reload or review its saved draft.",
        );
      }
      return review;
    } finally {
      packUpdateOperation.current = false;
      if (alive.current) setPackUpdateBusy(false);
    }
  }

  async function runPackDraftMutation(
    path: string,
    body: string,
    expectedRevision: number,
    validate?: (response: PresentationRecoveryPackUpdateApplied) => boolean,
  ): Promise<PresentationRecoveryPackUpdateApplied> {
    if (
      !draft ||
      !canEdit ||
      packUpdateOperation.current ||
      packOperation.current ||
      packPending.current ||
      importPreparation.current ||
      packImportOpen ||
      roundImportOpen ||
      sourceImportOpen ||
      mediaState !== "idle"
    ) {
      throw new Error("Finish the current operation before changing the Presentation draft.");
    }
    const signature = JSON.stringify(draft);
    const pending = packUpdatePending.current;
    if (pending && (pending.path !== path || pending.body !== body)) {
      throw new Error("Retry the outstanding Pack acknowledgement before making another change.");
    }
    if (!pending && saveState === "conflict") {
      throw new Error("Preserve your local changes and reload the current Presentation first.");
    }
    assertPackDraftCurrent(pending?.draftJson ?? signature, expectedRevision);
    packUpdateOperation.current = true;
    setPackUpdateBusy(true);
    if (!pending)
      packUpdatePending.current = { path, body, draftJson: signature, expectedRevision };
    try {
      await saveQueue.current.enqueue(async () => undefined);
      assertPackDraftCurrent(signature, expectedRevision);
      const response = await apiFetch<PresentationRecoveryPackUpdateApplied>(path, {
        method: "POST",
        body,
      });
      assertPackDraftCurrent(signature, expectedRevision);
      if (
        response.presentation.id !== presentationId ||
        response.presentation.draftRevision !== expectedRevision + 1 ||
        (validate && !validate(response))
      ) {
        throw new ApiClientError(
          "The Presentation response changed. Reload its current draft before continuing.",
          "STALE_DRAFT",
          409,
        );
      }
      const next = response.presentation as PresentationRecord;
      setSelectedBlockId((current) => presentationPackSelectedBlock(draft, next.draft, current));
      setRecord(next);
      setDraft(next.draft);
      revisionRef.current = next.draftRevision;
      lastSavedJson.current = JSON.stringify(next.draft);
      latestDraftJson.current = lastSavedJson.current;
      setUndoStack([]);
      setRedoStack([]);
      lastHistoryCommit.current = null;
      packUpdatePending.current = null;
      setPackUpdateReceiptPending(false);
      setSaveState("saved");
      setError("");
      await clearBuilderRecovery(recoveryKey).catch(() => undefined);
      return response;
    } catch (caught) {
      if (alive.current) {
        const retryable = isRetryableSaveError(caught) || !(caught instanceof ApiClientError);
        if (retryable) {
          setPackUpdateReceiptPending(true);
          setSaveState("error");
        } else {
          packUpdatePending.current = null;
          setPackUpdateReceiptPending(false);
          if (
            caught instanceof ApiClientError &&
            (caught.status === 409 || caught.status === 412)
          ) {
            setSaveState("conflict");
            setError(humanError(caught));
          }
        }
      }
      throw caught;
    } finally {
      packUpdateOperation.current = false;
      if (alive.current) setPackUpdateBusy(false);
    }
  }

  async function applyPackUpdate(input: ApplyPresentationRecoveryPackUpdate) {
    if (!canInsertPack && !packUpdatePending.current) {
      throw new Error("Pack update authoring is not enabled for this Presentation.");
    }
    const request = ApplyPresentationRecoveryPackUpdateSchema.parse(input);
    return runPackDraftMutation(
      `/v1/presentations/${presentationId}/recovery-packs/update`,
      JSON.stringify(request),
      request.expectedRevision,
      (response) =>
        response.undo.sourceRevision === request.expectedRevision &&
        response.undo.appliedRevision === response.presentation.draftRevision,
    );
  }

  async function undoPackUpdate(input: RecoveryPackUpdateUndo) {
    await runPackDraftMutation(
      `/v1/presentations/${presentationId}/history/${input.sourceRevision}/restore`,
      JSON.stringify({ expectedRevision: input.expectedRevision, mutationId: input.mutationId }),
      input.expectedRevision,
    );
  }

  async function openSourceImport() {
    if (
      !draft ||
      importPreparation.current ||
      packOperation.current ||
      packUpdateOperation.current ||
      packUpdatePending.current ||
      packImportOpen ||
      roundImportOpen ||
      sourceImportOpen
    )
      return;
    importPreparation.current = true;
    setPreparingImport(true);
    setError("");
    try {
      await enqueueSave(draft);
      if (!alive.current) return;
      const serialized = JSON.stringify(draft);
      if (lastSavedJson.current !== serialized || latestDraftJson.current !== serialized) {
        throw new Error("Save this Presentation before inserting source proposals.");
      }
      setSourceImportOpen(true);
    } catch (caught) {
      if (alive.current) setError(humanError(caught));
    } finally {
      importPreparation.current = false;
      if (alive.current) setPreparingImport(false);
    }
  }

  function toggleImportedQuestion(questionId: string) {
    const question = publishedRound?.questions.find((candidate) => candidate.id === questionId);
    if (
      question &&
      (multipleSelectionPoll(question) ||
        question.type === "ranking" ||
        isTextQuestion(question.type))
    )
      return;
    setSelectedQuestionIds((current) =>
      current.includes(questionId)
        ? current.filter((candidate) => candidate !== questionId)
        : [...current, questionId],
    );
  }

  async function importRoundQuestions() {
    if (
      !draft ||
      !publishedRound ||
      !selectedQuestionIds.length ||
      importPreparation.current ||
      packOperation.current ||
      packImportOpen
    )
      return;
    importPreparation.current = true;
    setImportingQuestions(true);
    setError("");
    try {
      await enqueueSave(draft);
      if (!alive.current) return;
      const serialized = JSON.stringify(draft);
      if (lastSavedJson.current !== serialized || latestDraftJson.current !== serialized) {
        throw new Error("Save this Presentation before importing questions.");
      }
      const response = await apiFetch<{
        presentation: PresentationRecord;
        insertedBlockIds: string[];
      }>(`/v1/presentations/${presentationId}/blocks/import`, {
        method: "POST",
        body: JSON.stringify({
          sourceQuizVersionId: publishedRound.versionId,
          questionIds: selectedQuestionIds,
          afterBlockId: selectedBlockId,
          expectedRevision: revisionRef.current,
          mutationId: crypto.randomUUID(),
        }),
      });
      if (draft) setUndoStack((history) => [...history, draft].slice(-HISTORY_LIMIT));
      setRedoStack([]);
      lastHistoryCommit.current = null;
      setRecord(response.presentation);
      setDraft(response.presentation.draft);
      revisionRef.current = response.presentation.draftRevision;
      lastSavedJson.current = JSON.stringify(response.presentation.draft);
      latestDraftJson.current = lastSavedJson.current;
      setSelectedBlockId(response.insertedBlockIds[0] ?? selectedBlockId);
      setRoundImportOpen(false);
      setSelectedQuestionIds([]);
      setSaveState("saved");
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      importPreparation.current = false;
      if (alive.current) setImportingQuestions(false);
    }
  }

  async function publish() {
    if (!draft || packUpdateOperation.current || packUpdatePending.current) return;
    if (issues.length) {
      recordAuthoringEvent("publish_blocked", "presentation");
      setInspectorOpen(true);
      setInspectorTab("readiness");
      setError("Resolve the readiness issues before publishing.");
      return;
    }
    setError("");
    try {
      await enqueueSave(draft);
      const serialized = JSON.stringify(draft);
      if (lastSavedJson.current !== serialized || latestDraftJson.current !== serialized) {
        throw new Error("Save the latest Presentation changes before publishing.");
      }
      const response = await apiFetch<{ presentation: PresentationRecord }>(
        `/v1/presentations/${presentationId}/publish`,
        {
          method: "POST",
          body: JSON.stringify({ expectedDraftRevision: revisionRef.current }),
        },
      );
      setRecord(response.presentation);
      setSaveState("saved");
    } catch (caught) {
      if (
        caught instanceof ApiClientError &&
        (caught.code === "STALE_DRAFT" || caught.status === 409 || caught.status === 412)
      ) {
        recordAuthoringEvent("draft_conflict", "presentation");
      } else if (caught instanceof ApiClientError && caught.status === 422) {
        recordAuthoringEvent("publish_blocked", "presentation");
      }
      setError(humanError(caught));
    }
  }

  if (!draft || !record) {
    return (
      <main className={styles.loading}>
        <div className={styles.loadingMark} aria-hidden="true" />
        <p lang={error ? "en-CA" : undefined}>
          {error || t("delivery.presentationBuilder.opening")}
        </p>
      </main>
    );
  }

  const questionBlocks = draft.blocks.flatMap((block) =>
    block.kind === "question" ? [block.question] : [],
  );
  const builderTitleMarker = "__OPENROUND_PRESENTATION_TITLE__";
  const builderTitleParts = t("delivery.presentationBuilder.builderTitle", {
    title: builderTitleMarker,
  }).split(builderTitleMarker);
  const inspectorTabs: Array<{ id: InspectorTab; label: string }> =
    selectedBlock?.kind === "content"
      ? [
          { id: "content", label: t("delivery.presentationBuilder.content") },
          { id: "layout", label: t("delivery.presentationBuilder.layout") },
          { id: "media", label: t("delivery.builder.media") },
          { id: "notes", label: t("delivery.presentationBuilder.notes") },
          { id: "accessibility", label: t("delivery.presentationBuilder.access") },
          {
            id: "readiness",
            label: issues.length
              ? t("delivery.presentationBuilder.readyCount", { count: issues.length })
              : t("delivery.presentationBuilder.readyComplete"),
          },
        ]
      : [
          { id: "build", label: t("delivery.builder.build") },
          { id: "diagnose", label: t("delivery.builder.diagnose") },
          { id: "recover", label: t("delivery.builder.recover") },
          {
            id: "readiness",
            label: issues.length
              ? t("delivery.presentationBuilder.readyCount", { count: issues.length })
              : t("delivery.presentationBuilder.readyComplete"),
          },
        ];

  return (
    <div className={styles.builder}>
      <a className={styles.skipLink} href="#presentation-canvas">
        {t("delivery.presentationBuilder.skipCanvas")}
      </a>
      <header className={styles.commandBar} inert={builderMutationBlocked}>
        <h1 className="sr-only">
          {builderTitleParts[0]}
          <span lang={draft.title ? "" : locale}>
            {draft.title || t("delivery.presentationBuilder.untitled")}
          </span>
          {builderTitleParts.slice(1).join(builderTitleMarker)}
        </h1>
        <div className={styles.commandStart}>
          <Link
            className={styles.exitLink}
            href="/library?type=presentations"
            onClick={guardBuilderExit}
          >
            ← {t("delivery.presentationBuilder.library")}
          </Link>
          <button
            aria-expanded={mapOpen}
            className={styles.iconButton}
            onClick={() => setMapOpen((value) => !value)}
            type="button"
          >
            {mapOpen
              ? t("delivery.presentationBuilder.hideMap")
              : t("delivery.presentationBuilder.showMap")}
          </button>
        </div>
        <label className={styles.titleField}>
          <span className="sr-only">{t("delivery.presentationBuilder.titleLabel")}</span>
          <input
            lang={draft.title.trim() ? "" : locale}
            maxLength={160}
            onChange={(event) =>
              commit((current) => ({ ...current, title: event.target.value }), "presentation:title")
            }
            placeholder={t("delivery.presentationBuilder.untitled")}
            value={draft.title}
          />
        </label>
        <div className={styles.commandActions}>
          <span className={`${styles.saveStatus} ${styles[`save_${saveState}`]}`} role="status">
            {saveState === "saving"
              ? t("delivery.common.saving")
              : saveState === "dirty"
                ? t("delivery.presentationBuilder.unsaved")
                : saveState === "error"
                  ? t("delivery.builder.saveFailed")
                  : saveState === "conflict"
                    ? t("delivery.presentationBuilder.newerVersion")
                    : t("delivery.common.saved")}
          </span>
          <button disabled={!undoStack.length} onClick={undo} type="button">
            {t("delivery.builder.undo")}
          </button>
          <button disabled={!redoStack.length} onClick={redo} type="button">
            {t("delivery.builder.redo")}
          </button>
          <button onClick={() => setPreviewOpen(true)} type="button">
            {t("delivery.common.preview")}
          </button>
          <button className={styles.publishButton} onClick={() => void publish()} type="button">
            {record.status === "published" && !record.hasUnpublishedChanges
              ? t("delivery.presentationBuilder.published")
              : t("delivery.common.publish")}
          </button>
          <button
            aria-expanded={inspectorOpen}
            className={styles.iconButton}
            onClick={() => setInspectorOpen((value) => !value)}
            type="button"
          >
            {inspectorOpen
              ? t("delivery.presentationBuilder.hideInspector")
              : t("delivery.presentationBuilder.openInspector")}
          </button>
        </div>
      </header>

      {recovery ? (
        <div
          className={styles.recoveryBanner}
          inert={builderMutationBlocked}
          lang="en-CA"
          role="status"
        >
          <span>
            A newer local edit from{" "}
            <time dateTime={recovery.savedAt} lang={locale}>
              {formatDateTime(locale, recovery.savedAt)}
            </time>{" "}
            is available.
          </span>
          <button
            onClick={() => {
              commit(recovery.draft);
              setRecovery(null);
            }}
            type="button"
          >
            Restore local copy
          </button>
          <button
            onClick={() => {
              void clearBuilderRecovery(recoveryKey);
              setRecovery(null);
            }}
            type="button"
          >
            Dismiss
          </button>
        </div>
      ) : null}
      {draft.sourceDisclosure ? (
        <div className={styles.sourceBanner} lang="en-CA" role="note">
          <span>
            <strong>Grounded source:</strong>{" "}
            <span lang="">{draft.sourceDisclosure.sourceName}</span> · generated by{" "}
            <span lang="">
              {draft.sourceDisclosure.provider} / {draft.sourceDisclosure.model}
            </span>
            . Verify citations before publishing.
          </span>
          {draft.sourceDisclosure.conversionNotes?.length ? (
            <ul>
              {draft.sourceDisclosure.conversionNotes.map((note) => (
                <li key={note} lang="">
                  {note}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <div className={styles.errorBanner} inert={builderMutationBlocked} role="alert">
          <span lang="en-CA">{error}</span>
          {saveState === "error" ? (
            <button onClick={() => void enqueueSave(draft)} type="button">
              {t("delivery.builder.retrySave")}
            </button>
          ) : null}
          {saveState === "conflict" ? (
            <>
              <button lang="en-CA" onClick={() => void reloadLatestDraft()} type="button">
                Reload current
              </button>
              <button lang="en-CA" onClick={preserveLocalCopy} type="button">
                Preserve local copy
              </button>
              <button lang="en-CA" onClick={() => void duplicateLocalDraft()} type="button">
                Duplicate as new
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {draft.recoveryPackInsertions?.length ? (
        <section
          className={styles.packReviews}
          aria-label="Presentation Recovery Pack updates"
          inert={packImportOpen}
        >
          {packUpdateReceiptPending ? (
            <p className="notice" role="status" lang="en-CA">
              Editing is paused until the outstanding Pack acknowledgement is recovered. Retry the
              same update or undo below; it cannot create a duplicate revision.
            </p>
          ) : null}
          {draft.recoveryPackInsertions.map((insertion) => (
            <PresentationRecoveryPackUpdateReview
              key={insertion.id}
              presentationId={presentationId}
              insertionId={insertion.id}
              title={(insertion.updateBaseline?.content ?? insertion.originalContent).title}
              canEdit={canEdit}
              featureEnabled={canInsertPack}
              currentDraftRevision={record.draftRevision}
              draftSignature={JSON.stringify(draft)}
              draftSaved={
                saveState !== "conflict" && JSON.stringify(draft) === lastSavedJson.current
              }
              mutationBusy={packUpdateBusy || packBusy || preparingImport || importingQuestions}
              receiptRetryable={packUpdateReceiptPending}
              onReview={reviewPackUpdate}
              onApply={applyPackUpdate}
              onUndo={undoPackUpdate}
            />
          ))}
        </section>
      ) : null}

      <div
        className={`${styles.workspace} ${mapOpen ? "" : styles.mapClosed} ${inspectorOpen ? "" : styles.inspectorClosed}`}
        inert={builderMutationBlocked}
      >
        <aside
          className={styles.map}
          aria-label={t("delivery.presentationBuilder.presentationMap")}
        >
          <div className={styles.mapHeader}>
            <div>
              <span className={styles.eyebrow}>
                {t("delivery.presentationBuilder.presentationMap")}
              </span>
              <strong>
                {t(
                  draft.blocks.length === 1
                    ? "delivery.presentationBuilder.blockCount.one"
                    : "delivery.presentationBuilder.blockCount.other",
                  { count: draft.blocks.length },
                )}
              </strong>
            </div>
            <button
              onClick={() => setMapOpen(false)}
              type="button"
              aria-label={t("delivery.presentationBuilder.collapseMap")}
            >
              ‹
            </button>
          </div>
          <ol className={styles.blockList}>
            {draft.blocks.map((block, index) => (
              <li key={block.id}>
                <button
                  aria-current={selectedBlockId === block.id ? "step" : undefined}
                  className={selectedBlockId === block.id ? styles.blockActive : styles.blockButton}
                  onClick={() => setSelectedBlockId(block.id)}
                  type="button"
                >
                  <span className={styles.blockNumber}>{index + 1}</span>
                  <span className={styles.blockText}>
                    <small>
                      {block.kind === "content"
                        ? t("delivery.presentation.contentSlide")
                        : `${t(
                            (block.question.delivery ?? "main") === "recheck"
                              ? "delivery.builder.recheck"
                              : "delivery.presentation.interactiveQuestion",
                          )} · ${t(questionTypeMessageKeys[block.question.type])}`}
                    </small>
                    <strong
                      lang={
                        (block.kind === "content"
                          ? contentSlideTitle(block)
                          : block.question.prompt
                        ).trim()
                          ? ""
                          : undefined
                      }
                    >
                      {(block.kind === "content"
                        ? contentSlideTitle(block)
                        : block.question.prompt
                      ).trim() ||
                        t(
                          block.kind === "content"
                            ? "delivery.builder.slide"
                            : "delivery.builder.question",
                          { number: index + 1 },
                        )}
                    </strong>
                  </span>
                  {issuesByBlock.has(block.id) ? (
                    <span
                      className={styles.issueBadge}
                      aria-label={t(
                        issuesByBlock.get(block.id) === 1
                          ? "delivery.builder.issueCount.one"
                          : "delivery.builder.issueCount.other",
                        { count: issuesByBlock.get(block.id) ?? 0 },
                      )}
                    >
                      {issuesByBlock.get(block.id)}
                    </span>
                  ) : (
                    <span className={styles.readyBadge} aria-label={t("delivery.builder.ready")}>
                      ✓
                    </span>
                  )}
                </button>
                {block.kind === "question" && block.question.linkedRecheckQuestionId ? (
                  <span className={styles.recoveryLink}>
                    ↳ {t("delivery.presentationBuilder.pairedRecovery")}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
          <div className={styles.addActions}>
            <button onClick={() => addBlock(createContentBlock())} type="button">
              + {t("delivery.presentation.contentSlide")}
            </button>
            <button onClick={() => addBlock(createQuestionBlock())} type="button">
              + {t("delivery.builder.addQuestion")}
            </button>
            <button
              disabled={!roundSources.length || preparingImport}
              onClick={openRoundImport}
              type="button"
            >
              + {t("delivery.presentationBuilder.fromPublishedRound")}
            </button>
            <button
              disabled={preparingImport}
              onClick={() => void openSourceImport()}
              type="button"
            >
              + {t("delivery.presentationBuilder.fromTrustedSource")}
            </button>
            {canInsertPack ? (
              <button
                disabled={mediaState !== "idle" || preparingImport}
                lang="en-CA"
                onClick={() => void openPackImport()}
                type="button"
              >
                + From Recovery Pack
              </button>
            ) : null}
          </div>
        </aside>

        <main className={styles.canvasArea} id="presentation-canvas">
          <RecoveryPackPresentationReferences insertions={draft.recoveryPackInsertions ?? []} />
          {!mapOpen ? (
            <button
              className={styles.floatingMapButton}
              onClick={() => setMapOpen(true)}
              type="button"
            >
              {t("delivery.presentationBuilder.openMap")}
            </button>
          ) : null}
          {!selectedBlock ? (
            <section className={styles.emptyCanvas}>
              <span className={styles.emptyGlyph}>✦</span>
              <h1>{t("delivery.presentationBuilder.emptyTitle")}</h1>
              <p>{t("delivery.presentationBuilder.emptyDescription")}</p>
              <div>
                <button onClick={() => addBlock(createContentBlock())} type="button">
                  {t("delivery.presentationBuilder.addContentSlide")}
                </button>
                <button onClick={() => addBlock(createQuestionBlock())} type="button">
                  {t("delivery.presentationBuilder.addAudienceQuestion")}
                </button>
                <button disabled={!roundSources.length} onClick={openRoundImport} type="button">
                  {t("delivery.presentationBuilder.reuseRound")}
                </button>
                <button onClick={() => void openSourceImport()} type="button">
                  {t("delivery.presentationBuilder.insertTrustedSource")}
                </button>
              </div>
            </section>
          ) : selectedBlock.kind === "content" ? (
            <section className={styles.slideCanvas} lang="en-CA">
              <ContentSlideView
                block={selectedBlock}
                bodyPlaceholder={
                  selectedBlock.layout === "quote"
                    ? "Add the quote or reflection prompt"
                    : "Add the context your audience needs"
                }
                media={
                  selectedBlock.mediaId ? (
                    <AuthenticatedMedia
                      altText={selectedBlock.mediaAlt}
                      mediaId={selectedBlock.mediaId}
                    />
                  ) : undefined
                }
                onChangeElement={changeTextElement}
                onChangeFrame={changeTextFrame}
                onMoveElement={moveTextElement}
                onSelectElement={setSelectedTextElementId}
                selectedElementId={selectedTextElementId}
                showGuides={showLayoutGuides}
                variant="editor"
              />
            </section>
          ) : (
            <section className={styles.questionCanvas}>
              <div className={styles.questionMeta}>
                <span>{t("delivery.presentation.interactiveQuestion")}</span>
                <span lang="en-CA">{selectedBlock.question.timeLimitSeconds} seconds</span>
              </div>
              <textarea
                aria-label="Question prompt"
                className={styles.questionPrompt}
                lang={selectedBlock.question.prompt.trim() ? "" : "en-CA"}
                maxLength={500}
                onChange={(event) =>
                  updateQuestion(
                    (question) => ({ ...question, prompt: event.target.value }),
                    "prompt",
                  )
                }
                placeholder="What do you want the room to think about?"
                value={selectedBlock.question.prompt}
              />
              {selectedBlock.question.mediaId ? (
                <div className={styles.canvasMedia}>
                  <AuthenticatedMedia
                    altText={selectedBlock.question.mediaAlt}
                    mediaId={selectedBlock.question.mediaId}
                  />
                </div>
              ) : null}
              <div className={styles.responseSurface}>
                <ResponseEditor
                  onStructuralChange={(question) => updateQuestion(() => question)}
                  onUpdateChoiceQuestion={(updater) =>
                    updateQuestion(
                      (question) => (isChoiceQuestion(question) ? updater(question) : question),
                      "response",
                    )
                  }
                  onUpdateQuestion={(updater) => updateQuestion(updater, "response")}
                  question={selectedBlock.question}
                  uxBeta
                />
                {selectedBlock.question.type === "poll" ? (
                  <p className="muted">{t("delivery.builder.pollMultipleLiveOnly")}</p>
                ) : null}
              </div>
            </section>
          )}
          {selectedBlock ? (
            <div className={styles.canvasToolbar} aria-label="Selected block actions" lang="en-CA">
              {selectedBlock.kind === "content" ? (
                <>
                  <button
                    disabled={selectedBlock.textElements.length >= 8}
                    onClick={addTextBox}
                    type="button"
                  >
                    Add text box
                  </button>
                  <button
                    disabled={!selectedTextElement}
                    onClick={() => {
                      if (!selectedTextElement) return;
                      updateSelected((block) =>
                        block.kind === "content"
                          ? reorderContentTextElement(block, selectedTextElement.id, -1)
                          : block,
                      );
                    }}
                    type="button"
                  >
                    Move text earlier
                  </button>
                  <button
                    disabled={!selectedTextElement}
                    onClick={() => {
                      if (!selectedTextElement) return;
                      updateSelected((block) =>
                        block.kind === "content"
                          ? reorderContentTextElement(block, selectedTextElement.id, 1)
                          : block,
                      );
                    }}
                    type="button"
                  >
                    Move text later
                  </button>
                  <button
                    className={styles.dangerButton}
                    disabled={!selectedTextElement || selectedTextElement.role === "title"}
                    onClick={deleteSelectedTextBox}
                    type="button"
                  >
                    Delete text box
                  </button>
                </>
              ) : null}
              <button
                disabled={draft.blocks[0]?.id === selectedBlock.id}
                onClick={() =>
                  commit((current) => movePresentationBlock(current, selectedBlock.id, -1))
                }
                type="button"
              >
                Move earlier
              </button>
              <button
                disabled={draft.blocks.at(-1)?.id === selectedBlock.id}
                onClick={() =>
                  commit((current) => movePresentationBlock(current, selectedBlock.id, 1))
                }
                type="button"
              >
                Move later
              </button>
              <button
                onClick={() => {
                  const copy = duplicatePresentationBlock(selectedBlock);
                  addBlock(copy);
                }}
                type="button"
              >
                Duplicate
              </button>
              <button
                className={styles.dangerButton}
                onClick={() => {
                  const index = draft.blocks.findIndex((block) => block.id === selectedBlock.id);
                  const remaining = draft.blocks.filter((block) => block.id !== selectedBlock.id);
                  commit((current) => removePresentationBlock(current, selectedBlock.id));
                  setSelectedBlockId(remaining[Math.min(index, remaining.length - 1)]?.id ?? null);
                }}
                type="button"
              >
                Delete
              </button>
            </div>
          ) : null}
        </main>

        <aside
          className={styles.inspector}
          aria-label={t("delivery.presentationBuilder.blockInspector")}
        >
          <div
            className={styles.inspectorTabs}
            role="tablist"
            aria-label={t("delivery.presentationBuilder.inspectorSections")}
            onKeyDown={moveInspectorTab}
          >
            {inspectorTabs.map((tab) => (
              <button
                id={`inspector-tab-${tab.id}`}
                aria-controls="inspector-panel"
                aria-selected={inspectorTab === tab.id}
                className={
                  inspectorTab === tab.id ? styles.inspectorTabActive : styles.inspectorTab
                }
                key={tab.id}
                onClick={() => setInspectorTab(tab.id)}
                role="tab"
                tabIndex={inspectorTab === tab.id ? 0 : -1}
                type="button"
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div
            id="inspector-panel"
            className={styles.inspectorBody}
            role="tabpanel"
            aria-labelledby={`inspector-tab-${inspectorTab}`}
            tabIndex={0}
          >
            {inspectorTab === "readiness" ? (
              <section>
                <p className={styles.eyebrow}>
                  {t("delivery.presentationBuilder.publishReadiness")}
                </p>
                <h2>
                  {issues.length
                    ? t(
                        issues.length === 1
                          ? "delivery.presentationBuilder.thingsToResolve.one"
                          : "delivery.presentationBuilder.thingsToResolve.other",
                        { count: issues.length },
                      )
                    : t("delivery.presentationBuilder.readyToPublish")}
                </h2>
                {issues.length ? (
                  <ul className={styles.issueList}>
                    {issues.map((issue, index) => (
                      <li key={`${issue.blockId}-${issue.field}-${index}`}>
                        <button
                          onClick={() => {
                            const issueBlock = draft.blocks.find(
                              (block) => block.id === issue.blockId,
                            );
                            if (issue.blockId) setSelectedBlockId(issue.blockId);
                            setInspectorTab(
                              issueBlock?.kind === "content"
                                ? issue.field === "mediaAlt"
                                  ? "accessibility"
                                  : "content"
                                : "build",
                            );
                          }}
                          type="button"
                        >
                          <span>{t("delivery.builder.needsAttention")}</span>
                          <span lang="en-CA">{issue.message}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className={styles.readyPanel}>
                    <span>✓</span>
                    <p>{t("delivery.presentationBuilder.everyBlockReady")}</p>
                  </div>
                )}
              </section>
            ) : !selectedBlock ? (
              <p>{t("delivery.presentationBuilder.selectBlock")}</p>
            ) : selectedBlock.kind === "content" ? (
              <section>
                <p className={styles.eyebrow}>{t("delivery.presentation.contentSlide")}</p>
                <h2>{inspectorTabs.find((tab) => tab.id === inspectorTab)?.label}</h2>
                {inspectorTab === "content" ? (
                  <>
                    {selectedBlock.textElements.map((element) => (
                      <label className={styles.field} key={element.id}>
                        <span lang="en-CA">
                          {element.role === "title"
                            ? "Slide title"
                            : `Text box ${
                                selectedBlock.textElements
                                  .filter((candidate) => candidate.role === "body")
                                  .findIndex((candidate) => candidate.id === element.id) + 1
                              }`}
                        </span>
                        {element.role === "title" ? (
                          <input
                            lang={element.text.trim() ? "" : "en-CA"}
                            maxLength={160}
                            onChange={(event) => changeTextElement(element.id, event.target.value)}
                            onFocus={() => setSelectedTextElementId(element.id)}
                            value={element.text}
                          />
                        ) : (
                          <textarea
                            lang={element.text.trim() ? "" : "en-CA"}
                            maxLength={4000}
                            onChange={(event) => changeTextElement(element.id, event.target.value)}
                            onFocus={() => setSelectedTextElementId(element.id)}
                            value={element.text}
                          />
                        )}
                      </label>
                    ))}
                    <button
                      disabled={selectedBlock.textElements.length >= 8}
                      onClick={addTextBox}
                      type="button"
                    >
                      Add text box
                    </button>
                  </>
                ) : inspectorTab === "layout" ? (
                  <>
                    <label className={styles.field}>
                      <span lang="en-CA">Structured layout</span>
                      <select
                        lang="en-CA"
                        onChange={(event) =>
                          updateSelected((block) =>
                            block.kind === "content"
                              ? applyContentSlideLayout(
                                  block,
                                  event.target.value as ContentSlideLayout,
                                )
                              : block,
                          )
                        }
                        value={selectedBlock.layout}
                      >
                        {slideLayouts.map((layout) => (
                          <option key={layout.id} value={layout.id}>
                            {layout.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={styles.field}>
                      <span lang="en-CA">Selected text element</span>
                      <select
                        lang="en-CA"
                        onChange={(event) => setSelectedTextElementId(event.target.value)}
                        value={selectedTextElement?.id ?? ""}
                      >
                        {selectedBlock.textElements.map((element) => (
                          <option key={element.id} value={element.id}>
                            {element.role === "title"
                              ? "Slide title"
                              : `Text box ${
                                  selectedBlock.textElements
                                    .filter((candidate) => candidate.role === "body")
                                    .findIndex((candidate) => candidate.id === element.id) + 1
                                }`}
                          </option>
                        ))}
                      </select>
                    </label>
                    {selectedTextElement ? (
                      <label className={styles.field}>
                        <span lang="en-CA">Position on slide</span>
                        <select
                          lang="en-CA"
                          onChange={(event) =>
                            moveTextElement(
                              selectedTextElement.id,
                              event.target.value as ContentSlideRegion,
                            )
                          }
                          value={
                            selectedTextFrame
                              ? regionForContentSlideFrame(selectedTextFrame)
                              : selectedTextElement.region
                          }
                        >
                          {Object.entries(contentSlideRegionLabels).map(([region, label]) => (
                            <option key={region} value={region}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    {selectedTextElement && selectedTextFrame ? (
                      <div className={styles.geometryFields}>
                        {(
                          [
                            ["x", "Horizontal position", 0, 100 - selectedTextFrame.width],
                            ["y", "Vertical position", 0, 100 - selectedTextFrame.height],
                            ["width", "Text box width", 12, 100 - selectedTextFrame.x],
                            ["height", "Text box height", 6, 100 - selectedTextFrame.y],
                          ] as const
                        ).map(([field, label, min, max]) => (
                          <label className={styles.field} key={field}>
                            <span lang="en-CA">{label} (%)</span>
                            <input
                              lang="en-CA"
                              type="number"
                              min={min}
                              max={Math.ceil(max * 100) / 100}
                              step={0.01}
                              value={Math.round(selectedTextFrame[field] * 100) / 100}
                              onChange={(event) => {
                                const value = event.target.valueAsNumber;
                                if (!Number.isFinite(value)) return;
                                changeTextFrame(
                                  selectedTextElement.id,
                                  {
                                    ...selectedTextFrame,
                                    [field]: Math.max(min, Math.min(max, value)),
                                  },
                                  `frame:${selectedTextElement.id}:${field}`,
                                );
                              }}
                            />
                          </label>
                        ))}
                      </div>
                    ) : null}
                    <label className={styles.guidesToggle}>
                      <input
                        type="checkbox"
                        checked={showLayoutGuides}
                        onChange={(event) => setShowLayoutGuides(event.target.checked)}
                      />
                      <span lang="en-CA">Show layout guides</span>
                    </label>
                    <div className={styles.positionActions}>
                      <button
                        disabled={!selectedTextElement}
                        onClick={() => {
                          if (!selectedTextElement) return;
                          updateSelected((block) =>
                            block.kind === "content"
                              ? reorderContentTextElement(block, selectedTextElement.id, -1)
                              : block,
                          );
                        }}
                        type="button"
                      >
                        Move up
                      </button>
                      <button
                        disabled={!selectedTextElement}
                        onClick={() => {
                          if (!selectedTextElement) return;
                          updateSelected((block) =>
                            block.kind === "content"
                              ? reorderContentTextElement(block, selectedTextElement.id, 1)
                              : block,
                          );
                        }}
                        type="button"
                      >
                        Move down
                      </button>
                    </div>
                    <p className={styles.helpText} lang="en-CA">
                      Drag the move handle to position text and the corner handle to resize it.
                      Arrow keys adjust by 1%; hold Shift for 5%. Guides mark the grid and safe
                      margins. Region shortcuts arrange text in stacked slots. Narrow screens show
                      the full text in reading order. Applying a starter layout resets placement.
                      {selectedBlock.mediaId
                        ? " Text stays clear of the reserved image area when moved or resized."
                        : ""}
                    </p>
                  </>
                ) : inspectorTab === "media" ? (
                  <>
                    <label className={styles.field}>
                      <span lang="en-CA">Image alternative text</span>
                      <textarea
                        lang={selectedBlock.mediaAlt?.trim() ? "" : "en-CA"}
                        maxLength={300}
                        onChange={(event) =>
                          updateSelected(
                            (block) =>
                              block.kind === "content"
                                ? { ...block, mediaAlt: event.target.value || null }
                                : block,
                            "mediaAlt",
                          )
                        }
                        placeholder="Describe what this image teaches"
                        value={selectedBlock.mediaAlt ?? ""}
                      />
                    </label>
                    <label className={styles.field}>
                      <span lang="en-CA">Instructional image</span>
                      <input
                        accept="image/jpeg,image/png,image/webp"
                        disabled={!mediaUploadsEnabled || mediaState !== "idle"}
                        onChange={(event) => {
                          void uploadSelectedImage(event.target.files?.[0] ?? null);
                          event.currentTarget.value = "";
                        }}
                        type="file"
                      />
                    </label>
                    <p className={styles.helpText} lang="en-CA">
                      {mediaUploadsEnabled
                        ? "JPEG, PNG, or WebP up to 10 MB. Uploads are quarantined and scanned."
                        : "Uploads are unavailable until malware scanning is configured."}{" "}
                      Attaching an image reserves space and adjusts text boxes that intersect its
                      area.
                    </p>
                    {mediaState !== "idle" ? (
                      <p className={styles.helpText} lang="en-CA" role="status">
                        {mediaState === "uploading"
                          ? "Uploading to quarantine…"
                          : "Checking image safety…"}
                      </p>
                    ) : null}
                    {mediaPreviewUrl ? (
                      <div className={styles.inspectorMedia}>
                        <img alt={selectedBlock.mediaAlt ?? ""} lang="" src={mediaPreviewUrl} />
                        <button
                          className={styles.dangerButton}
                          lang="en-CA"
                          onClick={removeSelectedImage}
                          type="button"
                        >
                          Remove image
                        </button>
                      </div>
                    ) : null}
                  </>
                ) : inspectorTab === "notes" ? (
                  <label className={styles.field}>
                    <span lang="en-CA">Speaker notes</span>
                    <textarea
                      lang={selectedBlock.speakerNotes.trim() ? "" : "en-CA"}
                      maxLength={2000}
                      onChange={(event) =>
                        updateSelected(
                          (block) =>
                            block.kind === "content"
                              ? { ...block, speakerNotes: event.target.value }
                              : block,
                          "speakerNotes",
                        )
                      }
                      placeholder="Private facilitation cues"
                      value={selectedBlock.speakerNotes}
                    />
                  </label>
                ) : (
                  <>
                    <label className={styles.field}>
                      <span lang="en-CA">Image alternative text</span>
                      <textarea
                        lang={selectedBlock.mediaAlt?.trim() ? "" : "en-CA"}
                        disabled={!selectedBlock.mediaId}
                        maxLength={300}
                        onChange={(event) =>
                          updateSelected(
                            (block) =>
                              block.kind === "content"
                                ? { ...block, mediaAlt: event.target.value || null }
                                : block,
                            "mediaAlt",
                          )
                        }
                        placeholder="Describe the instructional image"
                        value={selectedBlock.mediaAlt ?? ""}
                      />
                    </label>
                    <p className={styles.helpText} lang="en-CA">
                      Slide titles remain the primary heading. Polling Pops preserves reading order
                      across host, participant, tablet, and mobile layouts.
                    </p>
                  </>
                )}
              </section>
            ) : (
              <section>
                <p className={styles.eyebrow}>{t("delivery.presentation.interactiveQuestion")}</p>
                <h2>{inspectorTabs.find((tab) => tab.id === inspectorTab)?.label}</h2>
                {inspectorTab === "build" ? (
                  <>
                    <label className={styles.field}>
                      <span>{t("delivery.builder.questionType")}</span>
                      <select
                        onChange={(event) => {
                          const type = event.target.value as QuestionType;
                          commit((current) =>
                            changePresentationQuestionType(current, selectedBlock.id, type),
                          );
                        }}
                        value={selectedBlock.question.type}
                      >
                        {questionTypeOptions
                          .filter(
                            (option) => option.type !== "ranking" && !isTextQuestion(option.type),
                          )
                          .map((option) => (
                            <option key={option.type} value={option.type}>
                              {t(questionTypeMessageKeys[option.type])}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label className={styles.field}>
                      <span>{t("delivery.builder.timeLimit")}</span>
                      <select
                        lang="en-CA"
                        onChange={(event) =>
                          updateQuestion((question) => ({
                            ...question,
                            timeLimitSeconds: Number(event.target.value),
                          }))
                        }
                        value={selectedBlock.question.timeLimitSeconds}
                      >
                        {[5, 10, 20, 30, 60, 90, 120, 300].map((seconds) => (
                          <option key={seconds} value={seconds}>
                            {seconds} seconds
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={styles.field}>
                      <span>{t("delivery.builder.points")}</span>
                      <select
                        disabled={
                          selectedBlock.question.type === "poll" ||
                          selectedBlock.question.type === "rating"
                        }
                        onChange={(event) =>
                          updateQuestion((question) => ({
                            ...question,
                            basePoints: Number(event.target.value),
                          }))
                        }
                        value={selectedBlock.question.basePoints}
                      >
                        {[0, 500, 1000, 2000].map((points) => (
                          <option key={points} value={points}>
                            {points}
                          </option>
                        ))}
                      </select>
                    </label>
                    <MediaEditor
                      mediaPreviewUrl={mediaPreviewUrl}
                      mediaState={mediaState}
                      mediaUploadsEnabled={mediaUploadsEnabled}
                      onRemoveImage={removeSelectedImage}
                      onUpdateQuestion={(updater) => updateQuestion(updater, "media")}
                      onUploadImage={(file) => void uploadSelectedImage(file)}
                      question={selectedBlock.question}
                      uxBeta
                    />
                  </>
                ) : inspectorTab === "diagnose" ? (
                  <>
                    <label className={styles.field}>
                      <span lang="en-CA">Purpose</span>
                      <select
                        lang="en-CA"
                        onChange={(event) =>
                          updateQuestion((question) => ({
                            ...question,
                            purpose: event.target.value as "diagnostic" | "practice" | "opinion",
                          }))
                        }
                        value={selectedBlock.question.purpose ?? "diagnostic"}
                      >
                        <option value="diagnostic">Diagnostic</option>
                        <option value="practice">Practice</option>
                        <option value="opinion">Opinion</option>
                      </select>
                    </label>
                    <label className={styles.field}>
                      <span>{t("delivery.builder.confidence")}</span>
                      <select
                        lang="en-CA"
                        disabled={
                          selectedBlock.question.type === "poll" ||
                          selectedBlock.question.type === "rating"
                        }
                        onChange={(event) =>
                          updateQuestion((question) => ({
                            ...question,
                            confidence: event.target.value as "off" | "optional" | "required",
                          }))
                        }
                        value={selectedBlock.question.confidence ?? "off"}
                      >
                        <option value="off">Off</option>
                        <option value="optional">Optional</option>
                        <option value="required">Required</option>
                      </select>
                    </label>
                    <label className={styles.field}>
                      <span>{t("delivery.builder.concepts")}</span>
                      <input
                        lang={(selectedBlock.question.conceptKeys ?? []).length ? "" : "en-CA"}
                        onChange={(event) =>
                          updateQuestion(
                            (question) => ({
                              ...question,
                              conceptKeys: event.target.value
                                .split(",")
                                .map((value) => value.trim())
                                .filter(Boolean),
                            }),
                            "conceptKeys",
                          )
                        }
                        placeholder="onboarding, policy-scope"
                        value={(selectedBlock.question.conceptKeys ?? []).join(", ")}
                      />
                    </label>
                  </>
                ) : (
                  <>
                    <label className={styles.field}>
                      <span lang="en-CA">Delivery role</span>
                      <select
                        lang="en-CA"
                        onChange={(event) =>
                          updateQuestion((question) => ({
                            ...question,
                            delivery: event.target.value as "main" | "recheck",
                            linkedRecheckQuestionId:
                              event.target.value === "recheck"
                                ? null
                                : question.linkedRecheckQuestionId,
                          }))
                        }
                        value={selectedBlock.question.delivery ?? "main"}
                      >
                        <option value="main">Main diagnostic</option>
                        <option value="recheck">Recovery recheck</option>
                      </select>
                    </label>
                    {(selectedBlock.question.delivery ?? "main") === "main" ? (
                      <label className={styles.field}>
                        <span>{t("delivery.builder.pairedRecheckQuestion")}</span>
                        <select
                          onChange={(event) =>
                            updateQuestion((question) => ({
                              ...question,
                              linkedRecheckQuestionId: event.target.value || null,
                            }))
                          }
                          value={selectedBlock.question.linkedRecheckQuestionId ?? ""}
                        >
                          <option lang="en-CA" value="">
                            No paired recheck
                          </option>
                          {questionBlocks
                            .filter(
                              (question) =>
                                question.id !== selectedBlock.question.id &&
                                (question.delivery ?? "main") === "recheck",
                            )
                            .map((question) => (
                              <option
                                key={question.id}
                                lang={question.prompt ? "" : "en-CA"}
                                value={question.id}
                              >
                                {question.prompt || "Untitled recheck"}
                              </option>
                            ))}
                        </select>
                      </label>
                    ) : null}
                    <label className={styles.field}>
                      <span>{t("delivery.builder.explanation")}</span>
                      <textarea
                        lang={selectedBlock.question.explanation.trim() ? "" : "en-CA"}
                        maxLength={1000}
                        onChange={(event) =>
                          updateQuestion(
                            (question) => ({
                              ...question,
                              explanation: event.target.value,
                            }),
                            "explanation",
                          )
                        }
                        placeholder="What should the facilitator reinforce?"
                        value={selectedBlock.question.explanation}
                      />
                    </label>
                  </>
                )}
              </section>
            )}
          </div>
        </aside>
      </div>
      {previewOpen ? (
        <PresentationPreview draft={draft} onClose={() => setPreviewOpen(false)} />
      ) : null}
      {roundImportOpen ? (
        <div
          ref={roundImportDialogRef}
          className={styles.previewBackdrop}
          role="dialog"
          aria-modal="true"
          aria-labelledby="round-import-title"
          onKeyDown={(event) => handleModalKeyDown(event, () => setRoundImportOpen(false))}
          tabIndex={-1}
        >
          <section className={styles.importDialog} lang="en-CA">
            <div>
              <p className={styles.eyebrow}>Independent question copies</p>
              <h2 id="round-import-title">Insert from a published Round</h2>
              <p className={styles.helpText}>
                Polling Pops creates fresh block, question, and answer IDs. Recovery links are
                remapped only when both linked questions are selected.
              </p>
            </div>
            <label className={styles.field}>
              <span>Source Round</span>
              <select
                onChange={(event) => setSelectedRoundId(event.target.value)}
                value={selectedRoundId}
              >
                {roundSources.map((round) => (
                  <option key={round.id} lang="" value={round.id}>
                    {round.title}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className={styles.importQuestions}>
              <legend>Questions to copy</legend>
              {!publishedRound ? <p>Loading the published version…</p> : null}
              {publishedRound?.questions.map((question) => (
                <label key={question.id}>
                  <input
                    checked={selectedQuestionIds.includes(question.id)}
                    disabled={
                      multipleSelectionPoll(question) ||
                      question.type === "ranking" ||
                      isTextQuestion(question.type)
                    }
                    onChange={() => toggleImportedQuestion(question.id)}
                    type="checkbox"
                  />
                  <span>
                    <strong lang={question.prompt ? "" : "en-CA"}>
                      {question.prompt || "Untitled question"}
                    </strong>
                    <small>
                      {responseTypeLabel(question.type)} · {question.delivery ?? "main"}
                      {multipleSelectionPoll(question) ||
                      question.type === "ranking" ||
                      isTextQuestion(question.type) ? (
                        <span lang={locale}>
                          {" "}
                          ·{" "}
                          {t(
                            question.type === "ranking"
                              ? "delivery.builder.rankingLiveOnly"
                              : isTextQuestion(question.type)
                                ? "delivery.builder.textLiveOnly"
                                : "delivery.builder.pollMultipleLiveOnly",
                          )}
                        </span>
                      ) : null}
                    </small>
                  </span>
                </label>
              ))}
            </fieldset>
            <div className={styles.importActions}>
              <button
                disabled={!selectedQuestionIds.length || importingQuestions}
                onClick={() => void importRoundQuestions()}
                type="button"
              >
                {importingQuestions
                  ? "Copying…"
                  : `Insert ${selectedQuestionIds.length || "selected"}`}
              </button>
              <button
                onClick={() => {
                  setRoundImportOpen(false);
                  setSelectedQuestionIds([]);
                }}
                type="button"
              >
                Cancel
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {sourceImportOpen ? (
        <div
          ref={sourceImportDialogRef}
          className={styles.previewBackdrop}
          role="dialog"
          aria-modal="true"
          aria-labelledby="source-import-title"
          onKeyDown={(event) => handleModalKeyDown(event, () => setSourceImportOpen(false))}
          tabIndex={-1}
        >
          <section className={`${styles.importDialog} ${styles.sourceImportDialog}`} lang="en-CA">
            <div className={styles.sourceImportHeading}>
              <div>
                <p className={styles.eyebrow}>Review before insertion</p>
                <h2 id="source-import-title">Insert from a trusted source</h2>
                <p className={styles.helpText}>
                  Create a proposal, choose the cited content and Recovery questions you want, then
                  confirm once. Nothing is inserted while the proposal is processing.
                </p>
              </div>
              <button onClick={() => setSourceImportOpen(false)} type="button">
                Close
              </button>
            </div>
            <div lang={locale}>
              <AuthoringAssistant
                artifactType="presentation"
                canEdit
                insertionTarget={{
                  presentationId,
                  expectedRevision: revisionRef.current,
                  afterBlockId: selectedBlockId,
                  onInserted: (insertedBlockIds) => {
                    setSourceImportOpen(false);
                    void reloadLatestDraft(insertedBlockIds[0]);
                  },
                }}
                plain
                terminology="round"
              />
            </div>
          </section>
        </div>
      ) : null}
      {packImportOpen ? (
        <RecoveryPackPresentationPicker
          afterSelectedBlock={Boolean(selectedBlockId)}
          busy={packBusy}
          error={packError}
          onClose={() => {
            if (packOperation.current || packPending.current) return;
            setPackImportOpen(false);
          }}
          onInsert={(versionId) => void insertRecoveryPack(versionId)}
          retryVersionId={packRetryVersionId}
        />
      ) : null}
    </div>
  );
}
