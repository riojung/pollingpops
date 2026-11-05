import { describe, it, expect } from "vitest";
import { MetricsService } from "../src/metrics.js";
describe("Presentation insights operational metrics", () => {
  it("records bounded outcomes, read duration and bytes without tenant or source labels", async () => {
    const metrics = new MetricsService();
    metrics.observePresentationInsights("ready", 0.025, 4096);
    metrics.observePresentationInsights("denied", 0.01, 0);
    metrics.observePresentationInsights("PRIVATE_UNTRUSTED_LABEL" as never, 0.1, 0);
    const value = await metrics.render();
    expect(value).toContain('openround_presentation_insights_reads_total{outcome="ready"} 1');
    expect(value).toContain('openround_presentation_insights_reads_total{outcome="error"} 1');
    expect(value).toContain(
      'openround_presentation_insights_read_duration_seconds_count{outcome="denied"} 1',
    );
    expect(value).toContain("openround_presentation_insights_output_bytes_sum 4096");
    expect(value).not.toMatch(/PRIVATE_|workspace_id|session_id|participant_id|prompt|nickname/);
  });
});
