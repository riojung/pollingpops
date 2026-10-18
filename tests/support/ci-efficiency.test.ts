import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type Step = {
  id?: string;
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  "continue-on-error"?: boolean;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
};
type Job = {
  steps: Step[];
  env?: Record<string, string>;
  "runs-on": string;
  "timeout-minutes": number;
  "continue-on-error"?: boolean;
  needs?: string[];
  if?: string;
  strategy?: { "fail-fast": boolean; matrix: { project: string[] } };
};
type Workflow = {
  on: Record<string, unknown>;
  concurrency: { group: string; "cancel-in-progress": string };
  jobs: Record<string, Job>;
};

async function workflow(name: string) {
  return parse(
    await readFile(new URL(`../../.github/workflows/${name}.yml`, import.meta.url), "utf8"),
  ) as Workflow;
}

describe("CI efficiency without coverage bypasses", () => {
  it("retains every required context and runs CI/Security on all PRs and main pushes", async () => {
    const ci = await workflow("ci");
    const security = await workflow("security");
    expect(Object.keys(ci.jobs).sort()).toEqual([
      "browser-beta",
      "browser-core",
      "browser-smoke",
      "check",
      "postgres-migration",
    ]);
    expect(Object.keys(security.jobs).sort()).toEqual([
      "codeql",
      "dependency-and-secret-review",
      "dependency-review",
      "sbom",
    ]);
    for (const candidate of [ci, security]) {
      expect(candidate.on).toHaveProperty("pull_request", null);
      expect(candidate.on.push).toEqual({ branches: ["main"] });
      expect(candidate.concurrency.group).toContain(
        "github.event.pull_request.number || github.ref",
      );
      expect(candidate.concurrency["cancel-in-progress"]).toBe(
        "${{ github.event_name == 'pull_request' }}",
      );
    }
  });

  it("keeps all primary correctness/build checks after removing canary duplicates", async () => {
    const ci = await workflow("ci");
    const canary = await workflow("ubuntu-26-canary");
    expect(Object.keys(canary.jobs).sort()).toEqual([
      "ubuntu26-image-toolchain",
      "ubuntu26-production-compose",
    ]);
    expect(canary.on).toHaveProperty("pull_request");
    expect(canary.on).toHaveProperty("workflow_dispatch");
    expect(canary.on).toHaveProperty("schedule");
    for (const run of [
      "pnpm format:check",
      "pnpm check:docker-context",
      "pnpm lint",
      "pnpm typecheck",
      "pnpm build",
      "pnpm readiness:check",
      "pnpm smoke:tracing",
    ]) {
      expect(
        ci.jobs.check.steps.some((step) => step.run === run),
        run,
      ).toBe(true);
    }
    const tests = ci.jobs.check.steps.find((step) =>
      step.run?.includes("pnpm exec turbo run test"),
    );
    expect(tests?.run).toMatch(/^pnpm exec turbo run test --concurrency=2$/m);
    expect(tests?.run).toMatch(/^pnpm test:smoke-support$/m);
    expect(tests?.env?.VITEST_MAX_WORKERS).toBe("1");
    const turbo = JSON.parse(
      await readFile(new URL("../../turbo.json", import.meta.url), "utf8"),
    ) as { tasks: { test: { env?: string[] } } };
    expect(turbo.tasks.test.env).toContain("VITEST_MAX_WORKERS");
    const postgres = ci.jobs["postgres-migration"].steps;
    expect(
      postgres.filter((step) => step.run === "pnpm --filter @openround/db migrate"),
    ).toHaveLength(2);
    expect(postgres.some((step) => step.run === "pnpm --filter @openround/db test:postgres")).toBe(
      true,
    );
    expect(postgres.some((step) => step.run === "pnpm test:multi-writer")).toBe(true);
    for (const job of Object.values(ci.jobs)) expect(job["runs-on"]).toBe("ubuntu-26.04");
  });

  it("does not let an audit failure suppress notices or secrets while retaining the threshold", async () => {
    const steps = (await workflow("security")).jobs["dependency-and-secret-review"].steps;
    expect(steps.find((step) => step.id === "install")?.run).toBe("pnpm install --frozen-lockfile");
    expect(steps.some((step) => step.run === "pnpm audit --audit-level low")).toBe(true);
    const notices = steps.find((step) => step.name === "Verify third-party notices");
    expect(notices?.if).toBe("${{ !cancelled() && steps.install.outcome == 'success' }}");
    expect(notices?.run).toBe(
      "pnpm licenses:report && git diff --exit-code -- THIRD_PARTY_NOTICES.md",
    );
    expect(steps.find((step) => step.uses?.startsWith("gitleaks/gitleaks-action@"))?.if).toBe(
      "${{ !cancelled() && steps.checkout.outcome == 'success' }}",
    );
  });

  it("scans JS/TS directly rather than repeating the application build in CodeQL", async () => {
    const steps = (await workflow("security")).jobs.codeql.steps;
    const init = steps.find((step) => step.uses?.startsWith("github/codeql-action/init@"));
    const analyze = steps.find((step) => step.uses?.startsWith("github/codeql-action/analyze@"));
    expect(init?.with).toMatchObject({ languages: "javascript-typescript", "build-mode": "none" });
    expect(analyze?.uses?.split("@")[1]).toBe(init?.uses?.split("@")[1]);
    expect(steps.some((step) => step.run || step.uses?.startsWith("pnpm/"))).toBe(false);
    expect(steps.some((step) => step.uses?.startsWith("github/codeql-action/analyze@"))).toBe(true);
  });

  it("runs feature-off and administration coverage once and isolates every beta profile", async () => {
    const ci = await workflow("ci");
    const core = ci.jobs["browser-core"];
    const beta = ci.jobs["browser-beta"];
    const projects = [
      "chromium-beta",
      "firefox-beta",
      "chromium-beta-mobile",
      "webkit-beta-mobile",
    ];
    expect(beta.strategy).toEqual({ "fail-fast": false, matrix: { project: projects } });
    const config = (await import("../../playwright.beta.config")).default;
    expect(config.projects?.map((project) => project.name)).toEqual(projects);
    expect(config.workers).toBe(1);
    expect(config.fullyParallel).toBe(false);
    expect(core.strategy).toBeUndefined();
    expect(core["timeout-minutes"]).toBe(25);
    expect(beta["timeout-minutes"]).toBe(30);
    for (const browser of [core, beta]) {
      expect(browser.env?.PLAYWRIGHT_PRODUCTION).toBe("true");
      expect(browser.if).toBeUndefined();
      expect(browser["continue-on-error"]).toBeUndefined();
      expect(browser.steps.every((step) => step["continue-on-error"] === undefined)).toBe(true);
      expect(
        browser.steps.some(
          (step) => step.run === "pnpm exec playwright install --with-deps chromium firefox webkit",
        ),
      ).toBe(true);
    }
    for (const run of [
      "pnpm test:e2e",
      "pnpm test:e2e:business",
      "pnpm test:e2e:control",
      "pnpm test:e2e:local-admin",
    ]) {
      const coreRuns = core.steps.filter((step) => step.run === run);
      expect(coreRuns, run).toHaveLength(1);
      expect(coreRuns[0]?.if, run).toBeUndefined();
      expect(
        Object.values(ci.jobs).flatMap((job) => job.steps.filter((step) => step.run === run)),
        run,
      ).toHaveLength(1);
    }
    const betaRun = beta.steps.find((step) => step.name === "Run isolated UX beta browser project");
    expect(betaRun?.run).toBe('pnpm test:e2e:beta --project="${{ matrix.project }}"');
    expect(betaRun?.if).toBeUndefined();
    expect(betaRun?.env).toEqual({
      BETA_E2E_AUTHORING: "true",
      BETA_E2E_ROUND_PROTOCOL: "true",
      BETA_E2E_SESSION_SUMMARIES: "true",
      BETA_E2E_IDEA_BOARDS: "true",
    });
    const coreArtifacts = core.steps.find((step) =>
      step.uses?.startsWith("actions/upload-artifact@"),
    );
    const betaArtifacts = beta.steps.find((step) =>
      step.uses?.startsWith("actions/upload-artifact@"),
    );
    expect(coreArtifacts?.with?.name).toBe("browser-core-results");
    expect(betaArtifacts?.with?.name).toBe("browser-beta-${{ matrix.project }}-results");
    expect(coreArtifacts?.with?.path).toBe(
      "playwright-report/\ntest-results/\ntest-results-business/\nplaywright-report-business/\n",
    );
    expect(betaArtifacts?.with?.path).toBe("playwright-report-beta/\ntest-results-beta/\n");
    for (const artifacts of [coreArtifacts, betaArtifacts]) {
      // A passing retry must not discard the first attempt's failure evidence.
      expect(artifacts?.if).toBe("${{ always() }}");
      expect(artifacts?.with?.["retention-days"]).toBe(14);
    }
  });

  it("keeps the required browser context fail-closed for every dependency outcome", async () => {
    const aggregate = (await workflow("ci")).jobs["browser-smoke"];
    expect(aggregate.needs).toEqual(["browser-core", "browser-beta"]);
    expect(aggregate.if).toBe("${{ always() }}");
    expect(aggregate["timeout-minutes"]).toBe(5);
    expect(aggregate["continue-on-error"]).toBeUndefined();
    expect(aggregate.steps).toHaveLength(1);
    const gate = aggregate.steps[0]!;
    expect(gate.if).toBeUndefined();
    expect(gate["continue-on-error"]).toBeUndefined();
    expect(gate.env).toEqual({
      CORE_RESULT: "${{ needs.browser-core.result }}",
      BETA_RESULT: "${{ needs.browser-beta.result }}",
    });
    expect(gate.run).toBeTruthy();
    for (const core of ["success", "failure", "cancelled", "skipped", ""]) {
      for (const beta of ["success", "failure", "cancelled", "skipped", ""]) {
        const result = spawnSync(
          "bash",
          ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", gate.run!],
          {
            env: { CORE_RESULT: core, BETA_RESULT: beta },
            encoding: "utf8",
            timeout: 5_000,
          },
        );
        expect(result.error).toBeUndefined();
        expect(result.signal).toBeNull();
        expect(result.status === 0, `core=${core}, beta=${beta}`).toBe(
          core === "success" && beta === "success",
        );
      }
    }
  });
});
