import { afterEach, describe, expect, it, vi } from "vitest";
import { clientUuid } from "./uuid";

describe("clientUuid", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("creates distinct RFC 4122 version 4 identifiers", () => {
    const first = clientUuid();
    const second = clientUuid();
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(second).not.toBe(first);
  });

  it("uses secure random bytes when randomUUID is unavailable on a LAN HTTP origin", () => {
    const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
    const fill = vi.fn(getRandomValues);
    vi.stubGlobal("crypto", { getRandomValues: fill });
    const first = clientUuid();
    const second = clientUuid();
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(second).not.toBe(first);
    expect(fill).toHaveBeenCalledTimes(2);
  });
});
