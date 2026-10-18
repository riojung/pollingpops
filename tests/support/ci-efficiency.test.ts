import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type Step = {
  id?: string;
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
};
type Workflow = {
  on: Record<string, unknown>;
  concurrency: { group: string; "cancel-in-progress": string };
  jobs: Record<string, { steps: Step[]; env?: Record<string, string>; "runs-on": string }>;
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
    expect(Object.keys(ci.jobs).sort()).toEqual(["browser-smoke", "check", "postgres-migration"]);
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

  it("retains feature-off and beta browser suites with all browser packages", async () => {
    const browser = (await workflow("ci")).jobs["browser-smoke"];
    expect(browser.env?.PLAYWRIGHT_PRODUCTION).toBe("true");
    for (const run of [
      "pnpm exec playwright install --with-deps chromium firefox webkit",
      "pnpm test:e2e",
      "pnpm test:e2e:beta",
    ]) {
      expect(
        browser.steps.some((step) => step.run === run),
        run,
      ).toBe(true);
    }
  });
});
