import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PresentationReadingReport } from "@openround/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_CHANGE_EVENT } from "../../lib/api";
import type * as Client from "../../lib/presentation-reading-insights-client";
import { readingInsightsCsv } from "../../lib/presentation-reading-insights-client";
import { flushPromises, hookHarness } from "../canvas-artifact-links/test-support";
import { PresentationReadingInsights, ReadingInsightsDetails } from "./reading-insights";

const mocked = vi.hoisted(() => ({ fetch: vi.fn(), download: vi.fn() }));
vi.mock("react", async (original) => {
  const { hookReact } = await import("../canvas-artifact-links/test-support");
  return hookReact(await original<typeof ReactModule>());
});
vi.mock("../../lib/presentation-reading-insights-client", async (original) => ({
  ...(await original<typeof Client>()),
  fetchReadingInsights: mocked.fetch,
  downloadReadingInsightsCsv: mocked.download,
}));
const id = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`;
const assignment = {
  id: id(2),
  mode: "reading" as const,
  versionId: id(3),
  createdAt: "2026-11-08T12:00:00.000Z",
  expiresAt: "2026-11-09T12:00:00.000Z",
  revokedAt: null,
};
const initial = { presentationId: id(1), actorKey: "creator:workspace-a", assignment };
function report(): PresentationReadingReport {
  return {
    schemaVersion: 1,
    assignment,
    generatedAt: "2026-11-08T12:30:00.000Z",
    minimumAttempts: 5,
    startedAttempts: 10,
    completedAttempts: 0,
    inProgressAttempts: 10,
    pages: [
      { blockId: id(4), pageNumber: 1, readAttempts: null },
      { blockId: id(5), pageNumber: 2, readAttempts: 0 },
    ],
  };
}
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function label(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(label).join("");
  return isValidElement<{ children?: ReactNode }>(node) ? label(node.props.children) : "";
}
const mounted: Array<{ close: () => void }> = [];
function mount() {
  let props = initial;
  const harness = hookHarness(() => PresentationReadingInsights(props));
  const view = {
    render(next = props) {
      props = next;
      return harness.render();
    },
    markup() {
      return renderToStaticMarkup(view.render());
    },
    click(name: string) {
      const button = elements(view.render()).find(
        (node) => node.type === "button" && label(node) === name,
      );
      expect(button).toBeDefined();
      (button!.props.onClick as () => void)();
    },
    close() {
      harness.unmount();
    },
  };
  mounted.push(view);
  view.render();
  return view;
}
function deferred() {
  let resolve!: (value: PresentationReadingReport) => void;
  const promise = new Promise<PresentationReadingReport>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.stubGlobal("window", new EventTarget());
  mocked.fetch.mockReset().mockResolvedValue(report());
  mocked.download.mockReset().mockReturnValue(vi.fn());
});
afterEach(() => {
  for (const view of mounted.splice(0)) view.close();
  vi.unstubAllGlobals();
});

describe("assignment reading insights", () => {
  it("loads only on request, explains anonymous self-reporting and labels the bounded coverage table", async () => {
    const view = mount();
    expect(mocked.fetch).not.toHaveBeenCalled();
    expect(view.markup()).toContain("anonymous attempts, not people");
    view.click("Load reading insights");
    expect(view.markup()).toContain("Loading reading insights");
    await flushPromises();
    const markup = view.markup();
    expect(markup).toContain('aria-label="Page reading coverage"');
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain("Created");
    expect(markup).toContain("Deadline");
    expect(markup).toContain(`dateTime="${assignment.createdAt}"`);
    expect(markup).toContain(`dateTime="${assignment.expiresAt}"`);
    expect(markup).not.toContain(assignment.id);
    expect(markup).not.toContain(assignment.versionId);
    expect(markup).toContain("Reading completion is self-reported");
    expect(markup).toContain("opens are excluded");
    expect(markup).toContain("With fewer than 5 starts, all counts are suppressed");
    expect(markup).toContain("reveal them are suppressed");
    expect(markup).toContain("Pages stay frozen to the assigned publication");
    expect(markup).toContain("7 days after");
    expect(markup).toContain("including revoked assignments");
    expect(markup).toContain("2026-11-08T12:30:00.000Z");
    expect(markup).toContain('<th scope="row">Page 1</th><td>Suppressed</td>');
    expect(markup).toContain('<th scope="row">Page 2</th><td>0</td>');
    await flushPromises();
    expect(mocked.fetch).toHaveBeenCalledTimes(1);
  });
  it("recovers explicitly after load failure and rejects a mismatched report before display or export", async () => {
    mocked.fetch.mockRejectedValueOnce(new Error("Offline. Try again."));
    const view = mount();
    view.click("Load reading insights");
    await flushPromises();
    expect(view.markup()).toContain('role="alert">Offline. Try again.');
    expect(view.markup()).not.toContain("Export reading CSV");
    mocked.fetch.mockResolvedValueOnce({
      ...report(),
      assignment: { ...assignment, versionId: id(99) },
    });
    view.click("Retry reading insights");
    await flushPromises();
    expect(view.markup()).toContain("could not be verified");
    expect(view.markup()).not.toContain("Export reading CSV");
    view.click("Retry reading insights");
    await flushPromises();
    expect(view.markup()).toContain("Export reading CSV");
  });
  it("exports the displayed snapshot without a network request and replaces it only on explicit refresh", async () => {
    const release = vi.fn();
    mocked.download.mockReturnValue(release);
    const view = mount();
    view.click("Load reading insights");
    await flushPromises();
    const staleExport = elements(view.render()).find(
      (node) => node.type === "button" && label(node) === "Export reading CSV",
    )!;
    view.click("Export reading CSV");
    expect(mocked.download).toHaveBeenCalledExactlyOnceWith(
      readingInsightsCsv(report(), {
        presentationId: id(1),
        assignmentId: id(2),
        versionId: id(3),
      }),
    );
    expect(mocked.fetch).toHaveBeenCalledTimes(1);
    const next = {
      ...report(),
      generatedAt: "2026-11-08T13:00:00.000Z",
      startedAttempts: 12,
      completedAttempts: 5,
      inProgressAttempts: 7,
      pages: report().pages.map((page) => ({ ...page, readAttempts: 5 })),
    };
    mocked.fetch.mockResolvedValueOnce(next);
    view.click("Refresh reading insights");
    expect(release).toHaveBeenCalledOnce();
    expect(view.markup()).not.toContain("Export reading CSV");
    await flushPromises();
    expect(view.markup()).toContain(next.generatedAt);
    (staleExport.props.onClick as () => void)();
    expect(mocked.download).toHaveBeenCalledTimes(1);
    view.click("Export reading CSV");
    expect(mocked.download.mock.calls[1]![0]).toContain('"Started attempts","12"');
    view.close();
    expect(release).toHaveBeenCalledTimes(2);
  });
  it.each(["actor", "workspace", "presentation", "assignment", "version", "auth", "close"])(
    "aborts and fences late reports on %s change",
    async (change) => {
      const pending = deferred();
      mocked.fetch.mockReturnValueOnce(pending.promise);
      const view = mount();
      view.click("Load reading insights");
      const signal = mocked.fetch.mock.calls[0]![1] as AbortSignal;
      if (change === "close") view.close();
      else if (change === "auth") window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
      else
        view.render({
          ...initial,
          actorKey:
            change === "actor"
              ? "other-creator:workspace-a"
              : change === "workspace"
                ? "creator:workspace-b"
                : initial.actorKey,
          presentationId: change === "presentation" ? id(8) : initial.presentationId,
          assignment:
            change === "assignment"
              ? { ...assignment, id: id(8) }
              : change === "version"
                ? { ...assignment, versionId: id(8) }
                : assignment,
        });
      expect(signal.aborted).toBe(true);
      pending.resolve(report());
      await flushPromises();
      if (change !== "close") {
        expect(view.markup()).not.toContain(report().generatedAt);
        expect(view.markup()).not.toContain("Export reading CSV");
      }
      expect(mocked.download).not.toHaveBeenCalled();
    },
  );
  it("clears loaded report and download resources on auth change and prevents a stale export callback", async () => {
    const release = vi.fn();
    mocked.download.mockReturnValue(release);
    const view = mount();
    view.click("Load reading insights");
    await flushPromises();
    const oldButton = elements(view.render()).find(
      (node) => node.type === "button" && label(node) === "Export reading CSV",
    )!;
    view.click("Export reading CSV");
    window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
    (oldButton.props.onClick as () => void)();
    expect(release).toHaveBeenCalledOnce();
    expect(mocked.download).toHaveBeenCalledTimes(1);
    expect(view.markup()).not.toContain("CSV download started");
    expect(view.markup()).not.toContain(report().generatedAt);
  });
  it("shows complete suppression as Suppressed, including zero starts, without inventing zeros", () => {
    const markup = renderToStaticMarkup(
      <ReadingInsightsDetails
        report={{
          ...report(),
          startedAttempts: null,
          completedAttempts: null,
          inProgressAttempts: null,
          pages: report().pages.map((page) => ({ ...page, readAttempts: null })),
        }}
      />,
    );
    expect(markup.match(/Suppressed/g)).toHaveLength(5);
    expect(markup).not.toContain("<dd>0</dd>");
  });
});
