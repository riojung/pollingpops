"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { questionTypeDefinition, type QuestionType } from "@openround/contracts";
import { AuthoringAssistant } from "../../components/authoring-assistant";
import { CheckpointSetImport } from "../../components/checkpoint-set-import";
import { useLocale } from "../../components/locale-provider";
import { StarterGallery } from "../../components/workspace/starter-gallery";
import { questionTypeOptions } from "../../components/workspace/workspace-model";
import { WorkspaceProvider, useWorkspace } from "../../components/workspace/workspace-provider";
import { WorkspaceShell } from "../../components/workspace/workspace-shell";
import styles from "../../components/workspace/workspace-content.module.css";
import { apiFetch, humanError } from "../../lib/api";
import type { MessageKey } from "../../lib/i18n/catalog";
import { recordCreationEvent } from "../../components/workspace/product-events";
import { workspaceCreationOptions } from "../../components/workspace/workspace-creation-model";
import { workspaceDiscoveryCopy } from "../../lib/i18n/workspace-discovery-messages";
import { creationGoalMessages } from "../../lib/i18n/creation-goal-messages";
import { creationContent } from "../../lib/i18n/creation-content";
import launcherStyles from "./create-launcher.module.css";

const starts = ["blank", "starters", "source", "import"] as const;
type StartMethod = (typeof starts)[number];

const questionTypeKeys: Record<QuestionType, { label: MessageKey; description: MessageKey }> = {
  single_select: {
    label: "questionType.single_select.label",
    description: "questionType.single_select.description",
  },
  true_false: {
    label: "questionType.true_false.label",
    description: "questionType.true_false.description",
  },
  multi_select: {
    label: "questionType.multi_select.label",
    description: "questionType.multi_select.description",
  },
  numeric: {
    label: "questionType.numeric.label",
    description: "questionType.numeric.description",
  },
  rating: {
    label: "questionType.rating.label",
    description: "questionType.rating.description",
  },
  open_text: {
    label: "questionType.open_text.label",
    description: "questionType.open_text.description",
  },
  word_cloud: {
    label: "questionType.word_cloud.label",
    description: "questionType.word_cloud.description",
  },
  ranking: { label: "questionType.ranking.label", description: "questionType.ranking.description" },
  poll: {
    label: "questionType.poll.label",
    description: "questionType.poll.description",
  },
};

function startMethod(value: string | null): StartMethod | null {
  return starts.some((start) => start === value) ? (value as StartMethod) : null;
}

function CreateContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t, locale } = useLocale();
  const copy = workspaceDiscoveryCopy(locale);
  const goals = creationGoalMessages(locale);
  const { canEdit, entitlements, productFeatures } = useWorkspace();
  const creationOptions = workspaceCreationOptions({ canEdit, productFeatures });
  const builderEnabled = productFeatures?.builderV2 === true;
  const [legacyHashMethod, setLegacyHashMethod] = useState<StartMethod | null>(null);
  const [title, setTitle] = useState("");
  const [questionType, setQuestionType] = useState<QuestionType>("single_select");
  const [busy, setBusy] = useState(false);
  const creatingRef = useRef(false);
  const [error, setError] = useState("");
  const requestedMethod = startMethod(searchParams.get("start")) ?? legacyHashMethod;
  const requestedKind = searchParams.get("type");
  const kind = !builderEnabled
    ? null
    : requestedKind === "quiz" || requestedKind === "poll" || requestedKind === "custom"
      ? requestedKind
      : requestedMethod
        ? "custom"
        : null;
  const selectedMethod = !kind
    ? null
    : kind === "poll" && (requestedMethod === "source" || requestedMethod === "import")
      ? "blank"
      : (requestedMethod ?? "blank");
  const availableTypes = questionTypeOptions
    .filter(
      (option) =>
        (option.type !== "ranking" || productFeatures?.rankingPolls) &&
        (option.type !== "open_text" || productFeatures?.openTextPolls) &&
        (option.type !== "word_cloud" || productFeatures?.wordCloudPolls),
    )
    .filter((option) =>
      kind === "quiz"
        ? questionTypeDefinition(option.type).scored
        : kind === "poll"
          ? !questionTypeDefinition(option.type).scored
          : true,
    );
  const effectiveType = availableTypes.some((option) => option.type === questionType)
    ? questionType
    : kind === "poll"
      ? "poll"
      : "single_select";

  const roundCards = builderEnabled
    ? (["quiz", "poll", "custom"] as const).map((type) => ({
        id: type,
        href: `/create?type=${type}${type === "poll" ? "&start=blank" : ""}`,
        label: t(`create.kind.${type}`),
        description: t(`create.kind.${type}.description`),
      }))
    : creationOptions
        .filter((option) => option.kind === "round")
        .map((option) => ({
          id: "round",
          href: option.href,
          label: t("common.round"),
          description: t("workspace.create.roundDescription"),
        }));
  const productCards = creationOptions
    .filter((option) => option.kind !== "round")
    .map((option) => ({
      id: option.kind,
      href: option.href,
      label:
        option.kind === "presentation"
          ? t("common.presentation")
          : option.kind === "survey"
            ? copy.survey
            : copy.ideaBoard,
      description:
        option.kind === "presentation"
          ? t("workspace.create.presentationDescription")
          : option.kind === "survey"
            ? t("create.kind.survey.description")
            : copy.ideaBoardDescription,
    }));
  const launcherCards =
    searchParams.get("product") === "round" ? roundCards : [...roundCards, ...productCards];
  const primaryCards = ["poll", "quiz", "presentation", "round"].flatMap((id) =>
    launcherCards.filter((card) => card.id === id),
  );
  const moreCards = launcherCards.filter((card) => !primaryCards.includes(card));
  const methods = starts.filter(
    (start) => kind !== "poll" || start === "starters" || start === "blank",
  );
  const methodLabel = (method: StartMethod) => goals[method === "starters" ? "templates" : method];
  function goalLabel(card: (typeof launcherCards)[number]) {
    return card.id === "poll"
      ? goals.poll
      : card.id === "quiz"
        ? goals.quiz
        : card.id === "presentation"
          ? goals.presentation
          : card.label;
  }
  function goalCard(option: (typeof launcherCards)[number]) {
    return option.id === "poll" ? (
      <button
        className={`${styles.startCard} ${launcherStyles.goalCard}`}
        disabled={busy}
        key={option.id}
        onClick={() => void createRound("poll")}
        type="button"
      >
        <strong className={launcherStyles.cardTitle}>{goalLabel(option)}</strong>
        <span className={launcherStyles.cardDescription}>{option.description}</span>
        <span className={styles.startLink}>
          {busy ? t("create.round.blank.creating") : t("create.round.blank.submit")}
        </span>
      </button>
    ) : (
      <Link
        className={`${styles.startCard} ${launcherStyles.goalCard}`}
        href={option.href}
        key={option.id}
      >
        <h2>{goalLabel(option)}</h2>
        <p>{option.description}</p>
        <span className={styles.startLink}>{t("create.kind.start")}</span>
      </Link>
    );
  }

  useEffect(() => {
    if (startMethod(searchParams.get("start"))) return;
    setLegacyHashMethod(startMethod(window.location.hash.slice(1)));
  }, [searchParams]);

  async function createBlank(event: FormEvent) {
    event.preventDefault();
    await createRound(effectiveType);
  }

  async function createRound(firstResponse: QuestionType) {
    if (!canEdit || !builderEnabled || creatingRef.current) return;
    creatingRef.current = true;
    setBusy(true);
    setError("");
    recordCreationEvent("creation_started", "blank", "round");
    try {
      const response = await apiFetch<{ quiz: { id: string } }>("/v1/quizzes", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim() || creationContent(locale)("untitledRound"),
          description: "",
        }),
      });
      recordCreationEvent("creation_completed", "blank", "round");
      router.push(
        `/quiz/${response.quiz.id}?insert=${firstResponse}&creationLocale=${encodeURIComponent(locale)}`,
      );
    } catch (caught) {
      setError(humanError(caught));
      creatingRef.current = false;
      setBusy(false);
    }
  }

  if (!canEdit) {
    return (
      <div className={styles.emptyState}>
        <h2>{t("create.common.readOnlyTitle")}</h2>
        <p>{t("create.round.readOnlyDescription")}</p>
        <Link className="button-quiet" href="/templates">
          {t("create.round.browseTemplates")}
        </Link>
      </div>
    );
  }

  return (
    <>
      {error && !selectedMethod ? (
        <p className="error" role="alert" lang="en-CA">
          {error}
        </p>
      ) : null}
      {!kind ? (
        <div className={launcherStyles.goalLauncher}>
          <nav className={launcherStyles.goalGrid} aria-label={goals.title}>
            {(primaryCards.length ? primaryCards : moreCards).map(goalCard)}
          </nav>
          {primaryCards.length && moreCards.length ? (
            <details className={launcherStyles.moreFormats}>
              <summary>{goals.moreFormats}</summary>
              <nav className={launcherStyles.goalGrid} aria-label={goals.moreFormats}>
                {moreCards.map(goalCard)}
              </nav>
            </details>
          ) : null}
          <p className={launcherStyles.draftNote}>{goals.privateDraft}</p>
        </div>
      ) : null}
      {selectedMethod ? (
        <div className={styles.focusedCreate}>
          <div className={styles.methodToolbar}>
            <Link className="button-quiet small-button" href="/create">
              {goals.allGoals}
            </Link>
            <span>
              {kind === "quiz"
                ? goals.quiz
                : kind === "poll"
                  ? goals.poll
                  : t("create.kind.custom")}
            </span>
          </div>
          <div
            className={launcherStyles.startTabs}
            role="tablist"
            aria-label={goals.startingPoints}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              const tabs = Array.from(
                event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
              );
              const current = tabs.indexOf(event.target as HTMLButtonElement);
              if (current < 0) return;
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? tabs.length - 1
                    : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
              tabs[next]?.click();
              tabs[next]?.focus();
            }}
          >
            {methods.map((start) => (
              <button
                aria-controls="creation-workflow-panel"
                aria-selected={selectedMethod === start}
                disabled={busy}
                id={`creation-start-${start}`}
                key={start}
                onClick={() =>
                  router.push(`/create?type=${kind}&start=${start}`, { scroll: false })
                }
                role="tab"
                tabIndex={selectedMethod === start ? 0 : -1}
                type="button"
              >
                {methodLabel(start)}
              </button>
            ))}
          </div>
          <div
            role="tabpanel"
            id="creation-workflow-panel"
            aria-labelledby={`creation-start-${selectedMethod}`}
          >
            {selectedMethod === "starters" ? (
              <section className={styles.panel} id="starters">
                <div className={styles.sectionHeader}>
                  <div>
                    <p className="eyebrow">{t("create.common.fastestStart")}</p>
                    <h2>{t("create.round.starter.title")}</h2>
                    <p>{t("create.round.starter.description")}</p>
                  </div>
                  <Link href="/templates">{t("create.round.starter.allTemplates")}</Link>
                </div>
                <StarterGallery compact roundType={kind === "custom" ? "all" : (kind ?? "all")} />
              </section>
            ) : null}

            {selectedMethod === "source" ? (
              <section className={styles.panel} id="source">
                <div className={styles.sectionHeader}>
                  <div>
                    <p className="eyebrow">{t("create.round.source.eyebrow")}</p>
                    <h2>{t("create.round.source.title")}</h2>
                    <p>{t("create.round.source.description")}</p>
                  </div>
                </div>
                <div>
                  <AuthoringAssistant canEdit plain terminology="round" trackCreation />
                </div>
              </section>
            ) : null}

            {selectedMethod === "import" ? (
              <section className={styles.panel} id="import">
                <div>
                  <CheckpointSetImport
                    enabled={Boolean(entitlements?.csvExport)}
                    onImported={async (quiz) => {
                      router.push(`/quiz/${quiz.id}`);
                    }}
                    onUpgrade={() => router.push("/pricing")}
                    plain
                    terminology="round"
                    trackCreation
                  />
                </div>
              </section>
            ) : null}

            {selectedMethod === "blank" ? (
              <section className={styles.panel} id="blank">
                <div className={styles.sectionHeader}>
                  <div>
                    <p className="eyebrow">{t("create.common.fullControl")}</p>
                    <h2>{t("create.round.blank.title")}</h2>
                    <p>{t("create.round.blank.description")}</p>
                  </div>
                </div>
                <form className={styles.blankForm} onSubmit={createBlank}>
                  <fieldset>
                    <legend>{t("create.round.blank.firstResponse")}</legend>
                    <div className={styles.typeGrid}>
                      {availableTypes.map((option) => (
                        <label className={styles.typeChoice} key={option.type}>
                          <input
                            checked={effectiveType === option.type}
                            name="question-type"
                            onChange={() => setQuestionType(option.type)}
                            type="radio"
                            value={option.type}
                          />
                          <span>
                            <strong>{t(questionTypeKeys[option.type].label)}</strong>
                            <small>{t(questionTypeKeys[option.type].description)}</small>
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <label className="field">
                    <span>{t("create.round.blank.titleLabel")}</span>
                    <input
                      className="input"
                      maxLength={160}
                      onChange={(event) => setTitle(event.target.value)}
                      placeholder={t("create.round.blank.titlePlaceholder")}
                      value={title}
                    />
                  </label>
                  {error ? (
                    <p className="error" lang="en-CA" role="alert">
                      {error}
                    </p>
                  ) : null}
                  <div>
                    <button className="button" disabled={busy} type="submit">
                      {busy ? t("create.round.blank.creating") : t("create.round.blank.submit")}
                    </button>
                  </div>
                </form>
              </section>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

export default function CreatePage() {
  const { t, locale } = useLocale();
  const copy = workspaceDiscoveryCopy(locale);
  const goals = creationGoalMessages(locale);
  return (
    <WorkspaceProvider>
      <WorkspaceShell
        actions={
          <Link className="button-quiet" href="/home">
            {copy.backToHome}
          </Link>
        }
        description={goals.description}
        eyebrow={t("create.round.eyebrow")}
        title={goals.title}
        translationLevel="full"
      >
        <CreateContent />
      </WorkspaceShell>
    </WorkspaceProvider>
  );
}
