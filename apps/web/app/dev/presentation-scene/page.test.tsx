import { afterEach, describe, expect, it, vi } from "vitest";
import Page from "./page";

describe("Presentation scene development route", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("allows the prototype only in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(Page()).toBeDefined();
  });

  it.each(["production", "test"])("rejects the %s runtime on the server", (environment) => {
    vi.stubEnv("NODE_ENV", environment);
    expect(() => Page()).toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
  });
});
