import {
  PresentationReportSchema,
  PresentationSessionInsightsEnvelopeSchema,
  type PresentationSessionInsightsQna,
} from "@openround/contracts";
import type {
  CreatorContext,
  PresentationRepository,
  PresentationSessionRepository,
  PresentationSessionReportRecord,
  Repository,
  ScopedQnaRepository,
  ScopedQnaInsightsCounts,
  PresentationInsightsOpinionSelector,
  PresentationInsightsOpinionCount,
} from "@openround/db";
import { projectPresentationSessionInsights } from "./presentation-insights-projection.js";

export class PresentationInsightsServiceError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: "INSIGHTS_UNAVAILABLE" | "INSIGHTS_NOT_READY" | "INSIGHTS_LIMIT",
    message: string,
  ) {
    super(message);
  }
}
const unavailable = () =>
  new PresentationInsightsServiceError(
    404,
    "INSIGHTS_UNAVAILABLE",
    "Presentation session insights are unavailable",
  );
const qnaUnavailable = (): PresentationSessionInsightsQna => ({
  status: "unavailable",
  asOf: null,
  audienceSeq: null,
  publicQuestionCount: null,
  answeredQuestionCount: null,
  unansweredQuestionCount: null,
  upvoteCount: null,
});
function qnaProjection(value: ScopedQnaInsightsCounts | null): PresentationSessionInsightsQna {
  if (!value) return qnaUnavailable();
  const status =
    value.status === "available" && value.publicQuestionCount > 0 && value.publicQuestionCount < 5
      ? "suppressed"
      : value.status;
  return {
    status,
    asOf: value.asOf.toISOString(),
    audienceSeq: value.audienceSeq,
    publicQuestionCount: status === "available" ? value.publicQuestionCount : null,
    answeredQuestionCount: status === "available" ? value.answeredQuestionCount : null,
    unansweredQuestionCount: status === "available" ? value.unansweredQuestionCount : null,
    upvoteCount: status === "available" ? value.upvoteCount : null,
  };
}
function reportSource(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return JSON.stringify([
    record.schemaVersion,
    ...["sessionId", "presentationId", "presentationVersionId"].map((key) =>
      typeof record[key] === "string" ? record[key].toLowerCase() : null,
    ),
  ]);
}
function sameReport(left: PresentationSessionReportRecord, right: PresentationSessionReportRecord) {
  return (
    left.id === right.id &&
    left.status === right.status &&
    left.schemaVersion === right.schemaVersion &&
    left.generatedAt?.getTime() === right.generatedAt?.getTime() &&
    left.expiresAt.getTime() === right.expiresAt.getTime() &&
    left.updatedAt.getTime() === right.updatedAt.getTime() &&
    reportSource(left.payload) === reportSource(right.payload)
  );
}
export class PresentationInsightsService {
  constructor(
    private readonly deps: {
      repository: Repository;
      presentations: PresentationRepository;
      sessions: PresentationSessionRepository;
      qna: ScopedQnaRepository;
    },
  ) {}
  private async source(
    actor: CreatorContext,
    sessionId: string,
    reauthorize: () => Promise<CreatorContext | null>,
  ) {
    const sessionActor = await reauthorize();
    if (
      !sessionActor ||
      sessionActor.userId !== actor.userId ||
      sessionActor.workspaceId !== actor.workspaceId ||
      !(await this.deps.repository.getCreatorByUserId(actor.userId, actor.workspaceId)) ||
      (await this.deps.repository.workspaceDeletionStarted(actor.workspaceId))
    )
      throw unavailable();
    const [session, report] = await Promise.all([
        this.deps.sessions.getSessionForWorkspace(actor.workspaceId, sessionId),
        this.deps.sessions.getReport(actor.workspaceId, sessionId),
      ]),
      now = new Date();
    if (
      !session ||
      session.retentionExpiresAt <= now ||
      !report ||
      report.expiresAt <= now ||
      report.sessionId !== session.id ||
      report.workspaceId !== actor.workspaceId
    )
      throw unavailable();
    if (session.status !== "finished")
      throw new PresentationInsightsServiceError(
        409,
        "INSIGHTS_NOT_READY",
        "Insights are available after this session finishes",
      );
    return { session, report };
  }
  async get(
    actor: CreatorContext,
    sessionId: string,
    reauthorize: () => Promise<CreatorContext | null>,
  ) {
    sessionId = sessionId.toLowerCase();
    const initial = await this.source(actor, sessionId, reauthorize);
    const recheck = async () => {
      const current = await this.source(actor, sessionId, reauthorize);
      if (
        current.session.revision !== initial.session.revision ||
        current.session.eventSeq !== initial.session.eventSeq ||
        current.session.presentationVersionId !== initial.session.presentationVersionId ||
        !sameReport(initial.report, current.report)
      )
        throw unavailable();
    };
    if (initial.report.status !== "ready") {
      await recheck();
      return PresentationSessionInsightsEnvelopeSchema.parse({
        status: initial.report.status,
        insights: null,
      });
    }
    if (!initial.report.generatedAt || !initial.report.payload) throw unavailable();
    // This read budget applies only to additive insights; retained reports remain unchanged.
    const serializedSource = JSON.stringify(initial.report.payload);
    if (serializedSource === undefined || Buffer.byteLength(serializedSource) > 1024 * 1024)
      throw new PresentationInsightsServiceError(
        413,
        "INSIGHTS_LIMIT",
        "This report exceeds the insights limit",
      );
    const report = PresentationReportSchema.parse(initial.report.payload);
    if (report.schemaVersion !== initial.report.schemaVersion) throw unavailable();
    const selected = new Map<string, { blockId: string; sequence: number }>();
    // Select the exact original reveal; revisits cannot open a replacement response window.
    for (const event of report.timeline) {
      if (event.type !== "question.revealed" || !event.blockId) continue;
      const key = event.blockId.toLowerCase(),
        prior = selected.get(key);
      if (!prior || event.sequence < prior.sequence)
        selected.set(key, { blockId: event.blockId, sequence: event.sequence });
    }
    if (selected.size > 200 || report.evidence.length > 200)
      throw new PresentationInsightsServiceError(
        413,
        "INSIGHTS_LIMIT",
        "This report exceeds the insights limit",
      );
    const [rosterCounts, publishedVersion] = await Promise.all([
      this.deps.sessions.getRevealRosterCounts(actor.workspaceId, sessionId, [
        ...selected.values(),
      ]),
      this.deps.presentations.getPresentationVersion(
        actor.workspaceId,
        initial.session.presentationVersionId,
      ),
    ]);
    if (
      publishedVersion &&
      (publishedVersion.id !== initial.session.presentationVersionId ||
        publishedVersion.presentationId !== initial.session.presentationId ||
        publishedVersion.workspaceId !== actor.workspaceId)
    )
      throw unavailable();
    const opinionSelectors: PresentationInsightsOpinionSelector[] =
      initial.session.content.blocks.flatMap((block) => {
        if (block.kind !== "question") return [];
        const evidence = report.evidence.find(
          (row) => row.blockId.toLowerCase() === block.id.toLowerCase(),
        );
        if (
          evidence?.kind !== "question" ||
          evidence.respondents < 5 ||
          ("opinionSummary" in evidence && evidence.opinionSummary)
        )
          return [];
        const question = block.question;
        if (
          question.type !== "rating" &&
          (question.type !== "poll" || (question.maxSelections ?? 1) !== 1)
        )
          return [];
        return [
          {
            blockId: block.id,
            questionId: question.id,
            type: question.type,
            choiceIds: question.type === "poll" ? question.choices.map((choice) => choice.id) : [],
            min: question.type === "rating" ? question.min : null,
            max: question.type === "rating" ? question.max : null,
            semanticIds: initial.session.content.schemaVersion >= 12,
          },
        ];
      });
    let opinionCounts: PresentationInsightsOpinionCount[] = [];
    if (opinionSelectors.length) {
      try {
        opinionCounts = await this.deps.sessions.getInsightsOpinionCounts(
          actor.workspaceId,
          sessionId,
          opinionSelectors,
        );
      } catch {
        /* Missing distributions stay explicit without replacing frozen report evidence. */
      }
    }
    const context = { workspaceId: actor.workspaceId, scopeId: sessionId };
    const project = (qna: PresentationSessionInsightsQna) => {
      const insights = projectPresentationSessionInsights({
        session: {
          ...initial.session,
          retentionExpiresAt: new Date(
            Math.min(
              initial.session.retentionExpiresAt.getTime(),
              initial.report.expiresAt.getTime(),
            ),
          ),
        },
        report,
        reportGeneratedAt: initial.report.generatedAt!,
        publishedVersion,
        rosterCounts,
        opinionCounts,
        qna,
        calculatedAt: new Date(),
      });
      const result = PresentationSessionInsightsEnvelopeSchema.parse({ status: "ready", insights });
      if (Buffer.byteLength(JSON.stringify(result)) > 1024 * 1024)
        throw new PresentationInsightsServiceError(
          413,
          "INSIGHTS_LIMIT",
          "This report exceeds the insights limit",
        );
      return result;
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      let counts: ScopedQnaInsightsCounts | null;
      try {
        counts = await this.deps.qna.getInsightsCounts(context);
      } catch {
        counts = null;
      }
      const result = project(qnaProjection(counts));
      if (!counts || counts.status === "unavailable") {
        await recheck();
        return result;
      }
      await recheck();
      // Only a still-current public-state snapshot may leave the process. Retry once, no queue.
      let sequence: number | null;
      try {
        sequence = await this.deps.qna.getInsightsSequence(context);
      } catch {
        sequence = null;
      }
      if (
        counts &&
        ((counts.status === "not_enabled" && counts.audienceSeq === null && sequence === null) ||
          counts.audienceSeq === sequence)
      )
        return result;
    }
    const result = project(qnaUnavailable());
    await recheck();
    return result;
  }
}
