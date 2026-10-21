import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  independentlyReviewedGateIds,
  validateIndependentGateAcceptance,
} from "../../scripts/ops/evidence-acceptance.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

async function repositoryFile(path: string) {
  return readFile(join(repositoryRoot, path), "utf8");
}

describe("Phase 0 evidence tool discoverability", () => {
  it("exposes and documents the closure validators without advancing gates", async () => {
    const [packageSource, documentation, ledgerSource] = await Promise.all([
      repositoryFile("package.json"),
      repositoryFile("docs/evidence/README.md"),
      repositoryFile("docs/release-readiness.json"),
    ]);
    const packageJson = JSON.parse(packageSource) as { scripts: Record<string, string> };
    const ledger = JSON.parse(ledgerSource) as {
      gates: Array<{ evidence: string[]; id: string; status: string }>;
    };

    expect(packageJson.scripts).toMatchObject({
      "alerts:rehearse": "node scripts/rehearse-alerts.mjs",
      "evidence:backup-restore:check": "node scripts/check-backup-restore-evidence.mjs",
      "evidence:target-load": "node scripts/ops/target-load-evidence.mjs",
      "research:check": "node scripts/check-phase0-research.mjs",
      "readiness:check": "node scripts/check-release-readiness.mjs",
    });
    for (const command of [
      "pnpm alerts:rehearse",
      "pnpm evidence:backup-restore:check",
      "pnpm evidence:target-load",
      "pnpm research:check",
      "pnpm readiness:check",
    ]) {
      expect(documentation).toContain(command);
    }
    expect(documentation).toMatch(/does not prove receiver delivery/);
    expect(documentation).toMatch(/leave the\s+ledger pending/);
    const externalGates = ledger.gates.filter(({ id }) => independentlyReviewedGateIds.has(id));
    expect(externalGates).toHaveLength(13);
    // Require actual review for completed human-assurance gates without freezing the ledger
    // at a historical count of pending gates that would block legitimate acceptance later.
    for (const gate of externalGates) validateIndependentGateAcceptance(gate);
  });
});
