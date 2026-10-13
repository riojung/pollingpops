import { describe, expect, it } from "vitest";
import { MetricsService } from "../src/metrics.js";

describe("MetricsService", () => {
  it("omits projection availability when business health is not enabled", async () => {
    const metrics = new MetricsService();
    expect(await metrics.render()).not.toContain("openround_business_projection_up");
  });

  it("reports a failed initial business health collection as unavailable", async () => {
    const metrics = new MetricsService();
    metrics.bindBusinessHealth(async () => {
      throw new Error("Database unavailable");
    });
    expect(await metrics.render()).toContain("openround_business_projection_up 0");
  });

  it("projects durable business health without tenant or external identifiers", async () => {
    const metrics = new MetricsService();
    metrics.bindBusinessHealth(async () => ({
      billing: { pending: 4, processing: 1, failed: 2, oldestPendingAgeSeconds: 950 },
      integrations: [
        {
          integration: "hubspot",
          pending: 3,
          processing: 0,
          failed: 1,
          ambiguous: 2,
          oldestPendingAgeSeconds: 120,
        },
      ],
      reservations: { active: 9, expired: 1 },
      productQueues: [
        {
          kind: "round-report",
          pending: 1,
          processing: 0,
          failed: 2,
          oldestPendingAgeSeconds: 500,
          failedIds: ["private-report-id"],
          retryableFailedIds: ["private-report-id"],
        },
      ],
      heartbeats: [{ id: "jobs", status: "degraded", ageSeconds: 110 }],
    }));
    const rendered = await metrics.render();
    expect(rendered).toContain("openround_business_projection_up 1");
    expect(rendered).toContain('openround_business_queue_jobs{queue="billing",state="failed"} 2');
    expect(rendered).toContain(
      'openround_business_queue_jobs{queue="hubspot",state="ambiguous"} 2',
    );
    expect(rendered).toContain('openround_business_queue_oldest_seconds{queue="billing"} 950');
    expect(rendered).toContain(
      'openround_business_queue_jobs{queue="round-report",state="failed"} 2',
    );
    expect(rendered).not.toContain("private-report-id");
    expect(rendered).toContain(
      'openround_business_worker_heartbeat_age_seconds{worker="jobs"} 110',
    );
    expect(rendered).toContain('openround_event_credit_reservations{state="expired"} 1');
    expect(rendered).not.toMatch(/organizationId|workspaceId|roomId|externalId/);
    metrics.bindBusinessHealth(async () => {
      throw new Error("Database unavailable");
    });
    expect(await metrics.render()).toContain("openround_business_projection_up 0");
  });
  it("records bounded client event receipt dimensions", async () => {
    const metrics = new MetricsService();

    metrics.observeClientEventReceipt("question.open", "participant", "acknowledged", 0.12);
    metrics.observeClientEventReceipt("audience.event", "presenter", "acknowledged", 0.08);
    metrics.observeClientEventReceipt("unexpected.dynamic.event", "host", "timeout", 5);

    const rendered = await metrics.render();
    expect(rendered).toContain(
      'openround_client_event_receipt_duration_seconds_count{event_type="question.open",role="participant",outcome="acknowledged"} 1',
    );
    expect(rendered).toContain(
      'openround_client_event_receipt_duration_seconds_count{event_type="audience.event",role="presenter",outcome="acknowledged"} 1',
    );
    expect(rendered).toContain(
      'openround_client_event_receipt_duration_seconds_count{event_type="other",role="host",outcome="timeout"} 1',
    );
    expect(rendered).not.toContain("unexpected.dynamic.event");
  });

  it("records answer commit wait and persistence without session labels", async () => {
    const metrics = new MetricsService();

    metrics.observeAnswerCommitStage("wait", 0.003);
    metrics.observeAnswerCommitStage("persist", 0.04);

    const rendered = await metrics.render();
    expect(rendered).toContain(
      'openround_answer_commit_stage_duration_seconds_count{stage="wait"} 1',
    );
    expect(rendered).toContain(
      'openround_answer_commit_stage_duration_seconds_count{stage="persist"} 1',
    );
  });

  it("records authoring completion and failure attempts without workspace labels", async () => {
    const metrics = new MetricsService();
    metrics.recordAuthoringJob("pdf", "completed", 1.25);
    metrics.recordAuthoringJob("docx", "failed_extraction", 0.05);

    const rendered = await metrics.render();
    expect(rendered).toContain(
      'openround_authoring_jobs_total{source_type="pdf",outcome="completed"} 1',
    );
    expect(rendered).toContain(
      'openround_authoring_job_duration_seconds_count{source_type="docx",outcome="failed_extraction"} 1',
    );
  });

  it("records only the bounded artifact type for authoring product events", async () => {
    const metrics = new MetricsService();

    metrics.recordProductEvent({
      name: "draft_conflict",
      dimensions: { artifactType: "presentation" },
    });

    const rendered = await metrics.render();
    expect(rendered).toContain(
      'openround_product_events_total{name="draft_conflict",creation_path="none",recipe="none",scenario="none",segment="none",beta_version="none",duration_bucket="none",artifact_type="presentation"} 1',
    );
    expect(rendered).not.toMatch(/presentationId|artifactId|title|sourceText/);
  });

  it("records bounded Presentation admission and broadcast health without room labels", async () => {
    const metrics = new MetricsService();

    metrics.recordPresentationAdmission("socket", "rate_limited", 0.01);
    metrics.recordPresentationAdmission("rest", "accepted", 0.12);
    metrics.observePresentationResponse("socket", "accepted", 0.08);
    metrics.observePresentationClientReceipt(
      "presentation.session.updated",
      "participant",
      "acknowledged",
      0.2,
    );
    metrics.observePresentationBroadcast("success", 0.08);

    const rendered = await metrics.render();
    expect(rendered).toContain(
      'openround_presentation_admission_attempts_total{transport="socket",outcome="rate_limited"} 1',
    );
    expect(rendered).toContain(
      'openround_presentation_admission_attempts_total{transport="rest",outcome="accepted"} 1',
    );
    expect(rendered).toContain(
      'openround_presentation_broadcast_duration_seconds_count{outcome="success"} 1',
    );
    expect(rendered).toContain(
      'openround_presentation_admission_duration_seconds_count{transport="rest",outcome="accepted"} 1',
    );
    expect(rendered).toContain(
      'openround_presentation_response_acknowledgement_duration_seconds_count{transport="socket",outcome="accepted"} 1',
    );
    expect(rendered).toContain(
      'openround_presentation_client_event_receipt_duration_seconds_count{event_type="presentation.session.updated",projection="participant",outcome="acknowledged"} 1',
    );
    expect(rendered).not.toMatch(/sessionId|workspaceId|joinCode/);
  });

  it("projects only authoritative recovery events into bounded funnel stages", async () => {
    const metrics = new MetricsService();

    for (const name of [
      "creation_completed",
      "round_published",
      "participant_joined",
      "response_saved_acknowledged",
      "intervention_started",
      "linked_recheck_opened",
      "report_reconciled",
    ]) {
      metrics.recordProductEvent({
        name,
        dimensions: { artifactType: "round", segment: "education" },
      });
    }
    metrics.recordProductEvent({
      name: "recheck_opened",
      dimensions: { artifactType: "round", segment: "education" },
    });
    metrics.recordProductEvent({
      name: "report_viewed",
      dimensions: { artifactType: "round", segment: "education" },
    });
    metrics.recordProductEvent({
      name: "report_reconciled",
      authoritative: false,
      dimensions: { artifactType: "round", segment: "education" },
    });

    const rendered = await metrics.render();
    for (const stage of [
      "create",
      "publish",
      "join",
      "answer_acknowledged",
      "intervention",
      "linked_recheck",
      "report_reconciled",
    ]) {
      expect(rendered).toContain(
        `openround_recovery_funnel_stages_total{stage="${stage}",artifact_type="round",segment="education"} 1`,
      );
    }
    expect(rendered).not.toContain('stage="recheck_opened"');
    expect(rendered).not.toContain('stage="report_viewed"');
  });

  it("records audit retention without workspace labels", async () => {
    const metrics = new MetricsService();
    metrics.recordRetention({
      expiredLiveSessions: 0,
      purgedSessions: 0,
      purgedPracticeAssignments: 4,
      purgedAuditEvents: 2,
      purgedProductEvents: 3,
      purgedMedia: 0,
      failedMedia: 0,
    });

    const rendered = await metrics.render();
    expect(rendered).toContain(
      'openround_retention_records_total{resource="audit_event",outcome="deleted"} 2',
    );
    expect(rendered).toContain(
      'openround_retention_records_total{resource="product_event",outcome="deleted"} 3',
    );
    expect(rendered).toContain(
      'openround_retention_records_total{resource="practice_assignment",outcome="deleted"} 4',
    );
  });
});
