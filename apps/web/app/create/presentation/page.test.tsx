import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { englishMessages, translate, type MessageKey } from "../../../lib/i18n/catalog";

const mocked = vi.hoisted(() => ({
  query: "",
  canEdit: true,
  push: vi.fn(),
  request: vi.fn(),
  event: vi.fn(),
  capture: false,
}));
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useState: <T,>(initial: T) => (mocked.capture ? [initial, vi.fn()] : react.useState(initial)),
  };
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocked.push }),
  useSearchParams: () => new URLSearchParams(mocked.query),
}));
vi.mock("../../../components/workspace/workspace-provider", () => ({
  WorkspaceProvider: ({ children }: { children: ReactNode }) => children,
  useWorkspace: () => ({ canEdit: mocked.canEdit }),
}));
vi.mock("../../../components/workspace/workspace-shell", () => ({
  WorkspaceShell: ({ children, title }: { children: ReactNode; title: string }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));
vi.mock("../../../components/authoring-assistant", () => ({
  AuthoringAssistant: () => <div>Source authoring workflow</div>,
}));
vi.mock("../../../components/workspace/presentation-template-gallery", () => ({
  PresentationTemplateGallery: () => <div>Presentation template gallery</div>,
}));
vi.mock("../../../components/workspace/presentation-outline-start", () => ({
  PresentationOutlineStart: () => <div>Outline draft creation workflow</div>,
}));
vi.mock("../../../components/locale-provider", () => ({
  useLocale: () => ({ t: (key: MessageKey) => translate(englishMessages, key) }),
}));
vi.mock("../../../lib/api", () => ({
  apiFetch: mocked.request,
  humanError: (error: Error) => error.message,
}));
vi.mock("../../../components/workspace/product-events", () => ({
  recordCreationEvent: mocked.event,
}));

import CreatePresentationPage from "./page";

beforeEach(() => {
  mocked.query = "";
  mocked.canEdit = true;
  mocked.capture = false;
  vi.clearAllMocks();
});
describe("Presentation creation launcher", () => {
  it("shows blank creation and visual templates before optional assisted starting points", () => {
    const markup = renderToStaticMarkup(<CreatePresentationPage />);
    expect(markup).toContain('href="/create/presentation?start=outline"');
    expect(markup).toContain('aria-label="From outline"');
    expect(markup).toContain('href="/create/presentation?start=source"');
    expect(markup).toContain('href="/create/presentation?start=template"');
    expect(markup).toContain("Start a blank presentation");
    expect(markup).toContain("Presentation template gallery");
    expect(markup.indexOf("Start a blank presentation")).toBeLessThan(
      markup.indexOf("Presentation template gallery"),
    );
    expect(markup.match(/href="\/create\/presentation\?start=source"/g)).toHaveLength(1);
    expect(markup.match(/href="\/create\/presentation\?start=outline"/g)).toHaveLength(1);
    expect(markup).toContain("<summary>");
    expect(markup).not.toContain("Outline draft creation workflow");
    expect(mocked.push).not.toHaveBeenCalled();
    expect(mocked.request).not.toHaveBeenCalled();
    expect(mocked.event).not.toHaveBeenCalled();
  });
  it.each([
    ["outline", "Outline draft creation workflow"],
    ["source", "Source authoring workflow"],
    ["template", "Presentation template gallery"],
  ])("renders only the chosen %s workflow", (start, expected) => {
    mocked.query = `start=${start}`;
    const markup = renderToStaticMarkup(<CreatePresentationPage />);
    expect(markup).toContain(expected);
    for (const other of [
      "Outline draft creation workflow",
      "Source authoring workflow",
      "Presentation template gallery",
    ].filter((value) => value !== expected))
      expect(markup).not.toContain(other);
    expect(markup).not.toContain('aria-label="From outline"');
  });
  it.each([
    "start=unknown",
    "start=outline&start=template",
    "start=outline&start=outline",
    "start=",
  ])("shows starting points for invalid query %s", (query) => {
    mocked.query = query;
    const markup = renderToStaticMarkup(<CreatePresentationPage />);
    expect(markup).toContain('aria-label="From outline"');
    expect(markup).not.toContain("Outline draft creation workflow");
  });
  it("preserves read-only creation protection for direct outline links", () => {
    mocked.query = "start=outline";
    mocked.canEdit = false;
    const markup = renderToStaticMarkup(<CreatePresentationPage />);
    expect(markup).toContain("cannot create a new draft");
    expect(markup).not.toContain("Outline draft creation workflow");
    expect(markup).not.toContain('aria-label="From outline"');
  });

  it("creates the same native blank draft and records creation only after an explicit click", async () => {
    const id = "00000000-0000-4000-8000-000000000021";
    mocked.request.mockResolvedValue({ presentation: { id } });
    const launcher = (CreatePresentationPage().props as { children: ReactElement }).children;
    mocked.capture = true;
    const tree = (launcher.type as () => ReactElement)();
    mocked.capture = false;
    function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
      if (Array.isArray(node)) return node.flatMap(elements);
      if (!isValidElement<Record<string, unknown>>(node)) return [];
      return [node, ...elements(node.props.children as ReactNode)];
    }
    const blank = elements(tree).find((element) => element.type === "button");
    expect(blank).toBeDefined();
    expect(mocked.request).not.toHaveBeenCalled();
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
});
