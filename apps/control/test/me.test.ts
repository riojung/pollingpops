import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PASSWORD_OPERATOR_ISSUER } from "@openround/control-plane";
import { authenticatedRequest } from "../lib/http";
import type * as HttpModule from "../lib/http";
import { GET } from "../app/api/me/route";

vi.mock("server-only", () => ({}));
vi.mock("../lib/runtime", () => ({ controlRuntime: vi.fn() }));
vi.mock("../lib/http", async (original) => ({
  ...(await original<typeof HttpModule>()),
  authenticatedRequest: vi.fn(),
}));

describe("authenticated operator projection", () => {
  beforeEach(() => vi.resetAllMocks());

  it.each([
    [PASSWORD_OPERATOR_ISSUER, "synthetic-operator"],
    ["https://identity.example.test", undefined],
  ])("exposes a username only for password identity %s", async (issuer, username) => {
    vi.mocked(authenticatedRequest).mockResolvedValue({
      context: {
        operator: {
          id: "synthetic-id",
          issuer,
          subject: "synthetic-operator",
          name: "Synthetic operator",
          role: "readonly",
          capabilities: [],
          active: true,
        },
      },
      cookieNames: { csrf: "operator-csrf" },
    } as unknown as Awaited<ReturnType<typeof authenticatedRequest>>);
    const response = await GET(
      new NextRequest("https://control.example.test/api/me", {
        headers: { cookie: "operator-csrf=synthetic-csrf" },
      }),
    );
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(result.csrfToken).toBe("synthetic-csrf");
    expect(result.operator).toMatchObject({ id: "synthetic-id", name: "Synthetic operator" });
    if (username) expect(result.operator.username).toBe(username);
    else expect(result.operator).not.toHaveProperty("username");
    expect(result.operator).not.toHaveProperty("issuer");
    expect(result.operator).not.toHaveProperty("subject");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
