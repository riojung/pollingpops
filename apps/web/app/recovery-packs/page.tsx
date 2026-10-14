"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  RecoveryPackContentSchema,
  RecoveryPackDraftSchema,
  RecoveryPackJsonSchema,
  type RecoveryPackDraft,
  type QuizDraft,
} from "@openround/contracts";
import { WorkspaceShell } from "../../components/workspace/workspace-shell";
import { WorkspaceProvider, useWorkspace } from "../../components/workspace/workspace-provider";
import { ApiClientError, apiFetch, humanError } from "../../lib/api";
import {
  conceptKeysFromText,
  recoveryPackDraftFromPair,
  recoveryPackPairs,
  recoveryPackRoundHref,
  recoveryPackTargetId,
} from "../../lib/recovery-packs";
import { clientUuid } from "../../lib/uuid";
import { PackPracticeAction } from "../../components/practice/pack-practice-action";
import type { PublishedPracticePack } from "../../lib/recovery-pack-practice";
import { RecoveryPackExportPanel } from "../../components/recovery-pack-export";
import { AuthoringAssistant } from "../../components/authoring-assistant";
import {
  PackSourceCitations,
  RecoveryPackSourceReviewPanel,
} from "../../components/recovery-pack-source";
import {
  createRecoveryPackSourceApproval,
  newRecoveryPackInterventionCard,
  recoveryPackSourceApproved,
  type RecoveryPackRecord as PackRecord,
} from "../../lib/recovery-pack-source";
import styles from "./recovery-packs.module.css";

interface RoundRecord {
  id: string;
  title: string;
  status: "draft" | "published" | "archived";
  draft: QuizDraft;
  draftRevision: number;
  currentVersionId: string | null;
}
interface HistoryEntry {
  revision: number;
  draft: RecoveryPackDraft;
  createdAt: string;
}
interface RetryMutation {
  key: string;
  body: string;
}

function validationMessage(result: ReturnType<typeof RecoveryPackContentSchema.safeParse>) {
  return result.success
    ? ""
    : result.error.issues
        .map((issue) => `${issue.path.join(".") || "Pack"}: ${issue.message}`)
        .slice(0, 8)
        .join("; ");
}

export default function RecoveryPacksPage() {
  return (
    <WorkspaceProvider>
      <RecoveryPacksWorkspace />
    </WorkspaceProvider>
  );
}

function RecoveryPacksWorkspace() {
  const { creator } = useWorkspace();
  return creator ? (
    <PackLibrary key={creator.workspaceId} />
  ) : (
    <WorkspaceShell title="Recovery Packs" requireBeta={false}>
      <p role="status">Loading workspace…</p>
    </WorkspaceShell>
  );
}

function PackLibrary() {
  const { canEdit, productFeatures, entitlements } = useWorkspace();
  const enabled = Boolean(productFeatures?.recoveryPacks);
  const writable = canEdit && enabled;
  const [packs, setPacks] = useState<PackRecord[]>([]);
  const [rounds, setRounds] = useState<RoundRecord[]>([]);
  const [selected, setSelected] = useState<PackRecord | null>(null);
  const [publishedPracticePack, setPublishedPracticePack] = useState<
    (PublishedPracticePack & { contentHash: string }) | null
  >(null);
  const [practiceSourceLoading, setPracticeSourceLoading] = useState(false);
  const [practiceSourceError, setPracticeSourceError] = useState("");
  const [publishedSourceRefresh, setPublishedSourceRefresh] = useState(0);
  const [draft, setDraft] = useState<RecoveryPackDraft | null>(null);
  const [concepts, setConcepts] = useState("");
  const [misconceptions, setMisconceptions] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [sourceVersion, setSourceVersion] = useState<{
    roundId: string;
    title: string;
    content: QuizDraft;
  } | null>(null);
  const [sourceQuestionId, setSourceQuestionId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyRevision, setHistoryRevision] = useState("");
  const [importJson, setImportJson] = useState("");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [contentChecked, setContentChecked] = useState(false);
  const [citationsChecked, setCitationsChecked] = useState(false);
  const [sourceReviewInvalidated, setSourceReviewInvalidated] = useState(false);
  const reviewApproval = useRef<ReturnType<typeof createRecoveryPackSourceApproval> | null>(null);
  const writableRef = useRef(writable);
  writableRef.current = writable;
  const errorParagraph = useRef<HTMLParagraphElement>(null);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const alive = useRef(true);
  const running = useRef(false);
  const sourceCreationRunning = useRef(false);
  const retrySave = useRef<RetryMutation | null>(null);
  const retryInsert = useRef<RetryMutation | null>(null);
  const retryRestore = useRef<RetryMutation | null>(null);

  useEffect(() => {
    alive.current = true;
    const abort = new AbortController();
    void Promise.all([
      apiFetch<{ packs: PackRecord[] }>("/v1/recovery-packs", { signal: abort.signal }),
      apiFetch<{ quizzes: RoundRecord[] }>("/v1/quizzes", { signal: abort.signal }),
    ])
      .then(([packResult, roundResult]) => {
        if (!alive.current) return;
        setPacks(packResult.packs);
        setRounds(roundResult.quizzes);
      })
      .catch((caught) => {
        if (alive.current && !abort.signal.aborted) setError(humanError(caught));
      })
      .finally(() => {
        if (alive.current) setLoading(false);
      });
    return () => {
      alive.current = false;
      abort.abort();
      reviewApproval.current?.cancel();
    };
  }, []);

  useEffect(() => {
    setSourceVersion(null);
    setSourceQuestionId("");
    if (!sourceId) return;
    const abort = new AbortController();
    void apiFetch<{ quiz: RoundRecord; currentVersion: { content: QuizDraft } | null }>(
      `/v1/quizzes/${sourceId}`,
      { signal: abort.signal },
    )
      .then((result) => {
        if (!abort.signal.aborted && alive.current && result.currentVersion) {
          setSourceVersion({
            roundId: sourceId,
            title: result.quiz.title,
            content: result.currentVersion.content,
          });
        }
      })
      .catch((caught) => {
        if (!abort.signal.aborted && alive.current) setError(humanError(caught));
      });
    return () => abort.abort();
  }, [sourceId]);

  useEffect(() => {
    setPublishedPracticePack(null);
    setPracticeSourceError("");
    const versionId = selected?.currentVersionId;
    const selectedPackId = selected?.id;
    if (!versionId || !selectedPackId) {
      setPracticeSourceLoading(false);
      return;
    }
    const abort = new AbortController();
    setPracticeSourceLoading(true);
    void apiFetch<{ version: PublishedPracticePack & { contentHash: string } }>(
      `/v1/recovery-packs/versions/${encodeURIComponent(versionId)}`,
      { signal: abort.signal },
    )
      .then(({ version }) => {
        if (abort.signal.aborted) return;
        if (version.id !== versionId || version.packId !== selectedPackId)
          throw new Error(
            "The published Pack changed. Reload its saved source before export review or practice.",
          );
        setPublishedPracticePack(version);
      })
      .catch((caught) => {
        if (!abort.signal.aborted) setPracticeSourceError(humanError(caught));
      })
      .finally(() => {
        if (!abort.signal.aborted) setPracticeSourceLoading(false);
      });
    return () => abort.abort();
  }, [selected?.id, selected?.currentVersionId, publishedSourceRefresh]);

  useEffect(() => {
    if (error) errorParagraph.current?.focus();
  }, [error]);

  useEffect(() => {
    if (!writable) resetSourceReview();
  }, [writable]);

  function resetSourceReview() {
    setContentChecked(false);
    setCitationsChecked(false);
    reviewApproval.current?.cancel();
    reviewApproval.current = null;
  }

  function invalidateSourceReview() {
    resetSourceReview();
    if (selected?.sourceReview) setSourceReviewInvalidated(true);
  }

  function adopt(pack: PackRecord) {
    resetSourceReview();
    setSourceReviewInvalidated(false);
    setSelected(pack);
    setDraft(structuredClone(pack.draft));
    setConcepts(pack.draft.conceptKeys.join(", "));
    setMisconceptions(pack.draft.misconceptionKeys.join(", "));
    setHistory([]);
    setHistoryRevision("");
    setPacks((current) => [pack, ...current.filter((item) => item.id !== pack.id)]);
  }

  function preparedDraft() {
    if (!draft) return null;
    const conceptKeys = conceptKeysFromText(concepts);
    const conceptsChanged = selected && concepts !== selected.draft.conceptKeys.join(", ");
    return {
      ...draft,
      conceptKeys,
      misconceptionKeys: conceptKeysFromText(misconceptions),
      diagnostic: conceptsChanged ? { ...draft.diagnostic, conceptKeys } : draft.diagnostic,
      recheck: conceptsChanged ? { ...draft.recheck, conceptKeys } : draft.recheck,
      delayedProbe:
        conceptsChanged && draft.delayedProbe
          ? { ...draft.delayedProbe, conceptKeys }
          : draft.delayedProbe,
    };
  }

  const editedDraft = preparedDraft();
  const dirty = Boolean(
    selected && editedDraft && JSON.stringify(editedDraft) !== JSON.stringify(selected.draft),
  );
  const publishError = editedDraft
    ? validationMessage(RecoveryPackContentSchema.safeParse(editedDraft))
    : "";
  const currentSource = sourceVersion?.roundId === sourceId ? sourceVersion : null;
  const pairs = currentSource ? recoveryPackPairs(currentSource.content.questions) : [];
  const targetHref = recoveryPackRoundHref(targetId);

  async function run(label: string, action: () => Promise<string | void>) {
    if (running.current) return;
    running.current = true;
    setBusy(label);
    setError("");
    setAnnouncement("");
    try {
      const message = await action();
      if (alive.current && message) setAnnouncement(message);
    } catch (caught) {
      if (alive.current) setError(humanError(caught));
      if (caught instanceof ApiClientError && caught.status === 409) {
        retrySave.current = null;
        retryInsert.current = null;
        retryRestore.current = null;
        resetSourceReview();
      }
    } finally {
      running.current = false;
      if (alive.current) setBusy("");
    }
  }

  function choose(pack: PackRecord) {
    if (dirty && !window.confirm("Discard unsaved Pack changes?")) return;
    retrySave.current = null;
    retryRestore.current = null;
    adopt(pack);
    setError("");
    setAnnouncement("");
  }

  async function save() {
    if (!selected || !editedDraft || !writable) return;
    const parsed = RecoveryPackDraftSchema.safeParse(editedDraft);
    if (!parsed.success)
      throw new Error(
        parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      );
    const key = `${selected.id}:${JSON.stringify(parsed.data)}`;
    if (retrySave.current?.key !== key)
      retrySave.current = {
        key,
        body: JSON.stringify({
          draft: parsed.data,
          expectedRevision: selected.draftRevision,
          mutationId: clientUuid(),
        }),
      };
    const result = await apiFetch<{ pack: PackRecord }>(`/v1/recovery-packs/${selected.id}/draft`, {
      method: "PUT",
      body: retrySave.current.body,
    });
    retrySave.current = null;
    if (alive.current) adopt(result.pack);
    return "Draft saved. Published versions are unchanged.";
  }

  async function approveSource() {
    if (!selected?.sourceReview || !writable || dirty || !contentChecked || !citationsChecked)
      return;
    reviewApproval.current ??= createRecoveryPackSourceApproval({
      pack: selected,
      canApprove: () => alive.current && writableRef.current,
    });
    const pack = await reviewApproval.current.approve();
    if (pack && alive.current) {
      adopt(pack);
      return "Saved Pack content and citations approved. Publish the saved draft separately when ready.";
    }
  }

  async function insert() {
    if (!selected?.currentVersionId || !targetId || !writable) return;
    const key = `${selected.currentVersionId}:${targetId}`;
    if (retryInsert.current?.key !== key) {
      const latest = await apiFetch<{ quiz: RoundRecord }>(
        `/v1/quizzes/${encodeURIComponent(targetId)}`,
      );
      if (!alive.current) return;
      retryInsert.current = {
        key,
        body: JSON.stringify({
          packVersionId: selected.currentVersionId,
          quizId: targetId,
          expectedRevision: latest.quiz.draftRevision,
          mutationId: clientUuid(),
        }),
      };
    }
    const result = await apiFetch<{ quiz: RoundRecord }>("/v1/recovery-packs/insert", {
      method: "POST",
      body: retryInsert.current.body,
    });
    retryInsert.current = null;
    if (alive.current)
      setRounds((current) =>
        current.map((round) => (round.id === result.quiz.id ? result.quiz : round)),
      );
    return "Published Pack inserted into the Round draft. Review and publish the Round separately.";
  }

  function download(data: unknown, title: string) {
    if (!alive.current) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${title.replace(/[^a-zA-Z0-9_-]+/g, "-") || "recovery-pack"}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <WorkspaceShell
      title="Recovery Packs"
      requireBeta={false}
      eyebrow="Reusable recovery"
      description="A diagnostic, facilitator intervention cards, and a different linked recheck."
      actions={
        <Link className="button-quiet" href="/library">
          Back to Library
        </Link>
      }
    >
      <div lang="en-CA" className={styles.page}>
        <p className="notice">
          With Pack authoring enabled, insert published Packs into Round or Presentation drafts and
          review updates against the accepted baseline, local checkpoints, and latest published
          Pack. References stay frozen until you accept an update; existing published content and
          sessions are unchanged. Live explanation or worked-example playback is available in
          eligible new Round or Presentation sessions when enabled for the workspace. The
          facilitator explicitly selects a card after revealing the Pack diagnostic. Standalone
          delayed-probe practice is available from a published Pack with a delayed probe when Pack
          authoring and practice assignments are enabled and the workspace has Pro follow-ups.
          Full-sequence practice uses the frozen diagnostic, intervention cards, and linked recheck
          under the same gates, without requiring a delayed probe. Delayed recovery trails and
          Companion insertion are not available.
        </p>
        {!enabled ? (
          <p className="notice">
            Pack authoring is not enabled for this workspace. Existing Packs remain readable and
            exportable.
          </p>
        ) : null}
        {!canEdit ? (
          <p className="notice">Your workspace role can view Packs but cannot modify them.</p>
        ) : null}
        {error ? (
          <p className="error" role="alert" tabIndex={-1} ref={errorParagraph}>
            {error}
          </p>
        ) : null}
        <p className={styles.status} role="status" aria-live="polite">
          {busy ? `${busy}…` : announcement}
        </p>
        {loading ? <p role="status">Loading Packs…</p> : null}
        <div className={styles.layout}>
          <section className={styles.panel} aria-labelledby="pack-list-title">
            <h2 id="pack-list-title">Your Packs</h2>
            {!loading && !packs.length ? (
              <p className="muted">
                No Packs yet. Start from a published diagnostic and linked recheck, or import an
                Polling Pops Pack.
              </p>
            ) : null}
            <ul className={styles.list}>
              {packs.map((pack) => (
                <li key={pack.id}>
                  <button
                    className={styles.packButton}
                    type="button"
                    aria-pressed={selected?.id === pack.id}
                    disabled={Boolean(busy)}
                    onClick={() => choose(pack)}
                  >
                    <strong>{pack.title || "Untitled Pack"}</strong>
                    <span>
                      {pack.currentVersionId ? "Published" : "Draft"} · revision{" "}
                      {pack.draftRevision}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {writable ? (
              <>
                <AuthoringAssistant
                  canEdit={writable}
                  artifactType="recovery_pack"
                  recoveryPackTarget={{
                    disabled: Boolean(busy),
                    beforeCreate: () => {
                      if (running.current || !writableRef.current) return false;
                      if (dirty && !window.confirm("Discard unsaved Pack changes?")) return false;
                      running.current = true;
                      sourceCreationRunning.current = true;
                      setBusy("Creating source Pack draft");
                      setError("");
                      setAnnouncement("");
                      return true;
                    },
                    onCreated: (pack) => {
                      if (!alive.current || !writableRef.current) return;
                      retrySave.current = null;
                      retryRestore.current = null;
                      adopt(pack);
                      setAnnouncement(
                        "Source Pack created as an unpublished draft. Review and approve its saved content and citations before publishing.",
                      );
                      detailHeading.current?.focus();
                    },
                    onBusyChange: (isBusy) => {
                      if (!alive.current) return;
                      if (isBusy) setBusy("Creating source Pack draft");
                      else if (sourceCreationRunning.current) {
                        sourceCreationRunning.current = false;
                        running.current = false;
                        setBusy((current) =>
                          current === "Creating source Pack draft" ? "" : current,
                        );
                      }
                    },
                  }}
                />
                <h3>Create from published material</h3>
                <label className="field">
                  <span>Source Round</span>
                  <select
                    className="select"
                    value={sourceId}
                    disabled={Boolean(busy)}
                    onChange={(event) => {
                      setSourceId(event.target.value);
                    }}
                  >
                    <option value="">Choose a published Round</option>
                    {rounds
                      .filter((round) => round.currentVersionId)
                      .map((round) => (
                        <option key={round.id} value={round.id}>
                          {round.title}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="field">
                  <span>Diagnostic and linked recheck</span>
                  <select
                    className="select"
                    value={sourceQuestionId}
                    disabled={Boolean(busy) || !currentSource}
                    onChange={(event) => {
                      setSourceQuestionId(event.target.value);
                    }}
                  >
                    <option value="">Choose a checkpoint pair</option>
                    {pairs.map((pair) => (
                      <option key={pair.diagnostic.id} value={pair.diagnostic.id}>
                        {pair.diagnostic.prompt}
                      </option>
                    ))}
                  </select>
                </label>
                {currentSource && !pairs.length ? (
                  <p className="muted">
                    This published version has no scored, linked diagnostic/recheck pair. Add and
                    publish one in the Round builder first.
                  </p>
                ) : null}
                <button
                  className="button"
                  type="button"
                  disabled={
                    Boolean(busy) || !pairs.some((pair) => pair.diagnostic.id === sourceQuestionId)
                  }
                  onClick={() =>
                    void run("Creating Pack", async () => {
                      const pair = pairs.find(
                        (candidate) => candidate.diagnostic.id === sourceQuestionId,
                      );
                      if (!pair || !currentSource) return;
                      if (dirty && !window.confirm("Discard unsaved Pack changes?")) return;
                      const result = await apiFetch<{ pack: PackRecord }>("/v1/recovery-packs", {
                        method: "POST",
                        body: JSON.stringify({
                          draft: recoveryPackDraftFromPair(
                            currentSource.title,
                            pair.diagnostic,
                            pair.recheck,
                            clientUuid(),
                          ),
                        }),
                      });
                      if (alive.current) adopt(result.pack);
                      return "Pack draft created from the published version. Review its concepts and intervention before publishing.";
                    })
                  }
                >
                  Create Pack draft
                </button>
                <details className={styles.import}>
                  <summary>Import Polling Pops Pack JSON</summary>
                  <label className="field">
                    <span>Pack JSON</span>
                    <textarea
                      className="textarea"
                      value={importJson}
                      maxLength={1_000_000}
                      disabled={Boolean(busy)}
                      onChange={(event) => setImportJson(event.target.value)}
                    />
                  </label>
                  <p className="muted">
                    Media IDs are workspace-scoped references, not embedded files. Referenced media
                    must be accessible in this workspace.
                  </p>
                  <button
                    className="button-quiet"
                    type="button"
                    disabled={Boolean(busy) || !importJson.trim()}
                    onClick={() =>
                      void run("Importing Pack", async () => {
                        if (dirty && !window.confirm("Discard unsaved Pack changes?")) return;
                        const parsed = RecoveryPackJsonSchema.parse(JSON.parse(importJson));
                        const result = await apiFetch<{ pack: PackRecord }>(
                          "/v1/recovery-packs/import",
                          { method: "POST", body: JSON.stringify(parsed) },
                        );
                        if (alive.current) {
                          adopt(result.pack);
                          setImportJson("");
                        }
                        return "Pack imported as a draft; publishing still requires review.";
                      })
                    }
                  >
                    Import as draft
                  </button>
                </details>
              </>
            ) : null}
          </section>
          <section className={styles.panel} aria-labelledby="pack-detail-title">
            <h2 id="pack-detail-title" tabIndex={-1} ref={detailHeading}>
              {selected ? selected.title || "Untitled Pack" : "Select a Pack"}
            </h2>
            {selected && draft ? (
              <>
                <p className="muted">
                  Draft revision {selected.draftRevision}
                  {dirty ? " · unsaved changes" : " · saved"}
                  {selected.currentVersionId
                    ? " · a frozen published version is available"
                    : " · unpublished"}
                </p>
                <fieldset
                  className={styles.editor}
                  disabled={!writable || Boolean(busy)}
                  onChangeCapture={invalidateSourceReview}
                >
                  <legend className="sr-only">Pack draft</legend>
                  <label className="field">
                    <span>Title</span>
                    <input
                      className="input"
                      maxLength={160}
                      value={draft.title}
                      onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span>Description</span>
                    <textarea
                      className="textarea"
                      maxLength={1_000}
                      value={draft.description}
                      onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span>Shared concept keys (comma-separated)</span>
                    <input
                      className="input"
                      value={concepts}
                      onChange={(event) => setConcepts(event.target.value)}
                      aria-describedby="pack-concepts-help"
                    />
                  </label>
                  <p id="pack-concepts-help" className="muted">
                    These keys apply to every Pack checkpoint. Use meaningful letters, numbers,
                    dots, dashes, or underscores; at most 12 keys.
                  </p>
                  <label className="field">
                    <span>Misconception keys (comma-separated)</span>
                    <input
                      className="input"
                      value={misconceptions}
                      onChange={(event) => setMisconceptions(event.target.value)}
                    />
                  </label>
                  <CheckpointEditor
                    label="Diagnostic"
                    question={draft.diagnostic}
                    onChange={(diagnostic) => setDraft({ ...draft, diagnostic })}
                  />
                  <h3>Facilitator intervention cards</h3>
                  {draft.interventions.map((card, index) => (
                    <div className={styles.card} key={card.id}>
                      <label className="field">
                        <span>Card {index + 1} title</span>
                        <input
                          className="input"
                          value={card.title}
                          maxLength={160}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              interventions: draft.interventions.map((candidate) =>
                                candidate.id === card.id
                                  ? { ...candidate, title: event.target.value }
                                  : candidate,
                              ),
                            })
                          }
                        />
                      </label>
                      <label className="field">
                        <span>Card {index + 1} facilitator guidance</span>
                        <textarea
                          className="textarea"
                          value={card.body}
                          maxLength={2_000}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              interventions: draft.interventions.map((candidate) =>
                                candidate.id === card.id
                                  ? { ...candidate, body: event.target.value }
                                  : candidate,
                              ),
                            })
                          }
                        />
                      </label>
                      {card.citations.length ? (
                        <PackSourceCitations citations={card.citations} />
                      ) : null}
                      <button
                        className="button-quiet small-button"
                        type="button"
                        onClick={() => {
                          invalidateSourceReview();
                          setDraft({
                            ...draft,
                            interventions: draft.interventions.filter(
                              (candidate) => candidate.id !== card.id,
                            ),
                          });
                        }}
                      >
                        Remove card {index + 1}
                      </button>
                    </div>
                  ))}
                  <button
                    className="button-quiet"
                    type="button"
                    disabled={draft.interventions.length >= 5}
                    onClick={() => {
                      invalidateSourceReview();
                      setDraft({
                        ...draft,
                        interventions: [
                          ...draft.interventions,
                          newRecoveryPackInterventionCard(selected, clientUuid()),
                        ],
                      });
                    }}
                  >
                    Add intervention card
                  </button>
                  {selected.sourceReview ? (
                    <p className="muted">
                      New source cards inherit original Pack citations. Check that these spans
                      support your edited guidance before saving and approving.
                    </p>
                  ) : null}
                  <CheckpointEditor
                    label="Different linked recheck"
                    question={draft.recheck}
                    onChange={(recheck) => setDraft({ ...draft, recheck })}
                  />
                  {draft.delayedProbe ? (
                    <CheckpointEditor
                      label="Optional delayed probe"
                      question={draft.delayedProbe}
                      onChange={(delayedProbe) => setDraft({ ...draft, delayedProbe })}
                    />
                  ) : null}
                </fieldset>
                <details>
                  <summary>Source citations ({draft.citations.length})</summary>
                  <ul>
                    {draft.citations.map((citation, index) => (
                      <li key={index}>
                        <strong>{citation.sourceName}</strong> · {citation.locator}
                        <p>{citation.excerpt}</p>
                      </li>
                    ))}
                  </ul>
                </details>
                {selected.sourceReview && editedDraft ? (
                  <RecoveryPackSourceReviewPanel
                    pack={selected}
                    draft={editedDraft}
                    dirty={dirty}
                    invalidated={sourceReviewInvalidated}
                    canEdit={writable}
                    busy={Boolean(busy)}
                    contentChecked={contentChecked}
                    citationsChecked={citationsChecked}
                    onContentChecked={setContentChecked}
                    onCitationsChecked={setCitationsChecked}
                    onApprove={() =>
                      void run("Approving saved content and citations", approveSource)
                    }
                  />
                ) : null}
                {publishError ? <p className="notice">Before publishing: {publishError}</p> : null}
                <div className="button-row">
                  <button
                    className="button"
                    type="button"
                    disabled={!writable || Boolean(busy) || !dirty}
                    onClick={() => void run("Saving draft", save)}
                  >
                    Save draft
                  </button>
                  <button
                    className="button-quiet"
                    type="button"
                    disabled={
                      !writable ||
                      Boolean(busy) ||
                      dirty ||
                      Boolean(publishError) ||
                      Boolean(
                        selected.sourceReview &&
                        (sourceReviewInvalidated || !recoveryPackSourceApproved(selected)),
                      )
                    }
                    onClick={() =>
                      void run("Publishing Pack", async () => {
                        if (
                          !writableRef.current ||
                          dirty ||
                          (selected.sourceReview &&
                            (sourceReviewInvalidated || !recoveryPackSourceApproved(selected)))
                        )
                          return;
                        const result = await apiFetch<{ pack: PackRecord }>(
                          `/v1/recovery-packs/${selected.id}/publish`,
                          {
                            method: "POST",
                            body: JSON.stringify({ expectedDraftRevision: selected.draftRevision }),
                          },
                        );
                        if (alive.current) adopt(result.pack);
                        return "Pack published as an immutable version. Existing inserted copies are unchanged.";
                      })
                    }
                  >
                    Publish saved draft
                  </button>
                  <button
                    className="button-quiet"
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void run("Reloading Pack", async () => {
                        if (
                          dirty &&
                          !window.confirm("Discard unsaved changes and reload the saved draft?")
                        )
                          return;
                        const result = await apiFetch<{ pack: PackRecord }>(
                          `/v1/recovery-packs/${selected.id}`,
                        );
                        retrySave.current = null;
                        if (alive.current) adopt(result.pack);
                        return "Latest saved draft loaded.";
                      })
                    }
                  >
                    Reload saved draft
                  </button>
                </div>
                {selected.currentVersionId ? (
                  <section className={styles.subsection} aria-label="Published Pack actions">
                    <h3>Use the published version</h3>
                    <p className="muted">
                      Insertion and export use the frozen published version, not the draft above.
                      They do not update existing inserted copies.
                    </p>
                    <button
                      className="button-quiet"
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() =>
                        void run("Exporting Pack", async () => {
                          const data = await apiFetch<unknown>(
                            `/v1/recovery-packs/versions/${selected.currentVersionId}/export`,
                          );
                          download(data, selected.title);
                          return "Published Pack exported. Media references remain workspace-scoped.";
                        })
                      }
                    >
                      Export Polling Pops JSON
                    </button>
                    {practiceSourceLoading ? (
                      <p role="status">Loading the frozen published export source…</p>
                    ) : practiceSourceError ? (
                      <>
                        <p className="error" role="alert">
                          {practiceSourceError}
                        </p>
                        <button
                          className="button-quiet"
                          type="button"
                          disabled={Boolean(busy)}
                          onClick={() => setPublishedSourceRefresh((value) => value + 1)}
                        >
                          Retry published export source
                        </button>
                      </>
                    ) : null}
                    {publishedPracticePack?.id === selected.currentVersionId ? (
                      <RecoveryPackExportPanel
                        key={`${selected.id}:${publishedPracticePack.id}:${publishedPracticePack.contentHash}`}
                        source={{
                          artifactType: "recovery_pack",
                          packId: selected.id,
                          packVersionId: publishedPracticePack.id,
                          packVersion: publishedPracticePack.version,
                          contentHash: publishedPracticePack.contentHash,
                          title: publishedPracticePack.content.title,
                        }}
                        disabled={Boolean(busy)}
                      />
                    ) : null}
                    {writable ? (
                      <>
                        <label className="field">
                          <span>Destination Round draft</span>
                          <select
                            className="select"
                            value={targetId}
                            disabled={Boolean(busy)}
                            onChange={(event) => {
                              const candidate = recoveryPackTargetId(event.target.value);
                              setTargetId(
                                rounds.some(
                                  (round) => round.id === candidate && round.status !== "archived",
                                )
                                  ? candidate
                                  : "",
                              );
                              retryInsert.current = null;
                            }}
                          >
                            <option value="">Choose a Round</option>
                            {rounds
                              .filter((round) => round.status !== "archived")
                              .map((round) => (
                                <option key={round.id} value={round.id}>
                                  {round.title}
                                </option>
                              ))}
                          </select>
                        </label>
                        <button
                          className="button"
                          type="button"
                          disabled={Boolean(busy) || !targetId}
                          onClick={() => void run("Inserting Pack", insert)}
                        >
                          Insert into Round draft
                        </button>
                        {targetHref ? (
                          <Link className={styles.builderLink} href={targetHref}>
                            Open destination Round builder
                          </Link>
                        ) : null}
                      </>
                    ) : null}
                  </section>
                ) : null}
                <PackPracticeAction
                  packId={selected.id}
                  version={
                    publishedPracticePack?.id === selected.currentVersionId
                      ? publishedPracticePack
                      : null
                  }
                  loading={practiceSourceLoading}
                  loadError={practiceSourceError}
                  recoveryPacksEnabled={enabled}
                  practiceAssignmentsEnabled={productFeatures?.practiceAssignments === true}
                  followups={entitlements?.followups === true}
                  canEdit={canEdit}
                />
                <PackPracticeAction
                  packId={selected.id}
                  version={
                    publishedPracticePack?.id === selected.currentVersionId
                      ? publishedPracticePack
                      : null
                  }
                  loading={practiceSourceLoading}
                  loadError={practiceSourceError}
                  recoveryPacksEnabled={enabled}
                  practiceAssignmentsEnabled={productFeatures?.practiceAssignments === true}
                  followups={entitlements?.followups === true}
                  canEdit={canEdit}
                  mode="full_sequence"
                />
                <section className={styles.subsection} aria-label="Draft history">
                  <h3>Draft history</h3>
                  <button
                    className="button-quiet"
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void run("Loading history", async () => {
                        const result = await apiFetch<{ history: HistoryEntry[] }>(
                          `/v1/recovery-packs/${selected.id}/history`,
                        );
                        if (alive.current) setHistory(result.history);
                        return `Loaded ${result.history.length} draft revisions.`;
                      })
                    }
                  >
                    Load draft history
                  </button>
                  {history.length ? (
                    <>
                      <label className="field">
                        <span>Previous saved revision</span>
                        <select
                          className="select"
                          disabled={Boolean(busy)}
                          value={historyRevision}
                          onChange={(event) => setHistoryRevision(event.target.value)}
                        >
                          <option value="">Choose a revision</option>
                          {history.map((entry) => (
                            <option key={entry.revision} value={entry.revision}>
                              Revision {entry.revision} · {entry.draft.title || "Untitled"} ·{" "}
                              {new Date(entry.createdAt).toLocaleString()}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        className="button-quiet"
                        type="button"
                        disabled={!writable || Boolean(busy) || !historyRevision}
                        onClick={() =>
                          void run("Restoring draft", async () => {
                            if (
                              dirty &&
                              !window.confirm(
                                "Discard unsaved changes and restore this history revision?",
                              )
                            )
                              return;
                            const key = `${selected.id}:${historyRevision}:${selected.draftRevision}`;
                            if (retryRestore.current?.key !== key)
                              retryRestore.current = {
                                key,
                                body: JSON.stringify({
                                  historyRevision: Number(historyRevision),
                                  expectedRevision: selected.draftRevision,
                                  mutationId: clientUuid(),
                                }),
                              };
                            const result = await apiFetch<{ pack: PackRecord }>(
                              `/v1/recovery-packs/${selected.id}/restore`,
                              { method: "POST", body: retryRestore.current.body },
                            );
                            retryRestore.current = null;
                            if (alive.current) adopt(result.pack);
                            return "History restored as a new draft revision. Published versions remain unchanged.";
                          })
                        }
                      >
                        Restore as new draft revision
                      </button>
                    </>
                  ) : null}
                </section>
                {canEdit ? (
                  <button
                    className="button-quiet"
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void run("Deleting Pack", async () => {
                        if (
                          !window.confirm(
                            "Permanently delete this Pack and its history? Existing inserted Round copies remain usable.",
                          )
                        )
                          return;
                        await apiFetch(`/v1/recovery-packs/${selected.id}`, { method: "DELETE" });
                        if (alive.current) {
                          setPacks((current) => current.filter((pack) => pack.id !== selected.id));
                          setSelected(null);
                          setDraft(null);
                        }
                        return "Pack deleted. Existing inserted copies were preserved.";
                      })
                    }
                  >
                    Delete Pack permanently
                  </button>
                ) : null}
              </>
            ) : (
              <p className="muted">
                Choose a Pack to review its draft, publish a version, or reuse a published version.
              </p>
            )}
          </section>
        </div>
      </div>
    </WorkspaceShell>
  );
}

function CheckpointEditor({
  label,
  question,
  onChange,
}: {
  label: string;
  question: RecoveryPackDraft["diagnostic"];
  onChange: (question: RecoveryPackDraft["diagnostic"]) => void;
}) {
  return (
    <section className={styles.subsection}>
      <h3>{label}</h3>
      <label className="field">
        <span>{label} prompt</span>
        <textarea
          className="textarea"
          maxLength={500}
          value={question.prompt}
          onChange={(event) => onChange({ ...question, prompt: event.target.value })}
        />
      </label>
      <label className="field">
        <span>{label} explanation</span>
        <textarea
          className="textarea"
          maxLength={1_000}
          value={question.explanation}
          onChange={(event) => onChange({ ...question, explanation: event.target.value })}
        />
      </label>
      <p className="muted">
        {question.type} · {question.timeLimitSeconds}s · {question.basePoints} points. Response
        options and grading are copied from published material.
      </p>
      {"choices" in question ? (
        <ul>
          {question.choices.map((choice) => (
            <li key={choice.id}>
              {choice.label}
              {choice.isCorrect ? " (correct)" : ""}
            </li>
          ))}
        </ul>
      ) : question.type === "numeric" ? (
        <p>
          Accepted value: {question.correctValue} · tolerance {question.tolerance}
          {question.unit ? ` ${question.unit}` : ""}
        </p>
      ) : null}
    </section>
  );
}
