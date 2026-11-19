"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { QuestionType, RoundCategory, QuizDraft, StarterGuide } from "@openround/contracts";
import type { SurveyDraft } from "@openround/contracts/surveys";
import { templateGuideCopy } from "../../lib/i18n/template-guide-copy";
import { StarterTemplatePreview, type StarterPreviewContent } from "./starter-template-preview";
import { apiFetch, humanError, ApiClientError, AUTH_CHANGE_EVENT } from "../../lib/api";
import { SESSION_EXPIRED_EVENT, SESSION_LOGOUT_EVENT } from "../../lib/idle-session";
import { starterPreviewCopy } from "../../lib/i18n/starter-preview-copy";
import { starterCopyCopy } from "../../lib/i18n/starter-copy-copy";
import {
  createStarterCopyIntentStore,
  starterCopyFailure,
  starterCopyRequest,
  StarterCopyStorageError,
  type StarterCopyFailure,
  type StarterCopyIntent,
} from "../../lib/starter-copy-intent";
import previewStyles from "./starter-template-preview.module.css";
import { useLocale } from "../locale-provider";
import { formatNumber, pluralCategory } from "../../lib/i18n/format";
import type { MessageKey } from "../../lib/i18n/catalog";
import { useWorkspace } from "./workspace-provider";
import { prioritizeStartersForSegment } from "./workspace-model";
import type { StarterSummary } from "./workspace-types";
import styles from "./workspace-content.module.css";
import galleryStyles from "./template-gallery.module.css";
import { recordAuthoringEvent, recordCreationEvent } from "./product-events";
import { surveyMutationKey } from "../../lib/survey-client";
import { collectionTemplateIds, type TemplateCollectionId } from "../../lib/template-collections";

const categoryKeys: Record<RoundCategory, MessageKey> = {
  general: "category.general",
  education: "category.education",
  business: "category.business",
  technical: "category.technical",
  safety_compliance: "category.safety_compliance",
  icebreaker: "category.icebreaker",
  science: "category.science",
  health_wellbeing: "category.health_wellbeing",
  arts_culture: "category.arts_culture",
  leadership: "category.leadership",
  sustainability: "category.sustainability",
  community: "category.community",
};

const questionTypeLabelKeys: Record<QuestionType, MessageKey> = {
  single_select: "questionType.single_select.label",
  true_false: "questionType.true_false.label",
  multi_select: "questionType.multi_select.label",
  numeric: "questionType.numeric.label",
  rating: "questionType.rating.label",
  poll: "questionType.poll.label",
  ranking: "questionType.ranking.label",
  open_text: "questionType.open_text.label",
  word_cloud: "questionType.word_cloud.label",
};

type PreviewState = {
  starter: StarterSummary;
  scope: string;
  content?: StarterPreviewContent;
  guide?: StarterGuide;
  contentVersion?: string;
  loading: boolean;
  error: string;
  reveal?: boolean;
};

type StarterFilters = {
  collection: TemplateCollectionId | null;
  search: string;
  category: RoundCategory | "all";
  type: "all" | "quiz" | "poll" | "custom";
};
type RoundCopyRecovery = {
  actor: string;
  ready: boolean;
  storageError: boolean;
  intents: StarterCopyIntent[];
  failures: Record<string, StarterCopyFailure>;
  known: Record<
    string,
    { intent: StarterCopyIntent; quizId: string; feedback: "cleanup" | "opening" }
  >;
};
const emptyRoundRecovery = (actor: string): RoundCopyRecovery => ({
  actor,
  ready: false,
  storageError: false,
  intents: [],
  failures: {},
  known: {},
});

export function StarterGallery({
  compact = false,
  roundType = "all",
  survey = false,
  collection = null,
}: {
  compact?: boolean;
  roundType?: "all" | "quiz" | "poll" | "custom";
  survey?: boolean;
  collection?: TemplateCollectionId | null;
}) {
  const router = useRouter();
  const { locale, t } = useLocale();
  const guideCopy = templateGuideCopy(locale);
  const copy = starterPreviewCopy(locale);
  const copyIntent = starterCopyCopy(locale);
  const { creator, canEdit, productFeatures, loading: workspaceLoading } = useWorkspace();
  const actor = JSON.stringify([creator?.userId, creator?.workspaceId]);
  const scope = JSON.stringify([actor, locale, survey]);
  const authority = JSON.stringify([
    scope,
    canEdit,
    creator?.role,
    productFeatures,
    workspaceLoading,
  ]);
  const [starters, setStarters] = useState<StarterSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [lastRoundAction, setLastRoundAction] = useState("");
  const defaults: StarterFilters = { collection, search: "", category: "all", type: roundType };
  const [filters, setFilters] = useState<StarterFilters>(defaults);
  const currentFilters = filters.collection === collection ? filters : defaults;
  // Reset browsing without unmounting the owner of pending copies and retry intents.
  if (filters.collection !== collection) setFilters(currentFilters);
  const { search, category, type } = currentFilters;
  function updateFilters(change: Partial<Omit<StarterFilters, "collection">>) {
    setFilters((current) => ({ ...current, ...change }));
  }
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [contentLocale, setContentLocale] = useState(locale);
  const [catalogScope, setCatalogScope] = useState("");
  const [contentVersion, setContentVersion] = useState<{ scope: string; value: string } | null>(
    null,
  );
  const [roundRecovery, setRoundRecovery] = useState(() => emptyRoundRecovery(actor));
  const recovery = roundRecovery.actor === actor ? roundRecovery : emptyRoundRecovery(actor);
  const recoveryRef = useRef(recovery);
  recoveryRef.current = recovery;
  const roundStore = useRef<{
    actor: string;
    value: ReturnType<typeof createStarterCopyIntentStore>;
  } | null>(null);
  const [invalidActor, setInvalidActor] = useState<string | null>(null);
  const surveyRequests = useRef(new Map<string, string>());
  const creating = useRef(false);
  const mounted = useRef(true);
  const listRequest = useRef(0);
  const previewRequest = useRef(0);
  const actionRequest = useRef(0);
  const selection = useRef(0);
  const access = useRef({ authority, version: 0 });
  if (access.current.authority !== authority)
    access.current = { authority, version: access.current.version + 1 };
  const accessVersion = access.current.version;
  const renderedSelection = selection.current;
  const latest = useRef({ scope, authority, actor, allowed: false, invalid: false });
  const authInvalid = invalidActor === actor;
  const allowed = Boolean(
    creator?.userId && creator.workspaceId && canEdit && !workspaceLoading && !authInvalid,
  );
  latest.current = { scope, authority, actor, allowed, invalid: authInvalid };
  const catalogCurrent = !loading && catalogScope === scope && !authInvalid;
  // Old-language summaries may remain during a locale reload, but never another actor's content.
  const sameCatalogActor =
    catalogScope !== "" &&
    JSON.parse(catalogScope)[0] === actor &&
    JSON.parse(catalogScope)[2] === survey;
  const visibleStarters = sameCatalogActor && !authInvalid ? starters : [];
  const currentPreview = preview?.scope === scope && !authInvalid ? preview : null;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!mounted.current || latest.current.scope !== scope || latest.current.invalid) return;
    const request = ++listRequest.current;
    setLoadError("");
    setLoading(true);
    try {
      const result = survey
        ? await apiFetch<{ templates: StarterSummary[] }>(`/v1/surveys/templates?locale=${locale}`)
        : await apiFetch<{ starters: StarterSummary[]; contentVersion: string }>(
            `/v1/starters?locale=${locale}`,
          );
      const items = "templates" in result ? result.templates : result.starters;
      if (
        request !== listRequest.current ||
        latest.current.scope !== scope ||
        latest.current.invalid
      )
        return;
      setStarters(items);
      if ("contentVersion" in result) setContentVersion({ scope, value: result.contentVersion });
      setCatalogScope(scope);
      setContentLocale(locale);
    } catch (caught) {
      if (
        request !== listRequest.current ||
        latest.current.scope !== scope ||
        latest.current.invalid
      )
        return;
      setLoadError(humanError(caught));
    } finally {
      if (
        request === listRequest.current &&
        latest.current.scope === scope &&
        !latest.current.invalid
      )
        setLoading(false);
    }
  }, [locale, survey, scope]);

  useEffect(() => {
    setBusyId("");
    setActionError("");
    void refresh();
    return () => {
      listRequest.current++;
      previewRequest.current++;
      actionRequest.current++;
      selection.current++;
      creating.current = false;
    };
  }, [refresh]);

  function publishRecovery(next: RoundCopyRecovery) {
    recoveryRef.current = next;
    setRoundRecovery(next);
  }
  function restoreRoundCopies() {
    if (
      survey ||
      !mounted.current ||
      latest.current.actor !== actor ||
      latest.current.invalid ||
      roundStore.current?.actor !== actor
    )
      return;
    try {
      const intents = roundStore.current.value.read();
      publishRecovery({ ...recoveryRef.current, actor, ready: true, storageError: false, intents });
    } catch {
      publishRecovery({ ...recoveryRef.current, actor, ready: false, storageError: true });
    }
  }
  useEffect(() => {
    if (survey || !creator?.userId || !creator.workspaceId) return;
    const value = createStarterCopyIntentStore({
      actor: { actorId: creator.userId, workspaceId: creator.workspaceId },
      storage: {
        getItem: (key) => window.sessionStorage.getItem(key),
        setItem: (key, value) => window.sessionStorage.setItem(key, value),
        removeItem: (key) => window.sessionStorage.removeItem(key),
      },
    });
    roundStore.current = { actor, value };
    try {
      const intents = value.read();
      const next = { ...emptyRoundRecovery(actor), ready: true, intents };
      recoveryRef.current = next;
      setRoundRecovery(next);
    } catch {
      const next = { ...emptyRoundRecovery(actor), storageError: true };
      recoveryRef.current = next;
      setRoundRecovery(next);
    }
    return () => {
      if (roundStore.current?.value === value) roundStore.current = null;
    };
  }, [actor, creator?.userId, creator?.workspaceId, survey]);

  useEffect(() => {
    // Retry intents belong to the actor and workspace that submitted them.
    surveyRequests.current.clear();
    setBusyId("");
    setActionError("");
    if (typeof window === "undefined") return;
    const invalidate = () => {
      latest.current.invalid = true;
      latest.current.allowed = false;
      listRequest.current++;
      previewRequest.current++;
      actionRequest.current++;
      selection.current++;
      creating.current = false;
      surveyRequests.current.clear();
      roundStore.current = null;
      publishRecovery(emptyRoundRecovery(actor));
      setInvalidActor(actor);
      setPreview(null);
      setBusyId("");
      setActionError("");
    };
    const events = [AUTH_CHANGE_EVENT, SESSION_EXPIRED_EVENT, SESSION_LOGOUT_EVENT];
    events.forEach((name) => window.addEventListener(name, invalidate));
    return () => events.forEach((name) => window.removeEventListener(name, invalidate));
  }, [actor]);

  const copyKey = (starterId: string) => JSON.stringify([starterId, locale]);
  function pendingRound(starterId: string) {
    return !survey
      ? recovery.intents.find(
          (intent) =>
            intent.starterId === starterId && starterCopyRequest(intent).locale === locale,
        )
      : undefined;
  }
  function roundFailure(starterId: string) {
    return recovery.failures[copyKey(starterId)];
  }
  function roundKnown(starterId: string) {
    return recovery.known[copyKey(starterId)];
  }
  function hasRoundRecovery(starterId: string) {
    return Boolean(pendingRound(starterId) || roundKnown(starterId));
  }

  function eligible(starter: StarterSummary) {
    const inspected =
      currentPreview?.starter.id === starter.id ? currentPreview.content : undefined;
    if (
      inspected?.kind === "round" &&
      inspected.draft.questions.some(
        (question) => question.type === "poll" && (question.maxSelections ?? 1) > 1,
      ) &&
      productFeatures?.multiSelectPolls !== true
    )
      return false;
    return survey
      ? productFeatures?.surveys === true
      : starter.responseTypes.every((responseType) =>
          responseType === "ranking"
            ? productFeatures?.rankingPolls === true
            : responseType === "open_text"
              ? productFeatures?.openTextPolls === true
              : responseType === "word_cloud"
                ? productFeatures?.wordCloudPolls === true
                : true,
        );
  }

  const loadPreview = useCallback(
    async (starter: StarterSummary, reveal = false) => {
      if (
        !mounted.current ||
        latest.current.scope !== scope ||
        latest.current.invalid ||
        catalogScope !== scope ||
        loading
      )
        return;
      const request = ++previewRequest.current;
      selection.current++;
      setPreview({ starter, scope, loading: true, error: "", reveal });
      try {
        let content: StarterPreviewContent;
        let guide: StarterGuide | undefined;
        let previewVersion: string | undefined;
        if (survey) {
          const result = await apiFetch<{ draft: SurveyDraft; guide?: StarterGuide }>(
            `/v1/surveys/templates/${starter.id}?locale=${locale}`,
          );
          content = { kind: "survey", draft: result.draft };
          guide = result.guide;
        } else {
          const result = await apiFetch<{
            draft: QuizDraft;
            guide?: StarterGuide;
            contentVersion: string;
          }>(`/v1/starters/${starter.id}?locale=${locale}`);
          content = { kind: "round", draft: result.draft };
          guide = result.guide;
          previewVersion = result.contentVersion;
        }
        if (
          request !== previewRequest.current ||
          latest.current.scope !== scope ||
          latest.current.invalid
        )
          return;
        setPreview({
          starter,
          scope,
          content,
          guide: guide ?? starter.guide,
          contentVersion: previewVersion,
          loading: false,
          error: "",
          reveal,
        });
      } catch (caught) {
        if (
          request !== previewRequest.current ||
          latest.current.scope !== scope ||
          latest.current.invalid
        )
          return;
        setPreview({ starter, scope, loading: false, error: humanError(caught), reveal });
      }
    },
    [catalogScope, loading, locale, scope, survey],
  );

  function closePreview() {
    previewRequest.current++;
    selection.current++;
    setPreview(null);
  }

  async function useStarter(starter: StarterSummary, fromPreview = false, renew = false) {
    const requestVersion = fromPreview
      ? currentPreview?.contentVersion
      : contentVersion?.scope === scope
        ? contentVersion.value
        : undefined;
    const expectedIntent = !survey
      ? recoveryRef.current.intents.find(
          (intent) =>
            intent.starterId === starter.id && starterCopyRequest(intent).locale === locale,
        )
      : undefined;
    const recovering =
      !survey &&
      Boolean(expectedIntent || recoveryRef.current.known[copyKey(starter.id)]) &&
      !renew;
    const failure = recoveryRef.current.failures[copyKey(starter.id)];
    if (
      creating.current ||
      !mounted.current ||
      access.current.version !== accessVersion ||
      renderedSelection !== selection.current ||
      !allowed ||
      (!recovering && (!eligible(starter) || !catalogCurrent)) ||
      (!survey &&
        (!recoveryRef.current.ready ||
          (!recovering && !requestVersion) ||
          (!renew && (failure === "renew" || failure === "replace" || failure === "conflict")))) ||
      latest.current.authority !== authority ||
      !latest.current.allowed ||
      latest.current.invalid
    )
      return;
    if (
      fromPreview &&
      !recovering &&
      (!currentPreview?.content ||
        currentPreview.loading ||
        currentPreview.error ||
        currentPreview.starter.id !== starter.id)
    )
      return;
    creating.current = true;
    const request = ++actionRequest.current;
    // Preview-only changes do not cancel a submitted copy or hide its outcome.
    // Authority/context changes still fence late responses below.
    const current = () =>
      mounted.current &&
      access.current.version === accessVersion &&
      request === actionRequest.current &&
      latest.current.authority === authority &&
      latest.current.allowed &&
      !latest.current.invalid;
    setBusyId(starter.id);
    if (!survey) setLastRoundAction(starter.id);
    setActionError("");
    let navigated = false;
    let roundIntent: StarterCopyIntent | undefined;
    if (!survey) recordCreationEvent("creation_started", "starter", "round");
    try {
      if (survey) {
        // A retry in this actor, workspace and language reuses the exact mutation body.
        const intentKey = JSON.stringify([actor, locale, starter.id]);
        const body =
          surveyRequests.current.get(intentKey) ??
          JSON.stringify({ idempotencyKey: surveyMutationKey(), templateId: starter.id, locale });
        surveyRequests.current.set(intentKey, body);
        const response = await apiFetch<{ survey: { id: string } }>("/v1/surveys", {
          method: "POST",
          body,
        });
        if (current()) {
          navigated = true;
          router.push(`/surveys/${encodeURIComponent(response.survey.id)}`);
        }
        return;
      }
      const store = roundStore.current?.actor === actor ? roundStore.current.value : null;
      if (!store) throw new StarterCopyStorageError();
      const identity = copyKey(starter.id);
      const known = recoveryRef.current.known[identity];
      if (known) {
        if (known.feedback === "cleanup") store.retire(known.intent);
        publishRecovery({
          ...recoveryRef.current,
          ready: true,
          storageError: false,
          intents: store.read(),
          known: { ...recoveryRef.current.known, [identity]: { ...known, feedback: "opening" } },
        });
        router.push(`/quiz/${encodeURIComponent(known.quizId)}`);
        navigated = true;
        return;
      }
      if (renew) {
        if (!expectedIntent || (failure !== "renew" && failure !== "replace") || !requestVersion)
          return;
        roundIntent = store.renew(expectedIntent, requestVersion, failure);
      } else if (expectedIntent) {
        const saved = store.find(starter.id, locale);
        if (
          !saved ||
          saved.body !== expectedIntent.body ||
          JSON.stringify(saved.previousBodies) !== JSON.stringify(expectedIntent.previousBodies)
        )
          throw new StarterCopyStorageError();
        roundIntent = saved;
      } else roundIntent = store.prepare(starter.id, locale, requestVersion ?? "");
      publishRecovery({
        ...recoveryRef.current,
        intents: store.read(),
        failures: { ...recoveryRef.current.failures, [identity]: "unknown" },
      });
      const response = await apiFetch<{ quiz: { id: string }; replayed?: boolean }>(
        `/v1/starters/${encodeURIComponent(starter.id)}/use`,
        {
          method: "POST",
          body: roundIntent.body,
        },
      );
      if (!current()) return;
      publishRecovery({
        ...recoveryRef.current,
        known: {
          ...recoveryRef.current.known,
          [identity]: { intent: roundIntent, quizId: response.quiz.id, feedback: "cleanup" },
        },
      });
      store.retire(roundIntent);
      publishRecovery({
        ...recoveryRef.current,
        intents: store.read(),
        known: {
          ...recoveryRef.current.known,
          [identity]: { intent: roundIntent, quizId: response.quiz.id, feedback: "opening" },
        },
      });
      recordCreationEvent("creation_completed", "starter", "round");
      if (starter.questionCount > 0) recordAuthoringEvent("first_block_created", "round");
      router.push(`/quiz/${encodeURIComponent(response.quiz.id)}`);
      navigated = true;
    } catch (caught) {
      if (!current()) return;
      if (survey) {
        if (caught instanceof ApiClientError && caught.status < 500 && caught.status !== 429)
          surveyRequests.current.delete(JSON.stringify([actor, locale, starter.id]));
      } else if (caught instanceof StarterCopyStorageError) {
        publishRecovery({ ...recoveryRef.current, ready: false, storageError: true });
      } else {
        let reason = starterCopyFailure(caught);
        try {
          if (
            reason === "conflict" &&
            roundIntent?.previousBodies.length &&
            roundStore.current?.actor === actor
          ) {
            roundStore.current.value.recoverPrevious(roundIntent);
            reason = "unknown";
          }
          publishRecovery({
            ...recoveryRef.current,
            intents:
              roundStore.current?.actor === actor
                ? roundStore.current.value.read()
                : recoveryRef.current.intents,
            failures: { ...recoveryRef.current.failures, [copyKey(starter.id)]: reason },
          });
          if ((caught as { code?: unknown })?.code === "STARTER_CONTENT_CHANGED") {
            previewRequest.current++;
            selection.current++;
            setCatalogScope(JSON.stringify([actor, locale, survey, "refreshing"]));
            setPreview({
              starter,
              scope,
              loading: true,
              error: "",
              reveal: currentPreview?.reveal,
            });
            void refresh().then(() => loadPreview(starter));
          }
        } catch {
          publishRecovery({ ...recoveryRef.current, ready: false, storageError: true });
        }
      }
      setActionError(humanError(caught));
    } finally {
      if (!navigated && request === actionRequest.current) {
        setBusyId("");
        creating.current = false;
      }
    }
  }

  const effectiveType = survey ? "poll" : roundType !== "all" ? roundType : type;
  const collectionIds = collectionTemplateIds(survey ? "survey" : "round", collection);
  const orderedStarters = [...prioritizeStartersForSegment(visibleStarters, creator?.segment)]
    .sort((first, second) => Number(Boolean(second.guide)) - Number(Boolean(first.guide)))
    .filter(
      (starter) =>
        (!collectionIds || collectionIds.includes(starter.id)) &&
        (!survey ||
          starter.responseTypes.every(
            (responseType) => responseType === "poll" || responseType === "rating",
          )) &&
        (effectiveType === "all" || starter.roundType === effectiveType) &&
        (category === "all" || starter.category === category) &&
        `${starter.title} ${starter.description} ${starter.guide?.audience ?? ""}`
          .toLocaleLowerCase(locale)
          .includes(search.trim().toLocaleLowerCase(locale)),
    );
  const selectedId = currentPreview?.starter.id;
  const firstStarter = orderedStarters[0];
  const selectionVisible = orderedStarters.some((starter) => starter.id === selectedId);
  // Noncompact browsing always shows a preview of a visible result. Compact callers retain cards.
  useEffect(() => {
    if (compact || !catalogCurrent) return;
    if (!selectionVisible) {
      if (firstStarter) void loadPreview(firstStarter);
      else if (selectedId) {
        previewRequest.current++;
        selection.current++;
        setPreview(null);
      }
    }
  }, [compact, catalogCurrent, selectionVisible, selectedId, firstStarter, loadPreview]);

  function metadata(
    starter: StarterSummary,
    content?: StarterPreviewContent,
    guide = starter.guide,
  ) {
    const questions =
      content?.kind === "round"
        ? content.draft.questions
        : content?.draft.items.map((item) => item.question);
    const questionCount = questions?.length ?? starter.questionCount;
    const responseTypes = questions
      ? [...new Set(questions.map((question) => question.type))]
      : starter.responseTypes;
    return (
      <div className={galleryStyles.metaLine}>
        {guide ? (
          <span>
            {guideCopy("About {minutes} min", {
              minutes: formatNumber(locale, guide.minutes),
            })}
          </span>
        ) : null}
        <span>{t(`create.kind.${survey ? "survey" : starter.roundType}`)}</span>
        <span>
          {t(
            pluralCategory(locale, questionCount) === "one"
              ? "starter.questionCount.one"
              : "starter.questionCount.other",
            { count: formatNumber(locale, questionCount) },
          )}
        </span>
        <span>
          {responseTypes.map((responseType) => t(questionTypeLabelKeys[responseType])).join(" · ")}
        </span>
      </div>
    );
  }

  function roundUseLabel(starterId: string) {
    return busyId === starterId
      ? copyIntent.creatingCopy
      : roundKnown(starterId)
        ? copyIntent.openCreated
        : pendingRound(starterId)
          ? copyIntent.retryCopy
          : t("starter.use");
  }
  function roundErrorMessage(starterId: string) {
    const known = roundKnown(starterId);
    return known?.feedback === "cleanup"
      ? copyIntent.cleanupError
      : known
        ? copyIntent.openError
        : copyIntent.requestError;
  }
  function roundUseAvailable(starter: StarterSummary) {
    const failure = roundFailure(starter.id);
    return (
      canEdit &&
      (eligible(starter) || hasRoundRecovery(starter.id)) &&
      (Boolean(roundKnown(starter.id)) || !failure || failure === "unknown")
    );
  }
  function storageNotice() {
    return !survey && !recovery.ready ? (
      <div className={previewStyles.error} data-starter-copy-storage>
        <p role={recovery.storageError ? "alert" : "status"}>
          {recovery.storageError ? copyIntent.recoveryError : copyIntent.checkingRecovery}
        </p>
        {recovery.storageError ? (
          <button className="button-quiet" type="button" onClick={restoreRoundCopies}>
            {copyIntent.retryRecovery}
          </button>
        ) : null}
      </div>
    ) : null;
  }
  function roundNotice(starter: StarterSummary) {
    if (survey) return null;
    const known = roundKnown(starter.id);
    const failure = roundFailure(starter.id);
    if (!known && !failure && !pendingRound(starter.id)) return null;
    return (
      <div className={previewStyles.copyNotice} data-starter-copy-recovery={starter.id}>
        {known ? (
          <p role="status">
            {known.feedback === "cleanup" ? copyIntent.cleanupError : copyIntent.openError}
          </p>
        ) : failure === "conflict" ? (
          <p role="alert">
            {copyIntent.conflict} <a href="/library">{t("workspace.nav.library")}</a>
          </p>
        ) : failure === "renew" || failure === "replace" ? (
          <div role="alert">
            <p>{copyIntent.restartNotice}</p>
            <button
              className="button-quiet"
              type="button"
              disabled={
                !allowed ||
                !recovery.ready ||
                !catalogCurrent ||
                !eligible(starter) ||
                (currentPreview?.starter.id === starter.id &&
                  (currentPreview.loading ||
                    Boolean(currentPreview.error) ||
                    !currentPreview.content ||
                    !currentPreview.contentVersion)) ||
                Boolean(busyId)
              }
              onClick={() =>
                void useStarter(starter, currentPreview?.starter.id === starter.id, true)
              }
            >
              {copyIntent.createAnother}
            </button>
          </div>
        ) : pendingRound(starter.id) ? (
          <p role="status">{copyIntent.pendingCopy}</p>
        ) : null}
      </div>
    );
  }

  const previewPanel =
    currentPreview && (compact || selectionVisible) ? (
      <StarterTemplatePreview
        key={`${scope}:${currentPreview.starter.id}`}
        id={currentPreview.starter.id}
        content={currentPreview.content}
        title={currentPreview.starter.title}
        description={currentPreview.starter.description}
        guide={currentPreview.guide}
        contentLocale={locale}
        uiLocale={locale}
        closeLabel={t("starter.closePreview")}
        onClose={closePreview}
        mode={compact ? "dialog" : "panel"}
        loading={currentPreview.loading}
        reveal={currentPreview.reveal}
        error={currentPreview.error}
        onRetry={() => void loadPreview(currentPreview.starter)}
        metadata={metadata(currentPreview.starter, currentPreview.content, currentPreview.guide)}
        useLabel={
          survey
            ? busyId === currentPreview.starter.id
              ? t("starter.creating")
              : t("starter.use")
            : roundUseLabel(currentPreview.starter.id)
        }
        onUse={
          (
            survey
              ? canEdit && eligible(currentPreview.starter)
              : roundUseAvailable(currentPreview.starter)
          )
            ? () => void useStarter(currentPreview.starter, true)
            : undefined
        }
        useDisabled={
          Boolean(busyId) ||
          !allowed ||
          (survey
            ? !catalogCurrent
            : !recovery.ready ||
              (!hasRoundRecovery(currentPreview.starter.id) &&
                (!catalogCurrent || !currentPreview.contentVersion)))
        }
        recoveryWithoutPreview={!survey && hasRoundRecovery(currentPreview.starter.id)}
        useNote={
          !survey && hasRoundRecovery(currentPreview.starter.id)
            ? roundKnown(currentPreview.starter.id)
              ? roundErrorMessage(currentPreview.starter.id)
              : copyIntent.pendingCopy
            : undefined
        }
        actionNotice={
          !survey ? (
            <>
              {storageNotice()}
              {roundNotice(currentPreview.starter)}
            </>
          ) : undefined
        }
        readOnlyLabel={!canEdit ? t("starter.readOnly") : undefined}
        actionError={actionError}
        actionErrorMessage={!survey ? roundErrorMessage(lastRoundAction) : undefined}
      />
    ) : null;

  if (authInvalid)
    return (
      <p role="alert" lang={locale}>
        {copy.authChanged}
      </p>
    );
  if (loading && visibleStarters.length === 0)
    return (
      <p className={styles.muted} lang={locale} role="status">
        {t("starter.loading")}
      </p>
    );

  return (
    <div lang={locale} aria-busy={loading}>
      <div className={galleryStyles.gallerySummary}>
        <strong role="status">
          {copy.matching.replace("{count}", formatNumber(locale, orderedStarters.length))}
        </strong>
        <span>{t("templateLibrary.englishContent")}</span>
      </div>
      <div className={galleryStyles.filters}>
        <label className="field">
          <span>{t("starter.search")}</span>
          <input
            className="input"
            type="search"
            value={search}
            onChange={(event) => updateFilters({ search: event.target.value })}
          />
        </label>
        <label className="field">
          <span>{t("starter.allCategories")}</span>
          <select
            className="input"
            value={category}
            onChange={(event) =>
              updateFilters({ category: event.target.value as RoundCategory | "all" })
            }
          >
            <option value="all">{t("starter.allCategories")}</option>
            {Object.entries(categoryKeys).map(([value, key]) => (
              <option value={value} key={value}>
                {t(key)}
              </option>
            ))}
          </select>
        </label>
        {!survey && roundType === "all" ? (
          <label className="field">
            <span>{t("starter.allTypes")}</span>
            <select
              className="input"
              value={type}
              onChange={(event) => updateFilters({ type: event.target.value as typeof type })}
            >
              <option value="all">{t("starter.allTypes")}</option>
              {(["quiz", "poll", "custom"] as const).map((value) => (
                <option value={value} key={value}>
                  {t(`create.kind.${value}`)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      {loadError ? (
        <div className={previewStyles.error}>
          <p role="alert">{copy.catalogError}</p>
          <details>
            <summary>{copy.details}</summary>
            <p lang="en-CA">{loadError}</p>
          </details>
          <button
            className="button-quiet small-button"
            onClick={() => void refresh()}
            type="button"
          >
            {t("starter.retry")}
          </button>
        </div>
      ) : null}
      {actionError && !previewPanel ? (
        <div className={previewStyles.error} role="alert">
          <p>{survey ? copy.actionError : roundErrorMessage(lastRoundAction)}</p>
          <details>
            <summary>{copy.details}</summary>
            <p lang="en-CA">{actionError}</p>
          </details>
        </div>
      ) : null}
      {!previewPanel ? storageNotice() : null}
      {!survey
        ? recovery.intents
            .filter(
              (intent) =>
                starterCopyRequest(intent).locale === locale &&
                intent.starterId !== currentPreview?.starter.id &&
                !(compact && orderedStarters.some((starter) => starter.id === intent.starterId)),
            )
            .map((intent) => {
              const starter =
                visibleStarters.find((starter) => starter.id === intent.starterId) ??
                ({
                  id: intent.starterId,
                  title: intent.starterId,
                  description: "",
                  questionCount: 0,
                  responseTypes: [],
                  category: "general",
                  segment: "all",
                  experiencePreset: { id: "focus", version: 1 },
                  version: 1,
                  roundType: "custom",
                } as StarterSummary);
              return (
                <div
                  className="notice"
                  data-starter-copy-recovery={intent.starterId}
                  key={intent.starterId}
                >
                  <p lang={locale}>{starter.title}</p>
                  {roundNotice(starter)}
                  {roundUseAvailable(starter) ? (
                    <button
                      className="button"
                      type="button"
                      disabled={!allowed || !recovery.ready || Boolean(busyId)}
                      onClick={() => void useStarter(starter)}
                    >
                      {roundUseLabel(starter.id)}
                    </button>
                  ) : null}
                </div>
              );
            })
        : null}
      <div className={!compact ? previewStyles.browser : undefined}>
        {!compact && orderedStarters.length > 0 ? (
          <label className={`field ${previewStyles.mobileSelect}`}>
            <span>{copy.choose}</span>
            <select
              className="input"
              value={selectionVisible ? selectedId : ""}
              disabled={!catalogCurrent}
              onChange={(event) => {
                const starter = orderedStarters.find((item) => item.id === event.target.value);
                if (starter) void loadPreview(starter);
              }}
            >
              <option value="" disabled>
                {copy.choose}
              </option>
              {orderedStarters.map((starter) => (
                <option key={starter.id} value={starter.id}>
                  {starter.title}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div
          className={compact ? galleryStyles.starterGrid : previewStyles.summaryList}
          data-compact={compact || undefined}
          aria-label={copy.templates}
        >
          {orderedStarters.map((starter) => {
            const recommended = starter.segment === "all" || starter.segment === creator?.segment;
            const selected = selectedId === starter.id;
            return (
              <article
                className={`${galleryStyles.templateCard} ${!compact ? previewStyles.summaryCard : ""}`}
                data-selected={(!compact && selected) || undefined}
                data-category={starter.category}
                key={starter.id}
                data-template-id={starter.id}
              >
                <div className={galleryStyles.cardTopline}>
                  <span className={galleryStyles.category}>
                    {t(categoryKeys[starter.category])}
                  </span>
                  {recommended ? (
                    <span className={galleryStyles.recommended}>{t("starter.recommended")}</span>
                  ) : null}
                </div>
                <h3 lang={contentLocale}>{starter.title}</h3>
                <p lang={contentLocale}>{starter.description}</p>
                {compact && starter.guide ? (
                  <p className={galleryStyles.audience} lang={contentLocale}>
                    {starter.guide.audience}
                  </p>
                ) : null}
                {compact && starter.previewPrompt && !selected ? (
                  <div className={galleryStyles.questionSample}>
                    <small>{t("templateLibrary.questionPreview")}</small>
                    <p lang={contentLocale}>{starter.previewPrompt}</p>
                  </div>
                ) : null}
                {metadata(starter)}
                <div className={galleryStyles.cardActions}>
                  <button
                    className="button-quiet small-button"
                    type="button"
                    disabled={!(compact && selected) && !catalogCurrent}
                    aria-expanded={compact ? selected : undefined}
                    aria-pressed={!compact ? selected : undefined}
                    aria-haspopup={compact ? "dialog" : undefined}
                    aria-controls={selected ? `starter-preview-${starter.id}` : undefined}
                    onClick={(event) => {
                      event.currentTarget.focus();
                      if (compact && selected) closePreview();
                      else if (!selected) void loadPreview(starter, !compact);
                    }}
                  >
                    {compact && selected
                      ? t("starter.closePreview")
                      : survey
                        ? guideCopy("Preview questionnaire")
                        : t("starter.preview")}
                  </button>
                  {compact &&
                  (survey ? canEdit && eligible(starter) : roundUseAvailable(starter)) ? (
                    <button
                      className="button small-button"
                      disabled={
                        Boolean(busyId) ||
                        !allowed ||
                        (survey
                          ? !catalogCurrent
                          : !recovery.ready ||
                            (!hasRoundRecovery(starter.id) &&
                              (!catalogCurrent ||
                                contentVersion?.scope !== scope ||
                                !contentVersion.value)))
                      }
                      onClick={() => void useStarter(starter)}
                      type="button"
                    >
                      {survey
                        ? busyId === starter.id
                          ? t("starter.creating")
                          : t("starter.use")
                        : roundUseLabel(starter.id)}
                    </button>
                  ) : compact && !canEdit ? (
                    <p className={galleryStyles.readOnlyNote}>{t("starter.readOnly")}</p>
                  ) : null}
                </div>
                {compact && !selected ? roundNotice(starter) : null}
              </article>
            );
          })}
        </div>
        {!compact ? previewPanel : null}
      </div>
      {compact ? previewPanel : null}
      {visibleStarters.length > 0 && orderedStarters.length === 0 ? (
        <p role="status">{t("starter.noMatches")}</p>
      ) : null}
      {!visibleStarters.length && !loadError ? (
        <div className={styles.emptyState}>
          <h3>{t("starter.emptyTitle")}</h3>
          <p>{t("starter.emptyDescription")}</p>
        </div>
      ) : null}
    </div>
  );
}
