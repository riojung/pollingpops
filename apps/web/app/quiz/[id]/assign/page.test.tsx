import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  hookHarness,
  flushPromises,
} from "../../../../components/canvas-artifact-links/test-support";
import { reportRoundEnglishMessages } from "../../../../lib/i18n/domains/report-round/en-CA";
import { localDateTimeValue } from "../../../../lib/practice-assignment";
import { createdPackPractice } from "../../../../test-utils/recovery-pack-practice";

const fixtures = vi.hoisted(() => ({
  fetch: vi.fn(),
  canEdit: true,
  enabled: true,
  followups: true,
  accountLoading: false,
  signedIn: true,
  id: "round-1",
  userId: "creator-a",
  workspaceId: "workspace-a",
  role: "owner",
}));
vi.mock("react", async (original) => {
  const { hookReact } = await import("../../../../components/canvas-artifact-links/test-support");
  return hookReact(await original<typeof ReactModule>());
});
vi.mock("next/navigation", () => ({ useParams: () => ({ id: fixtures.id }) }));
vi.mock("../../../../components/locale-provider", () => ({
  useLocale: () => ({ locale: "en-CA", t: translate }),
}));
const entitlements = { followups: true, maxPracticePersonalLinks: 2, reportRetentionDays: 30 };
vi.mock("../../../../components/workspace/workspace-provider", () => ({
  WorkspaceProvider: ({ children }: { children: ReactNode }) => children,
  useWorkspace: () => ({
    creator: fixtures.signedIn
      ? { userId: fixtures.userId, workspaceId: fixtures.workspaceId, role: fixtures.role }
      : null,
    loading: fixtures.accountLoading,
    canEdit: fixtures.canEdit,
    productFeatures: { practiceAssignments: fixtures.enabled },
    entitlements: { ...entitlements, followups: fixtures.followups },
    startUpgrade: vi.fn(),
  }),
}));
vi.mock("../../../../components/workspace/workspace-shell", () => ({ WorkspaceShell: "main" }));
vi.mock("../../../../lib/api", () => ({
  apiFetch: fixtures.fetch,
  humanError: (caught: Error) => caught.message,
}));
import AssignPracticePage from "./page";
import { PracticeLinkReceipt } from "../../../../components/practice/practice-link-receipt";

function translate(key: string, values: Record<string, string | number> = {}) {
  const template =
    reportRoundEnglishMessages[key as keyof typeof reportRoundEnglishMessages] ?? key;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => String(values[name] ?? match));
}
function nodes(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  return isValidElement<Record<string, unknown>>(node)
    ? [node, ...nodes(node.props.children as ReactNode)]
    : [];
}
function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return isValidElement<{ children?: ReactNode }>(node) ? text(node.props.children) : "";
}
function field(tree: ReactNode, id: string) {
  return nodes(tree).find((node) => node.props.id === id)!.props;
}
function change(tree: ReactNode, id: string, value: string) {
  (field(tree, id).onChange as (event: unknown) => void)({ target: { value } });
}
function submit(tree: ReactNode) {
  return (
    nodes(tree).find((node) => node.type === "form")!.props.onSubmit as (
      event: unknown,
    ) => Promise<void>
  )({ preventDefault() {} });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const views = new Set<{ unmount(): void }>();
function source({
  published = true,
  questions = [{ id: "main" }, { id: "recheck", delivery: "recheck" }],
  draftTitle = "New draft",
  title = "Published source",
} = {}) {
  const content = { title, questions };
  return {
    quiz: {
      id: fixtures.id,
      status: published ? "published" : "draft",
      title: "Draft title",
      draft: { ...content, title: draftTitle },
      currentVersionId: published ? "version-2" : null,
    },
    currentVersion: published
      ? { id: "version-2", version: 2, content, publishedAt: "2026-11-01T12:00:00Z" }
      : null,
  };
}
function setupView() {
  const child = AssignPracticePage().props.children as ReactElement;
  let active: ReturnType<typeof hookHarness<ReactElement>> | null = null;
  let activeKey: string | null = null;
  const view = {
    render() {
      const controller = (child.type as () => ReactElement<{ id: string }>)();
      if (!active || controller.key !== activeKey) {
        active?.unmount();
        activeKey = controller.key;
        active = hookHarness(() =>
          (controller.type as (props: { id: string }) => ReactElement)(controller.props),
        );
      }
      return active.render();
    },
    unmount() {
      active?.unmount();
      active = null;
      activeKey = null;
    },
  };
  views.add(view);
  return view;
}
async function mount(options: Parameters<typeof source>[0] = {}) {
  fixtures.fetch.mockResolvedValueOnce(source(options));
  const view = setupView();
  view.render();
  await flushPromises();
  view.render();
  return view;
}
beforeEach(() => {
  fixtures.fetch.mockReset();
  fixtures.canEdit = true;
  fixtures.enabled = true;
  fixtures.followups = true;
  fixtures.accountLoading = false;
  fixtures.signedIn = true;
  fixtures.id = "round-1";
  fixtures.userId = "creator-a";
  fixtures.workspaceId = "workspace-a";
  fixtures.role = "owner";
  vi.stubGlobal("window", { requestAnimationFrame: (callback: () => void) => callback() });
});
afterEach(() => {
  for (const view of views) view.unmount();
  views.clear();
  vi.unstubAllGlobals();
});

describe("Round assignment setup", () => {
  it("reviews the published source, main questions, source drift, and browser timezone", async () => {
    const view = await mount();
    const tree = view.render();
    expect(field(tree, "practice-source-heading")).toMatchObject({
      lang: "",
      children: "Published source",
    });
    expect(text(tree)).toContain("1 main question(s)");
    expect(text(tree)).toContain("This Round has newer draft edits");
    expect(text(tree)).toContain("Conditional live rechecks are not repeated");
    expect(text(tree)).toContain(
      `Times shown in ${Intl.DateTimeFormat().resolvedOptions().timeZone}`,
    );
    expect(text(tree)).toContain("Review assignment");
    expect(field(tree, "practice-title").value).toBe("Practice: Published source");
    expect(fixtures.fetch).toHaveBeenCalledTimes(1);
  });
  it("deduplicates labels visibly and enforces the personal-link entitlement before creation", async () => {
    const view = await mount();
    change(view.render(), "practice-personal-labels", " Ada \nLin\nada");
    expect(text(view.render())).toContain("2 of 2 personal links");
    expect(text(view.render())).toContain("Duplicate labels combined: 1.");
    change(view.render(), "practice-personal-labels", "Ada\nLin\nSam");
    const tree = view.render();
    expect(field(tree, "practice-personal-labels")["aria-invalid"]).toBe(true);
    expect(text(tree)).toContain("Add no more than 2 labels.");
    expect(nodes(tree).find((node) => node.props.type === "submit")!.props.disabled).toBe(true);
    await submit(tree);
    expect(fixtures.fetch).toHaveBeenCalledTimes(1);
  });
  it("creates from the frozen version with chosen schedule and unique labels, then renders the shared receipt", async () => {
    const view = await mount();
    change(view.render(), "practice-title", " Private practice ");
    change(view.render(), "practice-personal-labels", "Ada\nada\nLin");
    const later = nodes(view.render()).find(
      (node) => node.props.name === "open-time" && node.props.value === "later",
    )!;
    (later.props.onChange as () => void)();
    const opens = localDateTimeValue(new Date(Date.now() + 2 * 3_600_000));
    const closes = localDateTimeValue(new Date(Date.now() + 3 * 3_600_000));
    change(view.render(), "practice-opens-at", opens);
    change(view.render(), "practice-closes-at", closes);
    const created = createdPackPractice();
    delete created.followup.recoveryPackSource;
    fixtures.fetch.mockResolvedValueOnce(created);
    await submit(view.render());
    expect(fixtures.fetch).toHaveBeenLastCalledWith("/v1/quizzes/round-1/practice-assignments", {
      method: "POST",
      body: JSON.stringify({
        sourceQuizVersionId: "version-2",
        title: "Private practice",
        timeMode: "flex",
        opensAt: new Date(opens).toISOString(),
        closesAt: new Date(closes).toISOString(),
        personalLabels: ["Ada", "Lin"],
      }),
    });
    expect(
      nodes(view.render()).find((node) => node.type === PracticeLinkReceipt)!.props,
    ).toMatchObject({ created, doneHref: "/assignments" });
    expect(nodes(view.render()).some((node) => node.type === "form")).toBe(false);
  });
  it("shows invalid dates next to the fields and disables submission", async () => {
    const view = await mount();
    change(
      view.render(),
      "practice-closes-at",
      localDateTimeValue(new Date(Date.now() - 3_600_000)),
    );
    expect(text(view.render())).toContain("Choose a future close time.");
    expect(field(view.render(), "practice-closes-at")["aria-invalid"]).toBe(true);
    expect(nodes(view.render()).find((node) => node.props.type === "submit")!.props.disabled).toBe(
      true,
    );
  });
  it.each(["draft", "main", "editor", "plan", "feature"])(
    "keeps the %s guard in front of the form",
    async (guard) => {
      if (guard === "editor") fixtures.canEdit = false;
      if (guard === "plan") fixtures.followups = false;
      if (guard === "feature") fixtures.enabled = false;
      const view = await mount({
        published: guard !== "draft",
        ...(guard === "main" ? { questions: [{ id: "conditional", delivery: "recheck" }] } : {}),
      });
      expect(nodes(view.render()).some((node) => node.type === "form")).toBe(false);
      expect(fixtures.fetch).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps source data unavailable until there is an authenticated actor", async () => {
    fixtures.signedIn = false;
    fixtures.accountLoading = true;
    const view = setupView();
    expect(text(view.render())).toContain("Loading the published Round");
    await flushPromises();
    expect(fixtures.fetch).not.toHaveBeenCalled();
    expect(nodes(view.render()).some((node) => node.type === "form")).toBe(false);
  });

  it.each(["workspace", "user", "role", "route"])(
    "discards private labels and ignores stale source responses after a %s change",
    async (scope) => {
      const previous = deferred<ReturnType<typeof source>>();
      fixtures.fetch.mockReturnValueOnce(previous.promise);
      const view = setupView();
      view.render();
      const previousSignal = fixtures.fetch.mock.calls[0]![1].signal as AbortSignal;
      if (scope === "workspace") fixtures.workspaceId = "workspace-b";
      if (scope === "user") fixtures.userId = "creator-b";
      if (scope === "role") fixtures.role = "editor";
      if (scope === "route") fixtures.id = "round-2";
      fixtures.fetch.mockResolvedValueOnce(source({ title: "Current source" }));
      expect(nodes(view.render()).some((node) => node.type === "form")).toBe(false);
      expect(previousSignal.aborted).toBe(true);
      previous.resolve(source({ title: "STALE source" }));
      await flushPromises();
      expect(field(view.render(), "practice-source-heading").children).toBe("Current source");
      expect(text(view.render())).not.toContain("STALE source");
      change(view.render(), "practice-personal-labels", "PRIVATE label");
      fixtures.workspaceId = "workspace-c";
      fixtures.fetch.mockResolvedValueOnce(source({ title: "Another source" }));
      view.render();
      await flushPromises();
      expect(field(view.render(), "practice-personal-labels").value).toBe("");
    },
  );

  it("preserves the form and one-time receipt through a refresh of the same account", async () => {
    const view = await mount();
    change(view.render(), "practice-title", "In-progress title");
    change(view.render(), "practice-personal-labels", "PRIVATE label");
    fixtures.accountLoading = true;
    expect(nodes(view.render()).some((node) => node.type === "form")).toBe(false);
    fixtures.accountLoading = false;
    expect(field(view.render(), "practice-title").value).toBe("In-progress title");
    expect(field(view.render(), "practice-personal-labels").value).toBe("PRIVATE label");
    const pending = deferred<ReturnType<typeof createdPackPractice>>();
    fixtures.fetch.mockReturnValueOnce(pending.promise);
    const request = submit(view.render());
    fixtures.accountLoading = true;
    view.render();
    const created = createdPackPractice();
    pending.resolve(created);
    await request;
    expect(nodes(view.render()).some((node) => node.type === PracticeLinkReceipt)).toBe(false);
    fixtures.accountLoading = false;
    expect(
      nodes(view.render()).find((node) => node.type === PracticeLinkReceipt)!.props.created,
    ).toBe(created);
    expect(fixtures.fetch).toHaveBeenCalledTimes(2);
  });

  it.each(["workspace", "route", "role", "feature", "plan", "unmount"])(
    "rejects a late creation response and retained callbacks after %s changes",
    async (scope) => {
      const view = await mount();
      change(view.render(), "practice-personal-labels", "PRIVATE label");
      const original = view.render();
      const pending = deferred<ReturnType<typeof createdPackPractice>>();
      fixtures.fetch.mockReturnValueOnce(pending.promise);
      const request = submit(original);
      // The synchronous guard prevents a second mutation before React renders the busy state.
      await submit(original);
      expect(fixtures.fetch).toHaveBeenCalledTimes(2);
      if (scope === "workspace") fixtures.workspaceId = "workspace-b";
      if (scope === "route") fixtures.id = "round-2";
      if (scope === "role") {
        fixtures.role = "viewer";
        fixtures.canEdit = false;
      }
      if (scope === "feature") fixtures.enabled = false;
      if (scope === "plan") fixtures.followups = false;
      if (scope === "unmount") view.unmount();
      else {
        if (["workspace", "route", "role"].includes(scope))
          fixtures.fetch.mockResolvedValueOnce(source({ title: "Current source" }));
        view.render();
      }
      const created = createdPackPractice();
      pending.resolve(created);
      await request;
      await flushPromises();
      const requests = fixtures.fetch.mock.calls.length;
      await submit(original);
      expect(fixtures.fetch).toHaveBeenCalledTimes(requests);
      if (scope === "unmount") return;
      expect(nodes(view.render()).some((node) => node.type === PracticeLinkReceipt)).toBe(false);
      // Returning to an earlier permission value must not revive the completed old callback.
      if (scope === "feature") fixtures.enabled = true;
      if (scope === "plan") fixtures.followups = true;
      expect(nodes(view.render()).some((node) => node.type === PracticeLinkReceipt)).toBe(false);
    },
  );

  it.each(["loading", "role", "feature", "plan", "signed_out"])(
    "hides an existing bearer receipt when %s is invalid",
    async (gate) => {
      const view = await mount();
      fixtures.fetch.mockResolvedValueOnce(createdPackPractice());
      await submit(view.render());
      expect(nodes(view.render()).some((node) => node.type === PracticeLinkReceipt)).toBe(true);
      if (gate === "loading") fixtures.accountLoading = true;
      if (gate === "role") {
        fixtures.role = "viewer";
        fixtures.canEdit = false;
        fixtures.fetch.mockResolvedValueOnce(source());
      }
      if (gate === "feature") fixtures.enabled = false;
      if (gate === "plan") fixtures.followups = false;
      if (gate === "signed_out") fixtures.signedIn = false;
      expect(nodes(view.render()).some((node) => node.type === PracticeLinkReceipt)).toBe(false);
      expect(nodes(view.render()).some((node) => node.type === "form")).toBe(false);
    },
  );
});
