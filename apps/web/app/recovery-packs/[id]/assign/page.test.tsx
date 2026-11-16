import { packPracticeTitle } from "../../../../lib/i18n/creation-content";
import {
  isValidElement,
  type ComponentProps,
  type ElementType,
  type ReactElement,
  type ReactNode,
} from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { supportedLocales, type SupportedLocale } from "@openround/contracts";
import type * as RecoveryPackPracticeModule from "../../../../lib/recovery-pack-practice";

interface SetupHooks {
  cursor: number;
  slots: unknown[];
  effectCursor: number;
  effectSlots: Array<{ dependencies?: readonly unknown[]; cleanup?: () => void }>;
  effects: Array<() => void>;
}

const fixtures = vi.hoisted(() => ({
  fetch: vi.fn(),
  random: vi.fn(),
  locale: "en-CA" as SupportedLocale,
  hooks: null as SetupHooks | null,
  canEdit: true,
  enabled: true,
  entitlements: {
    followups: true,
    reportRetentionDays: 30,
    maxPracticePersonalLinks: 2,
    maxParticipants: 100,
  },
  query: "version=10000000-0000-4000-8000-000000000002",
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
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "10000000-0000-4000-8000-000000000001" }),
  useSearchParams: () => new URLSearchParams(fixtures.query),
}));
vi.mock("../../../../components/locale-provider", () => ({
  useLocale: () => ({ locale: fixtures.locale }),
}));
vi.mock("../../../../components/workspace/workspace-provider", () => ({
  WorkspaceProvider: ({ children }: { children: ReactNode }) => children,
  useWorkspace: () => ({
    canEdit: fixtures.canEdit,
    productFeatures: { recoveryPacks: fixtures.enabled, practiceAssignments: fixtures.enabled },
    entitlements: fixtures.entitlements,
  }),
}));
vi.mock("../../../../components/workspace/workspace-shell", () => ({
  WorkspaceShell: ({ children, title }: { children: ReactNode; title: string }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));
vi.mock("../../../../lib/api", () => ({
  apiFetch: fixtures.fetch,
  humanError: (error: Error) => error.message,
}));
vi.mock("../../../../lib/recovery-pack-practice", async (importOriginal) => ({
  ...(await importOriginal<typeof RecoveryPackPracticeModule>()),
  packPracticeAccessSeed: fixtures.random,
}));

import AssignPackPracticePage from "./page";
import { PracticeLinkReceipt } from "../../../../components/practice/practice-link-receipt";
import { PackPracticePreview } from "../../../../components/practice/pack-practice-preview";
import { WorkspaceShell } from "../../../../components/workspace/workspace-shell";
import { packPracticeCopy } from "../../../../lib/i18n/pack-practice-copy";
import {
  packPracticeSetupCopy,
  packPracticeSetupFeedback,
} from "../../../../lib/i18n/pack-practice-setup-copy";
import { formatDateTime, formatNumber } from "../../../../lib/i18n/format";
import { localDateTimeValue } from "../../../../lib/practice-assignment";
import {
  createdPackPractice,
  publishedPracticePack,
} from "../../../../test-utils/recovery-pack-practice";

beforeEach(() => {
  fixtures.query = "version=10000000-0000-4000-8000-000000000002";
  fixtures.locale = "en-CA";
  fixtures.hooks = null;
  fixtures.canEdit = true;
  fixtures.enabled = true;
  fixtures.entitlements.followups = true;
  fixtures.fetch.mockReset();
  fixtures.random.mockReset().mockReturnValue("private-access-seed-must-never-render");
  vi.unstubAllGlobals();
  vi.stubGlobal("window", { requestAnimationFrame: (callback: () => void) => callback() });
});

// Exercise the page's state, effects and callbacks. Shared child UI is covered by its own
// tests; browser regressions cover real controls, focus and event propagation.
function setupHarness() {
  const hooks: SetupHooks = { cursor: 0, slots: [], effectCursor: 0, effectSlots: [], effects: [] };
  const content = AssignPackPracticePage().props.children as ReactElement<
    { packId: string },
    (props: { packId: string }) => ReactElement
  >;
  const render = () => {
    hooks.cursor = 0;
    hooks.effectCursor = 0;
    fixtures.hooks = hooks;
    try {
      return content.type(content.props);
    } finally {
      fixtures.hooks = null;
    }
  };
  return {
    render,
    flushEffects: () => hooks.effects.splice(0).forEach((effect) => effect()),
    unmount: () => hooks.effectSlots.forEach((slot) => slot.cleanup?.()),
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
function propsFor<T extends ElementType>(tree: ReactNode, type: T): ComponentProps<T> {
  const element = elements(tree).find((candidate) => candidate.type === type);
  if (!element) throw new Error(`Expected setup element: ${String(type)}`);
  return element.props as ComponentProps<T>;
}
function field(tree: ReactNode, id: string) {
  const element = elements(tree).find((candidate) => candidate.props.id === `pack-practice-${id}`);
  if (!element) throw new Error(`Expected setup field: ${id}`);
  return element.props as ComponentProps<"input">;
}
function change(tree: ReactNode, id: string, value: string) {
  field(tree, id).onChange?.({ target: { value } } as never);
}
function button(tree: ReactNode, name: string): ComponentProps<"button"> {
  const element = elements(tree).find(
    (candidate) =>
      candidate.type === "button" && text(candidate.props.children as ReactNode) === name,
  );
  if (!element) throw new Error(`Expected setup button: ${name}`);
  return element.props as ComponentProps<"button">;
}
function chooseRadio(tree: ReactNode, group: string, index: number) {
  const input = elements(tree).filter(
    (candidate) => candidate.type === "input" && candidate.props.name === `pack-practice-${group}`,
  )[index]!;
  (input.props as ComponentProps<"input">).onChange?.({} as never);
}
async function loadedHarness(version = publishedPracticePack()) {
  fixtures.fetch.mockImplementation((url: string) => {
    if (url.endsWith(`/versions/${version.id}`)) return Promise.resolve({ version });
    if (url.endsWith(version.packId))
      return Promise.resolve({ pack: { id: version.packId, currentVersionId: version.id } });
    throw new Error(`Unexpected request: ${url}`);
  });
  const harness = setupHarness();
  harness.render();
  harness.flushEffects();
  await vi.waitFor(() =>
    expect(field(harness.render(), "title").value).toContain(version.content.title),
  );
  return harness;
}

describe("Pack practice creation startup", () => {
  it("starts as read-only loading without minting a seed, creating practice, or rendering private credentials", () => {
    const first = renderToStaticMarkup(<AssignPackPracticePage />);
    const second = renderToStaticMarkup(<AssignPackPracticePage />);
    expect(first).toBe(second);
    expect(first).toContain("Loading the published delayed probe");
    expect(first).toContain("only the Pack’s delayed probe");
    expect(first).not.toContain("Create delayed-probe practice");
    expect(first).not.toContain("accessSeed");
    expect(first).not.toContain("#token=");
    expect(fixtures.fetch).not.toHaveBeenCalled();
    expect(fixtures.random).not.toHaveBeenCalled();
  });
  it("selects full sequence from the explicit link without an automatic create or seed", () => {
    fixtures.query += "&mode=full_sequence";
    const markup = renderToStaticMarkup(<AssignPackPracticePage />);
    expect(markup).toContain("Assign full-sequence practice");
    expect(markup).toContain("Loading the frozen published sequence");
    expect(markup).toContain('value="full_sequence" selected=""');
    expect(markup).toContain("all intervention cards in order");
    expect(markup).toContain("does not include the optional delayed probe");
    expect(markup).not.toContain("Create full-sequence practice");
    expect(markup).not.toContain("accessSeed");
    expect(fixtures.fetch).not.toHaveBeenCalled();
    expect(fixtures.random).not.toHaveBeenCalled();
  });
  it.each(supportedLocales)(
    "renders both loading modes in %s without starting a request",
    (locale) => {
      fixtures.locale = locale;
      const copy = packPracticeSetupCopy(locale);
      for (const mode of ["delayed_probe", "full_sequence"]) {
        fixtures.query = `mode=${mode}`;
        const markup = renderToStaticMarkup(<AssignPackPracticePage />);
        expect(markup).toContain(`lang="${locale}"`);
        expect(markup).toContain(
          copy(
            mode === "full_sequence"
              ? "Loading the frozen published sequence…"
              : "Loading the published delayed probe…",
          ),
        );
      }
      expect(fixtures.fetch).not.toHaveBeenCalled();
      expect(fixtures.random).not.toHaveBeenCalled();
    },
  );
});

describe("Pack practice setup locale renders", () => {
  it("preserves populated form values, published source and creation-language defaults across locales", async () => {
    const version = publishedPracticePack();
    version.content.title = "Practice settings — contenu 한국어";
    version.version = 1234;
    const harness = await loadedHarness(version);
    expect(field(harness.render(), "title").value).toBe(`Delayed probe: ${version.content.title}`);
    fixtures.locale = "ko-KR";
    let tree = harness.render();
    expect(field(tree, "title").value).toBe(`Delayed probe: ${version.content.title}`);
    change(tree, "mode", "full_sequence");
    expect(field(harness.render(), "title").value).toBe(
      packPracticeTitle("ko-KR", true, version.content.title),
    );
    const rawTitle = "Create delayed-probe practice — titre 한국어";
    const rawLabels = "  Practice settings\n한국어 라벨\nPractice settings  ";
    change(harness.render(), "title", rawTitle);
    change(harness.render(), "labels", rawLabels);
    chooseRadio(harness.render(), "time", 1);
    chooseRadio(harness.render(), "open", 1);
    const opening = localDateTimeValue(new Date(Date.now() + 2 * 60 * 60_000));
    const closing = localDateTimeValue(new Date(Date.now() + 3 * 60 * 60_000));
    change(harness.render(), "opens", opening);
    change(harness.render(), "closes", closing);
    const fetchCount = fixtures.fetch.mock.calls.length;
    for (const locale of supportedLocales) {
      fixtures.locale = locale;
      tree = harness.render();
      harness.flushEffects();
      expect(field(tree, "title")).toMatchObject({ value: rawTitle, lang: "" });
      expect(field(tree, "labels")).toMatchObject({ value: rawLabels, lang: "" });
      expect(field(tree, "opens").value).toBe(opening);
      expect(field(tree, "closes").value).toBe(closing);
      expect(field(tree, "mode").value).toBe("full_sequence");
      expect(
        elements(tree).find((element) => element.props.id === "pack-practice-source-heading")
          ?.props,
      ).toMatchObject({ children: version.content.title, lang: "" });
      expect(propsFor(tree, WorkspaceShell)).toMatchObject({
        title: packPracticeCopy(locale)("Assign full-sequence practice"),
        translationLevel: "full",
      });
      expect(propsFor(tree, PackPracticePreview)).toMatchObject({
        version,
        mode: "full_sequence",
        locale,
      });
      expect(text(tree)).toContain(packPracticeSetupCopy(locale)("Practice settings"));
      expect(text(tree)).toContain(
        packPracticeSetupCopy(locale)("Published {date}.", {
          date: formatDateTime(locale, version.publishedAt),
        }),
      );
      expect(text(tree)).toContain(
        packPracticeSetupCopy(locale)("Frozen published Recovery Pack · version {version}", {
          version: formatNumber(locale, 1234),
        }),
      );
      expect(fixtures.fetch).toHaveBeenCalledTimes(fetchCount);
      expect(fixtures.random).not.toHaveBeenCalled();
    }
    fixtures.fetch.mockResolvedValueOnce(createdPackPractice());
    await propsFor(harness.render(), "form").onSubmit?.({ preventDefault() {} } as never);
    const body = JSON.parse(fixtures.fetch.mock.calls.at(-1)![1].body as string);
    expect(body).toMatchObject({
      mode: "full_sequence",
      sourcePackVersionId: version.id,
      title: rawTitle,
      timeMode: "timed",
      opensAt: new Date(opening).toISOString(),
      closesAt: new Date(closing).toISOString(),
      personalLabels: ["Practice settings", "한국어 라벨"],
    });
    expect(body).not.toHaveProperty("locale");
    expect(fixtures.random).toHaveBeenCalledTimes(1);
    harness.unmount();
  });

  it("keeps pending settings locked and retries identical private bytes after a locale switch", async () => {
    const harness = await loadedHarness();
    change(harness.render(), "title", "Authored original 한국어");
    change(harness.render(), "labels", "Original learner");
    const dropped = new Error("Creation was accepted but acknowledgement was lost");
    fixtures.fetch.mockRejectedValueOnce(dropped);
    await propsFor(harness.render(), "form").onSubmit?.({ preventDefault() {} } as never);
    const submitted = fixtures.fetch.mock.calls.at(-1)![1].body as string;
    expect(submitted).toContain("private-access-seed-must-never-render");
    const pending =
      "Creation was not acknowledged. Keep this page open and retry the same private request to recover its result. Settings stay locked; no new assignment is created by changing settings.";
    for (const locale of ["ko-KR", "de-DE", "en-CA"] as const) {
      fixtures.locale = locale;
      const tree = harness.render();
      harness.flushEffects();
      expect(text(tree)).toContain(packPracticeSetupCopy(locale)(pending));
      expect(propsFor(tree, "fieldset").disabled).toBe(true);
      expect(propsFor(propsFor(tree, "form").children, "fieldset").disabled).toBe(true);
      expect(field(tree, "title").value).toBe("Authored original 한국어");
      expect(field(tree, "labels").value).toBe("Original learner");
      expect(elements(tree).find((element) => element.props.role === "alert")?.props).toMatchObject(
        { children: dropped.message, lang: "en-CA" },
      );
      expect(text(tree)).not.toContain("private-access-seed");
      expect(text(tree)).not.toContain("#token=");
      expect(fixtures.random).toHaveBeenCalledTimes(1);
      expect(fixtures.fetch).toHaveBeenCalledTimes(3);
    }
    const receipt = createdPackPractice();
    fixtures.fetch.mockResolvedValueOnce(receipt);
    await button(harness.render(), "Retry assignment acknowledgement").onClick?.({} as never);
    await vi.waitFor(() =>
      expect(propsFor(harness.render(), PracticeLinkReceipt)).toMatchObject({
        created: receipt,
        locale: "en-CA",
      }),
    );
    expect(fixtures.fetch.mock.calls.at(-1)![1].body).toBe(submitted);
    expect(fixtures.random).toHaveBeenCalledTimes(1);
    fixtures.locale = "de-DE";
    expect(propsFor(harness.render(), PracticeLinkReceipt)).toMatchObject({
      created: receipt,
      locale: "de-DE",
    });
    harness.unmount();
  });

  it("localizes label validation and date validation at render without changing invalid inputs", async () => {
    const harness = await loadedHarness();
    change(harness.render(), "labels", "A\nB\nC");
    for (const locale of ["ko-KR", "de-DE", "en-CA"] as const) {
      fixtures.locale = locale;
      const tree = harness.render();
      expect(text(tree)).toContain(
        packPracticeSetupFeedback(locale, "Add no more than 2 personal link labels.", {
          labelLimit: 2,
        }).text,
      );
      expect(field(tree, "labels")).toMatchObject({ value: "A\nB\nC", "aria-invalid": true });
      expect(
        button(tree, packPracticeSetupCopy(locale)("Create delayed-probe practice")).disabled,
      ).toBe(true);
    }
    change(harness.render(), "labels", "x".repeat(81));
    fixtures.locale = "ko-KR";
    expect(text(harness.render())).toContain(
      packPracticeSetupCopy(fixtures.locale)(
        "Keep every personal link label to 80 characters or fewer.",
      ),
    );
    change(harness.render(), "labels", "");
    change(harness.render(), "closes", "invalid");
    await propsFor(harness.render(), "form").onSubmit?.({ preventDefault() {} } as never);
    for (const locale of ["ko-KR", "de-DE", "en-CA"] as const) {
      fixtures.locale = locale;
      const tree = harness.render();
      expect(text(tree)).toContain(
        packPracticeSetupCopy(locale)(
          "Choose an opening and later closing time within the practice retention window.",
        ),
      );
      expect(field(tree, "closes").value).toBe("invalid");
    }
    expect(fixtures.fetch).toHaveBeenCalledTimes(2);
    expect(fixtures.random).not.toHaveBeenCalled();
    harness.unmount();
  });

  it.each([
    [
      "An owner or editor must create the practice assignment.",
      () => {
        fixtures.canEdit = false;
      },
    ],
    [
      "New Pack practice assignments are paused for this workspace. Existing practice remains readable.",
      () => {
        fixtures.enabled = false;
      },
    ],
    [
      "Creating Recovery Pack practice assignments requires Pro.",
      () => {
        fixtures.entitlements.followups = false;
      },
    ],
  ] as const)("renders the localized gate: %s", async (reason, configure) => {
    const harness = await loadedHarness();
    configure();
    for (const locale of supportedLocales) {
      fixtures.locale = locale;
      const tree = harness.render();
      expect(text(tree)).toContain(packPracticeCopy(locale)(reason));
      expect(elements(tree).some((element) => element.type === "form")).toBe(false);
    }
    expect(fixtures.random).not.toHaveBeenCalled();
    harness.unmount();
  });

  it.each(["delayed_probe", "full_sequence"] as const)(
    "localizes unpublished source state in %s",
    async (mode) => {
      fixtures.query += `&mode=${mode}`;
      fixtures.fetch.mockResolvedValue({ pack: { currentVersionId: null } });
      const harness = setupHarness();
      harness.render();
      harness.flushEffects();
      await vi.waitFor(() =>
        expect(text(harness.render())).toContain("Publish a Recovery Pack version"),
      );
      for (const locale of supportedLocales) {
        fixtures.locale = locale;
        expect(text(harness.render())).toContain(
          packPracticeCopy(locale)(
            mode === "full_sequence"
              ? "Publish a Recovery Pack version before assigning its sequence."
              : "Publish a Recovery Pack version before assigning its delayed probe.",
          ),
        );
      }
      harness.unmount();
    },
  );

  it("localizes missing probes and restores full-sequence eligibility without changing source", async () => {
    const version = publishedPracticePack(false);
    // Loading intentionally succeeds even when the chosen mode is unavailable.
    fixtures.fetch
      .mockResolvedValueOnce({ pack: { currentVersionId: version.id } })
      .mockResolvedValueOnce({ version });
    const harness = setupHarness();
    harness.render();
    harness.flushEffects();
    await vi.waitFor(() =>
      expect(text(harness.render())).toContain("This published Pack has no delayed probe."),
    );
    fixtures.locale = "ko-KR";
    expect(text(harness.render())).toContain(
      packPracticeCopy(fixtures.locale)(
        "This published Pack has no delayed probe. Its diagnostic and recheck are not substitutes.",
      ),
    );
    change(harness.render(), "mode", "full_sequence");
    expect(field(harness.render(), "title").value).toBe(
      packPracticeTitle("ko-KR", true, version.content.title),
    );
    expect(propsFor(harness.render(), PackPracticePreview).version).toBe(version);
    expect(fixtures.fetch).toHaveBeenCalledTimes(2);
    harness.unmount();
  });

  it.each([
    "The published Pack changed. Refresh the published source and review the selected practice content before creating practice.",
    "Practice settings",
    "The published Pack source does not match. Refresh and review the source again. Service detail remains",
  ])("preserves exact source-load diagnostics while switching locale: %s", async (diagnostic) => {
    fixtures.fetch.mockRejectedValue(new Error(diagnostic));
    const harness = setupHarness();
    harness.render();
    harness.flushEffects();
    await vi.waitFor(() =>
      expect(elements(harness.render()).some((element) => element.props.role === "alert")).toBe(
        true,
      ),
    );
    const count = fixtures.fetch.mock.calls.length;
    for (const locale of ["ko-KR", "de-DE", "en-CA"] as const) {
      fixtures.locale = locale;
      const tree = harness.render();
      harness.flushEffects();
      expect(elements(tree).find((element) => element.props.role === "alert")?.props).toMatchObject(
        {
          children: packPracticeSetupFeedback(locale, diagnostic).text,
          lang: packPracticeSetupFeedback(locale, diagnostic).lang,
        },
      );
      expect(button(tree, packPracticeSetupCopy(locale)("Refresh published Pack"))).toBeDefined();
      expect(fixtures.fetch).toHaveBeenCalledTimes(count);
    }
    expect(fixtures.random).not.toHaveBeenCalled();
    harness.unmount();
  });
});
