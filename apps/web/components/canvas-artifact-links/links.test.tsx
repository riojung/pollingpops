import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { useCanvasArtifactLinks } from "./use-links";
import { CanvasArtifactLinks } from "./links";
import { flushPromises, hookHarness } from "./test-support";
const mocked = vi.hoisted(() => ({
  state: null as unknown as ReturnType<typeof useCanvasArtifactLinks>,
  eligible: vi.fn(),
  blocker: vi.fn(),
}));
vi.mock("react", async (original) => {
  const { hookReact } = await import("./test-support");
  return hookReact(await original<typeof ReactModule>());
});
vi.mock("./use-links", () => ({ useCanvasArtifactLinks: () => mocked.state }));
vi.mock("./client", () => ({ eligibleCanvasArtifactLinks: mocked.eligible }));
vi.mock("./preview", () => ({ CanvasArtifactPreview: () => <p>Authorized scene mounted</p> }));
vi.mock("../locale-provider", () => ({ useLocale: () => ({ locale: "en-CA" }) }));
vi.mock("../navigation-guard", () => ({ useNavigationBlocker: mocked.blocker }));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const link = {
  id: id(2),
  boardId: id(3),
  versionId: id(4),
  boardTitle: "Synthetic board",
  name: "Synthetic checkpoint",
  revision: 1 as const,
  createdAt: "2026-10-01T00:00:00.000Z",
  createdBy: null,
  canDelete: true,
};
function find(node: ReactNode, label: string): ReactElement<Record<string, unknown>> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = find(child, label);
      if (found) return found;
    }
    return;
  }
  if (!isValidElement<Record<string, unknown>>(node)) return;
  return node.type === "button" && node.props.children === label
    ? node
    : find(node.props.children as ReactNode, label);
}
const mounted: Array<{ unmount: () => void }> = [];
function mount(editable = true) {
  const view = hookHarness(() => {
    const element = CanvasArtifactLinks({ target: { kind: "round", targetId: id(1) }, editable });
    return (element.type as (props: unknown) => ReactNode)(element.props);
  });
  mounted.push(view);
  return {
    ...view,
    html: () => renderToStaticMarkup(view.render()),
    button: (label: string) => find(view.render(), label)?.props,
    click(label: string) {
      const button = find(view.render(), label);
      if (!button || button.props.disabled) throw new Error(`Unavailable ${label}`);
      (button.props.onClick as () => void)();
      return renderToStaticMarkup(view.render());
    },
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocked.state = {
    list: { schemaVersion: 1, canCreate: true, links: [link] },
    error: false,
    saving: false,
    failure: null,
    accessEpoch: 1,
    pending: null,
    refresh: vi.fn(),
    execute: vi.fn(),
    discard: vi.fn(),
  };
  mocked.eligible.mockResolvedValue({ schemaVersion: 1, boards: [] });
});
afterEach(() => {
  for (const view of mounted.splice(0)) view.unmount();
});
describe("creator-only snapshot panel", () => {
  it("allows authorized readers to preview while omitting authoring actions", () => {
    mocked.state.list!.canCreate = false;
    const view = mount(false);
    expect(view.button("Link saved canvas")).toBeUndefined();
    expect(view.button("Remove link")).toBeUndefined();
    expect(view.click("Preview snapshot")).toContain("Authorized scene mounted");
    expect(view.html()).not.toContain("createdBy");
  });
  it("unmounts a selected scene on access-epoch or current-list invalidation", () => {
    const view = mount();
    expect(view.click("Preview snapshot")).toContain("Authorized scene mounted");
    mocked.state.accessEpoch++;
    expect(view.html()).not.toContain("Authorized scene mounted");
    view.click("Preview snapshot");
    mocked.state.list = { schemaVersion: 1, canCreate: true, links: [] };
    expect(view.html()).not.toContain("Authorized scene mounted");
  });
  it("requires explicit conflict review/drop and blocks replacement authoring", () => {
    mocked.state.failure = { conflict: true, retryable: false };
    const view = mount();
    expect(view.button("Retry same request")).toBeUndefined();
    expect(view.button("Link saved canvas")!.disabled).toBe(true);
    view.click("Review current links");
    expect(mocked.state.refresh).toHaveBeenCalledOnce();
    view.click("Discard pending request");
    expect(mocked.state.discard).toHaveBeenCalledOnce();
    expect(mocked.blocker.mock.calls.at(-1)![0]()).toBe(true);
  });
  it("keeps the picker within twenty links and prevents retries after editor access is lost", () => {
    mocked.state.list!.links = Array.from({ length: 20 }, (_, index) => ({
      ...link,
      id: id(index + 20),
    }));
    const capped = mount();
    expect(capped.button("Link saved canvas")!.disabled).toBe(true);
    mocked.state.failure = { conflict: false, retryable: true };
    const reader = mount(false);
    expect(reader.button("Retry same request")!.disabled).toBe(true);
  });
  it("cancels an eligible-board read when the picker is closed", async () => {
    mocked.eligible.mockImplementation(() => new Promise(() => {}));
    const view = mount();
    view.click("Link saved canvas");
    await flushPromises();
    const signal = mocked.eligible.mock.calls[0]![1] as AbortSignal;
    expect(signal.aborted).toBe(false);
    view.click("Cancel");
    expect(signal.aborted).toBe(true);
  });
});
