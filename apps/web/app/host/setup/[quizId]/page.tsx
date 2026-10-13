"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  ExperiencePresetIdSchema,
  currentRoundClientCapabilities,
  SessionSettingsSchema,
  type Entitlements,
  type ExperiencePresetId,
  type QuizDraft,
  type SessionSettings,
  type SessionSnapshot,
} from "@openround/contracts";
import { CreatorBrand } from "../../../../components/brand";
import { EventCreditChoice } from "../../../../components/event-credit-choice";
import { ExperiencePicker } from "../../../../components/experience-picker";
import { useLocale } from "../../../../components/locale-provider";
import { apiFetch, humanError } from "../../../../lib/api";
import {
  resolveSetupRecipe,
  setupRecipeStorageKey,
  type SetupRecipe,
} from "../../../../lib/setup-recipes";

interface Creator {
  workspaceId: string;
  segment: "education" | "workplace";
}

interface QuizRecord {
  id: string;
  title: string;
  draft: QuizDraft;
  currentVersionId: string | null;
}

interface QuizVersionRecord {
  content: QuizDraft;
}

interface ProductFeatures {
  roundExperiences: boolean;
  audiencePulse: boolean;
  roomChat: boolean;
  liveFlexMode: boolean;
  uxBeta: boolean;
  workspaceShell: boolean;
}

function defaultsFor(creator: Creator, entitlements: Entitlements): SessionSettings {
  return {
    audienceLimit: Math.min(
      creator.segment === "education" ? 20 : 100,
      entitlements.maxParticipants,
    ),
    scoringMode: creator.segment === "education" ? "accuracy" : "speed",
    timeMode: "timed",
    resultVisibility: creator.segment === "education" ? "private" : "leaderboard",
    allowLateJoin: true,
    nicknamePolicy: creator.segment === "education" ? "friendly_only" : "custom",
  };
}

function SetupReview({ uxBeta, children }: { uxBeta: boolean; children: ReactNode }) {
  const { t } = useLocale();
  if (!uxBeta) return <>{children}</>;
  return (
    <details className="panel setup-review">
      <summary>{t("live.roundSetup.reviewSettings")}</summary>
      <p className="muted">{t("live.roundSetup.reviewHelp")}</p>
      {children}
    </details>
  );
}

export default function HostSetupPage() {
  const { quizId } = useParams<{ quizId: string }>();
  const router = useRouter();
  const { t } = useLocale();
  const tRef = useRef(t);
  tRef.current = t;
  const preserveFlexPreferenceRef = useRef(false);
  const [quiz, setQuiz] = useState<QuizRecord | null>(null);
  const [publishedContent, setPublishedContent] = useState<QuizDraft | null>(null);
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);
  const [useEventCredit, setUseEventCredit] = useState(false);
  const [eventEntitlements, setEventEntitlements] = useState<Entitlements | null>(null);
  const creationIntent = useRef<{ body: string; key: string } | null>(null);
  const [settings, setSettings] = useState<SessionSettings | null>(null);
  const [experiencePreset, setExperiencePreset] = useState<ExperiencePresetId>("focus");
  const [presenterSoundEnabled, setPresenterSoundEnabled] = useState(false);
  const [roundExperiencesAvailable, setRoundExperiencesAvailable] = useState(false);
  const [audienceTools, setAudienceTools] = useState({
    audiencePulseAvailable: false,
    roomChatAvailable: false,
  });
  const [uxBeta, setUxBeta] = useState(false);
  const [productFeatures, setProductFeatures] = useState<ProductFeatures | null>(null);
  const [creator, setCreator] = useState<Creator | null>(null);
  const [recipe, setRecipe] = useState<SetupRecipe | "custom">("recovery");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [errorIsRaw, setErrorIsRaw] = useState(false);

  useEffect(() => {
    Promise.all([
      apiFetch<{ quiz: QuizRecord; currentVersion: QuizVersionRecord | null }>(
        `/v1/quizzes/${quizId}`,
      ),
      apiFetch<{
        creator: Creator;
        entitlements: Entitlements;
        productFeatures: ProductFeatures;
      }>("/v1/auth/me"),
    ])
      .then(([quizResponse, account]) => {
        setProductFeatures(account.productFeatures);
        if (!quizResponse.quiz.currentVersionId || !quizResponse.currentVersion) {
          setErrorIsRaw(false);
          setError(
            account.productFeatures.uxBeta
              ? tRef.current("live.roundSetup.publishRound")
              : tRef.current("live.roundSetup.publishCheckpoint"),
          );
          return;
        }
        setQuiz(quizResponse.quiz);
        setPublishedContent(quizResponse.currentVersion.content);
        setEntitlements(account.entitlements);
        setCreator(account.creator);
        setRoundExperiencesAvailable(account.productFeatures.roundExperiences);
        setAudienceTools({
          audiencePulseAvailable: account.productFeatures.audiencePulse,
          roomChatAvailable: account.productFeatures.roomChat,
        });
        setUxBeta(account.productFeatures.uxBeta);
        const defaults = defaultsFor(account.creator, account.entitlements);
        if (!account.productFeatures.uxBeta) {
          preserveFlexPreferenceRef.current = false;
          setSettings(defaults);
          setExperiencePreset(
            account.productFeatures.roundExperiences
              ? (quizResponse.currentVersion.content.experiencePreset?.id ?? "focus")
              : "focus",
          );
          setPresenterSoundEnabled(false);
          return;
        }
        let restored = false;
        try {
          const saved = JSON.parse(
            localStorage.getItem(setupRecipeStorageKey(account.creator.workspaceId)) ?? "null",
          ) as {
            recipe?: SetupRecipe | "custom";
            settings?: SessionSettings;
            experiencePreset?: ExperiencePresetId;
            presenterSoundEnabled?: boolean;
          } | null;
          const parsedSettings = SessionSettingsSchema.safeParse(saved?.settings);
          const parsedPreset = ExperiencePresetIdSchema.safeParse(saved?.experiencePreset);
          const parsedRecipe = ["recovery", "competition", "discussion", "custom"].includes(
            saved?.recipe ?? "",
          )
            ? saved!.recipe!
            : "custom";
          if (parsedSettings.success) {
            const restoredSettings = parsedSettings.data;
            preserveFlexPreferenceRef.current =
              restoredSettings.timeMode === "flex" && !account.productFeatures.liveFlexMode;
            setSettings({
              ...restoredSettings,
              timeMode: account.productFeatures.liveFlexMode ? restoredSettings.timeMode : "timed",
              audienceLimit: Math.min(
                Math.max(1, restoredSettings.audienceLimit),
                account.entitlements.maxParticipants,
              ),
            });
            setRecipe(parsedRecipe);
            setExperiencePreset(
              account.productFeatures.roundExperiences
                ? parsedPreset.success
                  ? parsedPreset.data
                  : "focus"
                : "focus",
            );
            setPresenterSoundEnabled(
              account.productFeatures.roundExperiences && Boolean(saved?.presenterSoundEnabled),
            );
            restored = true;
          }
        } catch {
          localStorage.removeItem(setupRecipeStorageKey(account.creator.workspaceId));
        }
        if (!restored) {
          preserveFlexPreferenceRef.current = false;
          const resolved = resolveSetupRecipe("recovery", defaults, {
            segment: account.creator.segment,
            maxParticipants: account.entitlements.maxParticipants,
            roundExperiencesAvailable: account.productFeatures.roundExperiences,
          });
          setSettings(resolved.settings);
          setExperiencePreset(resolved.experiencePreset);
          setPresenterSoundEnabled(resolved.presenterSoundEnabled);
        }
      })
      .catch((caught) => {
        if ((caught as { status?: number }).status === 401) router.replace("/signin");
        else {
          setErrorIsRaw(true);
          setError(humanError(caught));
        }
      });
  }, [quizId, router]);

  useEffect(() => {
    if (!creator || !settings || !uxBeta) return;
    const storedSettings = preserveFlexPreferenceRef.current
      ? { ...settings, timeMode: "flex" as const, scoringMode: "accuracy" as const }
      : settings;
    localStorage.setItem(
      setupRecipeStorageKey(creator.workspaceId),
      JSON.stringify({ recipe, settings: storedSettings, experiencePreset, presenterSoundEnabled }),
    );
  }, [creator, experiencePreset, presenterSoundEnabled, recipe, settings, uxBeta]);

  function applyRecipe(nextRecipe: SetupRecipe) {
    if (!settings || !creator || !entitlements) return;
    if (nextRecipe === "competition") preserveFlexPreferenceRef.current = false;
    const resolved = resolveSetupRecipe(nextRecipe, settings, {
      segment: creator.segment,
      maxParticipants: entitlements.maxParticipants,
      roundExperiencesAvailable,
    });
    setRecipe(nextRecipe);
    setSettings(resolved.settings);
    setExperiencePreset(resolved.experiencePreset);
    setPresenterSoundEnabled(resolved.presenterSoundEnabled);
    void apiFetch<{ accepted: number }>("/v1/product-events", {
      method: "POST",
      body: JSON.stringify({
        events: [
          {
            name: "setup_recipe_selected",
            occurredAt: new Date().toISOString(),
            dimensions: {
              recipe:
                nextRecipe === "competition"
                  ? "friendly_competition"
                  : nextRecipe === "discussion"
                    ? "open_discussion"
                    : "recovery",
            },
          },
        ],
      }),
    }).catch(() => undefined);
  }

  async function createSession(event: FormEvent) {
    event.preventDefault();
    if (!quiz || !publishedContent || !settings || !entitlements || busy) return;
    setBusy(true);
    setError("");
    setErrorIsRaw(false);
    const body = JSON.stringify({
      quizId: quiz.id,
      settings,
      clientCapabilities: currentRoundClientCapabilities(),
      ...(roundExperiencesAvailable &&
      experiencePreset !== (publishedContent.experiencePreset?.id ?? "focus")
        ? { experiencePresetOverride: experiencePreset }
        : {}),
      presenterSoundEnabled: roundExperiencesAvailable && presenterSoundEnabled,
      useEventCredit,
    });
    if (creationIntent.current?.body !== body)
      creationIntent.current = { body, key: crypto.randomUUID() };
    try {
      const session = await apiFetch<{
        sessionId: string;
        code: string;
        hostToken: string;
        snapshot: SessionSnapshot;
      }>("/v1/sessions", {
        method: "POST",
        headers: { "x-idempotency-key": creationIntent.current.key },
        body,
      });
      sessionStorage.setItem(`openround:host:${session.sessionId}`, session.hostToken);
      sessionStorage.setItem(`openround:code:${session.sessionId}`, session.code);
      router.push(`/host/${session.sessionId}`);
    } catch (caught) {
      setErrorIsRaw(true);
      setError(humanError(caught));
      setBusy(false);
    }
  }

  return (
    <>
      <header className="shell topbar" data-ux-beta={uxBeta || undefined}>
        <CreatorBrand productFeatures={productFeatures} />
        <div className="button-row">
          {quiz ? (
            <Link className="button-quiet small-button" href={`/quiz/${quiz.id}/preview`}>
              {uxBeta ? t("live.roundSetup.previewRound") : t("live.roundSetup.previewCheckpoint")}
            </Link>
          ) : null}
          <Link className="button-quiet small-button" href="/dashboard">
            {t("live.common.dashboard")}
          </Link>
        </div>
      </header>
      <main className="shell page-main" id="main">
        <div className="page-heading">
          <div>
            <p className="eyebrow">{t("live.roundSetup.sessionSetup")}</p>
            <h1 lang={quiz ? "" : undefined}>{quiz?.title ?? t("live.roundSetup.prepare")}</h1>
            <p className="muted">{t("live.roundSetup.description")}</p>
          </div>
        </div>
        {error ? (
          <p className="error" lang={errorIsRaw ? "en-CA" : undefined} role="alert">
            {error}
          </p>
        ) : null}
        {!settings || !entitlements ? (
          !error ? (
            <p>{t("live.roundSetup.loading")}</p>
          ) : null
        ) : (
          <form onSubmit={createSession}>
            {uxBeta ? (
              <section className="panel setup-recipes" data-testid="session-setup">
                <p className="eyebrow">{t("live.roundSetup.recipe")}</p>
                <h2 style={{ fontSize: "1.8rem" }}>{t("live.roundSetup.recipeTitle")}</h2>
                <div className="recipe-grid">
                  <button
                    aria-pressed={recipe === "recovery"}
                    className="recipe-card"
                    data-recipe="recovery"
                    onClick={() => applyRecipe("recovery")}
                    type="button"
                  >
                    <strong>{t("live.roundSetup.recoveryTitle")}</strong>
                    <span>{t("live.roundSetup.recoveryDescription")}</span>
                  </button>
                  <button
                    aria-pressed={recipe === "competition"}
                    className="recipe-card"
                    data-recipe="competition"
                    onClick={() => applyRecipe("competition")}
                    type="button"
                  >
                    <strong>{t("live.roundSetup.competitionTitle")}</strong>
                    <span>{t("live.roundSetup.competitionDescription")}</span>
                  </button>
                  <button
                    aria-pressed={recipe === "discussion"}
                    className="recipe-card"
                    data-recipe="discussion"
                    onClick={() => applyRecipe("discussion")}
                    type="button"
                  >
                    <strong>{t("live.roundSetup.discussionTitle")}</strong>
                    <span>
                      {t("live.roundSetup.discussionDescription", {
                        tools: t(
                          audienceTools.audiencePulseAvailable
                            ? "live.roundSetup.tools.pulseQna"
                            : "live.roundSetup.tools.qna",
                        ),
                        chat: audienceTools.roomChatAvailable
                          ? t("live.roundSetup.tools.chat")
                          : "",
                      })}
                    </span>
                  </button>
                </div>
              </section>
            ) : null}
            <SetupReview uxBeta={uxBeta}>
              <EventCreditChoice
                checked={useEventCredit}
                disabled={busy}
                onChange={(checked, benefits) => {
                  setUseEventCredit(checked);
                  setEventEntitlements(benefits);
                  if (!checked)
                    setSettings({
                      ...settings,
                      audienceLimit: Math.min(settings.audienceLimit, entitlements.maxParticipants),
                    });
                }}
              />
              <div className="settings-grid">
                <section className="panel">
                  <p className="eyebrow">{t("live.roundSetup.room")}</p>
                  <h2 style={{ fontSize: "1.8rem" }}>{t("live.roundSetup.audienceJoining")}</h2>
                  <label className="field" htmlFor="audience-limit">
                    <span>{t("live.roundSetup.maximumParticipants")}</span>
                    <input
                      className="input"
                      id="audience-limit"
                      max={
                        useEventCredit && eventEntitlements
                          ? eventEntitlements.maxParticipants
                          : entitlements.maxParticipants
                      }
                      min={1}
                      onChange={(event) => {
                        setRecipe("custom");
                        setSettings({ ...settings, audienceLimit: Number(event.target.value) });
                      }}
                      required
                      type="number"
                      value={settings.audienceLimit}
                    />
                    <small className="muted">
                      {t("live.roundSetup.planLimit", {
                        count:
                          useEventCredit && eventEntitlements
                            ? eventEntitlements.maxParticipants
                            : entitlements.maxParticipants,
                      })}
                    </small>
                  </label>
                  <label className="checkbox-field">
                    <input
                      checked={settings.allowLateJoin}
                      onChange={(event) => {
                        setRecipe("custom");
                        setSettings({ ...settings, allowLateJoin: event.target.checked });
                      }}
                      type="checkbox"
                    />
                    {t("live.roundSetup.allowLateJoin", {
                      item: t(
                        uxBeta
                          ? "live.roundSetup.item.question"
                          : "live.roundSetup.item.checkpoint",
                      ),
                    })}
                  </label>
                  {productFeatures?.liveFlexMode ? (
                    <label className="field" htmlFor="time-mode">
                      <span>{t("live.common.timeMode")}</span>
                      <select
                        className="select"
                        id="time-mode"
                        onChange={(event) => {
                          const timeMode = event.target.value as "timed" | "flex";
                          setRecipe("custom");
                          setSettings({
                            ...settings,
                            timeMode,
                            scoringMode: timeMode === "flex" ? "accuracy" : settings.scoringMode,
                          });
                        }}
                        value={settings.timeMode ?? "timed"}
                      >
                        <option value="timed">{t("live.common.timedMode")}</option>
                        <option value="flex">{t("live.common.flexMode")}</option>
                      </select>
                      <small className="muted">{t("live.common.flexSetupHelp")}</small>
                    </label>
                  ) : null}
                </section>

                <section className="panel">
                  <p className="eyebrow">{t("live.roundSetup.experience")}</p>
                  <h2 style={{ fontSize: "1.8rem" }}>{t("live.roundSetup.lookMotionSound")}</h2>
                  {roundExperiencesAvailable ? (
                    <>
                      <ExperiencePicker
                        category={publishedContent?.category ?? "general"}
                        onPresetChange={(preset) => {
                          setRecipe("custom");
                          setExperiencePreset(preset);
                        }}
                        presetId={experiencePreset}
                        showCategory={false}
                      />
                      <label className="checkbox-field">
                        <input
                          checked={presenterSoundEnabled}
                          onChange={(event) => {
                            setRecipe("custom");
                            setPresenterSoundEnabled(event.target.checked);
                          }}
                          type="checkbox"
                        />
                        {t("live.roundSetup.soundEnabled")}
                      </label>
                      <small className="muted">{t("live.roundSetup.soundDescription")}</small>
                    </>
                  ) : (
                    <p className="notice">{t("live.roundSetup.experienceUnavailable")}</p>
                  )}
                  <hr className="staff-divider" />
                  <h3>{t("live.roundSetup.scoring")}</h3>
                  <label className="field" htmlFor="scoring-mode">
                    <span>{t("live.roundSetup.scoringMode")}</span>
                    <select
                      className="select"
                      id="scoring-mode"
                      onChange={(event) => {
                        setRecipe("custom");
                        if (event.target.value === "speed") {
                          preserveFlexPreferenceRef.current = false;
                        }
                        setSettings({
                          ...settings,
                          scoringMode: event.target.value as SessionSettings["scoringMode"],
                        });
                      }}
                      value={settings.scoringMode}
                    >
                      <option value="accuracy">{t("live.roundSetup.accuracyScoring")}</option>
                      <option disabled={settings.timeMode === "flex"} value="speed">
                        {t("live.roundSetup.competitiveScoring")}
                      </option>
                    </select>
                  </label>
                  <label className="field" htmlFor="result-visibility">
                    <span>{t("live.roundSetup.resultVisibility")}</span>
                    <select
                      className="select"
                      id="result-visibility"
                      onChange={(event) => {
                        setRecipe("custom");
                        setSettings({
                          ...settings,
                          resultVisibility: event.target
                            .value as SessionSettings["resultVisibility"],
                        });
                      }}
                      value={settings.resultVisibility}
                    >
                      <option value="private">{t("live.roundSetup.privateResults")}</option>
                      <option value="leaderboard">{t("live.roundSetup.leaderboardResults")}</option>
                    </select>
                  </label>
                  <label className="field" htmlFor="nickname-policy">
                    <span>{t("live.roundSetup.names")}</span>
                    <select
                      className="select"
                      id="nickname-policy"
                      onChange={(event) => {
                        setRecipe("custom");
                        setSettings({
                          ...settings,
                          nicknamePolicy: event.target.value as SessionSettings["nicknamePolicy"],
                        });
                      }}
                      value={settings.nicknamePolicy}
                    >
                      <option value="friendly_only">{t("live.roundSetup.friendlyNames")}</option>
                      <option value="custom">{t("live.roundSetup.customNames")}</option>
                    </select>
                  </label>
                </section>
              </div>
            </SetupReview>
            <section className="panel" style={{ marginTop: 24 }}>
              <h2 style={{ fontSize: "1.6rem" }}>{t("live.roundSetup.readyTitle")}</h2>
              <p className="muted">{t("live.roundSetup.readyDescription")}</p>
              <div className="button-row">
                <button className="button" disabled={busy} type="submit">
                  {busy ? t("live.roundSetup.creating") : t("live.roundSetup.create")}
                </button>
                <Link className="button-quiet" href="/dashboard">
                  {t("live.common.cancel")}
                </Link>
              </div>
            </section>
          </form>
        )}
      </main>
    </>
  );
}
