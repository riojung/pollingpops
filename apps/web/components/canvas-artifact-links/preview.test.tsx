import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasVersionViewSchema, type CanvasArtifactLink } from "@openround/contracts";
import { CanvasArtifactPreview } from "./preview";
import { ApiClientError } from "../../lib/api";
import { canvasId, canvasObject } from "../canvas-boards/canvas-test-fixtures";
import { flushPromises, hookHarness } from "./test-support";
const mocked = vi.hoisted(() => ({ read: vi.fn(), watch: vi.fn(), surface: vi.fn() }));
vi.mock("react", async (original) => {
  const { hookReact } = await import("./test-support");
  return hookReact(await original<typeof ReactModule>());
});
vi.mock("./client", () => ({ readCanvasArtifactPreview: mocked.read }));
vi.mock("../canvas-boards/canvas-client", () => ({ watchCanvas: mocked.watch }));
vi.mock("../locale-provider", () => ({ useLocale: () => ({ locale: "en-CA" }) }));
vi.mock("../canvas-boards/canvas-surface", () => ({
  CanvasReadOnlySurface: (props: { objects: Array<{ text?: string }> }) => {
    mocked.surface(props);
    return <div>{props.objects.map((object) => object.text).join(" ")}</div>;
  },
}));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const target = { kind: "presentation" as const, targetId: id(1) };
const link: CanvasArtifactLink = {
  id: id(2),
  boardId: canvasId,
  versionId: id(3),
  boardTitle: "Private canvas",
  name: "Saved diagram",
  createdAt: "2026-10-01T00:00:00.000Z",
  createdBy: null,
  revision: 1 as const,
  canDelete: true,
};
const scene = () =>
  CanvasVersionViewSchema.parse({
    schemaVersion: 2,
    boardId: canvasId,
    version: {
      id: link.versionId,
      name: link.name,
      version: 1,
      createdAt: link.createdAt,
      createdBy: null,
      canvasSeq: 1,
      objectCount: 1,
    },
    objects: [{ ...canvasObject, text: "Authorized synthetic body" }],
  });
const mounted: Array<{ unmount: () => void }> = [];
function mount() {
  const unavailable = vi.fn();
  const view = hookHarness(() =>
    CanvasArtifactPreview({ target, link, onClose: vi.fn(), onUnavailable: unavailable }),
  );
  mounted.push(view);
  view.render();
  return { ...view, unavailable, html: () => renderToStaticMarkup(view.render()) };
}
function deferWatch() {
  let reject!: (error: Error) => void;
  mocked.watch.mockImplementationOnce(
    (_id, signal: AbortSignal) =>
      new Promise<void>((resolve, fail) => {
        reject = fail;
        signal.addEventListener("abort", () => resolve(), { once: true });
      }),
  );
  return (error: Error) => reject(error);
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  mocked.read.mockResolvedValue(scene());
  mocked.watch.mockImplementation(
    (_id, signal: AbortSignal) =>
      new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      ),
  );
});
afterEach(() => {
  for (const view of mounted.splice(0)) view.unmount();
  vi.useRealTimers();
});
describe("authorized snapshot preview lifetime", () => {
  it.each([
    ["disabled realtime", new ApiClientError("Live updates unavailable", "UNAVAILABLE", 503)],
    ["interrupted transport", new Error("Canvas live updates interrupted")],
  ] as const)(
    "preserves a fresh scene during %s without letting retries renew freshness",
    async (_, error) => {
      const interrupt = deferWatch();
      mocked.watch.mockRejectedValue(error);
      const view = mount();
      await flushPromises();
      expect(view.html()).toContain("Authorized synthetic body");
      let resolve!: (value: ReturnType<typeof scene>) => void;
      mocked.read.mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      );
      interrupt(error);
      await flushPromises();
      expect(mocked.read).toHaveBeenCalledTimes(2);
      expect(view.html()).toContain("Authorized synthetic body");
      await vi.advanceTimersByTimeAsync(1000);
      expect(mocked.watch).toHaveBeenCalledTimes(2);
      expect(mocked.read).toHaveBeenCalledTimes(2);
      expect(view.html()).toContain("Authorized synthetic body");
      resolve(scene());
      await flushPromises();
      expect(mocked.read).toHaveBeenCalledTimes(3);
      expect(view.html()).toContain("Authorized synthetic body");
      // The successful refresh renews freshness, but later watch retries cannot do so alone.
      mocked.read.mockImplementation(() => new Promise(() => {}));
      await vi.advanceTimersByTimeAsync(4999);
      expect(view.html()).toContain("Authorized synthetic body");
      await vi.advanceTimersByTimeAsync(1);
      expect(view.html()).not.toContain("Authorized synthetic body");
      expect(view.unavailable).not.toHaveBeenCalled();
    },
  );
  it.each([401, 403, 404, 410])(
    "clears a fresh scene immediately when events deny access with %s",
    async (status) => {
      const interrupt = deferWatch();
      const view = mount();
      await flushPromises();
      expect(view.html()).toContain("Authorized synthetic body");
      mocked.read.mockImplementation(() => new Promise(() => {}));
      interrupt(new ApiClientError("Canvas access denied", "UNAVAILABLE", status));
      await flushPromises();
      expect(view.html()).not.toContain("Authorized synthetic body");
      expect(view.unavailable).toHaveBeenCalledOnce();
      expect(mocked.read).toHaveBeenCalledOnce();
      expect((mocked.watch.mock.calls[0]![1] as AbortSignal).aborted).toBe(true);
    },
  );
  it("cannot republish an older fallback response after source metadata changes", async () => {
    const interrupt = deferWatch();
    const view = mount();
    await flushPromises();
    expect(view.html()).toContain("Authorized synthetic body");
    let resolveOlder!: (value: ReturnType<typeof scene>) => void;
    let resolveCurrent!: (value: ReturnType<typeof scene>) => void;
    mocked.read
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolveOlder = done;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolveCurrent = done;
          }),
      );
    interrupt(new Error("Canvas live updates interrupted"));
    await flushPromises();
    expect(view.html()).toContain("Authorized synthetic body");
    await vi.advanceTimersByTimeAsync(1000);
    mocked.watch.mock.calls.at(-1)![2]();
    expect(view.html()).not.toContain("Authorized synthetic body");
    resolveOlder(scene());
    await flushPromises();
    expect(mocked.read).toHaveBeenCalledTimes(3);
    expect(view.html()).not.toContain("Authorized synthetic body");
    resolveCurrent({ ...scene(), objects: [] });
    await flushPromises();
    view.html();
    expect(mocked.surface.mock.calls.at(-1)![0].objects).toEqual([]);
    expect(view.unavailable).not.toHaveBeenCalled();
  });
  it("passes only the target-proxy media context to the read-only scene", async () => {
    const view = mount();
    await flushPromises();
    expect(view.html()).toContain("Authorized synthetic body");
    expect(mocked.surface.mock.calls.at(-1)![0]).toMatchObject({
      artifactLink: { ...target, linkId: link.id },
      canvasId,
      versionId: link.versionId,
    });
    expect(mocked.surface.mock.calls.at(-1)![0]).not.toHaveProperty("sourceBoardId");
    expect(mocked.watch.mock.calls[0]![0]).toBe(canvasId);
  });
  it("unmounts the old scene immediately on metadata change while the target proxy reread waits", async () => {
    const view = mount();
    await flushPromises();
    expect(view.html()).toContain("Authorized synthetic body");
    let resolve!: (value: ReturnType<typeof scene>) => void;
    mocked.read.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    mocked.watch.mock.calls[0]![2]();
    expect(view.html()).not.toContain("Authorized synthetic body");
    expect(view.html()).toContain("Loading authorized snapshot");
    resolve({ ...scene(), objects: [] });
    await flushPromises();
    expect(view.html()).not.toContain("Authorized synthetic body");
  });
  it("clears the body and terminates the source subscription on target access failure", async () => {
    const view = mount();
    await flushPromises();
    view.html();
    mocked.read.mockRejectedValueOnce(new Error("access revoked"));
    await vi.advanceTimersByTimeAsync(5000);
    expect(view.html()).not.toContain("Authorized synthetic body");
    expect(view.unavailable).toHaveBeenCalledOnce();
    expect((mocked.watch.mock.calls[0]![1] as AbortSignal).aborted).toBe(true);
  });
  it("expires a stalled target read and aborts all requests when closed", async () => {
    const view = mount();
    await flushPromises();
    expect(view.html()).toContain("Authorized synthetic body");
    mocked.read.mockImplementation(() => new Promise(() => {}));
    await vi.advanceTimersByTimeAsync(5000);
    expect(view.html()).not.toContain("Authorized synthetic body");
    view.unmount();
    expect((mocked.read.mock.calls.at(-1)![2] as AbortSignal).aborted).toBe(true);
  });
  it("treats source revocation as immediate preview removal", async () => {
    const view = mount();
    await flushPromises();
    expect(view.html()).toContain("Authorized synthetic body");
    mocked.watch.mock.calls[0]![3]();
    expect(view.html()).not.toContain("Authorized synthetic body");
    expect(view.unavailable).toHaveBeenCalledOnce();
  });
});
