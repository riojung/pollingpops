import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ApiModule from "../../lib/api";

interface Hooks {
  cursor: number;
  slots: unknown[];
}
const fixtures = vi.hoisted(() => ({
  hooks: null as Hooks | null,
  tree: null as ReactNode,
  apiFetch: vi.fn(),
  push: vi.fn(),
  artifact: "round" as "round" | "presentation" | "feedback_room",
  protected: true,
  nicknamePolicy: "custom" as "custom" | "friendly_only",
}));
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof ReactModule>();
  return {
    ...react,
    useEffect: () => undefined,
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
  useSearchParams: () => new URLSearchParams({ code: "1234567" }),
  useRouter: () => ({ push: fixtures.push }),
}));
vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  apiFetch: fixtures.apiFetch,
}));
vi.mock("../../components/locale-provider", async () => {
  const { loadMessages, translate } = await import("../../lib/i18n/catalog");
  const messages = await loadMessages("en-CA", ["live-delivery", "delivery-authoring"]);
  return {
    useLocale: () => ({ t: (key: Parameters<typeof translate>[1]) => translate(messages, key) }),
  };
});

import { JoinForm } from "./page";
import { RoomPasswordInput } from "../../components/room-password";
import { ApiClientError } from "../../lib/api";

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
  const hooks: Hooks = { cursor: 0, slots: [] };
  const render = () => {
    hooks.cursor = 0;
    fixtures.hooks = hooks;
    try {
      fixtures.tree = JoinForm();
    } finally {
      fixtures.hooks = null;
    }
    return renderToStaticMarkup(fixtures.tree);
  };
  const submit = async () => {
    const form = find(fixtures.tree, (node) => node.type === "form")!;
    await (form.props.onSubmit as (event: { preventDefault(): void }) => Promise<void>)({
      preventDefault() {},
    });
    return render();
  };
  const changePassword = (value: string) => {
    const field = find(fixtures.tree, (node) => node.type === RoomPasswordInput)!;
    (field.props.onChange as (value: string) => void)(value);
    render();
  };
  const changeNickname = (value: string) => {
    const field = find(fixtures.tree, (node) => node.props.id === "nickname")!;
    (field.props.onChange as (event: { target: { value: string } }) => void)({
      target: { value },
    });
    render();
  };
  render();
  return { render, submit, changePassword, changeNickname };
}
const storage = new Map<string, string>();
const writes: string[] = [];
beforeEach(() => {
  storage.clear();
  writes.length = 0;
  const browserStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
      writes.push(value);
    },
  };
  vi.stubGlobal("localStorage", browserStorage);
  vi.stubGlobal("sessionStorage", browserStorage);
  fixtures.hooks = null;
  fixtures.tree = null;
  fixtures.artifact = "round";
  fixtures.protected = true;
  fixtures.nicknamePolicy = "custom";
  fixtures.push.mockReset();
  fixtures.apiFetch.mockReset();
  fixtures.apiFetch.mockImplementation(async (path: string) => {
    if (path.includes("/preflight"))
      return {
        nicknamePolicy: fixtures.nicknamePolicy,
        artifactType: fixtures.artifact,
        passwordRequired: fixtures.protected,
        destination: "/survey/11111111-1111-4111-8111-111111111111",
      };
    return {
      participantToken: "guest-credential",
      snapshot: { id: "room-a", sessionId: "room-a" },
      attempt: { roomId: "room-a" },
    };
  });
});

describe("participant nickname choice", () => {
  it("requests a required nickname when an unchecked code resolves to a Presentation", async () => {
    fixtures.artifact = "presentation";
    fixtures.protected = false;
    const ui = harness();
    await ui.submit();
    const field = find(fixtures.tree, (node) => node.props.id === "nickname")!;
    expect(field.props.required).toBe(true);
    expect(ui.render()).not.toContain("Nickname (optional)");
    expect(fixtures.apiFetch.mock.calls.some(([, request]) => request?.method === "POST")).toBe(
      false,
    );
    ui.changeNickname("Presenter guest");
    await ui.submit();
    expect(fixtures.push).toHaveBeenCalledWith("/presentation-session/room-a/play");
  });

  it("labels the optional nickname and submits the participant's chosen name", async () => {
    fixtures.protected = false;
    const ui = harness();
    expect(ui.render()).toContain("Nickname (optional)");
    expect(ui.render()).toContain("leave this blank to get a generated one");
    const field = find(fixtures.tree, (node) => node.props.id === "nickname")!;
    expect(field.props.required).toBe(false);
    ui.changeNickname("  My chosen name  ");
    await ui.submit();
    const [, init] = fixtures.apiFetch.mock.calls.find(
      ([, request]) => request?.method === "POST",
    )!;
    expect(JSON.parse(init.body)).toMatchObject({ nickname: "My chosen name" });
    expect(fixtures.push).toHaveBeenCalledWith("/play/room-a");
  });

  it("omits a blank nickname so the room generates a fallback", async () => {
    fixtures.protected = false;
    const ui = harness();
    ui.changeNickname("   ");
    await ui.submit();
    const [, init] = fixtures.apiFetch.mock.calls.find(
      ([, request]) => request?.method === "POST",
    )!;
    expect(JSON.parse(init.body)).not.toHaveProperty("nickname");
    expect(fixtures.push).toHaveBeenCalledWith("/play/room-a");
  });

  it("honors the host's generated-only setting discovered at submission", async () => {
    fixtures.nicknamePolicy = "friendly_only";
    const ui = harness();
    ui.changeNickname("Name entered before the code was checked");
    await ui.submit();
    expect(ui.render()).toContain("The host has chosen generated nicknames for this round");
    expect(find(fixtures.tree, (node) => node.props.id === "nickname")).toBeNull();
    ui.changePassword("room password");
    await ui.submit();
    const [, init] = fixtures.apiFetch.mock.calls.find(
      ([, request]) => request?.method === "POST",
    )!;
    expect(JSON.parse(init.body)).not.toHaveProperty("nickname");
  });
});

describe("unified password admission", () => {
  it.each(["round", "presentation", "feedback_room"] as const)(
    "preflights and sends the exact %s password only in the POST body",
    async (artifact) => {
      fixtures.artifact = artifact;
      const ui = harness();
      expect(await ui.submit()).toContain("Room password</label>");
      expect(
        fixtures.apiFetch.mock.calls.filter(([, init]) => init?.method === "POST"),
      ).toHaveLength(0);
      expect(fixtures.push).not.toHaveBeenCalled();
      ui.changePassword("  room secret  ");
      if (artifact === "presentation") ui.changeNickname("Presentation participant");
      await ui.submit();
      const [path, init] = fixtures.apiFetch.mock.calls.find(
        ([, request]) => request?.method === "POST",
      )!;
      expect(path).toBe(
        artifact === "round"
          ? "/v1/sessions/join"
          : artifact === "presentation"
            ? "/v1/presentation-sessions/join"
            : "/v1/survey-rooms/join",
      );
      expect(JSON.parse(init.body)).toMatchObject({ code: "1234567", password: "  room secret  " });
      expect(fixtures.push).toHaveBeenCalledOnce();
      expect(writes).not.toContain("  room secret  ");
      expect(String(fixtures.push.mock.calls[0]![0])).not.toContain("secret");
      expect(fixtures.apiFetch.mock.calls.every(([url]) => !url.includes("secret"))).toBe(true);
    },
  );

  it("keeps a wrong password on the form with actionable feedback, then clears it when the code changes", async () => {
    const ui = harness();
    await ui.submit();
    ui.changePassword("wrong password");
    fixtures.apiFetch.mockRejectedValueOnce(
      new ApiClientError("raw server text", "INVALID_PASSWORD", 403),
    );
    const markup = await ui.submit();
    expect(markup).toContain("That password is incorrect. Check with your host and try again.");
    expect(markup).not.toContain("raw server text");
    expect(fixtures.push).not.toHaveBeenCalled();
    const code = find(fixtures.tree, (node) => node.props.id === "join-code")!;
    (code.props.onChange as (event: { target: { value: string } }) => void)({
      target: { value: "7654321" },
    });
    expect(ui.render()).not.toContain('type="password"');
    await ui.submit();
    const field = find(fixtures.tree, (node) => node.type === RoomPasswordInput)!;
    expect(field.props.value).toBe("");
  });

  it("keeps an open room password-free", async () => {
    fixtures.protected = false;
    const ui = harness();
    await ui.submit();
    const [, init] = fixtures.apiFetch.mock.calls.find(
      ([, request]) => request?.method === "POST",
    )!;
    expect(JSON.parse(init.body)).not.toHaveProperty("password");
    expect(ui.render()).not.toContain('type="password"');
  });
});
