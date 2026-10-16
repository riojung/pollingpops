import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ControlRoom from "../app/room";

describe("control sign-in presentation", () => {
  it("offers dedicated operator credentials and an authenticator code at the console root", () => {
    const markup = renderToStaticMarkup(<ControlRoom enabled authMode="password" />);
    expect(markup).toContain("Sign in to the admin console");
    expect(markup).toContain('action="/auth/password" method="post"');
    expect(markup).toContain('for="operator-username"');
    expect(markup).toContain('name="username"');
    expect(markup).toContain('autoComplete="username"');
    expect(markup).toContain('for="operator-password"');
    expect(markup).toContain('type="password" autoComplete="current-password"');
    expect(markup).toContain('for="operator-code"');
    expect(markup).toContain('inputMode="numeric" autoComplete="one-time-code"');
    expect(markup).toContain('pattern="[0-9]{6}"');
    expect(markup).toContain('aria-describedby="operator-code-help"');
    expect(markup).not.toContain('href="/auth/start"');
    expect(markup).not.toContain("Sign in to Polling Pops");
    expect(markup).not.toContain("email");
    expect(markup).not.toContain("magic link");
  });

  it("keeps managed operator sign-in for OIDC configuration", () => {
    const markup = renderToStaticMarkup(<ControlRoom enabled authMode="oidc" />);
    expect(markup).toContain("Sign in with operator identity");
    expect(markup).toContain('href="/auth/start"');
    expect(markup).toContain("verified MFA");
    expect(markup).not.toContain('name="password"');
    expect(markup).not.toContain("Sign in to Polling Pops");
  });

  it("explains that legacy local mode needs standalone authentication without a customer sign-in link", () => {
    const markup = renderToStaticMarkup(<ControlRoom enabled authMode="local" />);
    expect(markup).toContain("Configure standalone password and authenticator sign-in");
    expect(markup).not.toContain("<form");
    expect(markup).not.toContain('href="/auth/start"');
    expect(markup).not.toContain("Sign in to Polling Pops");
  });

  it.each(["password", "oidc", "local"] as const)(
    "does not offer sign-in while control is disabled in %s mode",
    (authMode) => {
      const markup = renderToStaticMarkup(<ControlRoom enabled={false} authMode={authMode} />);
      expect(markup).toContain("operator console is disabled");
      expect(markup).not.toContain("<form");
      expect(markup).not.toContain("Sign in with operator identity");
    },
  );
});
