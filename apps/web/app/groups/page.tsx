"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useLocale } from "../../components/locale-provider";
import { WorkspaceProvider, useWorkspace } from "../../components/workspace/workspace-provider";
import { WorkspaceShell } from "../../components/workspace/workspace-shell";
import { LibraryShareActions } from "../../components/workspace/library-sharing/share-actions";
import { LibraryShareDue } from "../../components/workspace/library-sharing/share-due";
import {
  listLibraryShares,
  type LibraryShareSummary,
} from "../../components/workspace/library-sharing/client";
import { apiFetch, AUTH_CHANGE_EVENT, humanError } from "../../lib/api";
import { listIdeaBoards } from "../../lib/idea-board-client";
import { groupsMessages } from "../../lib/i18n/groups-messages";
import { librarySharingMessages } from "../../lib/i18n/library-sharing-messages";
import { GroupDialog, type GroupFormValues } from "./group-dialog";
import {
  artifactKey,
  defaultGroupFilters,
  filterGroups,
  groupPurposes,
  readArtifactKey,
  resolveGroupCapabilities,
  type GroupDetail,
  type GroupFilters,
  type GroupSummary,
  type GroupsContext as Context,
  type LibraryArtifact,
  type GroupArtifact,
} from "./groups-model";
import {
  DiscussionPanel,
  GroupCanvasBoards,
  PanelEmpty,
  SchedulePanel,
  SectionHeading,
  SharedArtifacts,
} from "./workspace-panels";
import styles from "./groups.module.css";

type Section = "content" | "members" | "discussion" | "schedule";

function GroupsContent() {
  const { locale, t } = useLocale();
  const copy = groupsMessages(locale);
  const libraryCopy = librarySharingMessages(locale);
  const { canEdit, creator, workspace, productFeatures } = useWorkspace();
  const presentationsEnabled = productFeatures?.presentations === true;
  const ideaBoardsEnabled = productFeatures?.ideaBoards === true;
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [context, setContext] = useState<Context>({
    organizationId: null,
    organizationName: null,
    canCreateOrganizationGroup: false,
    canCreateWorkspaceGroup: false,
  });
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<GroupDetail | null>(null);
  const [filters, setFilters] = useState<GroupFilters>(defaultGroupFilters);
  const [section, setSection] = useState<Section>("content");
  const [contentType, setContentType] = useState("all");
  const [dialog, setDialog] = useState<"create" | "settings" | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  const [rounds, setRounds] = useState<LibraryArtifact[]>([]);
  const [presentations, setPresentations] = useState<LibraryArtifact[]>([]);
  const [ideaBoards, setIdeaBoards] = useState<LibraryArtifact[]>([]);
  const [ideaBoardCursor, setIdeaBoardCursor] = useState<string | null>(null);
  const [ideaBoardLoading, setIdeaBoardLoading] = useState(false);
  const [publications, setPublications] = useState<LibraryShareSummary[]>([]);
  const [publicationCursor, setPublicationCursor] = useState<string | null>(null);
  const [publicationsLoading, setPublicationsLoading] = useState(false);
  const [publicationError, setPublicationError] = useState(false);
  const [publicationReload, setPublicationReload] = useState(0);
  const [shareId, setShareId] = useState("");
  const [memberId, setMemberId] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [memberOptions, setMemberOptions] = useState<Array<{ userId: string; email: string }>>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersMore, setMembersMore] = useState(false);
  const [membersError, setMembersError] = useState(false);
  const [membersReload, setMembersReload] = useState(0);
  const [shareKey, setShareKey] = useState("");
  const [messageBody, setMessageBody] = useState("");
  const [scheduleKey, setScheduleKey] = useState("");
  const [scheduleKind, setScheduleKind] = useState<"live_session" | "round_assignment">(
    "live_session",
  );
  const [scheduledFor, setScheduledFor] = useState("");
  const [scheduleNote, setScheduleNote] = useState("");
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const inFlight = useRef(false);
  const openDialog = useRef(dialog);
  openDialog.current = dialog;
  const lifetime = useRef<AbortController | null>(null);
  const publicationController = useRef<AbortController | null>(null);
  const moreController = useRef<AbortController | null>(null);

  useEffect(() => {
    const active = new AbortController();
    lifetime.current = active;
    const invalidate = () => {
      lifetime.current?.abort();
      lifetime.current = new AbortController();
      publicationController.current?.abort();
      moreController.current?.abort();
      selectedRef.current = "";
      setSelectedId("");
      setPublications([]);
      setMemberOptions([]);
      setBusy("");
      inFlight.current = false;
      setGroups([]);
      setDetail(null);
      setContext({
        organizationId: null,
        organizationName: null,
        canCreateOrganizationGroup: false,
        canCreateWorkspaceGroup: false,
      });
      setDialog(null);
      setReload((value) => value + 1);
    };
    const refresh = () => {
      if (!inFlight.current && !openDialog.current) setReload((value) => value + 1);
    };
    window.addEventListener(AUTH_CHANGE_EVENT, invalidate);
    window.addEventListener("polling-pops:workspace-updated", invalidate);
    window.addEventListener("focus", refresh);
    return () => {
      lifetime.current?.abort();
      moreController.current?.abort();
      window.removeEventListener(AUTH_CHANGE_EVENT, invalidate);
      window.removeEventListener("polling-pops:workspace-updated", invalidate);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  // Legacy workspace responses remain readable while the enriched API rolls out.
  const normalize = useCallback(
    (group: GroupSummary): GroupSummary => ({
      ...group,
      scope: group.scope ?? "workspace",
      scopeName: group.scopeName ?? workspace?.name ?? copy.workspace,
      purpose: group.purpose ?? "team",
      status: group.status ?? "active",
      capabilities: resolveGroupCapabilities(group, canEdit, creator?.role === "owner"),
    }),
    [canEdit, copy.workspace, creator?.role, workspace?.name],
  );
  const normalizeDetail = useCallback(
    (group: GroupDetail): GroupDetail => ({
      ...group,
      ...normalize(group),
      members: group.members ?? [],
      availableMembers: group.availableMembers ?? [],
      artifacts: (group.artifacts ?? []).filter(
        (item) =>
          (item.artifactType !== "presentation" || presentationsEnabled) &&
          (item.artifactType !== "idea_board" || ideaBoardsEnabled),
      ),
      schedule: (group.schedule ?? []).filter(
        (item) => item.artifactType !== "presentation" || presentationsEnabled,
      ),
      messages: group.messages ?? [],
    }),
    [ideaBoardsEnabled, normalize, presentationsEnabled],
  );

  const refreshGroups = useCallback(
    async (signal?: AbortSignal) => {
      const response = await apiFetch<{ groups: GroupSummary[]; context?: Context }>("/v1/groups", {
        signal,
        cache: "no-store",
      });
      if (signal?.aborted) return;
      setGroups(response.groups.map(normalize));
      setContext(
        response.context ?? {
          organizationId: null,
          organizationName: null,
          canCreateOrganizationGroup: false,
          canCreateWorkspaceGroup: canEdit,
        },
      );
    },
    [canEdit, normalize],
  );
  const refreshDetail = useCallback(
    async (id: string, signal?: AbortSignal) => {
      const response = await apiFetch<{ group: GroupDetail }>(`/v1/groups/${id}`, {
        signal,
        cache: "no-store",
      });
      if (!signal?.aborted && selectedRef.current === id)
        setDetail(normalizeDetail(response.group));
    },
    [normalizeDetail],
  );

  useEffect(() => {
    const active = new AbortController();
    setLoading(true);
    setError("");
    void refreshGroups(active.signal)
      .catch((caught) => {
        if (!active.signal.aborted) {
          setGroups([]);
          setDetail(null);
          setError(humanError(caught));
        }
      })
      .finally(() => {
        if (!active.signal.aborted) setLoading(false);
      });
    return () => active.abort();
  }, [refreshGroups, reload]);

  const visibleGroups = useMemo(
    () => filterGroups(groups, filters, locale),
    [filters, groups, locale],
  );
  useEffect(() => {
    if (loading || busy) return;
    if (!visibleGroups.some((group) => group.id === selectedId)) {
      setSelectedId(visibleGroups[0]?.id ?? "");
      setDetail(null);
    }
  }, [busy, loading, selectedId, visibleGroups]);

  useEffect(() => {
    setDetail(null);
    setMemberId("");
    setMemberSearch("");
    setMemberOptions([]);
    setShareKey("");
    setShareId("");
    setMessageBody("");
    setScheduleKey("");
    setScheduledFor("");
    setScheduleNote("");
    setContentType("all");
    setSection("content");
  }, [selectedId]);

  useEffect(() => {
    const active = new AbortController();
    setDetail(null);
    if (!selectedId) {
      setDetailLoading(false);
      return () => active.abort();
    }
    setDetailLoading(true);
    setError("");
    void refreshDetail(selectedId, active.signal)
      .catch((caught) => {
        if (!active.signal.aborted) setError(humanError(caught));
      })
      .finally(() => {
        if (!active.signal.aborted) setDetailLoading(false);
      });
    return () => active.abort();
  }, [refreshDetail, selectedId, reload]);

  useEffect(() => {
    if (!canEdit) return;
    const active = new AbortController();
    void Promise.all([
      apiFetch<{ quizzes: LibraryArtifact[] }>("/v1/quizzes?archived=true&summary=true", {
        signal: active.signal,
      }),
      presentationsEnabled
        ? apiFetch<{ presentations: LibraryArtifact[] }>("/v1/presentations", {
            signal: active.signal,
          })
        : Promise.resolve({ presentations: [] }),
      ideaBoardsEnabled
        ? listIdeaBoards("", active.signal)
        : Promise.resolve({ boards: [], nextCursor: null }),
    ])
      .then(([roundResult, presentationResult, ideaResult]) => {
        if (active.signal.aborted) return;
        setRounds(roundResult.quizzes.filter((item) => item.status !== "archived"));
        setPresentations(
          presentationResult.presentations.filter((item) => item.status !== "archived"),
        );
        setIdeaBoards(
          ideaResult.boards.map((board) => ({
            id: board.id,
            title: board.title,
            status: "draft",
            currentVersionId: null,
          })),
        );
        setIdeaBoardCursor(ideaResult.nextCursor);
      })
      .catch((caught) => {
        if (!active.signal.aborted) setError(humanError(caught));
      });
    return () => active.abort();
  }, [canEdit, ideaBoardsEnabled, presentationsEnabled]);

  const canCurateOrganization =
    detail?.scope === "organization" && detail.capabilities.shareContent;
  const selectedOrganizationId = detail?.scope === "organization" ? detail.organizationId : null;
  useEffect(() => {
    const active = new AbortController();
    publicationController.current = active;
    setPublications([]);
    setPublicationCursor(null);
    setPublicationError(false);
    if (!canCurateOrganization || !selectedOrganizationId || section !== "content") {
      setPublicationsLoading(false);
      return () => active.abort();
    }
    setPublicationsLoading(true);
    void listLibraryShares("organization", active.signal, undefined, selectedOrganizationId)
      .then((result) => {
        if (!active.signal.aborted) {
          setPublications(
            result.shares.filter(
              (share) =>
                share.audience === "organization" &&
                share.organizationId === selectedOrganizationId,
            ),
          );
          setPublicationCursor(result.nextCursor);
        }
      })
      .catch(() => {
        if (!active.signal.aborted) setPublicationError(true);
      })
      .finally(() => {
        if (!active.signal.aborted) setPublicationsLoading(false);
      });
    return () => active.abort();
  }, [canCurateOrganization, selectedId, selectedOrganizationId, section, publicationReload]);

  const canSearchMembers =
    detail?.scope === "organization" && detail.capabilities.manageMembers && section === "members";
  useEffect(() => {
    const active = new AbortController();
    setMemberOptions([]);
    setMemberId("");
    setMembersMore(false);
    setMembersError(false);
    if (!canSearchMembers || !selectedId) {
      setMembersLoading(false);
      return () => active.abort();
    }
    setMembersLoading(true);
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams({ search: memberSearch.trim() });
      void apiFetch<{ members: Array<{ userId: string; email: string }>; hasMore: boolean }>(
        `/v1/groups/${selectedId}/available-members?${query}`,
        { signal: active.signal, cache: "no-store" },
      )
        .then((result) => {
          if (!active.signal.aborted && selectedRef.current === selectedId) {
            setMemberOptions(result.members);
            setMembersMore(result.hasMore);
          }
        })
        .catch(() => {
          if (!active.signal.aborted) setMembersError(true);
        })
        .finally(() => {
          if (!active.signal.aborted) setMembersLoading(false);
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      active.abort();
    };
  }, [canSearchMembers, selectedId, memberSearch, detail?.members, membersReload]);

  const shareCandidates = useMemo(() => {
    const shared = new Set(
      (detail?.artifacts ?? []).map((artifact) =>
        artifactKey(artifact.artifactType, artifact.artifactId),
      ),
    );
    return [
      ...rounds.map((item) => ({ ...item, artifactType: "round" as const })),
      ...presentations.map((item) => ({ ...item, artifactType: "presentation" as const })),
      ...ideaBoards.map((item) => ({ ...item, artifactType: "idea_board" as const })),
    ].filter((item) => !shared.has(artifactKey(item.artifactType, item.id)));
  }, [detail?.artifacts, ideaBoards, presentations, rounds]);
  const currentSelection =
    detail?.id === selectedId && visibleGroups.some((group) => group.id === selectedId);
  const visiblePublications =
    detail?.sharedLibrary?.filter(
      (share) => contentType === "all" || share.artifactType === contentType,
    ) ?? [];
  const publicationCandidates = publications.filter(
    (share) => !detail?.sharedLibrary?.some((current) => current.id === share.id),
  );
  const scheduledArtifact = detail?.artifacts.find(
    (item) => artifactKey(item.artifactType, item.artifactId) === scheduleKey,
  );
  const canCreate = context.canCreateWorkspaceGroup || context.canCreateOrganizationGroup;

  async function mutate(label: string, work: (signal: AbortSignal) => Promise<void>) {
    const active = lifetime.current;
    if (!active || active.signal.aborted || inFlight.current) return;
    inFlight.current = true;
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await work(active.signal);
    } catch (caught) {
      if (!active.signal.aborted) setError(humanError(caught));
    } finally {
      if (lifetime.current === active) inFlight.current = false;
      if (!active.signal.aborted) setBusy("");
    }
  }
  async function changeGroup(path: string, method: string, body?: unknown) {
    if (!detail) return;
    const id = detail.id;
    await mutate(path || "group", async (signal) => {
      await apiFetch(`/v1/groups/${id}${path}`, {
        method,
        signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const removedSelf = method === "DELETE" && path === `/members/${creator?.userId}`;
      if (removedSelf) {
        if (!signal.aborted && selectedRef.current === id) {
          selectedRef.current = "";
          setSelectedId("");
          setDetail(null);
        }
        await refreshGroups(signal);
      } else {
        await Promise.all([refreshDetail(id, signal), refreshGroups(signal)]);
      }
      if (
        !signal.aborted &&
        method === "PATCH" &&
        path === "" &&
        body &&
        typeof body === "object" &&
        "status" in body
      ) {
        setFilters((current) => ({
          ...current,
          status: (body as { status: "active" | "archived" }).status,
        }));
      }
      if (!signal.aborted) {
        setMemberId("");
        setShareId("");
        setShareKey("");
        setMessageBody("");
        setScheduleKey("");
        setScheduledFor("");
        setScheduleNote("");
        setNotice(copy.saved);
      }
    });
  }
  async function saveGroup(values: GroupFormValues) {
    await mutate("save", async (signal) => {
      if (dialog === "settings" && detail) {
        await apiFetch(`/v1/groups/${detail.id}`, {
          method: "PATCH",
          signal,
          body: JSON.stringify({
            name: values.name,
            description: values.description,
            purpose: values.purpose,
          }),
        });
        await Promise.all([refreshDetail(detail.id, signal), refreshGroups(signal)]);
      } else {
        const result = await apiFetch<{ group: GroupSummary }>("/v1/groups", {
          method: "POST",
          signal,
          body: JSON.stringify({
            ...values,
            ...(values.scope === "organization" ? { organizationId: context.organizationId } : {}),
          }),
        });
        await refreshGroups(signal);
        if (!signal.aborted) {
          setFilters(defaultGroupFilters);
          setSelectedId(result.group.id);
        }
      }
      if (!signal.aborted) {
        setDialog(null);
        setNotice(t("pages.groups.notice.created", { name: values.name }));
      }
    });
  }
  async function moreIdeaBoards() {
    if (!ideaBoardCursor || ideaBoardLoading) return;
    const active = new AbortController();
    moreController.current = active;
    setIdeaBoardLoading(true);
    try {
      const result = await listIdeaBoards("", active.signal, ideaBoardCursor);
      if (!active.signal.aborted) {
        setIdeaBoards((items) => [
          ...new Map(
            [
              ...items,
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
      }
    } catch (caught) {
      if (!active.signal.aborted) setError(humanError(caught));
    } finally {
      if (!active.signal.aborted) setIdeaBoardLoading(false);
    }
  }
  async function morePublications() {
    const active = publicationController.current;
    if (!active || active.signal.aborted || !publicationCursor || publicationsLoading) return;
    setPublicationsLoading(true);
    try {
      const result = await listLibraryShares(
        "organization",
        active.signal,
        publicationCursor,
        selectedOrganizationId ?? undefined,
      );
      if (!active.signal.aborted) {
        setPublications((items) => [
          ...new Map(
            [
              ...items,
              ...result.shares.filter(
                (share) =>
                  share.audience === "organization" &&
                  share.organizationId === selectedOrganizationId,
              ),
            ].map((share) => [share.id, share]),
          ).values(),
        ]);
        setPublicationCursor(result.nextCursor);
      }
    } catch {
      if (!active.signal.aborted) setPublicationError(true);
    } finally {
      if (!active.signal.aborted) setPublicationsLoading(false);
    }
  }
  function patchFilter<K extends keyof GroupFilters>(key: K, value: GroupFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }
  function submitArtifact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const artifact = readArtifactKey(shareKey);
    return artifact ? changeGroup("/artifacts", "POST", artifact) : Promise.resolve();
  }
  function submitSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const artifact = readArtifactKey(scheduleKey);
    return artifact && artifact.artifactType !== "idea_board" && scheduledFor
      ? changeGroup("/schedule", "POST", {
          ...artifact,
          kind: artifact.artifactType === "presentation" ? "live_session" : scheduleKind,
          scheduledFor: new Date(scheduledFor).toISOString(),
          note: scheduleNote.trim(),
        })
      : Promise.resolve();
  }
  const contentLabel = (type: string) =>
    type === "round"
      ? t("pages.common.round")
      : type === "presentation"
        ? t("pages.common.presentation")
        : type === "survey"
          ? t("pages.common.surveys")
          : type === "idea_board"
            ? copy.workshop
            : copy.canvas;

  return (
    <WorkspaceShell
      title={t("page.groups.title")}
      eyebrow={copy.eyebrow}
      description={copy.description}
      requiredFeature="groups"
      translationLevel="full"
      actions={
        canCreate ? (
          <button
            className="button"
            type="button"
            disabled={Boolean(busy)}
            onClick={() => {
              setError("");
              setDialog("create");
            }}
          >
            {t("pages.groups.create")}
          </button>
        ) : null
      }
    >
      {error && !dialog ? (
        <div className={styles.feedback} role="alert">
          <p className="error" lang="en-CA">
            {error}
          </p>
          <button
            className="button-quiet small-button"
            type="button"
            onClick={() => setReload((value) => value + 1)}
          >
            {copy.retry}
          </button>
        </div>
      ) : null}
      {notice ? (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      ) : null}
      <section className={styles.discovery} aria-label={copy.allGroups}>
        <div className={styles.discoveryHeading}>
          <nav className={styles.scopeNav} aria-label={copy.scopes}>
            {(["all", "workspace", "organization"] as const).map((scope) => (
              <button
                type="button"
                key={scope}
                aria-pressed={filters.scope === scope}
                disabled={Boolean(busy)}
                onClick={() => patchFilter("scope", scope)}
              >
                {scope === "all" ? copy.allGroups : copy[scope]}
                <span aria-hidden="true">
                  {groups.filter((group) => scope === "all" || group.scope === scope).length}
                </span>
              </button>
            ))}
          </nav>
          <label className={styles.searchField}>
            <span className="sr-only">{t("pages.groups.search")}</span>
            <input
              type="search"
              placeholder={t("pages.groups.search")}
              value={filters.search}
              onChange={(event) => patchFilter("search", event.target.value)}
              disabled={Boolean(busy)}
            />
          </label>
        </div>
        <div className={styles.filters}>
          <label className={styles.field}>
            <span>{copy.purpose}</span>
            <select
              value={filters.purpose}
              onChange={(event) =>
                patchFilter("purpose", event.target.value as GroupFilters["purpose"])
              }
              disabled={Boolean(busy)}
            >
              <option value="all">{copy.allPurposes}</option>
              {groupPurposes.map((purpose) => (
                <option value={purpose} key={purpose}>
                  {copy[purpose]}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>{copy.access}</span>
            <select
              value={filters.access}
              onChange={(event) =>
                patchFilter("access", event.target.value as GroupFilters["access"])
              }
              disabled={Boolean(busy)}
            >
              <option value="all">{copy.allAccess}</option>
              <option value="owner">{copy.ownerAccess}</option>
              <option value="member">{copy.memberAccess}</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>{copy.status}</span>
            <select
              value={filters.status}
              onChange={(event) =>
                patchFilter("status", event.target.value as GroupFilters["status"])
              }
              disabled={Boolean(busy)}
            >
              <option value="active">{copy.active}</option>
              <option value="archived">{copy.archived}</option>
              <option value="all">{copy.allStatuses}</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>{copy.sort}</span>
            <select
              value={filters.sort}
              onChange={(event) => patchFilter("sort", event.target.value as GroupFilters["sort"])}
              disabled={Boolean(busy)}
            >
              <option value="updated">{copy.updated}</option>
              <option value="name">{copy.nameSort}</option>
            </select>
          </label>
          <button
            type="button"
            className="button-quiet small-button"
            onClick={() => setFilters(defaultGroupFilters)}
            disabled={Boolean(busy)}
          >
            {copy.clear}
          </button>
        </div>
        <div className={styles.discoveryFooter}>
          <p>{copy.inviteOnly}</p>
          <span role="status" aria-live="polite">
            {loading
              ? t("pages.groups.loading")
              : (visibleGroups.length === 1 ? copy.resultOne : copy.results).replace(
                  "{count}",
                  String(visibleGroups.length),
                )}
          </span>
        </div>
      </section>
      <div className={styles.workspaceGrid}>
        <aside className={styles.groupRail} aria-label={t("pages.groups.workspaceGroups")}>
          {loading ? (
            <div
              className={styles.railLoading}
              role="status"
              aria-label={t("pages.groups.loading")}
            />
          ) : null}
          <div className={styles.groupList}>
            {visibleGroups.map((group) => (
              <button
                type="button"
                key={group.id}
                aria-pressed={group.id === selectedId}
                className={group.id === selectedId ? styles.groupButtonActive : styles.groupButton}
                disabled={Boolean(busy)}
                onClick={() => {
                  if (group.id !== selectedId) {
                    setDetail(null);
                    setSelectedId(group.id);
                  }
                }}
              >
                <span className={styles.groupMonogram} data-scope={group.scope} aria-hidden="true">
                  {group.name.charAt(0).toUpperCase()}
                </span>
                <span className={styles.groupButtonCopy}>
                  <span className={styles.rowMeta}>
                    {copy[group.scope]} · {copy[group.purpose]}
                  </span>
                  <strong lang="" dir="auto">
                    {group.name}
                  </strong>
                  <small>
                    {t("pages.groups.members")} · {group.memberCount} · {t("pages.groups.shared")}{" "}
                    {group.artifactCount}
                  </small>
                  <span className={styles.rowBadges}>
                    <span>{copy[`${group.role}Access`]}</span>
                    {group.status === "archived" ? <span>{copy.archived}</span> : null}
                  </span>
                </span>
              </button>
            ))}
          </div>
          {!loading && !visibleGroups.length ? (
            <div className={styles.railEmpty}>
              <strong>
                {groups.length ? t("pages.groups.noMatch") : t("pages.groups.emptyRailTitle")}
              </strong>
              <span>{groups.length ? copy.noMatchHelp : copy.creationHelp}</span>
            </div>
          ) : null}
        </aside>
        <div className={styles.detailColumn} aria-busy={detailLoading || Boolean(busy)}>
          {detailLoading ? (
            <div
              className={styles.detailLoading}
              role="status"
              aria-label={t("pages.groups.loadingOne")}
            />
          ) : null}
          {!detailLoading && !currentSelection && !loading ? (
            <section className={styles.emptyState}>
              <span aria-hidden="true">G</span>
              <h2>
                {groups.length ? t("pages.groups.chooseTitle") : t("pages.groups.firstTitle")}
              </h2>
              <p>{groups.length ? copy.noMatchHelp : copy.creationHelp}</p>
              {canCreate && !groups.length ? (
                <button
                  className="button"
                  type="button"
                  onClick={() => {
                    setError("");
                    setDialog("create");
                  }}
                >
                  {t("pages.groups.createFirst")}
                </button>
              ) : null}
            </section>
          ) : null}
          {!detailLoading && currentSelection && detail ? (
            <>
              <section className={styles.groupHero}>
                <div className={styles.heroHeading}>
                  <span
                    className={styles.heroMonogram}
                    data-scope={detail.scope}
                    aria-hidden="true"
                  >
                    {detail.name.charAt(0).toUpperCase()}
                  </span>
                  <div>
                    <div className={styles.inlineMeta}>
                      <span>
                        {copy[detail.scope]} ·{" "}
                        <span lang="" dir="auto">
                          {detail.scopeName}
                        </span>
                      </span>
                      <span className={styles.roleBadge}>{copy[`${detail.role}Access`]}</span>
                      <span>{copy[detail.purpose]}</span>
                      <span>{copy[detail.status]}</span>
                    </div>
                    <h2 lang="" dir="auto">
                      {detail.name}
                    </h2>
                    {detail.description ? (
                      <p lang="" dir="auto">
                        {detail.description}
                      </p>
                    ) : null}
                  </div>
                </div>
                <dl className={styles.stats}>
                  <div>
                    <dt>{t("pages.groups.members")}</dt>
                    <dd>{detail.members.length}</dd>
                  </div>
                  <div>
                    <dt>{copy.content}</dt>
                    <dd>
                      {detail.scope === "organization"
                        ? (detail.sharedLibrary?.length ?? 0)
                        : detail.artifacts.length + (detail.canvasBoards?.length ?? 0)}
                    </dd>
                  </div>
                </dl>
                <div className={styles.heroFooter}>
                  <p>
                    {detail.status === "archived"
                      ? copy.archivedHelp
                      : detail.capabilities.manageGroup
                        ? copy.manageHelp
                        : detail.capabilities.postMessage
                          ? copy.inviteOnly
                          : copy.readOnly}
                  </p>
                  {detail.capabilities.manageGroup ? (
                    <div className={styles.cardActions}>
                      {detail.status === "active" ? (
                        <>
                          <button
                            type="button"
                            className="button-quiet small-button"
                            disabled={Boolean(busy)}
                            onClick={() => {
                              setError("");
                              setDialog("settings");
                            }}
                          >
                            {copy.settings}
                          </button>
                          <button
                            type="button"
                            className="button-quiet small-button"
                            disabled={Boolean(busy)}
                            onClick={() => void changeGroup("", "PATCH", { status: "archived" })}
                          >
                            {copy.archive}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="button small-button"
                          disabled={Boolean(busy)}
                          onClick={() => void changeGroup("", "PATCH", { status: "active" })}
                        >
                          {copy.restore}
                        </button>
                      )}
                    </div>
                  ) : null}
                </div>
              </section>
              <nav className={styles.detailNav} aria-label={copy.viewGroup}>
                {(
                  [
                    "content",
                    "members",
                    "discussion",
                    ...(detail.scope === "workspace" ? ["schedule" as const] : []),
                  ] as const
                ).map((value) => (
                  <button
                    type="button"
                    aria-pressed={section === value}
                    key={value}
                    onClick={() => setSection(value)}
                  >
                    {value === "content"
                      ? copy.content
                      : value === "members"
                        ? t("pages.groups.members")
                        : value === "discussion"
                          ? t("pages.groups.discussion.title")
                          : t("pages.groups.schedule.title")}
                  </button>
                ))}
              </nav>
              {section === "content" ? (
                <>
                  <div className={styles.contentToolbar}>
                    <label className={styles.field}>
                      <span>{copy.contentType}</span>
                      <select
                        value={contentType}
                        onChange={(event) => setContentType(event.target.value)}
                      >
                        <option value="all">{copy.allContent}</option>
                        {(detail.scope === "organization"
                          ? ["round", "presentation", "survey"]
                          : [
                              "round",
                              ...(presentationsEnabled ? ["presentation"] : []),
                              ...(ideaBoardsEnabled ? ["idea_board"] : []),
                              "canvas",
                            ]
                        ).map((value) => (
                          <option value={value} key={value}>
                            {contentLabel(value)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <p>
                      {detail.scope === "organization"
                        ? copy.organizationHelp
                        : copy.workspaceContentHelp}
                    </p>
                  </div>
                  {detail.scope === "organization" ? (
                    <section className={styles.panel}>
                      <SectionHeading
                        count={detail.sharedLibrary?.length ?? 0}
                        eyebrow={copy.organization}
                        title={copy.content}
                      />
                      {detail.capabilities.shareContent ? (
                        <details className={styles.actionDisclosure}>
                          <summary>{copy.addPublication}</summary>
                          <form
                            className={styles.compactForm}
                            onSubmit={(event) => {
                              event.preventDefault();
                              if (shareId) void changeGroup("/library-shares", "POST", { shareId });
                            }}
                          >
                            <label className={styles.field}>
                              <span>{copy.choosePublication}</span>
                              <select
                                value={shareId}
                                onChange={(event) => setShareId(event.target.value)}
                                disabled={Boolean(busy) || publicationsLoading}
                              >
                                <option value="">
                                  {publicationsLoading
                                    ? libraryCopy.loading
                                    : copy.choosePublication}
                                </option>
                                {publicationCandidates.map((share) => (
                                  <option value={share.id} key={share.id}>
                                    {contentLabel(share.artifactType)} · {share.title}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <button
                              type="submit"
                              className="button small-button"
                              disabled={Boolean(busy) || !shareId}
                            >
                              {copy.addPublication}
                            </button>
                          </form>
                          <p className={styles.helpText}>{copy.collectionHelp}</p>
                          {publicationCursor ? (
                            <button
                              type="button"
                              className="button-quiet small-button"
                              disabled={publicationsLoading}
                              onClick={() => void morePublications()}
                            >
                              {copy.loadMore}
                            </button>
                          ) : null}
                          {publicationError ? (
                            <p role="alert">
                              <button
                                className="button-quiet small-button"
                                type="button"
                                onClick={() => setPublicationReload((value) => value + 1)}
                              >
                                {copy.retry}
                              </button>
                            </p>
                          ) : null}
                        </details>
                      ) : null}
                      {visiblePublications.length ? (
                        <div className={styles.artifactGrid}>
                          {visiblePublications.map((share) => (
                            <article key={share.id} className={styles.publicationCard}>
                              <div className={styles.inlineMeta}>
                                <span>{contentLabel(share.artifactType)}</span>
                                <span className={styles.roleBadge}>
                                  {share.permission === "use"
                                    ? libraryCopy.canUse
                                    : libraryCopy.canView}
                                </span>
                                <span>{libraryCopy[share.progress]}</span>
                              </div>
                              <h3 lang="" dir="auto">
                                {share.title}
                              </h3>
                              {share.description ? (
                                <p lang="" dir="auto">
                                  {share.description}
                                </p>
                              ) : null}
                              <p className={styles.helpText}>
                                {libraryCopy.from}:{" "}
                                <span lang="" dir="auto">
                                  {share.sourceWorkspaceName}
                                </span>
                              </p>
                              <LibraryShareDue dueAt={share.dueAt} progress={share.progress} />
                              {detail.status === "archived" ? (
                                <Link
                                  className="button-quiet small-button"
                                  href={`/library/shared/${share.id}`}
                                >
                                  {libraryCopy.open}
                                </Link>
                              ) : (
                                <LibraryShareActions
                                  share={{
                                    ...share,
                                    capabilities: {
                                      ...share.capabilities,
                                      manage: false,
                                    },
                                  }}
                                  onChange={(next) =>
                                    setDetail((current) =>
                                      current?.id === detail.id
                                        ? {
                                            ...current,
                                            sharedLibrary: current.sharedLibrary?.map((row) =>
                                              row.id === next.id ? next : row,
                                            ),
                                          }
                                        : current,
                                    )
                                  }
                                  onRevoked={() => undefined}
                                />
                              )}
                              {detail.capabilities.shareContent ? (
                                <button
                                  type="button"
                                  className={styles.removeButton}
                                  disabled={Boolean(busy)}
                                  onClick={() =>
                                    void changeGroup(`/library-shares/${share.id}`, "DELETE")
                                  }
                                >
                                  {copy.collectionOnly}
                                </button>
                              ) : null}
                            </article>
                          ))}
                        </div>
                      ) : (
                        <PanelEmpty strong={copy.noContent} text={copy.organizationHelp} />
                      )}
                    </section>
                  ) : (
                    <>
                      {contentType !== "canvas" ? (
                        <SharedArtifacts
                          busy={busy}
                          canEdit={detail.capabilities.shareContent}
                          detail={{
                            ...detail,
                            artifacts: detail.artifacts.filter(
                              (item) => contentType === "all" || item.artifactType === contentType,
                            ),
                          }}
                          onRemove={(artifact: GroupArtifact) =>
                            changeGroup(`/artifacts/${artifact.id}`, "DELETE")
                          }
                          onShare={submitArtifact}
                          setShareKey={setShareKey}
                          shareCandidates={shareCandidates}
                          shareKey={shareKey}
                          moreIdeaBoards={ideaBoardCursor ? moreIdeaBoards : undefined}
                          ideaBoardLoading={ideaBoardLoading}
                        />
                      ) : null}
                      {(contentType === "all" || contentType === "canvas") &&
                      detail.canvasBoards?.length ? (
                        <GroupCanvasBoards boards={detail.canvasBoards} />
                      ) : null}
                    </>
                  )}
                </>
              ) : null}
              {section === "members" ? (
                <section className={styles.panel}>
                  <SectionHeading
                    count={detail.members.length}
                    eyebrow={copy[detail.scope]}
                    title={t("pages.groups.members")}
                  />
                  {detail.scope === "organization" ? (
                    <p className={styles.helpText}>{copy.addMemberHelp}</p>
                  ) : null}
                  {detail.capabilities.manageMembers &&
                  (detail.scope === "organization" || detail.availableMembers.length > 0) ? (
                    <details className={styles.actionDisclosure}>
                      <summary>
                        {t("pages.groups.add")} · {t("pages.groups.members")}
                      </summary>
                      <form
                        className={styles.compactForm}
                        onSubmit={(event) => {
                          event.preventDefault();
                          if (memberId) void changeGroup("/members", "POST", { userId: memberId });
                        }}
                      >
                        {detail.scope === "organization" ? (
                          <label className={`${styles.field} ${styles.memberSearch}`}>
                            <span>{copy.findMember}</span>
                            <input
                              type="search"
                              value={memberSearch}
                              onChange={(event) => {
                                setMemberId("");
                                setMemberOptions([]);
                                setMemberSearch(event.target.value);
                              }}
                              disabled={Boolean(busy)}
                            />
                          </label>
                        ) : null}
                        <label className={styles.field}>
                          <span>
                            {detail.scope === "organization"
                              ? copy.memberDirectory
                              : t("pages.groups.workspaceMember")}
                          </span>
                          <select
                            value={memberId}
                            onChange={(event) => setMemberId(event.target.value)}
                            disabled={
                              Boolean(busy) || (detail.scope === "organization" && membersLoading)
                            }
                          >
                            <option value="">
                              {detail.scope === "organization" && membersLoading
                                ? libraryCopy.loading
                                : t("pages.groups.chooseMember")}
                            </option>
                            {(detail.scope === "organization"
                              ? memberOptions
                              : detail.availableMembers
                            ).map((member) => (
                              <option key={member.userId} value={member.userId}>
                                {member.email}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          type="submit"
                          className="button small-button"
                          disabled={Boolean(busy) || !memberId}
                        >
                          {t("pages.groups.add")}
                        </button>
                      </form>
                      {detail.scope === "organization" && membersMore ? (
                        <p className={styles.helpText}>{copy.moreMembers}</p>
                      ) : null}
                      {detail.scope === "organization" && membersError ? (
                        <div role="alert">
                          <p className="error">{copy.memberLoadFailed}</p>
                          <button
                            className="button-quiet small-button"
                            type="button"
                            disabled={membersLoading}
                            onClick={() => {
                              setMemberId("");
                              setMemberOptions([]);
                              setMembersError(false);
                              setMembersReload((value) => value + 1);
                            }}
                          >
                            {copy.retry}
                          </button>
                        </div>
                      ) : null}
                    </details>
                  ) : null}
                  {detail.capabilities.manageMembers &&
                  detail.members.filter((member) => member.role === "owner").length === 1 ? (
                    <p className={styles.helpText}>{copy.lastOwner}</p>
                  ) : null}
                  <ul className={styles.memberList}>
                    {detail.members.map((member) => {
                      const lastOwner =
                        member.role === "owner" &&
                        detail.members.filter((item) => item.role === "owner").length === 1;
                      return (
                        <li key={member.userId}>
                          <span className={styles.avatar} aria-hidden="true">
                            {member.email.charAt(0).toUpperCase()}
                          </span>
                          <span>
                            <strong lang="" dir="auto">
                              {member.email}
                            </strong>
                            <small>{copy[`${member.role}Access`]}</small>
                          </span>
                          {detail.capabilities.manageMembers ? (
                            <div className={styles.memberActions}>
                              <button
                                className="button-quiet small-button"
                                type="button"
                                disabled={Boolean(busy) || lastOwner}
                                onClick={() =>
                                  void changeGroup(`/members/${member.userId}`, "PATCH", {
                                    role: member.role === "owner" ? "member" : "owner",
                                  })
                                }
                              >
                                {member.role === "owner" ? copy.makeMember : copy.makeOwner}
                              </button>
                              <button
                                className={styles.removeButton}
                                type="button"
                                disabled={Boolean(busy) || lastOwner}
                                onClick={() => {
                                  if (window.confirm(copy.removeMemberConfirm))
                                    void changeGroup(`/members/${member.userId}`, "DELETE");
                                }}
                              >
                                {copy.removeMember}
                              </button>
                            </div>
                          ) : (
                            <span className={styles.roleBadge}>{copy[`${member.role}Access`]}</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ) : null}
              {section === "discussion" ? (
                <DiscussionPanel
                  busy={busy}
                  detail={detail}
                  canPost={detail.capabilities.postMessage}
                  messageBody={messageBody}
                  setMessageBody={setMessageBody}
                  onPost={(event) => {
                    event.preventDefault();
                    return messageBody.trim()
                      ? changeGroup("/messages", "POST", { body: messageBody.trim() })
                      : Promise.resolve();
                  }}
                />
              ) : null}
              {section === "schedule" && detail.scope === "workspace" ? (
                <SchedulePanel
                  busy={busy}
                  canEdit={detail.capabilities.schedule}
                  detail={detail}
                  onSchedule={submitSchedule}
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
              ) : null}
            </>
          ) : null}
        </div>
      </div>
      {dialog &&
      (dialog === "create" || (detail?.status === "active" && detail.capabilities.manageGroup)) ? (
        <GroupDialog
          key={dialog === "settings" ? detail?.id : "create"}
          group={dialog === "settings" ? (detail ?? undefined) : undefined}
          context={context}
          busy={Boolean(busy)}
          error={error}
          onClose={() => {
            setDialog(null);
            setError("");
          }}
          onSave={saveGroup}
        />
      ) : null}
    </WorkspaceShell>
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
