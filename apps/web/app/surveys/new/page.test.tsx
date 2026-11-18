import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupportedLocale } from "@openround/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  surveyCreationHref,
  type SurveyCreationMethod,
} from "../../../components/workspace/workspace-creation-model";
import { creationMethodCopy } from "../../../lib/i18n/creation-method-copy";

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
  locale: "en-CA" as SupportedLocale,
  capture: false,
  refs: [] as { current: unknown }[],
  refIndex: 0,
  push: vi.fn(),
  request: vi.fn(),
  mutationKey: vi.fn(),
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
vi.mock("../../../components/locale-provider", () => ({
  useLocale: () => ({ locale: mocked.locale }),
}));
vi.mock("../../../components/workspace/workspace-provider", () => ({
  WorkspaceProvider: ({ children }: { children: ReactNode }) => children,
  useWorkspace: () => ({
    creator: mocked.creator,
    canEdit: mocked.canEdit,
    productFeatures: mocked.feature === null ? null : { surveys: mocked.feature },
    loading: mocked.loading,
    error: mocked.workspaceError,
  }),
}));
vi.mock("../../../components/workspace/workspace-shell", () => ({
  WorkspaceShell: ({
    children,
    title,
    actions,
    description,
    translationLevel,
  }: {
    children: ReactNode;
    title: string;
    actions: ReactNode;
    description: string;
    translationLevel: string;
  }) => (
    <main data-translation={translationLevel}>
      <h1>{title}</h1>
      <p>{description}</p>
      {actions}
      {children}
    </main>
  ),
}));
vi.mock("../../../components/workspace/creation-method-details", () => ({
  CreationMethodDetails: ({ method }: { method: string }) => (
    <div data-method={method}>Method details</div>
  ),
}));
vi.mock("../../../components/workspace/starter-gallery", () => ({
  StarterGallery: ({ survey, roundType }: { survey: boolean; roundType: string }) => (
    <div data-survey={survey} data-round-type={roundType}>
      Survey template gallery
    </div>
  ),
}));
vi.mock("../../../lib/api", () => ({
  apiFetch: mocked.request,
  humanError: (error: Error) => error.message,
}));
vi.mock("../../../lib/survey-client", () => ({ surveyMutationKey: mocked.mutationKey }));

import NewSurveyPage from "./page";

function select(method: SurveyCreationMethod) {
  mocked.query = surveyCreationHref(method).split("?")[1] ?? "";
}
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function captureLauncher() {
  const launcher = (NewSurveyPage().props as { children: ReactElement }).children;
  mocked.capture = true;
  mocked.refIndex = 0;
  const tree = (launcher.type as () => ReactElement)();
  mocked.capture = false;
  return tree;
}
function blankButton() {
  return elements(captureLauncher()).find((element) => element.type === "button");
}
async function settle() {
  for (let index = 0; index < 8; index++) await Promise.resolve();
}

beforeEach(() => {
  mocked.query = "";
  mocked.canEdit = true;
  mocked.feature = true;
  mocked.loading = false;
  mocked.workspaceError = "";
  mocked.creator = { userId: "creator-1", workspaceId: "workspace-1" };
  mocked.locale = "en-CA";
  mocked.capture = false;
  mocked.refs = [];
  mocked.refIndex = 0;
  vi.clearAllMocks();
  mocked.mutationKey.mockReturnValue("11111111-1111-4111-8111-111111111111");
});

describe("Survey creation launcher", () => {
  it("shows navigation-only blank and template methods without starting either", () => {
    const markup = renderToStaticMarkup(<NewSurveyPage />);
    expect(markup).toContain(`href="${surveyCreationHref("blank")}"`);
    expect(markup).toContain(`href="${surveyCreationHref("template")}"`);
    expect(markup).not.toContain("Survey template gallery");
    expect(blankButton()).toBeUndefined();
    expect(mocked.request).not.toHaveBeenCalled();
    expect(mocked.mutationKey).not.toHaveBeenCalled();
    expect(mocked.push).not.toHaveBeenCalled();
  });

  it.each(["blank", "template"] as const)(
    "shows only the selected %s workflow with details",
    (method) => {
      select(method);
      const markup = renderToStaticMarkup(<NewSurveyPage />);
      expect(markup).toContain(`data-method="survey${method === "blank" ? "Blank" : "Template"}"`);
      expect(markup).toContain(`href="${surveyCreationHref()}"`);
      if (method === "template") {
        expect(markup).toContain("Survey template gallery");
        expect(markup).toContain('data-survey="true"');
        expect(markup).toContain('data-round-type="poll"');
        expect(blankButton()).toBeUndefined();
      } else expect(markup).not.toContain("Survey template gallery");
      expect(mocked.request).not.toHaveBeenCalled();
    },
  );

  it.each([
    "start=unknown",
    "start=blank&start=template",
    "start=template&start=template",
    "start=",
  ])("offers recovery for invalid selection %s without creating", (query) => {
    mocked.query = query;
    const markup = renderToStaticMarkup(<NewSurveyPage />);
    expect(markup).toContain('role="status"');
    expect(markup).toContain(`href="${surveyCreationHref()}"`);
    expect(markup).not.toContain("Method details");
    expect(markup).not.toContain("Survey template gallery");
    expect(blankButton()).toBeUndefined();
    expect(mocked.request).not.toHaveBeenCalled();
  });

  it.each(["read-only", "disabled", "unresolved", "loading", "identity", "error"] as const)(
    "hides creation methods and operator details with %s authority",
    (condition) => {
      if (condition === "read-only") mocked.canEdit = false;
      if (condition === "disabled") mocked.feature = false;
      if (condition === "unresolved") mocked.feature = null;
      if (condition === "loading") mocked.loading = true;
      if (condition === "identity") mocked.creator = null;
      if (condition === "error") mocked.workspaceError = "Access failed";
      for (const method of ["blank", "template"] as const) {
        select(method);
        const markup = renderToStaticMarkup(<NewSurveyPage />);
        expect(markup).toContain('href="/surveys"');
        expect(markup).not.toContain("Method details");
        expect(markup).not.toContain("Survey template gallery");
        expect(markup).not.toContain("FEATURE_");
        expect(markup).not.toContain("CORE_PARITY");
        expect(blankButton()).toBeUndefined();
      }
      expect(mocked.request).not.toHaveBeenCalled();
      expect(mocked.mutationKey).not.toHaveBeenCalled();
    },
  );

  it("creates once after an explicit click and retains the existing request body", async () => {
    select("blank");
    mocked.request.mockResolvedValue({ survey: { id: "survey-1" } });
    const button = blankButton()!;
    expect(mocked.request).not.toHaveBeenCalled();
    (button.props.onClick as () => void)();
    (button.props.onClick as () => void)();
    await settle();
    expect(mocked.request).toHaveBeenCalledExactlyOnceWith("/v1/surveys", {
      method: "POST",
      body: JSON.stringify({
        idempotencyKey: "11111111-1111-4111-8111-111111111111",
        locale: "en-CA",
      }),
    });
    expect(mocked.mutationKey).toHaveBeenCalledOnce();
    expect(mocked.push).toHaveBeenCalledExactlyOnceWith("/surveys/survey-1");
  });

  it("retries the exact saved body after failure even after the interface locale changes", async () => {
    select("blank");
    mocked.request.mockRejectedValueOnce(new Error("Connection lost"));
    mocked.request.mockResolvedValueOnce({ survey: { id: "survey-1" } });
    (blankButton()!.props.onClick as () => void)();
    await settle();
    mocked.locale = "ko-KR";
    (blankButton()!.props.onClick as () => void)();
    await settle();
    expect(mocked.request).toHaveBeenCalledTimes(2);
    expect(mocked.request.mock.calls[1]).toEqual(mocked.request.mock.calls[0]);
    expect(JSON.parse(mocked.request.mock.calls[1]![1].body)).toEqual({
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      locale: "en-CA",
    });
    expect(mocked.mutationKey).toHaveBeenCalledOnce();
    expect(mocked.push).toHaveBeenCalledExactlyOnceWith("/surveys/survey-1");
  });

  it("rechecks workspace authority before an earlier rendered button can create", () => {
    select("blank");
    const button = blankButton()!;
    mocked.feature = false;
    captureLauncher();
    (button.props.onClick as () => void)();
    expect(mocked.request).not.toHaveBeenCalled();
    expect(mocked.mutationKey).not.toHaveBeenCalled();
  });

  it("localizes the survey launcher and unavailable copy without operator flags", () => {
    mocked.locale = "ko-KR";
    mocked.feature = false;
    const copy = creationMethodCopy("ko-KR").survey;
    const markup = renderToStaticMarkup(<NewSurveyPage />);
    expect(markup).toContain(copy.title);
    expect(markup).toContain(copy.privacy);
    expect(markup).toContain(copy.unavailable);
    expect(markup).toContain('data-translation="full"');
    expect(markup).not.toContain("Create a Survey");
    expect(markup).not.toContain("FEATURE_");
    expect(markup).not.toContain("CORE_PARITY");
  });
});
