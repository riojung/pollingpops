import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ApiModule from "../../../lib/api";

interface Hooks {
  cursor: number;
  slots: unknown[];
  effects: Array<() => void>;
}
const fixtures = vi.hoisted(() => ({
  hooks: null as Hooks | null,
  tree: null as ReactNode,
  apiFetch: vi.fn(),
  push: vi.fn(),
  id: "room-a",
}));
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof ReactModule>();
  return {
    ...react,
    useEffect: (effect: ReactModule.EffectCallback, deps?: ReactModule.DependencyList) => {
      const hooks = fixtures.hooks;
      if (!hooks) return react.useEffect(effect, deps);
      const index = hooks.cursor++;
      const previous = hooks.slots[index] as
        { deps?: ReactModule.DependencyList; cleanup?: () => void } | undefined;
      if (
        previous &&
        deps &&
        previous.deps &&
        deps.length === previous.deps.length &&
        deps.every((value, i) => Object.is(value, previous.deps![i]))
      )
        return;
      const slot: { deps?: ReactModule.DependencyList; cleanup?: () => void } = { deps };
      hooks.slots[index] = slot;
      hooks.effects.push(() => {
        previous?.cleanup?.();
        slot.cleanup = effect() || undefined;
      });
    },
    useState: <T,>(initial: T | (() => T)) => {
      const hooks = fixtures.hooks;
      if (!hooks) return react.useState(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.slots))
        hooks.slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
      return [
        hooks.slots[index] as T,
        (next: T | ((value: T) => T)) => {
          hooks.slots[index] =
            typeof next === "function" ? (next as (value: T) => T)(hooks.slots[index] as T) : next;
        },
      ];
    },
    useRef: <T,>(initial: T) => {
      const hooks = fixtures.hooks;
      if (!hooks) return react.useRef(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
      return hooks.slots[index];
    },
  };
});
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: fixtures.id }),
  useRouter: () => ({ push: fixtures.push }),
}));
vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  apiFetch: fixtures.apiFetch,
}));
vi.mock("../../../components/locale-provider", async () => {
  const { loadMessages, translate } = await import("../../../lib/i18n/catalog");
  const messages = await loadMessages("en-CA", ["live-delivery", "delivery-authoring"]);
  return {
    useLocale: () => ({
      locale: "en-CA",
      t: (key: Parameters<typeof translate>[1]) => translate(messages, key),
    }),
  };
});

import SurveyPlayer from "./page";
import { RoomPasswordInput } from "../../../components/room-password";
import { ApiClientError } from "../../../lib/api";

function find(
  node: ReactNode,
  predicate: (element: ReactElement<Record<string, unknown>>) => boolean,
): ReactElement<Record<string, unknown>> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const result = find(child, predicate);
      if (result) return result;
    }
  }
  if (!isValidElement<Record<string, unknown>>(node)) return null;
  return predicate(node) ? node : find(node.props.children as ReactNode, predicate);
}
function harness() {
  const hooks: Hooks = { cursor: 0, slots: [], effects: [] };
  const render = () => {
    hooks.cursor = 0;
    hooks.effects = [];
    fixtures.hooks = hooks;
    try {
      fixtures.tree = SurveyPlayer();
    } finally {
      fixtures.hooks = null;
    }
    return renderToStaticMarkup(fixtures.tree);
  };
  const flush = () => {
    const effects = hooks.effects;
    hooks.effects = [];
    effects.forEach((effect) => effect());
  };
  const settle = async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
    render();
    flush();
    for (let i = 0; i < 12; i++) await Promise.resolve();
    return render();
  };
  const submit = async () => {
    const form = find(fixtures.tree, (node) => node.type === "form")!;
    (form.props.onSubmit as (event: { preventDefault(): void }) => void)({ preventDefault() {} });
    return settle();
  };
  const changePassword = (value: string) => {
    const field = find(fixtures.tree, (node) => node.type === RoomPasswordInput)!;
    (field.props.onChange as (value: string) => void)(value);
    render();
  };
  render();
  flush();
  return { render, flush, settle, submit, changePassword };
}
const storage = new Map<string, string>();
const writes: string[] = [];
function attempt(roomId = "room-a") {
  return {
    roomId,
    content: { title: `Survey ${roomId}`, description: "", items: [] },
    responses: {},
    revision: 0,
    closed: false,
    closesAt: "2099-12-31T00:00:00Z",
    finalized: false,
    receipt: null,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  storage.clear();
  writes.length = 0;
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
        writes.push(value);
      },
    },
    setInterval: () => 1,
    clearInterval() {},
    addEventListener() {},
    removeEventListener() {},
  });
  fixtures.id = "room-a";
  fixtures.hooks = null;
  fixtures.tree = null;
  fixtures.apiFetch.mockReset();
  fixtures.apiFetch.mockImplementation(async (path: string) =>
    path.endsWith("/public") ? { room: { passwordRequired: true } } : { attempt: attempt() },
  );
});

describe("direct Survey password admission", () => {
  it("prompts before admitting a fresh guest and keeps failed passwords on the form", async () => {
    const ui = harness();
    expect(await ui.settle()).toContain("Room password</label>");
    expect(fixtures.apiFetch.mock.calls.map(([path]) => path)).toEqual([
      "/v1/survey-rooms/room-a/public",
    ]);
    expect(writes).toEqual([]);
    ui.changePassword("wrong password");
    fixtures.apiFetch.mockRejectedValueOnce(
      new ApiClientError("raw server text", "INVALID_PASSWORD", 403),
    );
    const markup = await ui.submit();
    expect(markup).toContain("That password is incorrect. Check with your host and try again.");
    expect(markup).not.toContain("Survey room-a");
    ui.changePassword("  exact password  ");
    expect(await ui.submit()).toContain("Survey room-a");
    const [, init] = fixtures.apiFetch.mock.calls.at(-1)!;
    expect(JSON.parse(init.body)).toEqual({ password: "  exact password  " });
    expect(init.headers.authorization).toBe(`Bearer ${storage.get("pollingpops:survey:room-a")}`);
    expect(writes).not.toContain("wrong password");
    expect(writes).not.toContain("  exact password  ");
  });

  it("resumes admitted bearer credentials without a password or another admission", async () => {
    storage.set("pollingpops:survey:room-a", "existing-room-credential");
    const ui = harness();
    const markup = await ui.settle();
    expect(markup).toContain("Survey room-a");
    expect(markup).not.toContain('type="password"');
    expect(fixtures.apiFetch.mock.calls.map(([path]) => path)).toEqual([
      "/v1/survey-rooms/room-a/attempt",
    ]);
    expect(fixtures.apiFetch.mock.calls[0]![1].headers.authorization).toBe(
      "Bearer existing-room-credential",
    );
    expect(writes).toEqual([]);
  });

  it("reuses an interrupted admission credential and admits open rooms with no password", async () => {
    storage.set("pollingpops:survey:room-a", "interrupted-room-credential");
    fixtures.apiFetch.mockImplementation(async (path: string) => {
      if (path.endsWith("/attempt")) throw new ApiClientError("not admitted", "UNAUTHORIZED", 401);
      return path.endsWith("/public")
        ? { room: { passwordRequired: false } }
        : { attempt: attempt() };
    });
    const ui = harness();
    expect(await ui.settle()).toContain("Survey room-a");
    const [, init] = fixtures.apiFetch.mock.calls.at(-1)!;
    expect(JSON.parse(init.body)).toEqual({});
    expect(init.headers.authorization).toBe("Bearer interrupted-room-credential");
  });

  it.each(["success", "failure"])(
    "ignores stale admission %s after changing rooms",
    async (outcome) => {
      const pending = deferred<{ attempt: ReturnType<typeof attempt> }>();
      fixtures.apiFetch.mockImplementation(async (path: string) => {
        if (path === "/v1/survey-rooms/room-a/join") return pending.promise;
        if (path.endsWith("/public"))
          return { room: { passwordRequired: !path.includes("room-b") } };
        return { attempt: attempt("room-b") };
      });
      const ui = harness();
      await ui.settle();
      ui.changePassword("room-a secret");
      await ui.submit();
      fixtures.id = "room-b";
      ui.render();
      ui.flush();
      expect(await ui.settle()).toContain("Survey room-b");
      const [, request] = fixtures.apiFetch.mock.calls.find(
        ([path]) => path === "/v1/survey-rooms/room-b/join",
      )!;
      expect(JSON.parse(request.body)).toEqual({});
      if (outcome === "success") pending.resolve({ attempt: attempt("room-a") });
      else pending.reject(new ApiClientError("incorrect", "INVALID_PASSWORD", 403));
      const markup = await ui.settle();
      expect(markup).toContain("Survey room-b");
      expect(markup).not.toContain("Survey room-a");
      expect(markup).not.toContain("That password is incorrect");
      expect(markup).not.toContain('type="password"');
    },
  );
});
