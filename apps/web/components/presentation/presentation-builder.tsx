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
  PresentationDraftSchema,
  PRESENTATION_SCENE_MAX_NODES,
  preparePresentationPublication,
  presentationTextAssistanceSourceDigest,
  presentationQuestionSuggestionSource,
  presentationQuestionSuggestionsSourceDigest,
  resolvePresentationSpatialFrames,
  type PresentationDraftMutation,
  resolveContentSlideFrames,
  regionForContentSlideFrame,
  type ContentSlideFrame,
  type ContentSlideLayout,
  type ContentSlideRegion,
  type PresentationBlockDraft,
  type PresentationDraft,
  type PresentationScene,
  type QuestionDraft,
  type QuestionType,
  type ApplyPresentationRecoveryPackUpdate,
  type PresentationRecoveryPackUpdatePreview,
} from "@openround/contracts";
import { AUTH_CHANGE_EVENT, ApiClientError, apiFetch, humanError } from "../../lib/api";
import { clientUuid } from "../../lib/uuid";
import {
  clearBuilderRecovery,
  loadBuilderRecovery,
  saveBuilderRecovery,
  type BuilderRecoverySnapshot,
} from "../../lib/builder-recovery";
import { formatDateTime } from "../../lib/i18n/format";
import {
  addContentTextElement,
  addPresentationSection,
  applyContentSlideLayout,
  assignPresentationBlockToSection,
  changePresentationQuestionType,
  contentSlideTitle,
  createContentTextElement,
  createQuestionBlock,
  duplicatePresentationBlock,
  enablePresentationSections,
  insertPresentationBlockDuplicate,
  movePresentationBlock,
  canMovePresentationBlock,
  setPresentationSlideHidden,
  moveContentTextElement,
  normalizePresentationRecoveryDraft,
  presentationReadiness,
  presentationInteractionTargets,
  presentationSectionForBlock,
  promotePresentationOpinionFormats,
  removeContentTextElement,
  reorderContentTextElement,
  setContentTextElementFrame,
  setContentSlideMedia,
  removePresentationBlock,
  removePresentationSection,
  renamePresentationSection,
  updateContentTextElement,
  updatePresentationQuestion,
} from "../../lib/presentation-builder";
import { reconcilePresentationSpatialBlocks } from "../../lib/presentation-spatial-authoring";
import { PresentationSpatialDelivery } from "../presentation-live/presentation-spatial-delivery";
import { PresentationSpatialEditor } from "./presentation-spatial-editor";
import { RetainedPresentationSave } from "../../lib/presentation-draft-save";
import { PresentationShareButton } from "../presentation-sharing/share-dialog";
import { PresentationAssignmentButton } from "../presentation-assignments/assignment-dialog";
import { PresentationPracticeButton } from "../presentation-practice/practice-dialog";
import { PresentationExportButton } from "../presentation-export/export-dialog";
import {
  applyNativeDesignToDeck,
  applyNativeSceneToDeck,
  nativeSceneDocumentVersion,
} from "../../lib/presentation-deck-design";
import { RecoverableOperationQueue } from "../../lib/recoverable-operation-queue";
import { isRetryableSaveError, retryWithBackoff } from "../../lib/retry";
import {
  presentationPackDraftIsCurrent,
  presentationPackSelectedBlock,
} from "../../lib/presentation-pack-update-ui";
import { AuthoringAssistant } from "../authoring-assistant";
import { CanvasArtifactLinks } from "../canvas-artifact-links/links";
import { ResponseEditor } from "../editor/response-editor";
import { MediaEditor } from "../editor/media-editor";
import type { RecoveryPackUpdateUndo } from "../editor/recovery-pack-update-panel";
import { ContentSlideView, contentSlideRegionLabels } from "./content-slide-view";
import { isChoiceQuestion } from "../editor/types";
import { useLocale } from "../locale-provider";
import { questionTypeOptions, responseTypeLabel } from "../workspace/workspace-model";
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
import { NativeSceneEditor } from "./native-scene-editor";
import { nativeEditorCopy } from "./native-editor-copy";
import { nativeControlsCopy } from "./native-controls-copy";
import { assistanceCopy } from "./assistance-copy";
import { textAssistanceCopy, textAssistanceFeedback } from "./text-assistance-copy";
import { PresentationActivitySlide } from "./presentation-activity-slide";
import { SpeakerNotesEditor, PresenterNotesPanel } from "./presentation-speaker-notes";
import {
  inheritPresentationSceneDesign,
  resolvePresentationContentDesign,
  resolvePresentationActivityDesign,
} from "../../lib/presentation-activity-design";
import { applyNativeSceneDesign } from "../../lib/presentation-native-design";
import {
  EditorIcon,
  EDITOR_MODAL_SELECTOR,
  EditorDisclosure,
  handoffEditorDisclosure,
  EditorMenuSection,
  type EditorIconName,
  PresentationSlideThumbnail,
} from "./presentation-editor-chrome";
import { PresentationQuestionStarters } from "./presentation-question-starters";
import { questionStartersFeedback } from "../../lib/i18n/question-starters-copy";
import { questionSuggestionsCopy, questionSuggestionsFeedback } from "./question-suggestions-copy";
import { visualImportCopy, visualImportFeedback } from "./visual-import-copy";
import { sourceWorkflowsCopy, sourceWorkflowsFeedback } from "./source-workflows-copy";
import { insertPresentationQuestionStarter } from "../../lib/presentation-question-starters";
import { PresentationQuestionSuggestions } from "./presentation-question-suggestions";
import type { QuestionSuggestionsTarget } from "../../lib/presentation-question-suggestions-client";
import { PresentationVisualImport } from "./presentation-visual-import";
import { PresentationAssistance } from "./presentation-assistance";
import {
  PresentationTextAssistance,
  textAssistanceLanguageDisplay,
} from "./presentation-text-assistance";
import {
  sameTextAssistanceBlockId,
  type TextAssistanceTarget,
  type TextAssistanceRecovery,
} from "../../lib/presentation-text-assistance-client";
import { PresentationSections } from "./presentation-sections";
import { sectionsSpatialCopy } from "../../lib/i18n/sections-spatial-copy";
import { PresentationBranchEditor } from "./presentation-branch-editor";
import { focusModal, handleModalKeyDown } from "./presentation-modal-focus";
import { presentationCommandCopy } from "./presentation-command-copy";
import { authoringWorkflowCopy } from "../editor/authoring-workflow-copy";
import { PresentationVersionChoice } from "./presentation-version-choice";
import { publishBeforePresent } from "./publish-before-present";
import {
  adaptContentSlideToScene,
  attachNativeImage,
  createNativeContentBlock,
  createDesignedNativeContentBlock,
  nativeImageAttachmentStatus,
  type NativeImageAttachment,
} from "../../lib/presentation-native-scene";

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

const inspectorTabIcons: Record<InspectorTab, EditorIconName> = {
  build: "content",
  diagnose: "preview",
  recover: "recovery",
  content: "content",
  layout: "layout",
  media: "media",
  notes: "notes",
  accessibility: "accessibility",
  readiness: "check",
};

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

function nativeSlideTitleLanguage(block: PresentationBlockDraft) {
  if (block.kind !== "content") return undefined;
  const title = block.scene?.nodes.find((node) => node.type === "text" && node.role === "title");
  return title?.type === "text" && title.text.trim() ? title.lang : undefined;
}

function PresentationPreview({
  draft,
  onClose,
  initialBlockId,
  initialMode = "audience",
  origin,
}: {
  draft: PresentationDraft;
  onClose: () => void;
  initialBlockId?: string | null;
  initialMode?: "audience" | "presenter";
  origin?: "interaction" | "notes" | "slide";
}) {
  const { locale, t } = useLocale();
  const authoring = authoringWorkflowCopy(locale);
  const [mode, setMode] = useState(initialMode);
  const publication = preparePresentationPublication(draft);
  const [index, setIndex] = useState(
    Math.max(
      0,
      publication.blocks.findIndex(
        (candidate) => candidate.id.toLowerCase() === initialBlockId?.toLowerCase(),
      ),
    ),
  );
  const dialogRef = useRef<HTMLDivElement>(null);
  const block = publication.blocks[index];
  useEffect(() => focusModal(dialogRef.current), []);
  return (
    <div
      ref={dialogRef}
      className={styles.previewBackdrop}
      role="dialog"
      aria-modal="true"
      aria-label={authoring.preview}
      data-presentation-preview="true"
      data-preview-origin={origin ?? (initialBlockId ? "interaction" : undefined)}
      data-preview-mode={mode}
      lang={locale}
      onKeyDown={(event) => {
        if (event.key === "Escape") event.stopPropagation();
        handleModalKeyDown(event, onClose);
      }}
      tabIndex={-1}
    >
      <div className={styles.previewStage}>
        <div className={styles.previewBar}>
          <strong lang={draft.title ? "" : locale}>
            {draft.title || t("delivery.presentationBuilder.untitled")}
          </strong>
          <span>
            {publication.blocks.length
              ? `${index + 1} / ${publication.blocks.length}`
              : authoring.noSlides}
          </span>
          <div className={styles.previewModes} role="group" aria-label={authoring.previewMode}>
            <button
              type="button"
              aria-pressed={mode === "audience"}
              onClick={() => setMode("audience")}
            >
              <EditorIcon name="slides" /> {authoring.audienceView}
            </button>
            <button
              type="button"
              aria-pressed={mode === "presenter"}
              onClick={() => setMode("presenter")}
            >
              <EditorIcon name="notes" /> {authoring.presenterView}
            </button>
          </div>
          <button className={styles.iconButton} onClick={onClose} type="button">
            {authoring.closePreview}
          </button>
        </div>
        <PresentationSpatialDelivery
          spatial={
            publication.spatial
              ? {
                  schemaVersion: 1,
                  frames: resolvePresentationSpatialFrames(publication).map(
                    ({ blockId: removed, ...frame }, blockIndex) => {
                      void removed;
                      return { ...frame, blockIndex };
                    },
                  ),
                }
              : undefined
          }
          currentBlockIndex={index}
          phase="content"
          sourceKey={`builder-preview:${JSON.stringify(publication.spatial)}:${publication.blocks.map((block) => block.id).join(":")}`}
        />
        <div
          className={
            mode === "presenter" ? styles.previewWorkspacePresenter : styles.previewWorkspace
          }
        >
          <div
            className={styles.previewCanvas}
            role="region"
            aria-label="Slide preview"
            tabIndex={0}
          >
            {!block ? (
              <p>{authoring.emptyPreview}</p>
            ) : block.kind === "content" ? (
              <ContentSlideView
                block={block}
                media={
                  block.mediaId ? (
                    <AuthenticatedMedia altText={block.mediaAlt} mediaId={block.mediaId} />
                  ) : undefined
                }
                renderSceneImage={(mediaId, altText) => (
                  <AuthenticatedMedia key={mediaId} mediaId={mediaId} altText={altText} />
                )}
                variant="preview"
                designOverride={resolvePresentationContentDesign(publication.blocks, block.id)}
                interactionRuntime={{
                  mode: "review",
                  navigationTargets: presentationInteractionTargets(publication, block.id).map(
                    (target) => ({ blockId: target.id, available: true, blockedReason: null }),
                  ),
                  onNavigate: (_nodeId, targetId) => {
                    const target = publication.blocks.findIndex(
                      (candidate) => candidate.id.toLowerCase() === targetId.toLowerCase(),
                    );
                    if (target >= 0) {
                      // The link is about to unmount. The surviving region remains in
                      // the dialog's Tab order, including reverse keyboard navigation.
                      dialogRef.current
                        ?.querySelector<HTMLElement>('[role="region"][aria-label="Slide preview"]')
                        ?.focus({ preventScroll: true });
                      setIndex(target);
                    }
                  },
                }}
              />
            ) : (
              <PresentationActivitySlide
                accessibilityContext="preview"
                question={block.question}
                design={resolvePresentationActivityDesign(publication.blocks, block.id)}
                media={
                  block.question.mediaId ? (
                    <AuthenticatedMedia
                      mediaId={block.question.mediaId}
                      altText={block.question.mediaAlt}
                    />
                  ) : undefined
                }
              />
            )}
          </div>
          {mode === "presenter" ? (
            <PresenterNotesPanel
              notes={block?.kind === "content" ? block.speakerNotes : ""}
              slideNumber={block ? index + 1 : undefined}
              totalSlides={publication.blocks.length}
            />
          ) : null}
        </div>
        <div className={styles.previewControls}>
          <button
            disabled={index === 0}
            onClick={() => setIndex((value) => value - 1)}
            type="button"
          >
            {authoring.previous}
          </button>
          <button
            disabled={index >= publication.blocks.length - 1}
            onClick={() => setIndex((value) => value + 1)}
            type="button"
          >
            {authoring.next}
          </button>
        </div>
      </div>
    </div>
  );
}

interface PresentationBuilderProps {
  presentationId: string;
  startOutline?: boolean;
}

export function PresentationBuilder({ presentationId, startOutline }: PresentationBuilderProps) {
  const { creator, error, refreshAccount } = useWorkspace();
  const [retryingAccount, setRetryingAccount] = useState(false);
  const { t } = useLocale();
  return creator ? (
    <PresentationEditor
      key={`${creator.userId}:${creator.workspaceId}:${presentationId}`}
      presentationId={presentationId}
      startOutline={startOutline}
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

function PresentationEditor({ presentationId, startOutline }: PresentationBuilderProps) {
  const { creator, canEdit, productFeatures } = useWorkspace();
  const { locale, t } = useLocale();
  const authoring = authoringWorkflowCopy(locale);
  const commands = presentationCommandCopy(locale);
  const sectionsSpatial = sectionsSpatialCopy(locale);
  const nativeEditorUi = nativeEditorCopy(locale);
  const nativeControlUi = nativeControlsCopy(locale);
  const assistanceUi = assistanceCopy(locale);
  const textAssistanceUi = textAssistanceCopy(locale);
  const questionSuggestionsUi = questionSuggestionsCopy(locale);
  const visualImportUi = visualImportCopy(locale);
  const sourceWorkflowsUi = sourceWorkflowsCopy(locale);
  const router = useRouter();
  const compactLayout = useRef<boolean | null>(null);
  const commandBarRef = useCallback((element: HTMLElement | null) => {
    const builder = element?.parentElement;
    if (!element || !builder) return;
    const measure = () => {
      // Layout pixels keep offsets and the responsive mode correct under page zoom.
      builder.style.setProperty("--presentation-command-height", `${element.offsetHeight}px`);
      // Container units under CSS zoom differ between engines. Size drawers
      // from the same layout width used for the responsive mode.
      builder.style.setProperty(
        "--presentation-panel-width",
        `${Math.min(340, builder.offsetWidth * 0.9)}px`,
      );
      const compact = builder.offsetWidth <= 920;
      if (compactLayout.current !== compact) {
        compactLayout.current = compact;
        setCompactEditor(compact);
        const inspectorDialogOpen = Boolean(
          inspectorPanel.current?.querySelector("dialog[open]") ||
          document.querySelector(
            '[data-presentation-preview="true"][data-preview-origin="interaction"], [data-presentation-preview="true"][data-preview-origin="notes"]',
          ),
        );
        // Only the insertion menu can invoke an external navigator dialog.
        // The Sections panel is also an open <details>, but does not own one.
        const mapDialogOpen = Boolean(
          !inspectorDialogOpen &&
          document.querySelector(EDITOR_MODAL_SELECTOR) &&
          mapPanel.current?.querySelector(`details.${styles.insertMenu}[open]`),
        );
        setMapOpen(!compact || mapDialogOpen);
        setInspectorOpen(!compact || inspectorDialogOpen);
      }
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element, { box: "border-box" });
    observer?.observe(builder, { box: "border-box" });
    if (!observer) window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      if (!observer) window.removeEventListener("resize", measure);
      builder.style.removeProperty("--presentation-command-height");
      builder.style.removeProperty("--presentation-panel-width");
    };
  }, []);
  const recoveryKey = `presentation:${presentationId}`;
  const pendingSaveKey = `${recoveryKey}:pending-save`;
  const [record, setRecord] = useState<PresentationRecord | null>(null);
  const [presentChoiceOpen, setPresentChoiceOpen] = useState(false);
  const [draft, setDraft] = useState<PresentationDraft | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [selectedTextElementId, setSelectedTextElementId] = useState<string | null>(null);
  const [showLayoutGuides, setShowLayoutGuides] = useState(true);
  const [mapOpen, setMapOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [compactEditor, setCompactEditor] = useState(false);
  const [nativeInspectorTarget, setNativeInspectorTarget] = useState<HTMLDivElement | null>(null);
  const mapTrigger = useRef<HTMLButtonElement>(null);
  const inspectorTrigger = useRef<HTMLButtonElement>(null);
  const mapPanel = useRef<HTMLElement>(null);
  const inspectorPanel = useRef<HTMLElement>(null);
  const drawerOpener = useRef<HTMLElement | null>(null);
  function toggleMap() {
    if (compactEditor) setInspectorOpen(false);
    setMapOpen((value) => !value);
  }
  function toggleInspector() {
    if (compactEditor) setMapOpen(false);
    setInspectorOpen((value) => !value);
  }
  function closeEditorPanels(restoreFocus = false) {
    setMapOpen(false);
    setInspectorOpen(false);
    if (restoreFocus) {
      const opener = drawerOpener.current;
      requestAnimationFrame(() => (opener?.isConnected ? opener : mapTrigger.current)?.focus());
    }
  }
  useEffect(() => {
    if (!compactEditor || (!mapOpen && !inspectorOpen)) return;
    const panel = mapOpen ? mapPanel.current : inspectorPanel.current;
    const trigger = mapOpen ? mapTrigger.current : inspectorTrigger.current;
    if (!panel) return;
    // A breakpoint change can mount drawer behavior while a preview owns focus.
    // Preserve its active control and the original drawer opener until the modal closes.
    if (!document.querySelector(EDITOR_MODAL_SELECTOR)) {
      drawerOpener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : trigger;
      panel
        .querySelector<HTMLElement>("button:not(:disabled),[tabindex='0']")
        ?.focus({ preventScroll: true });
    }
    const outside = (event: Event) => {
      if (document.querySelector(EDITOR_MODAL_SELECTOR) || !(event.target instanceof Node)) return;
      if (event.target instanceof Element && event.target.closest("[data-editor-history]")) return;
      if (!panel.contains(event.target) && !trigger?.contains(event.target)) closeEditorPanels();
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.key !== "Escape" ||
        document.querySelector(EDITOR_MODAL_SELECTOR)
      )
        return;
      event.preventDefault();
      closeEditorPanels(true);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [compactEditor, mapOpen, inspectorOpen]);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("build");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewStartBlockId, setPreviewStartBlockId] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<"audience" | "presenter">("audience");
  const [previewOrigin, setPreviewOrigin] = useState<"interaction" | "notes" | "slide" | undefined>(
    undefined,
  );
  const [selectedActivityChoiceId, setSelectedActivityChoiceId] = useState<string | undefined>(
    undefined,
  );
  const acceptedInsertMenu = useRef<{ blockId: string; menu: HTMLDetailsElement } | null>(null);
  useEffect(() => {
    const pending = acceptedInsertMenu.current;
    if (!pending || !draft?.blocks.some((block) => block.id === pending.blockId)) return;
    acceptedInsertMenu.current = null;
    pending.menu.open = false;
    pending.menu.querySelector("summary")?.focus({ preventScroll: true });
  }, [draft]);
  function openDraftPreview() {
    setPreviewMode("audience");
    setPreviewOrigin(undefined);
    setPreviewStartBlockId(null);
    setPreviewOpen(true);
  }
  const [spatialOpen, setSpatialOpen] = useState(false);
  useEffect(() => {
    if (!canEdit) setSpatialOpen(false);
  }, [canEdit]);
  const [recoveryPreviewOpen, setRecoveryPreviewOpen] = useState(false);
  const [ordinarySavePending, setOrdinarySavePending] = useState(false);
  const [saveConflictPresent, setSaveConflictPresent] = useState(false);
  const [recovery, setRecovery] = useState<BuilderRecoverySnapshot<PresentationDraft> | null>(null);
  const [undoStack, setUndoStack] = useState<PresentationDraft[]>([]);
  const [redoStack, setRedoStack] = useState<PresentationDraft[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [roundSources, setRoundSources] = useState<RoundSource[]>([]);
  const [roundImportOpen, setRoundImportOpen] = useState(false);
  const roundImportMenuSource = useRef<HTMLButtonElement | undefined>(undefined);
  useEffect(() => {
    if (roundImportOpen) return;
    const source = roundImportMenuSource.current;
    roundImportMenuSource.current = undefined;
    handoffEditorDisclosure(source);
  }, [roundImportOpen]);
  const [sourceImportOpen, setSourceImportOpen] = useState(false);
  const [textAssistanceOpen, setTextAssistanceOpen] = useState(false);
  const [textAssistancePending, setTextAssistancePending] = useState(false);
  const [textAssistanceRecovery, setTextAssistanceRecovery] = useState(false);
  const [textAssistanceTarget, setTextAssistanceTarget] = useState<TextAssistanceTarget | null>(
    null,
  );
  const textAssistanceActive = useRef(false);
  textAssistanceActive.current = textAssistanceOpen || textAssistancePending;
  const [questionSuggestionsOpen, setQuestionSuggestionsOpen] = useState(false);
  const [questionSuggestionsPending, setQuestionSuggestionsPending] = useState(false);
  const [questionSuggestionsRecovery, setQuestionSuggestionsRecovery] = useState(false);
  const [questionSuggestionsTarget, setQuestionSuggestionsTarget] =
    useState<QuestionSuggestionsTarget | null>(null);
  const questionSuggestionsActive = useRef(false);
  questionSuggestionsActive.current = questionSuggestionsOpen || questionSuggestionsPending;
  const questionSuggestionsAuthorization = useRef(true);
  const publicationAuthorization = useRef(true);
  useEffect(() => {
    const changed = () => {
      questionSuggestionsAuthorization.current = false;
      publicationAuthorization.current = false;
    };
    window.addEventListener(AUTH_CHANGE_EVENT, changed);
    return () => window.removeEventListener(AUTH_CHANGE_EVENT, changed);
  }, []);
  const [assistanceOpen, setAssistanceOpen] = useState(false);
  const assistanceMenuSource = useRef<HTMLButtonElement | undefined>(undefined);
  useEffect(() => {
    if (assistanceOpen) return;
    const source = assistanceMenuSource.current;
    assistanceMenuSource.current = undefined;
    // Run after the dialog's focus cleanup and after the workspace loses inert.
    handoffEditorDisclosure(source);
  }, [assistanceOpen]);
  const [assistancePending, setAssistancePending] = useState(false);
  const [assistanceTarget, setAssistanceTarget] = useState({
    revision: 0,
    anchor: null as string | null,
  });
  const assistanceActive = useRef(false);
  assistanceActive.current = assistanceOpen || assistancePending;
  const outlineStartFailed = useRef(false);
  const outlineStartConsumed = useRef(false);
  const outlineStartReady = useRef(false);
  const assistancePermission = useRef(canEdit);
  assistancePermission.current = canEdit;
  const textRecoveryContext = `${creator?.userId ?? ""}:${creator?.workspaceId ?? ""}:${presentationId}`;
  const currentTextRecoveryContext = useRef(textRecoveryContext);
  currentTextRecoveryContext.current = textRecoveryContext;
  const [visualImportOpen, setVisualImportOpen] = useState(false);
  const [visualImportReceiptPending, setVisualImportReceiptPending] = useState(false);
  const visualImportActive = useRef(false);
  visualImportActive.current = visualImportOpen || visualImportReceiptPending;
  const [selectedRoundId, setSelectedRoundId] = useState("");
  const [publishedRound, setPublishedRound] = useState<PublishedRoundQuestionSource | null>(null);
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<string[]>([]);
  const [importingQuestions, setImportingQuestions] = useState(false);
  const [preparingImport, setPreparingImport] = useState(false);
  const importPreparation = useRef(false);
  const [mediaUploadsEnabled, setMediaUploadsEnabled] = useState(false);
  const [mediaState, setMediaState] = useState<"idle" | "uploading" | "scanning">("idle");
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState("");
  const [pendingNativeImage, setPendingNativeImage] = useState<NativeImageAttachment | null>(null);
  const pendingNativeImageRef = useRef<NativeImageAttachment | null>(null);
  const mediaUploadInFlight = useRef(false);
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
  const draftBaseRevision = useRef(0);
  const lastSavedJson = useRef("");
  const lastSavedServerJson = useRef("");
  const latestDraftJson = useRef("");
  const saveQueue = useRef(new RecoverableOperationQueue());
  const retainedSave = useRef(new RetainedPresentationSave());
  const saveConflict = useRef(false);
  const lastHistoryCommit = useRef<{ key: string; at: number } | null>(null);
  const roundImportDialogRef = useRef<HTMLDivElement>(null);
  const sourceImportDialogRef = useRef<HTMLDivElement>(null);
  const firstBlockTracked = useRef(false);
  const previousBlockCount = useRef<number | null>(null);
  const canInsertPack =
    canEdit && Boolean(productFeatures?.presentations && productFeatures?.recoveryPacks);
  // Pack review owns its exact update/undo retry; competing operations still fence the panel.
  const unrelatedEditorMutationBlocked =
    textAssistanceOpen ||
    questionSuggestionsOpen ||
    questionSuggestionsPending ||
    textAssistancePending ||
    assistanceOpen ||
    assistancePending ||
    packImportOpen ||
    visualImportOpen ||
    visualImportReceiptPending;
  const builderMutationBlocked =
    unrelatedEditorMutationBlocked || packUpdateBusy || packUpdateReceiptPending;
  const outlineStartBlocked =
    !loaded ||
    !record ||
    !draft ||
    !canEdit ||
    !productFeatures?.presentations ||
    recovery !== null ||
    !["idle", "saved"].includes(saveState) ||
    ordinarySavePending ||
    saveConflictPresent ||
    saveConflict.current ||
    retainedSave.current.pending !== null ||
    JSON.stringify(draft) !== lastSavedJson.current ||
    latestDraftJson.current !== lastSavedJson.current ||
    previewOpen ||
    spatialOpen ||
    recoveryPreviewOpen ||
    roundImportOpen ||
    sourceImportOpen ||
    builderMutationBlocked ||
    packBusy ||
    importingQuestions ||
    mediaState !== "idle" ||
    pendingNativeImage !== null;
  outlineStartReady.current = !outlineStartBlocked;
  const consumeOutlineStart = useCallback(() => {
    if (!startOutline || outlineStartConsumed.current) return;
    outlineStartConsumed.current = true;
    router.replace(`/presentation/${presentationId}`);
  }, [presentationId, router, startOutline]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const selectedBlock = draft?.blocks.find((block) => block.id === selectedBlockId) ?? null;
  const questionSuggestionSource = selectedBlock
    ? presentationQuestionSuggestionSource(selectedBlock)
    : null;
  const questionStarterContext = {
    actorKey: textRecoveryContext,
    presentationId,
    selectedBlockId,
    blocked:
      !loaded ||
      !canEdit ||
      builderMutationBlocked ||
      preparingImport ||
      importingQuestions ||
      roundImportOpen ||
      sourceImportOpen ||
      packBusy ||
      previewOpen ||
      spatialOpen ||
      recoveryPreviewOpen ||
      saveConflictPresent ||
      recovery !== null ||
      mediaState !== "idle" ||
      pendingNativeImage !== null,
  };
  const latestQuestionStarterContext = useRef(questionStarterContext);
  latestQuestionStarterContext.current = questionStarterContext;
  const questionStarterFocus = useRef<string | null>(null);
  useEffect(() => {
    if (!questionStarterFocus.current || questionSuggestionsOpen || questionSuggestionsPending)
      return;
    const target = questionStarterFocus.current;
    questionStarterFocus.current = null;
    if (target !== selectedBlockId || selectedBlock?.kind !== "question") return;
    document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Question prompt"]')?.focus();
  }, [selectedBlockId, selectedBlock?.kind, questionSuggestionsOpen, questionSuggestionsPending]);
  const selectedOpinionOnly =
    selectedBlock?.kind === "question" &&
    (isTextQuestion(selectedBlock.question.type) ||
      ["poll", "rating", "ranking"].includes(selectedBlock.question.type));
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
      loadBuilderRecovery<unknown>(pendingSaveKey),
    ])
      .then(([response, local, pending]) => {
        if (!active) return;
        setRecord(response.presentation);
        previousBlockCount.current = response.presentation.draft.blocks.length;
        firstBlockTracked.current = response.presentation.draft.blocks.length > 0;
        setDraft(response.presentation.draft);
        setSelectedBlockId(response.presentation.draft.blocks[0]?.id ?? null);
        revisionRef.current = response.presentation.draftRevision;
        draftBaseRevision.current = response.presentation.draftRevision;
        lastSavedJson.current = JSON.stringify(response.presentation.draft);
        lastSavedServerJson.current = lastSavedJson.current;
        latestDraftJson.current = lastSavedJson.current;
        let localDraft: PresentationDraft | null = null;
        if (local) {
          try {
            localDraft = normalizePresentationRecoveryDraft(local.draft);
            if (JSON.stringify(localDraft) !== lastSavedJson.current) {
              setRecovery({ ...local, draft: localDraft });
            }
          } catch {
            setError(
              "The saved local copy could not be restored. Your saved presentation is available.",
            );
          }
        }
        if (pending) {
          try {
            retainedSave.current.restore(pending.draft);
            const attempt = retainedSave.current.pending!;
            const working = localDraft ?? attempt.draft;
            draftBaseRevision.current =
              localDraft && JSON.stringify(localDraft) !== JSON.stringify(attempt.draft)
                ? local!.revision
                : attempt.expectedRevision;
            setDraft(working);
            setSelectedBlockId(working.blocks[0]?.id ?? null);
            latestDraftJson.current = JSON.stringify(working);
            if (latestDraftJson.current !== lastSavedJson.current) {
              setRecovery({
                key: recoveryKey,
                revision: local?.revision ?? attempt.expectedRevision,
                savedAt: local?.savedAt ?? pending.savedAt,
                draft: working,
              });
            }
            setOrdinarySavePending(true);
            setSaveState("error");
            setError(
              "A previous save is awaiting acknowledgement. Your local edits were recovered. Retry save to recover its exact receipt before newer changes are saved.",
            );
          } catch {
            setError(
              "The previous save receipt could not be recovered. Preserve the local copy before continuing.",
            );
            saveConflict.current = true;
            setSaveConflictPresent(true);
            setSaveState("conflict");
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
  }, [presentationId, recoveryKey, pendingSaveKey, router]);

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
    const dialog = sourceImportDialogRef.current;
    // A permission change can remove the focused proposal control. Retain the
    // initial opener above, while keeping keyboard commands inside the open dialog.
    if (sourceImportOpen && dialog && !dialog.contains(document.activeElement)) {
      (dialog.querySelector<HTMLButtonElement>("button") ?? dialog).focus({ preventScroll: true });
    }
  }, [sourceImportOpen, canEdit]);

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
        !assistancePermission.current ||
        textAssistanceActive.current ||
        questionSuggestionsActive.current ||
        importPreparation.current ||
        assistanceActive.current ||
        visualImportActive.current ||
        packOperation.current ||
        packPending.current ||
        packUpdateOperation.current ||
        packUpdatePending.current
      )
        return;
      setDraft((current) => {
        if (!current || !assistancePermission.current) return current;
        const next = reconcilePresentationSpatialBlocks(
          current,
          promotePresentationOpinionFormats(
            typeof value === "function" ? value(current) : value,
            current.schemaVersion,
          ),
        );
        if (next === current || JSON.stringify(next) === JSON.stringify(current)) return current;
        const now = Date.now();
        const previousHistoryCommit = lastHistoryCommit.current;
        const coalescesWithPreviousEdit =
          historyKey !== undefined &&
          previousHistoryCommit?.key === historyKey &&
          now - previousHistoryCommit.at <= TEXT_EDIT_COALESCE_MS;
        if (!coalescesWithPreviousEdit) {
          // React may replay this draft updater. Keep one checkpoint for the same snapshot.
          setUndoStack((history) =>
            history.at(-1) === current ? history : [...history, current].slice(-HISTORY_LIMIT),
          );
        }
        lastHistoryCommit.current = historyKey ? { key: historyKey, at: now } : null;
        setRedoStack([]);
        latestDraftJson.current = JSON.stringify(next);
        setSaveState("dirty");
        void saveBuilderRecovery(recoveryKey, draftBaseRevision.current, next).catch(
          () => undefined,
        );
        return next;
      });
    },
    [recoveryKey],
  );

  useEffect(() => {
    if (!draft || !pendingNativeImage) return;
    const status = nativeImageAttachmentStatus(draft, pendingNativeImage);
    if (status === "attached") {
      pendingNativeImageRef.current = null;
      setPendingNativeImage(null);
    } else if (status === "ready" && !builderMutationBlocked) {
      commit((current) => attachNativeImage(current, pendingNativeImage));
    }
  }, [draft, pendingNativeImage, builderMutationBlocked, commit]);

  const enqueueSave = useCallback(
    (candidate: PresentationDraft): Promise<void> => {
      const serialized = JSON.stringify(candidate);
      if (serialized === lastSavedJson.current && !retainedSave.current.pending)
        return Promise.resolve();
      setSaveState("saving");
      void saveBuilderRecovery(recoveryKey, draftBaseRevision.current, candidate).catch(
        () => undefined,
      );
      const queued = saveQueue.current.enqueue(async () => {
        if (saveConflict.current)
          throw new ApiClientError(
            "Your local changes were preserved. Review the current draft or duplicate the local copy before saving.",
            "STALE_DRAFT",
            409,
          );
        await retainedSave.current.save(candidate, {
          revision: () => revisionRef.current,
          savedJson: () => lastSavedJson.current,
          mutationId: clientUuid,
          beforeNewAttempt: () => {
            if (draftBaseRevision.current !== revisionRef.current)
              throw new ApiClientError(
                "This local copy is based on a different saved revision. Preview, download or duplicate it before continuing.",
                "STALE_DRAFT",
                409,
              );
          },
          persist: async (pending: PresentationDraftMutation | null) => {
            setOrdinarySavePending(pending !== null);
            if (pending)
              await saveBuilderRecovery(pendingSaveKey, pending.expectedRevision, pending);
            else await clearBuilderRecovery(pendingSaveKey);
          },
          send: (pending) =>
            retryWithBackoff(() =>
              apiFetch<{ presentation: PresentationRecord }>(
                `/v1/presentations/${presentationId}/draft`,
                { method: "PUT", body: JSON.stringify(pending) },
              ),
            ),
          definitiveFailure: (error) =>
            error instanceof ApiClientError &&
            error.status >= 400 &&
            error.status < 500 &&
            ![408, 425, 429].includes(error.status),
          accepted: (response, pending) => {
            const acceptedJson = JSON.stringify(response.presentation.draft);
            if (
              response.presentation.draftRevision < revisionRef.current ||
              (response.presentation.draftRevision === revisionRef.current &&
                lastSavedServerJson.current !== acceptedJson)
            ) {
              throw new ApiClientError(
                "The save receipt was recovered, but another saved revision is newer. Your local work was preserved; review or duplicate it before continuing.",
                "STALE_DRAFT",
                409,
              );
            }
            const attemptedJson = JSON.stringify(pending.draft);
            if (
              draftBaseRevision.current !== pending.expectedRevision &&
              latestDraftJson.current !== attemptedJson
            )
              throw new ApiClientError(
                "The save receipt was recovered, but this local copy has a different base revision. Preview or duplicate it before continuing.",
                "STALE_DRAFT",
                409,
              );
            revisionRef.current = response.presentation.draftRevision;
            draftBaseRevision.current = response.presentation.draftRevision;
            lastSavedJson.current = attemptedJson;
            lastSavedServerJson.current = acceptedJson;
            setRecord(response.presentation);
            setRecovery((current) =>
              current?.revision === pending.expectedRevision
                ? { ...current, revision: response.presentation.draftRevision }
                : current,
            );
            setSaveState(latestDraftJson.current === attemptedJson ? "saved" : "dirty");
            setError("");
          },
        });
        lastSavedJson.current = serialized;
        setSaveState(latestDraftJson.current === serialized ? "saved" : "dirty");
        setError("");
        if (latestDraftJson.current === lastSavedJson.current) {
          await clearBuilderRecovery(recoveryKey).catch(() => undefined);
        } else {
          await saveBuilderRecovery(
            recoveryKey,
            revisionRef.current,
            normalizePresentationRecoveryDraft(JSON.parse(latestDraftJson.current)),
          ).catch(() => undefined);
        }
      });
      void queued.catch((caught) => {
        const conflict =
          caught instanceof ApiClientError &&
          (caught.code === "STALE_DRAFT" || caught.status === 409 || caught.status === 412);
        if (conflict) {
          saveConflict.current = true;
          setSaveConflictPresent(true);
          retainedSave.current.clear();
          setOrdinarySavePending(false);
          void clearBuilderRecovery(pendingSaveKey).catch(() => undefined);
        }
        recordAuthoringEvent(conflict ? "draft_conflict" : "draft_save_failed", "presentation");
        setSaveState(conflict ? "conflict" : "error");
        setError(humanError(caught));
      });
      return queued;
    },
    [presentationId, recoveryKey, pendingSaveKey],
  );

  useEffect(() => {
    if (
      !loaded ||
      !draft ||
      saveConflictPresent ||
      textAssistanceOpen ||
      questionSuggestionsOpen ||
      questionSuggestionsPending ||
      textAssistancePending ||
      preparingImport ||
      assistanceOpen ||
      assistancePending ||
      packImportOpen ||
      packUpdateBusy ||
      packUpdateReceiptPending ||
      visualImportOpen ||
      visualImportReceiptPending
    )
      return;
    const serialized = JSON.stringify(draft);
    if (serialized === lastSavedJson.current && !retainedSave.current.pending) return;
    setSaveState("dirty");
    const timer = window.setTimeout(() => void enqueueSave(draft), 700);
    return () => window.clearTimeout(timer);
  }, [
    draft,
    enqueueSave,
    loaded,
    saveConflictPresent,
    textAssistanceOpen,
    questionSuggestionsOpen,
    questionSuggestionsPending,
    textAssistancePending,
    preparingImport,
    assistanceOpen,
    assistancePending,
    packImportOpen,
    packUpdateBusy,
    packUpdateReceiptPending,
    visualImportOpen,
    visualImportReceiptPending,
  ]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (
        saveState === "dirty" ||
        saveState === "saving" ||
        saveState === "error" ||
        saveState === "conflict" ||
        packPending.current !== null ||
        packUpdatePending.current !== null ||
        mediaState !== "idle" ||
        pendingNativeImage !== null ||
        ordinarySavePending ||
        textAssistancePending ||
        questionSuggestionsPending ||
        assistancePending ||
        visualImportReceiptPending
      ) {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [
    saveState,
    packRetryVersionId,
    packUpdateReceiptPending,
    mediaState,
    pendingNativeImage,
    ordinarySavePending,
    textAssistancePending,
    questionSuggestionsPending,
    assistancePending,
    visualImportReceiptPending,
  ]);

  function guardBuilderExit(event: MouseEvent<HTMLAnchorElement>) {
    if (!draft) return;
    const needsRecovery =
      latestDraftJson.current !== lastSavedJson.current ||
      saveState === "dirty" ||
      saveState === "saving" ||
      saveState === "error" ||
      saveState === "conflict";
    const hasPendingImage = mediaState !== "idle" || pendingNativeImage !== null;
    if (!needsRecovery && !hasPendingImage) return;
    void saveBuilderRecovery(recoveryKey, draftBaseRevision.current, draft).catch(() => undefined);
    if (
      !window.confirm(
        hasPendingImage
          ? "An image upload or attachment is still pending. Leaving the Builder can discard it. Draft changes have a recovery copy on this device. Leave the Builder?"
          : "This Presentation still has changes that are pending, failed, or conflicted. A recovery copy has been kept on this device. Leave the Builder?",
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
    if (!selectedBlockId) return;
    commit(
      (current) => updatePresentationQuestion(current, selectedBlockId, updater),
      historyField ? `${selectedBlockId}:question:${historyField}` : undefined,
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

  function changeSpeakerNotes(value: string) {
    updateSelected(
      (block) => (block.kind === "content" ? { ...block, speakerNotes: value } : block),
      "speakerNotes",
    );
  }
  function openSelectedPreview(mode: "audience" | "presenter", origin: "notes" | "slide") {
    if (!selectedBlock || (selectedBlock.kind === "content" && selectedBlock.hidden)) return;
    setPreviewMode(mode);
    setPreviewOrigin(origin);
    setPreviewStartBlockId(selectedBlock.id);
    setPreviewOpen(true);
  }
  function addBlock(block: PresentationBlockDraft, source?: HTMLButtonElement) {
    if (!draft || !canEdit || builderMutationBlocked || preparingImport) return;
    const menu = source?.closest("details");
    if (menu) acceptedInsertMenu.current = { blockId: block.id, menu };
    commit((current) => {
      const selectedIndex = current.blocks.findIndex((item) => item.id === selectedBlockId);
      const created =
        block.kind === "content" && block.scene
          ? {
              ...block,
              scene: applyNativeSceneDesign(
                block.scene,
                inheritPresentationSceneDesign(current.blocks, selectedBlockId),
              ),
            }
          : block;
      const blocks = [...current.blocks];
      blocks.splice(selectedIndex < 0 ? blocks.length : selectedIndex + 1, 0, created);
      return {
        ...current,
        blocks,
        ...(created.kind === "content" && created.scene
          ? {
              schemaVersion: nativeSceneDocumentVersion(current.schemaVersion, created.scene),
            }
          : {}),
      };
    });
    setSelectedBlockId(block.id);
    setInspectorTab(block.kind === "content" ? "content" : "build");
  }

  function undo() {
    if (
      !assistancePermission.current ||
      importPreparation.current ||
      textAssistanceActive.current ||
      questionSuggestionsActive.current ||
      assistanceActive.current ||
      packOperation.current ||
      packPending.current ||
      packUpdateOperation.current ||
      packUpdatePending.current
    )
      return;
    const checkpoint = undoStack.at(-1);
    if (!checkpoint || !draft) return;
    const previous = promotePresentationOpinionFormats(checkpoint, draft.schemaVersion);
    setRedoStack((history) => [...history, draft].slice(-HISTORY_LIMIT));
    setUndoStack((history) => history.slice(0, -1));
    lastHistoryCommit.current = null;
    setDraft(previous);
    latestDraftJson.current = JSON.stringify(previous);
    setSaveState("dirty");
    void saveBuilderRecovery(recoveryKey, draftBaseRevision.current, previous).catch(
      () => undefined,
    );
    if (!previous.blocks.some((block) => block.id === selectedBlockId)) {
      setSelectedBlockId(previous.blocks[0]?.id ?? null);
    }
  }

  function redo() {
    if (
      !assistancePermission.current ||
      importPreparation.current ||
      textAssistanceActive.current ||
      questionSuggestionsActive.current ||
      assistanceActive.current ||
      packOperation.current ||
      packPending.current ||
      packUpdateOperation.current ||
      packUpdatePending.current
    )
      return;
    const checkpoint = redoStack.at(-1);
    if (!checkpoint || !draft) return;
    const next = promotePresentationOpinionFormats(checkpoint, draft.schemaVersion);
    setUndoStack((history) => [...history, draft].slice(-HISTORY_LIMIT));
    setRedoStack((history) => history.slice(0, -1));
    lastHistoryCommit.current = null;
    setDraft(next);
    latestDraftJson.current = JSON.stringify(next);
    setSaveState("dirty");
    void saveBuilderRecovery(recoveryKey, draftBaseRevision.current, next).catch(() => undefined);
  }

  async function reloadLatestDraft(
    preferredBlockId?: string,
    exactTextTarget?: Pick<
      TextAssistanceRecovery,
      "blockId" | "nodeId" | "role" | "sourceDigest" | "operation" | "sourceLanguage"
    >,
    textPermissionFence = false,
    recoveryReset?: { canAdopt: () => boolean; preserveWorkingDraft: () => boolean },
    exactQuestionSource?: { blockId: string; sourceDigest: string },
    questionRead?: {
      canAdopt: () => boolean;
      minimumRevision: number;
      acceptedDraft?: PresentationDraft;
    },
  ) {
    if (retainedSave.current.pending && !recoveryReset) {
      setError("Retry the outstanding save acknowledgement before loading another draft.");
      return false;
    }
    const local = draft;
    const localWasSaved = local !== null && JSON.stringify(local) === lastSavedJson.current;
    const localRevision = draftBaseRevision.current;
    setSaveState("saving");
    setError("");
    try {
      const response = await apiFetch<{ presentation: PresentationRecord }>(
        `/v1/presentations/${presentationId}`,
        { cache: "no-store" },
      );
      if (questionRead) {
        if (!questionRead.canAdopt()) return false;
        if (
          typeof response.presentation?.id !== "string" ||
          !sameTextAssistanceBlockId(response.presentation.id, presentationId) ||
          !Number.isSafeInteger(questionRead.minimumRevision) ||
          questionRead.minimumRevision < 0 ||
          !Number.isSafeInteger(response.presentation.draftRevision) ||
          response.presentation.draftRevision <
            Math.max(questionRead.minimumRevision, revisionRef.current, draftBaseRevision.current)
        )
          throw new Error(
            "The saved deck read is invalid or older than the reviewed request. Recover the latest saved deck before continuing.",
          );
        response.presentation.draft = PresentationDraftSchema.parse(response.presentation.draft);
        if (
          questionRead.acceptedDraft &&
          response.presentation.draftRevision === questionRead.minimumRevision &&
          JSON.stringify(response.presentation.draft) !==
            JSON.stringify(PresentationDraftSchema.parse(questionRead.acceptedDraft))
        )
          throw new Error(
            "The saved deck does not match the accepted insertion. Retry receipt recovery before editing.",
          );
      }
      if (recoveryReset) {
        if (!recoveryReset.canAdopt()) return false;
        if (
          !sameTextAssistanceBlockId(response.presentation.id, presentationId) ||
          !Number.isInteger(response.presentation.draftRevision) ||
          response.presentation.draftRevision < 0
        )
          throw new Error(
            "The current saved deck could not be verified. The invalid recovery record is retained.",
          );
        const serverJson = JSON.stringify(response.presentation.draft);
        response.presentation.draft = PresentationDraftSchema.parse(response.presentation.draft);
        if (recoveryReset.preserveWorkingDraft()) {
          if (response.presentation.draftRevision < revisionRef.current)
            throw new Error(
              "The saved deck read was older than the current editor state. Retry loading before clearing recovery.",
            );
          // Other exact receipts still own the working copy. Observe the current server revision
          // without replacing their local work, so historical acknowledgements cannot save over it.
          revisionRef.current = response.presentation.draftRevision;
          lastSavedServerJson.current = serverJson;
          setRecord(response.presentation);
          setSaveState("error");
          setError(
            "The current saved deck was checked. Recover the other outstanding receipt to continue; your local work is retained.",
          );
          return {
            draft: response.presentation.draft,
            revision: response.presentation.draftRevision,
            anchor: selectedBlockId,
          };
        }
        if (
          local &&
          !localWasSaved &&
          recovery &&
          JSON.stringify(recovery.draft) !== JSON.stringify(local)
        )
          throw new Error(
            "Preserve the current local changes before clearing text recovery. The existing local recovery copy is retained.",
          );
        if (
          local &&
          !localWasSaved &&
          JSON.stringify(local) !== JSON.stringify(response.presentation.draft)
        )
          await saveBuilderRecovery(recoveryKey, localRevision, local);
        if (!recoveryReset.canAdopt()) return false;
      }
      if (textPermissionFence && (!alive.current || !assistancePermission.current)) return false;
      if (exactQuestionSource) {
        const block = response.presentation.draft.blocks.find((candidate) =>
          sameTextAssistanceBlockId(candidate.id, exactQuestionSource.blockId),
        );
        const source = block ? presentationQuestionSuggestionSource(block) : null;
        if (
          !source?.supported ||
          presentationQuestionSuggestionsSourceDigest(source.source) !==
            exactQuestionSource.sourceDigest
        )
          throw new Error(
            "The exact slide text or its language changed. Discard this proposal and review the current slide before generating again.",
          );
      }
      if (exactTextTarget) {
        const block = response.presentation.draft.blocks.find((block) =>
          sameTextAssistanceBlockId(block.id, exactTextTarget.blockId),
        );
        const node =
          block?.kind === "content"
            ? block.scene?.nodes.find((node) => node.id === exactTextTarget.nodeId)
            : null;
        if (
          node?.type !== "text" ||
          node.richText ||
          node.role !== exactTextTarget.role ||
          presentationTextAssistanceSourceDigest(node.text) !== exactTextTarget.sourceDigest ||
          (exactTextTarget.operation === "translate" &&
            (node.lang ?? null) !== exactTextTarget.sourceLanguage)
        ) {
          throw new Error(
            exactTextTarget.operation === "translate"
              ? "The exact text object or its language was changed or deleted. Discard this proposal and select text for a new request."
              : "The exact text object was changed or deleted. Discard this proposal and select text for a new request.",
          );
        }
      }
      const target = {
        draft: response.presentation.draft,
        revision: response.presentation.draftRevision,
        anchor:
          (preferredBlockId
            ? response.presentation.draft.blocks.find((block) =>
                sameTextAssistanceBlockId(block.id, preferredBlockId),
              )?.id
            : null) ??
          response.presentation.draft.blocks[0]?.id ??
          null,
      };
      setRecord(response.presentation);
      setDraft(response.presentation.draft);
      setSelectedBlockId(target.anchor);
      setUndoStack([]);
      setRedoStack([]);
      lastHistoryCommit.current = null;
      revisionRef.current = response.presentation.draftRevision;
      draftBaseRevision.current = response.presentation.draftRevision;
      lastSavedJson.current = JSON.stringify(response.presentation.draft);
      lastSavedServerJson.current = lastSavedJson.current;
      latestDraftJson.current = lastSavedJson.current;
      saveConflict.current = false;
      setSaveConflictPresent(false);
      setSaveState("saved");
      if (local && !localWasSaved && JSON.stringify(local) !== lastSavedJson.current) {
        const snapshot = {
          key: recoveryKey,
          revision: localRevision,
          draft: local,
          savedAt: new Date().toISOString(),
        };
        setRecovery(snapshot);
        if (!recoveryReset) await saveBuilderRecovery(recoveryKey, localRevision, local);
      } else if (!recoveryReset) {
        setRecovery(null);
        await clearBuilderRecovery(recoveryKey);
      }
      return target;
    } catch (caught) {
      setError(humanError(caught));
      setSaveState("error");
      if (exactTextTarget || exactQuestionSource) throw caught;
      return false;
    }
  }

  function downloadLocalCopy(source: PresentationDraft) {
    const blob = new Blob([JSON.stringify(source, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${source.title.trim() || "untitled-presentation"}-local-copy.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function preserveLocalCopy() {
    if (draft) downloadLocalCopy(draft);
  }

  async function duplicateLocalDraft(source: PresentationDraft | null = draft) {
    if (!source) return;
    setError("");
    try {
      const title = `${source.title.trim() || t("delivery.presentationBuilder.untitled")} — ${formatDateTime(locale, Date.now())}`;
      const created = await apiFetch<{ presentation: PresentationRecord }>("/v1/presentations", {
        method: "POST",
        body: JSON.stringify({ title, description: source.description ?? "" }),
      });
      await apiFetch<{ presentation: PresentationRecord }>(
        `/v1/presentations/${created.presentation.id}/draft`,
        {
          method: "PUT",
          body: JSON.stringify({
            draft: { ...source, title },
            expectedRevision: created.presentation.draftRevision,
            mutationId: clientUuid(),
            schemaVersion: 2,
          }),
        },
      );
      if (!retainedSave.current.pending && JSON.stringify(source) === latestDraftJson.current) {
        await clearBuilderRecovery(recoveryKey);
      }
      router.push(`/presentation/${created.presentation.id}`);
    } catch (caught) {
      setError(humanError(caught));
    }
  }

  async function uploadSelectedImage(file: File | null, nativeAltText?: string) {
    if (
      !file ||
      !selectedBlock ||
      mediaState !== "idle" ||
      mediaUploadInFlight.current ||
      pendingNativeImageRef.current
    )
      return;
    if (
      nativeAltText !== undefined &&
      (selectedBlock.kind !== "content" ||
        !selectedBlock.scene ||
        selectedBlock.scene.nodes.length >= PRESENTATION_SCENE_MAX_NODES)
    ) {
      setError("Remove an object before uploading another native image.");
      return;
    }
    const altText =
      nativeAltText ??
      (selectedBlock.kind === "content"
        ? selectedBlock.mediaAlt?.trim()
        : selectedBlock.question.mediaAlt?.trim());
    if (!altText) {
      setError("Describe the instructional image before uploading it.");
      return;
    }
    const blockId = selectedBlock.id;
    const nativeNodeId = nativeAltText !== undefined ? clientUuid() : null;
    mediaUploadInFlight.current = true;
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
      if (nativeNodeId) {
        const attachment = { blockId, nodeId: nativeNodeId, mediaId: ticket.mediaId, altText };
        pendingNativeImageRef.current = attachment;
        setPendingNativeImage(attachment);
      } else {
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
      }
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      mediaUploadInFlight.current = false;
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

  function openRoundImport(source?: HTMLButtonElement) {
    if (
      importPreparation.current ||
      packOperation.current ||
      packImportOpen ||
      textAssistanceActive.current ||
      questionSuggestionsActive.current ||
      visualImportActive.current ||
      sourceImportOpen ||
      packUpdateOperation.current ||
      packUpdatePending.current
    )
      return;
    const first = roundSources[0]?.id ?? "";
    roundImportMenuSource.current = source;
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
      textAssistanceActive.current ||
      questionSuggestionsActive.current ||
      visualImportActive.current ||
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
          mutationId: clientUuid(),
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
      draftBaseRevision.current = response.presentation.draftRevision;
      lastSavedJson.current = JSON.stringify(response.presentation.draft);
      lastSavedServerJson.current = lastSavedJson.current;
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
      textAssistanceActive.current ||
      questionSuggestionsActive.current ||
      visualImportActive.current ||
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
      textAssistanceActive.current ||
      questionSuggestionsActive.current ||
      visualImportActive.current ||
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
      draftBaseRevision.current = next.draftRevision;
      lastSavedJson.current = JSON.stringify(next.draft);
      lastSavedServerJson.current = lastSavedJson.current;
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
      !alive.current ||
      !assistancePermission.current ||
      !draft ||
      importPreparation.current ||
      packOperation.current ||
      packUpdateOperation.current ||
      packUpdatePending.current ||
      packImportOpen ||
      roundImportOpen ||
      sourceImportOpen ||
      textAssistanceActive.current ||
      questionSuggestionsActive.current ||
      visualImportActive.current
    )
      return;
    importPreparation.current = true;
    setPreparingImport(true);
    setError("");
    try {
      await enqueueSave(draft);
      if (!alive.current || !assistancePermission.current) return;
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

  const prepareVisualInsertion = useCallback(async () => {
    if (!draft || saveConflict.current || packPending.current || packUpdatePending.current) {
      throw new Error("Resolve the outstanding draft save before inserting visual slides.");
    }
    await saveQueue.current.enqueue(async () => undefined);
    await enqueueSave(draft);
    await saveQueue.current.enqueue(async () => undefined);
    if (
      retainedSave.current.pending ||
      saveConflict.current ||
      lastSavedJson.current !== JSON.stringify(draft) ||
      latestDraftJson.current !== lastSavedJson.current
    ) {
      throw new Error("Save the latest Presentation changes before inserting visual slides.");
    }
    return revisionRef.current;
  }, [draft, enqueueSave]);

  const openAssistance = useCallback(
    async (automatic = false, source?: HTMLButtonElement) => {
      if (
        !draft ||
        !canEdit ||
        importPreparation.current ||
        textAssistanceActive.current ||
        questionSuggestionsActive.current ||
        assistanceActive.current ||
        packOperation.current ||
        packPending.current ||
        packUpdateOperation.current ||
        packUpdatePending.current ||
        packImportOpen ||
        roundImportOpen ||
        sourceImportOpen ||
        visualImportActive.current ||
        mediaState !== "idle" ||
        pendingNativeImageRef.current
      )
        return;
      importPreparation.current = true;
      setPreparingImport(true);
      setError("");
      try {
        const revision = await prepareVisualInsertion();
        if (
          !alive.current ||
          !assistancePermission.current ||
          (automatic && !outlineStartReady.current)
        )
          return;
        setAssistanceTarget({ revision, anchor: selectedBlockId });
        assistanceActive.current = true;
        assistanceMenuSource.current = source;
        setAssistanceOpen(true);
        consumeOutlineStart();
      } catch (caught) {
        // A real preparation failure requires the author's manual retry. Temporary readiness
        // changes above leave the handoff pending until the editor is ready again.
        if (automatic) outlineStartFailed.current = true;
        if (alive.current) setError(humanError(caught));
      } finally {
        importPreparation.current = false;
        if (alive.current) setPreparingImport(false);
      }
    },
    [
      draft,
      canEdit,
      packImportOpen,
      roundImportOpen,
      sourceImportOpen,
      mediaState,
      prepareVisualInsertion,
      selectedBlockId,
      consumeOutlineStart,
    ],
  );

  useEffect(() => {
    if (
      !startOutline ||
      outlineStartConsumed.current ||
      outlineStartFailed.current ||
      outlineStartBlocked ||
      preparingImport ||
      importPreparation.current
    )
      return;
    void openAssistance(true);
  }, [startOutline, outlineStartBlocked, preparingImport, openAssistance]);

  async function openTextAssistance(nodeId: string, operation: TextAssistanceTarget["operation"]) {
    if (textAssistanceRecovery) {
      setTextAssistanceOpen(true);
      return;
    }
    if (
      !draft ||
      !canEdit ||
      !selectedBlockId ||
      builderMutationBlocked ||
      importPreparation.current ||
      assistanceActive.current ||
      visualImportActive.current ||
      packOperation.current ||
      packPending.current ||
      packUpdateOperation.current ||
      packUpdatePending.current ||
      roundImportOpen ||
      sourceImportOpen ||
      mediaState !== "idle" ||
      pendingNativeImageRef.current
    )
      return;
    const blockId = selectedBlockId.toLowerCase();
    const sourceBlock = draft.blocks.find((block) => sameTextAssistanceBlockId(block.id, blockId));
    const sourceNode =
      sourceBlock?.kind === "content"
        ? sourceBlock.scene?.nodes.find((node) => node.id === nodeId)
        : null;
    if (sourceNode?.type !== "text" || sourceNode.richText || !sourceNode.text.trim()) return;
    importPreparation.current = true;
    setPreparingImport(true);
    setError("");
    try {
      const expectedRevision = await prepareVisualInsertion();
      if (!alive.current || !assistancePermission.current) return;
      const savedDraft = JSON.parse(lastSavedJson.current) as PresentationDraft;
      const savedBlock = savedDraft.blocks.find((block) =>
        sameTextAssistanceBlockId(block.id, blockId),
      );
      const savedNode =
        savedBlock?.kind === "content"
          ? savedBlock.scene?.nodes.find((node) => node.id === nodeId)
          : null;
      if (
        savedNode?.type !== "text" ||
        savedNode.richText ||
        savedNode.role !== sourceNode.role ||
        savedNode.text !== sourceNode.text ||
        (operation === "translate" && savedNode.lang !== sourceNode.lang)
      )
        throw new Error(
          "The exact selected text could not be saved. Retry after saving your changes.",
        );
      setTextAssistanceTarget({
        blockId,
        nodeId,
        role: savedNode.role,
        text: savedNode.text,
        operation,
        expectedRevision,
        ...(operation === "translate" ? { sourceLanguage: savedNode.lang ?? null } : {}),
      });
      textAssistanceActive.current = true;
      setTextAssistanceOpen(true);
    } catch (caught) {
      if (alive.current) setError(humanError(caught));
    } finally {
      importPreparation.current = false;
      if (alive.current) setPreparingImport(false);
    }
  }

  async function openQuestionSuggestions() {
    if (
      !alive.current ||
      !assistancePermission.current ||
      !questionSuggestionsAuthorization.current ||
      !draft ||
      !canEdit ||
      questionSuggestionsOpen ||
      importPreparation.current ||
      textAssistanceActive.current ||
      assistanceActive.current ||
      visualImportActive.current ||
      packOperation.current ||
      packPending.current ||
      packUpdateOperation.current ||
      packUpdatePending.current ||
      pendingNativeImageRef.current ||
      mediaState !== "idle" ||
      previewOpen ||
      spatialOpen ||
      recoveryPreviewOpen ||
      packImportOpen ||
      packBusy ||
      packUpdateBusy ||
      importingQuestions ||
      roundImportOpen ||
      sourceImportOpen
    )
      return;
    const resuming = questionSuggestionsRecovery;
    // An uncertain insertion owns the server revision; recover it before any ordinary save.
    if (resuming && questionSuggestionsPending) {
      questionSuggestionsActive.current = true;
      setQuestionSuggestionsOpen(true);
      return;
    }
    if (questionSuggestionsActive.current) return;
    if (
      recovery !== null ||
      saveConflict.current ||
      (!resuming &&
        (!selectedBlockId ||
          questionStarterContext.blocked ||
          !questionSuggestionSource?.supported))
    )
      return;
    const selectedSource =
      !resuming && questionSuggestionSource?.supported ? questionSuggestionSource.source : null;
    const sourceDigest = selectedSource
      ? presentationQuestionSuggestionsSourceDigest(selectedSource)
      : null;
    const blockId = resuming
      ? (questionSuggestionsTarget?.blockId ?? null)
      : selectedBlockId!.toLowerCase();
    const context = textRecoveryContext;
    importPreparation.current = true;
    setPreparingImport(true);
    setError("");
    try {
      const expectedRevision = await prepareVisualInsertion();
      if (
        !alive.current ||
        !assistancePermission.current ||
        !questionSuggestionsAuthorization.current ||
        currentTextRecoveryContext.current !== context ||
        (!resuming &&
          latestQuestionStarterContext.current.selectedBlockId?.toLowerCase() !== blockId)
      )
        return;
      const saved = JSON.parse(lastSavedJson.current) as PresentationDraft;
      const block = blockId
        ? saved.blocks.find((candidate) => sameTextAssistanceBlockId(candidate.id, blockId))
        : null;
      const source = block ? presentationQuestionSuggestionSource(block) : null;
      if (
        !resuming &&
        (!source?.supported ||
          presentationQuestionSuggestionsSourceDigest(source.source) !== sourceDigest)
      )
        throw new Error(
          "The exact slide text could not be saved. Retry after saving your changes.",
        );
      // Resuming a proposal also saves manual edits. A changed source remains visible to the
      // controller as a mismatch, rather than inserting against a stale saved copy.
      setQuestionSuggestionsTarget(
        source?.supported
          ? {
              blockId: source.source.blockId,
              expectedRevision,
              source: source.source,
              sourceDigest: presentationQuestionSuggestionsSourceDigest(source.source),
            }
          : null,
      );
      questionSuggestionsActive.current = true;
      setQuestionSuggestionsOpen(true);
    } catch (caught) {
      if (alive.current) setError(humanError(caught));
    } finally {
      importPreparation.current = false;
      if (alive.current) setPreparingImport(false);
    }
  }

  function openVisualImport() {
    if (
      importPreparation.current ||
      packOperation.current ||
      packPending.current ||
      packUpdateOperation.current ||
      packUpdatePending.current ||
      sourceImportOpen ||
      roundImportOpen ||
      textAssistanceActive.current ||
      questionSuggestionsActive.current ||
      assistanceActive.current ||
      packImportOpen ||
      mediaState !== "idle" ||
      pendingNativeImageRef.current
    )
      return;
    setVisualImportOpen(true);
  }

  function toggleImportedQuestion(questionId: string) {
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
          mutationId: clientUuid(),
        }),
      });
      if (draft) setUndoStack((history) => [...history, draft].slice(-HISTORY_LIMIT));
      setRedoStack([]);
      lastHistoryCommit.current = null;
      setRecord(response.presentation);
      setDraft(response.presentation.draft);
      revisionRef.current = response.presentation.draftRevision;
      draftBaseRevision.current = response.presentation.draftRevision;
      lastSavedJson.current = JSON.stringify(response.presentation.draft);
      lastSavedServerJson.current = lastSavedJson.current;
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
    if (
      !draft ||
      !alive.current ||
      !publicationAuthorization.current ||
      !assistancePermission.current
    )
      return false;
    if (
      builderMutationBlocked ||
      preparingImport ||
      packUpdateOperation.current ||
      packUpdatePending.current
    ) {
      setError("Finish or recover the current operation before publishing.");
      return false;
    }
    if (mediaState !== "idle" || pendingNativeImage) {
      setError("Finish or discard the pending image attachment before publishing.");
      return false;
    }
    if (issues.length) {
      recordAuthoringEvent("publish_blocked", "presentation");
      setInspectorOpen(true);
      setInspectorTab("readiness");
      setError("Resolve the readiness issues before publishing.");
      return false;
    }
    setError("");
    try {
      await enqueueSave(draft);
      if (!alive.current || !publicationAuthorization.current || !assistancePermission.current)
        return false;
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
      if (!alive.current || !publicationAuthorization.current || !assistancePermission.current)
        return false;
      setRecord(response.presentation);
      setSaveState("saved");
      return true;
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
      return false;
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

  // Keep stored errors canonical; only explicit system feedback is projected at render.
  const sourceWorkflowError = [
    sourceWorkflowsFeedback(locale, error),
    questionStartersFeedback(locale, error),
    questionSuggestionsFeedback(locale, error),
    visualImportFeedback(locale, error),
  ].find((feedback) => feedback.lang === locale) ?? { text: error, lang: "en-CA" };

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

  const saveLabel =
    saveState === "saving"
      ? t("delivery.common.saving")
      : saveState === "dirty"
        ? t("delivery.presentationBuilder.unsaved")
        : saveState === "error"
          ? t("delivery.builder.saveFailed")
          : saveState === "conflict"
            ? t("delivery.presentationBuilder.newerVersion")
            : t("delivery.common.saved");
  const hasUnpublishedChanges =
    record.hasUnpublishedChanges ||
    (record.currentVersionId !== null && JSON.stringify(draft) !== lastSavedJson.current);

  return (
    <div className={styles.builder}>
      <a className={styles.skipLink} href="#presentation-canvas">
        {t("delivery.presentationBuilder.skipCanvas")}
      </a>
      <header
        ref={commandBarRef}
        className={styles.commandBar}
        inert={builderMutationBlocked || preparingImport}
      >
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
            aria-label={t("delivery.presentationBuilder.library")}
            title={t("delivery.presentationBuilder.library")}
          >
            <EditorIcon name="back" />
            <span className={styles.exitLabel}>{t("delivery.presentationBuilder.library")}</span>
          </Link>
          <button
            ref={mapTrigger}
            aria-expanded={mapOpen}
            aria-controls="presentation-slide-navigator"
            aria-label={
              mapOpen
                ? t("delivery.presentationBuilder.hideMap")
                : t("delivery.presentationBuilder.openMap")
            }
            title={
              mapOpen
                ? t("delivery.presentationBuilder.hideMap")
                : t("delivery.presentationBuilder.openMap")
            }
            className={styles.iconButton}
            onClick={toggleMap}
            type="button"
          >
            <EditorIcon name="slides" />
          </button>
          <button
            ref={inspectorTrigger}
            aria-expanded={inspectorOpen}
            aria-controls="presentation-object-inspector"
            className={styles.iconButton}
            onClick={toggleInspector}
            type="button"
            aria-label={
              inspectorOpen
                ? t("delivery.presentationBuilder.hideInspector")
                : t("delivery.presentationBuilder.openInspector")
            }
            title={
              inspectorOpen
                ? t("delivery.presentationBuilder.hideInspector")
                : t("delivery.presentationBuilder.openInspector")
            }
          >
            <EditorIcon name="inspector" />
          </button>
        </div>
        <div className={styles.documentIdentity}>
          <label className={styles.titleField}>
            <span className="sr-only">{t("delivery.presentationBuilder.titleLabel")}</span>
            <input
              lang={draft.title.trim() ? "" : locale}
              maxLength={160}
              onChange={(event) =>
                commit(
                  (current) => ({ ...current, title: event.target.value }),
                  "presentation:title",
                )
              }
              placeholder={t("delivery.presentationBuilder.untitled")}
              value={draft.title}
            />
          </label>
          <div className={styles.documentState}>
            <span className={`${styles.saveStatus} ${styles[`save_${saveState}`]}`} role="status">
              {saveLabel}
            </span>
            <span className={styles.publicationState} lang={locale}>
              {!record.currentVersionId
                ? authoring.draft
                : hasUnpublishedChanges
                  ? authoring.unpublished
                  : authoring.publishedReady}
            </span>
          </div>
        </div>
        <div className={styles.commandActions}>
          <div className={styles.historyActions} data-editor-history>
            <button
              className={styles.iconButton}
              disabled={!canEdit || !undoStack.length}
              onClick={undo}
              type="button"
              aria-label={t("delivery.builder.undo")}
              title={t("delivery.builder.undo")}
            >
              <EditorIcon name="undo" />
            </button>
            <button
              className={styles.iconButton}
              disabled={!canEdit || !redoStack.length}
              onClick={redo}
              type="button"
              aria-label={t("delivery.builder.redo")}
              title={t("delivery.builder.redo")}
            >
              <EditorIcon name="redo" />
            </button>
          </div>
          <button
            className={styles.iconButton}
            onClick={openDraftPreview}
            type="button"
            aria-label={t("delivery.common.preview")}
            title={t("delivery.common.preview")}
          >
            <EditorIcon name="preview" />
          </button>
          <button className={styles.publishButton} onClick={() => void publish()} type="button">
            {record.status === "published" && !hasUnpublishedChanges
              ? t("delivery.presentationBuilder.published")
              : t("delivery.common.publish")}
          </button>
          {record.currentVersionId && canEdit ? (
            <Link
              className={styles.presentButton}
              href={`/presentation/${presentationId}/host`}
              prefetch={false}
              onClick={(event) => {
                if (hasUnpublishedChanges) {
                  event.preventDefault();
                  // Touch activation in WebKit does not focus links; retain the modal opener.
                  event.currentTarget.focus();
                  setError("");
                  setPresentChoiceOpen(true);
                } else guardBuilderExit(event);
              }}
              title={authoring.presentHelp}
              lang={locale}
            >
              <EditorIcon name="play" />
              {authoring.present}
            </Link>
          ) : (
            <button
              className={styles.presentButton}
              disabled
              type="button"
              title={authoring.publishFirst}
              lang={locale}
            >
              <EditorIcon name="play" />
              {authoring.present}
            </button>
          )}
          <PresentationShareButton
            className={styles.shareButton}
            presentationId={presentationId}
            versionId={record.currentVersionId}
            disabled={!canEdit}
          />
          <EditorDisclosure label={authoring.moreOptions} compact className={styles.moreActions}>
            <PresentationAssignmentButton
              actorKey={`${creator?.userId ?? ""}:${creator?.workspaceId ?? ""}`}
              className={styles.shareButton}
              presentationId={presentationId}
              versionId={record.currentVersionId}
              disabled={!canEdit}
            />
            <PresentationPracticeButton
              actorKey={`${creator?.userId ?? ""}:${creator?.workspaceId ?? ""}`}
              className={styles.shareButton}
              presentationId={presentationId}
              versionId={record.currentVersionId}
              disabled={!canEdit}
            />
            <PresentationExportButton
              className={styles.shareButton}
              presentationId={presentationId}
              versionId={record.currentVersionId}
              disabled={!canEdit}
            />
            <hr />
            <button
              className={styles.spatialButton}
              disabled={!canEdit}
              lang={locale}
              onClick={() => setSpatialOpen(true)}
              type="button"
            >
              {authoring.arrangeSpace}
            </button>
          </EditorDisclosure>
        </div>
      </header>

      {presentChoiceOpen ? (
        <PresentationVersionChoice
          publicationContext={{
            actorKey: `${creator?.userId ?? ""}:${creator?.workspaceId ?? ""}`,
            presentationId,
            versionId: record.currentVersionId!,
          }}
          href={`/presentation/${presentationId}/host`}
          error={error}
          onClose={() => setPresentChoiceOpen(false)}
          onPublishedExit={guardBuilderExit}
          onPublish={() =>
            publishBeforePresent(
              publish,
              () => router.push(`/presentation/${presentationId}/host`),
              () =>
                alive.current && publicationAuthorization.current && assistancePermission.current,
            )
          }
        />
      ) : null}

      {textAssistanceRecovery && !textAssistanceOpen ? (
        <div
          className={textAssistancePending ? styles.errorBanner : styles.sourceBanner}
          role="status"
          lang={locale}
        >
          <p>
            {textAssistancePending
              ? textAssistanceUi(
                  "A text assistance receipt is outstanding. Recover it before editing this deck.",
                )
              : textAssistanceUi("A text assistance proposal is available for review.")}
          </p>
          <button
            type="button"
            data-text-assistance-resume
            onClick={() => setTextAssistanceOpen(true)}
          >
            {textAssistanceUi("Resume text assistance")}
          </button>
        </div>
      ) : null}
      {assistancePending && !assistanceOpen ? (
        <div className={styles.errorBanner} role="status" lang={locale}>
          <p>
            {assistanceUi(
              "Recover the outline insertion acknowledgement before continuing to edit.",
            )}
          </p>
          <button type="button" onClick={() => setAssistanceOpen(true)}>
            {assistanceUi("Resume outline assistance")}
          </button>
        </div>
      ) : null}
      {questionSuggestionsRecovery && !questionSuggestionsOpen ? (
        <div className={styles.errorBanner} role="status" lang={locale}>
          <p>
            {questionSuggestionsPending
              ? questionSuggestionsUi(
                  "A discussion question insertion receipt is outstanding. Recover it before editing this deck.",
                )
              : questionSuggestionsUi("A discussion question proposal is available for review.")}
          </p>
          <button
            type="button"
            data-question-suggestions-resume
            onClick={() => void openQuestionSuggestions()}
          >
            {questionSuggestionsUi("Resume discussion suggestions")}
          </button>
        </div>
      ) : null}

      {recovery ? (
        <div
          className={styles.recoveryBanner}
          inert={builderMutationBlocked || preparingImport}
          lang="en-CA"
          role="status"
          aria-label="Local draft recovery"
        >
          <span>
            {recovery.revision === record.draftRevision ? (
              <>
                A local recovery copy from{" "}
                <time dateTime={recovery.savedAt}>{formatDateTime(locale, recovery.savedAt)}</time>{" "}
                is available.
              </>
            ) : (
              <>
                This local recovery copy is based on revision {recovery.revision}; the saved
                Presentation is revision {record.draftRevision}. Preview, download or duplicate the
                local copy to preserve both versions.
              </>
            )}
          </span>
          {recovery.revision === record.draftRevision && !saveConflictPresent ? (
            <button
              type="button"
              onClick={() => {
                draftBaseRevision.current = recovery.revision;
                commit(recovery.draft);
                setRecovery(null);
              }}
            >
              Restore local copy
            </button>
          ) : null}
          <button type="button" onClick={() => setRecoveryPreviewOpen(true)}>
            Preview local copy
          </button>
          <button type="button" onClick={() => downloadLocalCopy(recovery.draft)}>
            Download local copy
          </button>
          <button type="button" onClick={() => void duplicateLocalDraft(recovery.draft)}>
            Duplicate local copy
          </button>
          <button
            type="button"
            onClick={() => {
              if (
                JSON.stringify(recovery.draft) !== latestDraftJson.current ||
                !retainedSave.current.pending
              )
                void clearBuilderRecovery(recoveryKey).catch(() => undefined);
              setRecovery(null);
            }}
          >
            Dismiss
          </button>
        </div>
      ) : null}
      {pendingNativeImage ? (
        <div
          className={styles.recoveryBanner}
          role="status"
          aria-label="Uploaded image attachment"
          lang="en-CA"
        >
          <span>
            {nativeImageAttachmentStatus(draft, pendingNativeImage) === "full"
              ? "Uploaded image is waiting for space on its original slide. Remove an object to finish attaching it."
              : nativeImageAttachmentStatus(draft, pendingNativeImage) === "missing"
                ? "Uploaded image is waiting for its original native slide. Restore that slide to finish attaching it."
                : nativeImageAttachmentStatus(draft, pendingNativeImage) === "conflict"
                  ? "Uploaded image could not be attached to its original slide. Discard this upload and try again."
                  : "Finishing image attachment to its original slide…"}
          </span>
          <button
            type="button"
            onClick={() => {
              pendingNativeImageRef.current = null;
              setPendingNativeImage(null);
            }}
          >
            Discard uploaded image
          </button>
        </div>
      ) : null}
      {draft.sourceDisclosure ? (
        <div className={styles.sourceBanner} lang={locale} role="note">
          <span>
            <strong>{sourceWorkflowsUi("Grounded source:")}</strong>{" "}
            <span lang="">{draft.sourceDisclosure.sourceName}</span> ·{" "}
            {sourceWorkflowsUi("generated by")}{" "}
            <span lang="">
              {draft.sourceDisclosure.provider} / {draft.sourceDisclosure.model}
            </span>
            . {sourceWorkflowsUi("Verify citations before publishing.")}
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
        <div
          className={styles.errorBanner}
          inert={builderMutationBlocked || preparingImport}
          role="alert"
        >
          <span lang={sourceWorkflowError.lang}>{sourceWorkflowError.text}</span>
          {(saveState === "error" || ordinarySavePending) && saveState !== "saving" ? (
            <button onClick={() => void enqueueSave(draft)} type="button">
              {t("delivery.builder.retrySave")}
            </button>
          ) : null}
          {saveState === "conflict" || saveConflictPresent ? (
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
          inert={unrelatedEditorMutationBlocked || preparingImport}
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

      {compactEditor && (mapOpen || inspectorOpen) ? (
        <button
          type="button"
          className={styles.drawerBackdrop}
          aria-label={commands.closePanel}
          onClick={() => closeEditorPanels(true)}
          tabIndex={-1}
        />
      ) : null}
      <div
        className={`${styles.workspace} ${mapOpen ? "" : styles.mapClosed} ${inspectorOpen ? "" : styles.inspectorClosed}`}
        inert={builderMutationBlocked || preparingImport}
      >
        <aside
          id="presentation-slide-navigator"
          ref={mapPanel}
          className={styles.map}
          aria-label={t("delivery.presentationBuilder.presentationMap")}
        >
          <div className={styles.mapHeader}>
            <div>
              <span className={styles.eyebrow}>
                <span lang={locale}>{commands.slides}</span>
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
              onClick={() => (compactEditor ? closeEditorPanels(true) : setMapOpen(false))}
              type="button"
              aria-label={t("delivery.presentationBuilder.collapseMap")}
            >
              ‹
            </button>
          </div>
          <PresentationSections
            enabled={draft.schemaVersion >= 12}
            sections={draft.sections ?? []}
            selectedBlockId={selectedBlockId}
            disabled={!canEdit}
            onEnable={() => {
              if (canEdit) commit(enablePresentationSections);
            }}
            onAdd={() => {
              if (!canEdit) return;
              const sectionId = clientUuid();
              // A generated title is authored exactly once, in the creation locale.
              commit((current) =>
                addPresentationSection(current, sectionId, sectionsSpatial("New section")),
              );
            }}
            onRename={(sectionId, title) =>
              canEdit && commit((current) => renamePresentationSection(current, sectionId, title))
            }
            onDelete={(sectionId) =>
              canEdit && commit((current) => removePresentationSection(current, sectionId))
            }
            onAssign={(blockId, sectionId) =>
              canEdit &&
              commit((current) => assignPresentationBlockToSection(current, blockId, sectionId))
            }
          />
          <ol className={styles.blockList}>
            {draft.blocks.map((block, index) => (
              <li key={block.id} className={styles.filmstripItem}>
                <PresentationSlideThumbnail
                  block={block}
                  design={resolvePresentationContentDesign(draft.blocks, block.id)}
                  priority={index < 3 || selectedBlockId === block.id}
                  mediaEnabled={mapOpen}
                  mediaScope={{
                    actorKey: `${creator?.userId ?? ""}:${creator?.workspaceId ?? ""}`,
                    presentationId,
                  }}
                />
                <button
                  aria-current={selectedBlockId === block.id ? "step" : undefined}
                  className={selectedBlockId === block.id ? styles.blockActive : styles.blockButton}
                  onClick={() => setSelectedBlockId(block.id)}
                  type="button"
                >
                  <span className={styles.thumbnailSpace} aria-hidden="true" />
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
                          ? (nativeSlideTitleLanguage(block) ?? "")
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
                    {presentationSectionForBlock(draft.sections, block.id) ? (
                      <span
                        className={styles.sectionBadge}
                        lang={
                          presentationSectionForBlock(draft.sections, block.id)?.title ? "" : locale
                        }
                      >
                        {presentationSectionForBlock(draft.sections, block.id)?.title ||
                          sectionsSpatial("Unnamed section")}
                      </span>
                    ) : null}
                  </span>
                  {block.kind === "content" && block.hidden ? (
                    <span className={styles.hiddenBadge} lang={locale}>
                      {commands.hidden}
                    </span>
                  ) : issuesByBlock.has(block.id) ? (
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
                  ) : null}
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
            <button
              className={styles.newSlideButton}
              onClick={() => addBlock(createDesignedNativeContentBlock())}
              type="button"
            >
              <EditorIcon name="plus" /> {commands.newSlide}
            </button>
            <EditorDisclosure
              label={commands.insertImport}
              icon="import"
              align="start"
              className={styles.insertMenu}
            >
              <EditorMenuSection label={commands.createSlide}>
                <button
                  title={commands.emptyCanvas}
                  onClick={(event) => addBlock(createNativeContentBlock(), event.currentTarget)}
                  type="button"
                >
                  <EditorIcon name="slides" />
                  <span className={styles.insertChoice}>
                    <span>{commands.blankSlide}</span>
                    <small>{commands.emptyCanvas}</small>
                  </span>
                </button>
                <button
                  title={commands.bodyCanvas}
                  onClick={(event) =>
                    addBlock(createDesignedNativeContentBlock(), event.currentTarget)
                  }
                  type="button"
                >
                  <EditorIcon name="content" />
                  <span className={styles.insertChoice}>
                    <span>{t("delivery.presentation.contentSlide")}</span>
                    <small>{commands.bodyCanvas}</small>
                  </span>
                </button>
                <button
                  onClick={(event) => addBlock(createQuestionBlock(), event.currentTarget)}
                  type="button"
                >
                  <EditorIcon name="interaction" />
                  <span>{t("delivery.builder.addQuestion")}</span>
                </button>
                <button
                  aria-label={commands.outlineToSlides}
                  disabled={!canEdit || preparingImport}
                  lang={locale}
                  onClick={(event) => void openAssistance(false, event.currentTarget)}
                  type="button"
                >
                  <EditorIcon name="outline" />
                  <span>{commands.outlineToSlides}</span>
                </button>
              </EditorMenuSection>
              <EditorMenuSection label={commands.bringContent}>
                <button
                  disabled={!roundSources.length || preparingImport}
                  onClick={(event) => openRoundImport(event.currentTarget)}
                  type="button"
                >
                  <EditorIcon name="round" />
                  <span>{t("delivery.presentationBuilder.fromPublishedRound")}</span>
                </button>
                <button
                  disabled={preparingImport}
                  onClick={() => void openSourceImport()}
                  type="button"
                >
                  <EditorIcon name="source" />
                  <span>{t("delivery.presentationBuilder.fromTrustedSource")}</span>
                </button>
                <button
                  disabled={preparingImport || mediaState !== "idle" || pendingNativeImage !== null}
                  lang={locale}
                  onClick={openVisualImport}
                  type="button"
                >
                  <EditorIcon name="image" />
                  <span>{commands.importVisual}</span>
                </button>
                {canInsertPack ? (
                  <button
                    disabled={mediaState !== "idle" || preparingImport}
                    lang={locale}
                    onClick={() => void openPackImport()}
                    type="button"
                  >
                    <EditorIcon name="recovery" />
                    <span>{commands.fromPack}</span>
                  </button>
                ) : null}
              </EditorMenuSection>
            </EditorDisclosure>
          </div>
        </aside>

        <main className={styles.canvasArea} id="presentation-canvas">
          <div className={styles.compactCommands} inert={builderMutationBlocked || preparingImport}>
            <span className={`${styles.saveStatus} ${styles[`save_${saveState}`]}`} role="status">
              {saveLabel}
            </span>
            <button className={styles.compactPreview} onClick={openDraftPreview} type="button">
              {t("delivery.common.preview")}
            </button>
          </div>
          {selectedBlock ? (
            <div
              className={styles.canvasToolbar}
              role="group"
              aria-label={commands.selectedActions}
              lang={locale}
            >
              <span className={styles.slidePosition}>
                {commands.slidePosition
                  .replace(
                    "{current}",
                    new Intl.NumberFormat(locale).format(
                      draft.blocks.findIndex((block) => block.id === selectedBlock.id) + 1,
                    ),
                  )
                  .replace("{total}", new Intl.NumberFormat(locale).format(draft.blocks.length))}
              </span>

              {selectedBlock.kind === "content" && !selectedBlock.scene ? (
                <>
                  <button
                    disabled={selectedBlock.textElements.length >= 8}
                    onClick={addTextBox}
                    type="button"
                  >
                    {commands.addTextBox}
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
                    {commands.moveTextEarlier}
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
                    {commands.moveTextLater}
                  </button>
                  <button
                    className={styles.dangerButton}
                    disabled={!selectedTextElement || selectedTextElement.role === "title"}
                    onClick={deleteSelectedTextBox}
                    type="button"
                  >
                    {commands.deleteTextBox}
                  </button>
                </>
              ) : null}
              {selectedBlock.kind === "content" && !selectedBlock.scene ? (
                <button
                  className={styles.primarySlideAction}
                  type="button"
                  onClick={() => {
                    try {
                      const converted = adaptContentSlideToScene(selectedBlock);
                      commit((current) => ({
                        ...updateBlock(current, selectedBlock.id, () => converted),
                        schemaVersion: current.schemaVersion >= 5 ? current.schemaVersion : 4,
                      }));
                    } catch (caught) {
                      setError(humanError(caught));
                    }
                  }}
                >
                  {commands.convertNative}
                </button>
              ) : null}
              <div
                className={styles.slideActionGroup}
                role="group"
                aria-label={commands.slideOrder}
              >
                <button
                  aria-label={commands.moveEarlier}
                  disabled={!canMovePresentationBlock(draft, selectedBlock.id, -1)}
                  title={commands.moveEarlierHelp}
                  onClick={() =>
                    commit((current) => movePresentationBlock(current, selectedBlock.id, -1))
                  }
                  type="button"
                >
                  <EditorIcon name="arrow-up" />
                </button>
                <button
                  aria-label={commands.moveLater}
                  disabled={!canMovePresentationBlock(draft, selectedBlock.id, 1)}
                  title={commands.moveLaterHelp}
                  onClick={() =>
                    commit((current) => movePresentationBlock(current, selectedBlock.id, 1))
                  }
                  type="button"
                >
                  <EditorIcon name="arrow-down" />
                </button>
              </div>
              <div
                className={styles.slideActionGroup}
                role="group"
                aria-label={commands.slideActions}
              >
                {selectedBlock.kind === "content" ? (
                  <button
                    aria-label={selectedBlock.hidden ? commands.showSlide : commands.hideSlide}
                    title={selectedBlock.hidden ? commands.showSlide : commands.hideSlide}
                    type="button"
                    onClick={() =>
                      commit((current) =>
                        setPresentationSlideHidden(
                          current,
                          selectedBlock.id,
                          !selectedBlock.hidden,
                        ),
                      )
                    }
                  >
                    <EditorIcon name={selectedBlock.hidden ? "preview" : "eye-off"} />
                    <span>{selectedBlock.hidden ? commands.showSlide : commands.hideSlide}</span>
                  </button>
                ) : (
                  <p className={styles.helpText} lang={locale}>
                    {commands.activityOrderHelp}
                  </p>
                )}
                <button
                  aria-label={t("delivery.common.duplicate")}
                  title={commands.duplicateSlide}
                  disabled={draft.blocks.length >= 200}
                  onClick={() => {
                    const copy = duplicatePresentationBlock(selectedBlock);
                    commit((current) =>
                      insertPresentationBlockDuplicate(current, selectedBlock.id, copy),
                    );
                    setSelectedBlockId(copy.id);
                    setInspectorTab(copy.kind === "content" ? "content" : "build");
                  }}
                  type="button"
                >
                  <EditorIcon name="duplicate" />
                  <span>{t("delivery.common.duplicate")}</span>
                </button>
                <button
                  aria-label={t("delivery.common.delete")}
                  title={commands.deleteSlide}
                  className={styles.dangerButton}
                  onClick={() => {
                    const index = draft.blocks.findIndex((block) => block.id === selectedBlock.id);
                    const remaining = draft.blocks.filter((block) => block.id !== selectedBlock.id);
                    commit((current) => removePresentationBlock(current, selectedBlock.id));
                    setSelectedBlockId(
                      remaining[Math.min(index, remaining.length - 1)]?.id ?? null,
                    );
                  }}
                  type="button"
                >
                  <EditorIcon name="trash" />
                  <span>{t("delivery.common.delete")}</span>
                </button>
              </div>
            </div>
          ) : null}
          {selectedBlock?.kind === "content" && selectedBlock.hidden ? (
            <p
              className={styles.hiddenBanner}
              role="status"
              aria-label="Slide visibility"
              lang="en-CA"
            >
              Hidden from presentation. This slide stays editable here and is excluded from preview
              and published delivery.
            </p>
          ) : null}
          {selectedBlock?.kind === "content" &&
          selectedBlock.sourceDisclosure?.model === "visual-import-v1" ? (
            <p className={styles.sourceBanner} role="note" lang={locale}>
              <strong>
                {selectedBlock.scene?.nodes.some((node) => node.type === "image")
                  ? visualImportUi("Imported visual slide")
                  : visualImportUi("Imported reading slide")}
              </strong>
              {" · "}
              {selectedBlock.scene?.nodes.some((node) => node.type === "image")
                ? visualImportUi(
                    "Source objects, animation and media are flattened. Edit image placement or use its reading slide for editable text.",
                  )
                : visualImportUi(
                    "Author-reviewed accessible text is editable on this reading slide.",
                  )}
            </p>
          ) : null}
          {!selectedBlock ? (
            <section className={styles.emptyCanvas}>
              <span className={styles.emptyGlyph}>✦</span>
              <h1>{t("delivery.presentationBuilder.emptyTitle")}</h1>
              <p>{t("delivery.presentationBuilder.emptyDescription")}</p>
              <div>
                <button onClick={() => addBlock(createDesignedNativeContentBlock())} type="button">
                  Create first slide
                </button>
                <button onClick={() => addBlock(createDesignedNativeContentBlock())} type="button">
                  {t("delivery.presentationBuilder.addContentSlide")}
                </button>
                <button onClick={() => addBlock(createQuestionBlock())} type="button">
                  {t("delivery.presentationBuilder.addAudienceQuestion")}
                </button>
                <button
                  disabled={!roundSources.length}
                  onClick={(event) => openRoundImport(event.currentTarget)}
                  type="button"
                >
                  {t("delivery.presentationBuilder.reuseRound")}
                </button>
                <button onClick={() => void openSourceImport()} type="button">
                  {t("delivery.presentationBuilder.insertTrustedSource")}
                </button>
                <button
                  disabled={!canEdit || preparingImport}
                  lang={locale}
                  onClick={() => void openAssistance()}
                  type="button"
                >
                  {assistanceUi("Outline to slides")}
                </button>
                <button lang={locale} onClick={openVisualImport} type="button">
                  {visualImportUi("Import visual slides")}
                </button>
              </div>
            </section>
          ) : selectedBlock.kind === "content" && selectedBlock.scene ? (
            <section className={styles.slideCanvas} lang={locale}>
              <NativeSceneEditor
                canEdit={canEdit}
                key={selectedBlock.id}
                scene={selectedBlock.scene}
                inspectorTarget={nativeInspectorTarget}
                inspectorSection={
                  inspectorTab === "layout" ||
                  inspectorTab === "media" ||
                  inspectorTab === "accessibility"
                    ? inspectorTab
                    : "content"
                }
                onInspectSelection={(openInspector = false) => {
                  setInspectorTab("content");
                  if (openInspector) {
                    if (compactEditor) setMapOpen(false);
                    setInspectorOpen(true);
                  }
                }}
                onTextAssistance={(nodeId, operation) => void openTextAssistance(nodeId, operation)}
                textAssistanceDisabled={!canEdit || preparingImport || textAssistancePending}
                layoutSuggestionsDisabled={!canEdit || builderMutationBlocked || preparingImport}
                layoutSuggestionsSourceKey={selectedBlock.id}
                onPreviewInteraction={() => {
                  if (builderMutationBlocked || preparingImport || selectedBlock.hidden) return;
                  setPreviewMode("audience");
                  setPreviewOrigin("interaction");
                  setPreviewStartBlockId(selectedBlock.id);
                  setPreviewOpen(true);
                }}
                previewInteractionUnavailableReason={
                  selectedBlock.hidden
                    ? "Show this slide before previewing it."
                    : builderMutationBlocked || preparingImport
                      ? "Finish the pending edit before previewing."
                      : undefined
                }
                navigationTargets={presentationInteractionTargets(draft, selectedBlock.id)}
                onUndo={undo}
                onRedo={redo}
                onApplyDesignToDeck={(design) => {
                  commit((current) => {
                    try {
                      return applyNativeDesignToDeck(current, design);
                    } catch (caught) {
                      setError(humanError(caught));
                      return current;
                    }
                  });
                }}
                onChange={(scene: PresentationScene, historyField) => {
                  if (builderMutationBlocked) return false;
                  try {
                    applyNativeSceneToDeck(
                      JSON.parse(latestDraftJson.current) as PresentationDraft,
                      selectedBlock.id,
                      scene,
                    );
                  } catch {
                    setError(
                      "This edit exceeds the Presentation’s limits. Shorten content or remove a slide, then try again. Your saved draft is unchanged.",
                    );
                    return false;
                  }
                  commit(
                    (current) => {
                      try {
                        return applyNativeSceneToDeck(current, selectedBlock.id, scene);
                      } catch {
                        setError(
                          "This edit exceeds the Presentation’s limits. Shorten content or remove a slide, then try again.",
                        );
                        return current;
                      }
                    },
                    historyField ? `${selectedBlock.id}:${historyField}` : undefined,
                  );
                  return true;
                }}
                renderImage={(mediaId, altText) => (
                  <AuthenticatedMedia key={mediaId} mediaId={mediaId} altText={altText} />
                )}
                uploadsEnabled={mediaUploadsEnabled}
                mediaState={mediaState}
                attachmentPending={pendingNativeImage !== null}
                onUploadImage={(file, altText) => {
                  void uploadSelectedImage(file, altText);
                }}
              />
              <EditorDisclosure
                label={sourceWorkflowsUi("Slide ideas & audience activities")}
                className={styles.slideIdeas}
                icon="interaction"
                inline
              >
                <PresentationQuestionStarters
                  locale={locale}
                  key={`question-starters:${selectedBlock.id}`}
                  block={selectedBlock}
                  sourceKey={selectedBlock.id}
                  disabled={questionStarterContext.blocked}
                  onInsert={(starter) => {
                    if (
                      latestQuestionStarterContext.current.actorKey !==
                        questionStarterContext.actorKey ||
                      latestQuestionStarterContext.current.presentationId !==
                        questionStarterContext.presentationId ||
                      latestQuestionStarterContext.current.selectedBlockId !==
                        questionStarterContext.selectedBlockId ||
                      latestQuestionStarterContext.current.blocked ||
                      questionStarterContext.blocked ||
                      !alive.current ||
                      !assistancePermission.current ||
                      importPreparation.current ||
                      textAssistanceActive.current ||
                      questionSuggestionsActive.current ||
                      assistanceActive.current ||
                      visualImportActive.current ||
                      packOperation.current ||
                      packPending.current ||
                      packUpdateOperation.current ||
                      packUpdatePending.current ||
                      mediaUploadInFlight.current ||
                      pendingNativeImageRef.current ||
                      starter.source.blockId.toLowerCase() !== selectedBlock.id.toLowerCase()
                    )
                      return false;
                    const ids = {
                      blockId: clientUuid(),
                      questionId: clientUuid(),
                      ...(starter.type === "poll"
                        ? { choiceIds: (starter.choices ?? []).map(() => clientUuid()) }
                        : {}),
                    };
                    const checked = insertPresentationQuestionStarter(
                      JSON.parse(latestDraftJson.current) as PresentationDraft,
                      starter,
                      ids,
                    );
                    if (!checked.ok) {
                      setError(checked.reason);
                      return false;
                    }
                    // Recheck the current draft in the ordinary commit; identities stay stable
                    // if React replays the updater. One insertion is one independent Undo step.
                    commit((current) => {
                      const result = insertPresentationQuestionStarter(current, starter, ids);
                      if (!result.ok) {
                        setError(result.reason);
                        return current;
                      }
                      questionStarterFocus.current = result.blockId;
                      setSelectedBlockId(result.blockId);
                      setInspectorTab("build");
                      setError("");
                      return result.draft;
                    });
                    return true;
                  }}
                />
                <section
                  className={styles.ideaCard}
                  lang={locale}
                  aria-label={questionSuggestionsUi("AI discussion suggestions")}
                >
                  <div className={styles.ideaCardHeading}>
                    <EditorIcon name="sparkle" />
                    <span>{questionSuggestionsUi("AI assistance")}</span>
                  </div>
                  <button
                    type="button"
                    data-question-suggestions-trigger
                    disabled={
                      questionStarterContext.blocked || !questionSuggestionSource?.supported
                    }
                    onClick={() => void openQuestionSuggestions()}
                  >
                    <EditorIcon name="sparkle" />
                    <span>{questionSuggestionsUi("Suggest discussion questions")}</span>
                  </button>
                  <p className={styles.helpText}>
                    {questionSuggestionsUi(
                      "Review your source and shared AI allowance before generating two English discussion suggestions.",
                    )}
                  </p>
                </section>
                {selectedBlock.textAssistance ? (
                  <aside
                    aria-label={textAssistanceUi("Latest AI text edit")}
                    className={styles.sourceBanner}
                    lang={locale}
                  >
                    <strong>{textAssistanceUi("Latest AI text edit — unverified wording")}</strong>
                    <p>
                      {selectedBlock.textAssistance.operation === "translate"
                        ? textAssistanceUi("Translated to {language}", {
                            language: textAssistanceLanguageDisplay(
                              selectedBlock.textAssistance.targetLanguage!,
                              locale,
                            ).text,
                          })
                        : selectedBlock.textAssistance.operation === "shorten"
                          ? textAssistanceUi("Shortened")
                          : textAssistanceUi("Rewritten")}
                      {" · "}
                      {textAssistanceUi("Text object")}:{" "}
                      {nativeControlUi(
                        selectedBlock.textAssistance.role === "title" ? "Slide title" : "Body text",
                      )}
                      {" · "}
                      <span lang="">{selectedBlock.textAssistance.nodeId}</span>
                    </p>
                    <p>
                      {textAssistanceUi("Generated by")}{" "}
                      <span lang="">
                        {selectedBlock.textAssistance.provider} /{" "}
                        {selectedBlock.textAssistance.model}
                      </span>
                      {" · "}
                      <time dateTime={selectedBlock.textAssistance.generatedAt}>
                        {formatDateTime(locale, selectedBlock.textAssistance.generatedAt)}
                      </time>
                    </p>
                    <p>
                      <span
                        lang={
                          textAssistanceFeedback(locale, selectedBlock.textAssistance.reviewWarning)
                            .lang
                        }
                      >
                        {
                          textAssistanceFeedback(locale, selectedBlock.textAssistance.reviewWarning)
                            .text
                        }
                      </span>{" "}
                      {textAssistanceUi(
                        "This records the latest edit on this slide, not a complete edit history or fact check.",
                      )}
                    </p>
                  </aside>
                ) : null}
              </EditorDisclosure>
            </section>
          ) : selectedBlock.kind === "content" ? (
            <section className={styles.slideCanvas} lang="en-CA">
              <ContentSlideView
                block={selectedBlock}
                designOverride={resolvePresentationContentDesign(draft.blocks, selectedBlock.id)}
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
            <section className={styles.activityEditor} aria-label="Activity editor">
              <div className={styles.activityHeading}>
                <div>
                  <span>Audience activity</span>
                  <strong>Edit the prompt and answers on the slide</strong>
                </div>
                <button
                  type="button"
                  onClick={(event) => {
                    event.currentTarget.focus({ preventScroll: true });
                    openSelectedPreview("audience", "slide");
                  }}
                >
                  <EditorIcon name="preview" /> Preview this slide
                </button>
              </div>
              <PresentationActivitySlide
                question={selectedBlock.question}
                accessibilityContext="editor"
                design={resolvePresentationActivityDesign(draft.blocks, selectedBlock.id)}
                editable
                onPromptChange={(prompt) =>
                  updateQuestion((question) => ({ ...question, prompt }), "prompt")
                }
                onChoiceChange={(id, label) =>
                  updateQuestion(
                    (question) =>
                      isChoiceQuestion(question) && question.type !== "true_false"
                        ? {
                            ...question,
                            choices: question.choices.map((choice) =>
                              choice.id === id ? { ...choice, label } : choice,
                            ),
                          }
                        : question,
                    `choice:${id}`,
                  )
                }
                selectedChoiceId={selectedActivityChoiceId}
                onSelectChoice={setSelectedActivityChoiceId}
                media={
                  selectedBlock.question.mediaId ? (
                    <AuthenticatedMedia
                      altText={selectedBlock.question.mediaAlt}
                      mediaId={selectedBlock.question.mediaId}
                    />
                  ) : undefined
                }
              />
              <section className={styles.activitySettings} aria-label="Activity settings">
                <div className={styles.activitySettingsHeading}>
                  <EditorIcon name="inspector" />
                  <div>
                    <h2>Activity settings</h2>
                    <p>
                      Configure responses and follow-up paths. These controls are private editing
                      tools.
                    </p>
                  </div>
                </div>
                <div className={styles.responseSurface}>
                  <ResponseEditor
                    multiSelectPollsEnabled
                    rankingPollsEnabled
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
                </div>
                <PresentationBranchEditor
                  locale={locale}
                  disabled={!canEdit || builderMutationBlocked || preparingImport}
                  block={selectedBlock}
                  targets={presentationInteractionTargets(draft, selectedBlock.id, true)}
                  onChange={(branches, historyField) =>
                    commit(
                      (current) => ({
                        ...current,
                        schemaVersion: current.schemaVersion >= 13 ? current.schemaVersion : 13,
                        sections: current.sections ?? [],
                        blocks: current.blocks.map((block) => {
                          if (block.id !== selectedBlock.id || block.kind !== "question")
                            return block;
                          const copy = { ...block };
                          delete copy.branches;
                          return branches.length ? { ...copy, branches } : copy;
                        }),
                      }),
                      historyField ? `${selectedBlock.id}:${historyField}` : undefined,
                    )
                  }
                />
              </section>
            </section>
          )}
          {productFeatures?.canvasBoards || draft.recoveryPackInsertions?.length ? (
            <EditorDisclosure
              label="Related content"
              icon="source"
              inline
              className={styles.slideIdeas}
            >
              {productFeatures?.canvasBoards ? (
                <CanvasArtifactLinks
                  target={{ kind: "presentation", targetId: presentationId }}
                  editable={canEdit}
                  disabled={builderMutationBlocked}
                />
              ) : null}
              <RecoveryPackPresentationReferences insertions={draft.recoveryPackInsertions ?? []} />
            </EditorDisclosure>
          ) : null}
        </main>

        <aside
          id="presentation-object-inspector"
          ref={inspectorPanel}
          className={styles.inspector}
          aria-label={t("delivery.presentationBuilder.blockInspector")}
        >
          <div className={styles.inspectorHeading}>
            <div>
              <span className={styles.inspectorEyebrow}>
                {nativeEditorUi("Customize your slide")}
              </span>
              <h2>{nativeEditorUi("Slide tools")}</h2>
            </div>
            <button
              type="button"
              onClick={() => (compactEditor ? closeEditorPanels(true) : setInspectorOpen(false))}
              aria-label={nativeEditorUi("Close inspector panel")}
            >
              <EditorIcon name="close" />
            </button>
          </div>
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
                <EditorIcon name={inspectorTabIcons[tab.id]} />
                <span>{tab.label}</span>
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
            {selectedBlock?.kind === "content" && selectedBlock.scene ? (
              <div
                ref={setNativeInspectorTarget}
                hidden={inspectorTab === "notes" || inspectorTab === "readiness"}
                className={styles.nativeInspectorHost}
              />
            ) : null}
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
            ) : selectedBlock.kind === "content" && selectedBlock.scene ? (
              inspectorTab === "notes" ? (
                <SpeakerNotesEditor
                  value={selectedBlock.speakerNotes}
                  onChange={changeSpeakerNotes}
                  onPreview={() => openSelectedPreview("presenter", "notes")}
                  disabled={!canEdit || builderMutationBlocked || preparingImport}
                  sourceKey={selectedBlock.id}
                  previewDisabled={Boolean(selectedBlock.hidden)}
                  previewDisabledReason={
                    selectedBlock.hidden
                      ? "Show this slide before previewing it. Hidden slides are excluded from delivery."
                      : undefined
                  }
                />
              ) : null
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
                      {commands.addTextBox}
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
                        disabled={
                          !mediaUploadsEnabled ||
                          mediaState !== "idle" ||
                          pendingNativeImage !== null
                        }
                        onChange={(event) => {
                          void uploadSelectedImage(event.target.files?.[0] ?? null);
                          event.currentTarget.value = "";
                        }}
                        type="file"
                      />
                    </label>
                    <p className={styles.helpText} lang="en-CA">
                      {pendingNativeImage
                        ? "Finish or discard the uploaded image attachment before choosing another image."
                        : mediaUploadsEnabled
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
                  <SpeakerNotesEditor
                    value={selectedBlock.speakerNotes}
                    onChange={changeSpeakerNotes}
                    onPreview={() => openSelectedPreview("presenter", "notes")}
                    disabled={!canEdit || builderMutationBlocked || preparingImport}
                    sourceKey={selectedBlock.id}
                    previewDisabled={Boolean(selectedBlock.hidden)}
                    previewDisabledReason={
                      selectedBlock.hidden
                        ? "Show this slide before previewing it. Hidden slides are excluded from delivery."
                        : undefined
                    }
                  />
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
                        {questionTypeOptions.map((option) => (
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
                        disabled={selectedOpinionOnly}
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
                      uploadBlocked={pendingNativeImage !== null}
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
                        disabled={selectedOpinionOnly}
                        onChange={(event) =>
                          updateQuestion((question) => ({
                            ...question,
                            purpose: event.target.value as "diagnostic" | "practice" | "opinion",
                          }))
                        }
                        value={
                          selectedBlock.question.purpose ??
                          (selectedOpinionOnly ? "opinion" : "diagnostic")
                        }
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
                        disabled={selectedOpinionOnly}
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
                        disabled={selectedOpinionOnly}
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
                        <option value="main">
                          {selectedOpinionOnly ? "Main activity" : "Main diagnostic"}
                        </option>
                        <option value="recheck">Recovery recheck</option>
                      </select>
                    </label>
                    {(selectedBlock.question.delivery ?? "main") === "main" ? (
                      <label className={styles.field}>
                        <span>{t("delivery.builder.pairedRecheckQuestion")}</span>
                        <select
                          disabled={selectedOpinionOnly}
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
        <PresentationPreview
          draft={draft}
          initialBlockId={previewStartBlockId}
          initialMode={previewMode}
          origin={previewOrigin}
          onClose={() => setPreviewOpen(false)}
        />
      ) : null}
      {recoveryPreviewOpen && recovery ? (
        <PresentationPreview draft={recovery.draft} onClose={() => setRecoveryPreviewOpen(false)} />
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
                    onChange={() => toggleImportedQuestion(question.id)}
                    type="checkbox"
                  />
                  <span>
                    <strong lang={question.prompt ? "" : "en-CA"}>
                      {question.prompt || "Untitled question"}
                    </strong>
                    <small>
                      {responseTypeLabel(question.type)} · {question.delivery ?? "main"}
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
          lang={locale}
          onKeyDown={(event) => handleModalKeyDown(event, () => setSourceImportOpen(false))}
          tabIndex={-1}
        >
          <section className={`${styles.importDialog} ${styles.sourceImportDialog}`}>
            <div className={styles.sourceImportHeading}>
              <div>
                <p className={styles.eyebrow}>{sourceWorkflowsUi("Review before insertion")}</p>
                <h2 id="source-import-title">{t("delivery.assistant.insertTrustedSource")}</h2>
                <p className={styles.helpText}>
                  {sourceWorkflowsUi(
                    "Create a proposal, choose the cited content and Recovery questions you want, then confirm once. Nothing is inserted while the proposal is processing.",
                  )}
                </p>
              </div>
              <button onClick={() => setSourceImportOpen(false)} type="button">
                {sourceWorkflowsUi("Close")}
              </button>
            </div>
            <div lang={locale}>
              <AuthoringAssistant
                artifactType="presentation"
                canEdit={canEdit}
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
      {spatialOpen ? (
        <PresentationSpatialEditor
          draft={draft}
          selectedBlockId={selectedBlockId}
          onSelect={setSelectedBlockId}
          onChange={commit}
          onClose={() => setSpatialOpen(false)}
          onPreviewPath={() => {
            setSpatialOpen(false);
            openDraftPreview();
          }}
          renderPreview={(block) =>
            block.kind === "content" ? (
              <ContentSlideView
                block={block}
                renderSceneImage={(mediaId, altText) => (
                  <AuthenticatedMedia key={mediaId} mediaId={mediaId} altText={altText} />
                )}
                media={
                  block.mediaId ? (
                    <AuthenticatedMedia mediaId={block.mediaId} altText={block.mediaAlt} />
                  ) : undefined
                }
                variant="preview"
              />
            ) : (
              <article>
                <h3 lang={block.question.prompt ? "" : locale}>
                  {block.question.prompt || sectionsSpatial("Untitled activity")}
                </h3>
                {"choices" in block.question ? (
                  <ul>
                    {block.question.choices.map((choice) => (
                      <li key={choice.id} lang="">
                        {choice.label}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>
                    {block.question.type === "rating"
                      ? `${block.question.min} – ${block.question.max}`
                      : sectionsSpatial("Participant response")}
                  </p>
                )}
              </article>
            )
          }
        />
      ) : null}
      <PresentationVisualImport
        locale={locale}
        presentationId={presentationId}
        open={visualImportOpen}
        preparationBlocked={
          preparingImport ||
          textAssistanceOpen ||
          questionSuggestionsOpen ||
          questionSuggestionsPending ||
          textAssistancePending ||
          assistanceOpen ||
          assistancePending
        }
        afterBlockId={selectedBlockId}
        prepareInsert={prepareVisualInsertion}
        onInserted={async (blockIds) => {
          const loadedCurrent = await reloadLatestDraft(blockIds[0]);
          if (!loadedCurrent || saveConflict.current || retainedSave.current.pending) {
            throw new Error("Recover the draft acknowledgement before continuing.");
          }
        }}
        onReloadDraft={async () => {
          if (!(await reloadLatestDraft(selectedBlockId ?? undefined))) {
            throw new Error(
              "The current draft could not be loaded. Your import review is retained.",
            );
          }
        }}
        onClose={() => setVisualImportOpen(false)}
        onResumeRequired={() => setVisualImportOpen(true)}
        onPendingChange={setVisualImportReceiptPending}
      />
      <PresentationTextAssistance
        locale={locale}
        presentationId={presentationId}
        actorKey={`${creator?.userId ?? ""}:${creator?.workspaceId ?? ""}`}
        canEdit={canEdit}
        open={textAssistanceOpen}
        target={textAssistanceTarget}
        citations={(() => {
          const block = textAssistanceTarget
            ? draft.blocks.find((block) =>
                sameTextAssistanceBlockId(block.id, textAssistanceTarget.blockId),
              )
            : null;
          return block?.kind === "content" ? (block.citations ?? []) : [];
        })()}
        onApplied={async (receipt) => {
          const beforeJson = latestDraftJson.current;
          const before = JSON.parse(beforeJson) as PresentationDraft;
          const beforeRevision = draftBaseRevision.current;
          const clean =
            beforeJson === lastSavedJson.current && beforeRevision === revisionRef.current;
          const history = undoStack;
          const block = before.blocks.find((block) =>
            sameTextAssistanceBlockId(block.id, receipt.blockId),
          );
          const node =
            block?.kind === "content"
              ? block.scene?.nodes.find((node) => node.id === receipt.nodeId)
              : null;
          const sourceMatches =
            node?.type === "text" &&
            !node.richText &&
            node.role === receipt.role &&
            node.text.trim().length > 0 &&
            presentationTextAssistanceSourceDigest(node.text) === receipt.sourceDigest &&
            (receipt.operation !== "translate" || (node.lang ?? null) === receipt.sourceLanguage);
          const loaded = await reloadLatestDraft(receipt.blockId, undefined, true);
          if (!loaded || saveConflict.current || retainedSave.current.pending)
            throw new Error("Recover the text application acknowledgement before continuing.");
          // Only a fresh, exact acknowledgement can become a normal local text undo step.
          // Historical receipt recovery and newer remote drafts must not fabricate old snapshots.
          if (
            clean &&
            sourceMatches &&
            beforeRevision === receipt.acceptedRevision - 1 &&
            loaded.revision === receipt.acceptedRevision &&
            JSON.stringify(PresentationDraftSchema.parse(loaded.draft)) ===
              JSON.stringify(receipt.acceptedDraft)
          ) {
            setUndoStack([...history, before].slice(-HISTORY_LIMIT));
            setRedoStack([]);
          }
        }}
        onReloadTarget={async (binding) => {
          const loadedTarget = await reloadLatestDraft(binding.blockId, binding, true);
          if (!loadedTarget)
            throw new Error("The exact saved target could not be loaded. Your review is retained.");
          const block = loadedTarget.draft.blocks.find((block) =>
            sameTextAssistanceBlockId(block.id, binding.blockId),
          );
          const node =
            block?.kind === "content"
              ? block.scene?.nodes.find((node) => node.id === binding.nodeId)
              : null;
          if (node?.type !== "text" || node.richText || node.role !== binding.role)
            throw new Error("The exact target is unavailable.");
          const target = {
            blockId: binding.blockId,
            nodeId: binding.nodeId,
            role: node.role,
            operation: binding.operation,
            text: node.text,
            expectedRevision: loadedTarget.revision,
            ...(binding.operation === "translate"
              ? { targetLanguage: binding.targetLanguage, sourceLanguage: binding.sourceLanguage }
              : {}),
          };
          setTextAssistanceTarget(target);
          return target;
        }}
        onReloadForInvalidRecovery={async (canContinue) => {
          const context = textRecoveryContext;
          const current = () =>
            canContinue() &&
            alive.current &&
            assistancePermission.current &&
            currentTextRecoveryContext.current === context;
          const otherReceiptPending = () =>
            Boolean(
              retainedSave.current.pending ||
              packPending.current ||
              packUpdatePending.current ||
              packOperation.current ||
              packUpdateOperation.current ||
              assistanceActive.current ||
              questionSuggestionsActive.current ||
              visualImportActive.current ||
              importPreparation.current,
            );
          if (!current())
            throw new Error(
              "Editor permission changed. Reload the editor before clearing recovery.",
            );
          const loaded = await reloadLatestDraft(selectedBlockId ?? undefined, undefined, true, {
            canAdopt: current,
            preserveWorkingDraft: otherReceiptPending,
          });
          if (!loaded || !current())
            throw new Error(
              "The current saved deck could not be loaded. The invalid recovery record is retained.",
            );
          setTextAssistanceTarget(null);
        }}
        onClose={() => setTextAssistanceOpen(false)}
        onPendingChange={setTextAssistancePending}
        onRecoveryChange={setTextAssistanceRecovery}
      />
      <PresentationAssistance
        locale={locale}
        presentationId={presentationId}
        actorKey={`${creator?.userId ?? ""}:${creator?.workspaceId ?? ""}`}
        canEdit={canEdit}
        open={assistanceOpen}
        expectedRevision={assistanceTarget.revision}
        afterBlockId={assistanceTarget.anchor}
        onInserted={async (blockIds) => {
          if (
            !(await reloadLatestDraft(blockIds[0])) ||
            saveConflict.current ||
            retainedSave.current.pending
          ) {
            throw new Error(
              "Recover the saved draft acknowledgement before continuing. Your outline review is retained.",
            );
          }
        }}
        onReloadDraft={async () => {
          const target = await reloadLatestDraft(selectedBlockId ?? undefined);
          if (!target)
            throw new Error("The saved deck could not be loaded. Your outline review is retained.");
          setAssistanceTarget(target);
        }}
        onClose={() => setAssistanceOpen(false)}
        onResumeRequired={() => {
          assistanceActive.current = true;
          setAssistanceOpen(true);
          consumeOutlineStart();
        }}
        onPendingChange={setAssistancePending}
      />
      <PresentationQuestionSuggestions
        locale={locale}
        presentationId={presentationId}
        actorKey={`${creator?.userId ?? ""}:${creator?.workspaceId ?? ""}`}
        canEdit={canEdit}
        open={questionSuggestionsOpen}
        target={questionSuggestionsTarget}
        onClose={() => setQuestionSuggestionsOpen(false)}
        onPendingChange={(pending) => {
          if (pending) questionSuggestionsActive.current = true;
          setQuestionSuggestionsPending(pending);
        }}
        onRecoveryChange={setQuestionSuggestionsRecovery}
        onInserted={async (receipt) => {
          const context = textRecoveryContext;
          const canAdopt = () =>
            questionSuggestionsAuthorization.current &&
            alive.current &&
            assistancePermission.current &&
            currentTextRecoveryContext.current === context;
          if (!canAdopt())
            throw new Error("Your sign-in changed. Reload before recovering this insertion.");
          const beforeJson = latestDraftJson.current;
          const before = JSON.parse(beforeJson) as PresentationDraft;
          const beforeRevision = draftBaseRevision.current;
          const clean =
            beforeJson === lastSavedJson.current && beforeRevision === revisionRef.current;
          const history = undoStack;
          const block = before.blocks.find((candidate) =>
            sameTextAssistanceBlockId(candidate.id, receipt.sourceBlockId),
          );
          const source = block ? presentationQuestionSuggestionSource(block) : null;
          const sourceMatches =
            source?.supported &&
            presentationQuestionSuggestionsSourceDigest(source.source) === receipt.sourceDigest;
          questionStarterFocus.current = receipt.insertedBlockId;
          const loaded = await reloadLatestDraft(
            receipt.insertedBlockId,
            undefined,
            true,
            undefined,
            undefined,
            {
              canAdopt,
              minimumRevision: receipt.acceptedRevision,
              acceptedDraft: receipt.acceptedDraft,
            },
          );
          if (!loaded || !canAdopt() || saveConflict.current || retainedSave.current.pending)
            throw new Error(
              "Recover the discussion question insertion acknowledgement before continuing.",
            );
          if (
            clean &&
            sourceMatches &&
            beforeRevision === receipt.acceptedRevision - 1 &&
            loaded.revision === receipt.acceptedRevision &&
            JSON.stringify(PresentationDraftSchema.parse(loaded.draft)) ===
              JSON.stringify(receipt.acceptedDraft)
          ) {
            setUndoStack([...history, before].slice(-HISTORY_LIMIT));
            setRedoStack([]);
          }
        }}
        onReloadTarget={async (binding) => {
          const context = textRecoveryContext;
          const canAdopt = () =>
            questionSuggestionsAuthorization.current &&
            alive.current &&
            assistancePermission.current &&
            currentTextRecoveryContext.current === context;
          if (!canAdopt())
            throw new Error("Your sign-in changed. Reload before recovering this source.");
          const loaded = await reloadLatestDraft(
            binding.blockId,
            undefined,
            true,
            undefined,
            binding,
            { canAdopt, minimumRevision: binding.expectedRevision },
          );
          if (!loaded || !canAdopt())
            throw new Error("The exact saved source could not be loaded. Your review is retained.");
          const block = loaded.draft.blocks.find((candidate) =>
            sameTextAssistanceBlockId(candidate.id, binding.blockId),
          );
          const source = block ? presentationQuestionSuggestionSource(block) : null;
          if (!source?.supported) throw new Error("The exact source is unavailable.");
          const target = {
            blockId: binding.blockId,
            expectedRevision: loaded.revision,
            source: source.source,
            sourceDigest: presentationQuestionSuggestionsSourceDigest(source.source),
          };
          setQuestionSuggestionsTarget(target);
          return target;
        }}
        onReloadForInvalidRecovery={async (canContinue) => {
          const context = textRecoveryContext;
          const current = () =>
            canContinue() &&
            questionSuggestionsAuthorization.current &&
            alive.current &&
            assistancePermission.current &&
            currentTextRecoveryContext.current === context;
          const otherReceiptPending = () =>
            Boolean(
              retainedSave.current.pending ||
              packPending.current ||
              packUpdatePending.current ||
              packOperation.current ||
              packUpdateOperation.current ||
              textAssistanceActive.current ||
              assistanceActive.current ||
              visualImportActive.current ||
              importPreparation.current,
            );
          if (!current())
            throw new Error(
              "Editor permission changed. Reload before clearing discussion recovery.",
            );
          const loaded = await reloadLatestDraft(
            selectedBlockId ?? undefined,
            undefined,
            true,
            { canAdopt: current, preserveWorkingDraft: otherReceiptPending },
            undefined,
            {
              canAdopt: current,
              minimumRevision: Math.max(revisionRef.current, draftBaseRevision.current),
            },
          );
          if (!loaded || !current())
            throw new Error(
              "The current saved deck could not be checked. The recovery record is retained.",
            );
          setQuestionSuggestionsTarget(null);
        }}
      />
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
