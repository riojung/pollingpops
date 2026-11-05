import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PresentationVisualImportJob } from "@openround/contracts";

const mocked = vi.hoisted(() => ({
  hooks: null as null | { cursor: number; slots: unknown[]; effects: Array<() => void> },
  fetch: vi.fn(),
  load: vi.fn(),
  save: vi.fn(),
}));
vi.mock("../../lib/api", () => ({
  apiFetch: mocked.fetch,
  humanError: (error: Error) => error.message,
}));
vi.mock("../../lib/builder-recovery", () => ({
  loadBuilderRecovery: mocked.load,
  saveBuilderRecovery: mocked.save,
}));
vi.mock("../workspace/workspace-provider", () => ({
  useWorkspace: () => ({ creator: { workspaceId: "workspace" } }),
}));
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useState: <T,>(initial: T) => {
      const hooks = mocked.hooks;
      if (!hooks) return react.useState(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = initial;
      return [
        hooks.slots[index],
        (next: T | ((value: T) => T)) => {
          hooks.slots[index] =
            typeof next === "function" ? (next as (value: T) => T)(hooks.slots[index] as T) : next;
        },
      ];
    },
    useRef: <T,>(initial: T) => {
      const hooks = mocked.hooks;
      if (!hooks) return react.useRef(initial);
      const index = hooks.cursor++;
      hooks.slots[index] ??= { current: initial };
      return hooks.slots[index];
    },
    useCallback: <T,>(callback: T, dependencies: unknown[]) => {
      const hooks = mocked.hooks;
      if (!hooks) return react.useCallback(callback as (...args: never[]) => unknown, dependencies);
      const index = hooks.cursor++;
      const previous = hooks.slots[index] as { dependencies: unknown[]; callback: T } | undefined;
      if (
        !previous ||
        dependencies.some((value, offset) => value !== previous.dependencies[offset])
      ) {
        hooks.slots[index] = { dependencies, callback };
      }
      return (hooks.slots[index] as { callback: T }).callback;
    },
    useEffect: (effect: () => void | (() => void), dependencies: unknown[]) => {
      const hooks = mocked.hooks;
      if (!hooks) return react.useEffect(effect, dependencies);
      const index = hooks.cursor++;
      const previous = hooks.slots[index] as
        { dependencies: unknown[]; cleanup?: () => void } | undefined;
      if (
        !previous ||
        dependencies.some((value, offset) => value !== previous.dependencies[offset])
      ) {
        hooks.slots[index] = { dependencies };
        hooks.effects.push(() => {
          previous?.cleanup?.();
          const cleanup = effect();
          if (cleanup) (hooks.slots[index] as { cleanup?: () => void }).cleanup = cleanup;
        });
      }
    },
  };
});
import { PresentationVisualImport, VisualPageReviewFields } from "./presentation-visual-import";

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
const presentationId = randomUUID();
const jobId = randomUUID();
const page = {
  pageNumber: 1,
  mediaId: randomUUID(),
  width: 1200,
  height: 800,
  extractedText: "A suggested order.",
  warnings: [],
};
const job: PresentationVisualImportJob = {
  id: jobId,
  presentationId,
  status: "ready",
  sourceType: "pdf",
  sourceName: "Review.pdf",
  sourceDigest: "a".repeat(64),
  fileCount: 1,
  pageCount: 1,
  attempts: 1,
  pages: [page],
  warnings: [],
  error: null,
  retainOriginal: false,
  createdAt: "2026-11-04T00:00:00Z",
  updatedAt: "2026-11-04T00:01:00Z",
  expiresAt: "2026-11-05T00:00:00Z",
};
const review = {
  title: "Evidence",
  alternativeText: "Two bars",
  accessibleText: "The second bar is twice the first.",
  readingOrderReviewed: true,
};

function harness() {
  const hooks = { cursor: 0, slots: [] as unknown[], effects: [] as Array<() => void> };
  const props = {
    presentationId,
    open: true,
    afterBlockId: randomUUID(),
    prepareInsert: vi.fn().mockResolvedValue(8),
    onInserted: vi.fn().mockResolvedValue(undefined),
    onReloadDraft: vi.fn().mockResolvedValue(undefined),
    onClose: vi.fn(),
    onResumeRequired: vi.fn(),
    onPendingChange: vi.fn(),
  };
  let tree: ReactNode;
  function render() {
    hooks.cursor = 0;
    mocked.hooks = hooks;
    try {
      tree = PresentationVisualImport(props);
    } finally {
      mocked.hooks = null;
    }
    const effects = hooks.effects.splice(0);
    for (const effect of effects) effect();
  }
  return {
    props,
    render,
    async settle() {
      for (let index = 0; index < 12; index++) {
        await Promise.resolve();
        render();
      }
    },
    find(predicate: (node: ReactElement<Record<string, unknown>>) => boolean) {
      const node = elements(tree).find(predicate);
      if (!node) throw new Error("Missing visual import control");
      return node;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.load.mockResolvedValue(null);
  mocked.save.mockResolvedValue(undefined);
  mocked.fetch.mockResolvedValue({
    available: true,
    jobs: [job],
    limits: {
      maxPdfBytes: 6000000,
      maxImageBytes: 10485760,
      maxImageSetBytes: 20000000,
      maxPages: 40,
    },
  });
  vi.stubGlobal("document", { activeElement: null });
  vi.stubGlobal("HTMLElement", class {});
  vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => {
  mocked.hooks = null;
  vi.unstubAllGlobals();
});

describe("visual slide import UI", () => {
  it("discloses visual fidelity, editable reading pairs, extraction limits and original retention", () => {
    const markup = renderToStaticMarkup(
      <PresentationVisualImport
        presentationId={presentationId}
        open
        afterBlockId={null}
        prepareInsert={async () => 1}
        onInserted={() => undefined}
        onReloadDraft={async () => undefined}
        onClose={() => undefined}
        onResumeRequired={() => undefined}
        onPendingChange={() => undefined}
      />,
    );
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain("2 slides: a visual and an editable reading version");
    expect(markup).toContain("no editable source objects");
    expect(markup).toContain("There is no OCR guarantee");
    expect(markup).toContain("within 24 hours");
    expect(markup).toContain("separate from trusted-source proposals");
  });
  it("provides distinct alt and editable reading controls and resets review after content changes", () => {
    const onChange = vi.fn();
    const tree = VisualPageReviewFields({ pageNumber: 1, review, disabled: false, onChange });
    const input = elements(tree).find(
      (node) => node.type === "textarea" && node.props.maxLength === 3000,
    )!;
    (input.props.onChange as (event: { target: { value: string } }) => void)({
      target: { value: "Corrected meaning." },
    });
    expect(onChange).toHaveBeenCalledWith({
      ...review,
      accessibleText: "Corrected meaning.",
      readingOrderReviewed: false,
    });
    const markup = renderToStaticMarkup(tree);
    expect(markup).toContain("Image description");
    expect(markup).toContain("Accessible text");
    expect(markup).toContain('maxLength="300"');
    expect(markup).toContain('maxLength="3000"');
    expect(markup).toContain("Scanned pages may have no extracted text");
    expect(markup).not.toContain("dangerouslySetInnerHTML");
  });
  it("restores an ambiguous insertion, fences new edits and replays its exact original anchor and revision", async () => {
    const body = JSON.stringify({
      expectedRevision: 4,
      mutationId: randomUUID(),
      afterBlockId: randomUUID(),
      fidelityAccepted: true,
      pages: [{ pageNumber: 1, ...review }],
    });
    mocked.load.mockResolvedValue({
      draft: {
        createBody: null,
        insertBody: body,
        insertJobId: jobId,
        jobId,
        order: [1],
        reviews: { 1: review },
        fidelity: true,
      },
    });
    mocked.fetch.mockImplementation(async (_path: string, init?: RequestInit) =>
      init?.method === "POST"
        ? { insertedBlockIds: ["visual", "reading"] }
        : { available: true, jobs: [job], limits: {} },
    );
    const view = harness();
    view.render();
    await view.settle();
    expect(view.props.onResumeRequired).toHaveBeenCalled();
    expect(view.props.onPendingChange).toHaveBeenCalledWith(true);
    const chooser = view.find((node) => node.type === "input" && node.props.type === "file");
    expect(chooser.props.disabled).toBe(true);
    const retry = view.find(
      (node) => node.type === "button" && String(node.props.children).includes("Retry same"),
    );
    (retry.props.onClick as () => void)();
    await view.settle();
    const post = mocked.fetch.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(post[0]).toBe(`/v1/presentations/${presentationId}/visual-imports/${jobId}/insert`);
    expect(post[1].body).toBe(body);
    expect(view.props.prepareInsert).not.toHaveBeenCalled();
    expect(view.props.onInserted).toHaveBeenCalledWith(["visual", "reading"]);
    expect(view.props.onClose).toHaveBeenCalledOnce();
    expect(view.props.onPendingChange).toHaveBeenLastCalledWith(false);
  });
  it("retains a lost upload acknowledgement and sends the same request ID and file bytes", async () => {
    const body = JSON.stringify({
      requestId: randomUUID(),
      retainOriginal: false,
      files: [{ name: "slide.png", mimeType: "image/png", base64: "YQ==" }],
    });
    mocked.load.mockResolvedValue({
      draft: {
        createBody: body,
        insertBody: null,
        insertJobId: null,
        jobId: "",
        order: [],
        reviews: {},
        fidelity: false,
      },
    });
    mocked.fetch.mockImplementation(async (_path: string, init?: RequestInit) => {
      if (init?.method === "POST") throw new Error("Acknowledgement lost");
      return { available: true, jobs: [job], limits: {} };
    });
    const view = harness();
    view.render();
    await view.settle();
    for (let index = 0; index < 2; index++) {
      const retry = view.find(
        (node) => node.type === "button" && String(node.props.children).includes("Retry same"),
      );
      (retry.props.onClick as () => void)();
      await view.settle();
    }
    const posts = mocked.fetch.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(2);
    expect(posts.map(([, init]) => init.body)).toEqual([body, body]);
    expect(view.props.onClose).not.toHaveBeenCalled();
    expect(view.props.onPendingChange).not.toHaveBeenCalledWith(false);
    expect(
      view.find((node) => node.type === "button" && node.props.children === "Close visual import")
        .props.disabled,
    ).toBe(true);
  });
  it("flushes the draft for a new ordered insertion, then preserves its receipt through lost acknowledgement", async () => {
    mocked.load.mockResolvedValue({
      draft: {
        createBody: null,
        insertBody: null,
        insertJobId: null,
        jobId,
        order: [1],
        reviews: { 1: review },
        fidelity: true,
      },
    });
    let postCount = 0;
    mocked.fetch.mockImplementation(async (_path: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        postCount++;
        if (postCount === 1) throw new Error("Acknowledgement lost");
        return { insertedBlockIds: ["visual", "reading"] };
      }
      return { available: true, jobs: [job], limits: {} };
    });
    const view = harness();
    view.render();
    await view.settle();
    const originalAnchor = view.props.afterBlockId;
    const insert = view.find(
      (node) => node.type === "button" && String(node.props.children).includes("reviewed slides"),
    );
    expect(insert.props.disabled).toBe(false);
    (insert.props.onClick as () => void)();
    await view.settle();
    const first = mocked.fetch.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(view.props.prepareInsert).toHaveBeenCalledOnce();
    expect(JSON.parse(first[1].body)).toMatchObject({
      expectedRevision: 8,
      afterBlockId: originalAnchor,
      fidelityAccepted: true,
      pages: [{ pageNumber: 1, ...review }],
    });
    expect(mocked.save.mock.calls.some(([, , value]) => value.insertBody === first[1].body)).toBe(
      true,
    );
    view.props.afterBlockId = randomUUID();
    view.props.prepareInsert.mockResolvedValue(99);
    view.render();
    const retry = view.find(
      (node) => node.type === "button" && String(node.props.children).includes("Retry same"),
    );
    (retry.props.onClick as () => void)();
    await view.settle();
    const posts = mocked.fetch.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(2);
    expect(posts[1]![1].body).toBe(first[1].body);
    expect(view.props.prepareInsert).toHaveBeenCalledOnce();
    expect(view.props.onClose).toHaveBeenCalledOnce();
  });
  it("replays the accepted insertion when local receipt cleanup fails, without losing its job path", async () => {
    const body = JSON.stringify({
      expectedRevision: 4,
      mutationId: randomUUID(),
      afterBlockId: randomUUID(),
      fidelityAccepted: true,
      pages: [{ pageNumber: 1, ...review }],
    });
    mocked.load.mockResolvedValue({
      draft: {
        createBody: null,
        insertBody: body,
        insertJobId: jobId,
        jobId,
        order: [1],
        reviews: { 1: review },
        fidelity: true,
      },
    });
    let failCleanup = true;
    mocked.save.mockImplementation(async (_key, _revision, value) => {
      if (!value.insertBody && value.jobId === "" && failCleanup) {
        failCleanup = false;
        throw new Error("Local cleanup unavailable");
      }
    });
    mocked.fetch.mockImplementation(async (_path: string, init?: RequestInit) =>
      init?.method === "POST"
        ? { insertedBlockIds: ["visual", "reading"] }
        : { available: true, jobs: [job], limits: {} },
    );
    const view = harness();
    view.render();
    await view.settle();
    for (let index = 0; index < 2; index++) {
      const retry = view.find(
        (node) => node.type === "button" && String(node.props.children).includes("Retry same"),
      );
      (retry.props.onClick as () => void)();
      await view.settle();
    }
    const posts = mocked.fetch.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts.map(([path, init]) => ({ path, body: init.body }))).toEqual([
      { path: `/v1/presentations/${presentationId}/visual-imports/${jobId}/insert`, body },
      { path: `/v1/presentations/${presentationId}/visual-imports/${jobId}/insert`, body },
    ]);
    expect(view.props.onClose).toHaveBeenCalledOnce();
  });
});
