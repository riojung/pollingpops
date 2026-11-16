"use client";
import Link from "next/link";
import type { FormEvent } from "react";
import { useLocale } from "../../components/locale-provider";
import { canvasSharingMessages } from "../../lib/i18n/canvas-sharing-messages";
import { groupsMessages } from "../../lib/i18n/groups-messages";
import {
  artifactKey,
  readArtifactKey,
  formatDateTime,
  type ArtifactType,
  type GroupDetail,
  type GroupArtifact,
  type LibraryArtifact,
} from "./groups-model";
import styles from "./groups.module.css";

interface SharedArtifactsProps {
  busy: string;
  canEdit: boolean;
  detail: GroupDetail;
  onRemove: (artifact: GroupArtifact) => Promise<void>;
  onShare: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  setShareKey: (value: string) => void;
  shareCandidates: Array<LibraryArtifact & { artifactType: ArtifactType }>;
  shareKey: string;
  moreIdeaBoards?: () => Promise<void>;
  ideaBoardLoading?: boolean;
}

export function SharedArtifacts({
  busy,
  canEdit,
  detail,
  onRemove,
  onShare,
  setShareKey,
  shareCandidates,
  shareKey,
  moreIdeaBoards,
  ideaBoardLoading,
}: SharedArtifactsProps) {
  const { t, locale } = useLocale();
  const copy = canvasSharingMessages(locale);
  const groupCopy = groupsMessages(locale);
  return (
    <section className={styles.panel}>
      <SectionHeading
        count={detail.artifacts.length}
        eyebrow={t("pages.groups.artifacts.eyebrow")}
        title={groupCopy.content}
      />
      {canEdit ? (
        <details className={styles.actionDisclosure}>
          <summary>
            {t("pages.groups.share")} · {groupCopy.content}
          </summary>
          <form className={styles.compactForm} onSubmit={onShare}>
            <label className={styles.field}>
              <span>{groupCopy.content}</span>
              <select onChange={(event) => setShareKey(event.target.value)} value={shareKey}>
                <option value="">{t("pages.groups.artifacts.choose")}</option>
                {shareCandidates.map((artifact) => (
                  <option
                    key={artifactKey(artifact.artifactType, artifact.id)}
                    lang=""
                    value={artifactKey(artifact.artifactType, artifact.id)}
                  >
                    {artifact.artifactType === "idea_board"
                      ? copy.ideaBoard
                      : t(
                          artifact.artifactType === "round"
                            ? "pages.common.round"
                            : "pages.common.presentation",
                        )}{" "}
                    · {artifact.title}
                    {artifact.artifactType === "idea_board" || artifact.currentVersionId
                      ? ""
                      : ` (${t("pages.common.status.draft")})`}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="button small-button"
              disabled={Boolean(busy) || !shareKey}
              type="submit"
            >
              {busy === "/artifacts"
                ? t("pages.groups.artifacts.sharing")
                : t("pages.groups.share")}
            </button>
          </form>
        </details>
      ) : null}
      {canEdit && moreIdeaBoards ? (
        <button
          type="button"
          className="button-quiet small-button"
          disabled={ideaBoardLoading}
          onClick={() => void moreIdeaBoards()}
        >
          {t("boards.more")}
        </button>
      ) : null}
      {detail.artifacts.length ? (
        <div className={styles.artifactGrid}>
          {detail.artifacts.map((artifact) => (
            <article className={styles.artifactCard} key={artifact.id}>
              <div
                className={styles.artifactType}
                data-type={artifact.artifactType}
                aria-hidden="true"
              >
                {artifact.artifactType === "round"
                  ? "R"
                  : artifact.artifactType === "presentation"
                    ? "P"
                    : "B"}
              </div>
              <div className={styles.artifactCopy}>
                <div className={styles.inlineMeta}>
                  <span>
                    {artifact.artifactType === "idea_board"
                      ? copy.ideaBoard
                      : t(
                          artifact.artifactType === "round"
                            ? "pages.common.round"
                            : "pages.common.presentation",
                        )}
                  </span>
                  <span className={styles.statusBadge} data-status={artifact.status}>
                    {artifact.artifactType === "idea_board"
                      ? t(
                          `boards.${artifact.status as "draft" | "collecting" | "voting" | "closed"}`,
                        )
                      : t(
                          `pages.common.status.${artifact.status as "draft" | "published" | "archived"}`,
                        )}
                  </span>
                </div>
                <h3 lang="">{artifact.title}</h3>
                <div className={styles.cardActions}>
                  <Link className="button-quiet small-button" href={artifact.editHref}>
                    {canEdit ? t("pages.library.edit") : t("pages.library.view")}
                  </Link>
                  {canEdit && artifact.artifactType !== "idea_board" && artifact.published ? (
                    <Link className="button small-button" href={artifact.hostHref}>
                      {t("pages.library.host")}
                    </Link>
                  ) : null}
                  {canEdit &&
                  artifact.artifactType !== "idea_board" &&
                  artifact.published &&
                  artifact.assignHref ? (
                    <Link className="button-quiet small-button" href={artifact.assignHref}>
                      {t("pages.library.assign")}
                    </Link>
                  ) : null}
                  {canEdit ? (
                    <button
                      className={styles.removeButton}
                      disabled={Boolean(busy)}
                      onClick={() => void onRemove(artifact)}
                      type="button"
                    >
                      {t("pages.groups.remove")}
                    </button>
                  ) : null}
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <PanelEmpty strong={groupCopy.noContent} text={groupCopy.workspaceContentHelp} />
      )}
    </section>
  );
}

export function GroupCanvasBoards({
  boards,
}: {
  boards: NonNullable<GroupDetail["canvasBoards"]>;
}) {
  const { locale, t } = useLocale();
  const copy = canvasSharingMessages(locale);
  return (
    <section className={styles.panel} aria-label={copy.canvasBoards}>
      <SectionHeading
        count={boards.length}
        eyebrow={t("pages.groups.facilitatorGroup")}
        title={copy.canvasBoards}
      />
      <div className={styles.canvasBoardGrid}>
        {boards.map((board) => (
          <article key={board.id} className={styles.canvasBoardCard}>
            <p className={styles.inlineMeta}>
              <span>{t(board.boardType === "team" ? "canvas.team" : "canvas.workshop")}</span>
              <span>{t(board.role === "owner" ? "role.owner" : `canvas.${board.role}`)}</span>
            </p>
            <h3 lang="">{board.title}</h3>
            <p className={styles.helpText}>
              {t("canvas.retention", { date: formatDateTime(locale, board.expiresAt) })}
            </p>
            <Link className="button-quiet small-button" href={`/canvas/${board.id}`}>
              {copy.openBoard}
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}

export function DiscussionPanel({
  busy,
  detail,
  messageBody,
  onPost,
  setMessageBody,
  canPost,
}: {
  busy: string;
  detail: GroupDetail;
  messageBody: string;
  canPost: boolean;
  onPost: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  setMessageBody: (value: string) => void;
}) {
  const { locale, t } = useLocale();
  return (
    <section className={styles.panel}>
      <SectionHeading
        count={detail.messages.length}
        eyebrow={t("pages.groups.discussion.eyebrow")}
        title={t("pages.groups.discussion.title")}
      />
      {canPost ? (
        <form className={styles.messageForm} onSubmit={onPost}>
          <label className={styles.field}>
            <span>{t("pages.groups.discussion.postLabel")}</span>
            <textarea
              lang={messageBody ? "" : locale}
              maxLength={2000}
              onChange={(event) => setMessageBody(event.target.value)}
              placeholder={t("pages.groups.discussion.placeholder")}
              rows={3}
              value={messageBody}
            />
          </label>
          <button
            className="button small-button"
            disabled={Boolean(busy) || !messageBody.trim()}
            type="submit"
          >
            {busy === "/messages"
              ? t("pages.groups.discussion.posting")
              : t("pages.groups.discussion.post")}
          </button>
        </form>
      ) : null}
      {detail.messages.length ? (
        <ol className={styles.messageList}>
          {detail.messages.map((message) => (
            <li key={message.id}>
              <div>
                <strong>{message.authorEmail}</strong>
                <time dateTime={message.createdAt} lang={locale}>
                  {formatDateTime(locale, message.createdAt)}
                </time>
              </div>
              <p lang="">{message.body}</p>
            </li>
          ))}
        </ol>
      ) : (
        <p className={styles.helpText}>{t("pages.groups.discussion.empty")}</p>
      )}
    </section>
  );
}

interface SchedulePanelProps {
  busy: string;
  canEdit: boolean;
  detail: GroupDetail;
  onSchedule: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  scheduledArtifact: GroupArtifact | undefined;
  scheduledFor: string;
  scheduleKey: string;
  scheduleKind: "live_session" | "round_assignment";
  scheduleNote: string;
  setScheduledFor: (value: string) => void;
  setScheduleKey: (value: string) => void;
  setScheduleKind: (value: "live_session" | "round_assignment") => void;
  setScheduleNote: (value: string) => void;
}

export function SchedulePanel({
  busy,
  canEdit,
  detail,
  onSchedule,
  scheduledArtifact,
  scheduledFor,
  scheduleKey,
  scheduleKind,
  scheduleNote,
  setScheduledFor,
  setScheduleKey,
  setScheduleKind,
  setScheduleNote,
}: SchedulePanelProps) {
  const { locale, t } = useLocale();
  return (
    <section className={styles.panel}>
      <SectionHeading
        count={detail.schedule.length}
        eyebrow={t("pages.groups.schedule.eyebrow")}
        title={t("pages.groups.schedule.title")}
      />
      {canEdit ? (
        detail.artifacts.some(
          (artifact) => artifact.artifactType !== "idea_board" && artifact.published,
        ) ? (
          <form className={styles.scheduleForm} onSubmit={onSchedule}>
            <label className={styles.field}>
              <span>{t("pages.groups.schedule.publishedArtifact")}</span>
              <select
                onChange={(event) => {
                  const next = event.target.value;
                  setScheduleKey(next);
                  if (readArtifactKey(next)?.artifactType === "presentation") {
                    setScheduleKind("live_session");
                  }
                }}
                value={scheduleKey}
              >
                <option value="">{t("pages.groups.schedule.chooseArtifact")}</option>
                {detail.artifacts
                  .filter(
                    (artifact) => artifact.artifactType !== "idea_board" && artifact.published,
                  )
                  .map((artifact) => (
                    <option
                      key={artifactKey(artifact.artifactType, artifact.artifactId)}
                      lang=""
                      value={artifactKey(artifact.artifactType, artifact.artifactId)}
                    >
                      {t(
                        artifact.artifactType === "round"
                          ? "pages.common.round"
                          : "pages.common.presentation",
                      )}{" "}
                      · {artifact.title}
                    </option>
                  ))}
              </select>
            </label>
            <label className={styles.field}>
              <span>{t("pages.groups.schedule.activity")}</span>
              <select
                disabled={scheduledArtifact?.artifactType === "presentation"}
                onChange={(event) =>
                  setScheduleKind(event.target.value as "live_session" | "round_assignment")
                }
                value={
                  scheduledArtifact?.artifactType === "presentation" ? "live_session" : scheduleKind
                }
              >
                <option value="live_session">{t("pages.common.liveSession")}</option>
                {scheduledArtifact?.artifactType !== "presentation" ? (
                  <option value="round_assignment">{t("pages.common.roundAssignment")}</option>
                ) : null}
              </select>
            </label>
            <label className={styles.field}>
              <span>{t("pages.groups.schedule.dateTime")}</span>
              <input
                lang={scheduleNote ? "" : locale}
                onChange={(event) => setScheduledFor(event.target.value)}
                required
                type="datetime-local"
                value={scheduledFor}
              />
            </label>
            <label className={styles.field}>
              <span>{t("pages.groups.schedule.note")}</span>
              <input
                maxLength={500}
                onChange={(event) => setScheduleNote(event.target.value)}
                placeholder={t("pages.groups.schedule.notePlaceholder")}
                value={scheduleNote}
              />
            </label>
            <button
              className="button small-button"
              disabled={Boolean(busy) || !scheduleKey || !scheduledFor}
              type="submit"
            >
              {busy === "/schedule"
                ? t("pages.groups.schedule.scheduling")
                : t("pages.groups.schedule.add")}
            </button>
          </form>
        ) : (
          <p className={styles.helpText}>{t("pages.groups.schedule.publishFirst")}</p>
        )
      ) : null}
      {detail.schedule.length ? (
        <div className={styles.scheduleList}>
          {detail.schedule.map((item) => {
            const artifact = detail.artifacts.find(
              (candidate) =>
                candidate.artifactType === item.artifactType &&
                candidate.artifactId === item.artifactId,
            );
            const actionHref =
              item.kind === "round_assignment" ? artifact?.assignHref : artifact?.hostHref;
            return (
              <article className={styles.scheduleCard} key={item.id}>
                <time dateTime={item.scheduledFor}>
                  <strong>{formatDateTime(locale, item.scheduledFor)}</strong>
                  <span>
                    {new Date(item.scheduledFor) < new Date()
                      ? t("pages.groups.schedule.past")
                      : t("pages.common.upcoming")}
                  </span>
                </time>
                <div>
                  <p className={styles.inlineMeta}>
                    <span>
                      {item.kind === "live_session"
                        ? t("pages.common.liveSession")
                        : t("pages.results.assignment")}
                    </span>
                    <span>
                      {t(
                        item.artifactType === "round"
                          ? "pages.common.round"
                          : "pages.common.presentation",
                      )}
                    </span>
                  </p>
                  <h3 lang="">{item.artifactTitle}</h3>
                  {item.note ? <p lang="">{item.note}</p> : null}
                </div>
                {actionHref && canEdit ? (
                  <Link className="button-quiet small-button" href={actionHref}>
                    {item.kind === "live_session"
                      ? t("pages.groups.schedule.openHost")
                      : t("pages.groups.schedule.openAssignment")}
                  </Link>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : (
        <PanelEmpty
          strong={t("pages.groups.schedule.emptyTitle")}
          text={t("pages.groups.schedule.emptyDescription")}
        />
      )}
    </section>
  );
}

export function SectionHeading({
  count,
  eyebrow,
  title,
}: {
  count: number;
  eyebrow: string;
  title: string;
}) {
  return (
    <div className={styles.sectionHeading}>
      <div>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h2>{title}</h2>
      </div>
      <span className={styles.sectionCount}>{count}</span>
    </div>
  );
}

export function PanelEmpty({ strong, text }: { strong: string; text: string }) {
  return (
    <div className={styles.panelEmpty}>
      <strong>{strong}</strong>
      <span>{text}</span>
    </div>
  );
}
