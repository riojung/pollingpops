import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

async function repositoryFile(path: string) {
  return readFile(join(repositoryRoot, path), "utf8");
}

type WorkflowStep = {
  env?: Record<string, string>;
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
};

type WorkflowJob = {
  env?: Record<string, string>;
  "runs-on"?: string | string[];
  steps?: WorkflowStep[];
};

function workflowJobs(source: string) {
  const workflow = parse(source) as { jobs?: Record<string, WorkflowJob> };
  if (!workflow.jobs) {
    throw new Error("Expected workflow jobs");
  }
  return workflow.jobs;
}

describe("Phase 0 evidence contract", () => {
  it("records merged-main engineering evidence without advancing external gates", async () => {
    const [ledgerText, status, plan, decision] = await Promise.all([
      repositoryFile("docs/release-readiness.json"),
      repositoryFile("docs/implementation-status.md"),
      repositoryFile("docs/market-research-and-development-plan-2026-09.md"),
      repositoryFile("docs/evidence/phase0-stage-decision.md"),
    ]);
    const ledger = JSON.parse(ledgerText) as {
      gates: Array<{ id: string; status: string; evidence: string[] }>;
    };
    const gates = new Map(ledger.gates.map((gate) => [gate.id, gate]));

    const sourceCi = gates.get("source-ci");
    expect(sourceCi).toMatchObject({ status: "complete" });
    expect(sourceCi?.evidence).toEqual(
      expect.arrayContaining([
        "https://github.com/riojung/pollingpops/actions/runs/36173766173",
        "https://github.com/riojung/pollingpops/actions/runs/36173765973",
        "https://github.com/riojung/pollingpops/actions/runs/36172849143",
      ]),
    );
    expect(
      sourceCi?.evidence.every((url) =>
        /^https:\/\/github\.com\/riojung\/pollingpops\/actions\/runs\/\d+$/.test(url),
      ),
    ).toBe(true);

    const localProductionSmoke = gates.get("local-production-smoke");
    expect(localProductionSmoke).toMatchObject({ status: "complete" });
    expect(localProductionSmoke?.evidence).toContain(
      "https://github.com/riojung/pollingpops/actions/runs/36173765942",
    );
    expect(ledger.gates.filter(({ status: gateStatus }) => gateStatus === "complete")).toHaveLength(
      2,
    );
    expect(ledger.gates.filter(({ status: gateStatus }) => gateStatus === "pending")).toHaveLength(
      13,
    );
    expect(status).toMatch(/Phase 0 exit remains open with thirteen gates/);
    expect(plan).toMatch(
      /thirteen release-readiness gates remain, primarily awaiting external or human evidence/,
    );
    expect(decision).toMatch(
      /Selected Phase 1 branch \(access\/companion\/measured failure\/pending\): Pending/,
    );
  });

  it("requires all four target-region profiles without claiming the pending gate passed", async () => {
    const [template, runbook, workflow, ledgerText] = await Promise.all([
      repositoryFile("docs/evidence/target-region-load.md"),
      repositoryFile("docs/runbooks/staging-readiness.md"),
      repositoryFile(".github/workflows/staging-readiness.yml"),
      repositoryFile("docs/release-readiness.json"),
    ]);
    const ledger = JSON.parse(ledgerText) as {
      gates: Array<{ id: string; status: string; criterion: string; evidence: unknown[] }>;
    };
    const gate = ledger.gates.find(({ id }) => id === "target-region-load");

    for (const [artifact, clients] of [
      ["round", 50],
      ["presentation", 50],
      ["round", 250],
      ["presentation", 250],
    ] as const) {
      const filename = `target-region-${artifact}-${clients}.json`;
      expect(workflow).toContain(filename);
      expect(runbook).toContain(filename);
      expect(template).toMatch(
        new RegExp(
          `\\| ${artifact === "round" ? "Round" : "Presentation"}\\s+\\|\\s+${clients} \\|`,
        ),
      );
    }
    expect(gate).toMatchObject({ status: "pending", evidence: [] });
    expect(gate?.criterion).toMatch(/50- and 250-client Round and Presentation/);
    expect(workflow).toContain("target-region-evidence-bundle.json");
    expect(workflow).toContain("scripts/ops/target-load-evidence.mjs bundle");
    expect(runbook).toContain("exactly these four build- and region-matched");
    expect(template).toContain("target-load schema version 2");
  });

  it("binds target load and Stripe replay to immutable evidence identities", async () => {
    const [workflowSource, stripeReplay, loadDockerfile, runbook, targetTemplate, billingTemplate] =
      await Promise.all([
        repositoryFile(".github/workflows/staging-readiness.yml"),
        repositoryFile("tests/smoke/stripe-replay.ts"),
        repositoryFile("tests/load/Dockerfile"),
        repositoryFile("docs/runbooks/staging-readiness.md"),
        repositoryFile("docs/evidence/target-region-load.md"),
        repositoryFile("docs/evidence/live-billing-rehearsal.md"),
      ]);
    const jobs = workflowJobs(workflowSource);
    const load = jobs["target-region-load"];
    const stripe = jobs["stripe-replay"];

    expect(load?.env?.LOAD_EXPECTED_BUILD_ID).toBe("${{ github.sha }}");
    expect(load?.env?.LOAD_SATURATION_EVIDENCE_REFERENCE).toContain(
      "OPENROUND_TARGET_SATURATION_EVIDENCE_REFERENCE",
    );
    expect(load?.env?.LOAD_DURABLE_ARCHIVE_REFERENCE).toContain(
      "OPENROUND_TARGET_DURABLE_ARCHIVE_REFERENCE",
    );
    const bundleStep = load?.steps?.find(
      ({ name }) => name === "Validate and bind target-region evidence bundle",
    );
    expect(bundleStep?.run).toContain("--round-50");
    expect(bundleStep?.run).toContain("--presentation-50");
    expect(bundleStep?.run).toContain("--round-250");
    expect(bundleStep?.run).toContain("--presentation-250");
    expect(bundleStep?.run).toContain("--saturation-reference");
    expect(bundleStep?.run).toContain("--durable-archive-reference");
    const upload = load?.steps?.find(
      ({ name }) => name === "Upload target-region load and soak evidence",
    );
    expect(upload?.with?.["retention-days"]).toBe(90);

    expect(stripe?.env?.STRIPE_REHEARSAL_EXPECTED_BUILD_ID).toBe("${{ github.sha }}");
    expect(stripeReplay).toContain('verifyLiveBuild("start")');
    expect(stripeReplay).toContain('verifyLiveBuild("finish")');
    expect(stripeReplay).toContain("expectedBuildId");
    expect(loadDockerfile).toContain(
      "COPY scripts/ops/target-load-evidence.mjs scripts/ops/target-load-evidence.mjs",
    );
    expect(targetTemplate).toMatch(/not runner metrics/i);
    expect(runbook).toContain("## Billing-mode rehearsal sequence");
    expect(runbook).toMatch(/provider-originated test checkout/);
    expect(runbook).toMatch(/newly\s+reviewed signed billing-disabled build\/config/);
    expect(billingTemplate).toMatch(/remain Pending until the manual provider criteria pass/);
  });

  it("attests the Node 24-compatible target-region runner without claiming runtime discovery", async () => {
    const [template, runbook, readinessWorkflow, imageWorkflow] = await Promise.all([
      repositoryFile("docs/evidence/target-region-load.md"),
      repositoryFile("docs/runbooks/staging-readiness.md"),
      repositoryFile(".github/workflows/staging-readiness.yml"),
      repositoryFile(".github/workflows/staging-images.yml"),
    ]);

    const readinessJobs = workflowJobs(readinessWorkflow);
    const targetRegionJob = readinessJobs["target-region-load"];
    expect(targetRegionJob?.["runs-on"]).toEqual([
      "self-hosted",
      "single-vm-staging",
      "actions-runner-2-327-1-plus",
    ]);
    const provenanceStep = targetRegionJob?.steps?.find(
      ({ name }) => name === "Capture load-generator provenance",
    );
    expect(provenanceStep?.run).toContain('minimumRequiredVersion: "2.327.1"');
    expect(provenanceStep?.run).toContain('versionAttestationLabel: "actions-runner-2-327-1-plus"');
    expect(provenanceStep?.run).toMatch(
      /requiredLabels: \[\s+"self-hosted",\s+"single-vm-staging",\s+"actions-runner-2-327-1-plus",\s+\]/,
    );

    for (const workflow of [readinessWorkflow, imageWorkflow]) {
      const mainCandidateSteps = workflowJobs(workflow)["main-candidate"]?.steps ?? [];
      const setupNodeIndex = mainCandidateSteps.findIndex(({ uses }) =>
        uses?.startsWith("actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1"),
      );
      const firstInlineNodeIndex = mainCandidateSteps.findIndex(({ run }) =>
        run?.split("\n").some((line) => /^\s*node(?:\s|$)/.test(line)),
      );
      expect(setupNodeIndex).toBeGreaterThan(-1);
      expect(firstInlineNodeIndex).toBeGreaterThan(-1);
      expect(setupNodeIndex).toBeLessThan(firstInlineNodeIndex);
      expect(mainCandidateSteps[setupNodeIndex]?.with?.["node-version"]).toBe(22);
    }

    expect(runbook).toMatch(/Actions\s+Runner `2\.327\.1` or newer/);
    expect(runbook).toContain("bin/Runner.Listener --version");
    expect(runbook).toContain("reviewed attestation, not runtime discovery");
    expect(template).toContain("Installed Actions Runner version");
    expect(template).toContain(
      "Runner-version command output/checksum or inventory evidence reference",
    );
    expect(template).toContain("`actions-runner-2-327-1-plus` label applied after version review");
    expect(template).toContain("Automatic-update/current-release verification");
  });

  it("keeps support readiness inside the beta-preflight operations gate", async () => {
    const [ledgerText, template, observability, productionReadiness] = await Promise.all([
      repositoryFile("docs/release-readiness.json"),
      repositoryFile("docs/evidence/operations-rehearsal.md"),
      repositoryFile("docs/runbooks/observability.md"),
      repositoryFile("docs/runbooks/production-readiness.md"),
    ]);
    const ledger = JSON.parse(ledgerText) as {
      gates: Array<{
        id: string;
        name: string;
        status: string;
        requiredFor: string[];
        criterion: string;
        evidence: unknown[];
        nextAction?: string;
      }>;
    };
    const gate = ledger.gates.find(({ id }) => id === "paging");

    expect(gate).toMatchObject({
      name: "Monitoring, paging, and support rehearsal",
      status: "pending",
      evidence: [],
    });
    expect(gate?.requiredFor).toContain("single-vm-beta-preflight");
    expect(gate?.criterion).toMatch(/For one exact build candidate/);
    expect(gate?.criterion).toMatch(/named support rota/);
    expect(gate?.criterion).toMatch(/escalation contacts/);
    expect(gate?.criterion).toMatch(/status, security, privacy, and support contacts/);
    expect(gate?.criterion).toMatch(/support incident drill/);
    expect(gate?.criterion).toMatch(/operations-owner and independent-reviewer acceptance/);
    expect(gate?.nextAction).toMatch(/same exact build candidate/);
    expect(gate?.nextAction).toMatch(/status, security, privacy, and support contacts/);
    expect(gate?.nextAction).toMatch(/operations-owner and independent-reviewer decisions/);

    for (const field of [
      "Operations owner",
      "Independent reviewer",
      "Support rota and escalation-policy reference",
      "Public status, security, privacy, and support contact references",
      "Synthetic support report and intake route",
      "Severity classification and triage result",
      "Technical escalation and responder handoff result",
      "Initial status/support communication and update timing",
      "Resolution, customer-facing closure, and queue disposition",
      "Operations owner decision",
      "Independent reviewer decision",
    ]) {
      expect(template).toContain(field);
    }
    expect(template).toMatch(/Alert delivery alone is not sufficient/);
    expect(observability).toMatch(/Alert delivery alone does not close the\s+beta-preflight gate/);
    expect(observability).toMatch(/same exact build candidate/);
    expect(observability).toMatch(/status, security, privacy, and support contacts/);
    expect(productionReadiness).toMatch(/automated route checks alone do not\s+satisfy the gate/i);
  });

  it("captures reviewed repeat-use, recovery-loop, and Phase 1 selection denominators", async () => {
    const [session, interview, usability, decision, plan, campaign] = await Promise.all([
      repositoryFile("docs/evidence/session-observation.md"),
      repositoryFile("docs/evidence/design-partner-interview.md"),
      repositoryFile("docs/evidence/beta-usability.md"),
      repositoryFile("docs/evidence/phase0-stage-decision.md"),
      repositoryFile("docs/market-research-and-development-plan-2026-09.md"),
      repositoryFile("docs/runbooks/phase0-evidence-campaign.md"),
    ]);

    for (const field of [
      "Partner session ordinal",
      "Stable pseudonymous facilitator ID",
      "Stable partner workflow ID and definition version",
      "Artifact type",
      "Eligible recovery checkpoints",
      "Evidence-complete recovery checkpoints",
      "Timing/connectivity-affected attempts",
      "Partner workflow excluded a participant because of timing/connectivity",
      "Serious accessibility finding ID, severity, review status",
      "Repeat facilitator (yes/no/excluded)",
      "Facilitator used an external deck",
      "Material context-switch interruption count and evidence IDs",
      "Independent reviewer decision",
      "Final in-scope disposition",
    ]) {
      expect(session).toContain(field);
    }
    expect(session).toMatch(/aggregate\s+telemetry alone cannot establish it/i);
    expect(interview).toContain("Willingness to pay (yes/no/unknown)");
    expect(interview).toContain("Stable pseudonymous facilitator ID");
    expect(interview).toContain("Stable partner workflow ID and definition version");
    expect(interview).toContain("higher education/workplace");
    expect(interview).toContain("Next pilot date or repeat-use status");
    expect(interview).toContain("Eligible for facilitator denominator (yes/no/excluded)");
    expect(interview).toContain("Segment enrollment order and frozen primary/reserve status");
    expect(interview).toContain("Recurring post-result decision problem demonstrated (yes/no)");
    expect(interview).toContain("Independent reviewer and decision");
    expect(usability).toContain("Education result/sample");
    expect(usability).toContain("Workplace result/sample");
    expect(usability).toMatch(/overall result does not replace either\s+segment\s+result/i);

    for (const field of [
      "Partners completing at least two pilots",
      "Observed real sessions",
      "Evidence-complete recovery checkpoints",
      "Eligible recovery checkpoints",
      "Median time to unassisted first activation",
      "Willingness-to-pay yes/known denominator",
      "Partner workflows with timing/connectivity exclusion",
      "Timing/connectivity-affected attempts",
      "Repeat facilitators using an external deck",
      "Stable facilitator IDs for repeat external-deck use",
      "Observed sessions with a material context-switch interruption",
      "Candidate activation/correctness failure",
      "Affected eligible attempts/workflows",
      "Eligible denominator",
      "Severity and user consequence",
      "Phase 0 independent reviewer decision",
      "Frozen in-scope cohort/version and observation cutoff",
      "In-scope records by final disposition",
      "Frozen initial primary facilitator cohort",
      "Same-segment reserve order and substitutions with predeclared reason codes",
      "Stable partner workflow IDs with a reviewed timing/connectivity exclusion",
      "Independent reviewer decision",
    ]) {
      expect(decision).toContain(field);
    }
    expect(decision).toMatch(/Access gate passes if any one/);
    expect(decision).toMatch(/at least three partner\s+workflows/);
    expect(decision).toMatch(/at least 10% of observed attempts/);
    expect(decision).toMatch(/serious accessibility finding/);
    expect(decision).toMatch(/at\s+least six eligible higher-education and six eligible workplace/);
    expect(decision).toMatch(/at\s+least eight of the frozen primary twelve demonstrate/);
    expect(decision).toMatch(/at least three\s+partners per segment run twice/);
    expect(decision).toMatch(/at least ten real sessions are observed/);
    expect(decision).toMatch(/at least 50% of eligible\s+recovery checkpoints/);
    expect(decision).toMatch(
      /Companion gate passes only when at least four repeat facilitators[\s\S]*at\s+least two observed sessions/,
    );
    expect(decision).toMatch(/Companion mode\*\* only after the Access gate explicitly fails/);
    expect(decision).toMatch(/only after both gates\s+explicitly fail/);
    expect(decision).toMatch(/If either required gate result is pending[\s\S]*branch pending/);
    expect(decision).toMatch(/do not\s+rank raw event counts that lack a denominator/i);
    expect(decision).toMatch(/Any pending in-scope record keeps every dependent aggregate/);
    expect(decision).toMatch(/repeat sessions of one stable partner\/workflow ID count as one/);
    expect(decision).toMatch(/one eligible participant\/checkpoint response opportunity/);
    const accessDecision = decision.indexOf("**Access and resilience**");
    const companionDecision = decision.indexOf("**Companion mode**");
    expect(accessDecision).toBeGreaterThan(-1);
    expect(companionDecision).toBeGreaterThan(-1);
    expect(accessDecision).toBeLessThan(companionDecision);
    expect(plan).toMatch(/select exactly \*\*one\*\* implementation[\s\S]*Access path first/i);
    expect(plan).toMatch(/Keep Pro at 100[\s\S]*250-client target-host soak gate passes/);
    expect(campaign).toMatch(/six eligible higher-education and six eligible workplace/);
    expect(campaign).toMatch(/freeze a primary evaluation cohort containing the\s+first six/);
    expect(campaign).toMatch(/Never substitute because a facilitator does not demonstrate/);
    expect(campaign).toMatch(/eight of the frozen primary twelve/);
    expect(campaign).toMatch(/at least three partners per segment completing two pilots/);
    expect(campaign).toMatch(/at least ten observed real sessions/);
    expect(campaign).toMatch(/at least 50% of eligible recovery checkpoints/);
    expect(campaign).toMatch(/Preserve every\s+recorded denominator/);
    expect(campaign).toMatch(/freeze the in-scope cohort\s+and observation cutoff/i);
    expect(campaign).toMatch(
      /every interview, observation, or usability task started for the frozen\s+cohort/,
    );
    expect(campaign).toMatch(
      /give every in-scope record an independently reviewed final disposition/,
    );
    expect(campaign).toMatch(/Repeated sessions of the same workflow count once/);
    expect(campaign).toMatch(/one eligible participant's opportunity to submit one\s+response/);
    expect(campaign).toMatch(/Evaluate Companion only after Access explicitly fails/);
    expect(campaign).toMatch(/only after both prior gates\s+explicitly fail/);
    expect(campaign).toMatch(/Keep the branch pending if any prerequisite decision/);
  });
});
