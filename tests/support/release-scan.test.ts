import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { finalizeImages, scanImagesForVulnerabilities } from "../../scripts/ops/product-build.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const workflowDirectory = join(repositoryRoot, ".github/workflows");
const serverRef = `ghcr.io/example/openround-server@sha256:${"a".repeat(64)}`;
const webRef = `ghcr.io/example/openround-web@sha256:${"b".repeat(64)}`;

function workflowActionPinningViolations(filename: string, workflow: string) {
  const violations: string[] = [];

  for (const [index, line] of workflow.split("\n").entries()) {
    const reference = line.match(/^\s*(?:-\s*)?uses:\s*([^\s#]+)/)?.[1];
    if (!reference || reference.startsWith("./")) continue;

    const immutable = reference.startsWith("docker://")
      ? /^docker:\/\/[^@\s]+@sha256:[0-9a-f]{64}$/.test(reference)
      : /^[^@\s]+@[0-9a-f]{40}$/.test(reference);
    if (!immutable) violations.push(`${filename}:${index + 1}: ${reference}`);
  }

  return violations;
}

describe("workflow action supply chain", () => {
  it("pins every external action to an immutable revision", async () => {
    const workflowFiles = (await readdir(workflowDirectory)).filter((name) =>
      /\.ya?ml$/.test(name),
    );
    const violations: string[] = [];

    for (const filename of workflowFiles) {
      const workflow = await readFile(join(workflowDirectory, filename), "utf8");
      violations.push(...workflowActionPinningViolations(filename, workflow));
    }

    expect(violations, `Mutable external action references:\n${violations.join("\n")}`).toEqual([]);
  });

  it("accepts commit-pinned actions, digest-pinned containers, and local actions", () => {
    const workflow = [
      `- uses: owner/action@${"a".repeat(40)} # v1`,
      `- uses: docker://ghcr.io/example/action@sha256:${"b".repeat(64)}`,
      "- uses: ./.github/actions/local",
    ].join("\n");

    expect(workflowActionPinningViolations("fixture.yml", workflow)).toEqual([]);
  });

  it("rejects mutable and malformed container action references", () => {
    const workflow = [
      "- uses: docker://ghcr.io/example/action:latest",
      "- uses: docker://ghcr.io/example/action:v1.2.3",
      "- uses: docker://ghcr.io/example/action@sha256:abc123",
      "- uses: owner/action@v4",
    ].join("\n");

    expect(workflowActionPinningViolations("fixture.yml", workflow)).toEqual([
      "fixture.yml:1: docker://ghcr.io/example/action:latest",
      "fixture.yml:2: docker://ghcr.io/example/action:v1.2.3",
      "fixture.yml:3: docker://ghcr.io/example/action@sha256:abc123",
      "fixture.yml:4: owner/action@v4",
    ]);
  });
});

describe("release tag governance specification", () => {
  it("separates named-owner creation authority from no-bypass tag immutability", async () => {
    const [creationSource, immutabilitySource, runbook, evidenceRecord] = await Promise.all([
      readFile(join(repositoryRoot, ".github/rulesets/release-tags.json"), "utf8"),
      readFile(join(repositoryRoot, ".github/rulesets/release-tag-immutability.json"), "utf8"),
      readFile(join(repositoryRoot, "docs/runbooks/repository-governance.md"), "utf8"),
      readFile(join(repositoryRoot, "docs/evidence/repository-governance-canary.md"), "utf8"),
    ]);
    const creationRuleset = JSON.parse(creationSource) as {
      bypass_actors?: unknown[];
      conditions?: { ref_name?: { exclude?: string[]; include?: string[] } };
      enforcement?: string;
      name?: string;
      rules?: Array<{
        parameters?: { update_allows_fetch_and_merge?: boolean };
        type?: string;
      }>;
      target?: string;
    };
    const immutabilityRuleset = JSON.parse(immutabilitySource) as typeof creationRuleset;
    const normalizedRunbook = runbook.replace(/\s+/g, " ");

    expect(creationRuleset.name).toBe("Restrict v release tag creation");
    expect(creationRuleset.target).toBe("tag");
    expect(creationRuleset.enforcement).toBe("disabled");
    expect(creationRuleset.conditions?.ref_name).toEqual({
      include: ["refs/tags/v*"],
      exclude: [],
    });
    expect(creationRuleset.rules?.map(({ type }) => type)).toEqual(["creation"]);
    expect(creationRuleset.bypass_actors).toEqual([
      { actor_id: 1459373, actor_type: "User", bypass_mode: "always" },
    ]);

    expect(immutabilityRuleset.name).toBe("Make v release tags immutable");
    expect(immutabilityRuleset.target).toBe("tag");
    expect(immutabilityRuleset.enforcement).toBe("disabled");
    expect(immutabilityRuleset.conditions?.ref_name).toEqual({
      include: ["refs/tags/v*"],
      exclude: [],
    });
    expect(immutabilityRuleset.rules?.map(({ type }) => type).sort()).toEqual([
      "deletion",
      "non_fast_forward",
      "update",
    ]);
    expect(immutabilityRuleset.rules?.find(({ type }) => type === "update")?.parameters).toEqual({
      update_allows_fetch_and_merge: false,
    });
    expect(immutabilityRuleset.bypass_actors).toEqual([]);
    expect(runbook).toContain("gh api --method POST repos/riojung/pollingpops/rulesets");
    expect(normalizedRunbook).toContain("single named owner user, `riojung`");
    expect(normalizedRunbook).toContain("never to a repository role");
    expect(normalizedRunbook).toContain("Only that named owner may create a");
    expect(normalizedRunbook).toContain("no bypass actors");
    expect(normalizedRunbook).toContain("do not enable the created rules");
    expect(evidenceRecord).toContain("## Release-tag rule snapshot");
    expect(evidenceRecord).toContain("Immutability ruleset has no bypass actor");
  });
});

describe("staging readiness trust boundary", () => {
  it("uses a default-branch repository dispatch with a fail-closed payload", async () => {
    const workflow = await readFile(
      join(repositoryRoot, ".github/workflows/staging-readiness.yml"),
      "utf8",
    );
    const mainCandidate = workflow.match(
      / {2}main-candidate:\n([\s\S]*?)(?=\n {2}remote-readiness:)/,
    )?.[1];

    expect(mainCandidate).toBeDefined();
    expect(workflow).toContain("repository_dispatch:\n    types: [staging-readiness]");
    expect(workflow).not.toContain("workflow_dispatch:");
    expect(mainCandidate).not.toMatch(/^ {4}if:/m);
    expect(mainCandidate).not.toContain("environment:");
    expect(mainCandidate).toContain("fetch-depth: 0");
    expect(mainCandidate).toContain('test "$GITHUB_EVENT_NAME" = repository_dispatch');
    expect(mainCandidate).toContain(
      "git fetch --force origin '+refs/heads/main:refs/remotes/origin/main'",
    );
    expect(mainCandidate).toContain('test "$GITHUB_REF" = refs/heads/main');
    expect(mainCandidate).toContain(
      'test "$(git rev-parse --verify HEAD)" = "$(git rev-parse --verify origin/main)"',
    );
    expect(mainCandidate).toContain('new Set(["run_stripe_replay", "soak_minutes"])');
    expect(mainCandidate).toContain('typeof runStripeReplay !== "boolean"');
    expect(mainCandidate).toContain('typeof soakMinutes !== "string"');
    expect(mainCandidate).toContain('["0", "15", "60"].includes(soakMinutes)');
    expect(mainCandidate).toContain(
      "run_stripe_replay: ${{ steps.payload.outputs.run_stripe_replay }}",
    );
    expect(mainCandidate).toContain("soak_minutes: ${{ steps.payload.outputs.soak_minutes }}");
    expect(mainCandidate).toContain("node scripts/check-deployment-target.mjs staging");
    expect(mainCandidate).toContain("public_api_url: ${{ steps.target.outputs.public_api_url }}");
    expect(mainCandidate).toContain("public_web_url: ${{ steps.target.outputs.public_web_url }}");
    expect(mainCandidate).toContain(
      "public_media_url: ${{ steps.target.outputs.public_media_url }}",
    );
    expect(mainCandidate).toContain('readFileSync("config/deploy/staging.json", "utf8")');

    expect(workflow).toContain("needs.main-candidate.outputs.soak_minutes != '0'");
    expect(workflow).toContain("SOAK_MINUTES: ${{ needs.main-candidate.outputs.soak_minutes }}");
    expect(workflow).toContain("needs.main-candidate.outputs.run_stripe_replay == 'true'");
    expect(workflow).not.toMatch(/\binputs\.(?:soak_minutes|run_stripe_replay)\b/);

    for (const [job, dependency] of [
      ["remote-readiness", "needs: main-candidate"],
      ["target-region-load", "needs: [main-candidate, remote-readiness]"],
      ["stripe-replay", "needs: [main-candidate, remote-readiness]"],
    ] as const) {
      const section = workflow.match(new RegExp(`  ${job}:\\n([\\s\\S]*?)(?=\\n  \\S|$)`))?.[1];

      expect(section, `${job} job`).toBeDefined();
      expect(section).toContain("github.ref == 'refs/heads/main'");
      expect(section).toContain(dependency);
    }

    expect(workflow).toContain(
      "READINESS_API_URL: ${{ needs.main-candidate.outputs.public_api_url }}",
    );
    expect(workflow).toContain(
      "READINESS_WEB_URL: ${{ needs.main-candidate.outputs.public_web_url }}",
    );
    expect(workflow).toContain(
      "READINESS_MEDIA_URL: ${{ needs.main-candidate.outputs.public_media_url }}",
    );
    expect(workflow).toContain("LOAD_BASE_URL: ${{ needs.main-candidate.outputs.public_api_url }}");
    expect(workflow).toContain("LOAD_ORIGIN: ${{ needs.main-candidate.outputs.public_web_url }}");
    expect(workflow).toContain(
      "STRIPE_REHEARSAL_BASE_URL: ${{ needs.main-candidate.outputs.public_api_url }}",
    );
    expect(workflow).toContain(
      "STRIPE_REHEARSAL_ORIGIN: ${{ needs.main-candidate.outputs.public_web_url }}",
    );
    expect(workflow).not.toMatch(/\$\{\{ vars\.OPENROUND_(?:API|WEB|MEDIA)_URL \}\}/);
  });
});

describe("staging image trust boundary", () => {
  it("verifies the default-branch repository dispatch before granting write credentials", async () => {
    const workflow = await readFile(
      join(repositoryRoot, ".github/workflows/staging-images.yml"),
      "utf8",
    );
    const mainCandidate = workflow.match(/ {2}main-candidate:\n([\s\S]*?)(?=\n {2}build:)/)?.[1];
    const build = workflow.match(/ {2}build:\n([\s\S]*)$/)?.[1];
    const topLevelPermissions = workflow.match(
      /\npermissions:\n([\s\S]*?)(?=\n\nconcurrency:)/,
    )?.[1];

    expect(mainCandidate).toBeDefined();
    expect(build).toBeDefined();
    expect(workflow).toContain("repository_dispatch:\n    types: [staging-images]");
    expect(workflow).not.toContain("workflow_dispatch:");
    expect(topLevelPermissions?.trim()).toBe("contents: read");

    expect(mainCandidate).not.toMatch(/^ {4}if:/m);
    expect(mainCandidate).not.toContain("environment:");
    expect(mainCandidate).not.toContain("packages: write");
    expect(mainCandidate).not.toContain("id-token: write");
    expect(mainCandidate).toContain("fetch-depth: 0");
    expect(mainCandidate).toContain('test "$GITHUB_EVENT_NAME" = repository_dispatch');
    expect(mainCandidate).toContain(
      "git fetch --force origin '+refs/heads/main:refs/remotes/origin/main'",
    );
    expect(mainCandidate).toContain('test "$GITHUB_REF" = refs/heads/main');
    expect(mainCandidate).toContain(
      'test "$(git rev-parse --verify HEAD)" = "$(git rev-parse --verify origin/main)"',
    );
    expect(mainCandidate).toContain('event.action !== "staging-images"');
    expect(mainCandidate).toContain("const payload = event.client_payload ?? {};");
    expect(mainCandidate).toContain("Array.isArray(payload)");
    expect(mainCandidate).toContain("Object.keys(payload).length !== 0");
    expect(mainCandidate).toContain("node scripts/check-deployment-target.mjs staging");

    expect(build).toContain("github.ref == 'refs/heads/main'");
    expect(build).toContain("needs: main-candidate");
    expect(build).toContain("environment: single-vm-staging");
    expect(build).toContain("contents: read");
    expect(build).toContain("packages: write");
    expect(build).toContain("id-token: write");
    expect(build).toContain("Revalidate current main candidate after approval");
    expect(build).toContain("git fetch --force origin '+refs/heads/main:refs/remotes/origin/main'");
    expect(build).toContain('test "$GITHUB_EVENT_NAME" = repository_dispatch');
    expect(build).toContain('test "$GITHUB_REF" = refs/heads/main');
    expect(build).toContain(
      'test "$(git rev-parse --verify HEAD)" = "$(git rev-parse --verify origin/main)"',
    );

    const checkoutIndex = build.indexOf("actions/checkout@");
    const revalidationIndex = build.indexOf("Revalidate current main candidate after approval");
    const packageLoginIndex = build.indexOf("docker/login-action@");
    expect(checkoutIndex).toBeGreaterThanOrEqual(0);
    expect(revalidationIndex).toBeGreaterThan(checkoutIndex);
    expect(packageLoginIndex).toBeGreaterThan(revalidationIndex);
  });
});

describe("production release target boundary", () => {
  it("uses the configured existing image repository in both release build phases after renaming", async () => {
    const workflow = await readFile(join(repositoryRoot, ".github/workflows/release.yml"), "utf8");
    expect(
      workflow.match(
        /registry="\$\(jq -r '\.imageRepository' config\/deploy\/production\.json\)"/g,
      ),
    ).toHaveLength(2);
    expect(workflow.match(/--registry "\$registry"/g)).toHaveLength(2);
    expect(workflow).not.toContain("ghcr.io/${GITHUB_REPOSITORY}/openround");
  });

  it("validates the production target and host-key pin before building release images", async () => {
    const workflow = await readFile(join(repositoryRoot, ".github/workflows/release.yml"), "utf8");
    const preflight = workflow.match(/ {2}preflight:\n([\s\S]*?)(?=\n {2}images:)/)?.[1];

    expect(preflight).toBeDefined();
    expect(preflight).toContain("node scripts/check-deployment-target.mjs production");
    expect(workflow.indexOf("node scripts/check-deployment-target.mjs production")).toBeLessThan(
      workflow.indexOf("./scripts/product-build.sh production"),
    );
  });

  it("creates only a bounded draft release after all image evidence succeeds", async () => {
    const workflow = await readFile(join(repositoryRoot, ".github/workflows/release.yml"), "utf8");
    const topLevelPermissions = workflow.match(
      /\npermissions:\n([\s\S]*?)(?=\n\nconcurrency:)/,
    )?.[1];
    const images = workflow.match(/ {2}images:\n([\s\S]*?)(?=\n {2}draft-release:)/)?.[1];
    const draft = workflow.match(/ {2}draft-release:\n([\s\S]*)$/)?.[1];

    expect(topLevelPermissions?.trim()).toBe("contents: read");
    expect(images).toBeDefined();
    expect(images).toContain("contents: read");
    expect(images).toContain("id-token: write");
    expect(images).toContain("packages: write");
    expect(images).toContain("security-events: write");
    expect(images).toContain("Retain SBOM and provenance attestations");
    expect(images).toContain("{{ json .SBOM.SPDX }}");
    expect(images).toContain("{{ json .Provenance.SLSA }}");

    expect(draft).toBeDefined();
    expect(draft).toContain("name: Create draft GitHub Release");
    expect(draft).toContain("needs: [preflight, images]");
    expect(draft).toContain("actions: read");
    expect(draft).toContain("contents: write");
    expect(draft).not.toContain("id-token: write");
    expect(draft).not.toContain("packages: write");
    expect(draft).not.toContain("security-events: write");
    expect(draft).toContain("actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333");
    expect(draft).toContain("sbom.spdx.json");
    expect(draft).toContain("provenance.slsa.json");
    expect(draft).toContain("trivy.sarif");
    expect(draft).toContain("git archive --format=tar");
    expect(draft).toContain("SHA256SUMS");
    expect(draft).toContain('test "$(wc -c < "$output/release-notes.md")" -le 8192');
    expect(draft).toContain("gh release create");
    expect(draft).not.toContain("gh release edit");
    expect(draft).not.toContain("gh release upload");
    expect(draft.match(/\s--draft(?:\s|\\)/g)).toHaveLength(1);
    expect(draft).toContain("--verify-tag");
    expect(draft).toContain("--notes-file");
    expect(draft).not.toContain("--generate-notes");
    expect(draft).not.toContain("--draft=false");
    expect(draft).not.toContain("--clobber");
    expect(draft).toContain("do not replace reviewed evidence");
    expect(draft).toContain("releases?per_page=100");
    expect(draft).toContain("--paginate --slurp");
    expect(draft).not.toContain("releases/tags/$GITHUB_REF_NAME");
    expect(draft).toContain(".verification.reason");
    expect(draft.match(/git\/ref\/tags\/\$GITHUB_REF_NAME/g)).toHaveLength(2);
    expect(draft).toContain("requiredReleaseAssetNames");
    expect(draft).toContain('test "${#assets[@]}" -eq 13');
    expect(draft).toContain("sha256sum --check --strict SHA256SUMS");
    expect(draft).toContain("release-binding.json");
    expect(draft).toContain("validateDraftGithubRelease");
    expect(draft).toContain("release-publication-${{ github.ref_name }}");
    expect(draft).toContain(".published_at");
    expect(draft).toContain(".assets[] | select(.name == $name) | .digest");
    expect(workflow).toContain("TAG_PUSH_ACTOR_ID: ${{ github.event.sender.id }}");
    expect(workflow).toContain("TAG_PUSH_CREATED: ${{ github.event.created }}");
    expect(workflow).toContain("TAG_PUSH_DELETED: ${{ github.event.deleted }}");
    expect(workflow).toContain("TAG_PUSH_FORCED: ${{ github.event.forced }}");
    expect(workflow).toContain("TAG_PUSH_BEFORE: ${{ github.event.before }}");
    expect(workflow).toContain("TAG_PUSH_AFTER: ${{ github.event.after }}");
    expect(workflow).toContain("Release tags may be pushed only by the named release owner");
    expect(workflow).toContain(
      "Release workflow accepts only the initial creation of a new version tag",
    );
    expect(workflow).toContain(
      "The release tag no longer matches the initial tag-creation payload",
    );
    expect(workflow).toContain("evidence_candidate_commit");
    expect(workflow).toContain(
      'test "${evidence_descendant_changes[0]}" = "docs/release-readiness.json"',
    );
    expect(workflow).toContain(
      'git diff --name-only --no-renames "$evidence_candidate_commit" "$tag_commit" --',
    );
    expect(workflow).toContain("evidenceOnlyDescendant: true");
    expect(workflow).toContain('and .event == "push"');
    expect(workflow).toContain('and .head_branch == "main"');
    expect(workflow).toContain("and .path == $path");
    expect(workflow).toContain('local workflow_path=".github/workflows/$workflow_file"');
    expect(workflow).toContain("path: .path");
    expect(workflow).toContain("headBranch: .head_branch");
  });
});

describe("release image vulnerability evidence", () => {
  it("scans and signs the optional control image with the same immutable release", async () => {
    const controlRef = `ghcr.io/example/openround-control@sha256:${"3".repeat(64)}`;
    const images = {
      server: { ref: serverRef, signed: false },
      web: { ref: webRef, signed: false },
      control: { ref: controlRef, signed: false },
    };
    const calls: Array<{ command: string; ref: string | undefined }> = [];
    await finalizeImages(images, {
      config: {
        requireSigning: true,
        cosignIdentityRegexp: "^https://github.com/example/.*$",
        cosignOidcIssuer: "https://token.actions.githubusercontent.com",
      },
      shouldSign: true,
      runCommand: async (command: string, args: string[]) => {
        calls.push({ command, ref: args.at(-1) });
        return { stdout: "", stderr: "" };
      },
    });
    expect(calls.filter(({ ref }) => ref === controlRef).map(({ command }) => command)).toEqual([
      "trivy",
      "cosign",
      "cosign",
    ]);
    expect(images.control.signed).toBe(true);
  });
  it("scans both immutable references before reporting vulnerability failures", async () => {
    const runCommand = vi.fn(async (_command: string, args: string[]) => {
      throw new Error(`vulnerable: ${args.at(-1)}`);
    });

    await expect(
      scanImagesForVulnerabilities(
        {
          server: { ref: serverRef },
          web: { ref: webRef },
        },
        runCommand,
      ),
    ).rejects.toThrow("Vulnerability scan failed for server, web");

    expect(runCommand).toHaveBeenCalledTimes(2);
    expect(runCommand.mock.calls.map(([, args]) => args.at(-1))).toEqual([serverRef, webRef]);
    for (const [, args] of runCommand.mock.calls) {
      expect(args).toContain("HIGH,CRITICAL");
      expect(args).not.toContain("--ignore-unfixed");
      expect(args).toContain("--exit-code");
      expect(args).toContain("1");
    }
  });

  it("keeps both SARIF scans on the explicitly installed Trivy CLI", async () => {
    const workflow = await readFile(join(repositoryRoot, ".github/workflows/release.yml"), "utf8");
    const actionScans = workflow
      .split(/^[ \t]+- uses: aquasecurity\/trivy-action@[0-9a-f]{40}[^\n]*$/gm)
      .slice(1)
      .map((section) => section.split("\n      - ", 1)[0]);

    expect(actionScans).toHaveLength(2);
    for (const scan of actionScans) {
      expect(scan).toMatch(/if: always\(\) && steps\.manifest\.outcome == 'success'/);
      expect(scan).not.toMatch(/ignore-unfixed:/);
      expect(scan).toMatch(/limit-severities-for-sarif: true/);
      expect(scan).toMatch(/skip-setup-trivy: true/);
    }
    expect(workflow).toMatch(/version: v0\.74\.0/);
    expect(workflow).toMatch(
      /printf '%s\\n' "\$image_ref" > "artifacts\/release\/\$component\/ref\.txt"/,
    );
  });

  it("does not sign either image when either pre-sign vulnerability scan fails", async () => {
    const imageRecords = {
      server: { ref: serverRef, signed: false },
      web: { ref: webRef, signed: false },
    };
    const runCommand = vi.fn(async (command: string, args: string[]) => {
      if (command === "trivy" && args.at(-1) === serverRef) {
        throw new Error("server is vulnerable");
      }
      return { stdout: "", stderr: "" };
    });

    await expect(
      finalizeImages(imageRecords, {
        config: {
          requireSigning: true,
          cosignIdentityRegexp: "^https://github\\.com/example/openround/.*$",
          cosignOidcIssuer: "https://token.actions.githubusercontent.com",
        },
        shouldSign: true,
        runCommand,
      }),
    ).rejects.toThrow("Vulnerability scan failed for server");

    expect(runCommand.mock.calls.map(([command]) => command)).toEqual(["trivy", "trivy"]);
    expect(imageRecords.server.signed).toBe(false);
    expect(imageRecords.web.signed).toBe(false);
  });

  it("runs both SARIF scans before finalization and keeps promotion success-only", async () => {
    const workflow = await readFile(join(repositoryRoot, ".github/workflows/release.yml"), "utf8");
    const prepare = workflow.indexOf("--prepare");
    const serverScan = workflow.indexOf("name: Scan server image");
    const webScan = workflow.indexOf("name: Scan web image");
    const finalize = workflow.indexOf("--finalize");

    expect(prepare).toBeGreaterThan(-1);
    expect(serverScan).toBeGreaterThan(prepare);
    expect(webScan).toBeGreaterThan(serverScan);
    expect(finalize).toBeGreaterThan(webScan);
    expect(workflow).toMatch(/- name: Upload deployment manifest\n\s+if: success\(\)/);
  });
});
