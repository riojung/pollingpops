import type { NextRequest } from "next/server";
import { authenticatedRequest, jsonResponse, safeError } from "../../../lib/http";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    const { auth, context, cookieNames, requestId } = await authenticatedRequest(request, true);
    await auth.logout(context, requestId);
    const response = jsonResponse({ signedOut: true });
    for (const name of [cookieNames.session, cookieNames.csrf])
      response.cookies.set(name, "", {
        path: "/",
        secure: cookieNames.secure,
        httpOnly: true,
        sameSite: "lax",
        maxAge: 0,
      });
    return response;
  } catch (error) {
    return safeError(error);
  }
}
