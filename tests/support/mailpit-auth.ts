import assert from "node:assert/strict";

export type MailpitAuthPurpose = "verification" | "pin";

export function credentialFromMail(text: string, purpose: MailpitAuthPurpose) {
  if (purpose === "verification") {
    return text.match(/https?:\/\/[^\s<>]+\/v1\/auth\/verify\?token=[^\s<>]+/)?.[0];
  }
  if (!/\bsign[ -]in\b/i.test(text) || !/\bPIN\b/.test(text)) return undefined;
  return text.match(/\b\d{6}\b/)?.[0];
}

export async function readMailpitCredential(
  mailpitUrl: string,
  email: string,
  purpose: MailpitAuthPurpose,
) {
  const origin = mailpitUrl.replace(/\/$/, "");
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const list = await fetch(`${origin}/api/v1/messages`);
    assert.equal(list.ok, true, "Mailpit message listing failed");
    const body = (await list.json()) as {
      messages: Array<{ ID: string; To: Array<{ Address: string }> }>;
    };
    for (const message of body.messages) {
      if (!message.To.some((recipient) => recipient.Address.toLowerCase() === email.toLowerCase()))
        continue;
      const response = await fetch(`${origin}/api/v1/message/${message.ID}`);
      assert.equal(response.ok, true, "Mailpit message retrieval failed");
      const detail = (await response.json()) as { Text: string };
      const credential = credentialFromMail(detail.Text, purpose);
      if (credential) return credential;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `The ${purpose === "pin" ? "sign-in PIN" : "verification email"} did not reach Mailpit`,
  );
}

// SMTP smoke/load clients prove both email deliveries and the public auth contract.
// Verification alone must never provide the cookie used by these clients.
export async function authenticateMailpitCreator(options: {
  baseUrl: string;
  browserOrigin: string;
  mailpitUrl: string;
  email: string;
  segment?: "education" | "workplace";
}) {
  const { baseUrl, browserOrigin, mailpitUrl, email } = options;
  const post = (pathname: string, data: unknown) =>
    fetch(`${baseUrl}${pathname}`, {
      method: "POST",
      headers: { origin: browserOrigin, "content-type": "application/json" },
      body: JSON.stringify(data),
    });
  const registration = await post("/v1/auth/email-verification", {
    email,
    segment: options.segment ?? "workplace",
    acceptPolicies: true,
  });
  assert.equal(registration.status, 202, "Account verification request was not accepted");
  assert.equal(registration.headers.get("set-cookie"), null);
  const verificationUrl = new URL(await readMailpitCredential(mailpitUrl, email, "verification"));
  const verified = await fetch(`${baseUrl}${verificationUrl.pathname}${verificationUrl.search}`, {
    redirect: "manual",
  });
  assert.ok([301, 302, 303, 307, 308].includes(verified.status));
  assert.equal(verified.headers.get("set-cookie"), null, "Email verification must not sign in");
  const destination = new URL(verified.headers.get("location")!);
  assert.equal(destination.pathname, "/signin");
  assert.equal(destination.searchParams.get("verified"), "1");
  assert.equal((await fetch(`${baseUrl}/v1/auth/me`)).status, 401);

  const requested = await post("/v1/auth/pin/request", { email, acceptPolicies: true });
  assert.equal(requested.status, 202, "Sign-in PIN request was not accepted");
  assert.equal(requested.headers.get("set-cookie"), null);
  const challenge = (await requested.json()) as {
    challengeId: string;
    expiresInSeconds: number;
    resendAfterSeconds: number;
  };
  assert.equal(challenge.expiresInSeconds, 600);
  assert.equal(challenge.resendAfterSeconds, 60);
  const pin = await readMailpitCredential(mailpitUrl, email, "pin");
  const signedIn = await post("/v1/auth/pin/verify", { challengeId: challenge.challengeId, pin });
  assert.equal(signedIn.status, 200, "The emailed PIN did not authenticate its challenge");
  const cookie = signedIn.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
  assert.match(cookie, /^openround_creator=/);
  return cookie;
}
