import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import type * as ApiModule from "../../lib/api";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "../../lib/api";
import { boardFixture } from "../../test-utils/idea-board";
import english from "../../lib/i18n/domains/idea-boards/en-CA";
import { canvasTemplateMessages } from "../../lib/i18n/canvas-template-messages";
import {
  clearCanvasCreationSetups,
  readCanvasCreationSetup,
  saveCanvasCreationSetup,
} from "../../lib/canvas-creation-storage";
import { workshopTemplateIntent } from "./canvas-template-creation";
import { CanvasTemplateChooser } from "./canvas-template-chooser";
import { BoardLibrary } from "./board-library";

interface EffectSlot {
  dependencies?: readonly unknown[];
  cleanup?: () => void;
}
interface Hooks {
  cursor: number;
  slots: unknown[];
  effects: Array<() => void>;
}
const mocked = vi.hoisted(() => ({
  hooks: null as Hooks | null,
  fetch: vi.fn(),
  push: vi.fn(),
  creator: {
    userId: "00000000-0000-4000-8000-000000000001",
    workspaceId: "00000000-0000-4000-8000-000000000002",
  },
  features: { canvasBoards: true, ideaBoards: true },
}));
vi.mock("../../lib/api", async (original) => ({
  ...(await original<typeof ApiModule>()),
  apiFetch: mocked.fetch,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocked.push }) }));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("../locale-provider", () => ({
  useLocale: () => ({ locale: "en-CA", t: (key: keyof typeof english) => english[key] ?? key }),
}));
vi.mock("../workspace/workspace-provider", () => ({
  useWorkspace: () => ({
    creator: mocked.creator,
    canEdit: true,
    productFeatures: mocked.features,
  }),
}));
vi.mock("../workspace/workspace-shell", () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock("./use-board-library", () => ({
  useBoardLibrary: () => ({
    data: { boards: [], canvases: [], nextCursor: null, canvasNextCursor: null },
    busy: false,
    error: false,
  }),
}));
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useState: <T,>(initial: T | (() => T)) => {
      const hooks = mocked.hooks;
      if (!hooks) return react.useState(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.slots))
        hooks.slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
      return [
        hooks.slots[index],
        (value: T | ((old: T) => T)) => {
          hooks.slots[index] =
            typeof value === "function" ? (value as (old: T) => T)(hooks.slots[index] as T) : value;
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
    useEffect: (effect: ReactModule.EffectCallback, dependencies?: readonly unknown[]) => {
      const hooks = mocked.hooks;
      if (!hooks) return react.useEffect(effect, dependencies);
      const index = hooks.cursor++;
      const previous = hooks.slots[index] as EffectSlot | undefined;
      if (
        !previous ||
        !dependencies ||
        !previous.dependencies ||
        dependencies.some((value, position) => !Object.is(value, previous.dependencies![position]))
      )
        hooks.effects.push(() => {
          previous?.cleanup?.();
          const cleanup = effect();
          hooks.slots[index] = { dependencies, ...(cleanup ? { cleanup } : {}) };
        });
    },
  };
});
const entries = new Map<string, string>();
const storage = {
  get length() {
    return entries.size;
  },
  key: (index: number) => [...entries.keys()][index] ?? null,
  getItem: (key: string) => entries.get(key) ?? null,
  setItem: (key: string, value: string) => {
    entries.set(key, value);
  },
  removeItem: (key: string) => {
    entries.delete(key);
  },
};
const copy = canvasTemplateMessages("en-CA");
function harness() {
  const hooks: Hooks = { cursor: 0, slots: [], effects: [] };
  let tree: ReactNode;
  function render() {
    hooks.cursor = 0;
    hooks.effects = [];
    mocked.hooks = hooks;
    try {
      tree = BoardLibrary();
    } finally {
      mocked.hooks = null;
    }
    const html = renderToStaticMarkup(tree);
    hooks.effects.forEach((effect) => effect());
    return html;
  }
  function find(predicate: (element: ReactElement<Record<string, unknown>>) => boolean) {
    function visit(node: ReactNode): ReactElement<Record<string, unknown>> | undefined {
      if (Array.isArray(node)) {
        for (const child of node) {
          const result = visit(child);
          if (result) return result;
        }
        return;
      }
      if (!isValidElement<Record<string, unknown>>(node)) return;
      return predicate(node) ? node : visit(node.props.children as ReactNode);
    }
    const found = visit(tree);
    if (!found) throw new Error("Missing control");
    return found;
  }
  return {
    render,
    find,
    click(label: string) {
      (
        find((element) => element.type === "button" && element.props.children === label).props
          .onClick as () => void
      )();
    },
    selectStarter() {
      (
        find((element) => element.type === CanvasTemplateChooser).props.onChange as (
          id: string,
        ) => void
      )("project-kickoff");
    },
    submit() {
      (find((element) => element.type === "form").props.onSubmit as (event: unknown) => void)({
        preventDefault() {},
      });
    },
    unmount() {
      for (const slot of hooks.slots) (slot as EffectSlot | undefined)?.cleanup?.();
    },
  };
}
async function settle() {
  for (let index = 0; index < 30; index++) await Promise.resolve();
}
beforeEach(() => {
  vi.resetAllMocks();
  entries.clear();
  mocked.creator = {
    userId: "00000000-0000-4000-8000-000000000001",
    workspaceId: "00000000-0000-4000-8000-000000000002",
  };
  mocked.features = { canvasBoards: true, ideaBoards: true };
  vi.stubGlobal("window", { sessionStorage: storage });
  vi.stubGlobal("document", { activeElement: null });
  vi.stubGlobal("HTMLElement", class {});
});
afterEach(() => {
  mocked.hooks = null;
  vi.unstubAllGlobals();
});

describe("board library starter creation", () => {
  it("creates a team starter in one current request with an editable title", async () => {
    mocked.fetch.mockRejectedValueOnce(new ApiClientError("Paused", "NOT_FOUND", 404));
    const view = harness();
    view.render();
    view.render();
    view.click("New board");
    view.render();
    view.selectStarter();
    view.render();
    const input = view.find(
      (element) => element.type === "input" && element.props.value === "Project kickoff",
    );
    (input.props.onChange as (event: unknown) => void)({ target: { value: "My kickoff" } });
    view.render();
    view.submit();
    await settle();
    expect(mocked.fetch).toHaveBeenCalledTimes(1);
    expect(mocked.fetch.mock.calls[0]![0]).toBe("/v1/canvas-boards");
    expect(JSON.parse(mocked.fetch.mock.calls[0]![1].body)).toMatchObject({
      schemaVersion: 3,
      title: "My kickoff",
      templateId: "project-kickoff",
      boardType: "team",
    });
    expect(entries.size).toBe(0);
    view.unmount();
  });
  it("resumes a stored source checkpoint even while new-creation policy is paused", async () => {
    const setup = workshopTemplateIntent(
      mocked.creator.userId,
      mocked.creator.workspaceId,
      {
        schemaVersion: 1,
        title: "Existing workshop",
        description: "Edited prompt",
        identityMode: "alias",
        moderationEnabled: false,
        ideasVisible: true,
        voteBudget: 6,
        windowDays: 3,
      },
      "project-kickoff",
    );
    setup.sourceBoardId = boardFixture.id;
    saveCanvasCreationSetup(mocked.creator.userId, mocked.creator.workspaceId, setup);
    mocked.features = { canvasBoards: false, ideaBoards: false };
    mocked.fetch.mockRejectedValueOnce(new ApiClientError("Paused", "NOT_FOUND", 404));
    const view = harness();
    view.render();
    const html = view.render();
    expect(html).toContain(copy.sourceCreated);
    expect(html).toContain(`/boards/${boardFixture.id}`);
    expect(html).toContain('value="Existing workshop"');
    expect(html).toContain("Edited prompt");
    view.submit();
    await settle();
    expect(mocked.fetch).toHaveBeenCalledTimes(1);
    expect(mocked.fetch.mock.calls[0]![0]).toBe("/v1/canvas-boards");
    expect(JSON.parse(mocked.fetch.mock.calls[0]![1].body).operationId).toBe(
      setup.canvasOperationId,
    );
    expect(readCanvasCreationSetup(mocked.creator.userId, mocked.creator.workspaceId)).toEqual(
      setup,
    );
    expect(view.render()).toContain(copy.keepSource);
    view.click(copy.keepSource);
    expect(mocked.push).toHaveBeenCalledWith(`/boards/${boardFixture.id}`);
    expect(entries.size).toBe(0);
    expect(mocked.fetch).toHaveBeenCalledTimes(1);
    view.unmount();
  });
  it("leaves blank guided creation usable when tab storage is unavailable", async () => {
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error("Blocked");
        },
      },
    });
    const view = harness();
    view.render();
    view.render();
    view.click("New board");
    view.render();
    view.click("Guided workshop");
    view.render();
    view.selectStarter();
    view.render();
    view.submit();
    await settle();
    expect(mocked.fetch).not.toHaveBeenCalled();
    expect(view.render()).toContain(copy.storageError);
    (
      view.find((element) => element.type === CanvasTemplateChooser).props.onChange as (
        id: null,
      ) => void
    )(null);
    view.render();
    const title = view.find(
      (element) =>
        element.type === "input" &&
        element.props.maxLength === 160 &&
        element.props.type !== "search",
    );
    (title.props.onChange as (event: unknown) => void)({
      target: { value: "Blank guided workshop" },
    });
    mocked.fetch.mockResolvedValueOnce({ board: boardFixture });
    view.render();
    view.submit();
    await settle();
    expect(mocked.fetch.mock.calls.map(([path]) => path)).toEqual(["/v1/idea-boards"]);
    expect(mocked.push).toHaveBeenCalledWith(`/boards/${boardFixture.id}`);
    view.unmount();
  });
  it("checkpoints a newly created workshop and resumes only its canvas after a reload", async () => {
    mocked.fetch
      .mockResolvedValueOnce({ board: boardFixture })
      .mockRejectedValueOnce(new TypeError("Canvas response lost"));
    const view = harness();
    view.render();
    view.render();
    view.click("New board");
    view.render();
    view.click("Guided workshop");
    view.render();
    view.selectStarter();
    view.render();
    view.submit();
    await settle();
    const saved = readCanvasCreationSetup(mocked.creator.userId, mocked.creator.workspaceId) as {
      sourceBoardId: string;
      canvasOperationId: string;
    };
    expect(saved.sourceBoardId).toBe(boardFixture.id);
    expect(view.render()).toContain(copy.sourceCreated);
    view.unmount();
    mocked.fetch.mockRejectedValueOnce(new ApiClientError("Paused", "NOT_FOUND", 404));
    const resumed = harness();
    resumed.render();
    resumed.render();
    resumed.submit();
    await settle();
    expect(mocked.fetch.mock.calls.map(([path]) => path)).toEqual([
      "/v1/idea-boards",
      "/v1/canvas-boards",
      "/v1/canvas-boards",
    ]);
    expect(mocked.fetch.mock.calls[1]![1].body).toBe(mocked.fetch.mock.calls[2]![1].body);
    expect(JSON.parse(mocked.fetch.mock.calls[2]![1].body).operationId).toBe(
      saved.canvasOperationId,
    );
    resumed.unmount();
  });
  it("does not repopulate setup or attach a canvas from a late response after logout cleanup", async () => {
    let resolve!: (value: unknown) => void;
    mocked.fetch.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const view = harness();
    view.render();
    view.render();
    view.click("New board");
    view.render();
    view.click("Guided workshop");
    view.render();
    view.selectStarter();
    view.render();
    view.submit();
    await settle();
    expect(entries.size).toBe(1);
    clearCanvasCreationSetups(mocked.creator.userId);
    resolve({ board: boardFixture });
    await settle();
    expect(mocked.fetch).toHaveBeenCalledTimes(1);
    expect(entries.size).toBe(0);
    expect(mocked.push).not.toHaveBeenCalled();
    view.unmount();
  });
  it("retains the exact setup and explains how to recover from a stale authenticated context", async () => {
    mocked.fetch.mockRejectedValueOnce(
      new ApiClientError("Context changed", "SETUP_CONTEXT_CHANGED", 409),
    );
    const view = harness();
    view.render();
    view.render();
    view.click("New board");
    view.render();
    view.click("Guided workshop");
    view.render();
    view.selectStarter();
    view.render();
    view.submit();
    await settle();
    expect(view.render()).toContain(copy.contextError);
    const firstBody = mocked.fetch.mock.calls[0]![1].body;
    const saved = readCanvasCreationSetup(mocked.creator.userId, mocked.creator.workspaceId);
    expect(saved).toBeTruthy();
    mocked.fetch.mockRejectedValueOnce(
      new ApiClientError("Context changed", "SETUP_CONTEXT_CHANGED", 409),
    );
    view.submit();
    await settle();
    expect(mocked.fetch.mock.calls[1]![1].body).toBe(firstBody);
    expect(readCanvasCreationSetup(mocked.creator.userId, mocked.creator.workspaceId)).toEqual(
      saved,
    );
    expect(mocked.push).not.toHaveBeenCalled();
    view.unmount();
  });
  it("clears the previous form immediately when the identity changes and does not resume another user's setup", () => {
    const setup = workshopTemplateIntent(
      mocked.creator.userId,
      mocked.creator.workspaceId,
      {
        schemaVersion: 1,
        title: "Private setup title",
        description: "Private setup prompt",
        identityMode: "anonymous",
        moderationEnabled: true,
        ideasVisible: false,
        voteBudget: 3,
        windowDays: 7,
      },
      "project-kickoff",
    );
    saveCanvasCreationSetup(mocked.creator.userId, mocked.creator.workspaceId, setup);
    const view = harness();
    view.render();
    expect(view.render()).toContain("Private setup title");
    mocked.creator = { ...mocked.creator, userId: "00000000-0000-4000-8000-000000000099" };
    expect(view.render()).not.toContain("Private setup title");
    expect(view.render()).not.toContain("Private setup prompt");
    expect(mocked.fetch).not.toHaveBeenCalled();
    view.unmount();
  });
});
