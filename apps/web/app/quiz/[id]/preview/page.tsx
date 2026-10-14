"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  QuizContentSchema,
  type BrandTheme,
  type QuestionDraft,
  type QuizDraft,
  type WorkspaceProductFeatures,
} from "@openround/contracts";
import { resolveExperienceTheme } from "@openround/experience";
import { CreatorBrand } from "../../../../components/brand";
import { ExperiencePreferences } from "../../../../components/experience-preferences";
import { useLocale } from "../../../../components/locale-provider";
import { LivePollChoices } from "../../../../components/live-poll-choices";
import { RankingChoices } from "../../../../components/ranking-choices";
import { initialRanking } from "../../../../lib/ranking-response";
import { TextResponseControl } from "../../../../components/text-response-control";
import { isTextQuestion } from "../../../../lib/text-response";
import { apiFetch, humanError } from "../../../../lib/api";
import { experienceThemeStyle } from "../../../../lib/theme";

interface QuizRecord {
  id: string;
  status: "draft" | "published" | "archived";
  draft: QuizDraft;
}

function isChoiceQuestion(
  question: QuestionDraft,
): question is Extract<
  QuestionDraft,
  { type: "single_select" | "true_false" | "multi_select" | "poll" }
> {
  return ["single_select", "true_false", "multi_select", "poll"].includes(question.type);
}

function previewValidationError(draft: QuizDraft, t: ReturnType<typeof useLocale>["t"]) {
  const result = QuizContentSchema.safeParse(draft);
  if (result.success) return { content: result.data, message: null };

  const issue = result.error.issues[0];
  const [root, itemIndex, field, choiceIndex] = issue?.path ?? [];
  let source = t("reportRound.preview.checkpointSet");
  if (root === "title") source = t("reportRound.preview.checkpointSetTitle");
  else if (root === "questions" && typeof itemIndex === "number") {
    source = t("reportRound.preview.checkpointNumber", { number: itemIndex + 1 });
    if (field === "choices" && typeof choiceIndex === "number") {
      source = t("reportRound.preview.checkpointAnswer", {
        checkpoint: itemIndex + 1,
        answer: choiceIndex + 1,
      });
    }
  } else if (root === "questions") source = t("reportRound.preview.checkpoints");

  return {
    content: null,
    message: t("reportRound.preview.validationError", {
      source,
      issue: issue?.message ?? t("reportRound.preview.completeSet"),
    }),
  };
}

export default function QuizPreviewPage() {
  const { locale, t } = useLocale();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [quiz, setQuiz] = useState<QuizRecord | null>(null);
  const [brandTheme, setBrandTheme] = useState<BrandTheme | null>(null);
  const [productFeatures, setProductFeatures] = useState<Pick<
    WorkspaceProductFeatures,
    "workspaceShell"
  > | null>(null);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [mediaSource, setMediaSource] = useState("");
  const [error, setError] = useState("");
  const [errorIsRaw, setErrorIsRaw] = useState(false);
  const question = quiz?.draft.questions[questionIndex];
  const experienceTheme = quiz
    ? resolveExperienceTheme({
        category: quiz.draft.category ?? "general",
        presetId: quiz.draft.experiencePreset?.id,
        brandTheme,
      })
    : null;

  useEffect(() => {
    Promise.all([
      apiFetch<{ quiz: QuizRecord }>(`/v1/quizzes/${id}`),
      apiFetch<{
        brandTheme: BrandTheme | null;
        productFeatures: Pick<WorkspaceProductFeatures, "workspaceShell">;
      }>("/v1/auth/me"),
    ])
      .then(([{ quiz: loadedQuiz }, account]) => {
        setBrandTheme(account.brandTheme);
        setProductFeatures(account.productFeatures);
        const validation = previewValidationError(loadedQuiz.draft, t);
        if (!validation.content) {
          setError(validation.message);
          setErrorIsRaw(false);
          return;
        }
        setQuiz({ ...loadedQuiz, draft: validation.content });
      })
      .catch((caught) => {
        if ((caught as { status?: number }).status === 401) router.replace("/signin");
        else {
          setError(humanError(caught));
          setErrorIsRaw(true);
        }
      });
  }, [id, router, t]);

  useEffect(() => {
    setRevealed(false);
    if (!question?.mediaId) {
      setMediaSource("");
      return;
    }
    let active = true;
    apiFetch<{ downloadUrl: string }>(`/v1/media/${question.mediaId}`)
      .then(({ downloadUrl }) => {
        if (active) setMediaSource(downloadUrl);
      })
      .catch(() => {
        if (active) setMediaSource("");
      });
    return () => {
      active = false;
    };
  }, [question?.id, question?.mediaId]);

  function move(direction: -1 | 1) {
    if (!quiz) return;
    setQuestionIndex((current) =>
      Math.min(Math.max(current + direction, 0), quiz.draft.questions.length - 1),
    );
  }

  return (
    <div
      className="live-shell"
      data-corners={experienceTheme?.tokens.corners}
      data-motion={experienceTheme?.motion}
      data-pattern={experienceTheme?.tokens.pattern}
      data-typography={experienceTheme?.tokens.typography}
      style={experienceThemeStyle(experienceTheme)}
    >
      <header className="shell live-topbar">
        <CreatorBrand
          inverted
          name={brandTheme?.organizationName}
          productFeatures={productFeatures}
        />
        <div className="button-row">
          <ExperiencePreferences />
          <Link className="button-quiet small-button" href={`/quiz/${id}`}>
            {t("delivery.presentation.backToEditor")}
          </Link>
          <Link className="button-quiet small-button" href="/dashboard">
            {t("delivery.builder.dashboard")}
          </Link>
        </div>
      </header>
      <main className="shell live-stage" id="main">
        {error ? (
          <section className="live-card">
            <p className="error" lang={errorIsRaw ? "en-CA" : undefined} role="alert">
              {error}
            </p>
            <Link className="button" href={`/quiz/${id}`}>
              {t("reportRound.preview.returnToEditor")}
            </Link>
          </section>
        ) : null}
        {!quiz && !error ? (
          <section className="live-card">
            <p>{t("reportRound.preview.loading")}</p>
          </section>
        ) : null}
        {quiz && !question ? (
          <section className="live-card">
            <p className="eyebrow">{t("delivery.builder.previewParticipant")}</p>
            <h1>{t("reportRound.preview.addCheckpoint")}</h1>
            <Link className="button" href={`/quiz/${id}`}>
              {t("reportRound.preview.returnToEditor")}
            </Link>
          </section>
        ) : null}
        {quiz && question ? (
          <section className="live-card">
            <div className="page-heading" style={{ alignItems: "center", marginBottom: 20 }}>
              <div>
                <p className="eyebrow">
                  {t("delivery.builder.previewParticipant")} ·{" "}
                  {t(`reportRound.status.${quiz.status}`)}
                </p>
                <span className="status-pill">
                  {t("reportRound.preview.progress", {
                    current: questionIndex + 1,
                    total: quiz.draft.questions.length,
                  })}
                </span>
              </div>
              <span
                className="countdown"
                aria-label={t("reportRound.preview.timerLabel", {
                  seconds: question.timeLimitSeconds,
                })}
              >
                {new Intl.NumberFormat(locale, {
                  style: "unit",
                  unit: "second",
                  unitDisplay: "narrow",
                }).format(question.timeLimitSeconds)}
              </span>
            </div>
            <h1 style={{ fontSize: "clamp(2rem, 7vw, 4rem)" }}>{question.prompt}</h1>
            {mediaSource ? (
              <img
                alt={question.mediaAlt ?? ""}
                className="question-media"
                height={360}
                src={mediaSource}
                width={640}
              />
            ) : null}
            {isTextQuestion(question.type) ? (
              <TextResponseControl type={question.type} disabled />
            ) : question.type === "ranking" ? (
              <RankingChoices
                question={question}
                selectedChoiceIds={initialRanking(question)}
                disabled
              />
            ) : question.type === "poll" && (question.maxSelections ?? 1) > 1 ? (
              <LivePollChoices question={question} disabled />
            ) : isChoiceQuestion(question) ? (
              <div className="answer-grid" aria-label={t("reportRound.preview.answerChoices")}>
                {question.choices.map((choice, index) => (
                  <div
                    className="answer-button"
                    data-correct={(revealed && choice.isCorrect) || undefined}
                    key={choice.id}
                  >
                    <span aria-hidden="true" style={{ marginRight: 10 }}>
                      {String.fromCharCode(65 + index)}.
                    </span>
                    {choice.label}
                  </div>
                ))}
              </div>
            ) : question.type === "numeric" ? (
              <div className="field">
                <label htmlFor="preview-numeric">
                  {t("reportRound.preview.numericResponse", { unit: question.unit ?? "" })}
                </label>
                <input className="input" disabled id="preview-numeric" inputMode="decimal" />
                {revealed ? (
                  <p className="success">
                    {t("reportRound.preview.acceptedValue", {
                      value: question.correctValue,
                      tolerance: question.tolerance,
                      unit: question.unit ?? "",
                    })}
                  </p>
                ) : null}
              </div>
            ) : question.type === "rating" ? (
              <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
                <legend className="field-label">{t("reportRound.preview.chooseRating")}</legend>
                <div className="button-row">
                  {Array.from(
                    { length: question.max - question.min + 1 },
                    (_, index) => question.min + index,
                  ).map((value) => (
                    <button className="answer-button" disabled key={value} type="button">
                      {value}
                    </button>
                  ))}
                </div>
                <p className="muted">
                  {question.minLabel} · {question.maxLabel}
                </p>
              </fieldset>
            ) : null}
            {revealed && question.type !== "ranking" && !isTextQuestion(question.type) ? (
              <div className="success" role="status">
                <strong>{t("reportRound.preview.correctRevealed")}</strong>
                {question.explanation ? <div>{question.explanation}</div> : null}
              </div>
            ) : null}
            <div className="button-row" style={{ marginTop: 28 }}>
              <button
                className="button-quiet"
                disabled={questionIndex === 0}
                onClick={() => move(-1)}
                type="button"
              >
                {t("reportRound.preview.previous")}
              </button>
              <button
                className="button-quiet"
                disabled={question.type === "ranking" || isTextQuestion(question.type)}
                onClick={() => setRevealed((current) => !current)}
                type="button"
              >
                {revealed ? t("reportRound.preview.hideAnswer") : t("delivery.live.reveal")}
              </button>
              <button
                className="button"
                disabled={questionIndex === quiz.draft.questions.length - 1}
                onClick={() => move(1)}
                type="button"
              >
                {t("reportRound.preview.next")}
              </button>
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
