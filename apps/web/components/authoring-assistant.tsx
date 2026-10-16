"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AuthoringJob, AuthoringSourceType } from "@openround/contracts";
import { apiFetch, humanError } from "../lib/api";
import { clientUuid } from "../lib/uuid";
import {
  authoringProposalSelectionCount,
  defaultAuthoringProposalSelection,
  toggleContentSlideProposal,
  toggleQuestionProposal,
  type AuthoringProposalSelection,
} from "../lib/authoring-proposals";
import { recordAuthoringEvent, recordCreationEvent } from "./workspace/product-events";
import { useLocale } from "./locale-provider";
import {
  RecoveryPackSourceProposalPanel,
  type RecoveryPackSourceTarget,
} from "./recovery-pack-source";
import { recoveryPackSourceGeneration } from "../lib/recovery-pack-source";

interface AuthoringStatus {
  enabled: boolean;
  monthlyLimit: number | null;
  used: number;
  remaining: number | null;
}

interface AuthoringAssistantProps {
  canEdit: boolean;
  plain?: boolean;
  trackCreation?: boolean;
  terminology?: "legacy" | "round";
  artifactType?: "round" | "presentation" | "recovery_pack";
  recoveryPackTarget?: RecoveryPackSourceTarget;
  insertionTarget?: {
    presentationId: string;
    expectedRevision: number;
    afterBlockId: string | null;
    onInserted: (insertedBlockIds: string[]) => void;
  };
}

const sourceTypes: Record<
  Exclude<AuthoringSourceType, "pasted_text">,
  { mimeType: string; label: string }
> = {
  pdf: { mimeType: "application/pdf", label: "PDF" },
  docx: {
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    label: "Word",
  },
  pptx: {
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    label: "PowerPoint",
  },
};

function fileType(file: File) {
  const extension = file.name.split(".").pop()?.toLocaleLowerCase();
  return extension === "pdf" || extension === "docx" || extension === "pptx" ? extension : null;
}

class LocalizedAuthoringError extends Error {}

function readBase64(file: File, readError: string, encodeError: string) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new LocalizedAuthoringError(readError));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const separator = result.indexOf(",");
      if (separator < 0) reject(new LocalizedAuthoringError(encodeError));
      else resolve(result.slice(separator + 1));
    };
    reader.readAsDataURL(file);
  });
}

export function AuthoringAssistant({
  canEdit,
  plain = false,
  trackCreation = false,
  terminology = "legacy",
  artifactType = "round",
  insertionTarget,
  recoveryPackTarget,
}: AuthoringAssistantProps) {
  const router = useRouter();
  const { t } = useLocale();
  const [status, setStatus] = useState<AuthoringStatus | null>(null);
  const [jobs, setJobs] = useState<AuthoringJob[]>([]);
  const [sourceMode, setSourceMode] = useState<"pasted_text" | "file">("pasted_text");
  const [sourceName, setSourceName] = useState(() => t("delivery.assistant.pastedSource"));
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [applyingId, setApplyingId] = useState("");
  const [proposalSelections, setProposalSelections] = useState<
    Record<string, AuthoringProposalSelection>
  >({});
  const [error, setError] = useState("");
  const [errorIsLocalized, setErrorIsLocalized] = useState(false);
  const [expanded, setExpanded] = useState(plain);
  const [sourceGeneration, setSourceGeneration] = useState(0);
  const mounted = useRef(true);
  const submitting = useRef(false);
  const submissionGeneration = useRef(0);
  const refreshGeneration = useRef(0);
  // A Pack action's temporary busy state gates new submissions, not a source
  // request already in flight. Keep permission and source-generation fences.
  const sourcePermission = useRef(canEdit);
  sourcePermission.current = canEdit;

  function sourceChanged() {
    submissionGeneration.current += 1;
    setSourceGeneration((current) => current + 1);
    recoveryPackTarget?.onSourceChanged?.();
  }

  const refresh = useCallback(async () => {
    const generation = ++refreshGeneration.current;
    try {
      const [statusResult, jobResult] = await Promise.all([
        apiFetch<{ status: AuthoringStatus }>("/v1/authoring/status"),
        apiFetch<{ jobs: AuthoringJob[] }>("/v1/authoring/jobs"),
      ]);
      if (!mounted.current || generation !== refreshGeneration.current) return;
      setStatus(statusResult.status);
      setJobs(jobResult.jobs);
    } catch (caught) {
      if (mounted.current && generation === refreshGeneration.current) {
        setError(humanError(caught));
        setErrorIsLocalized(false);
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
      submissionGeneration.current += 1;
      refreshGeneration.current += 1;
    };
  }, [refresh]);

  useEffect(() => {
    if (!jobs.some((job) => job.status === "pending" || job.status === "processing")) return;
    const timer = window.setTimeout(() => void refresh(), 2_000);
    return () => window.clearTimeout(timer);
  }, [jobs, refresh]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (
      submitting.current ||
      !canEdit ||
      recoveryPackTarget?.disabled ||
      !status?.enabled ||
      status.remaining === 0
    )
      return;
    submitting.current = true;
    const generation = ++submissionGeneration.current;
    setBusy(true);
    setError("");
    setErrorIsLocalized(false);
    if (trackCreation && artifactType !== "recovery_pack")
      recordCreationEvent("creation_started", "source", artifactType);
    try {
      let body: Record<string, unknown>;
      if (sourceMode === "pasted_text") {
        body = { sourceType: "pasted_text", sourceName, text };
      } else {
        if (!file) throw new LocalizedAuthoringError(t("delivery.assistant.error.chooseFile"));
        if (file.size > 6_000_000)
          throw new LocalizedAuthoringError(t("delivery.assistant.error.fileSize"));
        const type = fileType(file);
        if (!type) throw new LocalizedAuthoringError(t("delivery.assistant.error.fileType"));
        body = {
          sourceType: type,
          sourceName: file.name,
          mimeType: sourceTypes[type].mimeType,
          encoding: "base64",
          data: await readBase64(
            file,
            t("delivery.assistant.error.readFile"),
            t("delivery.assistant.error.encodeFile"),
          ),
        };
      }
      if (
        !mounted.current ||
        !sourcePermission.current ||
        generation !== submissionGeneration.current
      )
        return;
      const result = await apiFetch<{ job: AuthoringJob }>("/v1/authoring/jobs", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (
        !mounted.current ||
        !sourcePermission.current ||
        generation !== submissionGeneration.current
      )
        return;
      setJobs((current) => [result.job, ...current.filter((job) => job.id !== result.job.id)]);
      setText("");
      setFile(null);
      await refresh();
    } catch (caught) {
      if (mounted.current && generation === submissionGeneration.current) {
        setError(humanError(caught));
        setErrorIsLocalized(caught instanceof LocalizedAuthoringError);
      }
    } finally {
      submitting.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function apply(job: AuthoringJob) {
    if (artifactType === "recovery_pack") return;
    setApplyingId(job.id);
    setError("");
    setErrorIsLocalized(false);
    try {
      const selection = proposalSelections[job.id] ?? defaultAuthoringProposalSelection(job);
      const presentationSelection = {
        ...(job.output?.contentSlideProposals
          ? { selectedContentSlideIds: selection.selectedContentSlideIds }
          : {}),
        selectedQuestionIds: selection.selectedQuestionIds,
      };
      const result = await apiFetch<{
        quiz?: { id: string };
        presentation?: { id: string };
        insertedBlockIds?: string[];
      }>(
        insertionTarget
          ? `/v1/presentations/${insertionTarget.presentationId}/blocks/source-proposals`
          : artifactType === "presentation"
            ? `/v1/authoring/jobs/${job.id}/apply-presentation`
            : `/v1/authoring/jobs/${job.id}/apply`,
        {
          method: "POST",
          body: JSON.stringify(
            insertionTarget
              ? {
                  authoringJobId: job.id,
                  ...presentationSelection,
                  afterBlockId: insertionTarget.afterBlockId,
                  expectedRevision: insertionTarget.expectedRevision,
                  mutationId: clientUuid(),
                }
              : artifactType === "presentation"
                ? presentationSelection
                : {},
          ),
        },
      );
      if (trackCreation) {
        recordCreationEvent("creation_completed", "source", artifactType);
        if (authoringProposalSelectionCount(selection) > 0) {
          recordAuthoringEvent("first_block_created", artifactType);
        }
      }
      if (insertionTarget && result.insertedBlockIds) {
        insertionTarget.onInserted(result.insertedBlockIds);
        setApplyingId("");
      } else if (artifactType === "presentation" && result.presentation) {
        router.push(`/presentation/${result.presentation.id}`);
      } else if (result.quiz) {
        router.push(`/quiz/${result.quiz.id}`);
      } else {
        throw new LocalizedAuthoringError(t("delivery.assistant.error.openDraft"));
      }
    } catch (caught) {
      setError(humanError(caught));
      setErrorIsLocalized(caught instanceof LocalizedAuthoringError);
      setApplyingId("");
    }
  }

  function selectionFor(job: AuthoringJob) {
    return proposalSelections[job.id] ?? defaultAuthoringProposalSelection(job);
  }

  function updateContentSelection(job: AuthoringJob, proposalId: string) {
    setProposalSelections((current) => ({
      ...current,
      [job.id]: toggleContentSlideProposal(job, current[job.id], proposalId),
    }));
  }

  function updateQuestionSelection(job: AuthoringJob, questionId: string) {
    setProposalSelections((current) => ({
      ...current,
      [job.id]: toggleQuestionProposal(job, current[job.id], questionId),
    }));
  }

  const allowance = status
    ? status.monthlyLimit === null
      ? t(
          status.used === 1
            ? "delivery.assistant.allowanceUnlimited.one"
            : "delivery.assistant.allowanceUnlimited.other",
          { used: status.used },
        )
      : t("delivery.assistant.allowanceLimited", {
          used: status.used,
          limit: status.monthlyLimit,
        })
    : t("delivery.assistant.loadingAvailability");

  function localizedStatusLabel(jobStatus: AuthoringJob["status"]) {
    if (jobStatus === "pending") return t("delivery.assistant.status.waiting");
    if (jobStatus === "processing") return t("delivery.assistant.status.creating");
    if (jobStatus === "ready") return t("delivery.assistant.status.ready");
    return t("delivery.assistant.status.attention");
  }

  return (
    <details
      className={plain ? "authoring-assistant" : "panel authoring-assistant"}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
      open={expanded}
    >
      <summary>
        {insertionTarget
          ? t("delivery.assistant.insertTrustedSource")
          : artifactType === "recovery_pack"
            ? "Draft a Recovery Pack from a trusted source"
            : artifactType === "presentation"
              ? t("delivery.assistant.draftPresentation")
              : t(
                  terminology === "round"
                    ? "delivery.assistant.draftQuestions"
                    : "delivery.assistant.draftCheckpoints",
                )}
      </summary>
      <p className="muted">
        {artifactType === "recovery_pack"
          ? "Upload a private source or paste trusted text to propose a diagnostic, a different linked recheck, and a cited facilitator card for your review."
          : artifactType === "presentation"
            ? t("delivery.assistant.presentationDescription")
            : t(
                terminology === "round"
                  ? "delivery.assistant.roundDescription"
                  : "delivery.assistant.checkpointDescription",
              )}{" "}
        {t("delivery.assistant.securityDescription")}
      </p>
      <p className="notice" aria-live="polite">
        {allowance}
      </p>
      {error ? (
        <p className="error" lang={errorIsLocalized ? undefined : "en-CA"} role="alert">
          {error}
        </p>
      ) : null}
      {status && !status.enabled ? (
        <p className="notice">{t("delivery.assistant.disabled")}</p>
      ) : canEdit ? (
        <form onSubmit={submit}>
          <fieldset disabled={busy || recoveryPackTarget?.disabled || status?.remaining === 0}>
            <legend>{t("delivery.assistant.sourceType")}</legend>
            <div
              className="button-row"
              role="group"
              aria-label={t("delivery.assistant.sourceType")}
            >
              <label className="checkbox-field">
                <input
                  checked={sourceMode === "pasted_text"}
                  name="authoring-source-mode"
                  onChange={() => {
                    sourceChanged();
                    setSourceMode("pasted_text");
                  }}
                  type="radio"
                />
                {t("delivery.assistant.pasteText")}
              </label>
              <label className="checkbox-field">
                <input
                  checked={sourceMode === "file"}
                  name="authoring-source-mode"
                  onChange={() => {
                    sourceChanged();
                    setSourceMode("file");
                  }}
                  type="radio"
                />
                {t("delivery.assistant.uploadPrivateFile")}
              </label>
            </div>
            {sourceMode === "pasted_text" ? (
              <>
                <label className="field">
                  <span>{t("delivery.assistant.sourceName")}</span>
                  <input
                    className="input"
                    maxLength={200}
                    onChange={(event) => {
                      sourceChanged();
                      setSourceName(event.target.value);
                    }}
                    required
                    value={sourceName}
                  />
                </label>
                <label className="field">
                  <span>{t("delivery.assistant.trustedText")}</span>
                  <textarea
                    className="textarea"
                    maxLength={100_000}
                    minLength={50}
                    onChange={(event) => {
                      sourceChanged();
                      setText(event.target.value);
                    }}
                    placeholder={t("delivery.assistant.textPlaceholder")}
                    required
                    rows={8}
                    value={text}
                  />
                </label>
              </>
            ) : (
              <label className="field">
                <span>{t("delivery.assistant.privateFile")}</span>
                <input
                  accept=".pdf,.docx,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation"
                  className="input"
                  onChange={(event) => {
                    sourceChanged();
                    setFile(event.target.files?.[0] ?? null);
                  }}
                  required
                  type="file"
                />
                <small>{t("delivery.assistant.fileHelp")}</small>
              </label>
            )}
            <button className="button" type="submit">
              {busy ? t("delivery.assistant.uploading") : t("delivery.assistant.createProposal")}
            </button>
          </fieldset>
        </form>
      ) : (
        <p className="notice">{t("delivery.assistant.viewerNotice")}</p>
      )}

      {jobs.length ? (
        <div
          className="authoring-job-list"
          aria-label={t("delivery.assistant.recentProposalsAria")}
        >
          <h3>{t("delivery.assistant.recentProposals")}</h3>
          {jobs.map((job) => {
            const selection = selectionFor(job);
            return (
              <article className="card" key={job.id}>
                <div className="button-row authoring-job-heading">
                  <div>
                    <strong>{job.sourceName}</strong>
                    <p className="muted">
                      {localizedStatusLabel(job.status)} ·{" "}
                      {t("delivery.assistant.attempt", { count: job.attempts })}
                    </p>
                  </div>
                  <span className="status-pill">{localizedStatusLabel(job.status)}</span>
                </div>
                {job.error ? (
                  <p className="error" role="status">
                    {t("delivery.assistant.proposalFailed")} <span lang="en-CA">{job.error}</span>
                  </p>
                ) : null}
                {artifactType === "recovery_pack" &&
                job.status === "ready" &&
                job.output &&
                recoveryPackTarget ? (
                  <RecoveryPackSourceProposalPanel
                    key={`${recoveryPackSourceGeneration(job)}:${sourceGeneration}`}
                    job={job}
                    canEdit={canEdit}
                    target={recoveryPackTarget}
                  />
                ) : artifactType !== "recovery_pack" && job.output ? (
                  <div className="authoring-proposal">
                    <h4>{job.output.checkpointSet.title}</h4>
                    {artifactType === "presentation" && job.output.contentSlideProposals?.length ? (
                      <fieldset className="authoring-proposal-options">
                        <legend>{t("delivery.assistant.proposedSlides")}</legend>
                        {job.output.contentSlideProposals.map((proposal) => (
                          <label className="authoring-proposal-option" key={proposal.id}>
                            <input
                              checked={selection.selectedContentSlideIds.includes(proposal.id)}
                              onChange={() => updateContentSelection(job, proposal.id)}
                              type="checkbox"
                            />
                            <span>
                              <strong>{proposal.title}</strong>
                              {proposal.body ? <small>{proposal.body}</small> : null}
                              <small>
                                {proposal.layout.replace("_", " ")} ·{" "}
                                {proposal.citations[0]?.locator}
                              </small>
                            </span>
                          </label>
                        ))}
                      </fieldset>
                    ) : null}
                    {artifactType === "presentation" ? (
                      <p className="muted">{t("delivery.assistant.recoveryPaired")}</p>
                    ) : null}
                    {job.output.checkpointSet.questions.map((question) => (
                      <section className="authoring-question-proposal" key={question.id}>
                        {artifactType === "presentation" ? (
                          <input
                            aria-label={t("delivery.assistant.includeQuestion", {
                              question: question.prompt,
                            })}
                            checked={selection.selectedQuestionIds.includes(question.id)}
                            onChange={() => updateQuestionSelection(job, question.id)}
                            type="checkbox"
                          />
                        ) : null}
                        <div>
                          <p>
                            <strong>
                              {question.delivery === "recheck"
                                ? t("delivery.builder.linkedRecheck")
                                : terminology === "round"
                                  ? t("delivery.assistant.mainQuestion")
                                  : t("delivery.assistant.mainCheckpoint")}
                              :
                            </strong>{" "}
                            {question.prompt}
                          </p>
                          <ul>
                            {job.output?.citations
                              .filter((citation) => citation.checkpointId === question.id)
                              .map((citation) => (
                                <li key={`${citation.locator}-${citation.excerpt}`}>
                                  <strong>{citation.locator}:</strong> “{citation.excerpt}”
                                </li>
                              ))}
                          </ul>
                        </div>
                      </section>
                    ))}
                    <p className="muted">
                      {t("delivery.assistant.generatedReview", {
                        provider: job.output.provider,
                        model: job.output.model,
                      })}
                    </p>
                    {job.output.conversionNotes?.length ? (
                      <div className="notice">
                        <strong>{t("delivery.assistant.conversionReview")}</strong>
                        <ul>
                          {job.output.conversionNotes.map((note) => (
                            <li key={note}>{note}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {artifactType === "round" && job.appliedQuizId ? (
                      <Link className="button-quiet" href={`/quiz/${job.appliedQuizId}`}>
                        {t("delivery.assistant.openDraft")}
                      </Link>
                    ) : canEdit ? (
                      <button
                        className="button"
                        disabled={
                          applyingId === job.id ||
                          (artifactType === "presentation" &&
                            authoringProposalSelectionCount(selection) === 0)
                        }
                        onClick={() => void apply(job)}
                        type="button"
                      >
                        {applyingId === job.id
                          ? insertionTarget
                            ? t("delivery.assistant.insertingBlocks")
                            : t("delivery.assistant.creatingDraft")
                          : insertionTarget
                            ? t("delivery.assistant.insertSelected", {
                                count: authoringProposalSelectionCount(selection),
                              })
                            : artifactType === "presentation"
                              ? t("delivery.assistant.createPresentation")
                              : t("delivery.assistant.createReviewDraft")}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : null}
    </details>
  );
}
