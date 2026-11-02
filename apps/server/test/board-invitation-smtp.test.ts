import { createServer, type Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigSchema } from "../src/config.js";
import { SmtpMailer } from "../src/mailer.js";

interface ReceivedMail {
  from: string;
  recipients: string[];
  content: string;
}
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(cleanups.splice(0).map((close) => close()));
});

/** Real SMTP on an ephemeral loopback port; no AUTH, STARTTLS or external delivery. */
async function smtpInbox(holdAcknowledgement = false) {
  const sockets = new Set<Socket>();
  const received: ReceivedMail[] = [];
  const acknowledged: ReceivedMail[] = [];
  const held: Array<() => boolean> = [];
  let receive!: () => void;
  const messageReceived = new Promise<void>((resolve) => {
    receive = resolve;
  });
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    socket.setEncoding("utf8");
    socket.write("220 localhost board invitation fixture\r\n");
    let buffered = "";
    let data: string[] | null = null;
    let sender = "";
    let recipients: string[] = [];
    socket.on("data", (chunk: string) => {
      buffered += chunk;
      let newline: number;
      while ((newline = buffered.indexOf("\r\n")) !== -1) {
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 2);
        if (data !== null) {
          if (line !== ".") {
            data.push(line.replace(/^\.\./, "."));
            continue;
          }
          const message = { from: sender, recipients: [...recipients], content: data.join("\r\n") };
          data = null;
          received.push(message);
          const acknowledge = () => {
            if (socket.destroyed || !socket.writable) return false;
            acknowledged.push(message);
            socket.write("250 accepted\r\n");
            return true;
          };
          if (holdAcknowledgement) held.push(acknowledge);
          else acknowledge();
          receive();
        } else if (/^(EHLO|HELO)\b/i.test(line)) {
          // No STARTTLS capability: this exercises Nodemailer's plain owned-socket path.
          socket.write("250 localhost\r\n");
        } else if (/^MAIL FROM:/i.test(line)) {
          sender = line.slice("MAIL FROM:".length).trim();
          recipients = [];
          socket.write("250 sender accepted\r\n");
        } else if (/^RCPT TO:/i.test(line)) {
          recipients.push(line.slice("RCPT TO:".length).trim());
          socket.write("250 recipient accepted\r\n");
        } else if (line === "DATA") {
          data = [];
          socket.write("354 send message\r\n");
        } else if (line === "QUIT") socket.end("221 goodbye\r\n");
        else if (line === "RSET") {
          recipients = [];
          socket.write("250 reset\r\n");
        } else socket.write("250 ok\r\n");
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  cleanups.push(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing loopback SMTP port");
  return {
    received,
    acknowledged,
    messageReceived,
    get openConnections() {
      return sockets.size;
    },
    releaseAcknowledgements: () => held.splice(0).filter((acknowledge) => acknowledge()).length,
    url: `smtp://127.0.0.1:${address.port}`,
  };
}

function mailer(smtpUrl: string) {
  return new SmtpMailer(
    ConfigSchema.parse({
      NODE_ENV: "test",
      SMTP_URL: smtpUrl,
      EMAIL_FROM: "Board fixture <sender@example.test>",
    }),
  );
}
function decodeQuotedPrintable(value: string) {
  return value
    .replace(/=\r\n/g, "")
    .replace(/=([\dA-F]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}
const publicJoinUrl = "https://boards.example.test/board/10000000-0000-4000-8000-000000000001";

describe("board invitation SMTP transport", () => {
  it("connects through configured SMTP and delivers separate recipient envelopes with the public guest URL", async () => {
    const inbox = await smtpInbox();
    const delivery = mailer(inbox.url);
    for (const [index, email] of ["alpha@example.test", "beta@example.test"].entries()) {
      await delivery.sendBoardInvitation(email, {
        title: "Synthetic workshop",
        url: publicJoinUrl,
        kind: "idea_board",
        messageId: `<board-fixture-${index}@example.test>`,
        timeoutMs: 5_000,
      });
    }
    expect(inbox.received).toHaveLength(2);
    expect(inbox.acknowledged).toHaveLength(2);
    for (const [index, email] of ["alpha@example.test", "beta@example.test"].entries()) {
      const message = inbox.received[index]!;
      expect(message.from).toBe("<sender@example.test>");
      expect(message.recipients).toEqual([`<${email}>`]);
      const content = decodeQuotedPrintable(message.content);
      expect(content).toContain(`To: ${email}\r\n`);
      expect(content).toContain(`Message-ID: <board-fixture-${index}@example.test>`);
      expect(content).toContain(publicJoinUrl);
      expect(content).toContain("You do not need an account");
      expect(content).toContain("join link can be forwarded");
      expect(content).not.toMatch(/^Cc:|^Bcc:/im);
      expect(content).not.toContain(index === 0 ? "beta@example.test" : "alpha@example.test");
    }
    await expect.poll(() => inbox.openConnections).toBe(0);
  });

  it("destroys the active SMTP connection at the original deadline and cannot accept a late acknowledgement", async () => {
    const inbox = await smtpInbox(true);
    // Keep real socket I/O and immediates. Advance only JS deadline timers after the
    // complete DATA handshake, so scheduler speed is not the timeout assertion.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const outcome = mailer(inbox.url)
      .sendBoardInvitation("slow@example.test", {
        title: "Synthetic held acknowledgement",
        url: publicJoinUrl,
        kind: "idea_board",
        messageId: "<board-fixture-held@example.test>",
        timeoutMs: 5_000,
      })
      .then(
        () => ({ acknowledged: true, message: "" }),
        (error: unknown) => ({
          acknowledged: false,
          message: error instanceof Error ? error.message : "unknown",
        }),
      );
    await inbox.messageReceived;
    expect(inbox.received).toHaveLength(1);
    expect(inbox.acknowledged).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await outcome).toEqual({
      acknowledged: false,
      message: "Board invitation email acknowledgement is unknown",
    });
    vi.useRealTimers();
    await expect.poll(() => inbox.openConnections).toBe(0);
    expect(inbox.releaseAcknowledgements()).toBe(0);
    expect(inbox.acknowledged).toHaveLength(0);
    expect(await outcome).toMatchObject({ acknowledged: false });
  });
});
