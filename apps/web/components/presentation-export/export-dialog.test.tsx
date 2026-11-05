import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import type { PresentationStaticExportSource } from "@openround/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as ExportClient from "../../lib/presentation-static-export-client";
import { PresentationExportButton, PresentationExportDialog } from "./export-dialog";

interface Hooks {
  cursor: number;
  slots: unknown[];
  dependencies: Map<number, readonly unknown[] | undefined>;
  effects: Array<{ index: number; effect: ReactModule.EffectCallback }>;
  cleanups: Map<number, void | (() => void)>;
}
const mocked = vi.hoisted(() => ({
  hooks: null as Hooks | null,
  source: vi.fn(),
  artifact: vi.fn(),
  download: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof ReactModule>()),
  useId: () => "presentation-export-title",
  useRef: <T,>(initial: T) => {
    const hooks = mocked.hooks!;
    const index = hooks.cursor++;
    hooks.slots[index] ??= { current: initial };
    return hooks.slots[index];
  },
  useState: <T,>(initial: T) => {
    const hooks = mocked.hooks!;
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [
      hooks.slots[index],
      (next: T | ((current: T) => T)) => {
        hooks.slots[index] =
          typeof next === "function" ? (next as (current: T) => T)(hooks.slots[index] as T) : next;
      },
    ];
  },
  useEffect: (effect: ReactModule.EffectCallback, dependencies?: readonly unknown[]) => {
    const hooks = mocked.hooks!;
    const index = hooks.cursor++;
    const previous = hooks.dependencies.get(index);
    if (
      !hooks.dependencies.has(index) ||
      !dependencies ||
      dependencies.some((value, dependency) => value !== previous?.[dependency])
    )
      hooks.effects.push({ index, effect });
    hooks.dependencies.set(index, dependencies);
  },
}));
vi.mock("../../lib/presentation-static-export-client", async (original) => ({
  ...(await original<typeof ExportClient>()),
  fetchPresentationStaticExportSource: mocked.source,
  fetchPresentationStaticExport: mocked.artifact,
  downloadPresentationStaticExport: mocked.download,
}));

const presentationId = "00000000-0000-4000-8000-000000000001";
const versionId = "00000000-0000-4000-8000-000000000002";
const firstBlockId = "00000000-0000-4000-8000-000000000003";
const secondBlockId = "00000000-0000-4000-8000-000000000004";
const mounted = new Set<{ unmount: () => void }>();
function source(): PresentationStaticExportSource {
  return {
    versionId,
    version: 3,
    title: "Published deck",
    pages: [
      { blockId: firstBlockId, title: "Published first page" },
      { blockId: secondBlockId, title: "Published second page" },
    ],
  };
}
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return isValidElement<{ children?: ReactNode }>(node) ? text(node.props.children) : "";
}
function harness(
  renderComponent: () => ReactNode,
  attach?: (nodes: ReturnType<typeof elements>) => void,
) {
  const hooks: Hooks = {
    cursor: 0,
    slots: [],
    dependencies: new Map(),
    effects: [],
    cleanups: new Map(),
  };
  const view = {
    render() {
      hooks.cursor = 0;
      hooks.effects = [];
      mocked.hooks = hooks;
      let tree: ReactNode;
      try {
        tree = renderComponent();
      } finally {
        mocked.hooks = null;
      }
      const nodes = elements(tree);
      attach?.(nodes);
      for (const { index, effect } of hooks.effects) {
        hooks.cleanups.get(index)?.();
        hooks.cleanups.set(index, effect());
      }
      return nodes;
    },
    text: () => text(view.render()[0]),
    button(label: string) {
      const button = view
        .render()
        .find(
          (node) =>
            node.type === "button" &&
            (node.props["aria-label"] ?? text(node.props.children as ReactNode)) === label,
        );
      expect(button).toBeDefined();
      return button!;
    },
    click(label: string) {
      const button = view.button(label);
      expect(button.props.disabled).not.toBe(true);
      (button.props.onClick as () => void)();
      view.render();
    },
    select(label: string) {
      const container = view
        .render()
        .find((node) => node.type === "label" && text(node).startsWith(label));
      expect(container).toBeDefined();
      return elements(container).find((node) => node.type === "select")!;
    },
    choose(label: string, value: string) {
      const select = view.select(label);
      expect(select.props.disabled).not.toBe(true);
      (select.props.onChange as (event: unknown) => void)({ target: { value } });
    },
    unmount() {
      for (const cleanup of hooks.cleanups.values()) cleanup?.();
      hooks.cleanups.clear();
      mounted.delete(view);
    },
  };
  mounted.add(view);
  view.render();
  return view;
}
function setup() {
  mocked.source.mockReset().mockResolvedValue(source());
  mocked.artifact
    .mockReset()
    .mockImplementation(async (_id: string, request: { format: string }) => ({
      blob: new Blob(["export"]),
      format: request.format,
    }));
  mocked.download.mockReset().mockReturnValue(vi.fn());
}
function mountDialog() {
  const modal = { showModal: vi.fn(), close: vi.fn() };
  const trigger = { isConnected: true, disabled: false, focus: vi.fn() };
  const closeButton = { focus: vi.fn() };
  const returnFocusRef = { current: trigger as unknown as HTMLButtonElement };
  const onClose = vi.fn();
  const view = harness(
    () => PresentationExportDialog({ presentationId, versionId, onClose, returnFocusRef }),
    (nodes) => {
      const dialog = nodes.find((node) => node.type === "dialog")!;
      (dialog.props.ref as ReactModule.RefObject<unknown>).current = modal;
      const close = nodes.find((node) => node.type === "button" && text(node) === "Close")!;
      (close.props.ref as ReactModule.RefObject<unknown>).current = closeButton;
    },
  );
  return { ...view, modal, trigger, closeButton, onClose };
}
async function settle() {
  for (let index = 0; index < 6; index++) await Promise.resolve();
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
afterEach(() => {
  for (const view of [...mounted]) view.unmount();
  mocked.hooks = null;
});

describe("published Presentation export dialog", () => {
  it.each([
    { versionId: null, disabled: false },
    { versionId, disabled: true },
  ])("requires publication and edit authority before opening: %s", (input) => {
    setup();
    const view = harness(() => PresentationExportButton({ presentationId, ...input }));
    expect(view.button("Export presentation").props.disabled).toBe(true);
    expect(view.render().some((node) => node.type === PresentationExportDialog)).toBe(false);
  });

  it("pins the version selected when opened even if a newer publication appears", () => {
    setup();
    let latest = versionId;
    const view = harness(() => PresentationExportButton({ presentationId, versionId: latest }));
    view.click("Export presentation");
    latest = "00000000-0000-4000-8000-000000000005";
    const dialog = view.render().find((node) => node.type === PresentationExportDialog)!;
    expect(dialog.props.versionId).toBe(versionId);
    const trigger = view.button("Export presentation");
    expect(dialog.props.returnFocusRef).toBe(trigger.props.ref);
  });

  it("loads published metadata and submits the selected frozen PNG block ID", async () => {
    setup();
    const view = mountDialog();
    expect(view.button("Download export").props.disabled).toBe(true);
    await settle();
    expect(mocked.source).toHaveBeenCalledWith(presentationId, versionId, expect.any(AbortSignal));
    expect(view.text()).toContain("Exports published version 3");
    expect(view.text()).toContain("Draft changes are excluded");
    expect(view.text()).toContain("may clip overflowing text");
    expect(view.text()).toContain("HTML for full readable text and panel details");
    expect(view.text()).toContain("Live answers and results are excluded");
    expect(view.text()).toContain("cannot be revoked");
    expect(view.text()).toContain("PDF is not tagged");
    view.choose("Format", "png");
    const options = elements(view.select("Published page")).filter(
      (node) => node.type === "option",
    );
    expect(options.map((node) => node.props.value)).toEqual([firstBlockId, secondBlockId]);
    expect(options.map(text)).toEqual(["1. Published first page", "2. Published second page"]);
    view.choose("Published page", secondBlockId);
    view.click("Download export");
    await settle();
    expect(mocked.artifact).toHaveBeenCalledExactlyOnceWith(
      presentationId,
      { versionId, format: "png", blockId: secondBlockId },
      expect.any(AbortSignal),
    );
    expect(mocked.download).toHaveBeenCalledOnce();
    expect(view.text()).toContain("Download started");
  });

  it.each(["pdf", "html"] as const)(
    "exports the whole published deck as %s without a page field",
    async (format) => {
      setup();
      const view = mountDialog();
      await settle();
      view.choose("Format", format);
      view.click("Download export");
      await settle();
      expect(mocked.artifact).toHaveBeenCalledExactlyOnceWith(
        presentationId,
        { versionId, format },
        expect.any(AbortSignal),
      );
    },
  );

  it("cancels a pending request, ignores its late result and permits an explicit retry", async () => {
    setup();
    const pending =
      deferred<Awaited<ReturnType<typeof ExportClient.fetchPresentationStaticExport>>>();
    mocked.artifact.mockReturnValueOnce(pending.promise);
    const view = mountDialog();
    await settle();
    const click = view.button("Download export").props.onClick as () => void;
    click();
    click();
    expect(mocked.artifact).toHaveBeenCalledTimes(1);
    expect(view.select("Format").props.disabled).toBe(true);
    const signal = mocked.artifact.mock.calls[0]![2] as AbortSignal;
    view.click("Cancel export");
    expect(signal.aborted).toBe(true);
    expect(view.text()).toContain("Export canceled");
    pending.resolve({ blob: new Blob(["late"]), format: "pdf" });
    await settle();
    expect(mocked.download).not.toHaveBeenCalled();
    view.click("Download export");
    await settle();
    expect(mocked.artifact).toHaveBeenCalledTimes(2);
    expect(mocked.download).toHaveBeenCalledOnce();
  });

  it("keeps the selected published page available after an export failure", async () => {
    setup();
    mocked.artifact.mockRejectedValueOnce(new Error("An image is unavailable. Try again."));
    const view = mountDialog();
    await settle();
    view.choose("Format", "png");
    view.choose("Published page", secondBlockId);
    view.click("Download export");
    await settle();
    expect(view.text()).toContain("An image is unavailable");
    expect(view.select("Published page").props.value).toBe(secondBlockId);
    expect(mocked.download).not.toHaveBeenCalled();
    view.click("Download export");
    await settle();
    expect(mocked.artifact.mock.calls.map((call) => call[1])).toEqual([
      { versionId, format: "png", blockId: secondBlockId },
      { versionId, format: "png", blockId: secondBlockId },
    ]);
    expect(mocked.download).toHaveBeenCalledOnce();
  });

  it("requires successful published metadata loading and offers a retry for the same version", async () => {
    setup();
    mocked.source.mockRejectedValueOnce(new Error("Published pages are temporarily unavailable."));
    const view = mountDialog();
    await settle();
    expect(view.text()).toContain("Published pages are temporarily unavailable");
    expect(view.button("Download export").props.disabled).toBe(true);
    view.click("Retry published pages");
    await settle();
    expect(mocked.source.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      [presentationId, versionId],
      [presentationId, versionId],
    ]);
    expect(view.button("Download export").props.disabled).toBe(false);
  });

  it.each(["Escape", "Close"])(
    "restores the actual trigger and releases download resources after %s",
    async (action) => {
      setup();
      const release = vi.fn();
      mocked.download.mockReturnValue(release);
      const view = mountDialog();
      await settle();
      expect(view.modal.showModal).toHaveBeenCalledOnce();
      expect(view.closeButton.focus).toHaveBeenCalledOnce();
      view.click("Download export");
      await settle();
      if (action === "Escape") {
        const modal = view.render().find((node) => node.type === "dialog")!;
        const event = { preventDefault: vi.fn() };
        (modal.props.onCancel as (event: unknown) => void)(event);
        expect(event.preventDefault).toHaveBeenCalledOnce();
      } else view.click("Close");
      expect(view.onClose).toHaveBeenCalledOnce();
      view.unmount();
      expect(view.modal.close).toHaveBeenCalledOnce();
      expect(view.trigger.focus).toHaveBeenCalledOnce();
      expect(release).toHaveBeenCalledOnce();
      expect((mocked.source.mock.calls[0]![2] as AbortSignal).aborted).toBe(true);
    },
  );

  it("aborts an active export on unmount and never downloads a late response", async () => {
    setup();
    const pending =
      deferred<Awaited<ReturnType<typeof ExportClient.fetchPresentationStaticExport>>>();
    mocked.artifact.mockReturnValueOnce(pending.promise);
    const view = mountDialog();
    await settle();
    view.click("Download export");
    const signal = mocked.artifact.mock.calls[0]![2] as AbortSignal;
    view.unmount();
    expect(signal.aborted).toBe(true);
    pending.resolve({ blob: new Blob(["late"]), format: "pdf" });
    await settle();
    expect(mocked.download).not.toHaveBeenCalled();
  });
});
