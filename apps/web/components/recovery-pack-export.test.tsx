import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import type * as PackExportModule from "../lib/recovery-pack-export";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { packExportCopy } from "../lib/i18n/pack-export-copy";
import { exportReport, exportSource } from "../test-utils/recovery-pack-export";
import { PackExportReportView, RecoveryPackExportPanel } from "./recovery-pack-export";

const downloads = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("../lib/recovery-pack-export", async (original) => {
  const actual = await original<typeof PackExportModule>();
  return {
    ...actual,
    createPackExportReview: (options: Parameters<typeof actual.createPackExportReview>[0]) =>
      actual.createPackExportReview({ ...options, download: downloads.save }),
  };
});

interface Hooks {
  cursor: number;
  slots: unknown[];
  dependencies: Map<number, readonly unknown[] | undefined>;
  effects: Array<{ index: number; effect: ReactModule.EffectCallback }>;
  cleanups: Map<number, void | (() => void)>;
}
const mountedHooks = vi.hoisted(() => ({ current: null as Hooks | null }));
vi.mock("react", async (original) => {
  const actual = await original<typeof ReactModule>();
  return {
    ...actual,
    useId: () => {
      const hooks = mountedHooks.current;
      if (!hooks) return actual.useId();
      const index = hooks.cursor++;
      hooks.slots[index] ??= `mounted-${index}`;
      return hooks.slots[index];
    },
    useRef: <T,>(initial: T) => {
      const hooks = mountedHooks.current;
      if (!hooks) return actual.useRef(initial);
      const index = hooks.cursor++;
      hooks.slots[index] ??= { current: initial };
      return hooks.slots[index];
    },
    useState: <T,>(initial: T) => {
      const hooks = mountedHooks.current;
      if (!hooks) return actual.useState(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = initial;
      return [
        hooks.slots[index],
        (next: T | ((current: T) => T)) => {
          hooks.slots[index] =
            typeof next === "function"
              ? (next as (current: T) => T)(hooks.slots[index] as T)
              : next;
        },
      ];
    },
    useEffect: (effect: ReactModule.EffectCallback, dependencies?: readonly unknown[]) => {
      const hooks = mountedHooks.current;
      if (!hooks) return actual.useEffect(effect, dependencies);
      const index = hooks.cursor++,
        previous = hooks.dependencies.get(index);
      if (
        !hooks.dependencies.has(index) ||
        !dependencies ||
        dependencies.some((value, i) => value !== previous?.[i])
      )
        hooks.effects.push({ index, effect });
      hooks.dependencies.set(index, dependencies);
    },
  };
});
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function nodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  return isValidElement<{ children?: ReactNode }>(node) ? nodeText(node.props.children) : "";
}
const mounted = new Set<{ close: () => void }>();
function mount<Props>(Component: (props: Props) => ReactNode, initial: Props) {
  let props = initial;
  const hooks: Hooks = {
    cursor: 0,
    slots: [],
    dependencies: new Map(),
    effects: [],
    cleanups: new Map(),
  };
  function render(next = props) {
    props = next;
    hooks.cursor = 0;
    hooks.effects = [];
    mountedHooks.current = hooks;
    let tree: ReactNode;
    try {
      tree = Component(props);
    } finally {
      mountedHooks.current = null;
    }
    const nodes = elements(tree);
    for (const node of nodes) {
      const ref = node.props.ref as { current?: unknown } | undefined;
      if (ref && typeof ref === "object" && !ref.current) ref.current = { focus: vi.fn() };
    }
    for (const { index, effect } of hooks.effects) {
      hooks.cleanups.get(index)?.();
      hooks.cleanups.set(index, effect());
    }
    return nodes;
  }
  const view = {
    render,
    text: () => nodeText(render()[0]),
    button(label: string) {
      const button = render().find(
        (node) => node.type === "button" && nodeText(node.props.children as ReactNode) === label,
      );
      expect(button, label).toBeDefined();
      return button!;
    },
    click(label: string) {
      const button = view.button(label);
      expect(button.props.disabled).not.toBe(true);
      (button.props.onClick as () => void)();
    },
    close() {
      for (const cleanup of hooks.cleanups.values()) cleanup?.();
      hooks.cleanups.clear();
      mounted.delete(view);
    },
  };
  mounted.add(view);
  render();
  return view;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
afterEach(() => {
  for (const view of [...mounted]) view.close();
  downloads.save.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("published Recovery Pack export panel", () => {
  it("starts read-only with a labeled format, review action, disabled downloads and no automatic fetch", () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const markup = renderToStaticMarkup(<RecoveryPackExportPanel source={exportSource} />);
    expect(markup).toContain("Published Pack export format");
    expect(markup).toContain("CSV checkpoints");
    expect(markup).toContain("QTI 3 checkpoint package");
    expect(markup).toContain("Review export losses");
    expect(markup).toContain("complete Pack content");
    expect(markup).toContain("not the private media files");
    expect(markup).toMatch(/disabled=""[^>]*>Download CSV checkpoints/);
    expect(markup).toMatch(/disabled=""[^>]*>Download export report JSON/);
    expect(markup).toContain('role="status" aria-live="polite"');
    expect(markup).not.toContain("target=");
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();
  });

  it("renders frozen source/count and every structured loss as wrapping plaintext", () => {
    const report = exportReport();
    report.findings[0]!.reason = "<script>notHtml()</script> " + "LongCitationOrTerm".repeat(30);
    const markup = renderToStaticMarkup(<PackExportReportView report={report} />);
    for (const visible of [
      report.source.packVersionId,
      report.source.contentHash,
      "2 of 2 checkpoints",
      "WORKFLOW_OMITTED",
      "interventions",
      "omitted",
      "1 affected item",
    ])
      expect(markup).toContain(visible);
    expect(markup).toContain("Frozen &lt; Recovery Pack");
    expect(markup).toContain("&lt;script&gt;notHtml()&lt;/script&gt;");
    expect(markup).not.toContain("<script>");
    expect(markup).toContain("min-width:0;overflow-wrap:anywhere");
  });
});

describe("mounted portability review across locale changes", () => {
  it("retains pending review and frozen identity, rejects mismatched reports, and downloads exact reviewed bytes", async () => {
    const pending = deferred<Response>();
    const artifact = deferred<Response>();
    const fetch = vi
      .fn()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(new Response(JSON.stringify({ report: exportReport() })))
      .mockResolvedValueOnce(
        new Response("unreviewed bytes", {
          headers: { "content-type": "text/csv", "x-openround-export-report": "wrong" },
        }),
      )
      .mockReturnValueOnce(artifact.promise);
    vi.stubGlobal("fetch", fetch);
    const props = { source: exportSource, locale: "en-CA" as const };
    const view = mount<Parameters<typeof RecoveryPackExportPanel>[0]>(
      RecoveryPackExportPanel,
      props,
    );
    const capturedReview = view.button("Review export losses").props.onClick as () => void;
    capturedReview();
    const signal = fetch.mock.calls[0]![1].signal as AbortSignal;
    view.render({ ...props, locale: "ko-KR" });
    expect(view.text()).toContain(packExportCopy("ko-KR")("Reviewing frozen export losses…"));
    expect(signal.aborted).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    pending.resolve(
      new Response(
        JSON.stringify({
          report: { ...exportReport(), source: { ...exportSource, contentHash: "b".repeat(64) } },
        }),
      ),
    );
    await vi.waitFor(() =>
      expect(view.text()).toContain(
        packExportCopy("ko-KR")(
          "The export report does not match this frozen Pack version and format. Review again.",
        ),
      ),
    );
    expect(view.render().find((node) => node.props.role === "alert")!.props.lang).toBe("ko-KR");
    expect(view.button(packExportCopy("ko-KR")("Download CSV checkpoints")).props.disabled).toBe(
      true,
    );
    view.render({ ...props, locale: "de-DE" });
    capturedReview();
    await vi.waitFor(() =>
      expect(view.text()).toContain(
        packExportCopy("de-DE")("Reviewed {format} export", { format: "CSV" }),
      ),
    );
    expect(fetch.mock.calls[0]![0]).toBe(fetch.mock.calls[1]![0]);
    expect(String(fetch.mock.calls[1]![0])).not.toContain("locale");
    view.click(packExportCopy("de-DE")("Download CSV checkpoints"));
    await vi.waitFor(() =>
      expect(view.text()).toContain(
        packExportCopy("de-DE")(
          "The download does not match the reviewed export. No file was downloaded.",
        ),
      ),
    );
    expect(downloads.save).not.toHaveBeenCalled();
    view.render({ ...props, locale: "ko-KR" });
    const select = view.render().find((node) => node.type === "select")!;
    const capturedSelect = select.props.onChange as (event: unknown) => void;
    view.click(packExportCopy("ko-KR")("Download CSV checkpoints"));
    view.render({ ...props, locale: "de-DE" });
    expect(view.text()).toContain(packExportCopy("de-DE")("Receiving the reviewed frozen export…"));
    capturedSelect({ target: { value: "qti3" } });
    expect(view.render().find((node) => node.type === "select")!.props.value).toBe("csv");
    expect((fetch.mock.calls[3]![1].signal as AbortSignal).aborted).toBe(false);
    const raw = "prompt,answer\nPrivate English source,4\n";
    artifact.resolve(
      new Response(raw, {
        headers: {
          "content-type": "text/csv",
          "x-openround-export-report": `/v1/recovery-packs/versions/${exportSource.packVersionId}/export-report?format=csv`,
        },
      }),
    );
    await vi.waitFor(() => expect(downloads.save).toHaveBeenCalledTimes(1));
    expect(await (downloads.save.mock.calls[0]![0] as Blob).text()).toBe(raw);
    expect(downloads.save.mock.calls[0]![1]).toBe(
      `polling-pops-recovery-pack-${exportSource.packVersionId}.csv`,
    );
    expect(fetch.mock.calls[2]![0]).toBe(fetch.mock.calls[3]![0]);
    view.click(packExportCopy("de-DE")("Download export report JSON"));
    expect(JSON.parse(await (downloads.save.mock.calls[1]![0] as Blob).text())).toEqual(
      exportReport(),
    );
    expect(downloads.save.mock.calls[1]![1]).toBe(
      `polling-pops-recovery-pack-${exportSource.packVersionId}-csv-export-report.json`,
    );
    expect(fetch).toHaveBeenCalledTimes(4);
    capturedSelect({ target: { value: "qti3" } });
    expect(view.button(packExportCopy("de-DE")("Download QTI 3 package")).props.disabled).toBe(
      true,
    );
    expect(view.text()).toContain(
      packExportCopy("de-DE")("Review this format before downloading."),
    );
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("localizes known finding severity, disposition and reason while preserving authored titles, codes and paths", () => {
    const report = exportReport();
    report.source.title = "Checkpoint portability";
    report.findings = [
      {
        code: "PACK_DESCRIPTION_OMITTED",
        severity: "warning",
        disposition: "omitted",
        fieldPath: "description",
        affectedItems: 1,
        reason: "The Pack description is not included in the checkpoint export.",
      },
      {
        code: "FUTURE_CODE",
        severity: "error",
        disposition: "unsupported",
        fieldPath: "checkpoints.private_ID",
        affectedItems: 2,
        reason: "Future service diagnostic <raw>",
      },
    ];
    report.canExport = false;
    report.exportedCheckpointCount = 0;
    const before = structuredClone(report);
    const markup = renderToStaticMarkup(<PackExportReportView report={report} locale="ko-KR" />);
    expect(markup).toContain('<p lang="">Checkpoint portability</p>');
    expect(markup).toContain('<code lang="">PACK_DESCRIPTION_OMITTED</code>');
    expect(markup).toContain('<code lang="">checkpoints.private_ID</code>');
    expect(markup).toContain('<p lang="en-CA">Future service diagnostic &lt;raw&gt;</p>');
    expect(markup).toContain(packExportCopy("ko-KR")("Warning"));
    expect(markup).toContain(packExportCopy("ko-KR")("unsupported"));
    expect(markup).not.toContain(report.findings[0]!.reason);
    expect(report).toEqual(before);
  });
});
