import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export default async function setupBetaAuth() {
  // Playwright passes this private, per-run directory to every worker/project.
  const namespace = randomUUID();
  const directory = await mkdtemp(path.join(os.tmpdir(), `pollingpops-beta-auth-${namespace}-`));
  await chmod(directory, 0o700);
  process.env.BETA_E2E_AUTH_CACHE_DIR = directory;
  return async () => {
    await rm(directory, { recursive: true, force: true });
    delete process.env.BETA_E2E_AUTH_CACHE_DIR;
  };
}
