import { OperatorError } from "@openround/control-plane";
import { safeError } from "../../../lib/http";

export const runtime = "nodejs";

export async function POST() {
  return safeError(
    new OperatorError(
      403,
      "STANDALONE_SIGN_IN_REQUIRED",
      "Sign in directly to the admin console with your configured operator credentials",
    ),
  );
}
