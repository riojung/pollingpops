import { randomBytes, randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import process from "node:process";
import { constants } from "node:fs";
import { mkdir, open, readFile, lstat, link, unlink } from "node:fs/promises";
import { join } from "node:path";

function checkedKey(value) {
  const key = value.trim();
  if (!/^[A-Za-z0-9+/]{43}=$/.test(key) || Buffer.from(key, "base64").toString("base64") !== key)
    throw new Error("OPERATOR_CREDENTIAL_KEY must be a base64-encoded 32-byte key");
  return key;
}

/** Local development only. Keep the wrapping key outside Git and out of command output. */
export async function localAdminCredentialKey(root, environment = process.env) {
  if (environment.OPERATOR_CREDENTIAL_KEY?.trim())
    return checkedKey(environment.OPERATOR_CREDENTIAL_KEY);
  let dotenv = "";
  try {
    dotenv = await readFile(join(root, ".env"), "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const configured = dotenv.match(
    /^\s*(?:export\s+)?OPERATOR_CREDENTIAL_KEY\s*=\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^#\r\n]*))/m,
  );
  const value = configured?.[1] ?? configured?.[2] ?? configured?.[3];
  if (value?.trim()) return checkedKey(value);
  const directory = join(root, "data", "admin");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0)
    throw new Error("Local admin key directory must be a private directory (mode 0700)");
  const path = join(directory, "credential.key");
  const temporary = join(directory, `.credential-${randomUUID()}`);
  const file = await open(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
    0o600,
  );
  try {
    await file.writeFile(`${randomBytes(32).toString("base64")}\n`);
  } finally {
    await file.close();
  }
  try {
    await link(temporary, path);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  } finally {
    await unlink(temporary);
  }
  const saved = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await saved.stat();
    if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size > 128)
      throw new Error("Local admin key must be a private file (mode 0600)");
    return checkedKey(await saved.readFile("utf8"));
  } finally {
    await saved.close();
  }
}
