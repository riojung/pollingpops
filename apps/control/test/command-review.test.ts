import { describe, expect, it } from "vitest";
import { commandReviewDetails } from "../app/command-review";

describe("pending command review", () => {
  it("hides credentials after integration reauthentication without changing the pending command", () => {
    const pending = {
      action: "integration.connect",
      integration: "jira",
      accessToken: "synthetic-access",
      refreshToken: "synthetic-refresh",
      clientSecret: "synthetic-secret",
      clientId: "synthetic-client",
    };
    const shown = commandReviewDetails(pending);
    const rendered = JSON.stringify(shown);
    for (const value of [pending.accessToken, pending.refreshToken, pending.clientSecret])
      expect(rendered).not.toContain(value);
    expect(shown).toMatchObject({ integration: "jira", clientId: "synthetic-client" });
    expect(pending.accessToken).toBe("synthetic-access");
    expect(pending.refreshToken).toBe("synthetic-refresh");
    expect(pending.clientSecret).toBe("synthetic-secret");
  });
});
