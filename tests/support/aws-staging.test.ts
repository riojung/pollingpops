import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { promotionArguments } from "../../scripts/ops/aws-promote.mjs";
import {
  parseEmulatorCredentials,
  REQUIRED_STAGING_CHECKS,
  selectedImages,
  sha256,
  validateStagingQualification,
} from "../../scripts/ops/aws-staging.mjs";

const buildId = "a".repeat(40);
const production = JSON.parse(
  await readFile(new URL("../../config/deploy/production.json", import.meta.url), "utf8"),
);
function image(component: string, digest: string) {
  const repository = `${production.imageRepository}-${component}`;
  return {
    repository,
    tag: `${repository}:production-${buildId}`,
    digest,
    ref: `${repository}@${digest}`,
    signed: true,
  };
}
const manifest = {
  schemaVersion: 1,
  environment: "production",
  buildId,
  createdAt: "2026-11-15T10:00:00.000Z",
  apiRouting: "same-origin",
  nextPublicApiUrl: "",
  imagePlatform: production.imagePlatform,
  source: { commit: buildId, dirty: false },
  images: {
    server: image("server", `sha256:${"b".repeat(64)}`),
    web: image("web", `sha256:${"c".repeat(64)}`),
  },
};
const bytes = Buffer.from(JSON.stringify(manifest));
const now = Date.parse("2026-11-15T12:00:00.000Z");
function receipt() {
  return {
    schemaVersion: 1,
    kind: "local-aws-emulator",
    emulatorVersion: "1.0.385",
    passed: true,
    completedAt: "2026-11-15T11:00:00.000Z",
    candidate: {
      kind: "release",
      buildId,
      manifestSha256: sha256(bytes),
      images: { server: manifest.images.server.ref, web: manifest.images.web.ref },
      imagePlatform: manifest.imagePlatform,
    },
    checks: Object.fromEntries(REQUIRED_STAGING_CHECKS.map((check) => [check, true])),
  };
}
describe("local AWS staging qualification", () => {
  it("does not qualify a control runtime absent from the rehearsal", () => {
    const withControl = {
      ...manifest,
      images: { ...manifest.images, control: image("control", `sha256:${"d".repeat(64)}`) },
    };
    expect(() => validateStagingQualification(receipt(), withControl, bytes, now)).toThrow(
      /separate qualification/,
    );
  });
  it("accepts exact, recent release evidence", () =>
    expect(validateStagingQualification(receipt(), manifest, bytes, now)).toEqual(receipt()));
  it("rejects a working-tree rehearsal for production", () => {
    const data = receipt();
    data.candidate.kind = "development";
    expect(() => validateStagingQualification(data, manifest, bytes, now)).toThrow(
      /release rehearsal/,
    );
  });
  it("binds both source and exact manifest bytes", () => {
    expect(() =>
      validateStagingQualification(
        receipt(),
        manifest,
        Buffer.concat([bytes, Buffer.from("\n")]),
        now,
      ),
    ).toThrow(/exact release manifest/);
    const changed = structuredClone(manifest);
    changed.buildId = "d".repeat(40);
    changed.source.commit = changed.buildId;
    for (const record of Object.values(changed.images))
      record.tag = `${record.repository}:production-${changed.buildId}`;
    expect(() => validateStagingQualification(receipt(), changed, bytes, now)).toThrow(
      /exact release manifest/,
    );
  });
  it("requires a complete signed production same-origin manifest", () => {
    const unsigned = structuredClone(manifest);
    unsigned.images.web.signed = false;
    expect(() => validateStagingQualification(receipt(), unsigned, bytes, now)).toThrow(
      /must be signed/,
    );
    expect(() =>
      validateStagingQualification(
        receipt(),
        { ...manifest, environment: "development" },
        bytes,
        now,
      ),
    ).toThrow(/does not match target/);
    const legacy = { ...manifest, nextPublicApiUrl: production.publicApiUrl };
    Reflect.deleteProperty(legacy, "apiRouting");
    expect(() => validateStagingQualification(receipt(), legacy, bytes, now)).toThrow(
      /production same-origin manifest/,
    );
    expect(() =>
      validateStagingQualification(
        receipt(),
        { ...manifest, source: { commit: buildId, dirty: true } },
        bytes,
        now,
      ),
    ).toThrow(/clean source/);
  });
  it("rejects malformed proof objects and a different image platform", () => {
    for (const data of [null, [], { ...receipt(), candidate: [] }, { ...receipt(), checks: [] }])
      expect(() => validateStagingQualification(data, manifest, bytes, now)).toThrow();
    const data = receipt();
    data.candidate.imagePlatform =
      manifest.imagePlatform === "linux/amd64" ? "linux/arm64" : "linux/amd64";
    expect(() => validateStagingQualification(data, manifest, bytes, now)).toThrow(
      /image platform differs/,
    );
  });
  it("selects unchanged reviewed production digests and rejects legacy or unsigned releases", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pollingpops-release-rehearsal-"));
    const path = join(directory, "manifest.json");
    try {
      await writeFile(path, bytes);
      expect(await selectedImages(path)).toEqual({
        kind: "release",
        buildId,
        manifestSha256: sha256(bytes),
        images: { server: manifest.images.server.ref, web: manifest.images.web.ref },
        imagePlatform: manifest.imagePlatform,
      });
      const legacy = { ...manifest, nextPublicApiUrl: production.publicApiUrl };
      Reflect.deleteProperty(legacy, "apiRouting");
      await writeFile(path, JSON.stringify(legacy));
      await expect(selectedImages(path)).rejects.toThrow(/apiRouting does not match/);
      const unsigned = structuredClone(manifest);
      unsigned.images.server.signed = false;
      await writeFile(path, JSON.stringify(unsigned));
      await expect(selectedImages(path)).rejects.toThrow(/must be signed/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it.each(["server", "web"])("rejects substituted %s image", (component) => {
    const data = receipt();
    data.candidate.images[component as "server" | "web"] += "-changed";
    expect(() => validateStagingQualification(data, manifest, bytes, now)).toThrow(
      /digest differs/,
    );
  });
  it.each(REQUIRED_STAGING_CHECKS)("requires successful %s", (check) => {
    const data = receipt();
    data.checks[check] = false;
    expect(() => validateStagingQualification(data, manifest, bytes, now)).toThrow(
      /checks are missing/,
    );
  });
  it.each(["2026-11-07T00:00:00Z", "2026-11-16T00:00:00Z", "invalid"])(
    "rejects stale or invalid time %s",
    (completedAt) => {
      expect(() =>
        validateStagingQualification({ ...receipt(), completedAt }, manifest, bytes, now),
      ).toThrow(/past seven days/);
    },
  );
  it("requires explicit success and the qualified emulator version", () => {
    expect(() =>
      validateStagingQualification({ ...receipt(), passed: false }, manifest, bytes, now),
    ).toThrow();
    expect(() =>
      validateStagingQualification(
        { ...receipt(), emulatorVersion: "latest" },
        manifest,
        bytes,
        now,
      ),
    ).toThrow();
  });
  it("reads only supplied generated credentials, never ambient AWS credentials", () => {
    expect(
      parseEmulatorCredentials(
        "[default]\naws_access_key_id = local-key\naws_secret_access_key = local-secret\n",
      ),
    ).toEqual({ accessKeyId: "local-key", secretAccessKey: "local-secret" });
    expect(() => parseEmulatorCredentials("[default]\naws_access_key_id=local-key")).toThrow(
      /credentials/,
    );
  });
  it("keeps upstream certificate verification and signed host/port in the gateway", async () => {
    const caddy = await readFile(
      new URL("../../infra/aws-emulator/Caddyfile", import.meta.url),
      "utf8",
    );
    expect(caddy).toContain("tls_server_name localhost");
    expect(caddy).toContain("tls_trust_pool file");
    expect(caddy).toContain("{http.request.hostport}");
    expect(caddy).not.toContain("tls_insecure_skip_verify");
    expect(caddy).toContain("Access-Control-Allow-Origin http://localhost:19180");
  });
});
describe("production promotion command", () => {
  it("forwards manifest and deploy gates as argv without rebuilding", () => {
    expect(
      promotionArguments([
        "--aws-config",
        "infra/aws/production.json",
        "--receipt=artifacts/evidence.json",
        "--manifest",
        "release.json",
        "--dry-run",
      ]),
    ).toEqual([
      "production",
      "--aws-config",
      "infra/aws/production.json",
      "--local-staging-receipt",
      "artifacts/evidence.json",
      "--manifest",
      "release.json",
      "--dry-run",
    ]);
  });
  it.each([[], ["--receipt", "x"], ["--manifest"], ["--receipt", "a", "--receipt", "b"]])(
    "rejects missing or duplicate proof %j",
    (args) => expect(() => promotionArguments(args)).toThrow(),
  );
  it.each(["--rollback", "--environment=development", "staging", "--local-staging-receipt"])(
    "cannot redirect promotion with %s",
    (flag) => expect(() => promotionArguments([flag])).toThrow(),
  );
});
