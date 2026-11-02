import nodemailer from "nodemailer";
import { Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigSchema } from "../src/config.js";
import { ConsoleMailer, SmtpMailer } from "../src/mailer.js";

vi.mock("nodemailer", () => ({ default: { createTransport: vi.fn() } }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function fixture() {
  const sendMail = vi.fn(async (_message: unknown) => ({ accepted: ["recipient@example.test"] }));
  const close = vi.fn();
  vi.mocked(nodemailer.createTransport).mockReturnValue({
    sendMail,
    close,
  } as unknown as ReturnType<typeof nodemailer.createTransport>);
  const mailer = new SmtpMailer(
    ConfigSchema.parse({
      NODE_ENV: "test",
      SMTP_URL: "smtp://localhost:2525",
      EMAIL_FROM: "Boards <boards@example.test>",
    }),
  );
  const invitation = {
    title: '<img src=x onerror="alert(1)">\nWorkshop',
    url: 'https://boards.example.test/board/abc?label="quoted"&next=<x>',
    kind: "idea_board" as const,
    messageId: "<stable-id@example.test>",
    timeoutMs: 250,
  };
  return { mailer, invitation, sendMail, close };
}
describe("board invitation mail", () => {
  it("uses configured individual SMTP delivery, escaped HTML, a fixed subject and the stable message ID", async () => {
    const f = fixture();
    await f.mailer.sendBoardInvitation("recipient@example.test", f.invitation);
    const message = f.sendMail.mock.calls[0]![0] as Record<string, string>;
    expect(message).toMatchObject({
      from: "Boards <boards@example.test>",
      to: "recipient@example.test",
      messageId: "<stable-id@example.test>",
    });
    expect(message.subject).not.toContain("Workshop");
    expect(message.html).not.toContain("<img");
    expect(message.html).toContain("&lt;img");
    expect(message.html).toContain("&quot;quoted&quot;&amp;next=&lt;x&gt;");
    expect(message.text).toContain("do not need an account");
    expect(message.text).toContain("can be forwarded");
    expect(message.cc).toBeUndefined();
    expect(message.bcc).toBeUndefined();
    expect(nodemailer.createTransport).toHaveBeenLastCalledWith(
      expect.objectContaining({
        host: "localhost",
        port: 2525,
        socket: expect.any(Socket),
        logger: false,
        debug: false,
        connectionTimeout: 250,
        greetingTimeout: 250,
        socketTimeout: 250,
      }),
    );
    expect(f.close).toHaveBeenCalled();
  });
  it("closes the dedicated transport at the original remaining deadline without claiming acknowledgement", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.sendMail.mockImplementation(() => new Promise<{ accepted: string[] }>(() => {}));
    const pending = expect(
      f.mailer.sendBoardInvitation("recipient@example.test", f.invitation),
    ).rejects.toThrow("acknowledgement is unknown");
    await vi.advanceTimersByTimeAsync(250);
    await pending;
    expect(f.close).toHaveBeenCalled();
    const options = vi.mocked(nodemailer.createTransport).mock.calls.at(-1)![0] as {
      socket: Socket;
    };
    expect(options.socket.destroyed).toBe(true);
  });
  it("does not log or pretend console fixture delivery succeeded", async () => {
    const output = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    await expect(
      new ConsoleMailer().sendBoardInvitation("recipient@example.test", {
        title: "Private workshop",
        url: "https://boards.example.test/private",
        kind: "idea_board",
        messageId: "<id@example.test>",
      }),
    ).rejects.toThrow("delivery is unavailable");
    expect(output).not.toHaveBeenCalled();
  });
});
