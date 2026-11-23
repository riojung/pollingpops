import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SessionSnapshotSchema,
  supportedLocales,
  type RoundCohostUnavailableReason,
  type SessionStaffCredential,
  type SupportedLocale,
} from "@openround/contracts";
import { resolveExperienceTheme } from "@openround/experience";
import { ApiClientError } from "../../../lib/api";
import type * as ApiModule from "../../../lib/api";
import type * as RealtimeModule from "../../../lib/realtime";
import { hostStaffCopy, hostStaffCopyKeys } from "../../../lib/i18n/host-staff-copy";
import HostPage from "./page";

interface Hooks {
  cursor: number;
  slots: unknown[];
  effects: Array<() => unknown>;
}
const fixtures = vi.hoisted(() => ({
  hooks: null as Hooks | null,
  tree: null as ReactNode,
  locale: "ko-KR" as SupportedLocale,
  snapshot: null as unknown,
  apiFetch: vi.fn(),
  copy: vi.fn(),
  open: vi.fn(),
  handlers: new Map<string, (...args: unknown[]) => void>(),
  credentials: [] as SessionStaffCredential[],
  allowStaff: true,
  allowCohost: true as boolean | undefined,
  cohostReason: undefined as RoundCohostUnavailableReason | "future_reason" | undefined,
  embedOriginsConfigured: true as boolean | undefined,
  legacyStaffRead: false,
  staffReadStatus: undefined as number | undefined,
  syncDenied: false,
  emissions: [] as { name: string; payload: Record<string, unknown> }[],
}));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof ReactModule>();
  return {
    ...react,
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
    useMemo: <T,>(factory: () => T) => (fixtures.hooks ? factory() : react.useMemo(factory, [])),
    useCallback: <T,>(callback: T) => callback,
    useEffect: (effect: () => unknown) => {
      if (fixtures.hooks) fixtures.hooks.effects.push(effect);
      else react.useEffect(effect as Parameters<typeof react.useEffect>[0]);
    },
  };
});
vi.mock("next/navigation", () => ({ useParams: () => ({ sessionId: "room-a" }) }));
vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  apiFetch: fixtures.apiFetch,
}));
vi.mock("../../../lib/realtime", async (importOriginal) => ({
  ...(await importOriginal<typeof RealtimeModule>()),
  createRealtimeClient: () => ({
    connected: true,
    on: (name: string, callback: (...args: unknown[]) => void) =>
      fixtures.handlers.set(name, callback),
    emit: (
      name: string,
      payload: Record<string, unknown>,
      callback: (response: unknown) => void,
    ) => {
      fixtures.emissions.push({ name, payload });
      callback(
        fixtures.syncDenied && name === "sync.request"
          ? { error: { code: "UNAUTHORIZED", message: "Scoped access rejected" } }
          : { data: { snapshot: fixtures.snapshot } },
      );
    },
    connect: () => fixtures.handlers.get("connect")?.(),
    disconnect: vi.fn(),
    removeAllListeners: vi.fn(),
  }),
}));
vi.mock("../../../components/locale-provider", async () => {
  const { loadMessages, translate } = await import("../../../lib/i18n/catalog");
  const { supportedLocales } = await import("@openround/contracts");
  const messages = Object.fromEntries(
    await Promise.all(
      supportedLocales.map(async (locale) => [
        locale,
        await loadMessages(locale, ["live-delivery"]),
      ]),
    ),
  );
  return {
    useLocale: () => ({
      locale: fixtures.locale,
      t: (key: Parameters<typeof translate>[1], values?: Record<string, string | number>) =>
        translate(messages[fixtures.locale]!, key, values),
    }),
  };
});
vi.mock("../../../components/experience-preferences", () => ({
  ExperiencePreferences: () => null,
}));
vi.mock("../../../components/join-access", () => ({ JoinAccess: () => null }));
vi.mock("../../../components/audience-panel", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  AudiencePanel: () => null,
}));
vi.mock("../../../components/qna-panel", () => ({ QnaPanel: () => null }));

const storage = new Map<string, string>();
const credential = (patch: Partial<SessionStaffCredential> = {}): SessionStaffCredential => ({
  id: "credential-a",
  sessionId: "room-a",
  role: "cohost",
  purpose: "collaboration",
  label: "Authored English label",
  createdAt: "2026-11-10T12:00:00.000Z",
  expiresAt: "2026-11-10T16:00:00.000Z",
  revokedAt: null,
  ...patch,
});

beforeEach(() => {
  fixtures.hooks = null;
  fixtures.tree = null;
  fixtures.locale = "ko-KR";
  fixtures.handlers.clear();
  fixtures.credentials = [];
  fixtures.allowStaff = true;
  fixtures.allowCohost = true;
  fixtures.cohostReason = undefined;
  fixtures.embedOriginsConfigured = true;
  fixtures.legacyStaffRead = false;
  fixtures.staffReadStatus = undefined;
  fixtures.syncDenied = false;
  fixtures.emissions = [];
  fixtures.copy.mockReset().mockResolvedValue(undefined);
  fixtures.open.mockReset();
  fixtures.snapshot = SessionSnapshotSchema.parse({
    mode: "live",
    stateSchemaVersion: 4,
    sessionId: "11111111-1111-4111-8111-111111111111",
    code: "1234567",
    version: 1,
    seq: 1,
    phase: "lobby",
    answerRevealed: false,
    roundId: null,
    roundKind: "main",
    sourceRoundId: null,
    questionIndex: null,
    questionPosition: null,
    questionCount: 1,
    question: null,
    deadline: null,
    participants: [],
    answerCount: 0,
    lobbyLocked: false,
    settings: {
      audienceLimit: 20,
      scoringMode: "accuracy",
      resultVisibility: "private",
      allowLateJoin: true,
      nicknamePolicy: "friendly_only",
    },
    brandTheme: null,
    experienceTheme: resolveExperienceTheme({ category: "general" }),
    pausedRemainingMs: null,
    intervention: null,
    uxBeta: true,
  });
  fixtures.apiFetch.mockReset().mockImplementation(async (path: string, init: RequestInit = {}) => {
    if (path === "/v1/auth/me") return { entitlements: { cohosting: fixtures.allowCohost } };
    if (path.endsWith("/entitlements"))
      return { entitlements: { cohosting: fixtures.allowCohost } };
    if (path.endsWith("/staff") && !init.method) {
      if (!fixtures.allowStaff)
        throw new ApiClientError("Synthetic creator authorization denied", "FORBIDDEN", 403);
      if (fixtures.staffReadStatus)
        throw new ApiClientError(
          "Synthetic staff read error",
          "INTERNAL_ERROR",
          fixtures.staffReadStatus,
        );
      return {
        credentials: fixtures.credentials,
        ...(fixtures.legacyStaffRead
          ? {}
          : {
              availability: {
                cohosting: fixtures.allowCohost,
                cohostingUnavailableReason: fixtures.cohostReason,
                embedOriginsConfigured: fixtures.embedOriginsConfigured,
              },
            }),
      };
    }
    if (init.method === "DELETE") return undefined;
    throw new Error(`Unexpected test request ${path}`);
  });
  storage.clear();
  storage.set("openround:host:room-a", "existing-host-pass");
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal("window", {
    location: {
      hash: "",
      pathname: "/host/room-a",
      search: "",
      origin: "https://round.example.test",
    },
    history: { replaceState: vi.fn() },
    open: fixtures.open,
  });
  vi.stubGlobal("navigator", { clipboard: { writeText: fixtures.copy } });
});
afterEach(() => vi.unstubAllGlobals());

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
function button(name: string) {
  const found = elements(fixtures.tree).find(
    (node) => node.type === "button" && text(node.props.children as ReactNode) === name,
  );
  if (!found) throw new Error(`Missing button: ${name}`);
  return found;
}
const flush = async () => {
  for (let index = 0; index < 16; index++) await Promise.resolve();
};
async function harness() {
  const hooks: Hooks = { cursor: 0, slots: [], effects: [] };
  const render = () => {
    hooks.cursor = 0;
    hooks.effects = [];
    fixtures.hooks = hooks;
    try {
      fixtures.tree = HostPage();
    } finally {
      fixtures.hooks = null;
    }
    return renderToStaticMarkup(fixtures.tree);
  };
  render();
  for (const effect of hooks.effects) effect();
  await flush();
  render();
  return {
    render,
    click: async (name: string) => {
      (button(name).props.onClick as () => void)();
      await flush();
      return render();
    },
    label: (value: string) => {
      const field = elements(fixtures.tree).find((node) => node.props.id === "cohost-label")!;
      (field.props.onChange as (event: { target: { value: string } }) => void)({
        target: { value },
      });
      render();
    },
  };
}

describe("Round staff localization and authority", () => {
  it("connects with a separately stored cohost credential and strips its fragment without creator recovery", async () => {
    const cohost = "synthetic_cohost_capability_1234567890";
    window.location.hash = `#cohost=${cohost}`;
    const page = await harness();
    expect(storage.get("openround:cohost:room-a")).toBe(cohost);
    expect(storage.has("openround:host:room-a")).toBe(false);
    expect(window.history.replaceState).toHaveBeenCalledWith(null, "", "/host/room-a");
    expect(
      fixtures.emissions.find((event) => event.name === "sync.request")?.payload.hostToken,
    ).toBe(cohost);
    expect(page.render()).not.toContain(cohost);
    expect(fixtures.apiFetch.mock.calls.some(([path]) => path.endsWith("/control-pass"))).toBe(
      false,
    );
  });

  it("does not upgrade a rejected cohost to an account-backed creator control pass", async () => {
    window.location.hash = "#cohost=synthetic_cohost_capability_1234567890";
    fixtures.syncDenied = true;
    const page = await harness();
    expect(page.render()).toContain("Scoped access rejected");
    expect(fixtures.apiFetch.mock.calls.some(([path]) => path.endsWith("/control-pass"))).toBe(
      false,
    );
  });
  it.each(supportedLocales)(
    "provides staff messages and preserves authored placeholders in %s",
    (locale) => {
      const copy = hostStaffCopy(locale);
      for (const key of hostStaffCopyKeys) {
        expect(copy(key).trim()).not.toBe("");
        expect(copy(key).match(/\{\w+\}/g) ?? []).toEqual(key.match(/\{\w+\}/g) ?? []);
        if (locale === "en-CA") expect(copy(key)).toBe(key);
      }
      expect(copy("Revoke access for {label}", { label: "Authored English label" })).toContain(
        "Authored English label",
      );
    },
  );

  it("renders Korean controls and roles while retaining user labels and revoked access state", async () => {
    fixtures.credentials = [
      credential(),
      credential({
        id: "credential-b",
        role: "presenter",
        label: "",
        revokedAt: "2026-11-10T13:00:00.000Z",
      }),
    ];
    const page = await harness();
    const markup = page.render();
    expect(markup).toContain('class="staff-management" lang="ko-KR"');
    expect(markup).toContain("Round 스태프");
    expect(markup).toContain("공동 호스트 링크 만들기");
    expect(markup).toContain("보안 삽입 링크 만들기");
    expect(markup).toContain('<strong lang="">Authored English label</strong>');
    expect(markup).toContain("공동 호스트");
    expect(markup).toContain("취소됨");
    expect(markup).toContain('aria-label="Authored English label의 접근 권한 취소"');
    expect(
      elements(fixtures.tree).filter(
        (node) =>
          node.type === "button" && String(node.props["aria-label"]).includes("접근 권한 취소"),
      ),
    ).toHaveLength(1);
  });

  it("creates one cohost grant per pending action and keeps the token only in the fragment", async () => {
    const page = await harness();
    page.label("  Authored helper  ");
    let complete!: (value: unknown) => void;
    fixtures.apiFetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const create = button("공동 호스트 링크 만들기").props.onClick as () => void;
    create();
    create();
    expect(fixtures.apiFetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(
      1,
    );
    expect(page.render()).toContain("공동 호스트 링크 만드는 중…");
    expect(button("공동 호스트 링크 만드는 중…").props.disabled).toBe(true);
    const [, request] = fixtures.apiFetch.mock.calls.at(-1)!;
    expect(JSON.parse(request.body)).toEqual({
      role: "cohost",
      label: "Authored helper",
      expiresInMinutes: 240,
    });
    expect(request.headers).toBeUndefined();
    complete({ token: "synthetic-cohost-secret", credential: credential() });
    await flush();
    const markup = page.render();
    const link = elements(fixtures.tree).find(
      (node) => node.type === "a" && String(node.props.href).includes("#cohost="),
    )!;
    const url = new URL(link.props.href as string);
    expect(url.pathname).toBe("/host/room-a");
    expect(url.search).toBe("");
    expect(new URLSearchParams(url.hash.slice(1)).get("cohost")).toBe("synthetic-cohost-secret");
    expect(link.props.lang).toBe("");
    expect(markup).toContain("링크가 만료되거나 취소될 때까지");
    await page.click("공동 호스트 링크 복사");
    expect(fixtures.copy).toHaveBeenCalledWith(url.toString());
    expect(page.render()).toContain("공동 호스트 링크를 복사했습니다.");
  });

  it("associates localized grant failure with its action, preserves service diagnostics, and permits retry", async () => {
    const page = await harness();
    fixtures.apiFetch.mockRejectedValueOnce(new Error("Synthetic grant denied: trace-123"));
    const failed = await page.click("공동 호스트 링크 만들기");
    expect(failed).toContain('id="staff-cohost-error" lang="ko-KR" role="alert"');
    expect(failed).toContain("공동 호스트 링크를 만들 수 없습니다.");
    expect(failed).toContain('<span lang="en-CA">Synthetic grant denied: trace-123</span>');
    expect(button("공동 호스트 링크 만들기").props["aria-describedby"]).toBe("staff-cohost-error");
    expect(button("공동 호스트 링크 만들기").props.disabled).toBe(false);
    fixtures.apiFetch.mockResolvedValueOnce({
      token: "synthetic-retry-token",
      credential: credential(),
    });
    await page.click("공동 호스트 링크 만들기");
    const requests = fixtures.apiFetch.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(JSON.parse(requests.at(-1)![1].body)).toMatchObject({
      role: "cohost",
      label: "공동 호스트",
      expiresInMinutes: 240,
    });
    expect(page.render()).not.toContain("Synthetic grant denied");
  });

  it("does not display an embed URL without an allowed HTTPS origin", async () => {
    const page = await harness();
    fixtures.apiFetch.mockResolvedValueOnce({
      token: "synthetic-presenter-secret",
      credential: credential({ role: "presenter" }),
      embedPolicyKey: "synthetic-policy-key",
      embedAllowedOrigins: [],
    });
    const markup = await page.click("보안 삽입 링크 만들기");
    expect(markup).toContain("HTTPS 삽입 출처를 하나 이상 추가해 달라고 요청한 후");
    expect(markup).toContain('id="staff-embed-error" lang="ko-KR" role="alert"');
    expect(markup).not.toContain("/embed/present/");
    expect(markup).not.toContain("synthetic-presenter-secret");
    expect(button("보안 삽입 링크 만들기").props.disabled).toBe(false);
  });

  it("keeps presenter grants read-only, protects pending creation, and localizes clipboard rejection", async () => {
    const page = await harness();
    let complete!: (value: unknown) => void;
    fixtures.apiFetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const create = button("보안 삽입 링크 만들기").props.onClick as () => void;
    create();
    create();
    expect(page.render()).toContain("보안 삽입 링크 만드는 중…");
    expect(button("발표자 화면").props.disabled).toBe(true);
    const requests = fixtures.apiFetch.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(requests).toHaveLength(1);
    expect(JSON.parse(requests[0]![1].body)).toEqual({
      role: "presenter",
      label: "보안 발표자 화면 삽입",
    });
    complete({
      token: "synthetic-presenter-secret",
      credential: credential({ role: "presenter" }),
      embedPolicyKey: "synthetic-policy-key",
      embedAllowedOrigins: ["https://allowed.example.test"],
    });
    await flush();
    page.render();
    const link = elements(fixtures.tree).find(
      (node) => node.type === "a" && String(node.props.href).includes("/embed/present/"),
    )!;
    const url = new URL(link.props.href as string);
    expect(url.pathname).toBe("/embed/present/room-a/synthetic-policy-key");
    expect(url.search).toBe("");
    expect(new URLSearchParams(url.hash.slice(1)).get("credential")).toBe(
      "synthetic-presenter-secret",
    );
    expect(storage.get("openround:presenter-origins:room-a")).toBe(
      '["https://allowed.example.test"]',
    );
    fixtures.copy.mockRejectedValueOnce(new Error("Clipboard denied"));
    expect(await page.click("삽입 링크 복사")).toContain(
      "복사가 차단되었습니다. 표시된 링크를 선택하여 복사하세요.",
    );
    await page.click("발표자 화면");
    expect(fixtures.open).toHaveBeenCalledWith(
      "/present/room-a",
      "openround-presenter-room-a",
      "popup,width=1440,height=900",
    );
    expect(fixtures.apiFetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(
      1,
    );
  });

  it("revokes one credential at a time and reports only confirmed revocation", async () => {
    fixtures.credentials = [credential()];
    const page = await harness();
    let complete!: () => void;
    fixtures.apiFetch.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    const revoke = button("취소").props.onClick as () => void;
    revoke();
    revoke();
    expect(page.render()).toContain("취소 중…");
    expect(button("취소 중…").props["aria-label"]).toBe("취소 중… Authored English label");
    expect(page.render()).not.toContain("스태프 접근 권한을 취소했습니다.");
    expect(fixtures.apiFetch.mock.calls.filter(([, init]) => init?.method === "DELETE")).toEqual([
      ["/v1/sessions/room-a/staff/credential-a", { method: "DELETE" }],
    ]);
    fixtures.credentials = [credential({ revokedAt: "2026-11-10T13:00:00.000Z" })];
    complete();
    await flush();
    const markup = page.render();
    expect(markup).toContain("스태프 접근 권한을 취소했습니다.");
    expect(markup).toContain("취소됨");
    expect(markup).toContain("Authored English label");
    expect(
      elements(fixtures.tree).filter(
        (node) =>
          node.type === "button" && String(node.props["aria-label"]).includes("접근 권한 취소"),
      ),
    ).toHaveLength(0);
  });

  it("keeps creator-only management hidden when creator authorization is unavailable", async () => {
    fixtures.allowStaff = false;
    fixtures.credentials = [credential()];
    const page = await harness();
    expect(page.render()).not.toContain("staff-management");
    expect(page.render()).not.toContain("Authored English label");
    expect(fixtures.apiFetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(
      0,
    );
    const staffRead = fixtures.apiFetch.mock.calls.find(([path]) => path.endsWith("/staff"));
    expect(staffRead?.[0]).toBe("/v1/sessions/room-a/staff");
  });

  it("does not claim revocation after failure and associates the error only with its credential", async () => {
    fixtures.credentials = [
      credential(),
      credential({ id: "credential-b", label: "Another helper" }),
    ];
    const page = await harness();
    fixtures.apiFetch.mockRejectedValueOnce(new Error("Synthetic revoke denied: trace-456"));
    const target = elements(fixtures.tree).find(
      (node) => node.props["aria-label"] === "Authored English label의 접근 권한 취소",
    )!;
    (target.props.onClick as () => void)();
    await flush();
    const markup = page.render();
    expect(markup).toContain("이 스태프 접근 권한을 취소할 수 없습니다.");
    expect(markup).toContain('<span lang="en-CA">Synthetic revoke denied: trace-456</span>');
    expect(markup).not.toContain("스태프 접근 권한을 취소했습니다.");
    const affected = elements(fixtures.tree).filter(
      (node) => node.type === "button" && node.props["aria-describedby"] === "staff-revoke-error",
    );
    expect(affected).toHaveLength(1);
    expect(affected[0]!.props["aria-label"]).toBe("Authored English label의 접근 권한 취소");
    expect(affected[0]!.props.disabled).toBe(false);
  });

  it("retains English controls and explains an empty list or unavailable cohosting plan", async () => {
    fixtures.locale = "en-CA";
    fixtures.allowCohost = false;
    fixtures.cohostReason = "plan_limit";
    const page = await harness();
    const markup = page.render();
    expect(markup).toContain("Round staff");
    expect(markup).toContain("No staff credentials yet.");
    expect(markup).toContain(
      "This workspace&#x27;s current plan doesn&#x27;t include cohost links.",
    );
    expect(markup).toContain("Compare plans");
    expect(markup).toContain("Create secure embed link");
    expect(markup).not.toContain('id="cohost-label"');
  });

  it.each([
    ["room_coverage", "This Round was started without cohost access."],
    [
      "operator_policy",
      "Cohost links are disabled for this workspace by your Polling Pops operator.",
    ],
  ] as const)(
    "explains %s while keeping retained staff management available",
    async (reason, message) => {
      fixtures.locale = "en-CA";
      fixtures.allowCohost = false;
      fixtures.cohostReason = reason;
      fixtures.credentials = [credential()];
      const page = await harness();
      const markup = page.render();
      expect(markup).toContain(message);
      expect(markup).not.toContain("Compare plans");
      expect(markup).toContain("Authored English label");
      expect(button("Revoke").props.disabled).toBe(false);
      expect(button("Create cohost link").props["aria-describedby"]).toBe(
        "staff-cohost-availability",
      );
      expect(button("Create cohost link").props.disabled).toBe(true);
      await page.click("Create cohost link");
      expect(fixtures.apiFetch.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    },
  );

  it("rechecks a cohost denial after policy changes without describing it as a plan limit", async () => {
    fixtures.locale = "en-CA";
    const page = await harness();
    fixtures.apiFetch.mockRejectedValueOnce(
      new ApiClientError("Old plan message", "ENTITLEMENT_LIMIT", 402, undefined, {
        cohostingUnavailableReason: "operator_policy",
      }),
    );
    const denied = await page.click("Create cohost link");
    expect(denied).toContain(
      "Cohost links are disabled for this workspace by your Polling Pops operator.",
    );
    expect(denied).not.toContain("Old plan message");
    expect(denied).not.toContain("Compare plans");
    expect(button("Create cohost link").props.disabled).toBe(true);
    const refreshed = await page.click("Refresh availability");
    expect(refreshed).not.toContain("disabled for this workspace");
    expect(button("Create cohost link").props.disabled).toBe(false);
  });

  it("preserves a cohost denial when an older staff refresh completes afterward", async () => {
    fixtures.locale = "en-CA";
    const page = await harness();
    let finishOlderRead!: (value: unknown) => void;
    fixtures.apiFetch.mockReturnValueOnce(
      new Promise((resolve) => {
        finishOlderRead = resolve;
      }),
    );
    await page.click("Refresh availability");
    fixtures.apiFetch.mockRejectedValueOnce(
      new ApiClientError("Changed policy", "ENTITLEMENT_LIMIT", 402, undefined, {
        cohostingUnavailableReason: "operator_policy",
      }),
    );
    await page.click("Create cohost link");
    finishOlderRead({
      credentials: [],
      availability: { cohosting: true, embedOriginsConfigured: true },
    });
    await flush();
    expect(page.render()).toContain("Cohost links are disabled for this workspace");
    expect(button("Create cohost link").props.disabled).toBe(true);

    fixtures.allowCohost = undefined;
    expect(await page.click("Refresh availability")).toContain(
      "Cohost links are disabled for this workspace",
    );
    fixtures.allowCohost = true;
    expect(await page.click("Refresh availability")).not.toContain(
      "Cohost links are disabled for this workspace",
    );
    expect(button("Create cohost link").props.disabled).toBe(false);
  });

  it.each([
    ["cohost", undefined, true],
    ["embed", true, undefined],
    ["both", undefined, undefined],
  ] as const)(
    "keeps revocation available when %s availability is unknown",
    async (_kind, cohost, embed) => {
      fixtures.locale = "en-CA";
      fixtures.allowCohost = cohost;
      fixtures.embedOriginsConfigured = embed;
      fixtures.credentials = [credential()];
      const page = await harness();
      const markup = page.render();
      expect(markup).toContain("Round staff availability couldn&#x27;t be checked.");
      expect(markup).toContain("Authored English label");
      expect(button("Create cohost link").props.disabled).toBe(cohost === undefined);
      expect(button("Create secure embed link").props.disabled).toBe(embed === undefined);
      expect(button("Revoke").props.disabled).toBe(false);
      expect(fixtures.apiFetch.mock.calls.some(([path]) => path.endsWith("/entitlements"))).toBe(
        false,
      );
      await page.click("Revoke");
      expect(fixtures.apiFetch.mock.calls).toContainEqual([
        "/v1/sessions/room-a/staff/credential-a",
        { method: "DELETE" },
      ]);
    },
  );

  it("checks embed origin setup without creating a credential and preserves separate Presenter view", async () => {
    fixtures.locale = "en-CA";
    fixtures.embedOriginsConfigured = false;
    const page = await harness();
    expect(page.render()).toContain("add at least one HTTPS embed origin");
    expect(button("Create secure embed link").props["aria-describedby"]).toBe(
      "staff-embed-availability",
    );
    expect(button("Create secure embed link").props.disabled).toBe(true);
    expect(button("Presenter view").props.disabled).toBe(false);
    await page.click("Create secure embed link");
    expect(fixtures.apiFetch.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    fixtures.embedOriginsConfigured = true;
    await page.click("Refresh availability");
    expect(button("Create secure embed link").props.disabled).toBe(false);
  });

  it("recovers a failed staff read and uses neutral copy with a legacy room entitlement", async () => {
    fixtures.locale = "en-CA";
    fixtures.allowCohost = false;
    fixtures.legacyStaffRead = true;
    fixtures.staffReadStatus = 503;
    fixtures.credentials = [credential()];
    const page = await harness();
    expect(page.render()).toContain("Round staff availability couldn&#x27;t be checked.");
    expect(page.render()).not.toContain("Authored English label");
    fixtures.staffReadStatus = undefined;
    const refreshed = await page.click("Refresh availability");
    expect(refreshed).toContain("Cohost links are unavailable for this Round.");
    expect(refreshed).toContain("Authored English label");
    expect(refreshed).not.toContain("Compare plans");
    expect(button("Create secure embed link").props.disabled).toBe(false);
  });

  it("keeps confirmed limitations when an unfamiliar cohost reason arrives", async () => {
    fixtures.locale = "en-CA";
    fixtures.allowCohost = false;
    fixtures.cohostReason = "future_reason";
    fixtures.embedOriginsConfigured = false;
    const page = await harness();
    expect(page.render()).toContain("Cohost links are unavailable for this Round.");
    expect(page.render()).not.toContain("Compare plans");
    expect(button("Create cohost link").props.disabled).toBe(true);
    expect(button("Create secure embed link").props.disabled).toBe(true);
    expect(fixtures.apiFetch.mock.calls.some(([path]) => path.endsWith("/entitlements"))).toBe(
      false,
    );
  });
});
