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
    expect(ci.jobs["postgres-migration"].env?.VITEST_MAX_WORKERS).toBe("1");
    expect(
      postgres.filter((step) => step.run === "pnpm --filter @openround/db migrate"),
    ).toHaveLength(2);
    expect(postgres.some((step) => step.run === "pnpm --filter @openround/db test:postgres")).toBe(
      true,
    );
    expect(postgres.some((step) => step.run === "pnpm test:multi-writer")).toBe(true);
    for (const job of Object.values(ci.jobs)) expect(job["runs-on"]).toBe("ubuntu-26.04");
  });

  it("runs reading and practice assignment conformance with restricted PostgreSQL in CI", async () => {
    const postgres = (await workflow("ci")).jobs["postgres-migration"];
    const tests = postgres.steps.find(
      (step) => step.run === "pnpm --filter @openround/db test:postgres",
    );
    expect(tests?.env?.TEST_DATABASE_ADMIN_URL).toEqual(expect.any(String));
    expect(tests?.env?.TEST_DATABASE_URL).toEqual(expect.any(String));
    expect(new URL(tests!.env!.TEST_DATABASE_URL!).username).not.toBe(
      new URL(tests!.env!.TEST_DATABASE_ADMIN_URL!).username,
    );
    const databasePackage = JSON.parse(
      await readFile(new URL("../../packages/db/package.json", import.meta.url), "utf8"),
    ) as { scripts: Record<string, string> };
    for (const conformance of [
      "test/presentation-assignments-postgres.test.ts",
      "test/presentation-practice-postgres.test.ts",
    ]) {
      expect(databasePackage.scripts["test:postgres"]?.split(/\s+/)).toContain(conformance);
    }
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

  it("isolates each browser profile and runs administration coverage once", async () => {
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
    const coreProjects = ["chromium", "firefox", "chromium-mobile", "webkit-mobile"];
    expect(core.strategy).toEqual({ "fail-fast": false, matrix: { project: coreProjects } });
    const coreConfig = (await import("../../playwright.config")).default;
    expect(coreConfig.projects?.map((project) => project.name)).toEqual(coreProjects);
    expect(core["timeout-minutes"]).toBe(25);
    expect(beta["timeout-minutes"]).toBe(30);
    for (const browser of [core, beta]) {
      expect(browser.env?.PLAYWRIGHT_PRODUCTION).toBe("true");
      expect(browser.env?.PLAYWRIGHT_REUSE_BUILD).toBe("true");
      expect(browser.if).toBeUndefined();
      expect(browser["continue-on-error"]).toBeUndefined();
      expect(browser.steps.every((step) => step["continue-on-error"] === undefined)).toBe(true);
      expect(
        browser.steps.some(
          (step) => step.run === "pnpm exec playwright install --with-deps chromium firefox webkit",
        ),
      ).toBe(true);
    }
    for (const [browser, role, node] of [
      [core, "core", 22],
      [beta, "beta", 26],
    ] as const) {
      const prepares = browser.steps.filter((step) =>
        step.run?.includes("scripts/build/browser.mjs build"),
      );
      expect(prepares).toHaveLength(1);
      expect(prepares[0]?.run).toContain(`node scripts/build/browser.mjs build ${role}`);
      const compilerCache = browser.steps.find((step) => step.uses?.startsWith("actions/cache@"));
      // Cache only compiler intermediates. Reusable output must be prepared and
      // provenance-checked within the job, independently of any cache hit.
      expect(compilerCache?.with?.path).toBe(`apps/web/.next-browser-${role}/cache`);
      expect(compilerCache?.with?.key).toContain(`node${node}`);
      expect(compilerCache?.with?.key).toContain("pnpm-lock.yaml");
      expect(compilerCache?.with?.key).toContain("github.sha");
      expect(prepares[0]?.if).toBeUndefined();
    }
    const coreRun = core.steps.find((step) => step.name === "Run feature-off browser suite");
    expect(coreRun?.run).toBe('pnpm test:e2e --project="${{ matrix.project }}"');
    expect(coreRun?.if).toBeUndefined();
    for (const run of [
      "pnpm test:e2e:business",
      "pnpm test:e2e:control",
      "pnpm test:e2e:local-admin",
    ]) {
      const coreRuns = core.steps.filter((step) => step.run === run);
      expect(coreRuns, run).toHaveLength(1);
      expect(coreRuns[0]?.if, run).toBe("${{ matrix.project == 'chromium' }}");
      expect(
        Object.values(ci.jobs).flatMap((job) => job.steps.filter((step) => step.run === run)),
        run,
      ).toHaveLength(1);
    }
    const betaRun = beta.steps.find((step) => step.name === "Run isolated UX beta browser project");
    expect(betaRun?.run).toBe(
      'node scripts/ci/browser-diagnostics.mjs --output "$RUNNER_TEMP/browser-beta-diagnostics/resources.jsonl" -- pnpm test:e2e:beta --project="${{ matrix.project }}" --grep-invert=\'presentation-(translation|question-suggestions|private-sharing|text-assistance)\\.spec\\.ts\' --reporter=github,line,html',
    );
    expect(betaRun?.if).toBeUndefined();
    expect(betaRun?.env).toEqual({
      PLAYWRIGHT_HTML_OUTPUT_DIR: "playwright-report-beta",
      PLAYWRIGHT_HTML_OPEN: "never",
      BETA_E2E_AUTHORING: "true",
      BETA_E2E_ROUND_PROTOCOL: "true",
      BETA_E2E_SESSION_SUMMARIES: "true",
      BETA_E2E_IDEA_BOARDS: "true",
    });
    const translationRun = beta.steps.find(
      (step) => step.name === "Run translation browser journeys with a fresh API",
    );
    expect(translationRun?.run).toBe(
      'node scripts/ci/browser-diagnostics.mjs --output "$RUNNER_TEMP/presentation-translation-diagnostics/resources.jsonl" -- pnpm test:e2e:beta tests/beta-e2e/presentation-translation.spec.ts --project="${{ matrix.project }}" --output=test-results-translation --reporter=github,line,html',
    );
    expect(translationRun?.if).toBeUndefined();
    expect(translationRun?.env).toEqual({
      ...betaRun?.env,
      PLAYWRIGHT_HTML_OUTPUT_DIR: "playwright-report-translation",
    });
    expect(beta.steps.indexOf(translationRun!)).toBeGreaterThan(beta.steps.indexOf(betaRun!));
    const suggestionsRun = beta.steps.find(
      (step) => step.name === "Run discussion-suggestion browser journeys with a fresh API",
    );
    expect(suggestionsRun?.run).toBe(
      'node scripts/ci/browser-diagnostics.mjs --output "$RUNNER_TEMP/presentation-question-suggestions-diagnostics/resources.jsonl" -- pnpm test:e2e:beta tests/beta-e2e/presentation-question-suggestions.spec.ts --project="${{ matrix.project }}" --output=test-results-question-suggestions --reporter=github,line,html',
    );
    expect(suggestionsRun?.if).toBe("${{ !cancelled() }}");
    expect(suggestionsRun?.env).toEqual({
      ...betaRun?.env,
      PLAYWRIGHT_HTML_OUTPUT_DIR: "playwright-report-question-suggestions",
    });
    expect(beta.steps.indexOf(suggestionsRun!)).toBeGreaterThan(
      beta.steps.indexOf(translationRun!),
    );
    const receiptRecovery = beta.steps.find(
      (step) => step.name === "Run text-assistance receipt recovery with a fresh API",
    );
    const remainingTextAssistance = beta.steps.find(
      (step) => step.name === "Run remaining text-assistance journeys with a fresh API",
    );
    const receiptTitle = "reviewed text edits recover exact acknowledgements and support safe Undo";
    for (const [step, name, selector] of [
      [receiptRecovery, "recovery", "--grep"],
      [remainingTextAssistance, "remaining", "--grep-invert"],
    ] as const) {
      expect(step?.run).toBe(
        `node scripts/ci/browser-diagnostics.mjs --output "$RUNNER_TEMP/text-assistance-${name}-diagnostics/resources.jsonl" -- pnpm test:e2e:beta tests/beta-e2e/presentation-text-assistance.spec.ts --project="\${{ matrix.project }}" --output=test-results-text-assistance-${name} ${selector}='${receiptTitle}' --reporter=github,line,html`,
      );
      expect(step?.if).toBe("${{ !cancelled() }}");
      expect(step?.env).toEqual({
        ...betaRun?.env,
        PLAYWRIGHT_HTML_OUTPUT_DIR: `playwright-report-text-assistance-${name}`,
      });
      expect(beta.steps.indexOf(step!)).toBeGreaterThan(beta.steps.indexOf(suggestionsRun!));
    }
    // Keep every case selected once while giving the receipt-heavy case its own actor window.
    const textAssistance = await readFile(
      new URL("../beta-e2e/presentation-text-assistance.spec.ts", import.meta.url),
      "utf8",
    );
    const textTitles = [...textAssistance.matchAll(/^ {2}test\(`([^`]+)\$\{suffix\}/gm)].map(
      (match) => match[1]!,
    );
    expect(textTitles).toHaveLength(4);
    expect(textTitles.filter((title) => title.includes(receiptTitle))).toHaveLength(1);
    expect(textTitles.filter((title) => !title.includes(receiptTitle))).toHaveLength(3);
    const mediaRun = beta.steps.find(
      (step) =>
        step.name ===
        "Verify visual import and presentation downloads with isolated synthetic media",
    );
    expect(mediaRun?.run).toContain("tests/beta-e2e/presentation-visual-import.spec.ts");
    expect(mediaRun?.run).toContain("tests/beta-e2e/presentation-static-export.spec.ts");
    expect(mediaRun?.run).toContain("tests/beta-e2e/presentation-private-sharing.spec.ts");
    expect(mediaRun?.env?.BETA_E2E_VISUAL_IMPORTS).toBe("true");
    expect(mediaRun?.if).toBe("${{ !cancelled() }}");
    expect(mediaRun?.["timeout-minutes"]).toBe(5);
    const webServers = Array.isArray(config.webServer) ? config.webServer : [config.webServer];
    expect(webServers[0]?.reuseExistingServer).toBe(false);
    const coreArtifacts = core.steps.find((step) =>
      step.uses?.startsWith("actions/upload-artifact@"),
    );
    const betaArtifacts = beta.steps.find((step) =>
      step.uses?.startsWith("actions/upload-artifact@"),
    );
    expect(coreArtifacts?.with?.name).toBe("browser-core-${{ matrix.project }}-results");
    expect(betaArtifacts?.with?.name).toBe("browser-beta-${{ matrix.project }}-results");
    expect(coreArtifacts?.with?.path).toBe(
      "playwright-report/\ntest-results/\ntest-results-business/\nplaywright-report-business/\n${{ runner.temp }}/browser-core-build-diagnostics/\n",
    );
    expect(betaArtifacts?.with?.path).toBe(
      "playwright-report-beta/\ntest-results-beta/\n${{ runner.temp }}/browser-beta-diagnostics/\ntest-results-translation/\nplaywright-report-translation/\n${{ runner.temp }}/presentation-translation-diagnostics/\ntest-results-question-suggestions/\nplaywright-report-question-suggestions/\n${{ runner.temp }}/presentation-question-suggestions-diagnostics/\ntest-results-text-assistance-recovery/\nplaywright-report-text-assistance-recovery/\n${{ runner.temp }}/text-assistance-recovery-diagnostics/\ntest-results-text-assistance-remaining/\nplaywright-report-text-assistance-remaining/\n${{ runner.temp }}/text-assistance-remaining-diagnostics/\ntest-results-visual-import/\nplaywright-report-visual-import/\n${{ runner.temp }}/visual-import-diagnostics/\n${{ runner.temp }}/browser-beta-build-diagnostics/\n",
    );
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
