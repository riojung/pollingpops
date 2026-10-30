import { describe, expect, it } from "vitest";
import { MetricsService } from "../src/metrics.js";

describe("canvas observability privacy", () => {
  it("records bounded acknowledgement, conflict, rejection and recovery metrics without identifiers or content", async () => {
    const metrics = new MetricsService();
    metrics.observeCanvasOperation("batch", "accepted", 0.35);
    metrics.observeCanvasOperation("batch", "conflict", 0.2);
    metrics.observeCanvasOperation("invite", "rejected", 0.1);
    metrics.observeCanvasOperation("private-board-title", "member@example.test", 0.1);
    metrics.canvasStreamEvent("opened");
    metrics.canvasStreamEvent("reconnect_requested");
    metrics.canvasStreamEvent("private-user-id");
    metrics.setCanvasStreams(2);
    metrics.observeCanvasOutboxLag(0.15);
    const output = await metrics.render();
    expect(output).toContain(
      'openround_canvas_operations_total{action="batch",outcome="conflict"} 1',
    );
    expect(output).toContain(
      'openround_canvas_operation_duration_seconds_count{action="batch",outcome="accepted"} 1',
    );
    expect(output).toContain(
      'openround_canvas_operations_total{action="invite",outcome="rejected"} 1',
    );
    expect(output).toContain('openround_canvas_stream_events_total{event="reconnect_requested"} 1');
    expect(output).toContain("openround_canvas_live_connections 2");
    expect(output).toContain("openround_canvas_outbox_observation_lag_seconds_count 1");
    expect(output).not.toMatch(
      /private-board-title|member@example.test|private-user-id|boardId|workspaceId|userId/,
    );
  });
});
