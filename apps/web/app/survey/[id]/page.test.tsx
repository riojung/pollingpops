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
import { SurveyPagedReader } from "../../../components/survey-paged-reader";
import { ApiClientError } from "../../../lib/api";
import {
  branchingId,
  surveyBranchingFixture,
} from "../../../../../packages/contracts/test/support/survey-branching-fixture";

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
  return {
    render,
    flush,
    settle,
    submit,
    changePassword,
    pages: () =>
      find(fixtures.tree, (node) => node.type === SurveyPagedReader)!
        .props as unknown as ReactModule.ComponentProps<typeof SurveyPagedReader>,
  };
}
const storage = new Map<string, string>();
const writes: string[] = [];
function attempt(roomId = "room-a") {
  return {
    roomId,
    content: {
      schemaVersion: 2,
      title: `Survey ${roomId}`,
      description: "",
      items: [
        {
          required: true,
          question: {
            id: "00000000-0000-4000-8000-000000000001",
            type: "rating",
            prompt: "How useful?",
            purpose: "opinion",
            confidence: "off",
            delivery: "main",
            min: 1,
            max: 5,
            minLabel: "Low",
            maxLabel: "High",
            timeLimitSeconds: 30,
            basePoints: 0,
            explanation: "",
            mediaId: null,
            mediaAlt: null,
          },
        },
      ],
    },
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

function pagedAttempt(roomId = "room-a") {
  const source = attempt(roomId);
  const first = source.content.items[0]!;
  const second = {
    required: true,
    question: {
      ...first.question,
      id: "00000000-0000-4000-8000-000000000002",
      prompt: "Second page question",
    },
  };
  return {
    ...source,
    content: {
      ...source.content,
      schemaVersion: 3,
      items: [first, second],
      pages: [first, second].map((item, index) => ({
        id: `00000000-0000-4000-8000-00000000001${index}`,
        title: `Page title ${index + 1}`,
        description: "",
        questionIds: [item.question.id],
      })),
    },
  };
}
describe("ordered Survey route", () => {
  it("uses visible conditional pages for Enter, cleans the save map, and submits from the visible last page", async () => {
    const source = { ...attempt(), content: surveyBranchingFixture() };
    storage.set("pollingpops:survey:room-a", "room-credential");
    let revision = 0;
    fixtures.apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (init?.method !== "POST") return { attempt: source };
      const body = JSON.parse(init.body as string);
      return {
        attempt: {
          ...source,
          responses: body.responses,
          revision: ++revision,
          finalized: path.endsWith("/submit"),
          receipt: path.endsWith("/submit") ? "receipt" : null,
        },
      };
    });
    const ui = harness();
    expect(await ui.settle()).toContain("Page 1 of 2");
    ui.pages().onChange!(branchingId(1), { kind: "poll", choiceIds: [branchingId(102)] });
    ui.render();
    expect(await ui.submit()).toContain("Page 2 of 2");
    expect(ui.pages().responses).toEqual({
      [branchingId(1)]: { kind: "poll", choiceIds: [branchingId(102)] },
    });
    expect(await ui.submit()).toContain("Your responses were submitted.");
    const posted = fixtures.apiFetch.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posted.map(([path]) => path)).toEqual([
      "/v1/survey-rooms/room-a/draft",
      "/v1/survey-rooms/room-a/submit",
    ]);
    expect(JSON.parse(posted[1]![1].body)).toMatchObject({
      expectedRevision: 1,
      responses: { [branchingId(1)]: { kind: "poll", choiceIds: [branchingId(102)] } },
    });
    expect(writes).toEqual([]);
  });

  it("keeps a closed finalized conditional run reviewable with only saved visible pages", async () => {
    const source = {
      ...attempt(),
      content: surveyBranchingFixture(),
      closed: true,
      finalized: true,
      receipt: "retained-receipt",
      responses: { [branchingId(1)]: { kind: "poll", choiceIds: [branchingId(102)] } },
    };
    storage.set("pollingpops:survey:room-a", "room-credential");
    fixtures.apiFetch.mockResolvedValue({ attempt: source });
    const ui = harness();
    const markup = await ui.settle();
    expect(markup).toContain("Thank you");
    expect(markup).toContain("Page 2 of 2");
    expect(markup).toContain("Feedback 4");
    expect(markup).not.toContain("Show detailed feedback?");
    expect(ui.pages().closed).toBe(true);
    expect(ui.pages().responses).toEqual(source.responses);
    ui.pages().onBack();
    expect(ui.render()).toContain("Page 1 of 2");
    ui.pages().onChange!(branchingId(1), { kind: "poll", choiceIds: [branchingId(101)] });
    ui.pages().onNext();
    expect(ui.render()).toContain("Page 2 of 2");
    expect(ui.pages().responses).toEqual(source.responses);
    expect(fixtures.apiFetch.mock.calls.filter(([, init]) => init?.method === "POST")).toEqual([]);
    expect(writes).toEqual([]);
  });

  it("routes Enter on an intermediate page through the draft save barrier and advances only after acknowledgement", async () => {
    const source = pagedAttempt();
    storage.set("pollingpops:survey:room-a", "room-credential");
    const pending = deferred<{ attempt: ReturnType<typeof pagedAttempt> }>();
    fixtures.apiFetch.mockImplementation(async (path: string, init?: RequestInit) =>
      init?.method === "POST" ? pending.promise : { attempt: source },
    );
    const ui = harness();
    await ui.settle();
    ui.pages().onChange!(source.content.items[0]!.question.id, { kind: "rating", value: 4 });
    ui.render();
    await ui.submit();
    const writes = fixtures.apiFetch.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(writes).toHaveLength(1);
    expect(writes[0]![0]).toBe("/v1/survey-rooms/room-a/draft");
    expect(writes[0]![1].headers).toMatchObject({
      authorization: "Bearer room-credential",
      "x-pollingpops-survey-schema": "4",
    });
    expect(ui.pages().pageIndex).toBe(0);
    expect(ui.pages().locked).toBe(true);
    pending.resolve({
      attempt: {
        ...source,
        revision: 1,
        responses: { [source.content.items[0]!.question.id]: { kind: "rating", value: 4 } },
      },
    });
    await ui.settle();
    expect(ui.pages().pageIndex).toBe(1);
    expect(ui.pages().locked).toBe(false);
  });
  it("fences saved responses and captured input handlers across room A to B to A", async () => {
    const pending = deferred<{ attempt: ReturnType<typeof pagedAttempt> }>();
    storage.set("pollingpops:survey:room-a", "room-a-token");
    storage.set("pollingpops:survey:room-b", "room-b-token");
    fixtures.apiFetch.mockImplementation(async (path: string, init?: RequestInit) =>
      init?.method === "POST"
        ? pending.promise
        : { attempt: pagedAttempt(path.includes("room-b") ? "room-b" : "room-a") },
    );
    const ui = harness();
    await ui.settle();
    const oldChange = ui.pages().onChange!;
    const questionId = pagedAttempt().content.items[0]!.question.id;
    oldChange(questionId, { kind: "rating", value: 4 });
    ui.render();
    ui.pages().onNext();
    await ui.settle();
    fixtures.id = "room-b";
    expect(ui.render()).not.toContain("Survey room-a");
    ui.flush();
    await ui.settle();
    fixtures.id = "room-a";
    ui.render();
    ui.flush();
    await ui.settle();
    oldChange(questionId, { kind: "rating", value: 5 });
    pending.resolve({
      attempt: {
        ...pagedAttempt(),
        revision: 1,
        responses: { [questionId]: { kind: "rating", value: 4 } },
      },
    });
    await ui.settle();
    expect(ui.pages().pageIndex).toBe(0);
    expect(ui.pages().responses).toEqual({});
    expect(fixtures.apiFetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(
      1,
    );
  });
});
