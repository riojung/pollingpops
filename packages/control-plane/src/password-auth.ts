import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import {
  PASSWORD_OPERATOR_ISSUER,
  type OperatorRole,
  type PlatformOperatorPasswordCredential,
  type PlatformOperatorSession,
  type PlatformRepository,
} from "@openround/db";
import { isOperatorCredentialKey, isPasswordControlEnabled, type ControlConfig } from "./config.js";
import { OperatorError, operatorSessionLifetimeMs, tokenHash } from "./auth.js";

export { PASSWORD_OPERATOR_ISSUER } from "@openround/db";
const passwordCost = { cost: 32768, blockSize: 8, parallelization: 3 } as const;
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const invalidLogin = () =>
  new OperatorError(401, "INVALID_CREDENTIALS", "Administrator sign-in failed");

export function normalizeOperatorUsername(value: string): string {
  const username = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(username))
    throw new OperatorError(
      400,
      "INVALID_USERNAME",
      "Use 3–64 letters, numbers, periods, underscores or hyphens for the username",
    );
  return username;
}
function encodeBase32(bytes: Buffer): string {
  let accumulator = 0;
  let bits = 0;
  let result = "";
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += alphabet[(accumulator >>> bits) & 31];
    }
  }
  if (bits) result += alphabet[(accumulator << (5 - bits)) & 31];
  return result;
}
function decodeBase32(value: string): Buffer {
  if (!/^[A-Z2-7]{32,103}$/.test(value)) throw new Error("Invalid authenticator secret");
  let accumulator = 0;
  let bits = 0;
  const bytes: number[] = [];
  for (const character of value) {
    accumulator = (accumulator << 5) | alphabet.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((accumulator >>> bits) & 255);
    }
  }
  const result = Buffer.from(bytes);
  if (result.length < 20 || result.length > 64 || encodeBase32(result) !== value)
    throw new Error("Invalid authenticator secret");
  return result;
}
export function generateOperatorTotpSecret(): string {
  return encodeBase32(randomBytes(20));
}
/** RFC 6238 SHA-1, 30-second steps and six decimal digits: https://www.rfc-editor.org/rfc/rfc6238 */
export function operatorTotpCode(secret: string, now = new Date()): string {
  return codeForCounter(decodeBase32(secret), Math.floor(now.getTime() / 30_000));
}
function codeForCounter(secret: Buffer, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", secret).update(message).digest();
  const offset = digest[digest.length - 1]! & 15;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}
function matchingCounter(secret: string, code: string, now: Date): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const key = decodeBase32(secret);
  const counter = Math.floor(now.getTime() / 30_000);
  let match: number | null = null;
  for (const candidate of [counter - 1, counter, counter + 1]) {
    if (candidate < 0) continue;
    if (timingSafeEqual(Buffer.from(code), Buffer.from(codeForCounter(key, candidate))))
      match = candidate;
  }
  return match;
}
function credentialKey(config: ControlConfig): Buffer {
  if (!config.OPERATOR_CREDENTIAL_KEY || !isOperatorCredentialKey(config.OPERATOR_CREDENTIAL_KEY))
    throw new OperatorError(
      503,
      "CREDENTIAL_KEY_REQUIRED",
      "Operator credential encryption is unavailable",
    );
  return Buffer.from(config.OPERATOR_CREDENTIAL_KEY, "base64");
}
function credentialAad(username: string, operatorId: string): Buffer {
  return Buffer.from(JSON.stringify(["pollingpops-operator-totp-v1", username, operatorId]));
}
function encryptSecret(
  secret: string,
  username: string,
  operatorId: string,
  config: ControlConfig,
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", credentialKey(config), iv);
  cipher.setAAD(credentialAad(username, operatorId));
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}
function decryptSecret(
  credential: PlatformOperatorPasswordCredential,
  config: ControlConfig,
): string {
  const [version, iv, tag, ciphertext, extra] = credential.totpCiphertext.split(".");
  if (
    version !== "v1" ||
    !iv ||
    !tag ||
    !ciphertext ||
    extra ||
    Buffer.from(iv, "base64url").length !== 12 ||
    Buffer.from(tag, "base64url").length !== 16 ||
    ciphertext.length > 256
  )
    throw new Error("Invalid encrypted authenticator secret");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    credentialKey(config),
    Buffer.from(iv, "base64url"),
  );
  cipher.setAAD(credentialAad(credential.username, credential.operatorId));
  cipher.setAuthTag(Buffer.from(tag, "base64url"));
  const secret = Buffer.concat([
    cipher.update(Buffer.from(ciphertext, "base64url")),
    cipher.final(),
  ]).toString("utf8");
  decodeBase32(secret);
  return secret;
}
// OWASP's N=2^15, r=8, p=3 scrypt profile: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
// Bound both running work and queued work before entering the native crypto worker pool.
let activeScrypt = 0;
const scryptWaiters: Array<() => void> = [];
async function acquireScryptSlot(): Promise<void> {
  if (activeScrypt < 2) {
    activeScrypt++;
    return;
  }
  if (scryptWaiters.length >= 8)
    throw new OperatorError(503, "AUTH_BUSY", "Administrator sign-in is temporarily unavailable");
  await new Promise<void>((resolve) => scryptWaiters.push(resolve));
}
function releaseScryptSlot(): void {
  const next = scryptWaiters.shift();
  if (next) next();
  else activeScrypt--;
}
async function derivePassword(password: string, salt: Buffer): Promise<Buffer> {
  await acquireScryptSlot();
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      scrypt(
        password,
        salt,
        32,
        {
          N: passwordCost.cost,
          r: passwordCost.blockSize,
          p: passwordCost.parallelization,
          maxmem: 64 * 1024 * 1024,
        },
        (error, key) => (error ? reject(error) : resolve(key)),
      );
    });
  } finally {
    releaseScryptSlot();
  }
}
async function verifyPassword(
  password: string,
  credential: PlatformOperatorPasswordCredential | null,
): Promise<boolean> {
  const verifier = credential?.passwordVerifier;
  const valid = Boolean(
    verifier &&
    verifier.algorithm === "scrypt" &&
    verifier.cost === passwordCost.cost &&
    verifier.blockSize === passwordCost.blockSize &&
    verifier.parallelization === passwordCost.parallelization &&
    /^[A-Za-z0-9_-]{22}$/.test(verifier.salt) &&
    /^[A-Za-z0-9_-]{43}$/.test(verifier.hash),
  );
  const hash = await derivePassword(
    password,
    valid ? Buffer.from(verifier!.salt, "base64url") : Buffer.alloc(16),
  );
  return (
    timingSafeEqual(hash, valid ? Buffer.from(verifier!.hash, "base64url") : Buffer.alloc(32)) &&
    valid
  );
}
export interface ProvisionPasswordOperatorInput {
  username: string;
  password: string;
  name: string;
  role: OperatorRole;
  totpSecret?: string;
  /** Explicit credential replacement, which revokes all existing sessions. */
  reset?: boolean;
  requestId?: string;
}
/** Offline administration only. The enrollment material must never be exposed by a public route. */
export async function provisionPasswordOperator(
  platform: PlatformRepository,
  config: ControlConfig,
  input: ProvisionPasswordOperatorInput,
  now = new Date(),
) {
  if (!isPasswordControlEnabled(config))
    throw new OperatorError(
      404,
      "PASSWORD_AUTH_DISABLED",
      "Password administrator sign-in is unavailable",
    );
  const username = normalizeOperatorUsername(input.username);
  if (
    typeof input.password !== "string" ||
    Buffer.byteLength(input.password, "utf8") < 12 ||
    Buffer.byteLength(input.password, "utf8") > 1024
  )
    throw new OperatorError(
      400,
      "INVALID_PASSWORD",
      "Use a password between 12 and 1024 UTF-8 bytes",
    );
  if (
    !["founder", "operations", "support", "billing", "readonly"].includes(input.role) ||
    typeof input.name !== "string" ||
    !input.name.trim() ||
    input.name.length > 80
  )
    throw new OperatorError(
      400,
      "INVALID_OPERATOR",
      "An explicit operator role and display name are required",
    );
  const secret = input.totpSecret ?? generateOperatorTotpSecret();
  decodeBase32(secret);
  const salt = randomBytes(16);
  const hash = await derivePassword(input.password, salt);
  const operator = await platform.withOperatorTransaction(async (repository) => {
    const previous = await repository.getOperatorByIdentity(PASSWORD_OPERATOR_ISSUER, username);
    const previousCredential = await repository.getOperatorPasswordCredential(username);
    if ((previous || previousCredential) && !input.reset)
      throw new OperatorError(
        409,
        "OPERATOR_EXISTS",
        "The username already exists; use an explicit credential reset",
      );
    const operator = await repository.provisionOperator({
      issuer: PASSWORD_OPERATOR_ISSUER,
      subject: username,
      name: input.name.trim(),
      role: input.role,
      capabilities: previous?.capabilities ?? [],
      active: previous?.active ?? true,
    });
    await repository.saveOperatorPasswordCredential(
      {
        username,
        operatorId: operator.id,
        passwordVerifier: {
          algorithm: "scrypt",
          salt: salt.toString("base64url"),
          hash: hash.toString("base64url"),
          ...passwordCost,
        },
        totpCiphertext: encryptSecret(secret, username, operator.id, config),
        lastUsedCounter: null,
        updatedAt: now,
      },
      previousCredential?.revision ?? null,
    );
    if (input.reset) {
      await repository.revokeOperatorSessions(operator.id);
      await repository.clearOperatorPasswordAttempts(tokenHash(`operator-login:${username}`));
    }
    await repository.appendAuditEvent({
      actorId: operator.id,
      organizationId: null,
      action: input.reset ? "operator.credentials.reset" : "operator.provision",
      targetId: operator.id,
      reason: input.reset
        ? "Offline administrator credential reset"
        : "Offline administrator credential provisioning",
      requestId: input.requestId ?? randomUUID(),
      before: previous ? { role: previous.role, active: previous.active } : null,
      after: { role: operator.role, active: operator.active, authMode: "password" },
    });
    return operator;
  });
  const issuer = "PollingPops Administrator";
  const uri = new URL(`otpauth://totp/${encodeURIComponent(`${issuer}:${username}`)}`);
  uri.search = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  }).toString();
  return { operator, totpSecret: secret, otpauthUri: uri.href };
}
export interface PasswordOperatorLoginInput {
  username: string;
  password: string;
  code: string;
  requestId: string;
  previousToken?: string;
}
export async function passwordOperatorLogin(
  platform: PlatformRepository,
  config: ControlConfig,
  input: PasswordOperatorLoginInput,
  now = new Date(),
) {
  if (!isPasswordControlEnabled(config))
    throw new OperatorError(
      404,
      "PASSWORD_AUTH_DISABLED",
      "Password administrator sign-in is unavailable",
    );
  let username = "";
  try {
    if (typeof input.username === "string" && input.username.length <= 128)
      username = normalizeOperatorUsername(input.username);
  } catch {
    /* Generic failure below. */
  }
  const rateKey = tokenHash(`operator-login:${username || String(input.username).slice(0, 128)}`);
  const allowed = await platform.withOperatorTransaction(async (repository) => {
    if (
      !(await repository.recordOperatorPasswordAttempt(tokenHash("operator-login-global"), now, {
        maxAttempts: 100,
        windowMs: 60_000,
      }))
    )
      return false;
    return repository.recordOperatorPasswordAttempt(rateKey, now);
  });
  if (!allowed)
    throw new OperatorError(
      429,
      "LOGIN_RATE_LIMITED",
      "Too many administrator sign-in attempts. Wait up to 15 minutes before trying again.",
    );
  const credential = username ? await platform.getOperatorPasswordCredential(username) : null;
  const boundedPassword =
    typeof input.password === "string" && Buffer.byteLength(input.password, "utf8") <= 1024;
  const validPassword = await verifyPassword(boundedPassword ? input.password : "", credential);
  let counter: number | null = null;
  try {
    if (credential && typeof input.code === "string")
      counter = matchingCounter(decryptSecret(credential, config), input.code, now);
  } catch {
    /* Corrupt or unavailable credentials fail closed. */
  }
  if (!credential || !boundedPassword || !validPassword || counter === null) throw invalidLogin();
  const acceptedCounter = counter;
  return platform.withOperatorTransaction(async (repository) => {
    const current = await repository.getOperatorPasswordCredential(username);
    const operator = current ? await repository.getOperator(current.operatorId) : null;
    if (
      !current ||
      current.revision !== credential.revision ||
      !operator?.active ||
      operator.issuer !== PASSWORD_OPERATOR_ISSUER ||
      operator.subject !== username ||
      !(await repository.consumeOperatorTotp(username, credential.revision, acceptedCounter, now))
    )
      throw invalidLogin();
    // Clear this username's reserved attempts only after both factors are accepted. The
    // global budget remains intact, and a failed session/audit write rolls this back too.
    await repository.clearOperatorPasswordAttempts(rateKey);
    const token = randomBytes(32).toString("base64url");
    const csrfToken = randomBytes(32).toString("base64url");
    const session: PlatformOperatorSession = {
      id: randomUUID(),
      operatorId: operator.id,
      tokenHash: tokenHash(token),
      csrfHash: tokenHash(csrfToken),
      authenticatedAt: now,
      lastSeenAt: now,
      createdAt: now,
      expiresAt: new Date(now.getTime() + operatorSessionLifetimeMs),
      revokedAt: null,
    };
    await repository.createOperatorSession(session);
    if (input.previousToken && input.previousToken.length <= 256)
      await repository.revokeOperatorSession(tokenHash(input.previousToken));
    await repository.appendAuditEvent({
      actorId: operator.id,
      organizationId: null,
      action: "operator.login",
      targetId: session.id,
      reason: "Password and authenticator verified administrator sign-in",
      requestId: input.requestId,
      before: null,
      after: { role: operator.role, authMode: "password" },
    });
    return { token, csrfToken, operator };
  });
}
