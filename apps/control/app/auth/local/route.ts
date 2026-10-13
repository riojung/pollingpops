import { OperatorError } from "@openround/control-plane";
import { safeError } from "../../../lib/http";

export const runtime = "nodejs";

export async function POST() {
  return safeError(
    new OperatorError(
      403,
      "VERIFIED_SIGN_IN_REQUIRED",
      "Sign in through Polling Pops with your configured admin account",
    ),
  );
}
