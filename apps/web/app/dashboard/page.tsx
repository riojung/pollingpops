"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Entitlements, QuizDraft } from "@openround/contracts";
import { AuthoringAssistant } from "../../components/authoring-assistant";
import { CreatorBrand } from "../../components/brand";
import { CheckpointSetImport } from "../../components/checkpoint-set-import";
import { API_URL, apiFetch, humanError } from "../../lib/api";
import { folderPathLabel, getFolderOptions, type FolderRecord } from "../../lib/folders";
import { dashboardMessage } from "../../components/workspace/workspace-model";
import { RoundLibraryViewToggle } from "../../components/workspace/round-library-view-toggle";
import { WorkspaceProvider, useWorkspace } from "../../components/workspace/workspace-provider";
import { WorkspaceShell } from "../../components/workspace/workspace-shell";
import { ManagementNavigationLinks } from "../../components/management-navigation";
import {
  DEFAULT_ROUND_LIBRARY_VIEW,
  readRoundLibraryView,
  type RoundLibraryView,
  writeRoundLibraryView,
} from "../../lib/round-library-view";
import styles from "../../components/workspace/workspace-content.module.css";

interface Creator {
  userId: string;
  workspaceId: string;
  email: string;
  segment: "education" | "workplace";
  role: "owner" | "editor" | "viewer";
  plan: "free" | "pro" | "team";
}

interface QuizRecord {
  id: string;
  title: string;
  description: string;
  status: "draft" | "published" | "archived";
  draft: QuizDraft;
  currentVersionId: string | null;
  folderId: string | null;
  tags: string[];
  updatedAt: string;
  lastHostedAt: string | null;
}

function LegacyDashboardPage() {
  const router = useRouter();
  const { management } = useWorkspace();
  const [creator, setCreator] = useState<Creator | null>(null);
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);
  const [quizzes, setQuizzes] = useState<QuizRecord[]>([]);
  const [folders, setFolders] = useState<FolderRecord[]>([]);
  const [title, setTitle] = useState("");
  const [search, setSearch] = useState("");
  const [folderFilter, setFolderFilter] = useState("all");
  const [organizingId, setOrganizingId] = useState("");
  const [organizationFolderId, setOrganizationFolderId] = useState("");
  const [organizationTags, setOrganizationTags] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [productFeatures, setProductFeatures] = useState<{ workspaceShell: boolean } | null>(null);

  const refresh = useCallback(
    async (includeArchived: boolean) => {
      try {
        const [me, list, folderList] = await Promise.all([
          apiFetch<{
            creator: Creator;
            entitlements: Entitlements;
            productFeatures?: { workspaceShell?: boolean };
          }>("/v1/auth/me"),
          apiFetch<{ quizzes: QuizRecord[] }>(
            `/v1/quizzes${includeArchived ? "?archived=true" : ""}`,
          ),
          apiFetch<{ folders: FolderRecord[] }>("/v1/folders?artifactType=round"),
        ]);
        setCreator(me.creator);
        setEntitlements(me.entitlements);
        setProductFeatures({ workspaceShell: me.productFeatures?.workspaceShell === true });
        setQuizzes(list.quizzes);
        setFolders(folderList.folders.filter((folder) => folder.artifactType === "round"));
      } catch (caught) {
        if ((caught as { status?: number }).status === 401) {
          // WorkspaceProvider resolves user-only access before rendering this page.
          router.replace(
            management.user && management.organizationManagementEnabled
              ? "/organization"
              : "/signin",
          );
        } else setError(humanError(caught));
      } finally {
        setLoading(false);
      }
    },
    [management.organizationManagementEnabled, management.user, router],
  );

  useEffect(() => {
    setLoading(true);
    void refresh(showArchived);
  }, [refresh, showArchived]);

  async function createQuiz(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const response = await apiFetch<{ quiz: QuizRecord }>("/v1/quizzes", {
        method: "POST",
        body: JSON.stringify({ title, description: "" }),
      });
      router.push(`/quiz/${response.quiz.id}`);
    } catch (caught) {
      setError(humanError(caught));
    }
  }

  async function duplicate(quizId: string) {
    setBusyId(quizId);
    try {
      await apiFetch(`/v1/quizzes/${quizId}/duplicate`, { method: "POST", body: "{}" });
      await refresh(showArchived);
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusyId("");
    }
  }

  async function setArchived(quizId: string, archived: boolean) {
    setBusyId(quizId);
    setError("");
    try {
      await apiFetch(`/v1/quizzes/${quizId}/archive`, {
        method: "POST",
        body: JSON.stringify({ archived }),
      });
      await refresh(showArchived);
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusyId("");
    }
  }

  function beginOrganizing(quiz: QuizRecord) {
    setOrganizingId(quiz.id);
    setOrganizationFolderId(quiz.folderId ?? "");
    setOrganizationTags(quiz.tags.join(", "));
  }

  async function saveOrganization(event: FormEvent, quizId: string) {
    event.preventDefault();
    setBusyId(quizId);
    setError("");
    try {
      await apiFetch(`/v1/quizzes/${quizId}/organization`, {
        method: "PATCH",
        body: JSON.stringify({
          folderId: organizationFolderId || null,
          tags: organizationTags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
        }),
      });
      setOrganizingId("");
      await refresh(showArchived);
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusyId("");
    }
  }

  function host(quizId: string) {
    if (!creator || !entitlements) return;
    router.push(`/host/setup/${quizId}`);
  }

  async function logout() {
    setError("");
    try {
      await apiFetch("/v1/auth/logout", { method: "POST", body: "{}" });
      router.replace("/");
    } catch (caught) {
      setError(humanError(caught));
    }
  }

  async function upgrade() {
    try {
      const result = await apiFetch<{ url: string }>("/v1/billing/checkout", {
        method: "POST",
        body: "{}",
      });
      window.location.assign(result.url);
    } catch (caught) {
      setError(humanError(caught));
    }
  }

  async function downloadCheckpointSet(quizId: string, format: "json" | "csv" | "qti.zip") {
    setBusyId(quizId);
    setError("");
    try {
      const response = await fetch(`${API_URL}/v1/quizzes/${quizId}/export.${format}`, {
        credentials: "include",
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? `Export failed (${response.status}).`);
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `polling-pops-checkpoint-set-${quizId}.${format}`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusyId("");
    }
  }

  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visibleQuizzes = quizzes.filter(
    (quiz) =>
      (folderFilter === "all" ||
        (folderFilter === "unfiled" ? !quiz.folderId : quiz.folderId === folderFilter)) &&
      (!normalizedSearch ||
        quiz.title.toLocaleLowerCase().includes(normalizedSearch) ||
        quiz.description.toLocaleLowerCase().includes(normalizedSearch) ||
        quiz.tags.some((tag) => tag.toLocaleLowerCase().includes(normalizedSearch))),
  );
  const publishedQuizCount = quizzes.filter((quiz) => quiz.status === "published").length;
  const canEdit = creator?.role === "owner" || creator?.role === "editor";

  return (
    <>
      <header className="shell topbar">
        <CreatorBrand productFeatures={productFeatures} />
        <nav className="button-row" aria-label="Account navigation">
          <Link href="/account">Account</Link>
          <ManagementNavigationLinks navigation={management} />
          <Link href="/pricing">
            {creator?.plan === "free" ? "Free plan" : `${creator?.plan} plan`}
          </Link>
          <button className="button-quiet small-button" onClick={() => void logout()} type="button">
            Sign out
          </button>
        </nav>
      </header>
      <main className="shell page-main" id="main">
        <div className="page-heading">
          <div>
            <p className="eyebrow">Creator workspace</p>
            <h1>Your checkpoint sets</h1>
            <p className="muted">
              {creator ? `${creator.email} · ${creator.segment}` : "Loading workspace…"}
            </p>
          </div>
          {creator?.plan === "free" ? (
            <button className="button-quiet" onClick={() => void upgrade()} type="button">
              Explore Pro
            </button>
          ) : null}
        </div>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        {entitlements && entitlements.maxPublishedQuizzes !== null ? (
          <p className="notice">
            {publishedQuizCount} of {entitlements.maxPublishedQuizzes} published checkpoint-set
            slots used on the {entitlements.plan} plan. Draft and archived sets do not use a slot.
          </p>
        ) : null}
        {canEdit ? (
          <section
            className="panel"
            style={{ marginBottom: 28 }}
            aria-labelledby="new-quiz-heading"
          >
            <h2 id="new-quiz-heading" style={{ fontSize: "1.5rem" }}>
              Start a new checkpoint set
            </h2>
            <form className="toolbar" onSubmit={createQuiz}>
              <label className="field" style={{ flex: "1 1 280px", marginBottom: 0 }}>
                <span>Checkpoint set title</span>
                <input
                  className="input"
                  disabled={loading || !creator}
                  maxLength={160}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Friday knowledge check"
                  required
                  value={title}
                />
              </label>
              <button
                className="button"
                disabled={loading || !creator}
                style={{ alignSelf: "end" }}
                type="submit"
              >
                Create checkpoint set
              </button>
            </form>
          </section>
        ) : creator ? (
          <p className="notice">Viewer access is read-only for checkpoint sets and reports.</p>
        ) : null}
        {canEdit && entitlements ? (
          <CheckpointSetImport
            enabled={entitlements.csvExport}
            onImported={() => refresh(showArchived)}
            onUpgrade={() => void upgrade()}
          />
        ) : null}
        {creator ? <AuthoringAssistant canEdit={canEdit} /> : null}
        <p>
          <Link className="button-quiet small-button" href="/library/folders?type=rounds">
            Manage Round folders
          </Link>
        </p>
        <section className="library-controls" aria-label="Checkpoint-set library filters">
          <label className="field library-search">
            <span>Search checkpoint sets</span>
            <input
              className="input"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by title or description"
              type="search"
              value={search}
            />
          </label>
          <label className="field library-folder-filter">
            <span>Folder</span>
            <select
              className="select"
              onChange={(event) => setFolderFilter(event.target.value)}
              value={folderFilter}
            >
              <option value="all">All folders</option>
              <option value="unfiled">Unfiled</option>
              {getFolderOptions(folders).map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.label}
                </option>
              ))}
            </select>
          </label>
          <label className="checkbox-field">
            <input
              checked={showArchived}
              onChange={(event) => setShowArchived(event.target.checked)}
              type="checkbox"
            />
            Include archived sets
          </label>
        </section>
        {loading ? <p>Loading checkpoint sets…</p> : null}
        {!loading && visibleQuizzes.length === 0 ? (
          <section className="panel">
            <h2 style={{ fontSize: "1.6rem" }}>
              {quizzes.length === 0 ? "Your first round starts here." : "No checkpoint sets match."}
            </h2>
            <p className="muted">
              {quizzes.length === 0 && canEdit
                ? "Create a set above, add a few focused checkpoints, and publish it when it is ready."
                : quizzes.length === 0
                  ? "No checkpoint sets have been shared in this workspace yet."
                  : "Try a different search or include archived sets."}
            </p>
          </section>
        ) : null}
        <section className="quiz-grid" aria-label="Checkpoint-set library">
          {visibleQuizzes.map((quiz) => (
            <article className="card quiz-card" key={quiz.id}>
              <div>
                <span className="status-pill">{quiz.status}</span>
              </div>
              <h2 style={{ fontSize: "1.65rem", marginTop: 18 }}>{quiz.title}</h2>
              {quiz.folderId || quiz.tags.length ? (
                <div className="library-metadata">
                  {quiz.folderId ? (
                    <span className="folder-label">
                      {folderPathLabel(folders, quiz.folderId) ?? "Folder"}
                    </span>
                  ) : null}
                  {quiz.tags.map((tag) => (
                    <span className="tag-label" key={tag}>
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}
              <p>
                {quiz.draft.questions.length} checkpoint
                {quiz.draft.questions.length === 1 ? "" : "s"}
              </p>
              <div className="button-row">
                {quiz.status !== "archived" && canEdit ? (
                  <Link className="button-quiet small-button" href={`/quiz/${quiz.id}`}>
                    Edit
                  </Link>
                ) : null}
                {!canEdit && quiz.status !== "archived" ? (
                  <Link className="button-quiet small-button" href={`/quiz/${quiz.id}/preview`}>
                    View
                  </Link>
                ) : null}
                {canEdit && quiz.currentVersionId && quiz.status !== "archived" ? (
                  <button
                    className="button small-button"
                    disabled={busyId === quiz.id || !entitlements}
                    onClick={() => void host(quiz.id)}
                    type="button"
                  >
                    Host
                  </button>
                ) : null}
                {canEdit ? (
                  <button
                    className="button-quiet small-button"
                    disabled={busyId === quiz.id}
                    onClick={() => void duplicate(quiz.id)}
                    type="button"
                  >
                    Duplicate
                  </button>
                ) : null}
                {canEdit ? (
                  <button
                    className="button-quiet small-button"
                    onClick={() => beginOrganizing(quiz)}
                    type="button"
                  >
                    Organize
                  </button>
                ) : null}
                {canEdit ? (
                  quiz.status === "archived" ? (
                    <button
                      className="button-quiet small-button"
                      disabled={busyId === quiz.id}
                      onClick={() => void setArchived(quiz.id, false)}
                      type="button"
                    >
                      Restore
                    </button>
                  ) : (
                    <button
                      className="danger-link"
                      disabled={busyId === quiz.id}
                      onClick={() => void setArchived(quiz.id, true)}
                      type="button"
                    >
                      Archive
                    </button>
                  )
                ) : null}
                {entitlements?.csvExport ? (
                  <button
                    className="button-quiet small-button"
                    disabled={busyId === quiz.id}
                    onClick={() => void downloadCheckpointSet(quiz.id, "json")}
                    type="button"
                  >
                    Export JSON
                  </button>
                ) : null}
                {entitlements?.csvExport ? (
                  <button
                    className="button-quiet small-button"
                    disabled={busyId === quiz.id}
                    onClick={() => void downloadCheckpointSet(quiz.id, "csv")}
                    type="button"
                  >
                    Export CSV
                  </button>
                ) : null}
                {entitlements?.csvExport ? (
                  <button
                    className="button-quiet small-button"
                    disabled={busyId === quiz.id}
                    onClick={() => void downloadCheckpointSet(quiz.id, "qti.zip")}
                    type="button"
                  >
                    Export QTI 3
                  </button>
                ) : null}
              </div>
              {organizingId === quiz.id ? (
                <form
                  className="quiz-organization"
                  onSubmit={(event) => void saveOrganization(event, quiz.id)}
                >
                  <label className="field">
                    <span>Folder</span>
                    <select
                      className="select"
                      onChange={(event) => setOrganizationFolderId(event.target.value)}
                      value={organizationFolderId}
                    >
                      <option value="">Unfiled</option>
                      {getFolderOptions(folders).map((folder) => (
                        <option key={folder.id} value={folder.id}>
                          {folder.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Tags, separated by commas</span>
                    <input
                      className="input"
                      onChange={(event) => setOrganizationTags(event.target.value)}
                      placeholder="onboarding, safety"
                      value={organizationTags}
                    />
                  </label>
                  <div className="button-row">
                    <button className="button small-button" type="submit">
                      Save organization
                    </button>
                    <button
                      className="button-quiet small-button"
                      onClick={() => setOrganizingId("")}
                      type="button"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : null}
            </article>
          ))}
        </section>
      </main>
    </>
  );
}

function BetaDashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { creator, entitlements, productFeatures, canEdit, startUpgrade } = useWorkspace();
  const [quizzes, setQuizzes] = useState<QuizRecord[]>([]);
  const [folders, setFolders] = useState<FolderRecord[]>([]);
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
  const [folderFilter, setFolderFilter] = useState("all");
  const [organizingId, setOrganizingId] = useState("");
  const [organizationFolderId, setOrganizationFolderId] = useState("");
  const [organizationTags, setOrganizationTags] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [libraryViewState, setLibraryViewState] = useState<{
    workspaceId: string;
    view: RoundLibraryView;
  }>({ workspaceId: "", view: DEFAULT_ROUND_LIBRARY_VIEW });

  const workspaceId = creator?.workspaceId ?? "";
  const libraryView =
    libraryViewState.workspaceId === workspaceId
      ? libraryViewState.view
      : DEFAULT_ROUND_LIBRARY_VIEW;

  const refresh = useCallback(
    async (includeArchived: boolean) => {
      try {
        const [list, folderList] = await Promise.all([
          apiFetch<{ quizzes: QuizRecord[] }>(
            `/v1/quizzes${includeArchived ? "?archived=true" : ""}`,
          ),
          apiFetch<{ folders: FolderRecord[] }>("/v1/folders?artifactType=round"),
        ]);
        setQuizzes(list.quizzes);
        setFolders(folderList.folders.filter((folder) => folder.artifactType === "round"));
      } catch (caught) {
        if ((caught as { status?: number }).status === 401) router.replace("/signin");
        else setError(humanError(caught));
      } finally {
        setLoading(false);
      }
    },
    [router],
  );

  useEffect(() => {
    setLoading(true);
    void refresh(showArchived);
  }, [refresh, showArchived]);

  useEffect(() => {
    if (!workspaceId) return;
    setLibraryViewState({
      workspaceId,
      view: readRoundLibraryView(window.localStorage, workspaceId),
    });
  }, [workspaceId]);

  useEffect(() => {
    setSearch(searchParams.get("q") ?? "");
  }, [searchParams]);

  function setLibraryView(view: RoundLibraryView) {
    if (!workspaceId) return;
    setLibraryViewState({ workspaceId, view });
    writeRoundLibraryView(window.localStorage, workspaceId, view);
  }

  async function duplicate(quizId: string) {
    setBusyId(quizId);
    setError("");
    try {
      await apiFetch(`/v1/quizzes/${quizId}/duplicate`, { method: "POST", body: "{}" });
      await refresh(showArchived);
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusyId("");
    }
  }

  async function setArchived(quizId: string, archived: boolean) {
    setBusyId(quizId);
    setError("");
    try {
      await apiFetch(`/v1/quizzes/${quizId}/archive`, {
        method: "POST",
        body: JSON.stringify({ archived }),
      });
      await refresh(showArchived);
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusyId("");
    }
  }

  function beginOrganizing(quiz: QuizRecord) {
    setOrganizingId(quiz.id);
    setOrganizationFolderId(quiz.folderId ?? "");
    setOrganizationTags(quiz.tags.join(", "));
  }

  async function saveOrganization(event: FormEvent, quizId: string) {
    event.preventDefault();
    setBusyId(quizId);
    setError("");
    try {
      await apiFetch(`/v1/quizzes/${quizId}/organization`, {
        method: "PATCH",
        body: JSON.stringify({
          folderId: organizationFolderId || null,
          tags: organizationTags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
        }),
      });
      setOrganizingId("");
      await refresh(showArchived);
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusyId("");
    }
  }

  async function downloadRound(quizId: string, format: "json" | "csv" | "qti.zip") {
    setBusyId(quizId);
    setError("");
    try {
      const response = await fetch(`${API_URL}/v1/quizzes/${quizId}/export.${format}`, {
        credentials: "include",
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? `Export failed (${response.status}).`);
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `polling-pops-round-${quizId}.${format}`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusyId("");
    }
  }

  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visibleQuizzes = quizzes.filter(
    (quiz) =>
      (folderFilter === "all" ||
        (folderFilter === "unfiled" ? !quiz.folderId : quiz.folderId === folderFilter)) &&
      (!normalizedSearch ||
        quiz.title.toLocaleLowerCase().includes(normalizedSearch) ||
        quiz.description.toLocaleLowerCase().includes(normalizedSearch) ||
        quiz.tags.some((tag) => tag.toLocaleLowerCase().includes(normalizedSearch))),
  );
  const publishedQuizCount = quizzes.filter((quiz) => quiz.status === "published").length;
  const queryMessage = dashboardMessage(new URLSearchParams(searchParams.toString()));

  return (
    <WorkspaceShell
      description="Create, rehearse, and host reusable checks that make the next learning action clear."
      requireBeta={false}
      title="Rounds"
    >
      {queryMessage ? (
        <p className="success" role="status">
          {queryMessage}
        </p>
      ) : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {entitlements && entitlements.maxPublishedQuizzes !== null ? (
        <div className={styles.planNotice}>
          <span>
            <strong>
              {publishedQuizCount} of {entitlements.maxPublishedQuizzes}
            </strong>{" "}
            published Round slots used. Drafts and archived Rounds do not use a slot.
          </span>
          {creator?.plan === "free" ? (
            <button
              className={styles.inlineButton}
              onClick={() => void startUpgrade().catch((caught) => setError(humanError(caught)))}
              type="button"
            >
              Explore Pro
            </button>
          ) : null}
        </div>
      ) : null}
      {!canEdit && creator ? (
        <p className="notice">Viewer access is read-only for Rounds and results.</p>
      ) : null}

      <section className={styles.libraryToolbar} aria-label="Round library filters">
        <label className="field">
          <span>Search Rounds</span>
          <input
            className="input"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search title, description, or tag"
            type="search"
            value={search}
          />
        </label>
        <label className="field">
          <span>Folder</span>
          <select
            className="select"
            onChange={(event) => setFolderFilter(event.target.value)}
            value={folderFilter}
          >
            <option value="all">All folders</option>
            <option value="unfiled">Unfiled</option>
            {getFolderOptions(folders).map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.label}
              </option>
            ))}
          </select>
        </label>
        <div className={styles.libraryDisplayControls}>
          <label className={styles.archivedToggle}>
            <input
              checked={showArchived}
              onChange={(event) => setShowArchived(event.target.checked)}
              type="checkbox"
            />
            Include archived
          </label>
          <RoundLibraryViewToggle onChange={setLibraryView} value={libraryView} />
        </div>
      </section>

      <p>
        <Link className="button-quiet small-button" href="/library/folders?type=rounds">
          Manage Round folders
        </Link>
      </p>

      {loading ? <p className={styles.muted}>Loading Rounds…</p> : null}
      {!loading && visibleQuizzes.length === 0 ? (
        <div className={styles.emptyState}>
          <h2>{quizzes.length === 0 ? "Your first Round starts here" : "No Rounds match"}</h2>
          <p>
            {quizzes.length === 0 && canEdit
              ? "Use a starter, trusted source, import, or blank canvas to create it."
              : quizzes.length === 0
                ? "No Rounds have been shared in this workspace yet."
                : "Try a different search, folder, or include archived Rounds."}
          </p>
          {canEdit ? (
            <Link className="button" href="/create">
              Create a Round
            </Link>
          ) : null}
        </div>
      ) : null}

      <section
        className={libraryView === "grid" ? styles.roundGrid : styles.roundList}
        aria-label="Round library"
        data-view={libraryView}
      >
        {visibleQuizzes.map((quiz) => {
          const archived = quiz.status === "archived";
          const canHost = canEdit && Boolean(quiz.currentVersionId) && !archived;
          const canAssign =
            canEdit &&
            quiz.status === "published" &&
            Boolean(quiz.currentVersionId) &&
            productFeatures?.practiceAssignments === true;
          return (
            <article className={`${styles.roundCard} ${styles.betaRoundCard}`} key={quiz.id}>
              <div className={styles.cardTopline}>
                <span
                  className={styles.status}
                  data-tone={quiz.status === "published" ? "ready" : quiz.status}
                >
                  {quiz.status}
                </span>
                <span className={styles.updatedAt}>
                  Updated {new Date(quiz.updatedAt).toLocaleDateString("en-CA")}
                </span>
              </div>
              <div className={styles.roundMain}>
                <h2>{quiz.title}</h2>
                {quiz.description ? (
                  <p className={styles.roundDescription}>{quiz.description}</p>
                ) : null}
                {quiz.folderId || quiz.tags.length ? (
                  <div className={styles.conceptList}>
                    {quiz.folderId ? (
                      <span className={styles.subtlePill}>
                        {folderPathLabel(folders, quiz.folderId) ?? "Folder"}
                      </span>
                    ) : null}
                    {quiz.tags.map((tag) => (
                      <span className={styles.subtlePill} key={tag}>
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className={styles.roundFacts}>
                  <p className={styles.questionCount}>
                    {quiz.draft.questions.length} question
                    {quiz.draft.questions.length === 1 ? "" : "s"}
                  </p>
                  <p className={styles.lastHosted}>
                    {quiz.lastHostedAt ? (
                      <time dateTime={quiz.lastHostedAt}>
                        Last hosted {new Date(quiz.lastHostedAt).toLocaleDateString("en-CA")}
                      </time>
                    ) : (
                      "Not hosted yet"
                    )}
                  </p>
                </div>
              </div>
              <div className={styles.primaryActions}>
                {canHost ? (
                  <Link className="button small-button" href={`/host/setup/${quiz.id}`}>
                    Host live
                  </Link>
                ) : null}
                {canAssign ? (
                  <Link className="button-quiet small-button" href={`/quiz/${quiz.id}/assign`}>
                    Assign practice
                  </Link>
                ) : null}
                {!archived ? (
                  <Link
                    className="button-quiet small-button"
                    href={canEdit ? `/quiz/${quiz.id}` : `/quiz/${quiz.id}/preview`}
                  >
                    {canEdit ? "Edit" : "View"}
                  </Link>
                ) : null}
                {!archived && productFeatures?.recoveryRehearsal && !canAssign ? (
                  <Link className="button-quiet small-button" href={`/quiz/${quiz.id}/rehearse`}>
                    Rehearse
                  </Link>
                ) : null}
                <details className={styles.moreMenu}>
                  <summary>More</summary>
                  <div className={styles.moreMenuPanel}>
                    <Link href={`/quiz/${quiz.id}/preview`}>Preview</Link>
                    {canAssign && productFeatures?.recoveryRehearsal ? (
                      <Link href={`/quiz/${quiz.id}/rehearse`}>Rehearse</Link>
                    ) : null}
                    {!archived && productFeatures?.recoveryRehearsal ? (
                      <Link href={`/quiz/${quiz.id}/research`}>Research prototype lab</Link>
                    ) : null}
                    {canEdit ? (
                      <button
                        disabled={busyId === quiz.id}
                        onClick={() => void duplicate(quiz.id)}
                        type="button"
                      >
                        Duplicate
                      </button>
                    ) : null}
                    {canEdit ? (
                      <button onClick={() => beginOrganizing(quiz)} type="button">
                        Organize
                      </button>
                    ) : null}
                    {entitlements?.csvExport ? (
                      <>
                        <button onClick={() => void downloadRound(quiz.id, "json")} type="button">
                          Export JSON
                        </button>
                        <button onClick={() => void downloadRound(quiz.id, "csv")} type="button">
                          Export CSV
                        </button>
                        <button
                          onClick={() => void downloadRound(quiz.id, "qti.zip")}
                          type="button"
                        >
                          Export QTI 3
                        </button>
                      </>
                    ) : null}
                    {canEdit ? (
                      <button
                        className={styles.dangerAction}
                        disabled={busyId === quiz.id}
                        onClick={() => void setArchived(quiz.id, !archived)}
                        type="button"
                      >
                        {archived ? "Restore" : "Archive"}
                      </button>
                    ) : null}
                  </div>
                </details>
              </div>
              {organizingId === quiz.id ? (
                <form
                  className={styles.organizationForm}
                  onSubmit={(event) => void saveOrganization(event, quiz.id)}
                >
                  <label className="field">
                    <span>Folder</span>
                    <select
                      className="select"
                      onChange={(event) => setOrganizationFolderId(event.target.value)}
                      value={organizationFolderId}
                    >
                      <option value="">Unfiled</option>
                      {getFolderOptions(folders).map((folder) => (
                        <option key={folder.id} value={folder.id}>
                          {folder.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Tags, separated by commas</span>
                    <input
                      className="input"
                      onChange={(event) => setOrganizationTags(event.target.value)}
                      placeholder="onboarding, safety"
                      value={organizationTags}
                    />
                  </label>
                  <div className={styles.listCardActions}>
                    <button className="button small-button" type="submit">
                      Save organization
                    </button>
                    <button
                      className="button-quiet small-button"
                      onClick={() => setOrganizingId("")}
                      type="button"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : null}
            </article>
          );
        })}
      </section>
    </WorkspaceShell>
  );
}

function DashboardGate() {
  const { loading, productFeatures } = useWorkspace();
  if (loading) return <p className={styles.dashboardLoading}>Loading your workspace…</p>;
  if (!productFeatures?.uxBeta || !productFeatures.workspaceShell) return <LegacyDashboardPage />;
  return <BetaDashboard />;
}

export default function DashboardPage() {
  return (
    <WorkspaceProvider>
      <DashboardGate />
    </WorkspaceProvider>
  );
}
