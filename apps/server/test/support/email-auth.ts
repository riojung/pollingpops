import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from "fastify";
import { expect } from "vitest";

/** Local fixtures verify new mailboxes once; verified registration requests are generic no-ops. */
export async function signInFromVerificationResponse(
  app: FastifyInstance,
  registration: LightMyRequestResponse,
  email: string,
  headers?: InjectOptions["headers"],
  returnTo?: string,
): Promise<LightMyRequestResponse> {
  expect(registration.statusCode, registration.body).toBe(202);
  const { debugUrl } = registration.json<{ debugUrl?: string }>();
  if (!debugUrl) return requestPinAndSignIn(app, email, returnTo, headers);
  const url = new URL(debugUrl);
  return verifyEmailAndSignIn(app, url.pathname + url.search, email, headers);
}

/** Exercise mailbox verification and the separate emailed PIN through public auth routes. */
export async function verifyEmailAndSignIn(
  app: FastifyInstance,
  verificationPath: string,
  email: string,
  headers?: InjectOptions["headers"],
): Promise<LightMyRequestResponse> {
  const verification = await app.inject({ method: "GET", url: verificationPath, headers });
  expect(verification.statusCode, verification.body).toBe(302);
  expect(verification.headers["set-cookie"]).toBeUndefined();
  const destination = new URL(verification.headers.location!);
  expect(destination.pathname).toBe("/signin");
  expect(destination.searchParams.get("verified")).toBe("1");
  return requestPinAndSignIn(
    app,
    email,
    destination.searchParams.get("returnTo") ?? undefined,
    headers,
  );
}

export async function requestPinAndSignIn(
  app: FastifyInstance,
  email: string,
  returnTo?: string,
  headers?: InjectOptions["headers"],
): Promise<LightMyRequestResponse> {
  const requested = await app.inject({
    method: "POST",
    url: "/v1/auth/pin/request",
    headers,
    payload: { email, acceptPolicies: true, ...(returnTo ? { returnTo } : {}) },
  });
  expect(requested.statusCode, requested.body).toBe(202);
  expect(requested.headers["set-cookie"]).toBeUndefined();
  const { challengeId, debugPin } = requested.json<{ challengeId: string; debugPin: string }>();
  expect(challengeId).toEqual(expect.any(String));
  expect(debugPin).toMatch(/^\d{6}$/);
  const signedIn = await app.inject({
    method: "POST",
    url: "/v1/auth/pin/verify",
    headers,
    payload: { challengeId, pin: debugPin },
  });
  expect(signedIn.statusCode, signedIn.body).toBe(200);
  expect(signedIn.headers["set-cookie"]).toBeDefined();
  return signedIn;
}
