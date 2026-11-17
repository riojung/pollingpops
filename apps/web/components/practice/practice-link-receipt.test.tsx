import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createdPackPractice } from "../../test-utils/recovery-pack-practice";
import { hookHarness, flushPromises } from "../canvas-artifact-links/test-support";
import { PracticeLinkReceipt } from "./practice-link-receipt";
vi.mock("react", async (original) => {
  const { hookReact } = await import("../canvas-artifact-links/test-support");
  return hookReact(await original<typeof ReactModule>());
});
vi.mock("../workspace/product-events", () => ({ recordPracticeAssignmentShared: vi.fn() }));
function nodes(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  return isValidElement<Record<string, unknown>>(node)
    ? [node, ...nodes(node.props.children as ReactNode)]
    : [];
}
const views = new Set<{ unmount(): void }>();
afterEach(() => {
  for (const view of views) view.unmount();
  views.clear();
  vi.unstubAllGlobals();
});
describe("shared assignment receipt", () => {
  it("keeps a separate copied state for each private link without changing exact URL bytes", async () => {
    const created = createdPackPractice();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const view = hookHarness(() => PracticeLinkReceipt({ created }));
    views.add(view);
    const buttons = () => nodes(view.render()).filter((node) => node.type === "button");
    await (buttons()[0]!.props.onClick as () => Promise<void>)();
    await flushPromises();
    expect(buttons()[0]!.props.children).toBe("Copied");
    expect(buttons()[1]!.props.children).toBe("Copy");
    await (buttons()[1]!.props.onClick as () => Promise<void>)();
    await flushPromises();
    expect(
      buttons()
        .slice(0, 2)
        .map((button) => button.props.children),
    ).toEqual(["Copied", "Copied"]);
    expect(buttons()[0]!.props["aria-label"]).toContain("Copied");
    expect(writeText.mock.calls).toEqual([[created.genericUrl], [created.personalAccess[0]!.url]]);
    expect(
      nodes(view.render())
        .filter((node) => node.type === "input")
        .map((node) => node.props.value),
    ).toEqual([created.genericUrl, created.personalAccess[0]!.url]);
  });
  it("makes a Round receipt explicit about sharing and one-time disclosure without Pack-only claims", () => {
    const created = createdPackPractice();
    delete created.followup.recoveryPackSource;
    const markup = renderToStaticMarkup(<PracticeLinkReceipt created={created} />);
    expect(markup).toContain("stores only token hashes");
    expect(markup).toContain("these exact links are not displayed again");
    expect(markup).toContain("Share links yourself. No emails are sent.");
    expect(markup).toContain("Each link allows one attempt.");
    expect(markup).toContain('href="/assignments"');
    expect(markup).not.toContain("delayed probe");
    expect(markup).not.toContain("source Pack");
  });
});
