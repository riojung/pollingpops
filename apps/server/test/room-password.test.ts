import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { hashRoomPassword, verifyRoomPassword } from "../src/room-password.js";

describe("room password verifiers", () => {
  const password = ` ${randomBytes(16).toString("base64url")} `;
  let encoded: string;
  beforeAll(async () => {
    encoded = await hashRoomPassword(password);
  });

  it("stores only a salted verifier and checks the exact password", async () => {
    expect(encoded).not.toContain(password.trim());
    expect(await verifyRoomPassword(password, encoded)).toBe(true);
    expect(await verifyRoomPassword(password.trim(), encoded)).toBe(false);
    expect(await verifyRoomPassword(undefined, encoded)).toBe(false);
    expect(await verifyRoomPassword("", encoded)).toBe(false);
  });

  it("uses unique salts without a creation context", async () => {
    const next = await hashRoomPassword(password);
    expect(next).not.toBe(encoded);
    expect(await verifyRoomPassword(password, next)).toBe(true);
  });

  it("keeps idempotent creation stable while separating rooms and changed passwords", async () => {
    const context = randomBytes(32).toString("hex");
    const original = await hashRoomPassword(password, context);
    expect(await hashRoomPassword(password, context)).toBe(original);
    expect(await hashRoomPassword(password, `${context}:other-room`)).not.toBe(original);
    expect(await hashRoomPassword(`${password}x`, context)).not.toBe(original);
  });

  it("keeps legacy open rooms open and fails closed on malformed or hostile parameters", async () => {
    expect(await verifyRoomPassword(undefined, undefined)).toBe(true);
    expect(await verifyRoomPassword(undefined, null)).toBe(true);
    for (const malformed of [
      "",
      "scrypt$bad",
      encoded.replace("16384", "1073741824"),
      `${encoded}x`,
    ])
      expect(await verifyRoomPassword(password, malformed)).toBe(false);
    expect(await verifyRoomPassword("x".repeat(129), encoded)).toBe(false);
  });

  it("rejects out-of-policy creation without including the password in the error", async () => {
    for (const invalid of ["", " ".repeat(8), "x".repeat(7), "x".repeat(129)])
      await expect(hashRoomPassword(invalid)).rejects.toThrow(
        "Use a room password containing 8 to 128 characters",
      );
  });
});
