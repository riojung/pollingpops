import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { englishMessages, translate, type MessageKey } from "../../../lib/i18n/catalog";
import type { SupportedLocale } from "@openround/contracts";
import authoringEnglish from "../../../lib/i18n/domains/delivery-authoring/en-CA";
import {
  presentationCreationHref,
  type PresentationCreationMethod,
} from "../../../components/workspace/workspace-creation-model";

const mocked = vi.hoisted(() => ({
  query: "",
  canEdit: true,
  feature: true as boolean | null,
  loading: false,
  workspaceError: "",
  creator: { userId: "creator-1", workspaceId: "workspace-1" } as {
    userId: string;
    workspaceId: string;
  } | null,
  sourceEnabled: true,
  push: vi.fn(),
  request: vi.fn(),
  event: vi.fn(),
  capture: false,
  refs: [] as { current: unknown }[],
  refIndex: 0,
  locale: "en-CA" as SupportedLocale,
}));
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useState: <T,>(initial: T) => (mocked.capture ? [initial, vi.fn()] : react.useState(initial)),
    useRef: <T,>(initial: T) => {
      if (!mocked.capture) return react.useRef(initial);
      const index = mocked.refIndex++;
      mocked.refs[index] ??= { current: initial };
      return mocked.refs[index] as { current: T };
    },
  };
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocked.push }),
  useSearchParams: () => new URLSearchParams(mocked.query),
}));
vi.mock("../../../components/workspace/workspace-provider", () => ({
  WorkspaceProvider: ({ children }: { children: ReactNode }) => children,
  useWorkspace: () => ({
    creator: mocked.creator,
    canEdit: mocked.canEdit,
    productFeatures: mocked.feature === null ? null : { presentations: mocked.feature },
    loading: mocked.loading,
    error: mocked.workspaceError,
  }),
}));
vi.mock("../../../components/workspace/workspace-shell", () => ({
  WorkspaceShell: ({
    children,
    title,
    actions,
  }: {
    children: ReactNode;
    title: string;
    actions: ReactNode;
  }) => (
    <main>
      <h1>{title}</h1>
      {actions}
      {children}
    </main>
  ),
}));
vi.mock("../../../components/authoring-assistant", () => ({
  AuthoringAssistant: () => (
    <div>{mocked.sourceEnabled ? "Source authoring workflow" : "Source service disabled"}</div>
  ),
}));
vi.mock("../../../components/workspace/creation-method-details", () => ({
  CreationMethodDetails: ({ method }: { method: string }) => (
    <div data-method={method}>Method details</div>
  ),
}));
vi.mock("../../../components/workspace/presentation-design-gallery", () => ({
  PresentationDesignGallery: () => <div>Presentation design gallery</div>,
}));
vi.mock("../../../components/workspace/presentation-template-gallery", () => ({
  PresentationTemplateGallery: () => <div>Presentation template gallery</div>,
}));
vi.mock("../../../components/workspace/presentation-outline-start", () => ({
  PresentationOutlineStart: () => <div>Outline draft creation workflow</div>,
}));
vi.mock("../../../components/locale-provider", () => ({
  useLocale: () => ({
    locale: mocked.locale,
    t: (key: MessageKey) => translate({ ...englishMessages, ...authoringEnglish }, key),
  }),
}));
vi.mock("../../../lib/api", () => ({
  apiFetch: mocked.request,
  humanError: (error: Error) => error.message,
}));
vi.mock("../../../components/workspace/product-events", () => ({
  recordCreationEvent: mocked.event,
}));

import CreatePresentationPage from "./page";

function select(method: PresentationCreationMethod) {
  mocked.query = presentationCreationHref(method).split("?")[1] ?? "";
}
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function captureLauncher() {
  const launcher = (CreatePresentationPage().props as { children: ReactElement }).children;
  mocked.capture = true;
  mocked.refIndex = 0;
  const tree = (launcher.type as () => ReactElement)();
  mocked.capture = false;
  return tree;
}

beforeEach(() => {
  mocked.query = "";
  mocked.canEdit = true;
  mocked.feature = true;
  mocked.loading = false;
  mocked.workspaceError = "";
  mocked.creator = { userId: "creator-1", workspaceId: "workspace-1" };
  mocked.sourceEnabled = true;
  mocked.capture = false;
  mocked.refs = [];
  mocked.refIndex = 0;
  mocked.locale = "en-CA";
  vi.clearAllMocks();
});

describe("Presentation creation launcher", () => {
  it("offers navigation to every method without creating or duplicating galleries", () => {
    const markup = renderToStaticMarkup(<CreatePresentationPage />);
    for (const method of ["blank", "outline", "source", "template", "design"] as const) {
      expect(markup).toContain(`href="${presentationCreationHref(method)}"`);
    }
    expect(markup).toContain("Start a blank presentation");
    expect(markup).not.toContain("Presentation template gallery");
    expect(markup).not.toContain("Presentation design gallery");
    expect(markup).not.toContain("Source authoring workflow");
    expect(markup).not.toContain("Outline draft creation workflow");
    expect(elements(captureLauncher()).filter((element) => element.type === "button")).toHaveLength(
      0,
    );
    expect(mocked.push).not.toHaveBeenCalled();
    expect(mocked.request).not.toHaveBeenCalled();
    expect(mocked.event).not.toHaveBeenCalled();
  });

  it.each([
    ["blank", "presentationBlank", "Start a blank presentation"],
    ["outline", "presentationOutline", "Outline draft creation workflow"],
    ["source", "presentationSource", "Source authoring workflow"],
    ["template", "presentationTemplate", "Presentation template gallery"],
    ["design", "presentationDesign", "Presentation design gallery"],
  ] as const)("renders only the chosen %s method and its details", (method, details, expected) => {
    select(method);
    const markup = renderToStaticMarkup(<CreatePresentationPage />);
    expect(markup).toContain(expected);
    expect(markup).toContain(`data-method="${details}"`);
    expect(markup).toContain(`href="${presentationCreationHref()}"`);
    for (const other of [
      "Outline draft creation workflow",
      "Source authoring workflow",
      "Presentation template gallery",
      "Presentation design gallery",
    ].filter((value) => value !== expected))
      expect(markup).not.toContain(other);
    expect(mocked.request).not.toHaveBeenCalled();
    expect(mocked.event).not.toHaveBeenCalled();
  });

  it.each(["outline", "source", "template", "design"])(
    "preserves legacy start=%s links",
    (method) => {
      mocked.query = `start=${method}`;
      const markup = renderToStaticMarkup(<CreatePresentationPage />);
      expect(markup).toContain('data-method="presentation');
      expect(mocked.request).not.toHaveBeenCalled();
    },
  );

  it.each([
    "start=unknown",
    "start=outline&start=template",
    "start=outline&start=outline",
    "start=",
  ])("shows a recovery notice and method links for invalid query %s", (query) => {
    mocked.query = query;
    const markup = renderToStaticMarkup(<CreatePresentationPage />);
    expect(markup).toContain('role="status"');
    expect(markup).toContain(`href="${presentationCreationHref()}"`);
    expect(markup).toContain(`href="${presentationCreationHref("outline")}"`);
    expect(markup).not.toContain("Outline draft creation workflow");
    expect(markup).not.toContain("Method details");
    expect(mocked.request).not.toHaveBeenCalled();
  });

  it.each(["blank", "outline", "source", "template", "design"] as const)(
    "hides %s creation for read-only roles",
    (method) => {
      select(method);
      mocked.canEdit = false;
      const markup = renderToStaticMarkup(<CreatePresentationPage />);
      expect(markup).toContain("cannot create a new draft");
      expect(markup).not.toContain("Method details");
      expect(
        elements(captureLauncher()).filter((element) => element.type === "button"),
      ).toHaveLength(0);
      expect(mocked.request).not.toHaveBeenCalled();
    },
  );

  it.each(["disabled", "unresolved", "loading", "identity", "error"] as const)(
    "does not expose methods or POST with %s authority",
    (condition) => {
      if (condition === "disabled") mocked.feature = false;
      if (condition === "unresolved") mocked.feature = null;
      if (condition === "loading") mocked.loading = true;
      if (condition === "identity") mocked.creator = null;
      if (condition === "error") mocked.workspaceError = "Access failed";
      for (const method of ["blank", "outline", "source", "template", "design"] as const) {
        select(method);
        expect(renderToStaticMarkup(<CreatePresentationPage />)).not.toContain("Method details");
        expect(
          elements(captureLauncher()).filter((element) => element.type === "button"),
        ).toHaveLength(0);
      }
      expect(mocked.request).not.toHaveBeenCalled();
      expect(mocked.event).not.toHaveBeenCalled();
    },
  );

  it("creates one native blank draft only after the selected method's explicit click", async () => {
    select("blank");
    const id = "00000000-0000-4000-8000-000000000021";
    mocked.request.mockResolvedValue({ presentation: { id } });
    const blank = elements(captureLauncher()).find((element) => element.type === "button");
    expect(blank).toBeDefined();
    expect(mocked.request).not.toHaveBeenCalled();
    (blank!.props.onClick as () => void)();
    (blank!.props.onClick as () => void)();
    for (let index = 0; index < 8; index++) await Promise.resolve();
    expect(mocked.request).toHaveBeenCalledExactlyOnceWith("/v1/presentations", {
      method: "POST",
      body: JSON.stringify({
        title: "Untitled presentation",
        description: "",
        initialSlide: "native",
      }),
    });
    expect(mocked.event.mock.calls).toEqual([
      ["creation_started", "blank", "presentation"],
      ["creation_completed", "blank", "presentation"],
    ]);
    expect(mocked.push).toHaveBeenCalledExactlyOnceWith(`/presentation/${id}`);
  });

  it("rechecks authority before an earlier rendered button can create", () => {
    select("blank");
    const button = elements(captureLauncher()).find((element) => element.type === "button")!;
    mocked.feature = false;
    captureLauncher();
    (button.props.onClick as () => void)();
    expect(mocked.request).not.toHaveBeenCalled();
    expect(mocked.event).not.toHaveBeenCalled();
  });

  it("keeps blank, templates, and outline available independently of the source service", () => {
    mocked.sourceEnabled = false;
    for (const [method, expected] of [
      ["blank", "presentationBlank"],
      ["template", "Presentation template gallery"],
      ["outline", "Outline draft creation workflow"],
    ] as const) {
      select(method);
      const markup = renderToStaticMarkup(<CreatePresentationPage />);
      expect(markup).toContain(expected);
      expect(markup).not.toContain("Source service disabled");
    }
    expect(mocked.request).not.toHaveBeenCalled();
  });

  it("shows localized source-layout boundaries and optional outline labels", () => {
    mocked.locale = "ko-KR";
    const markup = renderToStaticMarkup(<CreatePresentationPage />);
    expect(markup).toContain("원본 슬라이드 레이아웃은 유지되지 않습니다");
    expect(markup).toContain('aria-label="개요에서 시작"');
    expect(markup).toContain("작업은 비공개 초안으로 시작됩니다");
    expect(markup).not.toContain("Original slide layouts");
    expect(markup).not.toContain('lang="en-CA"');
  });
});
