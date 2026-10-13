import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ControlRoom from "../app/room";

describe("control sign-in presentation", () => {
  it("offers the local admin action when the server confirms the local profile", () => {
    const markup = renderToStaticMarkup(<ControlRoom enabled localAdmin />);
    expect(markup).toContain("Sign in as local admin");
    expect(markup).not.toContain("Sign in with operator identity");
    expect(markup).not.toContain("verified MFA");
  });

  it("keeps managed operator sign-in for OIDC configuration", () => {
    const markup = renderToStaticMarkup(<ControlRoom enabled />);
    expect(markup).toContain("Sign in with operator identity");
    expect(markup).toContain("verified MFA");
    expect(markup).not.toContain("Sign in as local admin");
  });

  it("does not offer either sign-in action while control is disabled", () => {
    const markup = renderToStaticMarkup(<ControlRoom enabled={false} localAdmin />);
    expect(markup).toContain("operator console is disabled");
    expect(markup).not.toContain("Sign in as local admin");
    expect(markup).not.toContain("Sign in with operator identity");
  });
});
