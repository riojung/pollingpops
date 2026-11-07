import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  presentationSourceFingerprintDigest,
  presentationTextAssistanceSourceDigest,
} from "../src/index";

describe("exact presentation source fingerprint digest", () => {
  it("hashes UTF-8 Unicode and whitespace exactly without normalization or a text-node length cap", () => {
    for (const source of ["", " é😀\n", "e\u0301", "x".repeat(12_001)]) {
      expect(presentationSourceFingerprintDigest(source)).toBe(
        createHash("sha256").update(source, "utf8").digest("hex"),
      );
    }
    expect(presentationSourceFingerprintDigest("é")).not.toBe(
      presentationSourceFingerprintDigest("e\u0301"),
    );
    expect(presentationSourceFingerprintDigest("exact")).not.toBe(
      presentationSourceFingerprintDigest(" exact "),
    );
  });

  it("retains the existing selected-text digest bytes and that domain's independent 4,000-character bound", () => {
    expect(presentationTextAssistanceSourceDigest(" exact 😀\n")).toBe(
      presentationSourceFingerprintDigest(" exact 😀\n"),
    );
    expect(() => presentationTextAssistanceSourceDigest("x".repeat(4_001))).toThrow();
    expect(presentationSourceFingerprintDigest("x".repeat(4_001))).toHaveLength(64);
  });
});
