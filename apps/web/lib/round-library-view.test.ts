import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readRoundLibraryView,
  roundLibraryViewStorageKey,
  writeRoundLibraryView,
} from "./round-library-view";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

describe("Round library view preference", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("versions and scopes the key to the workspace", () => {
    expect(roundLibraryViewStorageKey("workspace-a")).toBe(
      "openround:round-library-view:v1:workspace-a",
    );
    expect(roundLibraryViewStorageKey("workspace-b")).not.toBe(
      roundLibraryViewStorageKey("workspace-a"),
    );
  });

  it("round-trips an allowlisted view without crossing workspaces", () => {
    vi.stubGlobal("window", { localStorage: memoryStorage() });
    writeRoundLibraryView("workspace-a", "list");

    expect(readRoundLibraryView("workspace-a")).toBe("list");
    expect(readRoundLibraryView("workspace-b")).toBe("grid");
  });

  it("falls back to grid for stale or unavailable storage", () => {
    const stale = memoryStorage({
      [roundLibraryViewStorageKey("workspace-a")]: "table",
    });
    const unavailable = {
      getItem() {
        throw new Error("blocked");
      },
    };

    vi.stubGlobal("window", { localStorage: stale });
    expect(readRoundLibraryView("workspace-a")).toBe("grid");
    vi.stubGlobal("window", { localStorage: unavailable });
    expect(readRoundLibraryView("workspace-a")).toBe("grid");
  });

  it("handles a blocked localStorage getter when reading and writing", () => {
    vi.stubGlobal("window", {
      get localStorage() {
        throw new DOMException("Storage is blocked", "SecurityError");
      },
    });

    expect(readRoundLibraryView("workspace-a")).toBe("grid");
    expect(() => writeRoundLibraryView("workspace-a", "list")).not.toThrow();
  });
});
