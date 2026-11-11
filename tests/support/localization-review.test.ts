import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { supportedLocales } from "../../packages/contracts/src/index";
import {
  assertInvariantParity,
  buildReviewBundle,
  canonicalJson,
  checkReviewDecisions,
  contentHash,
  createReviewDecisions,
  currentSourceRef,
  escapeHtml,
  normalizeGeneratedIds,
  renderReviewHtml,
  reviewExampleSource,
  runLocalizationReview,
  validateCurrentReview,
  type ReviewBundle,
} from "../../scripts/localization-review";

const sourceRef = currentSourceRef();
let bundle: ReviewBundle;

beforeAll(async () => {
  bundle = await buildReviewBundle("ko-KR", sourceRef);
}, 30_000);

function completedReview() {
  const review = createReviewDecisions(bundle);
  for (const entry of review.entries) {
    entry.decision = "accepted";
    entry.reviewerReference = "reviewer:synthetic-test-fixture";
    entry.reviewedAt = "2026-01-01T12:00:00.000Z";
  }
  return review;
}

describe("native-language review preparation", () => {
  it("exports every supported locale with full scoped content and conservative human decisions", async () => {
    for (const locale of supportedLocales) {
      const packet = locale === "ko-KR" ? bundle : await buildReviewBundle(locale, sourceRef);
      expect(packet.coverage).toEqual({ presentations: 21, rounds: 36, surveyContexts: 17 });
      expect(
        packet.items.filter(
          (item) => item.id.startsWith("presentation/") && item.id.endsWith("/definition"),
        ),
      ).toHaveLength(21);
      expect(
        packet.items.filter(
          (item) => item.id.startsWith("presentation/") && item.id.endsWith("/draft"),
        ),
      ).toHaveLength(21);
      expect(
        packet.items.filter((item) => item.id.startsWith("round/") && item.id.endsWith("/draft")),
      ).toHaveLength(36);
      expect(packet.items.filter((item) => item.id.startsWith("survey/"))).toHaveLength(17);
      for (const group of [
        "practice-management",
        "pack-practice-setup",
        "pack-practice-detail",
        "pack-practice",
        "creation-goal",
        "creation",
        "template",
      ])
        expect(
          packet.items.some((item) => item.id.startsWith(`ui/${group}/`)),
          group,
        ).toBe(true);
      expect(packet.items.map((item) => item.id)).toEqual(bundle.items.map((item) => item.id));
      expect(packet.purpose).toBe(
        locale === "en-CA" ? "english-reference" : "native-review-preparation",
      );
      for (const item of packet.items) {
        expect(item.englishHash).toBe(contentHash(item.english));
        expect(item.targetHash).toBe(contentHash(item.target));
        expect(item.source.file).toMatch(/\.(?:ts|json)$/);
        if (locale === "en-CA") expect(item.english).toEqual(item.target);
      }
      const review = createReviewDecisions(packet);
      expect(
        review.entries.every(
          (entry) =>
            entry.decision === "pending" &&
            entry.reviewerReference === null &&
            entry.reviewedAt === null,
        ),
      ).toBe(true);
      expect(checkReviewDecisions(packet, review)).toMatchObject({
        complete: false,
        nativeAcceptance: false,
        pending: packet.items.length,
        accepted: 0,
      });
    }
  }, 60_000);

  it("is byte deterministic despite fresh generated identities and changing invocation time", async () => {
    const again = await buildReviewBundle("ko-KR", sourceRef);
    expect(canonicalJson(again)).toBe(canonicalJson(bundle));
    expect(renderReviewHtml(again)).toBe(renderReviewHtml(bundle));
    expect(canonicalJson(createReviewDecisions(again))).toBe(
      canonicalJson(createReviewDecisions(bundle)),
    );
    expect(bundle.sourceBinding.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "pnpm-lock.yaml" }),
        expect.objectContaining({ path: "scripts/localization-review.ts" }),
        expect.objectContaining({ path: "apps/server/src/starter-localization.ts" }),
        expect.objectContaining({ path: "apps/web/lib/presentation-template-locales/ko-KR.json" }),
        expect.objectContaining({ path: "packages/contracts/src/surveys.ts" }),
      ]),
    );
    expect(bundle.sourceBinding.canonicalContentHash).toBe(
      contentHash(bundle.items.map(({ id, englishHash }) => ({ id, englishHash }))),
    );
  });

  it("exposes full generated notes, numeric answers, data and Survey-only context without copying questions twice", () => {
    const presentation = bundle.items.find(
      (item) => item.id === "presentation/native-startup-pitch/draft",
    )!;
    expect(canonicalJson(presentation.target)).toContain('"speakerNotes"');
    expect(canonicalJson(presentation.target)).toContain('"readingOrder"');
    expect(canonicalJson(presentation.target)).toContain('"rows"');
    const numeric = bundle.items.find((item) => item.id === "round/technical-concept-check/draft")!;
    expect(canonicalJson(numeric.target)).toContain('"correctValue": "4"');
    const survey = bundle.items.find((item) => item.id.startsWith("survey/"))!;
    expect(survey.target).toMatchObject({
      required: true,
      unscored: true,
      questionContentReference: expect.stringMatching(/^round\/[^/]+\/draft$/),
    });
    expect(survey.target).not.toHaveProperty("questions");
    const defaults = bundle.items.find((item) => item.id === "defaults/question-scaffolds")!;
    expect(canonicalJson(defaults.target)).toContain(reviewExampleSource.replaceAll('"', '\\"'));
  });

  it("normalizes generated fields/references while preserving authored UUIDs, dollar tokens and HTML", () => {
    const q1 = "00000000-0000-4000-8000-000000000001";
    const q2 = "00000000-0000-4000-8000-000000000002";
    const node = "00000000-0000-4000-8000-000000000003";
    const scene = {
      title: q1,
      explanation: reviewExampleSource,
      experiencePreset: { id: "focus" },
      questions: [
        { id: q1, prompt: q2, linkedRecheckQuestionId: q2 },
        { id: q2, linkedRecheckQuestionId: null },
      ],
      blocks: [
        {
          id: "00000000-0000-4000-8000-000000000004",
          scene: { nodes: [{ id: node, text: q1 }], readingOrder: [node] },
        },
      ],
    };
    const original = structuredClone(scene);
    const normalized = normalizeGeneratedIds(scene) as any;
    expect(normalized.questions[0].id).toBe("generated:/questions/0/id");
    expect(normalized.questions[0].linkedRecheckQuestionId).toBe("generated:/questions/1/id");
    expect(normalized.blocks[0].scene.readingOrder).toEqual([
      "generated:/blocks/0/scene/nodes/0/id",
    ]);
    expect(normalized.blocks[0].scene.nodes[0].text).toBe(q1);
    expect(normalized.questions[0].prompt).toBe(q2);
    expect(normalized.title).toBe(q1);
    expect(normalized.explanation).toBe(reviewExampleSource);
    expect(normalized.experiencePreset.id).toBe("focus");
    expect(scene).toEqual(original);
    expect(normalizeGeneratedIds(normalized)).toEqual(normalized);
    expect(() =>
      normalizeGeneratedIds({ questions: [{ id: q1, linkedRecheckQuestionId: q2 }] }),
    ).toThrow(/unresolved/);
  });

  it("rejects semantic drift while permitting translated copy", () => {
    const english = {
      schemaVersion: 2,
      title: "Example",
      questions: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          type: "numeric",
          prompt: "Half of eight?",
          correctValue: "4",
          tolerance: "0",
          unit: "tasks",
          basePoints: 100,
          linkedRecheckQuestionId: null,
        },
      ],
      blocks: [
        {
          scene: {
            nodes: [
              { type: "table", rows: [["Example", "10"]] },
              { type: "chart", series: [{ name: "Value", values: [10, 20] }] },
            ],
          },
        },
      ],
    };
    const translated = structuredClone(english);
    translated.title = "Exemple";
    translated.questions[0]!.prompt = "La moitié de huit ?";
    translated.questions[0]!.unit = "tâches";
    expect(() => assertInvariantParity(english, translated, "example")).not.toThrow();
    for (const mutate of [
      (draft: typeof english) => {
        draft.schemaVersion = 8;
      },
      (draft: typeof english) => {
        draft.questions[0]!.basePoints = 0;
      },
      (draft: typeof english) => {
        draft.questions[0]!.correctValue = "5";
      },
      (draft: typeof english) => {
        draft.questions[0]!.tolerance = "1";
      },
      (draft: typeof english) => {
        draft.blocks[0]!.scene.nodes[0]!.rows![0]![1] = "11";
      },
      (draft: typeof english) => {
        draft.blocks[0]!.scene.nodes[1]!.series![0]!.values[0] = 11;
      },
    ]) {
      const altered = structuredClone(translated);
      mutate(altered);
      expect(() => assertInvariantParity(english, altered, "example")).toThrow(/invariant/);
    }
    const changedAnswer = structuredClone(
      bundle.items.find((item) => item.id === "round/percentage-check/draft")!.target,
    ) as any;
    const originalAnswer = structuredClone(changedAnswer);
    changedAnswer.questions[0].choices[0].isCorrect = true;
    expect(() => assertInvariantParity(originalAnswer, changedAnswer, "answer key")).toThrow(
      /invariant/,
    );
  });

  it("renders every source byte as inert text with browser-native Find and language boundaries", () => {
    const malicious = "</pre><script>alert('x')</script><img src=x onerror=alert(1)>& $& {title}";
    const changed = structuredClone(bundle);
    changed.items[0]!.target = { text: malicious };
    const html = renderReviewHtml(changed);
    expect(html).toContain(escapeHtml(malicious));
    expect(html).not.toMatch(/<script\b|<img\b|\bonclick=/i);
    expect(html).toContain("default-src 'none'");
    expect(html).toContain('lang="en-CA"');
    expect(html).toContain('lang="ko-KR"');
    expect(html).toContain("browser’s Find");
    expect(html.match(/<article>/g)).toHaveLength(bundle.items.length);
  });

  it("keeps pending/issues incomplete and treats complete records as human statements only", () => {
    const pending = createReviewDecisions(bundle);
    expect(checkReviewDecisions(bundle, pending).complete).toBe(false);
    const completed = completedReview();
    expect(checkReviewDecisions(bundle, completed)).toMatchObject({
      complete: true,
      nativeAcceptance: false,
      referenceOnly: false,
    });
    completed.entries[0]!.decision = "needs-change";
    completed.entries[0]!.issue = "Synthetic test issue: check the question wording in context.";
    expect(checkReviewDecisions(bundle, completed)).toMatchObject({
      complete: false,
      needsChange: 1,
    });
  });

  it.each([
    [
      "locale",
      (review: any) => {
        review.locale = "fr-FR";
      },
      /locale/,
    ],
    [
      "version",
      (review: any) => {
        review.recordVersion = 2;
      },
      /version/,
    ],
    [
      "bundle binding",
      (review: any) => {
        review.bundleHash = "sha256:" + "0".repeat(64);
      },
      /binding/,
    ],
    [
      "source binding",
      (review: any) => {
        review.sourceBindingHash = "sha256:" + "0".repeat(64);
      },
      /binding/,
    ],
    [
      "English item hash",
      (review: any) => {
        review.entries[0].englishHash = "sha256:" + "0".repeat(64);
      },
      /hashes/,
    ],
    [
      "target item hash",
      (review: any) => {
        review.entries[0].targetHash = "sha256:" + "0".repeat(64);
      },
      /hashes/,
    ],
    [
      "duplicate",
      (review: any) => {
        review.entries.push(review.entries[0]);
      },
      /duplicate/,
    ],
    [
      "unknown",
      (review: any) => {
        review.entries[0].itemId = "unknown";
      },
      /unknown/,
    ],
    [
      "missing",
      (review: any) => {
        review.entries.pop();
      },
      /incomplete/,
    ],
    [
      "extra field",
      (review: any) => {
        review.entries[0].approved = true;
      },
      /unknown fields/,
    ],
    [
      "missing field",
      (review: any) => {
        delete review.entries[0].reviewedAt;
      },
      /missing/,
    ],
    [
      "malformed entries",
      (review: any) => {
        review.entries = {};
      },
      /array/,
    ],
    [
      "invalid decision",
      (review: any) => {
        review.entries[0].decision = "approved";
      },
      /decision/,
    ],
    [
      "unreviewed acceptance",
      (review: any) => {
        review.entries[0].reviewerReference = null;
      },
      /reviewer/,
    ],
    [
      "invalid date",
      (review: any) => {
        review.entries[0].reviewedAt = "2026-02-30T12:00:00.000Z";
      },
      /timestamp/,
    ],
    [
      "future date",
      (review: any) => {
        review.entries[0].reviewedAt = "2999-01-01T12:00:00.000Z";
      },
      /future/,
    ],
    [
      "missing issue",
      (review: any) => {
        review.entries[0].decision = "needs-change";
      },
      /issue/,
    ],
    [
      "unresolved acceptance",
      (review: any) => {
        review.entries[0].issue = "Unresolved";
      },
      /unresolved/,
    ],
    [
      "pending provenance",
      (review: any) => {
        review.entries[0].decision = "pending";
      },
      /pending/,
    ],
  ] as const)("rejects %s records", (_label, mutate, error) => {
    const review = completedReview();
    mutate(review);
    expect(() => checkReviewDecisions(bundle, review)).toThrow(error);
  });

  it("rejects modified packet content and dirty source bytes even with the same source Git SHA", async () => {
    await expect(buildReviewBundle("ko-KR", "0".repeat(40))).rejects.toThrow(/candidate Git HEAD/);
    const modified = structuredClone(bundle);
    modified.items[0]!.target = "Changed after review";
    await expect(validateCurrentReview(modified, completedReview())).rejects.toThrow(/stale/);
    const root = await mkdtemp(resolve(tmpdir(), "localization-source-binding-"));
    try {
      await writeFile(resolve(root, ".git"), `gitdir: ${resolve(".git")}\n`);
      for (const file of bundle.sourceBinding.files) {
        const destination = resolve(root, file.path);
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, await readFile(resolve(file.path)));
      }
      const changed = resolve(root, "apps/web/lib/presentation-template-locales/ko-KR.json");
      await writeFile(changed, (await readFile(changed, "utf8")) + "\n");
      await expect(validateCurrentReview(bundle, completedReview(), root)).rejects.toThrow(/stale/);
      expect(bundle.sourceBinding.sourceRef).toBe(sourceRef);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("provides export/check modes without overwriting human work or claiming pending acceptance", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "localization-review-cli-"));
    try {
      const exported = await runLocalizationReview([
        "export",
        "--locale",
        "ko-KR",
        "--source-ref",
        sourceRef,
        "--out",
        directory,
      ]);
      expect(exported).toMatchObject({ exitCode: 0 });
      const decisionPath = resolve(directory, "decisions.json");
      const original = await readFile(decisionPath, "utf8");
      const result = await runLocalizationReview([
        "check",
        "--bundle",
        resolve(directory, "bundle.json"),
        "--decisions",
        decisionPath,
      ]);
      expect(result.exitCode).toBe(2);
      expect(result.message).toContain("no gates updated");
      await expect(
        runLocalizationReview([
          "export",
          "--locale",
          "ko-KR",
          "--source-ref",
          sourceRef,
          "--out",
          directory,
        ]),
      ).rejects.toThrow(/already exists/);
      expect(await readFile(decisionPath, "utf8")).toBe(original);
      expect(await readFile(resolve(directory, "review.html"), "utf8")).toContain("<article>");
      for (const args of [
        [],
        ["export"],
        ["export", "--locale", "ko-KR", "--locale", "ko-KR"],
        ["check", "--wat", "value"],
      ])
        await expect(runLocalizationReview(args)).rejects.toThrow(/CLI option|usage/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it("executes the real tsx entry point with workspace aliases and pending-only output", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "localization-review-process-"));
    try {
      const output = execFileSync(
        resolve("node_modules/.bin/tsx"),
        [
          "--tsconfig",
          "scripts/localization-review.tsconfig.json",
          "scripts/localization-review.ts",
          "export",
          "--locale",
          "ko-KR",
          "--source-ref",
          sourceRef,
          "--out",
          directory,
        ],
        { encoding: "utf8", timeout: 20_000 },
      );
      expect(output).toContain("pending review items for ko-KR");
      const actual = JSON.parse(
        await readFile(resolve(directory, "bundle.json"), "utf8"),
      ) as ReviewBundle;
      expect(actual.coverage).toEqual(bundle.coverage);
      expect(
        actual.items.find((item) => item.id === "presentation/native-startup-pitch/definition")!
          .target,
      ).not.toEqual(
        actual.items.find((item) => item.id === "presentation/native-startup-pitch/definition")!
          .english,
      );
      expect(
        checkReviewDecisions(
          actual,
          JSON.parse(await readFile(resolve(directory, "decisions.json"), "utf8")),
        ),
      ).toMatchObject({ complete: false, nativeAcceptance: false, pending: actual.items.length });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
});
