import { describe, expect, it } from "vitest";
import { MemoryRepository, type CreatorContext } from "@openround/db";
import { AuthService } from "../src/auth.js";
import { ConfigSchema } from "../src/config.js";
import type { Mailer } from "../src/mailer.js";

class CapturingMailer implements Mailer {
  readonly messages: Array<{ email: string; verifyUrl: string }> = [];

  async sendMagicLink(email: string, verifyUrl: string) {
    this.messages.push({ email, verifyUrl });
  }

  async sendAccountVerification(email: string, verifyUrl: string) {
    await this.sendMagicLink(email, verifyUrl);
  }

  readonly pins: Array<{ email: string; pin: string }> = [];

  async sendSignInPin(email: string, pin: string) {
    this.pins.push({ email, pin });
  }

  async sendWorkspaceInvitation(email: string, verifyUrl: string) {
    this.messages.push({ email, verifyUrl });
  }
}

const productionDependencies = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://app:secret@database.internal/openround",
  REDIS_URL: "rediss://cache.internal:6380",
  FEATURE_SIGNUPS: "false",
  METRICS_ENABLED: "false",
} as const;

describe("magic-link response exposure", () => {
  it("returns the link for the guarded local Compose profile", async () => {
    const repository = new MemoryRepository();
    const mailer = new CapturingMailer();
    const auth = new AuthService(
      repository,
      mailer,
      ConfigSchema.parse({
        ...productionDependencies,
        WEB_ORIGIN: "http://localhost:8080",
        PUBLIC_API_URL: "http://localhost:8080",
        COOKIE_SECURE: "false",
        COMMUNITY_MODE: "true",
        ALLOW_INSECURE_LOCAL_HTTP: "true",
        AUTH_DEBUG_MAGIC_LINKS: "true",
      }),
    );

    const debugUrl = await auth.requestMagicLink("local@example.com", "workplace");

    expect(debugUrl).toMatch(/^http:\/\/localhost:8080\/v1\/auth\/verify\?token=/);
    expect(mailer.messages).toEqual([{ email: "local@example.com", verifyUrl: debugUrl }]);
  });

  it("preserves a validated local return path in the one-time link", async () => {
    const repository = new MemoryRepository();
    const mailer = new CapturingMailer();
    const auth = new AuthService(
      repository,
      mailer,
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        WEB_ORIGIN: "http://localhost:3000",
        PUBLIC_API_URL: "http://localhost:4000",
      }),
    );

    const debugUrl = await auth.requestMagicLink("lti-owner@example.edu", "education", "/lti/link");

    expect(new URL(debugUrl!).searchParams.get("returnTo")).toBe("/lti/link");
    expect(mailer.messages[0]?.verifyUrl).toBe(debugUrl);
  });

  it("bridges only explicit account locales while preserving a local destination", () => {
    const auth = new AuthService(
      new MemoryRepository(),
      new CapturingMailer(),
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        WEB_ORIGIN: "https://app.openround.example",
        PUBLIC_API_URL: "https://api.openround.example",
      }),
    );
    const creator: CreatorContext = {
      userId: "00000000-0000-4000-8000-000000000001",
      workspaceId: "00000000-0000-4000-8000-000000000002",
      email: "locale@example.com",
      locale: "ja-JP",
      localePreferenceSet: false,
      segment: "workplace",
      role: "owner",
      plan: "free",
    };

    expect(auth.localeAwareWebRedirect(creator, "/dashboard?welcome=1")).toBe(
      "https://app.openround.example/dashboard?welcome=1",
    );
    const bridged = new URL(
      auth.localeAwareWebRedirect(
        { ...creator, localePreferenceSet: true },
        "/lti/select?launchId=launch-1#current",
      ),
    );
    expect(bridged.pathname).toBe("/auth/locale");
    expect(bridged.searchParams.get("locale")).toBe("ja-JP");
    expect(bridged.searchParams.get("returnTo")).toBe("/lti/select?launchId=launch-1#current");
    const rejectedExternal = new URL(
      auth.localeAwareWebRedirect(
        { ...creator, localePreferenceSet: true },
        "https://evil.example/steal",
      ),
    );
    expect(rejectedExternal.origin).toBe("https://app.openround.example");
    expect(rejectedExternal.pathname).toBe("/auth/locale");
    expect(rejectedExternal.searchParams.get("returnTo")).toBe("/home");

    const rejectedControlCharacter = new URL(
      auth.localeAwareWebRedirect(
        { ...creator, localePreferenceSet: true },
        `/${String.fromCharCode(9)}/evil.example`,
      ),
    );
    expect(rejectedControlCharacter.searchParams.get("returnTo")).toBe("/home");
  });

  it("keeps the link out of a hosted production response", async () => {
    const repository = new MemoryRepository();
    const mailer = new CapturingMailer();
    const auth = new AuthService(
      repository,
      mailer,
      ConfigSchema.parse({
        ...productionDependencies,
        WEB_ORIGIN: "https://quiz.example.ca",
        PUBLIC_API_URL: "https://api.example.ca",
        COOKIE_SECURE: "true",
      }),
    );

    expect(await auth.requestMagicLink("hosted@example.com", "education")).toBeUndefined();
    expect(mailer.messages[0]).toMatchObject({
      email: "hosted@example.com",
      verifyUrl: expect.stringMatching(/^https:\/\/api\.example\.ca\/v1\/auth\/verify\?token=/),
    });
  });
});
