import { afterEach, describe, expect, it, vi } from "vitest";
import Page, { metadata } from "./page";

describe("Learning sequence development route", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("allows the rehearsal in development and keeps it out of search", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(Page()).toBeDefined();
    expect(metadata.robots).toMatchObject({ index: false, follow: false });
  });

  it.each(["production", "test"])("rejects the %s runtime on the server", (environment) => {
    vi.stubEnv("NODE_ENV", environment);
    expect(() => Page()).toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
  });
});
