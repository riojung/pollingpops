import { isValidElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { supportedLocales, type SupportedLocale } from "@openround/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PracticeAccess,
  PracticeContext,
  PracticeRecord,
} from "../../../lib/practice-assignment";
interface Hooks {
  cursor: number;
  slots: unknown[];
  effectCursor: number;
  effects: Array<() => void>;
  effectSlots: Array<{ dependencies?: readonly unknown[]; cleanup?: () => void }>;
}
const fixtures = vi.hoisted(() => ({
  fetch: vi.fn(),
  shareAssignment: vi.fn(),
  shareFollowup: vi.fn(),
  clipboard: vi.fn(),
  confirm: vi.fn(),
  focus: vi.fn(),
  locale: "en-CA" as SupportedLocale,
  id: "practice-a",
  userId: "creator-a",
  workspaceId: "workspace-a",
  role: "owner",
  canEdit: true,
  accountLoading: false,
  assignments: true,
  packs: true,
  pro: true,
  hooks: null as Hooks | null,
  frames: [] as Array<() => void>,
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
        (next: T | ((current: T) => T)) => {
          hooks.slots[index] =
            typeof next === "function"
              ? (next as (current: T) => T)(hooks.slots[index] as T)
              : next;
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
    useEffect: (
      effect: Parameters<typeof react.useEffect>[0],
      dependencies?: readonly unknown[],
    ) => {
      const hooks = fixtures.hooks;
      if (!hooks) return react.useEffect(effect, dependencies);
      const index = hooks.effectCursor++;
      const previous = hooks.effectSlots[index];
      if (
        previous?.dependencies &&
        dependencies?.length === previous.dependencies.length &&
        dependencies.every((value, position) => Object.is(value, previous.dependencies![position]))
      )
        return;
      const slot = { dependencies, cleanup: undefined as (() => void) | undefined };
      hooks.effectSlots[index] = slot;
      hooks.effects.push(() => {
        previous?.cleanup?.();
        slot.cleanup = effect() || undefined;
      });
    },
  };
});
vi.mock("next/navigation", () => ({ useParams: () => ({ id: fixtures.id }) }));
vi.mock("../../../components/locale-provider", () => ({
  useLocale: () => ({ locale: fixtures.locale }),
}));
vi.mock("../../../components/workspace/workspace-provider", () => ({
  WorkspaceProvider: ({ children }: { children: ReactNode }) => children,
  useWorkspace: () => ({
    creator: { userId: fixtures.userId, workspaceId: fixtures.workspaceId, role: fixtures.role },
    canEdit: fixtures.canEdit,
    loading: fixtures.accountLoading,
    productFeatures: { practiceAssignments: fixtures.assignments, recoveryPacks: fixtures.packs },
    entitlements: { followups: fixtures.pro },
  }),
}));
vi.mock("../../../components/workspace/workspace-shell", () => ({
  WorkspaceShell: ({
    children,
    title,
    titleLanguage,
    actions,
    description,
    eyebrow,
  }: {
    children: ReactNode;
    title: string;
    titleLanguage: string;
    actions: ReactNode;
    description: string;
    eyebrow: string;
  }) => (
    <main>
      <header>
        <p>{eyebrow}</p>
        <h1 lang={titleLanguage}>{title}</h1>
        <p>{description}</p>
        {actions}
      </header>
      {children}
    </main>
  ),
}));
vi.mock("../../../lib/api", () => ({
  apiFetch: fixtures.fetch,
  humanError: (error: Error) => error.message,
}));
vi.mock("../../../components/workspace/product-events", () => ({
  recordPracticeAssignmentShared: fixtures.shareAssignment,
  recordFollowupShared: fixtures.shareFollowup,
}));
import Page from "./page";
import { practiceManagementCopy } from "../../../lib/i18n/practice-management-copy";
import { formatDateTime, formatNumber } from "../../../lib/i18n/format";

function access(overrides: Partial<PracticeAccess> = {}): PracticeAccess {
  return {
    id: "access-a",
    kind: "assignment_personal",
    participantId: null,
    nickname: null,
    label: "Learner — 한국어",
    timeMultiplier: 1,
    expiresAt: "2099-01-01T00:00:00Z",
    revokedAt: null,
    ...overrides,
  };
}
function detail(
  options: {
    timeMode?: "flex" | "timed";
    purpose?: "assignment" | "recovery";
    full?: boolean;
    empty?: boolean;
    round?: boolean;
    closed?: boolean;
    expired?: boolean;
    scheduled?: boolean;
  } = {},
) {
  const followup: PracticeRecord = {
    id: fixtures.id,
    purpose: options.purpose ?? "assignment",
    sourceSessionId: null,
    sourceReportId: "source-report",
    sourceQuizVersionId: null,
    recoveryPackSource: {
      artifactType: "recovery_pack",
      packId: "pack-a",
      packVersionId: "pack-version",
      packVersion: 1234,
      contentHash: "a".repeat(64),
      packTitle: "Frozen Pack — 한국어",
      publishedAt: "2026-10-07T12:00:00Z",
      sourceItemId: "probe-a",
      role: options.full ? "full_sequence" : "delayed_probe",
    },
    title: "Authored practice — 日本語",
    conceptKeys: [],
    checkpointCount: 1234,
    timeMode: options.timeMode ?? "timed",
    opensAt: options.scheduled ? "2098-01-01T00:00:00Z" : "2020-01-01T00:00:00Z",
    closesAt: "2099-01-01T00:00:00Z",
    expiresAt: options.expired ? "2020-01-01T00:00:00Z" : "2099-01-01T00:00:00Z",
    closedAt: options.closed ? "2026-01-01T00:00:00Z" : null,
    createdAt: "2026-10-07T12:00:00Z",
  };
  const context: PracticeContext = options.round
    ? {
        quizId: "quiz-a",
        quizTitle: "Published Round — français",
        version: 1234,
        publishedAt: "2026-10-07T12:00:00Z",
      }
    : {
        sourceType: "recovery_pack",
        packId: "pack-a",
        packTitle: "Frozen Pack — 한국어",
        version: 1234,
        publishedAt: "2026-10-07T12:00:00Z",
      };
  if (options.round) followup.recoveryPackSource = null;
  return {
    followup,
    context,
    access: options.empty ? [] : [access()],
    attemptCount: 2345,
    completedAttemptCount: 1234,
  };
}
beforeEach(() => {
  fixtures.locale = "en-CA";
  fixtures.id = "practice-a";
  fixtures.userId = "creator-a";
  fixtures.workspaceId = "workspace-a";
  fixtures.role = "owner";
  fixtures.canEdit = true;
  fixtures.accountLoading = false;
  fixtures.assignments = true;
  fixtures.packs = true;
  fixtures.pro = true;
  fixtures.hooks = null;
  fixtures.frames = [];
  fixtures.fetch.mockReset().mockImplementation(() => Promise.resolve(detail()));
  fixtures.confirm.mockReset().mockReturnValue(true);
  fixtures.clipboard.mockReset().mockResolvedValue(undefined);
  fixtures.shareAssignment.mockReset();
  fixtures.shareFollowup.mockReset();
  fixtures.focus.mockReset();
  vi.unstubAllGlobals();
  vi.stubGlobal("window", {
    confirm: fixtures.confirm,
    requestAnimationFrame: (callback: () => void) => fixtures.frames.push(callback),
  });
  vi.stubGlobal("navigator", { clipboard: { writeText: fixtures.clipboard } });
});
function nodes(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...nodes(node.props.children as ReactNode)];
}
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return text(node.props.children);
  return typeof node === "string" || typeof node === "number" ? String(node) : "";
}
function button(tree: ReactNode, name: string) {
  const node = nodes(tree).find(
    (node) => node.type === "button" && text(node.props.children as ReactNode) === name,
  );
  if (!node) throw new Error(`Missing button: ${name}`);
  return node.props as ComponentProps<"button">;
}
function field(tree: ReactNode, id: string) {
  const node = nodes(tree).find((node) => node.props.id === id);
  if (!node) throw new Error(`Missing field: ${id}`);
  return node.props as ComponentProps<"input">;
}
function change(tree: ReactNode, id: string, value: string) {
  field(tree, id).onChange?.({ target: { value } } as never);
}
function form(tree: ReactNode, fieldId: string) {
  const node = nodes(tree).find(
    (node) =>
      node.type === "form" &&
      nodes(node.props.children as ReactNode).some((child) => child.props.id === fieldId),
  );
  if (!node) throw new Error(`Missing form for ${fieldId}`);
  return node.props as ComponentProps<"form">;
}
function submit(tree: ReactNode, fieldId: string) {
  return form(tree, fieldId).onSubmit?.({ preventDefault() {} } as never);
}
function click(tree: ReactNode, name: string) {
  button(tree, name).onClick?.({} as never);
}
function harness() {
  let hooks: Hooks;
  let key: string | null | undefined;
  const unmount = () => hooks?.effectSlots.forEach((slot) => slot.cleanup?.());
  const render = () => {
    const content = Page().props.children as ReactElement<
      Record<string, unknown>,
      (
        props: Record<string, unknown>,
      ) => ReactElement<{ id: string }, (props: { id: string }) => ReactElement>
    >;
    const controller = content.type(content.props);
    if (!hooks! || key !== controller.key) {
      unmount();
      key = controller.key;
      hooks = { cursor: 0, slots: [], effectCursor: 0, effects: [], effectSlots: [] };
    }
    hooks.cursor = 0;
    hooks.effectCursor = 0;
    fixtures.hooks = hooks;
    try {
      const tree = controller.type(controller.props);
      for (const node of nodes(tree)) {
        const ref = node.props.ref as { current: unknown } | undefined;
        if (ref && typeof ref === "object")
          ref.current = { focus: () => fixtures.focus(node.props.id ?? node.props.role) };
      }
      return tree;
    } finally {
      fixtures.hooks = null;
    }
  };
  return {
    render,
    flushEffects: () => hooks.effects.splice(0).forEach((effect) => effect()),
    flushFrames: () => fixtures.frames.splice(0).forEach((callback) => callback()),
    unmount,
  };
}
async function loaded(response = detail()) {
  fixtures.fetch.mockResolvedValueOnce(response);
  const state = harness();
  state.render();
  state.flushEffects();
  await settle();
  state.render();
  return state;
}
async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function createReceipt(
  state: ReturnType<typeof harness>,
  purpose: "personal" | "accommodation" = "personal",
) {
  const created = access({
    id: "new-access",
    kind: purpose === "personal" ? "assignment_personal" : "accommodation",
    label: "Private authored — 中文",
    url: "https://example.test/followup/practice-a#token=verbatim-private%2Ftoken",
  });
  fixtures.fetch.mockResolvedValueOnce({ access: created });
  if (purpose === "personal") change(state.render(), "personal-pass-label", created.label);
  await submit(
    state.render(),
    purpose === "personal" ? "personal-pass-label" : "accommodation-label",
  );
  state.render();
  state.flushFrames();
  return created;
}

describe("practice management localization and state", () => {
  it.each(supportedLocales)("renders loading safely in %s without side effects", (locale) => {
    fixtures.locale = locale;
    const markup = renderToStaticMarkup(<Page />);
    expect(markup).toContain(practiceManagementCopy(locale)("Loading practice…"));
    expect(markup).toContain(`lang="${locale}"`);
    expect(fixtures.fetch).not.toHaveBeenCalled();
    expect(fixtures.confirm).not.toHaveBeenCalled();
    expect(fixtures.clipboard).not.toHaveBeenCalled();
    expect(fixtures.frames).toHaveLength(0);
  });
  it("changes all ten UI locales without resetting authored values, selections, data, or pending requests", async () => {
    const response = detail();
    const state = await loaded(response);
    change(state.render(), "personal-pass-label", "Authored label — 한글");
    change(state.render(), "accommodation-label", "My accommodation — français");
    change(state.render(), "accommodation-time", "2");
    const pending = deferred<{ access: PracticeAccess }>();
    fixtures.fetch.mockReturnValueOnce(pending.promise);
    const operation = submit(state.render(), "accommodation-label");
    const calls = fixtures.fetch.mock.calls.length;
    for (const locale of supportedLocales) {
      fixtures.locale = locale;
      const tree = state.render();
      state.flushEffects();
      const copy = practiceManagementCopy(locale);
      expect(text(tree)).toContain(copy("Private access"));
      expect(text(tree)).toContain(formatNumber(locale, 2345));
      expect(text(tree)).toContain(formatDateTime(locale, response.followup.opensAt));
      expect(field(tree, "personal-pass-label").value).toBe("Authored label — 한글");
      expect(field(tree, "accommodation-label").value).toBe("My accommodation — français");
      expect(field(tree, "accommodation-time").value).toBe(2);
      expect(button(tree, copy("Creating…")).disabled).toBe(true);
      expect((tree as ReactElement<Record<string, unknown>>).props.title).toBe(
        response.followup.title,
      );
      expect((tree as ReactElement<Record<string, unknown>>).props.titleLanguage).toBe("");
    }
    expect(fixtures.fetch).toHaveBeenCalledTimes(calls);
    expect(fixtures.frames).toHaveLength(0);
    expect(fixtures.confirm).not.toHaveBeenCalled();
    expect(fixtures.shareAssignment).not.toHaveBeenCalled();
    const created = access({
      url: "https://example.test/followup/practice-a#token=pending-verbatim",
    });
    pending.resolve({ access: created });
    await operation;
    expect(field(state.render(), "latest-practice-link").value).toBe(created.url);
    expect(fixtures.fetch.mock.calls.at(-1)?.[1].body).toBe(
      JSON.stringify({ label: "My accommodation — français", timeMultiplier: 2 }),
    );
  });
  it("preserves the exact new private URL across locale changes and shares only after a successful explicit copy", async () => {
    const state = await loaded();
    const created = await createReceipt(state);
    fixtures.focus.mockClear();
    fixtures.fetch.mockClear();
    for (const locale of supportedLocales) {
      fixtures.locale = locale;
      const tree = state.render();
      state.flushEffects();
      state.flushFrames();
      expect(field(tree, "latest-practice-link").value).toBe(created.url);
      expect(field(tree, "latest-practice-link").lang).toBe("");
    }
    expect(fixtures.fetch).not.toHaveBeenCalled();
    expect(fixtures.focus).not.toHaveBeenCalled();
    expect(fixtures.clipboard).not.toHaveBeenCalled();
    expect(fixtures.shareAssignment).not.toHaveBeenCalled();
    click(state.render(), practiceManagementCopy(fixtures.locale)("Copy"));
    await settle();
    expect(fixtures.clipboard).toHaveBeenCalledExactlyOnceWith(created.url);
    expect(fixtures.shareAssignment).toHaveBeenCalledOnce();
    expect(fixtures.shareFollowup).not.toHaveBeenCalled();
    fixtures.locale = "fr-FR";
    expect(text(state.render())).toContain(practiceManagementCopy("fr-FR")("Link copied."));
    expect(text(state.render())).toContain(created.label);
  });
  it("renders full-sequence, delayed-probe, and Round contexts with frozen source identities", async () => {
    for (const options of [{ full: true }, {}, { round: true, purpose: "recovery" as const }]) {
      const state = await loaded(detail(options));
      const tree = state.render();
      const markup = renderToStaticMarkup(tree);
      expect(markup).toContain(options.round ? "/quiz/quiz-a" : "/recovery-packs");
      expect(text(tree)).toContain(
        options.full
          ? "Full frozen Pack sequence"
          : options.round
            ? "Recovery follow-up"
            : "Frozen Pack delayed probe",
      );
      state.unmount();
    }
  });
});

describe("practice access authority and action semantics", () => {
  it.each(["role", "workspace", "actor", "route", "loading", "feature", "entitlement"])(
    "ignores stale creates after a %s change",
    async (changeType) => {
      const state = await loaded();
      change(state.render(), "personal-pass-label", "Private person");
      const pending = deferred<{ access: PracticeAccess }>();
      fixtures.fetch.mockReturnValueOnce(pending.promise);
      const staleForm = form(state.render(), "accommodation-label");
      const operation = submit(state.render(), "personal-pass-label");
      if (changeType === "role") {
        fixtures.canEdit = false;
        fixtures.role = "viewer";
      }
      if (changeType === "workspace") fixtures.workspaceId = "workspace-b";
      if (changeType === "actor") fixtures.userId = "creator-b";
      if (changeType === "route") fixtures.id = "practice-b";
      if (changeType === "loading") fixtures.accountLoading = true;
      if (changeType === "feature") fixtures.packs = false;
      if (changeType === "entitlement") fixtures.pro = false;
      state.render();
      state.flushEffects();
      const calls = fixtures.fetch.mock.calls.length;
      staleForm.onSubmit?.({ preventDefault() {} } as never);
      pending.resolve({ access: access({ url: "https://example.test/#token=stale-secret" }) });
      await operation;
      await settle();
      expect(fixtures.fetch).toHaveBeenCalledTimes(calls);
      expect(text(state.render())).not.toContain("Save this link now");
      expect(fixtures.frames).toHaveLength(0);
      expect(fixtures.shareAssignment).not.toHaveBeenCalled();
    },
  );
  it("does not restore an earlier request when permissions change back", async () => {
    const state = await loaded();
    change(state.render(), "personal-pass-label", "Person");
    const pending = deferred<{ access: PracticeAccess }>();
    fixtures.fetch.mockReturnValueOnce(pending.promise);
    const operation = submit(state.render(), "personal-pass-label");
    fixtures.canEdit = false;
    fixtures.role = "viewer";
    state.render();
    state.flushEffects();
    fixtures.canEdit = true;
    fixtures.role = "owner";
    state.render();
    state.flushEffects();
    pending.resolve({ access: access({ url: "https://example.test/#token=old-authority" }) });
    await operation;
    expect(text(state.render())).not.toContain("Save this link now");
    expect(fixtures.frames).toHaveLength(0);
  });
  it.each(["role", "route", "actor"])(
    "suppresses stale read failures and credentials after a %s change",
    async (changeType) => {
      const pending = deferred<ReturnType<typeof detail>>();
      fixtures.fetch.mockReturnValueOnce(pending.promise);
      const state = harness();
      state.render();
      state.flushEffects();
      if (changeType === "role") {
        fixtures.canEdit = false;
        fixtures.role = "viewer";
      }
      if (changeType === "route") fixtures.id = "practice-b";
      if (changeType === "actor") fixtures.userId = "creator-b";
      state.render();
      state.flushEffects();
      pending.reject(new Error("Old actor service detail"));
      await settle();
      const tree = state.render();
      // Reading remains authorized across a same-actor role change; actor and route reads are isolated.
      expect(text(tree).includes("Old actor service detail")).toBe(changeType === "role");
    },
  );
  it("preserves permitted management on Free and when new assignment features are paused", async () => {
    fixtures.pro = false;
    fixtures.assignments = false;
    fixtures.packs = false;
    const state = await loaded();
    const tree = state.render();
    expect(text(tree)).toContain("New personal assignment links are paused.");
    expect(text(tree)).toContain("New personal links require Pro.");
    expect(nodes(tree).some((node) => node.props.id === "personal-pass-label")).toBe(false);
    expect(button(tree, "Create accommodation pass")).toBeTruthy();
    expect(button(tree, "Revoke")).toBeTruthy();
    expect(button(tree, "Close practice for everyone")).toBeTruthy();
    const created = await createReceipt(state, "accommodation");
    expect(field(state.render(), "latest-practice-link").value).toBe(created.url);
  });
  it.each(["viewer", "closed", "expired", "flex"])(
    "fences unavailable controls for %s practice",
    async (mode) => {
      if (mode === "viewer") {
        fixtures.canEdit = false;
        fixtures.role = "viewer";
      }
      const state = await loaded(
        detail({
          closed: mode === "closed",
          expired: mode === "expired",
          timeMode: mode === "flex" ? "flex" : "timed",
        }),
      );
      const tree = state.render();
      expect(nodes(tree).some((node) => node.props.id === "accommodation-label")).toBe(false);
      if (mode !== "flex")
        expect(
          nodes(tree).some(
            (node) => node.type === "button" && text(node.props.children as ReactNode) === "Revoke",
          ),
        ).toBe(false);
      if (mode === "viewer")
        expect(text(tree)).toContain("An owner or editor must create or manage follow-up access.");
      if (mode === "flex")
        expect(text(tree)).toContain(
          "No countdown: every participant already has unlimited response time.",
        );
    },
  );
  it("uses localized confirmations, honors cancel, revokes only the chosen link, and clears its receipt", async () => {
    const state = await loaded();
    const created = await createReceipt(state);
    fixtures.locale = "ko-KR";
    const copy = practiceManagementCopy(fixtures.locale);
    fixtures.fetch.mockClear();
    fixtures.confirm.mockReturnValueOnce(false);
    const revokeButtons = nodes(state.render()).filter(
      (node) => node.type === "button" && text(node.props.children as ReactNode) === copy("Revoke"),
    );
    (revokeButtons[1]!.props as ComponentProps<"button">).onClick?.({} as never);
    expect(fixtures.confirm).toHaveBeenLastCalledWith(
      copy("Revoke this private practice link? Its attempt will stop working."),
    );
    expect(fixtures.fetch).not.toHaveBeenCalled();
    fixtures.fetch.mockResolvedValueOnce(undefined);
    (revokeButtons[1]!.props as ComponentProps<"button">).onClick?.({} as never);
    await settle();
    expect(fixtures.fetch).toHaveBeenCalledExactlyOnceWith(
      `/v1/followups/practice-a/access/${created.id}`,
      { method: "DELETE" },
    );
    const tree = state.render();
    state.flushFrames();
    expect(text(tree)).not.toContain(copy("Save this link now"));
    expect(text(tree)).toContain(copy("Private link revoked."));
    expect(text(tree)).toContain(created.label);
    expect(text(tree)).toContain(copy("Revoked"));
    expect(text(tree)).toContain(copy("Active"));
    expect(fixtures.focus).toHaveBeenLastCalledWith("practice-access-heading");
  });
  it("closes for everyone only after confirmation, suppresses duplicate writes, and removes its private receipt", async () => {
    const state = await loaded();
    await createReceipt(state);
    fixtures.locale = "fr-FR";
    const copy = practiceManagementCopy(fixtures.locale);
    fixtures.fetch.mockClear();
    fixtures.confirm.mockReturnValueOnce(false);
    click(state.render(), copy("Close practice for everyone"));
    expect(fixtures.fetch).not.toHaveBeenCalled();
    const pending = deferred<void>();
    fixtures.fetch.mockReturnValueOnce(pending.promise);
    const stale = button(state.render(), copy("Close practice for everyone"));
    stale.onClick?.({} as never);
    stale.onClick?.({} as never);
    expect(fixtures.confirm).toHaveBeenLastCalledWith(
      copy("Close this practice for every participant?"),
    );
    expect(fixtures.fetch).toHaveBeenCalledExactlyOnceWith("/v1/followups/practice-a/close", {
      method: "POST",
      body: "{}",
    });
    pending.resolve();
    await settle();
    const tree = state.render();
    state.flushFrames();
    expect(text(tree)).toContain(copy("Practice closed for every participant."));
    expect(text(tree)).not.toContain(copy("Save this link now"));
    expect(text(tree)).not.toContain(copy("Close practice for everyone"));
    expect(fixtures.focus).toHaveBeenLastCalledWith("practice-summary-heading");
  });
  it.each(["revoke", "close"])(
    "keeps existing access and the private receipt when %s fails",
    async (action) => {
      const state = await loaded();
      const created = await createReceipt(state);
      fixtures.fetch.mockRejectedValueOnce(
        new Error("Your workspace role does not allow this action"),
      );
      click(state.render(), action === "revoke" ? "Revoke" : "Close practice for everyone");
      await settle();
      fixtures.locale = "es-ES";
      const tree = state.render();
      expect(text(tree)).toContain(
        practiceManagementCopy(fixtures.locale)("Your workspace role does not allow this action"),
      );
      expect(field(tree, "latest-practice-link").value).toBe(created.url);
      expect(text(tree)).toContain(practiceManagementCopy(fixtures.locale)("Active"));
      expect(fixtures.shareAssignment).not.toHaveBeenCalled();
    },
  );
  it.each(["revoke", "close"])(
    "ignores a stale %s callback after permission loss before confirmation",
    async (action) => {
      const state = await loaded();
      const stale = button(
        state.render(),
        action === "revoke" ? "Revoke" : "Close practice for everyone",
      );
      fixtures.canEdit = false;
      fixtures.role = "viewer";
      state.render();
      state.flushEffects();
      fixtures.fetch.mockClear();
      stale.onClick?.({} as never);
      expect(fixtures.confirm).not.toHaveBeenCalled();
      expect(fixtures.fetch).not.toHaveBeenCalled();
    },
  );
  it("localizes clipboard failures without sharing and keeps the manual URL available", async () => {
    const state = await loaded();
    const created = await createReceipt(state);
    fixtures.clipboard.mockRejectedValueOnce(new Error("blocked"));
    click(state.render(), "Copy");
    await settle();
    fixtures.locale = "ja-JP";
    expect(text(state.render())).toContain(
      practiceManagementCopy(fixtures.locale)(
        "Copy was blocked. Select and copy the link instead.",
      ),
    );
    expect(field(state.render(), "latest-practice-link").value).toBe(created.url);
    expect(fixtures.shareAssignment).not.toHaveBeenCalled();
  });
  it("suppresses pending clipboard events and feedback after permission loss", async () => {
    const state = await loaded();
    await createReceipt(state);
    const pending = deferred<void>();
    fixtures.clipboard.mockReturnValueOnce(pending.promise);
    click(state.render(), "Copy");
    fixtures.canEdit = false;
    fixtures.role = "viewer";
    state.render();
    state.flushEffects();
    pending.resolve();
    await settle();
    expect(fixtures.shareAssignment).not.toHaveBeenCalled();
    expect(text(state.render())).not.toContain("Link copied.");
    expect(text(state.render())).not.toContain("Save this link now");
  });
  it("records follow-up sharing for a recovery accommodation", async () => {
    const state = await loaded(detail({ purpose: "recovery" }));
    await createReceipt(state, "accommodation");
    click(state.render(), "Copy");
    await settle();
    expect(fixtures.shareFollowup).toHaveBeenCalledOnce();
    expect(fixtures.shareAssignment).not.toHaveBeenCalled();
  });
  it("ignores unmounted action successes and failures", async () => {
    for (const fail of [false, true]) {
      const state = await loaded();
      change(state.render(), "personal-pass-label", "Person");
      const pending = deferred<{ access: PracticeAccess }>();
      fixtures.fetch.mockReturnValueOnce(pending.promise);
      const operation = submit(state.render(), "personal-pass-label");
      state.unmount();
      if (fail) pending.reject(new Error("old failure"));
      else pending.resolve({ access: access({ url: "https://example.test/#token=unmounted" }) });
      await operation;
      expect(fixtures.frames).toHaveLength(0);
    }
  });
});

describe("practice management read and diagnostic states", () => {
  it("offers a localized read retry, then renders empty access without replaying writes", async () => {
    fixtures.locale = "de-DE";
    fixtures.fetch.mockRejectedValueOnce(new Error("Follow-up not found"));
    const state = harness();
    state.render();
    state.flushEffects();
    await settle();
    let tree = state.render();
    expect(text(tree)).toContain("Nachbereitung nicht gefunden");
    const copy = practiceManagementCopy(fixtures.locale);
    fixtures.fetch.mockResolvedValueOnce(detail({ empty: true }));
    click(tree, copy("Retry loading practice"));
    state.render();
    state.flushEffects();
    await settle();
    tree = state.render();
    expect(text(tree)).toContain(copy("No private access links have been created."));
    expect(fixtures.fetch.mock.calls.every((call) => call[1] === undefined)).toBe(true);
  });
  it("keeps unknown diagnostic text exact and marked as English across UI locales", async () => {
    const state = await loaded();
    change(state.render(), "personal-pass-label", "Person");
    const raw = "Follow-up not found — unknown extra {private}";
    fixtures.fetch.mockRejectedValueOnce(new Error(raw));
    await submit(state.render(), "personal-pass-label");
    for (const locale of supportedLocales) {
      fixtures.locale = locale;
      const alert = nodes(state.render()).find((node) => node.props.role === "alert")!;
      expect(text(alert)).toBe(raw);
      expect(alert.props.lang).toBe("en-CA");
    }
  });
  it("relocalizes a known pending write error and keeps entered values for retry", async () => {
    const state = await loaded();
    change(state.render(), "personal-pass-label", "Person — 中文");
    const pending = deferred<{ access: PracticeAccess }>();
    fixtures.fetch.mockReturnValueOnce(pending.promise);
    const operation = submit(state.render(), "personal-pass-label");
    fixtures.locale = "ko-KR";
    state.render();
    state.flushEffects();
    pending.reject(new Error("Practice assignments are available on the Pro plan"));
    await operation;
    const tree = state.render();
    expect(text(tree)).toContain(
      practiceManagementCopy(fixtures.locale)("Practice assignments are available on the Pro plan"),
    );
    expect(field(tree, "personal-pass-label").value).toBe("Person — 中文");
  });
});
