import nodemailer from "nodemailer";
import { parseConnectionUrl } from "nodemailer/lib/shared";
import { Socket } from "node:net";
import { PRODUCT_BRAND } from "@openround/contracts";
import type { AppConfig } from "./config.js";

export interface BoardInvitationMail {
  title: string;
  url: string;
  kind: "canvas" | "idea_board";
  messageId: string;
  /** The HTTP caller's remaining delivery budget, never a new per-phase timeout. */
  timeoutMs?: number;
}

export interface Mailer {
  sendAccountVerification(email: string, verifyUrl: string): Promise<void>;
  sendSignInPin(email: string, pin: string): Promise<void>;
  sendWorkspaceInvitation(email: string, acceptUrl: string): Promise<void>;
  sendOrganizationInvitation?(email: string, acceptUrl: string): Promise<void>;
  sendBoardInvitation?(email: string, invitation: BoardInvitationMail): Promise<void>;
}

export class ConsoleMailer implements Mailer {
  async sendBoardInvitation(_email: string, _invitation: BoardInvitationMail): Promise<void> {
    // An invitation must never be reported sent merely because a console fixture is active.
    throw new Error("Board invitation email delivery is unavailable");
  }
  async sendOrganizationInvitation(email: string, acceptUrl: string) {
    process.stdout.write(`Organization invitation for ${email}: ${acceptUrl}\n`);
  }
  async sendMagicLink(email: string, verifyUrl: string) {
    process.stdout.write(`Account verification for ${email}: ${verifyUrl}\n`);
  }

  async sendAccountVerification(email: string, verifyUrl: string) {
    await this.sendMagicLink(email, verifyUrl);
  }

  async sendSignInPin(email: string, pin: string) {
    process.stdout.write(`Sign-in PIN for ${email}: ${pin}\n`);
  }

  async sendWorkspaceInvitation(email: string, acceptUrl: string) {
    process.stdout.write(`Workspace invitation for ${email}: ${acceptUrl}\n`);
  }
}

export class SmtpMailer implements Mailer {
  private readonly transport;

  constructor(private readonly config: AppConfig) {
    this.transport = nodemailer.createTransport(config.SMTP_URL!);
  }

  async sendBoardInvitation(email: string, invitation: BoardInvitationMail) {
    // Own the public SMTP socket so the absolute HTTP deadline can destroy an active
    // connection too; SMTPTransport.close() alone only releases auth resources.
    const timeout = Math.max(1, Math.min(5_000, invitation.timeoutMs ?? 5_000));
    const socket = new Socket();
    const transport = nodemailer.createTransport({
      ...parseConnectionUrl(this.config.SMTP_URL!),
      socket,
      pool: false,
      logger: false,
      debug: false,
      connectionTimeout: timeout,
      greetingTimeout: timeout,
      socketTimeout: timeout,
    });
    const title = invitation.title.replace(/[\r\n]/g, " ");
    const guidance =
      invitation.kind === "idea_board"
        ? "Join as a guest. You do not need an account. This join link can be forwarded; closing the board stops participation."
        : "Review this invitation using your verified organization account. Your current organization access and license determine available collaboration.";
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        transport.sendMail({
          from: this.config.EMAIL_FROM,
          to: email,
          messageId: invitation.messageId,
          subject: `You are invited to a ${PRODUCT_BRAND.name} board`,
          text: `You have been invited to ${title}.\n\n${guidance}\n\n${invitation.url}`,
          html: emailHtml(
            "You are invited to a board",
            `<p>${escapeHtml(title)}</p><p>${escapeHtml(guidance)}</p><p><a href="${escapeHtml(invitation.url)}">Open board invitation</a></p>`,
          ),
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            socket.destroy();
            transport.close();
            reject(new Error("Board invitation email acknowledgement is unknown"));
          }, timeout);
          timer.unref();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      socket.destroy();
      transport.close();
    }
  }

  async sendMagicLink(email: string, verifyUrl: string) {
    await this.sendAccountVerification(email, verifyUrl);
  }

  async sendAccountVerification(email: string, verifyUrl: string) {
    await this.transport.sendMail({
      from: this.config.EMAIL_FROM,
      to: email,
      subject: `Verify your ${PRODUCT_BRAND.name} email`,
      text: `Verify your email address to create your account. This link expires in 15 minutes and can be used once. Verification does not sign you in. After verifying, return to sign in and request your email PIN.\n\n${verifyUrl}\n\nIf you did not request this account, ignore this email.`,
      html: emailHtml(
        "Verify your email address",
        `<p>Confirm your email address to create your ${PRODUCT_BRAND.name} account.</p><p><a style="display:inline-block;padding:14px 20px;border-radius:10px;background:#252a32;color:#fff;text-decoration:none;font-weight:700" href="${escapeHtml(verifyUrl)}">Verify email address</a></p><p>This link expires in 15 minutes and can be used once. Verification does not sign you in. After verifying, return to sign in and request your email PIN.</p>`,
      ),
    });
  }

  async sendSignInPin(email: string, pin: string) {
    await this.transport.sendMail({
      from: this.config.EMAIL_FROM,
      to: email,
      subject: `Your ${PRODUCT_BRAND.name} sign-in PIN`,
      text: `Your sign-in PIN is: ${pin}\n\nEnter it on the sign-in page where you requested it. It expires in 10 minutes and can be used once. A new PIN replaces the previous one. Never share this code.\n\nIf you did not request it, ignore this email.`,
      html: emailHtml(
        "Your sign-in PIN",
        `<p>Enter this PIN on the sign-in page where you requested it:</p><p style="font-size:32px;font-weight:700;letter-spacing:8px;color:#252a32">${escapeHtml(pin)}</p><p>It expires in 10 minutes and can be used once. A new PIN replaces the previous one. Never share this code.</p>`,
      ),
    });
  }

  async sendWorkspaceInvitation(email: string, acceptUrl: string) {
    await this.transport.sendMail({
      from: this.config.EMAIL_FROM,
      to: email,
      subject: `Join a ${PRODUCT_BRAND.name} workspace`,
      text: `You have been invited to collaborate in ${PRODUCT_BRAND.name}. This link expires in seven days.\n\n${acceptUrl}\n\nIf you did not expect this invitation, ignore this email.`,
      html: `<p>You have been invited to collaborate in ${PRODUCT_BRAND.name}. This link expires in seven days.</p><p><a href="${acceptUrl}">Review invitation</a></p><p>If you did not expect this invitation, ignore this email.</p>`,
    });
  }

  async sendOrganizationInvitation(email: string, acceptUrl: string) {
    await this.transport.sendMail({
      from: this.config.EMAIL_FROM,
      to: email,
      subject: `Join a ${PRODUCT_BRAND.name} organization`,
      text: `You have been invited to join an organization in ${PRODUCT_BRAND.name}. Review the invitation to see your role. It expires in seven days.\n\n${acceptUrl}\n\nIf you did not expect this invitation, ignore this email.`,
    });
  }
}

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
  );
}

function emailHtml(title: string, content: string) {
  return `<!doctype html><html lang="en"><body style="margin:0;padding:24px;background:#f5f6f8;font-family:Arial,sans-serif;color:#252a32"><main style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #d9dfe7;border-radius:16px;padding:32px"><p style="font-weight:700;color:#066854">${PRODUCT_BRAND.name}</p><h1 style="font-size:26px;line-height:1.2">${escapeHtml(title)}</h1>${content}<p style="margin-top:28px;color:#556270;font-size:14px">If you did not request this email, you can safely ignore it.</p></main></body></html>`;
}
