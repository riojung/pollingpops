import {
  PASSWORD_OPERATOR_ISSUER,
  type PlatformOperator,
  type PlatformOperatorPasswordCredential,
} from "./platform-types.js";

/** A replacement must be usable through the same authentication issuer. Password
 * identities need matching offline enrollment; OIDC enrollment belongs to its provider. */
export async function hasUsableFounderReplacement(
  target: PlatformOperator,
  operators: PlatformOperator[],
  credentialFor: (username: string) => Promise<PlatformOperatorPasswordCredential | null>,
): Promise<boolean> {
  for (const candidate of operators) {
    if (
      candidate.id === target.id ||
      !candidate.active ||
      candidate.role !== "founder" ||
      candidate.issuer !== target.issuer
    )
      continue;
    if (candidate.issuer !== PASSWORD_OPERATOR_ISSUER) return true;
    const credential = await credentialFor(candidate.subject);
    if (credential?.username === candidate.subject && credential.operatorId === candidate.id)
      return true;
  }
  return false;
}
