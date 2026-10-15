import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// OWASP's 16 MiB scrypt configuration keeps audience admission memory bounded.
// https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt
const parameters = { N: 16_384, r: 8, p: 5, maxmem: 32 * 1024 * 1024 };
const prefix = "scrypt$16384$8$5$";
const verifierPattern = /^scrypt\$16384\$8\$5\$([a-f0-9]{32})\$([a-f0-9]{128})$/;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, parameters, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

/**
 * A unique creation context makes retries use the same expensive verifier. It must contain the
 * workspace, artifact kind and idempotency key, never the password or a fast password digest.
 * Unkeyed fast password fingerprints would bypass the protection supplied by scrypt.
 */
export async function hashRoomPassword(password: string, saltContext?: string): Promise<string> {
  if (password.length < 8 || password.length > 128 || !password.trim())
    throw new Error("Use a room password containing 8 to 128 characters");
  const salt = saltContext
    ? createHash("sha256").update(`room-password-salt-v1:${saltContext}`).digest().subarray(0, 16)
    : randomBytes(16);
  const key = await derive(password, salt);
  return `${prefix}${salt.toString("hex")}$${key.toString("hex")}`;
}

/** Legacy rooms have no verifier. Corrupt or unsupported verifiers always fail closed. */
export async function verifyRoomPassword(
  password: string | undefined,
  encoded: string | null | undefined,
): Promise<boolean> {
  if (encoded == null) return true;
  if (!password || password.length > 128) return false;
  const parsed = verifierPattern.exec(encoded);
  if (!parsed) return false;
  const expected = Buffer.from(parsed[2]!, "hex");
  const actual = await derive(password, Buffer.from(parsed[1]!, "hex"));
  return timingSafeEqual(actual, expected);
}
