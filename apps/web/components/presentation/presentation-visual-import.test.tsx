import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  supportedLocales,
  type SupportedLocale,
  type PresentationVisualImportJob,
} from "@openround/contracts";

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
import {
  PagePreview,
  PresentationVisualImport,
  VisualPageReviewFields,
} from "./presentation-visual-import";
import { visualImportCopy } from "./visual-import-copy";

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
    locale: "en-CA" as SupportedLocale,
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
    markup: () => renderToStaticMarkup(tree),
    all: () => elements(tree),
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

describe("localized visual import preserves the import lifecycle", () => {
  it.each(supportedLocales)(
    "renders localized upload and authored reading controls in %s",
    (locale) => {
      const markup = renderToStaticMarkup(
        <VisualPageReviewFields
          locale={locale}
          pageNumber={2}
          review={{
            ...review,
            title: "Título original",
            alternativeText: "原文の説明",
            accessibleText: "Texte source <original>",
          }}
          disabled={false}
          onChange={() => undefined}
        />,
      );
      const copy = visualImportCopy(locale);
      expect(markup).toContain(`lang="${locale}"`);
      expect(markup).toContain(copy("Image description"));
      expect(markup).toContain(copy("Accessible text"));
      expect(markup).toContain('lang="" maxLength="160" value="Título original"');
      expect(markup).toContain('lang="" maxLength="300">原文の説明');
      expect(markup).toContain('lang="" rows="7" maxLength="3000">Texte source &lt;original&gt;');
    },
  );

  it("changes Korean review chrome to German without losing source names, order, authored review, or fidelity", async () => {
    const nextJob = {
      ...job,
      sourceName: "자료-original.pdf",
      pages: [page, { ...page, pageNumber: 2, extractedText: "Texte original non traduit" }],
      pageCount: 2,
      warnings: [
        "No text was extracted. Write a readable description before importing this page.",
        "Unknown source warning <raw>",
      ],
    };
    mocked.fetch.mockResolvedValue({ available: true, jobs: [nextJob], limits: {} });
    const view = harness();
    view.props.locale = "ko-KR";
    view.render();
    await view.settle();
    const choose = view.find(
      (node) => node.type === "button" && node.props["aria-pressed"] === false,
    );
    (choose.props.onClick as () => void)();
    await view.settle();
    (
      view.find((node) => node.props["aria-label"] === "2페이지 위로 이동").props
        .onClick as () => void
    )();
    await view.settle();
    const fields = view.find(
      (node) => node.type === VisualPageReviewFields && node.props.pageNumber === 2,
    );
    (fields.props.onChange as (value: typeof review) => void)({
      ...review,
      title: "Titel original",
      accessibleText: "Texte original non traduit",
    });
    await view.settle();
    const fidelity = view
      .all()
      .filter((node) => node.type === "input" && node.props.type === "checkbox")
      .at(-1)!;
    (fidelity.props.onChange as (event: { target: { checked: boolean } }) => void)({
      target: { checked: true },
    });
    await view.settle();
    const before = {
      requests: mocked.fetch.mock.calls.length,
      loads: mocked.load.mock.calls.length,
      saves: mocked.save.mock.calls.length,
    };
    view.props.locale = "de-DE";
    view.render();
    await view.settle();
    expect(mocked.fetch).toHaveBeenCalledTimes(before.requests);
    expect(mocked.load).toHaveBeenCalledTimes(before.loads);
    expect(mocked.save).toHaveBeenCalledTimes(before.saves);
    expect(
      view.find((node) => node.type === "div" && node.props.role === "dialog").props.lang,
    ).toBe("de-DE");
    expect(view.markup()).toContain('lang="">자료-original.pdf');
    expect(view.markup()).toContain("Reihenfolge ausgewählter Seiten: 2, 1.");
    expect(view.markup()).toContain('lang="en-CA">Unknown source warning &lt;raw&gt;');
    expect(view.markup()).toContain('lang="de-DE">Es wurde kein Text extrahiert.');
    expect(
      view.find((node) => node.type === VisualPageReviewFields && node.props.pageNumber === 2).props
        .review,
    ).toEqual({ ...review, title: "Titel original", accessibleText: "Texte original non traduit" });
    expect(
      view
        .all()
        .filter((node) => node.type === "input" && node.props.type === "checkbox")
        .at(-1)!.props.checked,
    ).toBe(true);
  });

  it.each([401, 403])(
    "retains an exact insertion and actor recovery identity after permission response %s and a locale switch",
    async (status) => {
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
      let attempt = 0;
      mocked.fetch.mockImplementation(async (_path: string, init?: RequestInit) => {
        if (init?.method !== "POST") return { available: true, jobs: [job], limits: {} };
        if (++attempt === 1)
          throw Object.assign(new Error("Your workspace role does not allow this action"), {
            status,
          });
        return { insertedBlockIds: ["visual", "reading"] };
      });
      const view = harness();
      view.props.locale = "ko-KR";
      view.render();
      await view.settle();
      (
        view.find(
          (node) => node.type === "button" && node.props.children === "동일한 삽입 다시 시도",
        ).props.onClick as () => void
      )();
      await view.settle();
      expect(view.markup()).toContain("워크스페이스 역할이 이 작업을 허용하지 않습니다");
      const before = mocked.fetch.mock.calls.length;
      view.props.locale = "de-DE";
      view.props.afterBlockId = randomUUID();
      view.props.prepareInsert.mockResolvedValue(99);
      view.render();
      await view.settle();
      expect(mocked.fetch).toHaveBeenCalledTimes(before);
      expect(mocked.load).toHaveBeenCalledOnce();
      expect(new Set(mocked.save.mock.calls.map(([key]) => key))).toEqual(
        new Set([`visual-import::workspace:${presentationId}`]),
      );
      expect(
        view.find((node) => node.type === "input" && node.props.type === "file").props.disabled,
      ).toBe(true);
      expect(view.markup()).toContain("Ihre Workspace-Rolle erlaubt diese Aktion nicht");
      (
        view.find(
          (node) =>
            node.type === "button" && node.props.children === "Dieselbe Einfügung erneut versuchen",
        ).props.onClick as () => void
      )();
      await view.settle();
      expect(
        mocked.fetch.mock.calls
          .filter(([, init]) => init?.method === "POST")
          .map(([path, init]) => ({ path, body: init.body })),
      ).toEqual(
        Array(2).fill({
          path: `/v1/presentations/${presentationId}/visual-imports/${jobId}/insert`,
          body,
        }),
      );
      expect(view.props.prepareInsert).not.toHaveBeenCalled();
      expect(view.props.onClose).toHaveBeenCalledOnce();
    },
  );

  it("relocalizes a failed local recovery without loading another identity or sending a request", async () => {
    mocked.load.mockRejectedValue(new Error("Storage unavailable"));
    const view = harness();
    view.props.locale = "ko-KR";
    view.render();
    await view.settle();
    expect(view.markup()).toContain("로컬 가져오기 수신 확인을 복구할 수 없습니다.");
    view.props.locale = "de-DE";
    view.render();
    await view.settle();
    expect(view.markup()).toContain(
      "Die lokale Importbestätigung konnte nicht wiederhergestellt werden.",
    );
    expect(mocked.load).toHaveBeenCalledOnce();
    expect(mocked.fetch).not.toHaveBeenCalled();
    expect(mocked.save).not.toHaveBeenCalled();
  });

  it("retains the selected raw upload through locale changes and retries byte-identical source bytes", async () => {
    const sourceFile = { name: "원문-original.png", type: "image/png", size: 1 };
    vi.stubGlobal(
      "FileReader",
      class {
        result = "data:image/png;base64,YQ==";
        onload = () => undefined;
        readAsDataURL(file: unknown) {
          expect(file).toBe(sourceFile);
          this.onload();
        }
      },
    );
    mocked.fetch.mockImplementation(async (_path: string, init?: RequestInit) => {
      if (init?.method === "POST") throw new Error("Unknown upload diagnostic <raw>");
      return {
        available: true,
        jobs: [],
        limits: {
          maxPdfBytes: 6000000,
          maxImageBytes: 10485760,
          maxImageSetBytes: 20000000,
          maxPages: 40,
        },
      };
    });
    const view = harness();
    view.props.locale = "ko-KR";
    view.render();
    await view.settle();
    (
      view.find((node) => node.type === "input" && node.props.type === "file").props
        .onChange as (event: { target: { files: unknown[]; value: string } }) => void
    )({ target: { files: [sourceFile], value: "original" } });
    view.props.locale = "de-DE";
    view.render();
    await view.settle();
    expect(view.markup()).toContain('lang="">원문-original.png');
    (
      view.find(
        (node) => node.type === "button" && node.props.children === "Zur Prüfung konvertieren",
      ).props.onClick as () => void
    )();
    await view.settle();
    expect(view.markup()).toContain('lang="en-CA">Unknown upload diagnostic &lt;raw&gt;');
    view.props.locale = "ko-KR";
    view.render();
    (
      view.find(
        (node) => node.type === "button" && node.props.children === "동일한 업로드 다시 시도",
      ).props.onClick as () => void
    )();
    await view.settle();
    const posts = mocked.fetch.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(2);
    expect(posts[1]![1].body).toBe(posts[0]![1].body);
    expect(JSON.parse(posts[0]![1].body)).toMatchObject({
      retainOriginal: false,
      files: [{ name: "원문-original.png", mimeType: "image/png", base64: "YQ==" }],
    });
    expect(mocked.load).toHaveBeenCalledOnce();
  });

  it("localizes private preview failures and retry without fetching again for locale alone", async () => {
    const hooks = { cursor: 0, slots: [] as unknown[], effects: [] as Array<() => void> };
    let locale: SupportedLocale = "ko-KR";
    let tree: ReactNode;
    function render() {
      hooks.cursor = 0;
      mocked.hooks = hooks;
      try {
        tree = PagePreview({ path: `/private/${jobId}`, page, locale });
      } finally {
        mocked.hooks = null;
      }
      for (const effect of hooks.effects.splice(0)) effect();
    }
    mocked.fetch.mockRejectedValueOnce(new Error("Permission denied"));
    render();
    await Promise.resolve();
    await Promise.resolve();
    render();
    expect(renderToStaticMarkup(tree)).toContain("미리보기를 사용할 수 없습니다.");
    const originalSignal = mocked.fetch.mock.calls[0]![1].signal;
    locale = "de-DE";
    render();
    expect(mocked.fetch).toHaveBeenCalledOnce();
    expect(originalSignal.aborted).toBe(false);
    expect(renderToStaticMarkup(tree)).toContain("Vorschau nicht verfügbar.");
    mocked.fetch.mockResolvedValueOnce({ downloadUrl: "https://private.example/signed-original" });
    const retry = elements(tree).find((node) => node.type === "button")!;
    (retry.props.onClick as () => void)();
    render();
    await Promise.resolve();
    await Promise.resolve();
    render();
    expect(mocked.fetch).toHaveBeenCalledTimes(2);
    expect(mocked.fetch.mock.calls[1]![0]).toBe(`/private/${jobId}/pages/1`);
    expect(originalSignal.aborted).toBe(true);
    expect(renderToStaticMarkup(tree)).toContain('src="https://private.example/signed-original"');
    expect(renderToStaticMarkup(tree)).toContain("Visuelle Konvertierungsvorschau von Seite 1.");
  });
});
