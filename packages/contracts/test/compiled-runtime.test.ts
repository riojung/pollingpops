import { spawnSync } from "node:child_process";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "tsup";
import { describe, expect, it } from "vitest";

describe("compiled sharing, reading, and practice contracts", () => {
  it("initializes every entry order and retains strict public schemas in native Node ESM", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openround-contract-runtime-"));
    const packageRoot = resolve(import.meta.dirname, "..");
    const entries = {
      sharing: "presentation-sharing",
      practice: "presentation-practice",
      reading: "presentation-assignments",
      index: "index",
    };
    try {
      // Match the server's ESM bundler and shared chunks, without Vite/TSX's module loader.
      await build({
        entry: Object.fromEntries(
          Object.entries(entries).map(([name, source]) => [
            name,
            join(packageRoot, "src", `${source}.ts`),
          ]),
        ),
        format: ["esm"],
        platform: "node",
        target: "node22",
        splitting: true,
        config: false,
        outDir: directory,
        outExtension: () => ({ js: ".mjs" }),
        external: ["zod", "@noble/hashes"],
        silent: true,
      });
      await symlink(join(packageRoot, "node_modules"), join(directory, "node_modules"));
      const validate = `
        import assert from "node:assert/strict";
        import { join } from "node:path";
        import { pathToFileURL } from "node:url";
        import { randomUUID } from "node:crypto";
        const modules = {};
        for (const name of process.argv.slice(2))
          modules[name] = await import(pathToFileURL(join(process.argv[1], name + ".mjs")));
        const { sharing, practice, reading, index } = modules;
        const now = "2026-11-08T00:00:00.000Z";
        const versionId = randomUUID();
        const create = { token: "a".repeat(43), requestId: randomUUID(), versionId, expiresAt: now };
        assert.equal(practice.CreatePresentationPracticeAssignmentSchema, sharing.CreatePresentationShareSchema);
        assert.deepEqual(practice.CreatePresentationPracticeAssignmentSchema.parse(create), create);
        assert.equal(practice.CreatePresentationPracticeAssignmentSchema.safeParse({ ...create, mode: "reading" }).success, false);
        assert.deepEqual(reading.CreatePresentationAssignmentSchema.parse(create), create);
        const metadata = { id: randomUUID(), versionId, createdAt: now, expiresAt: now, revokedAt: null };
        assert.deepEqual(sharing.PresentationShareMetadataSchema.parse(metadata), metadata);
        const assignment = { ...metadata, mode: "practice" };
        assert.deepEqual(practice.PresentationPracticeAssignmentMetadataSchema.parse(assignment), assignment);
        assert.equal(practice.PresentationPracticeAssignmentMetadataSchema.safeParse({ ...assignment, tokenHash: "secret" }).success, false);
        const question = {
          id: randomUUID(), kind: "question",
          question: { type: "single_select", prompt: "Choose one", mediaId: null, mediaAlt: null,
            choices: [{ id: randomUUID(), label: "A" }, { id: randomUUID(), label: "B" }] }
        };
        const content = {
          id: randomUUID(), kind: "content", layout: "title", mediaId: null, mediaAlt: null,
          textElements: [{ id: "title", role: "title", text: "Hello", region: "middle_center", order: 0 }]
        };
        const review = { schemaVersion: 1, versionId, version: 1, title: "Review", blocks: [content, question], sections: [], expiresAt: now };
        assert.deepEqual(index.PresentationLiveContentBlockSchema.parse(content), content);
        assert.deepEqual(sharing.PresentationReviewSchema.parse(review), review);
        assert.equal(sharing.PresentationReviewSchema.safeParse({ ...review, blocks: [{ ...content, speakerNotes: "secret" }] }).success, false);
        const preview = { assignment, review };
        assert.deepEqual(practice.PresentationPracticePreviewSchema.parse(preview), preview);
        assert.equal(practice.PresentationPracticePreviewSchema.safeParse({ ...preview, review: { ...review, blocks: [content] } }).success, false);
        assert.equal(practice.PresentationPracticePreviewSchema.safeParse({ ...preview, review: { ...review, blocks: [{ ...question, question: { ...question.question, type: "poll" } }] } }).success, false);
        const readingPreview = { assignment: { ...metadata, mode: "reading" }, review };
        assert.deepEqual(reading.PresentationAssignmentPreviewSchema.parse(readingPreview), readingPreview);
      `;
      for (const first of Object.keys(entries)) {
        const order = [first, ...Object.keys(entries).filter((name) => name !== first)];
        const result = spawnSync(
          process.execPath,
          ["--input-type=module", "-e", validate, directory, ...order],
          { encoding: "utf8", timeout: 10_000 },
        );
        expect(result.error, first).toBeUndefined();
        expect(result.status, `${first}: ${result.stderr}`).toBe(0);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
});
