import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  PresentationAssignmentPreview,
  PresentationReadingAttempt,
} from "@openround/contracts";
import { ApiClientError } from "../../lib/api";
import type * as ReadingClient from "../../lib/presentation-assignments-client";
import { PresentationAssignmentPage } from "./assignment-page";

interface Hooks {
  cursor: number;
  slots: unknown[];
  dependencies: Map<number, readonly unknown[] | undefined>;
  effects: Array<{ index: number; effect: ReactModule.EffectCallback }>;
  cleanups: Map<number, void | (() => void)>;
}
const mocked = vi.hoisted(() => ({
  hooks: null as Hooks | null,
  preview: vi.fn(),
  access: vi.fn(),
  snapshot: vi.fn(),
  start: vi.fn(),
  progress: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof ReactModule>()),
  useRef: <T,>(initial: T) => {
    const hooks = mocked.hooks!,
      index = hooks.cursor++;
    hooks.slots[index] ??= { current: initial };
    return hooks.slots[index];
  },
  useState: <T,>(initial: T) => {
    const hooks = mocked.hooks!,
      index = hooks.cursor++;
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
    const hooks = mocked.hooks!,
      index = hooks.cursor++,
      previous = hooks.dependencies.get(index);
    if (
      !hooks.dependencies.has(index) ||
      !dependencies ||
      dependencies.some((value, dependency) => value !== previous?.[dependency])
    )
      hooks.effects.push({ index, effect });
    hooks.dependencies.set(index, dependencies);
  },
}));
vi.mock("../../lib/presentation-assignments-client", async (original) => ({
  ...(await original<typeof ReadingClient>()),
  fetchReadingPreview: mocked.preview,
  fetchReadingAccess: mocked.access,
  fetchReadingAttempt: mocked.snapshot,
  startReadingAttempt: mocked.start,
  recordReadingProgress: mocked.progress,
}));
const id = "aaaaaaaa-0000-4000-8000-000000000001",
  versionId = "aaaaaaaa-0000-4000-8000-000000000002",
  attemptId = "aaaaaaaa-0000-4000-8000-000000000003",
  blockId = "aaaaaaaa-0000-4000-8000-000000000004",
  secondId = "aaaaaaaa-0000-4000-8000-000000000005",
  token = "A".repeat(43),
  reader = { attemptId, token: "B".repeat(43) };
function preview(): PresentationAssignmentPreview {
  const now = new Date().toISOString(),
    expiresAt = new Date(Date.now() + 86_400_000).toISOString();
  return {
    assignment: { id, mode: "reading", versionId, createdAt: now, expiresAt, revokedAt: null },
    review: {
      schemaVersion: 1,
      versionId,
      version: 1,
      title: "Private reading",
      expiresAt,
      sections: [],
      blocks: [blockId, secondId].map((id, index) => ({
        id,
        kind: "question" as const,
        question: {
          type: "poll" as const,
          prompt: `Read question ${index + 1}`,
          mediaId: null,
          mediaAlt: null,
        },
      })),
    },
  };
}
function attempt(
  revision = 0,
  ids: string[] = [],
  idValue = attemptId,
): PresentationReadingAttempt {
  const now = new Date().toISOString();
  return {
    id: idValue,
    assignmentId: id,
    revision,
    readBlockIds: ids,
    currentBlockId: ids.at(-1) ?? null,
    startedAt: now,
    updatedAt: now,
    completedAt: null,
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
const mounted = new Set<{ close: () => void }>();
function mount() {
  const hooks: Hooks = {
    cursor: 0,
    slots: [],
    dependencies: new Map(),
    effects: [],
    cleanups: new Map(),
  };
  const page = {
    render() {
      hooks.cursor = 0;
      hooks.effects = [];
      mocked.hooks = hooks;
      let tree: ReactNode;
      try {
        tree = PresentationAssignmentPage({ assignmentId: id });
      } finally {
        mocked.hooks = null;
      }
      for (const { index, effect } of hooks.effects) {
        hooks.cleanups.get(index)?.();
        hooks.cleanups.set(index, effect());
      }
      return elements(tree);
    },
    text() {
      return page
        .render()
        .map((node) => text(node.props.children as ReactNode))
        .join(" ");
    },
    button(label: string) {
      const button = page
        .render()
        .find((node) => node.type === "button" && text(node.props.children as ReactNode) === label);
      if (!button) throw new Error(`Missing ${label}: ${page.text()}`);
      return button;
    },
    click(label: string) {
      const button = page.button(label);
      expect(button.props.disabled).not.toBe(true);
      (button.props.onClick as () => void)();
    },
    close() {
      for (const cleanup of hooks.cleanups.values()) cleanup?.();
      hooks.cleanups.clear();
      mounted.delete(page);
    },
  };
  mounted.add(page);
  page.render();
  return page;
}
function setup(personal = false) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-05T12:00:00.000Z"));
  const location = {
    origin: "https://example.test",
    href: `https://example.test/presentation-assignment/${id}#token=${token}${personal ? `&attempt=${attemptId.toUpperCase()}&resume=${reader.token}` : ""}`,
  };
  const history = {
    state: null,
    replaceState: vi.fn((_state: unknown, _unused: string, path: string) => {
      location.href = new URL(path, location.href).href;
    }),
  };
  const storage = {
    getItem: vi.fn(() => {
      throw new Error("No storage");
    }),
    setItem: vi.fn(() => {
      throw new Error("No storage");
    }),
    removeItem: vi.fn(() => {
      throw new Error("No storage");
    }),
  };
  const listeners = new Map<string, Set<() => void>>();
  vi.stubGlobal("sessionStorage", storage);
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("window", {
    location,
    history,
    sessionStorage: storage,
    localStorage: storage,
    setTimeout,
    addEventListener: (name: string, listener: () => void) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(listener);
    },
    removeEventListener: (name: string, listener: () => void) =>
      listeners.get(name)?.delete(listener),
  });
  mocked.preview.mockReset().mockResolvedValue(preview());
  mocked.access
    .mockReset()
    .mockResolvedValue({ versionId, expiresAt: preview().assignment.expiresAt });
  mocked.snapshot.mockReset().mockResolvedValue({ ...preview(), attempt: attempt(1, [blockId]) });
  mocked.start.mockReset().mockImplementation(async (_id, _token, request) => ({
    attempt: attempt(0, [], request.attemptId),
    replayed: false,
  }));
  mocked.progress.mockReset().mockImplementation(async (_id, privateReader, request) => ({
    attempt: attempt(request.expectedRevision + 1, [request.blockId], privateReader.attemptId),
    replayed: false,
  }));
  return {
    storage,
    location,
    history,
    dispatch(name: string) {
      for (const listener of [...(listeners.get(name) ?? [])]) listener();
    },
  };
}
async function settle(page: ReturnType<typeof mount>) {
  await vi.advanceTimersByTimeAsync(0);
  page.render();
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
afterEach(() => {
  for (const page of mounted) page.close();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("reading assignment recipient privacy and recovery", () => {
  it("previews without starting, never reads browser storage, and leaves a scrubbed reload without reader discovery", async () => {
    const environment = setup();
    const page = mount();
    await settle(page);
    expect(page.text()).toContain("Previewing does not start a reader");
    expect(mocked.start).not.toHaveBeenCalled();
    expect(mocked.snapshot).not.toHaveBeenCalled();
    expect(environment.location.href).not.toContain("#");
    page.click("Start reading");
    await settle(page);
    expect(page.text()).toContain("0 of 2 pages read");
    expect(page.text()).toContain("Keep your personal resume link");
    for (const operation of Object.values(environment.storage))
      expect(operation).not.toHaveBeenCalled();
    page.close();
    mocked.preview.mockClear();
    const reloaded = mount();
    await settle(reloaded);
    expect(reloaded.text()).toContain("This reading assignment is unavailable or has expired.");
    expect(mocked.preview).not.toHaveBeenCalled();
    expect(mocked.snapshot).not.toHaveBeenCalled();
  });
  it("requires explicit resume even with a complete personal URL, including uppercase reader ids", async () => {
    setup(true);
    const page = mount();
    await settle(page);
    expect(mocked.snapshot).not.toHaveBeenCalled();
    expect(page.text()).not.toContain("1 of 2 pages read");
    page.click("Resume reading");
    await settle(page);
    expect(mocked.snapshot).toHaveBeenCalledWith(id, reader, expect.any(AbortSignal));
    expect(page.text()).toContain("1 of 2 pages read");
    page.click("Next page");
    await settle(page);
    page.click("Mark page as read");
    await settle(page);
    expect(mocked.progress).toHaveBeenCalledWith(
      id,
      reader,
      expect.objectContaining({ expectedRevision: 1, blockId: secondId }),
      expect.any(AbortSignal),
    );
    expect(
      page
        .render()
        .some(
          (node) =>
            node.type === "button" &&
            text(node.props.children as ReactNode) === "Retry saving progress",
        ),
    ).toBe(false);
  });
  it("refreshes current progress instead of rendering the original empty start receipt on replay", async () => {
    setup();
    mocked.start.mockImplementation(async (_id, _token, request) => ({
      attempt: attempt(0, [], request.attemptId),
      replayed: true,
    }));
    mocked.snapshot.mockImplementation(async (_id, privateReader) => ({
      ...preview(),
      attempt: attempt(2, [blockId, secondId], privateReader.attemptId),
    }));
    const page = mount();
    await settle(page);
    page.click("Start reading");
    await settle(page);
    expect(mocked.snapshot).toHaveBeenCalledTimes(1);
    expect(page.text()).toContain("2 of 2 pages read");
    expect(page.button("Finish reading").props.disabled).toBe(false);
  });
  it("does not reveal a late accepted start or mutation after clearing the reader", async () => {
    setup();
    const start = deferred<{ attempt: PresentationReadingAttempt; replayed: boolean }>();
    mocked.start.mockReturnValue(start.promise);
    const page = mount();
    await settle(page);
    page.click("Start reading");
    page.click("Clear reader");
    const input = mocked.start.mock.calls[0]![2];
    start.resolve({ attempt: attempt(0, [], input.attemptId), replayed: false });
    await settle(page);
    expect(page.text()).not.toContain("0 of 2 pages read");
    expect(page.text()).not.toContain("Your private resume link");
    mocked.start.mockImplementation(async (_id, _token, request) => ({
      attempt: attempt(0, [], request.attemptId),
      replayed: false,
    }));
    page.click("Start reading");
    await settle(page);
    const progress = deferred<{ attempt: PresentationReadingAttempt; replayed: boolean }>();
    mocked.progress.mockReturnValue(progress.promise);
    page.click("Mark page as read");
    const privateReader = mocked.progress.mock.calls[0]![1];
    page.click("Clear reader");
    progress.resolve({ attempt: attempt(1, [blockId], privateReader.attemptId), replayed: false });
    await settle(page);
    expect(page.text()).not.toContain("1 of 2 pages read");
    expect(page.text()).not.toContain("Your private resume link");
  });
  it("serializes ambiguous progress and retries the exact command without generating another acknowledgement", async () => {
    setup();
    mocked.progress.mockRejectedValueOnce(new TypeError("Lost acknowledgement"));
    const page = mount();
    await settle(page);
    page.click("Start reading");
    await settle(page);
    page.click("Mark page as read");
    await settle(page);
    const first = mocked.progress.mock.calls[0]![2];
    expect(page.button("Next page").props.disabled).toBe(true);
    page.click("Retry saving progress");
    await settle(page);
    expect(mocked.progress.mock.calls[1]![2]).toBe(first);
    expect(page.text()).toContain("1 of 2 pages read");
    expect(page.button("Page marked read").props.disabled).toBe(true);
  });
  it("refreshes a stale replay without rolling back a newer local revision", async () => {
    setup(true);
    const page = mount();
    await settle(page);
    page.click("Resume reading");
    await settle(page);
    page.click("Next page");
    await settle(page);
    mocked.progress.mockResolvedValue({ attempt: attempt(0), replayed: true });
    mocked.snapshot.mockResolvedValue({ ...preview(), attempt: attempt(2, [blockId, secondId]) });
    page.click("Mark page as read");
    await settle(page);
    expect(page.text()).toContain("2 of 2 pages read");
    expect(page.button("Finish reading").props.disabled).toBe(false);
  });
  it("refreshes a rejected conflicting command before allowing a new explicit action", async () => {
    setup(true);
    const page = mount();
    await settle(page);
    page.click("Resume reading");
    await settle(page);
    page.click("Next page");
    await settle(page);
    mocked.progress.mockRejectedValue(
      new ApiClientError("Conflict", "PRESENTATION_ASSIGNMENT_REVISION_CONFLICT", 409),
    );
    mocked.snapshot.mockResolvedValue({ ...preview(), attempt: attempt(2, [blockId, secondId]) });
    page.click("Mark page as read");
    await settle(page);
    expect(page.text()).toContain("Your reading progress changed");
    expect(page.button("Finish reading").props.disabled).toBe(false);
  });
  it("rechecks navigation access and clears content, private links and progress after revocation or deadline", async () => {
    const environment = setup(true);
    const page = mount();
    await settle(page);
    page.click("Resume reading");
    await settle(page);
    mocked.access.mockRejectedValue(
      new ApiClientError("Gone", "PRESENTATION_ASSIGNMENT_UNAVAILABLE", 404),
    );
    page.click("Next page");
    await settle(page);
    expect(page.text()).toContain("This reading assignment is unavailable or has expired.");
    expect(page.text()).not.toContain("Your private resume link");
    environment.location.href = `https://example.test/presentation-assignment/${id}#token=${token}`;
    environment.dispatch("hashchange");
    await settle(page);
    await vi.advanceTimersByTimeAsync(86_400_000);
    page.render();
    expect(page.text()).toContain("This reading assignment is unavailable or has expired.");
  });
});
