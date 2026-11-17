import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { workspacePageEnglishMessages } from "../../lib/i18n/domains/workspace-pages";
import type { GroupDetail, GroupSummary } from "./groups-model";
import GroupsPage from "./page";

type Effect = { deps?: ReactModule.DependencyList; cleanup?: () => void };
interface Hooks {
  cursor: number;
  slots: unknown[];
  effects: Array<() => void>;
}
const mock = vi.hoisted(() => ({
  hooks: null as Hooks | null,
  fetch: vi.fn(),
  organizationCreate: false,
}));
function same(left?: ReactModule.DependencyList, right?: ReactModule.DependencyList) {
  return Boolean(
    left &&
    right &&
    left.length === right.length &&
    left.every((value, index) => Object.is(value, right[index])),
  );
}
vi.mock("react", async (original) => ({
  ...(await original<typeof ReactModule>()),
  useRef: <T,>(value: T) => {
    const hooks = mock.hooks!;
    const index = hooks.cursor++;
    hooks.slots[index] ??= { current: value };
    return hooks.slots[index];
  },
  useState: <T,>(initial: T | (() => T)) => {
    const hooks = mock.hooks!;
    const index = hooks.cursor++;
    if (!(index in hooks.slots))
      hooks.slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
    return [
      hooks.slots[index],
      (value: T | ((current: T) => T)) => {
        hooks.slots[index] =
          typeof value === "function"
            ? (value as (current: T) => T)(hooks.slots[index] as T)
            : value;
      },
    ];
  },
  useMemo: <T,>(factory: () => T, deps: ReactModule.DependencyList) => {
    const hooks = mock.hooks!;
    const index = hooks.cursor++;
    const previous = hooks.slots[index] as
      { deps: ReactModule.DependencyList; value: T } | undefined;
    if (!previous || !same(previous.deps, deps)) hooks.slots[index] = { deps, value: factory() };
    return (hooks.slots[index] as { value: T }).value;
  },
  useCallback: <T,>(callback: T, deps: ReactModule.DependencyList) => {
    const hooks = mock.hooks!;
    const index = hooks.cursor++;
    const previous = hooks.slots[index] as
      { deps: ReactModule.DependencyList; value: T } | undefined;
    if (!previous || !same(previous.deps, deps)) hooks.slots[index] = { deps, value: callback };
    return (hooks.slots[index] as { value: T }).value;
  },
  useEffect: (effect: ReactModule.EffectCallback, deps?: ReactModule.DependencyList) => {
    const hooks = mock.hooks!;
    const index = hooks.cursor++;
    const previous = hooks.slots[index] as Effect | undefined;
    if (previous && same(previous.deps, deps)) return;
    const slot: Effect = { deps };
    hooks.slots[index] = slot;
    hooks.effects.push(() => {
      previous?.cleanup?.();
      slot.cleanup = effect() || undefined;
    });
  },
}));
vi.mock("../../components/locale-provider", () => ({
  useLocale: () => ({
    locale: "en-CA",
    t: (key: string, values: Record<string, string | number> = {}) =>
      Object.entries(values).reduce(
        (text, [name, value]) => text.replace(`{${name}}`, String(value)),
        (workspacePageEnglishMessages as Record<string, string>)[key] ?? key,
      ),
  }),
}));
const creator = { userId: "actor", workspaceId: "workspace", role: "owner" };
const features = { groups: true, presentations: false, ideaBoards: false };
vi.mock("../../components/workspace/workspace-provider", () => ({
  WorkspaceProvider: ({ children }: { children: ReactNode }) => children,
  useWorkspace: () => ({
    creator,
    canEdit: true,
    workspace: { name: "Local workspace" },
    productFeatures: features,
  }),
}));
vi.mock("../../lib/api", () => ({
  apiFetch: mock.fetch,
  AUTH_CHANGE_EVENT: "auth-change",
  humanError: (error: unknown) => (error instanceof Error ? error.message : "Failed"),
}));
vi.mock("../../components/workspace/workspace-shell", () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const memberCaps = {
  manageMembers: false,
  shareContent: false,
  postMessage: true,
  schedule: false,
  manageGroup: false,
};
function group(id: string, values: Partial<GroupSummary> = {}): GroupSummary {
  return {
    id,
    name: id,
    description: "",
    scope: "organization",
    organizationId: "organization",
    scopeName: "Company",
    role: "member",
    purpose: "team",
    status: "active",
    capabilities: memberCaps,
    memberCount: 1,
    artifactCount: 0,
    upcomingCount: 0,
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
    ...values,
  };
}
function detail(row: GroupSummary): GroupDetail {
  return {
    ...row,
    members: [
      {
        userId: "actor",
        email: "actor@example.com",
        role: row.role,
        workspaceRole: null,
        joinedAt: row.createdAt,
      },
    ],
    availableMembers: [],
    artifacts: [],
    messages: [],
    schedule: [],
    sharedLibrary: [],
  };
}
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return text(node.props.children);
  return typeof node === "string" || typeof node === "number" ? String(node) : "";
}
function mount() {
  const hooks: Hooks = { cursor: 0, slots: [], effects: [] };
  function render() {
    hooks.cursor = 0;
    mock.hooks = hooks;
    try {
      const context = GroupsPage().props.children as ReactElement;
      const content = (context.type as () => ReactElement)();
      return elements((content.type as () => ReactNode)());
    } finally {
      mock.hooks = null;
    }
  }
  function flush() {
    const effects = hooks.effects.splice(0);
    effects.forEach((effect) => effect());
  }
  async function settle() {
    for (let index = 0; index < 10; index++) {
      await Promise.resolve();
      render();
      flush();
    }
  }
  render();
  flush();
  return {
    render,
    settle,
    heading: () =>
      render()
        .filter((element) => element.type === "h2")
        .map((element) => text(element.props.children as ReactNode)),
    clickGroup(name: string) {
      const buttons = render().filter((element) => element.type === "button");
      const button = (buttons.find(
        (element) => text(element.props.children as ReactNode) === name,
      ) ?? buttons.find((element) => text(element.props.children as ReactNode).includes(name)))!;
      (button.props.onClick as () => void)();
      render();
      flush();
    },
    close() {
      for (const slot of hooks.slots) (slot as Effect | undefined)?.cleanup?.();
    },
  };
}
function seed(
  rows: GroupSummary[],
  load: (id: string) => Promise<{ group: GroupDetail }>,
  directory?: () => Promise<{
    members: Array<{ userId: string; email: string }>;
    hasMore: boolean;
  }>,
) {
  mock.fetch.mockImplementation((path: string) =>
    path === "/v1/groups"
      ? Promise.resolve({
          groups: rows,
          context: {
            organizationId: "organization",
            organizationName: "Company",
            canCreateWorkspaceGroup: false,
            canCreateOrganizationGroup: mock.organizationCreate,
          },
        })
      : path.includes("/available-members") && directory
        ? directory()
        : path.startsWith("/v1/groups/")
          ? load(path.split("/")[3]!)
          : path.startsWith("/v1/quizzes")
            ? Promise.resolve({ quizzes: [] })
            : Promise.reject(new Error(`Unexpected ${path}`)),
  );
}
beforeEach(() => {
  mock.fetch.mockReset();
  mock.organizationCreate = false;
  vi.stubGlobal("window", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    setTimeout,
    clearTimeout,
  });
});
afterEach(() => {
  mock.hooks = null;
  vi.unstubAllGlobals();
});

describe("group selection and authorization", () => {
  it.each([
    ["organization", false],
    ["organization", true],
    ["workspace", false],
    ["workspace", true],
  ] as const)(
    "leaves a %s group without requesting inaccessible detail (another group: %s)",
    async (scope, anotherGroup) => {
      Object.assign(window, { confirm: vi.fn(() => true) });
      const caps = { ...memberCaps, manageMembers: true, manageGroup: true };
      const leaving = group("Alpine", { scope, role: "owner", capabilities: caps, memberCount: 2 });
      const remaining = group("Birch");
      const rows = anotherGroup ? [leaving, remaining] : [leaving];
      let removed = false;
      const load = vi.fn(async (id: string) => {
        if (removed && id === leaving.id) throw new Error("Group not found");
        const record = detail(id === leaving.id ? leaving : remaining);
        if (id === leaving.id)
          record.members.push({
            userId: "successor",
            email: "successor@example.com",
            role: "owner",
            workspaceRole: null,
            joinedAt: leaving.createdAt,
          });
        return { group: record };
      });
      seed(rows, load);
      const request = mock.fetch.getMockImplementation()!;
      mock.fetch.mockImplementation((path: string, options?: { method?: string }) => {
        if (path === `/v1/groups/${leaving.id}/members/actor` && options?.method === "DELETE") {
          removed = true;
          rows.splice(0, 1);
          return Promise.resolve(undefined);
        }
        return request(path, options);
      });
      const page = mount();
      await page.settle();
      expect(page.heading()).toContain(leaving.name);
      page.clickGroup("Members");
      await page.settle();
      const remove = page
        .render()
        .find(
          (element) =>
            element.type === "button" &&
            text(element.props.children as ReactNode) === "Remove member",
        )!;
      (remove.props.onClick as () => void)();
      await page.settle();

      expect(removed).toBe(true);
      expect(load.mock.calls.filter(([id]) => id === leaving.id)).toHaveLength(1);
      expect(page.heading()).not.toContain(leaving.name);
      if (anotherGroup) expect(page.heading()).toContain(remaining.name);
      expect(page.render().some((element) => element.props.role === "alert")).toBe(false);
      expect(
        page
          .render()
          .some((element) => text(element.props.children as ReactNode).includes("Changes saved")),
      ).toBe(true);
      page.close();
    },
  );

  it("keeps an already-selected group open when its list button is clicked again", async () => {
    const row = group("Alpine");
    seed([row], async () => ({ group: detail(row) }));
    const page = mount();
    await page.settle();
    expect(page.heading()).toContain("Alpine");
    page.clickGroup("Alpine");
    await page.settle();
    expect(page.heading()).toContain("Alpine");
    page.close();
  });
  it("clears old detail immediately and never restores it when the new selection fails", async () => {
    const first = group("Alpine");
    const second = group("Birch");
    let reject!: (error: Error) => void;
    seed([first, second], (id) =>
      id === "Alpine"
        ? Promise.resolve({ group: detail(first) })
        : new Promise((_, fail) => {
            reject = fail;
          }),
    );
    const page = mount();
    await page.settle();
    expect(page.heading()).toContain("Alpine");
    page.clickGroup("Birch");
    expect(page.heading()).not.toContain("Alpine");
    reject(new Error("Group unavailable"));
    await page.settle();
    expect(page.heading()).not.toContain("Alpine");
    expect(page.render().some((element) => element.props.role === "alert")).toBe(true);
    page.close();
  });
  it("ignores a delayed detail response after selection has changed", async () => {
    const first = group("Alpine");
    const second = group("Birch");
    let finish!: (value: { group: GroupDetail }) => void;
    seed([first, second], (id) =>
      id === "Alpine"
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve({ group: detail(second) }),
    );
    const page = mount();
    await page.settle();
    page.clickGroup("Birch");
    await page.settle();
    finish({ group: detail(first) });
    await page.settle();
    expect(page.heading()).toContain("Birch");
    expect(page.heading()).not.toContain("Alpine");
    page.close();
  });
  it("does not infer organization management or original authoring from workspace ownership", async () => {
    const row = group("Alpine");
    seed([row], async () => ({ group: detail(row) }));
    const page = mount();
    await page.settle();
    const labels = page
      .render()
      .filter((element) => element.type === "button")
      .map((element) => text(element.props.children as ReactNode));
    expect(labels).not.toContain("Group settings");
    expect(labels).not.toContain("Archive group");
    expect(labels).not.toContain("Schedule");
    expect(labels).toContain("Discussion");
    page.close();
  });
  it("retries a failed organization directory lookup with cleared selection and fresh results", async () => {
    const row = group("Alpine", {
      role: "owner",
      capabilities: { ...memberCaps, manageMembers: true, manageGroup: true },
    });
    const directory = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Disconnected"))
      .mockResolvedValueOnce({
        members: [{ userId: "candidate", email: "teammate@example.com" }],
        hasMore: false,
      });
    seed([row], async () => ({ group: detail(row) }), directory);
    const page = mount();
    await page.settle();
    page.clickGroup("Members");
    await page.settle();
    await new Promise((resolve) => setTimeout(resolve, 280));
    await page.settle();
    expect(
      page
        .render()
        .some(
          (element) =>
            element.props.role === "alert" &&
            text(element.props.children as ReactNode).includes(
              "Organization members could not be loaded.",
            ),
        ),
    ).toBe(true);
    expect(
      page
        .render()
        .some((element) => element.type === "option" && element.props.value === "candidate"),
    ).toBe(false);
    page.clickGroup("Try again");
    await page.settle();
    expect(page.render().some((element) => element.props.role === "alert")).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 280));
    await page.settle();
    expect(directory).toHaveBeenCalledTimes(2);
    expect(
      page
        .render()
        .some((element) => element.type === "option" && element.props.value === "candidate"),
    ).toBe(true);
    const picker = page
      .render()
      .find(
        (element) =>
          element.type === "select" &&
          elements(element.props.children as ReactNode).some(
            (option) => option.props.value === "candidate",
          ),
      );
    expect(picker?.props.value).toBe("");
    page.close();
  });
});
