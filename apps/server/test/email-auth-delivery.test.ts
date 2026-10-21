import { createServer, type Socket } from "node:net";
import { expect, it } from "vitest";
import { MemoryRepository } from "@openround/db";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";

/** A private SMTP sink: real nodemailer transport, no external recipients or services. */
async function smtpInbox() {
  const messages: string[] = [];
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.setEncoding("utf8");
    socket.write("220 localhost test inbox\r\n");
    let pending = "";
    let data: string[] | null = null;
    socket.on("data", (chunk: string) => {
      pending += chunk;
      let newline: number;
      while ((newline = pending.indexOf("\r\n")) !== -1) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 2);
        if (data) {
          if (line === ".") {
            messages.push(data.join("\r\n"));
            data = null;
            socket.write("250 accepted\r\n");
          } else data.push(line.replace(/^\.\./, "."));
        } else if (/^EHLO|^HELO/.test(line)) socket.write("250 localhost\r\n");
        else if (line === "DATA") {
          data = [];
          socket.write("354 send message\r\n");
        } else if (line === "QUIT") socket.end("221 goodbye\r\n");
        else socket.write("250 ok\r\n");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test SMTP port");
  return {
    messages,
    url: `smtp://127.0.0.1:${address.port}`,
    close: () => {
      for (const socket of sockets) socket.destroy();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function decodeQuotedPrintable(message: string) {
  return message
    .replace(/=\r\n/g, "")
    .replace(/=([\dA-F]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

it("delivers separate verification and PIN emails over SMTP and grants access only after the PIN", async () => {
  const inbox = await smtpInbox();
  const { app } = await buildApp(
    ConfigSchema.parse({
      NODE_ENV: "test",
      ALLOW_IN_MEMORY: "true",
      COMMUNITY_MODE: "false",
      SMTP_URL: inbox.url,
      WEB_ORIGIN: "http://localhost:3000",
      PUBLIC_API_URL: "http://localhost:4000",
      LOG_LEVEL: "silent",
    }),
    { repository: new MemoryRepository(), cache: new MemorySessionCache() },
  );
  try {
    const registration = await app.inject({
      method: "POST",
      url: "/v1/auth/email-verification",
      payload: { email: "synthetic@example.test", acceptPolicies: true },
    });
    expect(registration.statusCode).toBe(202);
    expect(inbox.messages).toHaveLength(1);
    const verificationEmail = decodeQuotedPrintable(inbox.messages[0]!);
    expect(verificationEmail).toContain("Subject: Verify your Polling Pops email");
    expect(verificationEmail).toContain("Verification does not sign you in");
    const verificationUrl = new URL(
      verificationEmail.match(/http:\/\/localhost:4000\/v1\/auth\/verify\?token=[\w-]+/)![0],
    );
    const verified = await app.inject({
      method: "GET",
      url: verificationUrl.pathname + verificationUrl.search,
    });
    expect(verified.statusCode).toBe(302);
    expect(verified.headers["set-cookie"]).toBeUndefined();
    expect(inbox.messages).toHaveLength(1);
    const requested = await app.inject({
      method: "POST",
      url: "/v1/auth/pin/request",
      payload: { email: "synthetic@example.test", acceptPolicies: true },
    });
    expect(requested.statusCode).toBe(202);
    expect(inbox.messages).toHaveLength(2);
    const pinEmail = decodeQuotedPrintable(inbox.messages[1]!);
    expect(pinEmail).toContain("Subject: Your Polling Pops sign-in PIN");
    expect(pinEmail).toContain("10 minutes");
    expect(pinEmail).not.toContain("/v1/auth/verify");
    const pin = pinEmail.match(/Your sign-in PIN is: (\d{6})/)![1]!;
    const completed = await app.inject({
      method: "POST",
      url: "/v1/auth/pin/verify",
      payload: { challengeId: requested.json().challengeId, pin },
    });
    expect(completed.statusCode).toBe(200);
    expect(completed.headers["set-cookie"]).toEqual(expect.stringContaining("HttpOnly"));
  } finally {
    await app.close();
    await inbox.close();
  }
});
