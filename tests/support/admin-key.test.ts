import { randomBytes } from "node:crypto";
import { chmod, lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { localAdminCredentialKey } from "../../scripts/ops/admin-key.mjs";

const directories: string[] = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pollingpops-admin-key-"));
  directories.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("local administrator key bootstrap", () => {
  it("persists one private key across concurrent startup and restart", async () => {
    const root = await fixture();
    const keys = await Promise.all(
      Array.from({ length: 8 }, () => localAdminCredentialKey(root, {})),
    );
    expect(new Set(keys).size).toBe(1);
    expect(Buffer.from(keys[0]!, "base64").length).toBe(32);
    expect(await localAdminCredentialKey(root, {})).toBe(keys[0]);
    expect((await lstat(join(root, "data/admin"))).mode & 0o777).toBe(0o700);
    expect((await lstat(join(root, "data/admin/credential.key"))).mode & 0o777).toBe(0o600);
  });

  it("honors explicit environment and dotenv keys without writing a replacement", async () => {
    const root = await fixture();
    const configured = randomBytes(32).toString("base64");
    const explicit = randomBytes(32).toString("base64");
    await writeFile(join(root, ".env"), `OPERATOR_CREDENTIAL_KEY='${configured}'\n`);
    expect(await localAdminCredentialKey(root, {})).toBe(configured);
    expect(await localAdminCredentialKey(root, { OPERATOR_CREDENTIAL_KEY: explicit })).toBe(
      explicit,
    );
    await expect(lstat(join(root, "data"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      localAdminCredentialKey(root, { OPERATOR_CREDENTIAL_KEY: "invalid" }),
    ).rejects.toThrow("base64-encoded 32-byte key");
  });

  it("refuses an exposed or symlinked saved key without replacing it", async () => {
    const root = await fixture();
    const key = await localAdminCredentialKey(root, {});
    const path = join(root, "data/admin/credential.key");
    await chmod(path, 0o644);
    await expect(localAdminCredentialKey(root, {})).rejects.toThrow("private file");
    expect((await readFile(path, "utf8")).trim()).toBe(key);
    await rm(path);
    const target = join(root, "outside-key");
    await writeFile(target, key, { mode: 0o600 });
    await symlink(target, path);
    await expect(localAdminCredentialKey(root, {})).rejects.toThrow();
    expect(await readFile(target, "utf8")).toBe(key);
  });

  it("refuses an exposed key directory", async () => {
    const root = await fixture();
    await mkdir(join(root, "data/admin"), { recursive: true, mode: 0o755 });
    await expect(localAdminCredentialKey(root, {})).rejects.toThrow("private directory");
  });
});
