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
import type { SupportedLocale } from "@openround/contracts";
import type * as ApiModule from "../../lib/api";

interface LibraryHooks {
  cursor: number;
  slots: unknown[];
  effectCursor: number;
  effectSlots?: Array<{ dependencies?: readonly unknown[]; cleanup?: () => void }>;
  effects: Array<() => void>;
}

const fixtures = vi.hoisted(() => ({
  locale: "en-CA" as SupportedLocale,
  enabled: true,
  canEdit: true,
  hooks: null as LibraryHooks | null,
  apiFetch: vi.fn(),
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
      if (!hooks.effectSlots) return;
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

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  apiFetch: fixtures.apiFetch,
}));

vi.mock("../../components/locale-provider", async () => {
  const { englishMessages, translate } = await import("../../lib/i18n/catalog");
  return {
    useLocale: () => ({
      locale: fixtures.locale,
      t: (key: Parameters<typeof translate>[1], values?: Record<string, string | number>) =>
        translate(englishMessages, key, values),
    }),
  };
});

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

vi.mock("../../components/workspace/workspace-provider", () => ({
  WorkspaceProvider: ({ children }: { children: ReactNode }) => children,
  useWorkspace: () => ({
    canEdit: fixtures.canEdit,
    creator: { workspaceId: "workspace" },
    productFeatures: { recoveryPacks: fixtures.enabled },
  }),
}));

vi.mock("../../components/workspace/workspace-shell", () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

import RecoveryPacksPage from "./page";
import { AuthoringAssistant } from "../../components/authoring-assistant";
import { RecoveryPackSourceReviewPanel } from "../../components/recovery-pack-source";
import type { RecoveryPackRecord } from "../../lib/recovery-pack-source";
import { packWorkspaceCopy } from "../../lib/i18n/pack-workspace-copy";
import { sourcePackFixtures } from "../../test-utils/recovery-pack-source";

beforeEach(() => {
  fixtures.locale = "en-CA";
  fixtures.enabled = true;
  fixtures.canEdit = true;
  fixtures.hooks = null;
  fixtures.apiFetch.mockReset();
  vi.unstubAllGlobals();
});

// Render only the library's state and callbacks here; browser regressions exercise
// the real child controls, event propagation, and effect-driven source fencing.
function libraryHarness(pack: RecoveryPackRecord, trackEffects = false) {
  const hooks: LibraryHooks = {
    cursor: 0,
    slots: [[pack]],
    effectCursor: 0,
    effects: [],
    effectSlots: trackEffects ? [] : undefined,
  };
  const workspace = RecoveryPacksPage().props.children as ReactElement<
    Record<string, never>,
    () => ReactElement<Record<string, never>, () => ReactElement>
  >;
  const library = workspace.type();
  const render = () => {
    hooks.cursor = 0;
    hooks.effectCursor = 0;
    fixtures.hooks = hooks;
    try {
      return library.type();
    } finally {
      fixtures.hooks = null;
    }
  };
  button(render(), pack.title).onClick?.(
    {} as Parameters<NonNullable<ComponentProps<"button">["onClick"]>>[0],
  );
  return {
    render,
    hooks,
    flushEffects: () => hooks.effects.splice(0).forEach((effect) => effect()),
    unmount: () => hooks.effectSlots?.forEach((slot) => slot.cleanup?.()),
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
  if (!element) throw new Error("Expected library element");
  return element.props as ComponentProps<T>;
}

function button(tree: ReactNode, name: string): ComponentProps<"button"> {
  const element = elements(tree).find(
    (candidate) =>
      candidate.type === "button" && text(candidate.props.children as ReactNode) === name,
  );
  if (!element) {
    const packButton = elements(tree).find(
      (candidate) =>
        candidate.type === "button" && text(candidate.props.children as ReactNode).startsWith(name),
    );
    if (packButton) return packButton.props as ComponentProps<"button">;
    throw new Error(`Expected button: ${name}`);
  }
  return element.props as ComponentProps<"button">;
}

function changeField(tree: ReactNode, name: string, value: string) {
  const label = elements(tree).find(
    (candidate) =>
      candidate.type === "label" &&
      elements(candidate.props.children as ReactNode).some(
        (child) => child.type === "span" && text(child.props.children as ReactNode) === name,
      ),
  );
  const field =
    label &&
    elements(label.props.children as ReactNode).find((candidate) =>
      ["input", "textarea", "select"].includes(String(candidate.type)),
    );
  if (!field) throw new Error(`Expected field: ${name}`);
  (field.props.onChange as (event: { target: { value: string } }) => void)({ target: { value } });
}

describe("Recovery Pack library capability notice", () => {
  it.each([
    [true, true],
    [true, false],
    [false, true],
  ])("mounts trusted-source creation only when enabled=%s and editable=%s", (enabled, canEdit) => {
    fixtures.enabled = enabled!;
    fixtures.canEdit = canEdit!;
    const markup = renderToStaticMarkup(<RecoveryPacksPage />);
    expect(markup.includes("Draft a Recovery Pack from a trusted source")).toBe(enabled && canEdit);
    expect(markup).toContain("Your Packs");
  });
  it.each([true, false])(
    "keeps insertion, review, and live playback availability accurate with authoring enabled=%s",
    (enabled) => {
      fixtures.enabled = enabled;
      fixtures.canEdit = true;
      const markup = renderToStaticMarkup(<RecoveryPacksPage />);

      expect(markup).toContain(
        "With Pack authoring enabled, insert published Packs into Round or Presentation drafts",
      );
      expect(markup).toContain(
        "review updates against the accepted baseline, local checkpoints, and latest published Pack",
      );
      expect(markup).toContain(
        "References stay frozen until you accept an update; existing published content and sessions are unchanged",
      );
      expect(markup).toContain(
        "Live explanation or worked-example playback is available in eligible new Round or Presentation sessions when enabled for the workspace",
      );
      expect(markup).toContain(
        "The facilitator explicitly selects a card after revealing the Pack diagnostic",
      );
      expect(markup).toContain(
        "Standalone delayed-probe practice is available from a published Pack with a delayed probe",
      );
      expect(markup).toContain(
        "when Pack authoring and practice assignments are enabled and the workspace has Pro follow-ups",
      );
      expect(markup).toContain(
        "Full-sequence practice uses the frozen diagnostic, intervention cards, and linked recheck",
      );
      expect(markup).toContain("without requiring a delayed probe");
      expect(markup).toContain("Delayed recovery trails and Companion insertion are not available");
      expect(markup).not.toContain("not available yet");
      if (!enabled) expect(markup).toContain("Pack authoring is not enabled for this workspace");
    },
  );
});

describe("Recovery Pack review ownership", () => {
  it("keeps selected-Pack checks and saved approval when unrelated source creation controls change", () => {
    const { approvedPack } = sourcePackFixtures();
    const { render } = libraryHarness(approvedPack);
    const review = propsFor(render(), RecoveryPackSourceReviewPanel);
    review.onContentChecked(true);
    review.onCitationsChecked(true);

    const target = propsFor(render(), AuthoringAssistant).recoveryPackTarget!;
    target.onSourceChanged?.();
    changeField(render(), "Source Round", "published-round");
    changeField(render(), "Diagnostic and linked recheck", "diagnostic");

    const currentReview = propsFor(render(), RecoveryPackSourceReviewPanel);
    expect(currentReview.pack).toEqual(approvedPack);
    expect(currentReview.contentChecked).toBe(true);
    expect(currentReview.citationsChecked).toBe(true);
    expect(currentReview.invalidated).toBe(false);
    expect(currentReview.dirty).toBe(false);
    expect(button(render(), "Publish saved draft").disabled).toBe(false);
  });

  it("invalidates selected-Pack approval even if an actual draft edit is reverted", () => {
    const { approvedPack } = sourcePackFixtures();
    const { render } = libraryHarness(approvedPack);
    const review = propsFor(render(), RecoveryPackSourceReviewPanel);
    review.onContentChecked(true);
    review.onCitationsChecked(true);
    const editor = propsFor(render(), "fieldset");
    editor.onChangeCapture?.(
      {} as Parameters<NonNullable<ComponentProps<"fieldset">["onChangeCapture"]>>[0],
    );
    changeField(render(), "Title", "Edited Pack");
    changeField(render(), "Title", approvedPack.title);

    const currentReview = propsFor(render(), RecoveryPackSourceReviewPanel);
    expect(currentReview.dirty).toBe(false);
    expect(currentReview.invalidated).toBe(true);
    expect(currentReview.contentChecked).toBe(false);
    expect(currentReview.citationsChecked).toBe(false);
    expect(button(render(), "Publish saved draft").disabled).toBe(true);
  });

  it("retains an in-flight approval across upload changes and cancels it on a selected-Pack edit", async () => {
    const { pack, approvedPack } = sourcePackFixtures();
    let resolve!: (result: { pack: RecoveryPackRecord }) => void;
    fixtures.apiFetch.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const { render } = libraryHarness(pack);
    const review = propsFor(render(), RecoveryPackSourceReviewPanel);
    review.onContentChecked(true);
    review.onCitationsChecked(true);
    propsFor(render(), RecoveryPackSourceReviewPanel).onApprove();
    expect(fixtures.apiFetch).toHaveBeenCalledTimes(1);
    const signal = fixtures.apiFetch.mock.calls[0]![1].signal as AbortSignal;
    propsFor(render(), AuthoringAssistant).recoveryPackTarget!.onSourceChanged?.();
    expect(signal.aborted).toBe(false);
    expect(propsFor(render(), RecoveryPackSourceReviewPanel).contentChecked).toBe(true);

    propsFor(render(), "fieldset").onChangeCapture?.(
      {} as Parameters<NonNullable<ComponentProps<"fieldset">["onChangeCapture"]>>[0],
    );
    changeField(render(), "Title", "Edit during approval");
    expect(signal.aborted).toBe(true);
    resolve({ pack: approvedPack });
    await vi.waitFor(() => {
      expect(propsFor(render(), RecoveryPackSourceReviewPanel).busy).toBe(false);
    });
    const currentReview = propsFor(render(), RecoveryPackSourceReviewPanel);
    expect(currentReview.pack.sourceReview?.approved).toBe(false);
    expect(currentReview.draft.title).toBe("Edit during approval");
    expect(currentReview.contentChecked).toBe(false);
    expect(currentReview.citationsChecked).toBe(false);
    expect(button(render(), "Publish saved draft").disabled).toBe(true);
  });
});

describe("Pack workspace locale renders", () => {
  it("keeps the mounted editor, approval checks and request effects stable when locale changes", async () => {
    const { approvedPack } = sourcePackFixtures();
    const pack = {
      ...approvedPack,
      title: "Save draft",
      draft: { ...approvedPack.draft, title: "Save draft" },
    };
    fixtures.apiFetch.mockImplementation(async (path: string) => {
      if (path === "/v1/recovery-packs") return { packs: [pack] };
      if (path === "/v1/quizzes") return { quizzes: [] };
      throw new Error(`Unexpected request: ${path}`);
    });
    const harness = libraryHarness(pack, true);
    harness.flushEffects();
    await vi.waitFor(() => expect(fixtures.apiFetch).toHaveBeenCalledTimes(2));
    const review = propsFor(harness.render(), RecoveryPackSourceReviewPanel);
    review.onContentChecked(true);
    review.onCitationsChecked(true);
    changeField(harness.render(), "Title", "Save draft — texte original 한국어");
    const before = propsFor(harness.render(), RecoveryPackSourceReviewPanel);
    fixtures.locale = "ko-KR";
    const korean = harness.render();
    harness.flushEffects();
    expect(button(korean, "초안 저장").disabled).toBe(false);
    const after = propsFor(korean, RecoveryPackSourceReviewPanel);
    expect(after.draft).toEqual(before.draft);
    expect(after.pack).toEqual(before.pack);
    expect(after.contentChecked).toBe(true);
    expect(after.citationsChecked).toBe(true);
    expect(after.locale).toBe("ko-KR");
    expect(propsFor(korean, "input").lang).toBe("");
    expect(propsFor(korean, "input").value).toBe("Save draft — texte original 한국어");
    fixtures.locale = "de-DE";
    const german = harness.render();
    harness.flushEffects();
    expect(button(german, "Entwurf speichern").disabled).toBe(false);
    expect(propsFor(german, RecoveryPackSourceReviewPanel).draft).toEqual(before.draft);
    expect(fixtures.apiFetch).toHaveBeenCalledTimes(2);
    harness.unmount();
  });

  it("reuses the exact pending save body across locale changes and a lost acknowledgement", async () => {
    const { approvedPack } = sourcePackFixtures();
    const harness = libraryHarness(approvedPack);
    const rawTitle = "Save draft — Ne pas traduire {number}";
    changeField(harness.render(), "Title", rawTitle);
    fixtures.apiFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    button(harness.render(), "Save draft").onClick?.({} as never);
    await vi.waitFor(() => expect(button(harness.render(), "Save draft").disabled).toBe(false));
    expect(fixtures.apiFetch).toHaveBeenCalledTimes(1);
    const firstBody = fixtures.apiFetch.mock.calls[0]![1].body;
    fixtures.locale = "ko-KR";
    let current = harness.render();
    const error = elements(current).find((element) => element.props.role === "alert")!;
    expect(text(error)).toBe("연결하지 못했습니다");
    expect(error.props.lang).toBe("ko-KR");
    expect(fixtures.apiFetch).toHaveBeenCalledTimes(1);
    let resolve!: (value: { pack: RecoveryPackRecord }) => void;
    fixtures.apiFetch.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    button(current, "초안 저장").onClick?.({} as never);
    fixtures.locale = "de-DE";
    current = harness.render();
    expect(button(current, "Entwurf speichern").disabled).toBe(true);
    expect(text(current)).toContain("Entwurf wird gespeichert…");
    expect(fixtures.apiFetch).toHaveBeenCalledTimes(2);
    expect(fixtures.apiFetch.mock.calls[1]![1].body).toBe(firstBody);
    expect(JSON.parse(firstBody)).toMatchObject({
      draft: { title: rawTitle },
      expectedRevision: 1,
    });
    expect(JSON.parse(firstBody).mutationId).toBeTruthy();
    resolve({
      pack: {
        ...approvedPack,
        title: rawTitle,
        draft: { ...approvedPack.draft, title: rawTitle },
        draftRevision: 2,
      },
    });
    await vi.waitFor(() =>
      expect(text(harness.render())).toContain(
        "Entwurf gespeichert. Veröffentlichte Versionen bleiben unverändert.",
      ),
    );
    expect(propsFor(harness.render(), "input").value).toBe(rawTitle);
  });

  it("retains unknown diagnostics verbatim with an English language boundary", async () => {
    const { approvedPack } = sourcePackFixtures();
    const harness = libraryHarness(approvedPack);
    changeField(harness.render(), "Title", "Raw authored title");
    const diagnostic = "Draft saved. Published versions are unchanged. Incident abc-123";
    fixtures.apiFetch.mockRejectedValueOnce(new Error(diagnostic));
    button(harness.render(), "Save draft").onClick?.({} as never);
    await vi.waitFor(() => expect(text(harness.render())).toContain(diagnostic));
    fixtures.locale = "ko-KR";
    const alert = elements(harness.render()).find((element) => element.props.role === "alert")!;
    expect(text(alert)).toBe(diagnostic);
    expect(alert.props.lang).toBe("en-CA");
  });

  it("preserves current permission fences and readable authored values in a localized editor", async () => {
    const { approvedPack } = sourcePackFixtures();
    const harness = libraryHarness(approvedPack, true);
    fixtures.apiFetch.mockImplementation(async (path: string) =>
      path === "/v1/recovery-packs" ? { packs: [approvedPack] } : { quizzes: [] },
    );
    harness.flushEffects();
    await Promise.resolve();
    propsFor(harness.render(), RecoveryPackSourceReviewPanel).onContentChecked(true);
    propsFor(harness.render(), RecoveryPackSourceReviewPanel).onCitationsChecked(true);
    fixtures.canEdit = false;
    fixtures.locale = "de-DE";
    harness.render();
    harness.flushEffects();
    const viewer = harness.render();
    expect(text(viewer)).toContain(
      packWorkspaceCopy("de-DE")("Your workspace role can view Packs but cannot modify them."),
    );
    expect(propsFor(viewer, "fieldset").disabled).toBe(true);
    expect(propsFor(viewer, "input").value).toBe(approvedPack.draft.title);
    expect(propsFor(viewer, "input").lang).toBe("");
    expect(button(viewer, "Entwurf speichern").disabled).toBe(true);
    expect(button(viewer, "Gespeicherten Entwurf veröffentlichen").disabled).toBe(true);
    expect(button(viewer, "Gespeicherten Entwurf neu laden").disabled).toBe(false);
    expect(elements(viewer).some((element) => element.type === AuthoringAssistant)).toBe(false);
    const review = propsFor(viewer, RecoveryPackSourceReviewPanel);
    expect(review.canEdit).toBe(false);
    expect(review.contentChecked).toBe(false);
    expect(review.citationsChecked).toBe(false);
    expect(fixtures.apiFetch).toHaveBeenCalledTimes(2);
    harness.unmount();
  });

  it("localizes explicit discard confirmation without losing the unsaved draft on cancellation", () => {
    const { approvedPack } = sourcePackFixtures();
    const harness = libraryHarness(approvedPack);
    const other = { ...approvedPack, id: "other-pack", title: "Different raw Pack" };
    harness.hooks.slots[0] = [approvedPack, other];
    changeField(harness.render(), "Title", "Unsaved authored title");
    const confirm = vi.fn(() => false);
    vi.stubGlobal("window", { confirm });
    fixtures.locale = "ko-KR";
    button(harness.render(), other.title).onClick?.({} as never);
    expect(confirm).toHaveBeenCalledWith("저장하지 않은 팩 변경 사항을 버릴까요?");
    expect(propsFor(harness.render(), "input").value).toBe("Unsaved authored title");
    expect(fixtures.apiFetch).not.toHaveBeenCalled();
  });
});
