import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/** Hash the exact UTF-8 source projection without another feature's text limits or normalization. */
export function presentationSourceFingerprintDigest(value: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(value)));
}
