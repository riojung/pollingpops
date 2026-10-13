import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadControlConfig } from "@openround/control-plane";
import type * as ControlPlane from "@openround/control-plane";
import { assertRestrictedRuntimeDatabasePrincipal } from "@openround/db";
import type * as Database from "@openround/db";
import { controlRuntime } from "../lib/runtime";
import { GET } from "../app/api/health/ready/route";

vi.mock("server-only", () => ({}));
vi.mock("@openround/control-plane", async (original) => ({
  ...(await original<typeof ControlPlane>()),
  loadControlConfig: vi.fn(),
}));
vi.mock("@openround/db", async (original) => ({
  ...(await original<typeof Database>()),
  assertRestrictedRuntimeDatabasePrincipal: vi.fn(),
}));
vi.mock("../lib/runtime", () => ({ controlRuntime: vi.fn() }));

describe("operator readiness without diagnostic disclosures", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });
  it("allows disabled development, but disabled production is unavailable", async () => {
    vi.mocked(loadControlConfig).mockReturnValue({
      CONTROL_ENABLED: false,
      NODE_ENV: "development",
    } as ReturnType<typeof loadControlConfig>);
    expect((await GET()).status).toBe(200);
    vi.mocked(loadControlConfig).mockReturnValue({
      CONTROL_ENABLED: false,
      NODE_ENV: "production",
    } as ReturnType<typeof loadControlConfig>);
    expect((await GET()).status).toBe(503);
    expect(controlRuntime).not.toHaveBeenCalled();
  });
  it("requeries the database and principal for every enabled production probe", async () => {
    vi.mocked(loadControlConfig).mockReturnValue({
      CONTROL_ENABLED: true,
      NODE_ENV: "production",
    } as ReturnType<typeof loadControlConfig>);
    const inspect = vi.fn().mockResolvedValue({});
    const listOperators = vi.fn().mockResolvedValue([]);
    vi.mocked(controlRuntime).mockResolvedValue({
      repository: { inspectRuntimeDatabasePrincipal: inspect },
      platform: { listOperators },
    } as unknown as Awaited<ReturnType<typeof controlRuntime>>);
    expect((await GET()).status).toBe(200);
    expect((await GET()).status).toBe(200);
    expect(inspect).toHaveBeenCalledTimes(2);
    expect(assertRestrictedRuntimeDatabasePrincipal).toHaveBeenCalledTimes(2);
    expect(listOperators).toHaveBeenCalledTimes(2);
    inspect.mockRejectedValue(new Error("postgres://owner:private-database-secret@host"));
    const unavailable = await GET();
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({
      status: "unavailable",
      service: "pollingpops-control",
    });
  });
  it("fails closed for invalid assurance configuration or a privileged database principal", async () => {
    vi.mocked(loadControlConfig).mockImplementation(() => {
      throw new Error("private-provider-secret");
    });
    const invalid = await GET();
    expect(invalid.status).toBe(503);
    expect(await invalid.text()).not.toContain("private-provider-secret");
    vi.mocked(loadControlConfig).mockReturnValue({
      CONTROL_ENABLED: true,
      NODE_ENV: "production",
    } as ReturnType<typeof loadControlConfig>);
    vi.mocked(controlRuntime).mockResolvedValue({
      repository: { inspectRuntimeDatabasePrincipal: vi.fn().mockResolvedValue({}) },
      platform: { listOperators: vi.fn() },
    } as unknown as Awaited<ReturnType<typeof controlRuntime>>);
    vi.mocked(assertRestrictedRuntimeDatabasePrincipal).mockImplementation(() => {
      throw new Error("owner role with private-database-secret");
    });
    const privileged = await GET();
    expect(privileged.status).toBe(503);
    expect(await privileged.text()).not.toContain("private-database-secret");
  });
});
