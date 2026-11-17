"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  QuizContentSchema,
  type BrandTheme,
  type QuizDraft,
  type WorkspaceProductFeatures,
} from "@openround/contracts";
import { resolveExperienceTheme } from "@openround/experience";
import { CreatorBrand } from "../../../../components/brand";
import { ExperiencePreferences } from "../../../../components/experience-preferences";
import { useLocale } from "../../../../components/locale-provider";
import { AUTH_CHANGE_EVENT, apiFetch, humanError } from "../../../../lib/api";
import { SESSION_EXPIRED_EVENT, SESSION_LOGOUT_EVENT } from "../../../../lib/idle-session";
import { RoundRehearsal } from "./round-rehearsal";
import styles from "./round-preview.module.css";

interface QuizRecord {
  id: string;
  status: "draft" | "published" | "archived";
  draft: QuizDraft;
}
interface PreviewAccount {
  brandTheme: BrandTheme | null;
  productFeatures: Pick<WorkspaceProductFeatures, "workspaceShell">;
}
type PreviewLoad =
  | { routeId: string; quiz: QuizRecord; account: PreviewAccount; generation: number }
  | { routeId: string; error: string };

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
  const { t } = useLocale();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [loaded, setLoaded] = useState<PreviewLoad | null>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let sessionEnded = false;
    function invalidateAccount() {
      if (sessionEnded) return;
      active = false;
      controller.abort();
      setLoaded(null);
      setGeneration((current) => current + 1);
    }
    function endSession() {
      sessionEnded = true;
      active = false;
      controller.abort();
      setLoaded(null);
      router.replace("/signin");
    }
    window.addEventListener(AUTH_CHANGE_EVENT, invalidateAccount);
    window.addEventListener(SESSION_EXPIRED_EVENT, endSession);
    window.addEventListener(SESSION_LOGOUT_EVENT, endSession);
    Promise.all([
      apiFetch<{ quiz: QuizRecord }>(`/v1/quizzes/${id}`, { signal: controller.signal }),
      apiFetch<PreviewAccount>("/v1/auth/me", { signal: controller.signal }),
    ])
      .then(([{ quiz }, account]) => {
        if (active) setLoaded({ routeId: id, quiz, account, generation });
      })
      .catch((caught) => {
        if (!active) return;
        if ((caught as { status?: number }).status === 401) router.replace("/signin");
        else setLoaded({ routeId: id, error: humanError(caught) });
      });
    return () => {
      active = false;
      controller.abort();
      window.removeEventListener(AUTH_CHANGE_EVENT, invalidateAccount);
      window.removeEventListener(SESSION_EXPIRED_EVENT, endSession);
      window.removeEventListener(SESSION_LOGOUT_EVENT, endSession);
    };
  }, [id, router, generation]);

  // The route and account generation guard the render as well as pending requests.
  const current = loaded?.routeId === id ? loaded : null;
  const data = current && "quiz" in current && current.generation === generation ? current : null;
  const validation = data ? previewValidationError(data.quiz.draft, t) : null;
  const rawError = current && "error" in current ? current.error : "";
  const error = rawError || validation?.message;
  const draft = validation?.content;
  const experienceTheme = draft
    ? resolveExperienceTheme({
        category: draft.category ?? "general",
        presetId: draft.experiencePreset?.id,
        brandTheme: data?.account.brandTheme,
      })
    : null;

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <CreatorBrand
          name={data?.account.brandTheme?.organizationName}
          productFeatures={data?.account.productFeatures}
        />
        <div className={styles.topbarActions}>
          <ExperiencePreferences />
          <Link className="button-quiet small-button" href={`/quiz/${id}`}>
            {t("delivery.presentation.backToEditor")}
          </Link>
          <Link className="button-quiet small-button" href="/dashboard">
            {t("delivery.builder.dashboard")}
          </Link>
        </div>
      </header>
      <main className={styles.main} id="main">
        {error ? (
          <section className={styles.stateCard}>
            <p className="error" lang={rawError ? "en-CA" : undefined} role="alert">
              {error}
            </p>
            <Link className="button" href={`/quiz/${id}`}>
              {t("reportRound.preview.returnToEditor")}
            </Link>
          </section>
        ) : !draft || !experienceTheme ? (
          <section className={styles.stateCard} aria-busy="true">
            <p role="status">{t("reportRound.preview.loading")}</p>
          </section>
        ) : (
          <RoundRehearsal
            key={`${id}:${generation}`}
            draft={draft}
            experienceTheme={experienceTheme}
          />
        )}
      </main>
    </div>
  );
}
