"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
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

type StartMethod = "starters" | "source" | "import" | "blank";

const starts: Array<{
  id: StartMethod;
  titleKey: MessageKey;
  descriptionKey: MessageKey;
  badgeKey: MessageKey;
}> = [
  {
    id: "starters",
    titleKey: "create.round.method.starter.title",
    descriptionKey: "create.round.method.starter.description",
    badgeKey: "create.common.fastestStart",
  },
  {
    id: "source",
    titleKey: "create.round.method.source.title",
    descriptionKey: "create.round.method.source.description",
    badgeKey: "create.common.sourceGrounded",
  },
  {
    id: "import",
    titleKey: "create.round.method.import.title",
    descriptionKey: "create.round.method.import.description",
    badgeKey: "create.round.method.import.badge",
  },
  {
    id: "blank",
    titleKey: "create.round.method.blank.title",
    descriptionKey: "create.round.method.blank.description",
    badgeKey: "create.common.fullControl",
  },
];

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
  poll: {
    label: "questionType.poll.label",
    description: "questionType.poll.description",
  },
};

function startMethod(value: string | null): StartMethod | null {
  return starts.some((start) => start.id === value) ? (value as StartMethod) : null;
}

function CreateContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useLocale();
  const { canEdit, entitlements } = useWorkspace();
  const [legacyHashMethod, setLegacyHashMethod] = useState<StartMethod | null>(null);
  const [title, setTitle] = useState("");
  const [questionType, setQuestionType] = useState<QuestionType>("single_select");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestedMethod = startMethod(searchParams.get("start")) ?? legacyHashMethod;
  const requestedKind = searchParams.get("type");
  const kind =
    requestedKind === "quiz" || requestedKind === "poll" || requestedKind === "custom"
      ? requestedKind
      : requestedMethod
        ? "custom"
        : null;
  const selectedMethod =
    kind === "poll" && (requestedMethod === "source" || requestedMethod === "import")
      ? null
      : requestedMethod;
  const availableTypes = questionTypeOptions.filter((option) =>
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

  useEffect(() => {
    if (startMethod(searchParams.get("start"))) return;
    setLegacyHashMethod(startMethod(window.location.hash.slice(1)));
  }, [searchParams]);

  async function createBlank(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    recordCreationEvent("creation_started", "blank", "round");
    try {
      const response = await apiFetch<{ quiz: { id: string } }>("/v1/quizzes", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim() || "Untitled Round",
          description: "",
        }),
      });
      recordCreationEvent("creation_completed", "blank", "round");
      router.push(`/quiz/${response.quiz.id}?insert=${effectiveType}`);
    } catch (caught) {
      setError(humanError(caught));
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
      {!kind ? (
        <nav className={styles.startGrid} aria-label={t("create.kind.title")}>
          {(["quiz", "poll", "survey", "custom"] as const).map((type, index) => (
            <Link
              className={styles.startCard}
              href={type === "survey" ? "/surveys/new" : `/create?type=${type}`}
              key={type}
            >
              <span className={styles.startNumber} aria-hidden="true">
                {index + 1}
              </span>
              <h2>{t(`create.kind.${type}`)}</h2>
              <p>{t(`create.kind.${type}.description`)}</p>
              <span className={styles.startLink}>{t("create.kind.start")}</span>
            </Link>
          ))}
        </nav>
      ) : null}
      {kind && !selectedMethod ? (
        <>
          <div className={styles.methodToolbar}>
            <Link href="/create" className="button-quiet small-button">
              {t("create.kind.title")}
            </Link>
            <h2>{t(`create.kind.${kind}`)}</h2>
          </div>
          <nav className={styles.startGrid} aria-label={t("create.round.waysLabel")}>
            {starts
              .filter((start) => kind !== "poll" || start.id === "starters" || start.id === "blank")
              .map((start, index) => (
                <Link
                  className={styles.startCard}
                  href={`/create?type=${kind}&start=${start.id}`}
                  key={start.id}
                >
                  <span className={styles.startNumber} aria-hidden="true">
                    {index + 1}
                  </span>
                  <span className={styles.startBadge}>{t(start.badgeKey)}</span>
                  <h2>{t(start.titleKey)}</h2>
                  <p>{t(start.descriptionKey)}</p>
                  <span className={styles.startLink}>{t("create.round.choosePath")}</span>
                </Link>
              ))}
          </nav>
          <aside aria-label={t("create.round.review.label")} className={styles.launcherNote}>
            <strong>{t("create.round.review.title")}</strong>
            <span>{t("create.round.review.description")}</span>
          </aside>
        </>
      ) : selectedMethod ? (
        <div className={styles.focusedCreate}>
          <div className={styles.methodToolbar}>
            <Link className="button-quiet small-button" href="/create">
              {t("create.common.allStartingPoints")}
            </Link>
            <span>
              {t(`create.kind.${kind ?? "custom"}`)} ·{" "}
              {t(starts.find((start) => start.id === selectedMethod)?.badgeKey ?? "common.create")}
            </span>
          </div>

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
              <div lang="en-CA">
                <AuthoringAssistant canEdit plain terminology="round" trackCreation />
              </div>
            </section>
          ) : null}

          {selectedMethod === "import" ? (
            <section className={styles.panel} id="import">
              <div lang="en-CA">
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
      ) : null}
    </>
  );
}

export default function CreatePage() {
  const { t } = useLocale();
  return (
    <WorkspaceProvider>
      <WorkspaceShell
        actions={
          <Link className="button-quiet" href="/library">
            {t("create.round.backToRounds")}
          </Link>
        }
        description={t("create.round.description")}
        eyebrow={t("create.round.eyebrow")}
        requiredFeature="builderV2"
        title={t("create.kind.title")}
        translationLevel="full"
      >
        <CreateContent />
      </WorkspaceShell>
    </WorkspaceProvider>
  );
}
