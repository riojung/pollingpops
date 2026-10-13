import nodemailer from "nodemailer";
import { PRODUCT_BRAND } from "@openround/contracts";
import type { AppConfig } from "./config.js";

export interface Mailer {
  sendMagicLink(email: string, verifyUrl: string): Promise<void>;
  sendWorkspaceInvitation(email: string, acceptUrl: string): Promise<void>;
  sendOrganizationInvitation?(email: string, acceptUrl: string): Promise<void>;
}

export class ConsoleMailer implements Mailer {
  async sendOrganizationInvitation(email: string, acceptUrl: string) {
    process.stdout.write(`Organization invitation for ${email}: ${acceptUrl}\n`);
  }
  async sendMagicLink(email: string, verifyUrl: string) {
    process.stdout.write(`Magic link for ${email}: ${verifyUrl}\n`);
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

  async sendMagicLink(email: string, verifyUrl: string) {
    await this.transport.sendMail({
      from: this.config.EMAIL_FROM,
      to: email,
      subject: `Sign in to ${PRODUCT_BRAND.name}`,
      text: `Use this link to sign in. It expires in 15 minutes.\n\n${verifyUrl}\n\nIf you did not request it, ignore this email.`,
      html: `<p>Use this link to sign in. It expires in 15 minutes.</p><p><a href="${verifyUrl}">Sign in to ${PRODUCT_BRAND.name}</a></p><p>If you did not request it, ignore this email.</p>`,
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
