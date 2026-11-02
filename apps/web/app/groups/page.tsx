"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useLocale } from "../../components/locale-provider";
import { apiFetch, humanError } from "../../lib/api";
import { WorkspaceProvider, useWorkspace } from "../../components/workspace/workspace-provider";
import { WorkspaceShell } from "../../components/workspace/workspace-shell";
import { listIdeaBoards } from "../../lib/idea-board-client";
import { canvasSharingMessages } from "../../lib/i18n/canvas-sharing-messages";
import styles from "./groups.module.css";

type ArtifactType = "round" | "presentation" | "idea_board";

interface GroupSummary {
  id: string;
  name: string;
  description: string;
  role: "owner" | "member";
  memberCount: number;
  artifactCount: number;
  upcomingCount: number;
  createdAt: string;
  updatedAt: string;
}

interface GroupMember {
  userId: string;
  email: string;
  role: "owner" | "member";
  workspaceRole: "owner" | "editor" | "viewer" | null;
  joinedAt: string;
}

interface AvailableMember {
  userId: string;
  email: string;
  role: "owner" | "editor" | "viewer";
  joinedAt: string | null;
}

interface GroupArtifact {
  id: string;
  artifactType: ArtifactType;
  artifactId: string;
  title: string;
  status: "draft" | "published" | "archived" | "collecting" | "voting" | "closed";
  published: boolean;
  editHref: string;
  hostHref: string;
  assignHref: string | null;
  createdAt: string;
}

interface GroupMessage {
  id: string;
  authorId: string;
  authorEmail: string;
  body: string;
  createdAt: string;
}

interface GroupScheduleItem {
  id: string;
  artifactType: ArtifactType;
  artifactId: string;
  artifactTitle: string;
  kind: "live_session" | "round_assignment";
  scheduledFor: string;
  note: string;
  createdAt: string;
}

interface GroupDetail extends GroupSummary {
  members: GroupMember[];
  availableMembers: AvailableMember[];
  artifacts: GroupArtifact[];
  messages: GroupMessage[];
  schedule: GroupScheduleItem[];
  canvasBoards?: Array<{
    id: string;
    title: string;
    boardType: "team" | "workshop";
    status: "active" | "archived" | "frozen" | "closed";
    role: "owner" | "editor" | "viewer" | "facilitator";
    workspaceId: string;
    expiresAt: string;
  }>;
}

interface LibraryArtifact {
  id: string;
  title: string;
  status: "draft" | "published" | "archived";
  currentVersionId: string | null;
}

function formatDateTime(locale: string, value: string) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function artifactKey(type: ArtifactType, id: string) {
  return `${type}:${id}`;
}

function readArtifactKey(value: string): { artifactType: ArtifactType; artifactId: string } | null {
  const divider = value.indexOf(":");
  if (divider < 0) return null;
  const artifactType = value.slice(0, divider);
  const artifactId = value.slice(divider + 1);
  if (!["round", "presentation", "idea_board"].includes(artifactType) || !artifactId) return null;
  return { artifactType: artifactType as ArtifactType, artifactId };
}

function GroupsContent() {
  const { locale, t } = useLocale();
  const { canEdit, creator, productFeatures } = useWorkspace();
  const presentationsEnabled = productFeatures?.presentations === true;
  const ideaBoardsEnabled = productFeatures?.ideaBoards === true;
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<GroupDetail | null>(null);
  const [rounds, setRounds] = useState<LibraryArtifact[]>([]);
  const [presentations, setPresentations] = useState<LibraryArtifact[]>([]);
  const [ideaBoards, setIdeaBoards] = useState<LibraryArtifact[]>([]);
  const [ideaBoardCursor, setIdeaBoardCursor] = useState<string | null>(null);
  const [ideaBoardLoading, setIdeaBoardLoading] = useState(false);
  const moreController = useRef<AbortController | null>(null);
  useEffect(() => () => moreController.current?.abort(), []);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupDescription, setGroupDescription] = useState("");
  const [memberId, setMemberId] = useState("");
  const [shareKey, setShareKey] = useState("");
  const [messageBody, setMessageBody] = useState("");
  const [scheduleKey, setScheduleKey] = useState("");
  const [scheduleKind, setScheduleKind] = useState<"live_session" | "round_assignment">(
    "live_session",
  );
  const [scheduledFor, setScheduledFor] = useState("");
  const [scheduleNote, setScheduleNote] = useState("");

  const refreshGroups = useCallback(async () => {
    const response = await apiFetch<{ groups: GroupSummary[] }>("/v1/groups");
    setGroups(response.groups);
    setSelectedId((current) =>
      response.groups.some((group) => group.id === current)
        ? current
        : (response.groups[0]?.id ?? ""),
    );
  }, []);

  const normalizeDetail = useCallback(
    (group: GroupDetail): GroupDetail =>
      presentationsEnabled
        ? group
        : {
            ...group,
            artifacts: group.artifacts.filter(
              (artifact) => artifact.artifactType !== "presentation",
            ),
            schedule: group.schedule.filter((item) => item.artifactType === "round"),
          },
    [presentationsEnabled],
  );

  const refreshDetail = useCallback(
    async (groupId: string) => {
      const response = await apiFetch<{ group: GroupDetail }>(`/v1/groups/${groupId}`);
      setDetail(normalizeDetail(response.group));
    },
    [normalizeDetail],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const requests: Array<Promise<unknown>> = [
      apiFetch<{ groups: GroupSummary[] }>("/v1/groups", { signal: controller.signal }).then(
        (response) => {
          setGroups(response.groups);
          setSelectedId(response.groups[0]?.id ?? "");
        },
      ),
    ];
    if (canEdit) {
      requests.push(
        Promise.all([
          apiFetch<{ quizzes: LibraryArtifact[] }>("/v1/quizzes?archived=true&summary=true", {
            signal: controller.signal,
          }),
          presentationsEnabled
            ? apiFetch<{ presentations: LibraryArtifact[] }>("/v1/presentations", {
                signal: controller.signal,
              })
            : Promise.resolve({ presentations: [] }),
        ]).then(([roundResponse, presentationResponse]) => {
          setRounds(roundResponse.quizzes.filter((round) => round.status !== "archived"));
          setPresentations(
            presentationResponse.presentations.filter(
              (presentation) => presentation.status !== "archived",
            ),
          );
        }),
      );
      if (ideaBoardsEnabled)
        requests.push(
          listIdeaBoards("", controller.signal).then((result) => {
            setIdeaBoards(
              result.boards.map((board) => ({
                id: board.id,
                title: board.title,
                status: "draft" as const,
                currentVersionId: null,
              })),
            );
            setIdeaBoardCursor(result.nextCursor);
          }),
        );
    }
    void Promise.all(requests)
      .catch((caught) => {
        if (!controller.signal.aborted) setError(humanError(caught));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [canEdit, presentationsEnabled, ideaBoardsEnabled]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    const controller = new AbortController();
    setDetailLoading(true);
    setError("");
    void apiFetch<{ group: GroupDetail }>(`/v1/groups/${selectedId}`, {
      signal: controller.signal,
    })
      .then((response) => {
        if (!controller.signal.aborted) setDetail(normalizeDetail(response.group));
      })
      .catch((caught) => {
        if (!controller.signal.aborted) setError(humanError(caught));
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false);
      });
    return () => controller.abort();
  }, [normalizeDetail, selectedId]);

  const visibleGroups = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase(locale);
    return groups.filter(
      (group) =>
        !normalized ||
        group.name.toLocaleLowerCase(locale).includes(normalized) ||
        group.description.toLocaleLowerCase(locale).includes(normalized),
    );
  }, [groups, locale, search]);

  const shareCandidates = useMemo(() => {
    const shared = new Set(
      (detail?.artifacts ?? []).map((artifact) =>
        artifactKey(artifact.artifactType, artifact.artifactId),
      ),
    );
    return [
      ...rounds.map((artifact) => ({ ...artifact, artifactType: "round" as const })),
      ...presentations.map((artifact) => ({
        ...artifact,
        artifactType: "presentation" as const,
      })),
      ...(ideaBoardsEnabled
        ? ideaBoards.map((artifact) => ({ ...artifact, artifactType: "idea_board" as const }))
        : []),
    ].filter((artifact) => !shared.has(artifactKey(artifact.artifactType, artifact.id)));
  }, [detail?.artifacts, presentations, rounds, ideaBoards, ideaBoardsEnabled]);

  const scheduledArtifact = detail?.artifacts.find(
    (artifact) => artifactKey(artifact.artifactType, artifact.artifactId) === scheduleKey,
  );
  const canManageMembers = detail?.role === "owner" || creator?.role === "owner";

  async function runMutation(label: string, mutation: () => Promise<void>) {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await mutation();
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusy("");
    }
  }

  async function createGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = groupName.trim();
    if (!name) return;
    await runMutation("create", async () => {
      const response = await apiFetch<{ group: GroupSummary }>("/v1/groups", {
        method: "POST",
        body: JSON.stringify({ name, description: groupDescription.trim() }),
      });
      setGroupName("");
      setGroupDescription("");
      setShowCreate(false);
      await refreshGroups();
      setSelectedId(response.group.id);
      setNotice(t("pages.groups.notice.created", { name: response.group.name }));
    });
  }

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || !memberId) return;
    await runMutation("member", async () => {
      await apiFetch(`/v1/groups/${detail.id}/members`, {
        method: "POST",
        body: JSON.stringify({ userId: memberId }),
      });
      setMemberId("");
      await Promise.all([refreshDetail(detail.id), refreshGroups()]);
      setNotice(t("pages.groups.notice.memberAdded"));
    });
  }

  async function shareArtifact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    const artifact = readArtifactKey(shareKey);
    if (!artifact) return;
    await runMutation("share", async () => {
      await apiFetch(`/v1/groups/${detail.id}/artifacts`, {
        method: "POST",
        body: JSON.stringify(artifact),
      });
      setShareKey("");
      await Promise.all([refreshDetail(detail.id), refreshGroups()]);
      setNotice(t("pages.groups.notice.artifactShared"));
    });
  }

  async function moreIdeaBoards() {
    if (!ideaBoardCursor || ideaBoardLoading) return;
    setIdeaBoardLoading(true);
    const active = new AbortController();
    moreController.current = active;
    try {
      const result = await listIdeaBoards("", active.signal, ideaBoardCursor);
      if (active.signal.aborted) return;
      setIdeaBoards((current) => [
        ...new Map(
          [
            ...current,
            ...result.boards.map((board) => ({
              id: board.id,
              title: board.title,
              status: "draft" as const,
              currentVersionId: null,
            })),
          ].map((board) => [board.id, board]),
        ).values(),
      ]);
      setIdeaBoardCursor(result.nextCursor);
    } catch (caught) {
      if (!active.signal.aborted) setError(humanError(caught));
    } finally {
      if (!active.signal.aborted) setIdeaBoardLoading(false);
    }
  }

  async function removeArtifact(artifact: GroupArtifact) {
    if (!detail) return;
    await runMutation(`remove:${artifact.id}`, async () => {
      await apiFetch(`/v1/groups/${detail.id}/artifacts/${artifact.id}`, { method: "DELETE" });
      if (scheduleKey === artifactKey(artifact.artifactType, artifact.artifactId)) {
        setScheduleKey("");
      }
      await Promise.all([refreshDetail(detail.id), refreshGroups()]);
      setNotice(t("pages.groups.notice.artifactRemoved", { title: artifact.title }));
    });
  }

  async function postMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || !messageBody.trim()) return;
    await runMutation("message", async () => {
      await apiFetch(`/v1/groups/${detail.id}/messages`, {
        method: "POST",
        body: JSON.stringify({ body: messageBody.trim() }),
      });
      setMessageBody("");
      await refreshDetail(detail.id);
      setNotice(t("pages.groups.notice.posted"));
    });
  }

  async function scheduleArtifact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || !scheduledFor) return;
    const artifact = readArtifactKey(scheduleKey);
    if (!artifact || artifact.artifactType === "idea_board") return;
    await runMutation("schedule", async () => {
      await apiFetch(`/v1/groups/${detail.id}/schedule`, {
        method: "POST",
        body: JSON.stringify({
          ...artifact,
          kind: artifact.artifactType === "presentation" ? "live_session" : scheduleKind,
          scheduledFor: new Date(scheduledFor).toISOString(),
          note: scheduleNote.trim(),
        }),
      });
      setScheduledFor("");
      setScheduleNote("");
      await Promise.all([refreshDetail(detail.id), refreshGroups()]);
      setNotice(t("pages.groups.notice.scheduled"));
    });
  }

  return (
    <WorkspaceShell
      actions={
        canEdit ? (
          <button
            className="button"
            onClick={() => setShowCreate((current) => !current)}
            type="button"
          >
            {showCreate ? t("pages.common.close") : t("pages.groups.create")}
          </button>
        ) : null
      }
      description={t("page.groups.description")}
      eyebrow={t("page.groups.eyebrow")}
      requiredFeature="groups"
      title={t("page.groups.title")}
      translationLevel="full"
    >
      {error ? (
        <p className="error" lang="en-CA" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      ) : null}

      {showCreate ? (
        <form className={styles.createPanel} onSubmit={createGroup}>
          <div>
            <p className={styles.eyebrow}>{t("pages.groups.createEyebrow")}</p>
            <h2>{t("pages.groups.create")}</h2>
            <p>{t("pages.groups.createDescription")}</p>
          </div>
          <label className={styles.field}>
            <span>{t("pages.groups.name")}</span>
            <input
              autoFocus
              lang={groupName ? "" : locale}
              maxLength={120}
              onChange={(event) => setGroupName(event.target.value)}
              placeholder={t("pages.groups.namePlaceholder")}
              required
              value={groupName}
            />
          </label>
          <label className={styles.field}>
            <span>{t("pages.common.description")}</span>
            <textarea
              lang={groupDescription ? "" : locale}
              maxLength={1000}
              onChange={(event) => setGroupDescription(event.target.value)}
              placeholder={t("pages.groups.descriptionPlaceholder")}
              rows={2}
              value={groupDescription}
            />
          </label>
          <button
            className="button"
            disabled={busy === "create" || !groupName.trim()}
            type="submit"
          >
            {busy === "create" ? t("pages.groups.creating") : t("pages.groups.create")}
          </button>
        </form>
      ) : null}

      <div className={styles.workspaceGrid}>
        <aside className={styles.groupRail} aria-label={t("pages.groups.workspaceGroups")}>
          <label className={styles.searchField}>
            <span className="sr-only">{t("pages.groups.search")}</span>
            <input
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("pages.groups.search")}
              type="search"
              value={search}
            />
          </label>
          {loading ? (
            <div className={styles.railLoading} aria-label={t("pages.groups.loading")} />
          ) : null}
          {!loading && visibleGroups.length ? (
            <div className={styles.groupList}>
              {visibleGroups.map((group) => (
                <button
                  aria-pressed={selectedId === group.id}
                  className={
                    selectedId === group.id ? styles.groupButtonActive : styles.groupButton
                  }
                  key={group.id}
                  onClick={() => setSelectedId(group.id)}
                  type="button"
                >
                  <span className={styles.groupMonogram} aria-hidden="true">
                    {group.name.charAt(0).toUpperCase()}
                  </span>
                  <span className={styles.groupButtonCopy}>
                    <strong lang="">{group.name}</strong>
                    <small>
                      {t("pages.groups.memberCount", { count: group.memberCount })} ·{" "}
                      {t("pages.groups.artifactCount", { count: group.artifactCount })}
                    </small>
                  </span>
                  {group.upcomingCount ? (
                    <span
                      className={styles.count}
                      aria-label={t("pages.groups.upcomingCount", { count: group.upcomingCount })}
                    >
                      {group.upcomingCount}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
          {!loading && groups.length > 0 && visibleGroups.length === 0 ? (
            <p className={styles.railEmpty}>{t("pages.groups.noMatch")}</p>
          ) : null}
          {!loading && groups.length === 0 ? (
            <div className={styles.railEmpty}>
              <strong>{t("pages.groups.emptyRailTitle")}</strong>
              <span>{t("pages.groups.emptyRailDescription")}</span>
            </div>
          ) : null}
        </aside>

        <div className={styles.detailColumn}>
          {detailLoading ? (
            <div className={styles.detailLoading} aria-label={t("pages.groups.loadingOne")} />
          ) : null}
          {!detailLoading && !detail ? (
            <section className={styles.emptyState}>
              <span aria-hidden="true">G</span>
              <h2>
                {groups.length ? t("pages.groups.chooseTitle") : t("pages.groups.firstTitle")}
              </h2>
              <p>
                {groups.length
                  ? t("pages.groups.chooseDescription")
                  : t("pages.groups.firstDescription")}
              </p>
              {canEdit && !groups.length ? (
                <button className="button" onClick={() => setShowCreate(true)} type="button">
                  {t("pages.groups.createFirst")}
                </button>
              ) : null}
            </section>
          ) : null}
          {!detailLoading && detail ? (
            <>
              <GroupOverview detail={detail} />
              <SharedArtifacts
                busy={busy}
                canEdit={canEdit}
                detail={detail}
                onRemove={removeArtifact}
                onShare={shareArtifact}
                setShareKey={setShareKey}
                shareCandidates={shareCandidates}
                shareKey={shareKey}
                moreIdeaBoards={ideaBoardCursor ? moreIdeaBoards : undefined}
                ideaBoardLoading={ideaBoardLoading}
              />
              {detail.canvasBoards?.length ? (
                <GroupCanvasBoards boards={detail.canvasBoards} />
              ) : null}
              <div className={styles.collaborationGrid}>
                <MembersPanel
                  busy={busy}
                  canManageMembers={Boolean(canManageMembers)}
                  detail={detail}
                  memberId={memberId}
                  onAdd={addMember}
                  setMemberId={setMemberId}
                />
                <DiscussionPanel
                  busy={busy}
                  detail={detail}
                  messageBody={messageBody}
                  onPost={postMessage}
                  setMessageBody={setMessageBody}
                />
              </div>
              <SchedulePanel
                busy={busy}
                canEdit={canEdit}
                detail={detail}
                onSchedule={scheduleArtifact}
                scheduledArtifact={scheduledArtifact}
                scheduledFor={scheduledFor}
                scheduleKey={scheduleKey}
                scheduleKind={scheduleKind}
                scheduleNote={scheduleNote}
                setScheduledFor={setScheduledFor}
                setScheduleKey={setScheduleKey}
                setScheduleKind={setScheduleKind}
                setScheduleNote={setScheduleNote}
              />
            </>
          ) : null}
        </div>
      </div>
    </WorkspaceShell>
  );
}

function GroupOverview({ detail }: { detail: GroupDetail }) {
  const { t } = useLocale();
  return (
    <section className={styles.groupHero}>
      <div className={styles.heroHeading}>
        <span className={styles.heroMonogram} aria-hidden="true">
          {detail.name.charAt(0).toUpperCase()}
        </span>
        <div>
          <div className={styles.inlineMeta}>
            <span className={styles.roleBadge}>{t(`pages.groups.role.${detail.role}`)}</span>
            <span>{t("pages.groups.facilitatorGroup")}</span>
          </div>
          <h2 lang="">{detail.name}</h2>
          <p>
            {detail.description ? (
              <span lang="">{detail.description}</span>
            ) : (
              t("pages.groups.defaultDescription")
            )}
          </p>
        </div>
      </div>
      <dl className={styles.stats}>
        <div>
          <dt>{t("pages.groups.members")}</dt>
          <dd>{detail.members.length}</dd>
        </div>
        <div>
          <dt>{t("pages.groups.shared")}</dt>
          <dd>{detail.artifacts.length + (detail.canvasBoards?.length ?? 0)}</dd>
        </div>
        <div>
          <dt>{t("pages.common.upcoming")}</dt>
          <dd>
            {detail.schedule.filter((item) => new Date(item.scheduledFor) >= new Date()).length}
          </dd>
        </div>
      </dl>
    </section>
  );
}

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

function SharedArtifacts({
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
  return (
    <section className={styles.panel}>
      <SectionHeading
        count={detail.artifacts.length}
        eyebrow={t("pages.groups.artifacts.eyebrow")}
        title={t("pages.groups.artifacts.title")}
      />
      {canEdit ? (
        <form className={styles.compactForm} onSubmit={onShare}>
          <label className={styles.field}>
            <span>{t("pages.groups.artifacts.type")}</span>
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
            disabled={busy === "share" || !shareKey}
            type="submit"
          >
            {busy === "share" ? t("pages.groups.artifacts.sharing") : t("pages.groups.share")}
          </button>
        </form>
      ) : null}
      {moreIdeaBoards ? (
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
                      disabled={busy === `remove:${artifact.id}`}
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
        <PanelEmpty
          strong={t("pages.groups.artifacts.emptyTitle")}
          text={t("pages.groups.artifacts.emptyDescription")}
        />
      )}
    </section>
  );
}

function GroupCanvasBoards({ boards }: { boards: NonNullable<GroupDetail["canvasBoards"]> }) {
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

function MembersPanel({
  busy,
  canManageMembers,
  detail,
  memberId,
  onAdd,
  setMemberId,
}: {
  busy: string;
  canManageMembers: boolean;
  detail: GroupDetail;
  memberId: string;
  onAdd: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  setMemberId: (value: string) => void;
}) {
  const { t } = useLocale();
  return (
    <section className={styles.panel}>
      <SectionHeading
        count={detail.members.length}
        eyebrow={t("pages.groups.membersEyebrow")}
        title={t("pages.groups.members")}
      />
      {canManageMembers && detail.availableMembers.length ? (
        <form className={styles.compactForm} onSubmit={onAdd}>
          <label className={styles.field}>
            <span>{t("pages.groups.workspaceMember")}</span>
            <select onChange={(event) => setMemberId(event.target.value)} value={memberId}>
              <option value="">{t("pages.groups.chooseMember")}</option>
              {detail.availableMembers.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.email} · {member.role}
                </option>
              ))}
            </select>
          </label>
          <button
            className="button small-button"
            disabled={busy === "member" || !memberId}
            type="submit"
          >
            {busy === "member" ? t("pages.groups.adding") : t("pages.groups.add")}
          </button>
        </form>
      ) : null}
      <ul className={styles.memberList}>
        {detail.members.map((member) => (
          <li key={member.userId}>
            <span className={styles.avatar} aria-hidden="true">
              {member.email.charAt(0).toUpperCase()}
            </span>
            <span>
              <strong>{member.email}</strong>
              <small>
                {member.workspaceRole
                  ? t(`pages.groups.role.${member.workspaceRole}`)
                  : t("pages.groups.formerMember")}
              </small>
            </span>
            <span className={styles.roleBadge}>{t(`pages.groups.role.${member.role}`)}</span>
          </li>
        ))}
      </ul>
      {canManageMembers && !detail.availableMembers.length ? (
        <p className={styles.helpText}>{t("pages.groups.allMembersAdded")}</p>
      ) : null}
    </section>
  );
}

function DiscussionPanel({
  busy,
  detail,
  messageBody,
  onPost,
  setMessageBody,
}: {
  busy: string;
  detail: GroupDetail;
  messageBody: string;
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
          disabled={busy === "message" || !messageBody.trim()}
          type="submit"
        >
          {busy === "message"
            ? t("pages.groups.discussion.posting")
            : t("pages.groups.discussion.post")}
        </button>
      </form>
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

function SchedulePanel({
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
              disabled={busy === "schedule" || !scheduleKey || !scheduledFor}
              type="submit"
            >
              {busy === "schedule"
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

function SectionHeading({
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

function PanelEmpty({ strong, text }: { strong: string; text: string }) {
  return (
    <div className={styles.panelEmpty}>
      <strong>{strong}</strong>
      <span>{text}</span>
    </div>
  );
}

export default function GroupsPage() {
  return (
    <WorkspaceProvider>
      <GroupsContext />
    </WorkspaceProvider>
  );
}

function GroupsContext() {
  const { creator } = useWorkspace();
  return <GroupsContent key={`${creator?.userId}:${creator?.workspaceId}`} />;
}
