import { describe, expect, it, vi } from "vitest";
import { publishBeforePresent } from "./publish-before-present";

describe("publish latest before presenting", () => {
  it("waits for the accepted publication before navigating", async () => {
    let accept!: (published: boolean) => void;
    const publish = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          accept = resolve;
        }),
    );
    const present = vi.fn();
    const pending = publishBeforePresent(publish, present);
    expect(present).not.toHaveBeenCalled();
    accept(true);
    await expect(pending).resolves.toBe(true);
    expect(present).toHaveBeenCalledOnce();
  });

  it("retains the editor when saving or publication was blocked", async () => {
    const present = vi.fn();
    await expect(publishBeforePresent(async () => false, present)).resolves.toBe(false);
    expect(present).not.toHaveBeenCalled();
  });

  it("does not navigate if publication unexpectedly rejects", async () => {
    const present = vi.fn();
    await expect(
      publishBeforePresent(async () => {
        throw new Error("Connection lost");
      }, present),
    ).rejects.toThrow("Connection lost");
    expect(present).not.toHaveBeenCalled();
  });

  it("ignores an accepted response after the actor or editor changes", async () => {
    let current = true;
    let accept!: (published: boolean) => void;
    const publish = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          accept = resolve;
        }),
    );
    const present = vi.fn();
    const pending = publishBeforePresent(publish, present, () => current);
    current = false;
    accept(true);
    await expect(pending).resolves.toBe(false);
    expect(present).not.toHaveBeenCalled();
    await expect(publishBeforePresent(publish, present, () => current)).resolves.toBe(false);
    expect(publish).toHaveBeenCalledOnce();
  });
});
