import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CheckpointSetImportUnavailableReason, SupportedLocale } from "@openround/contracts";
import { AUTH_CHANGE_EVENT } from "../lib/api";
import { englishMessages, translate, type MessageKey } from "../lib/i18n/catalog";
import englishAuthoring from "../lib/i18n/domains/delivery-authoring/en-CA";
import englishReportRound from "../lib/i18n/domains/report-round/en-CA";
import { importPreviewCopy } from "../lib/i18n/import-preview-copy";

interface Hooks {
  cursor: number;
  slots: unknown[];
  effects: Array<() => void>;
  cleanups: Map<number, () => void>;
}
const mocked = vi.hoisted(() => ({
  hooks: null as Hooks | null,
  fetch: vi.fn(),
  created: vi.fn(),
  authoring: vi.fn(),
  locale: "en-CA" as SupportedLocale,
}));
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useId: () => "structured-import",
    useState: <T,>(initial: T | (() => T)) => {
      const hooks = mocked.hooks;
      if (!hooks) return react.useState(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.slots))
        hooks.slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
      return [
        hooks.slots[index] as T,
        (next: T | ((old: T) => T)) => {
          hooks.slots[index] =
            typeof next === "function" ? (next as (old: T) => T)(hooks.slots[index] as T) : next;
        },
      ];
    },
    useRef: <T,>(initial: T) => {
      const hooks = mocked.hooks;
      if (!hooks) return react.useRef(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
      return hooks.slots[index];
    },
    useEffect: (effect: ReactModule.EffectCallback, dependencies: ReactModule.DependencyList) => {
      const hooks = mocked.hooks;
      if (!hooks) return react.useEffect(effect, dependencies);
      const index = hooks.cursor++;
      const old = hooks.slots[index] as ReactModule.DependencyList | undefined;
      if (!old || dependencies.some((value, i) => !Object.is(value, old[i]))) {
        hooks.slots[index] = dependencies;
        hooks.effects.push(() => {
          hooks.cleanups.get(index)?.();
          const cleanup = effect();
          if (cleanup) hooks.cleanups.set(index, cleanup);
        });
      }
    },
  };
});
vi.mock("./locale-provider", () => ({
  useLocale: () => ({
    locale: mocked.locale,
    t: (key: MessageKey, values?: Record<string, string | number>) =>
      translate({ ...englishMessages, ...englishAuthoring, ...englishReportRound }, key, values),
  }),
}));
vi.mock("./workspace/product-events", () => ({
  recordCreationEvent: mocked.created,
  recordAuthoringEvent: mocked.authoring,
}));

import { CheckpointSetImport } from "./checkpoint-set-import";

const actor = {
  actorId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000002",
};
const quiz = { id: "00000000-0000-4000-8000-000000000003", title: "Native title <원문>" };
const question = {
  id: "00000000-0000-4000-8000-000000000004",
  type: "single_select",
  prompt: "Source question <script>",
  timeLimitSeconds: 35,
  basePoints: 800,
  explanation: "Source explanation <em>",
  mediaId: null,
  mediaAlt: null,
  choices: [
    { id: "00000000-0000-4000-8000-000000000005", label: "Correct <answer>", isCorrect: true },
    { id: "00000000-0000-4000-8000-000000000006", label: "Other answer", isCorrect: false },
  ],
};
function previewResult() {
  return {
    draft: { title: quiz.title, description: "Description", questions: [question] },
    validation: {
      format: "openround_json",
      importedCheckpoints: 1,
      errors: [],
      warnings: [
        {
          severity: "warning",
          code: "media",
          message: "External image removed",
          row: 2,
          field: "mediaId",
        },
      ],
    },
    creationContext: actor,
    previewFingerprint: "a".repeat(64),
    sourceDigest: "b".repeat(64),
  };
}
function gatedPreviewResult() {
  return {
    ...previewResult(),
    draft: null,
    previewFingerprint: "c".repeat(64),
    validation: {
      format: "openround_json",
      importedCheckpoints: 0,
      errors: [
        {
          severity: "error",
          code: "ROUND_RESPONSE_UNAVAILABLE",
          message: "Extended response questions are unavailable in this workspace.",
        },
      ],
      warnings: [],
    },
  };
}
function response(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
const cleanups: Array<() => void> = [];
function harness(terminology: "round" | "legacy" = "round") {
  const hooks: Hooks = { cursor: 0, slots: [], effects: [], cleanups: new Map() };
  let tree: ReactNode;
  const props = {
    enabled: true,
    unavailableReason: undefined as CheckpointSetImportUnavailableReason | null | undefined,
    authority: { ...actor, role: "owner", canEdit: true, featureKey: "all" },
    onImported: vi.fn(async () => undefined),
    trackCreation: true,
    terminology,
  };
  function render() {
    hooks.cursor = 0;
    mocked.hooks = hooks;
    try {
      tree = CheckpointSetImport(props);
    } finally {
      mocked.hooks = null;
    }
    hooks.effects.splice(0).forEach((effect) => effect());
    return renderToStaticMarkup(tree);
  }
  function find(predicate: (node: ReactElement<Record<string, unknown>>) => boolean) {
    const found = elements(tree).find(predicate);
    if (!found) throw new Error("Expected import control");
    return found;
  }
  const unmount = () => hooks.cleanups.forEach((cleanup) => cleanup());
  cleanups.push(unmount);
  return {
    props,
    render,
    unmount,
    all: () => elements(tree),
    setSource: (value: string) => {
      (find((node) => node.type === "textarea").props.onChange as (event: unknown) => void)({
        target: { value },
      });
    },
    setTitle: (value: string) => {
      (
        find((node) => node.type === "input" && node.props.maxLength === 160).props.onChange as (
          event: unknown,
        ) => void
      )({ target: { value } });
    },
    selectFormat: (value: string) => {
      (find((node) => node.type === "select").props.onChange as (event: unknown) => void)({
        target: { value },
      });
    },
    submit: () => {
      (find((node) => node.type === "form").props.onSubmit as (event: unknown) => void)({
        preventDefault: vi.fn(),
      });
    },
    click: (name: string) => {
      (
        find((node) => node.type === "button" && node.props.children === name).props
          .onClick as () => void
      )();
    },
  };
}
async function settle() {
  for (let i = 0; i < 16; i++) await Promise.resolve();
}
const recoveredSource = "same extended-response source";
const recoveredTitle = "Original import title";
async function lostAcknowledgement() {
  const first = harness();
  first.render();
  first.render();
  first.setSource(recoveredSource);
  first.setTitle(recoveredTitle);
  first.render();
  first.submit();
  await settle();
  first.render();
  mocked.fetch.mockRejectedValueOnce(new TypeError("Connection lost after commit"));
  first.click("Create draft");
  await settle();
  first.render();
  const originalBody = mocked.fetch.mock.calls[1]![1].body;
  first.unmount();
  return originalBody;
}
async function gatedRecovery(result = gatedPreviewResult()) {
  const originalBody = await lostAcknowledgement();
  mocked.fetch.mockResolvedValueOnce(response(result));
  const view = harness();
  view.render();
  view.render();
  view.setSource(recoveredSource);
  view.setTitle(recoveredTitle);
  view.render();
  view.submit();
  await settle();
  return { view, originalBody, markup: view.render() };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocked.locale = "en-CA";
  const values = new Map<string, string>();
  const target = new EventTarget();
  Object.assign(target, {
    sessionStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  vi.stubGlobal("window", target);
  vi.stubGlobal("fetch", mocked.fetch);
  mocked.fetch.mockImplementation(async (url: string) =>
    url.endsWith("/preview") ? response(previewResult()) : response({ quiz, replayed: false }),
  );
});
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  mocked.hooks = null;
  vi.unstubAllGlobals();
});

describe("structured import review UI", () => {
  it.each([
    ["round", "plan_limit", "reportRound.import.planLimit"],
    ["legacy", "operator_policy", "reportRound.import.operatorPolicy"],
    ["round", undefined, "reportRound.import.unavailable"],
    ["legacy", null, "reportRound.import.unavailable"],
  ] as const)(
    "explains denied workspace import access in the %s panel with reason %s",
    (terminology, reason, message) => {
      const view = harness(terminology);
      view.props.enabled = false;
      view.props.unavailableReason = reason;
      const markup = view.render();
      expect(markup).toContain(
        renderToStaticMarkup(
          <p className="notice" role="status">
            {englishReportRound[message]}
          </p>,
        ),
      );
      expect(markup).not.toMatch(/Hosted Pro|Explore Pro|<form/);
      expect(mocked.fetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["preview", "plan_limit", actor, "reportRound.import.planLimit"],
    ["confirm", "operator_policy", actor, "reportRound.import.operatorPolicy"],
    ["preview", undefined, undefined, "reportRound.import.unavailable"],
    ["confirm", "future_reason", actor, "reportRound.import.unavailable"],
    ["confirm", ["operator_policy"], actor, "reportRound.import.unavailable"],
    ["preview", "operator_policy", undefined, "reportRound.import.unavailable"],
    [
      "preview",
      "operator_policy",
      { ...actor, workspaceId: quiz.id },
      "reportRound.import.unavailable",
    ],
    [
      "confirm",
      "operator_policy",
      { ...actor, actorId: quiz.id },
      "reportRound.import.unavailable",
    ],
    [
      "preview",
      "operator_policy",
      { workspaceId: actor.workspaceId },
      "reportRound.import.unavailable",
    ],
  ] as const)(
    "uses scoped feedback for a denied %s with reason %j and context %j",
    async (action, reason, creationContext, message) => {
      const denied = response(
        {
          error: {
            code: "ENTITLEMENT_LIMIT",
            message: "A Pro plan is required",
            ...(reason !== undefined
              ? { details: { unavailableReason: reason, creationContext } }
              : {}),
          },
        },
        402,
      );
      const view = harness();
      view.props.unavailableReason = "plan_limit";
      view.render();
      view.render();
      view.setSource("Private test source");
      view.render();
      if (action === "preview") mocked.fetch.mockResolvedValueOnce(denied);
      view.submit();
      await settle();
      view.render();
      if (action === "confirm") {
        mocked.fetch.mockResolvedValueOnce(denied);
        view.click("Create draft");
        await settle();
      }
      const markup = view.render();
      expect(markup).toContain(
        renderToStaticMarkup(
          <div className="error" role="alert">
            <p>{englishReportRound[message]}</p>
          </div>,
        ),
      );
      expect(markup).not.toContain("A Pro plan is required");
      expect(markup).not.toContain(importPreviewCopy().previewExpired);
      expect(markup).not.toContain("data-import-preview");
      expect(mocked.fetch).toHaveBeenCalledTimes(action === "preview" ? 1 : 2);
      expect(view.props.onImported).not.toHaveBeenCalled();
    },
  );

  it("renders without a WorkspaceProvider and creates only after reviewing parsed content", async () => {
    const view = harness();
    view.render();
    expect(view.render()).toContain("Preview import");
    expect(mocked.fetch).not.toHaveBeenCalled();
    view.setSource("private source body");
    view.render();
    view.submit();
    await settle();
    const markup = view.render();
    expect(mocked.fetch).toHaveBeenCalledOnce();
    expect(mocked.fetch.mock.calls[0]![0]).toContain("/v1/quizzes/import/preview");
    expect(markup).toContain("No draft has been created");
    expect(markup).toContain("Source question &lt;script&gt;");
    expect(markup).toContain("Correct &lt;answer&gt;");
    expect(markup).toContain("Correct answer");
    expect(markup).toContain("Source explanation &lt;em&gt;");
    expect(markup).toContain("Points: 800");
    expect(markup).toContain("Time limit: 35 seconds");
    expect(markup).toContain('lang="en-CA">External image removed');
    expect(markup).toContain('lang="en-CA">mediaId:');
    expect(markup).toContain("row 2");
    expect(markup).toContain('data-import-preview="true"');
    expect(markup).toContain('data-import-question-index="0"');
    expect(markup).toContain('lang="">Native title');
    expect(mocked.created).not.toHaveBeenCalled();
    view.click("Create draft");
    await settle();
    view.render();
    expect(mocked.fetch.mock.calls[1]![0]).toContain("/v1/quizzes/import/confirm");
    expect(view.props.onImported).toHaveBeenCalledWith(quiz);
    expect(mocked.created.mock.calls).toEqual([
      ["creation_started", "import", "round"],
      ["creation_completed", "import", "round"],
    ]);
    expect(mocked.authoring).toHaveBeenCalledWith("first_block_created", "round");
  });

  it.each(["title", "source", "format"])(
    "removes the create action when the %s changes",
    async (field) => {
      const view = harness();
      view.render();
      view.render();
      view.setSource("source");
      view.render();
      view.submit();
      await settle();
      view.render();
      if (field === "title") view.setTitle("Updated title");
      else if (field === "format") view.selectFormat("csv");
      else view.setSource("Changed source");
      expect(view.render()).not.toContain("data-import-preview");
      expect(
        view.all().some((node) => node.type === "button" && node.props.children === "Create draft"),
      ).toBe(false);
    },
  );

  it("shows validation failures with row and field details and keeps create unavailable", async () => {
    const invalid = previewResult();
    mocked.fetch.mockResolvedValueOnce(
      response({
        ...invalid,
        draft: null,
        validation: {
          ...invalid.validation,
          errors: [
            {
              severity: "error",
              code: "answer",
              message: "A correct answer is required",
              row: 4,
              field: "choices",
            },
          ],
        },
      }),
    );
    const view = harness();
    view.render();
    view.render();
    view.setSource("bad source");
    view.render();
    view.submit();
    await settle();
    const markup = view.render();
    expect(markup).toContain("Fix the errors below");
    expect(markup).toContain("row 4");
    expect(markup).toContain('lang="en-CA">choices:');
    expect(markup).not.toContain("data-import-preview");
  });

  it.each(["actor", "workspace", "role", "feature", "enabled"])(
    "fences completion after %s authority changes",
    async (field) => {
      let resolve!: (value: unknown) => void;
      mocked.fetch.mockReturnValueOnce(
        new Promise((yes) => {
          resolve = yes;
        }),
      );
      const view = harness();
      view.render();
      view.render();
      view.setSource("private old actor");
      view.render();
      view.submit();
      if (field === "actor") view.props.authority.actorId = quiz.id;
      else if (field === "workspace") view.props.authority.workspaceId = quiz.id;
      else if (field === "role") {
        view.props.authority.role = "viewer";
        view.props.authority.canEdit = false;
      } else if (field === "feature") view.props.authority.featureKey = "changed";
      else view.props.enabled = false;
      const markup = view.render();
      expect(markup).not.toContain("private old actor");
      resolve(response(previewResult()));
      await settle();
      expect(view.render()).not.toContain("data-import-preview");
      expect(view.props.onImported).not.toHaveBeenCalled();
    },
  );

  it("clears sensitive review on authentication change and ignores late creation", async () => {
    const view = harness();
    view.render();
    view.render();
    view.setSource("private source");
    view.render();
    view.submit();
    await settle();
    view.render();
    let resolve!: (value: unknown) => void;
    mocked.fetch.mockReturnValueOnce(
      new Promise((yes) => {
        resolve = yes;
      }),
    );
    view.click("Create draft");
    window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
    expect(view.render()).toContain("Your sign-in changed");
    resolve(response({ quiz }));
    await settle();
    const markup = view.render();
    expect(markup).not.toContain("private source");
    expect(markup).not.toContain("Source question");
    expect(view.props.onImported).not.toHaveBeenCalled();
    expect(mocked.created).not.toHaveBeenCalledWith("creation_completed", "import", "round");
  });

  it("relocalizes helper copy without replacing imported text or the confirm request", async () => {
    const view = harness();
    view.render();
    view.render();
    view.setSource("원문 source");
    view.render();
    view.submit();
    await settle();
    view.render();
    mocked.locale = "ko-KR";
    const markup = view.render();
    expect(markup).toContain(importPreviewCopy("ko-KR").previewTitle);
    expect(markup).toContain('lang="">Native title &lt;원문&gt;');
    expect(markup).toContain('lang="en-CA">External image removed');
    expect(mocked.fetch).toHaveBeenCalledOnce();
    view.click(importPreviewCopy("ko-KR").create);
    await settle();
    expect(JSON.parse(mocked.fetch.mock.calls[1]![1].body).data).toBe("원문 source");
  });

  it("offers retry opening a known created draft without sending a second confirm", async () => {
    const view = harness();
    view.props.onImported.mockRejectedValueOnce(new Error("Refresh failed"));
    view.render();
    view.render();
    view.setSource("source");
    view.render();
    view.submit();
    await settle();
    view.render();
    view.click("Create draft");
    await settle();
    expect(view.render()).toContain("The draft was created, but it could not be opened");
    view.click("Open created draft");
    await settle();
    view.render();
    expect(mocked.fetch).toHaveBeenCalledTimes(2);
    expect(view.props.onImported).toHaveBeenCalledTimes(2);
  });

  it("never claims no draft exists during creation, after lost acknowledgement, or after recovering that intent", async () => {
    const first = harness();
    first.render();
    first.render();
    first.setSource("same private source");
    first.render();
    first.submit();
    await settle();
    expect(first.render()).toContain("No draft has been created");
    let reject!: (error: unknown) => void;
    mocked.fetch.mockReturnValueOnce(
      new Promise((_resolve, no) => {
        reject = no;
      }),
    );
    first.click("Create draft");
    expect(first.render()).not.toContain("No draft has been created");
    reject(new TypeError("Connection lost"));
    await settle();
    expect(first.render()).not.toContain("No draft has been created");
    expect(first.render()).toContain("Retry same creation");
    first.unmount();
    const recovered = harness();
    recovered.render();
    recovered.render();
    recovered.setSource("same private source");
    recovered.render();
    recovered.submit();
    await settle();
    const markup = recovered.render();
    expect(markup).toContain("Retry same creation");
    expect(markup).not.toContain("No draft has been created");
  });

  it("recovers a saved confirmation after a feature rollback returns a null draft and gating errors", async () => {
    const { view, originalBody, markup } = await gatedRecovery();
    expect(markup).toContain("Extended response questions are unavailable");
    expect(markup).toContain("Retry same creation");
    expect(markup).toContain("data-import-recovery");
    expect(markup).not.toContain("data-import-preview");
    expect(markup).not.toContain("No draft has been created");
    expect(
      view.all().some((node) => node.type === "button" && node.props.children === "Create draft"),
    ).toBe(false);
    expect(mocked.fetch).toHaveBeenCalledTimes(3);
    view.click("Retry same creation");
    await settle();
    view.render();
    expect(mocked.fetch.mock.calls[3]![1].body).toBe(originalBody);
    expect(view.props.onImported).toHaveBeenCalledWith(quiz);
    expect(mocked.fetch).toHaveBeenCalledTimes(4);
  });

  it("does not offer creation or confirmation recovery for an unmatched null draft", async () => {
    mocked.fetch.mockResolvedValueOnce(response(gatedPreviewResult()));
    const view = harness();
    view.render();
    view.render();
    view.setSource(recoveredSource);
    view.render();
    view.submit();
    await settle();
    const markup = view.render();
    expect(markup).toContain("Extended response questions are unavailable");
    expect(markup).not.toContain("data-import-recovery");
    expect(
      view
        .all()
        .some(
          (node) =>
            node.type === "button" &&
            ["Create draft", "Retry same creation"].includes(String(node.props.children)),
        ),
    ).toBe(false);
    expect(mocked.fetch).toHaveBeenCalledOnce();
  });

  it.each(["actorId", "workspaceId"] as const)(
    "does not recover a null draft returned for another %s",
    async (field) => {
      const blocked = { ...gatedPreviewResult(), creationContext: { ...actor, [field]: quiz.id } };
      const { view, markup } = await gatedRecovery(blocked);
      expect(markup).not.toContain("data-import-recovery");
      expect(
        view
          .all()
          .some((node) => node.type === "button" && node.props.children === "Retry same creation"),
      ).toBe(false);
      expect(mocked.fetch).toHaveBeenCalledTimes(3);
    },
  );

  it("blocks null-draft recovery on receipt storage failure and retries only the saved confirmation", async () => {
    const { view, originalBody } = await gatedRecovery();
    vi.spyOn(window.sessionStorage, "setItem").mockImplementationOnce(() => {
      throw new Error("Storage denied");
    });
    view.click("Retry same creation");
    await settle();
    const markup = view.render();
    expect(markup).toContain(importPreviewCopy().recoveryError);
    expect(mocked.fetch).toHaveBeenCalledTimes(3);
    const retry = view
      .all()
      .find((node) => node.type === "button" && node.props.children === "Retry same creation");
    expect(retry?.props.disabled).toBe(true);
    view.click("Retry confirmation recovery");
    view.render();
    view.click("Retry same creation");
    await settle();
    view.render();
    expect(mocked.fetch.mock.calls[3]![1].body).toBe(originalBody);
    expect(view.props.onImported).toHaveBeenCalledWith(quiz);
  });

  it.each(["source", "title", "format"])(
    "removes null-draft recovery when the %s changes",
    async (field) => {
      const { view } = await gatedRecovery();
      if (field === "source") view.setSource("different source");
      else if (field === "title") view.setTitle("Different title");
      else view.selectFormat("csv");
      const markup = view.render();
      expect(markup).not.toContain("data-import-recovery");
      expect(
        view
          .all()
          .some((node) => node.type === "button" && node.props.children === "Retry same creation"),
      ).toBe(false);
      expect(mocked.fetch).toHaveBeenCalledTimes(3);
    },
  );

  it.each(["actor", "workspace", "auth"])(
    "removes null-draft recovery when %s authority changes",
    async (change) => {
      const { view } = await gatedRecovery();
      if (change === "actor") view.props.authority.actorId = quiz.id;
      else if (change === "workspace") view.props.authority.workspaceId = quiz.id;
      else window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
      const markup = view.render();
      expect(markup).not.toContain("data-import-recovery");
      expect(markup).not.toContain(recoveredSource);
      expect(
        view
          .all()
          .some((node) => node.type === "button" && node.props.children === "Retry same creation"),
      ).toBe(false);
      expect(mocked.fetch).toHaveBeenCalledTimes(3);
    },
  );

  it.each(["IMPORT_TARGET_UNAVAILABLE", "IDEMPOTENCY_CONFLICT", "network"])(
    "offers import-another only for a known unavailable target after %s",
    async (code) => {
      const view = harness();
      view.render();
      view.render();
      view.setSource("private old source");
      view.render();
      view.submit();
      await settle();
      view.render();
      if (code === "network")
        mocked.fetch.mockRejectedValueOnce(new TypeError("Lost acknowledgement"));
      else
        mocked.fetch.mockResolvedValueOnce(
          response({ error: { code, message: "The original target is unavailable." } }, 409),
        );
      view.click("Create draft");
      await settle();
      const markup = view.render();
      expect(mocked.fetch).toHaveBeenCalledTimes(2);
      if (code === "IMPORT_TARGET_UNAVAILABLE") {
        expect(markup).toContain("Import another source");
        view.click("Import another source");
        const reset = view.render();
        expect(reset).not.toContain("data-import-preview");
        expect(reset).not.toContain("private old source");
        expect(reset).toContain("Preview import");
        expect(mocked.fetch).toHaveBeenCalledTimes(2);
      } else expect(markup).not.toContain("Import another source");
    },
  );
});
