"use client";

import Link from "next/link";
import { useCallback, useMemo } from "react";
import { useLocale } from "../../components/locale-provider";
import { WorkspaceProvider, useWorkspace } from "../../components/workspace/workspace-provider";
import { WorkspaceShell } from "../../components/workspace/workspace-shell";
import { HomeGuidance } from "./home-guidance";
import { professionalRoundBuilderAvailable } from "../../lib/help-guide-availability";
import { pluralCategory } from "../../lib/i18n/format";
import { workspaceDiscoveryCopy } from "../../lib/i18n/workspace-discovery-messages";
import { canvasMessages } from "../../lib/i18n/canvas-messages";
import { workspaceCreationOptions } from "../../components/workspace/workspace-creation-model";
import { homeWorkAction, recentHomeWork, type HomeWork } from "./home-model";
import { useHomeSummary } from "./home-summary";
import styles from "./home.module.css";

type Translator = ReturnType<typeof useLocale>["t"];

function localizedProgress(label: string, t: Translator) {
  if (label === "Lobby") return t("pages.home.sessions.lobby");
  if (label === "Complete") return t("pages.common.completed");
  const question = /^Question (\d+) of (\d+)$/.exec(label);
  if (question) {
    return t("pages.home.sessions.questionProgress", {
      current: question[1] ?? "",
      total: question[2] ?? "",
    });
  }
  const block = /^Block (\d+) of (\d+)$/.exec(label);
  if (block) {
    return t("pages.home.sessions.blockProgress", {
      current: block[1] ?? "",
      total: block[2] ?? "",
    });
  }
  return label;
}

function HomeWorkspace() {
  const { locale, t } = useLocale();
  const { canEdit, creator, workspace, productFeatures, loading: accountLoading } = useWorkspace();
  const copy = workspaceDiscoveryCopy(locale);
  const canvasCopy = canvasMessages(locale);
  const contextKey =
    !accountLoading && creator && productFeatures?.workspaceShell === true
      ? JSON.stringify([
          creator.userId,
          creator.workspaceId,
          workspace?.id,
          workspace?.organization?.id,
          creator.role,
          productFeatures.presentations,
          productFeatures.surveys,
          productFeatures.ideaBoards,
          productFeatures.canvasBoards,
          productFeatures.groups,
        ])
      : null;
  const { summary, loading, error, refresh: loadSummary } = useHomeSummary(contextKey);
  const canCreate = workspaceCreationOptions({ canEdit, productFeatures }).length > 0;
  const recentWork = summary ? recentHomeWork(summary) : [];
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
    [locale],
  );
  const formatDate = useCallback(
    (value: string) => dateFormatter.format(new Date(value)),
    [dateFormatter],
  );

  const activeSessions = summary?.sessions.filter((session) => session.status === "active") ?? [];
  const firstName = creator?.email.split("@", 1)[0]?.replace(/[._-]+/g, " ") || "there";
  const createHref = "/create";
  function workType(artifact: HomeWork) {
    if (artifact.artifactType === "round") return t("common.round");
    if (artifact.artifactType === "presentation") return t("common.presentation");
    if (artifact.artifactType === "survey") return copy.survey;
    if (artifact.artifactType === "idea_board") return copy.ideaBoard;
    return artifact.artifactType === "canvas" && artifact.boardType === "workshop"
      ? canvasCopy["canvas.workshop"]
      : copy.canvas;
  }
  function workStatus(artifact: HomeWork) {
    if (artifact.status === "organizing") return copy.statusOrganizing;
    if (artifact.status === "collecting") return copy.statusCollecting;
    if (artifact.status === "voting") return copy.statusVoting;
    if (artifact.status === "closed") return copy.statusClosed;
    if (artifact.status === "frozen") return copy.statusFrozen;
    if (artifact.status === "active") return copy.statusActive;
    return t(`pages.common.status.${artifact.status}`);
  }
  function workCount(artifact: HomeWork) {
    if (artifact.itemCount === null) return null;
    const singular = pluralCategory(locale, artifact.itemCount) === "one";
    if (artifact.artifactType === "round" || artifact.artifactType === "survey")
      return t(
        singular
          ? "pages.home.authoring.questionCount.one"
          : "pages.home.authoring.questionCount.other",
        { count: artifact.itemCount },
      );
    if (artifact.artifactType === "presentation")
      return t("pages.home.authoring.blockCount", { count: artifact.itemCount });
    return (
      artifact.artifactType === "canvas"
        ? singular
          ? copy.objectCountOne
          : copy.objectCount
        : singular
          ? copy.ideaCountOne
          : copy.ideaCount
    ).replace("{count}", new Intl.NumberFormat(locale).format(artifact.itemCount));
  }
  function workAction(artifact: HomeWork) {
    const action = homeWorkAction(artifact, canEdit);
    const label =
      action.label === "hostRound"
        ? t("pages.home.authoring.hostRound")
        : action.label === "hostPresentation"
          ? t("pages.home.authoring.hostPresentation")
          : action.label === "continueEditing"
            ? t("pages.home.authoring.continueEditing")
            : copy[action.label];
    return { ...action, label };
  }
  function compactWork(items: HomeWork[]) {
    return (
      <div className={styles.activityList}>
        {items.slice(0, 3).map((artifact) => (
          <Link
            className={styles.activityItem}
            href={homeWorkAction(artifact, canEdit).href}
            key={`${artifact.artifactType}:${artifact.id}`}
          >
            <div className={styles.activityTopline}>
              <span>{workType(artifact)}</span>
              <span className={styles.statusPill} data-status={artifact.status}>
                {workStatus(artifact)}
              </span>
            </div>
            <strong lang="">{artifact.title}</strong>
            {workCount(artifact) || artifact.updatedAt ? (
              <small>
                {workCount(artifact)}
                {workCount(artifact) && artifact.updatedAt ? " · " : null}
                {artifact.updatedAt ? (
                  <time dateTime={artifact.updatedAt} lang={locale}>
                    {t("pages.common.updated", { date: formatDate(artifact.updatedAt) })}
                  </time>
                ) : null}
              </small>
            ) : null}
          </Link>
        ))}
      </div>
    );
  }

  return (
    <WorkspaceShell
      actions={
        canCreate ? (
          <Link className="button" href={createHref} lang={locale}>
            {t("common.create")}
          </Link>
        ) : null
      }
      description={t("home.welcome", { name: firstName })}
      eyebrow={t("home.eyebrow")}
      title={t("home.title")}
      translationLevel="full"
    >
      {activeSessions.length ? (
        <section className={styles.activeSessions} aria-label={t("pages.common.liveNow")}>
          <div className={styles.sectionHeading}>
            <h2>{t("pages.common.liveNow")}</h2>
          </div>
          {activeSessions.map((session) => (
            <div className={styles.activeSession} key={`${session.artifactType}:${session.id}`}>
              <div>
                <h3 lang="">{session.title}</h3>
                <p>
                  {t("pages.common.participantCount", { count: session.participantCount })} ·{" "}
                  {localizedProgress(session.progressLabel, t)}
                </p>
              </div>
              <Link className="button" href={session.href}>
                {t(
                  session.artifactType === "round"
                    ? "pages.common.openSessions"
                    : "pages.sessions.resumePresentation",
                )}
              </Link>
            </div>
          ))}
        </section>
      ) : null}

      {error ? (
        <section className={styles.errorState} role="alert">
          <div>
            <strong>{t("pages.home.refreshError")}</strong>
            <p lang="en-CA">{error}</p>
          </div>
          <button className="button-quiet" onClick={() => void loadSummary()} type="button">
            {t("pages.common.tryAgain")}
          </button>
        </section>
      ) : null}

      {loading && !summary ? (
        <section aria-label={t("pages.home.loading")} className={styles.loadingGrid}>
          <span />
          <span />
          <span />
        </section>
      ) : null}

      {summary && canCreate && creator ? (
        <HomeGuidance
          summary={summary}
          contextKey={`${creator.userId}:${creator.workspaceId}`}
          guideAvailable={professionalRoundBuilderAvailable(productFeatures)}
        />
      ) : null}

      {summary ? (
        <div className={styles.dashboardGrid}>
          <div className={styles.mainColumn}>
            <section className={styles.section}>
              <div className={styles.sectionHeading}>
                <div>
                  <p className={styles.eyebrow}>{t("pages.home.authoring.eyebrow")}</p>
                  <h2>{t("pages.home.authoring.title")}</h2>
                  <p>{copy.recentDescription}</p>
                </div>
                <Link href="/library">{t("pages.common.viewLibrary")}</Link>
              </div>
              {recentWork.length ? (
                <div className={styles.artifactGrid} data-layout="compact">
                  {recentWork.map((artifact) => (
                    <article
                      className={styles.artifactCard}
                      key={`${artifact.artifactType}:${artifact.id}`}
                    >
                      <div className={styles.cardTopline}>
                        <span
                          className={styles.typePill}
                          data-type={artifact.artifactType}
                          lang={locale}
                        >
                          {workType(artifact)}
                        </span>
                        <span className={styles.statusPill} data-status={artifact.status}>
                          {workStatus(artifact)}
                        </span>
                      </div>
                      <h3 lang="">
                        <Link href={artifact.editHref}>{artifact.title}</Link>
                      </h3>
                      <p className={styles.description}>
                        {artifact.description ? (
                          <span lang="">{artifact.description}</span>
                        ) : (
                          t("pages.common.noDescription")
                        )}
                      </p>
                      {workCount(artifact) || artifact.updatedAt ? (
                        <p className={styles.metadata}>
                          {workCount(artifact)}
                          {workCount(artifact) && artifact.updatedAt ? " · " : null}
                          {artifact.updatedAt ? (
                            <time dateTime={artifact.updatedAt} lang={locale}>
                              {t("pages.common.updated", { date: formatDate(artifact.updatedAt) })}
                            </time>
                          ) : null}
                        </p>
                      ) : null}
                      <Link className={styles.cardAction} href={workAction(artifact).href}>
                        {workAction(artifact).label} →
                      </Link>
                    </article>
                  ))}
                </div>
              ) : (
                <div className={styles.compactEmpty}>
                  <p>{copy.emptyWork}</p>
                  {canCreate ? (
                    <Link href={createHref}>{t("pages.home.authoring.chooseMethod")}</Link>
                  ) : null}
                </div>
              )}
            </section>

            <section className={styles.section}>
              <div className={styles.sectionHeading}>
                <div>
                  <p className={styles.eyebrow}>{t("pages.home.results.eyebrow")}</p>
                  <h2>{t("pages.home.results.title")}</h2>
                  <p>{t("pages.home.results.description")}</p>
                </div>
                <Link href="/results">{t("pages.common.viewResults")}</Link>
              </div>
              {summary.resultHighlights.length ? (
                <div className={styles.resultList}>
                  {summary.resultHighlights.map((result) => (
                    <Link
                      className={styles.resultRow}
                      href={result.href}
                      key={`${result.artifactType}:${result.id}`}
                    >
                      <div>
                        <span
                          className={styles.typePill}
                          data-type={result.artifactType}
                          lang={locale}
                        >
                          {t(
                            result.artifactType === "round"
                              ? "common.round"
                              : "common.presentation",
                          )}
                        </span>
                        <h3 lang="">{result.title}</h3>
                        <p>
                          <time dateTime={result.createdAt} lang={locale}>
                            {formatDate(result.createdAt)}
                          </time>{" "}
                          ·{" "}
                          {t("pages.common.participantCount", {
                            count: result.participantCount,
                          })}
                        </p>
                      </div>
                      <div className={styles.resultMetrics}>
                        <span>
                          <strong>
                            {result.accuracyPercent === null ? "—" : `${result.accuracyPercent}%`}
                          </strong>
                          {t(
                            result.artifactType === "round"
                              ? "pages.common.initialAccuracy"
                              : "pages.common.accuracy",
                          )}
                        </span>
                        <span>
                          <strong>
                            {result.recoveryPercent === null ? "—" : `${result.recoveryPercent}%`}
                          </strong>
                          {t("pages.common.recovery")}
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className={styles.compactEmpty}>
                  <p>{t("pages.home.results.empty")}</p>
                  <Link href="/sessions">{t("pages.common.openSessions")}</Link>
                </div>
              )}
            </section>
          </div>

          <aside className={styles.sideColumn} aria-label={t("pages.home.currentActivity")}>
            <section className={styles.sidePanel}>
              <div className={styles.sideHeading}>
                <div>
                  <p className={styles.eyebrow}>{t("pages.home.sessions.eyebrow")}</p>
                  <h2>{t("pages.common.sessions")}</h2>
                </div>
                <Link href="/sessions">{t("pages.common.all")}</Link>
              </div>
              {summary.sessions.length ? (
                <div className={styles.activityList}>
                  {summary.sessions.slice(0, 4).map((session) => (
                    <Link
                      className={styles.activityItem}
                      href={session.href}
                      key={`${session.artifactType}:${session.id}`}
                    >
                      <div className={styles.activityTopline}>
                        <span
                          className={styles.liveDot}
                          data-active={session.status === "active"}
                        />
                        <span>
                          {session.status === "active" ? (
                            t("pages.common.liveNow")
                          ) : (
                            <time dateTime={session.createdAt} lang={locale}>
                              {formatDate(session.createdAt)}
                            </time>
                          )}
                        </span>
                        <span lang={locale}>
                          {t(
                            session.artifactType === "round"
                              ? "common.round"
                              : "common.presentation",
                          )}
                        </span>
                      </div>
                      <strong lang="">{session.title}</strong>
                      <small>
                        {t("pages.common.participantCount", {
                          count: session.participantCount,
                        })}{" "}
                        · {localizedProgress(session.progressLabel, t)}
                      </small>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className={styles.compactEmpty}>
                  <p>{t("pages.home.sessions.empty")}</p>
                  <Link href="/library">{t("pages.home.sessions.chooseArtifact")}</Link>
                </div>
              )}
              {activeSessions.length ? (
                <p className={styles.notice}>
                  {t("pages.home.sessions.activeCount", { count: activeSessions.length })}
                </p>
              ) : null}
            </section>

            {productFeatures?.ideaBoards ||
            productFeatures?.canvasBoards ||
            summary.recentBoards?.length ? (
              <section className={styles.sidePanel} aria-labelledby="home-boards-title">
                <div className={styles.sideHeading}>
                  <h2 id="home-boards-title">
                    {t("workspace.nav.boards")}{" "}
                    <span className={styles.sectionCount}>
                      {new Intl.NumberFormat(locale).format(
                        summary.totals.boards ?? summary.recentBoards?.length ?? 0,
                      )}
                    </span>
                  </h2>
                  <Link href="/boards">{t("pages.common.all")}</Link>
                </div>
                {compactWork(summary.recentBoards ?? [])}
              </section>
            ) : null}
            {productFeatures?.surveys || summary.recentSurveys?.length ? (
              <section className={styles.sidePanel} aria-labelledby="home-surveys-title">
                <div className={styles.sideHeading}>
                  <h2 id="home-surveys-title">
                    {t("pages.common.surveys")}{" "}
                    <span className={styles.sectionCount}>
                      {new Intl.NumberFormat(locale).format(
                        summary.totals.surveys ?? summary.recentSurveys?.length ?? 0,
                      )}
                    </span>
                  </h2>
                  <Link href="/library?type=surveys">{t("pages.common.all")}</Link>
                </div>
                {compactWork(summary.recentSurveys ?? [])}
              </section>
            ) : null}
            <section className={styles.sidePanel}>
              <div className={styles.sideHeading}>
                <div>
                  <p className={styles.eyebrow}>{t("pages.home.assignments.eyebrow")}</p>
                  <h2>{t("pages.common.assignments")}</h2>
                </div>
                <Link href="/assignments">{t("pages.common.all")}</Link>
              </div>
              {summary.assignments.length ? (
                <div className={styles.activityList}>
                  {summary.assignments.slice(0, 3).map((assignment) => (
                    <Link
                      className={styles.activityItem}
                      href={assignment.href}
                      key={assignment.id}
                    >
                      <div className={styles.activityTopline}>
                        <span className={styles.statusPill} data-status={assignment.status}>
                          {t(`pages.common.status.${assignment.status}`)}
                        </span>
                        <time dateTime={assignment.closesAt} lang={locale}>
                          {t("pages.common.closes", { date: formatDate(assignment.closesAt) })}
                        </time>
                      </div>
                      <strong lang="">{assignment.title}</strong>
                      <small>
                        {t("pages.home.assignments.attemptsComplete", {
                          completed: assignment.completedAttemptCount,
                          total: assignment.attemptCount,
                        })}
                      </small>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className={styles.compactEmpty}>
                  <p>{t("pages.home.assignments.empty")}</p>
                  <Link href="/library">{t("pages.home.assignments.assignRound")}</Link>
                </div>
              )}
            </section>

            {productFeatures?.groups ? (
              <section className={styles.sidePanel}>
                <div className={styles.sideHeading}>
                  <div>
                    <p className={styles.eyebrow}>{t("pages.common.groups")}</p>
                    <h2>{t("pages.common.upcoming")}</h2>
                  </div>
                  <Link href="/groups">{t("pages.common.all")}</Link>
                </div>
                {summary.groupSchedule.length ? (
                  <div className={styles.activityList}>
                    {summary.groupSchedule.map((item) => (
                      <Link className={styles.scheduleItem} href={item.href} key={item.id}>
                        <time dateTime={item.scheduledFor} lang={locale}>
                          <strong>
                            {new Date(item.scheduledFor).toLocaleDateString(locale, {
                              day: "numeric",
                            })}
                          </strong>
                          <span>
                            {new Date(item.scheduledFor).toLocaleDateString(locale, {
                              month: "short",
                            })}
                          </span>
                        </time>
                        <div>
                          <strong lang="">{item.artifactTitle}</strong>
                          <small>
                            <span lang="">{item.groupName}</span> ·{" "}
                            {t(
                              item.kind === "live_session"
                                ? "pages.common.liveSession"
                                : "pages.common.roundAssignment",
                            )}
                          </small>
                        </div>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div className={styles.compactEmpty}>
                    <p>{t("pages.home.groups.empty")}</p>
                    <Link href="/groups">{t("pages.common.openGroups")}</Link>
                  </div>
                )}
              </section>
            ) : null}
          </aside>
        </div>
      ) : null}
    </WorkspaceShell>
  );
}

export default function HomePage() {
  return (
    <WorkspaceProvider>
      <HomeWorkspace />
    </WorkspaceProvider>
  );
}
