import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createdPackPractice,
  packPracticeIds,
  publishedPracticePack,
} from "../../test-utils/recovery-pack-practice";
import { PackPracticeAction } from "./pack-practice-action";
import { PackPracticeAttribution } from "./pack-practice-attribution";
import { PracticeLinkReceipt } from "./practice-link-receipt";
import { PackPracticePreview } from "./pack-practice-preview";
import { supportedLocales, type SupportedLocale } from "@openround/contracts";
import { packPracticeCopy } from "../../lib/i18n/pack-practice-copy";
import { packPracticeDetailCopy } from "../../lib/i18n/pack-practice-detail-copy";
import { practiceLinksCsv } from "../../lib/practice-assignment";
import { recordPracticeAssignmentShared } from "../workspace/product-events";
import { flushPromises, hookHarness } from "../canvas-artifact-links/test-support";

vi.mock("react", async (original) => {
  const { hookReact } = await import("../canvas-artifact-links/test-support");
  return hookReact(await original<typeof ReactModule>());
});
vi.mock("../workspace/product-events", () => ({ recordPracticeAssignmentShared: vi.fn() }));

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
const mounted = new Set<{ unmount: () => void }>();
function mountReceipt(created = createdPackPractice(), initialLocale: SupportedLocale = "en-CA") {
  let locale = initialLocale;
  const focus = vi.fn();
  const view = hookHarness(() => {
    const tree = PracticeLinkReceipt({ created, locale });
    const heading = elements(tree).find((node) => node.type === "h2")!;
    const ref = heading.props.ref as { current: unknown };
    ref.current ??= { focus };
    return tree;
  });
  mounted.add(view);
  const render = (nextLocale = locale) => {
    locale = nextLocale;
    return view.render();
  };
  render();
  return {
    render,
    focus,
    nodes: () => elements(render()),
    text: () => nodeText(render()),
    click(label: string, index = 0) {
      const button = elements(render()).filter(
        (node) => node.type === "button" && nodeText(node.props.children as ReactNode) === label,
      )[index];
      expect(button, label).toBeDefined();
      expect(button!.props.disabled).not.toBe(true);
      (button!.props.onClick as () => void)();
    },
  };
}
afterEach(() => {
  for (const view of mounted) view.unmount();
  mounted.clear();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("Recovery Pack practice presentation", () => {
  const gates = {
    recoveryPacksEnabled: true,
    practiceAssignmentsEnabled: true,
    canEdit: true,
    followups: true,
  };

  it.each(supportedLocales)(
    "localizes entry guidance in %s while retaining exact frozen links and gates",
    (locale) => {
      const version = publishedPracticePack();
      const before = structuredClone(version);
      const copy = packPracticeCopy(locale);
      for (const mode of ["delayed_probe", "full_sequence"] as const) {
        const ready = renderToStaticMarkup(
          <PackPracticeAction
            packId={packPracticeIds.pack}
            version={version}
            mode={mode}
            locale={locale}
            {...gates}
          />,
        );
        expect(ready).toContain(`lang="${locale}"`);
        expect(ready).toContain(
          copy(
            mode === "full_sequence"
              ? "Assign full-sequence practice"
              : "Assign delayed-probe practice",
          ),
        );
        expect(ready).toContain(
          `/recovery-packs/${packPracticeIds.pack}/assign?version=${version.id}${mode === "full_sequence" ? "&amp;mode=full_sequence" : ""}`,
        );
        const paused = renderToStaticMarkup(
          <PackPracticeAction
            packId={packPracticeIds.pack}
            version={version}
            mode={mode}
            locale={locale}
            {...gates}
            canEdit={false}
          />,
        );
        expect(paused).toContain(copy("An owner or editor must create the practice assignment."));
        expect(paused).toContain('disabled=""');
        expect(paused).not.toContain("/assign?");
      }
      expect(version).toEqual(before);
    },
  );

  it("keeps unknown service feedback in English even when it equals a control label", () => {
    const markup = renderToStaticMarkup(
      <PackPracticeAction
        packId={packPracticeIds.pack}
        version={publishedPracticePack()}
        locale="ko-KR"
        loadError="Full-sequence Pack practice"
        {...gates}
      />,
    );
    expect(markup).toContain('<p class="muted" lang="en-CA">Full-sequence Pack practice</p>');
    expect(markup).not.toContain("/assign?");
  });

  it("links only the exact published delayed probe and disables missing-probe practice", () => {
    const ready = renderToStaticMarkup(
      <PackPracticeAction
        packId={packPracticeIds.pack}
        version={publishedPracticePack()}
        {...gates}
      />,
    );
    expect(ready).toContain(
      `/recovery-packs/${packPracticeIds.pack}/assign?version=${packPracticeIds.version}`,
    );
    expect(ready).not.toContain("Facilitator guidance");
    expect(ready).not.toContain("Diagnostic only");
    const missing = renderToStaticMarkup(
      <PackPracticeAction
        packId={packPracticeIds.pack}
        version={publishedPracticePack(false)}
        {...gates}
      />,
    );
    expect(missing).toContain("no delayed probe");
    expect(missing).toContain("not substitutes");
    expect(missing).toContain('disabled=""');
    expect(missing).not.toContain("/assign?");
  });

  it("keeps receipt private links readable independently of source deletion or gate pause", () => {
    const created = createdPackPractice();
    const markup = renderToStaticMarkup(<PracticeLinkReceipt created={created} />);
    expect(markup).toContain("Save your private links");
    expect(markup).toContain("one frozen delayed probe");
    expect(markup).toContain("stores only token hashes");
    expect(markup).toContain("Download links CSV");
    expect(markup).toContain(created.genericUrl);
    expect(markup).toContain(created.personalAccess[0]!.url);
    expect(markup).toContain(`/practice/${created.followup.id}`);
    expect(markup).not.toContain("accessSeed");
    expect(markup).not.toContain("Diagnostic only");
    expect(markup).not.toContain("Facilitator guidance");
  });
  it("offers full sequence without a probe and shows frozen readonly diagnostic/cards/recheck only", () => {
    const version = publishedPracticePack(false);
    const action = renderToStaticMarkup(
      <PackPracticeAction
        packId={packPracticeIds.pack}
        version={version}
        mode="full_sequence"
        {...gates}
      />,
    );
    expect(action).toContain("Assign full-sequence practice");
    expect(action).toContain("mode=full_sequence");
    expect(action).not.toContain('disabled=""');
    const preview = renderToStaticMarkup(
      <PackPracticePreview version={version} mode="full_sequence" />,
    );
    expect(preview).toContain("Diagnostic only");
    expect(preview).toContain("Facilitator guidance");
    expect(preview).toContain("Recheck only");
    expect(preview).not.toContain("Delayed transfer probe");
    expect(preview).not.toContain("correctValue");
    expect(preview).not.toContain("<input");
    expect(preview).not.toContain("<textarea");
  });
  it("distinguishes full-sequence receipts and attribution from delayed-probe practice", () => {
    const created = createdPackPractice();
    created.followup.recoveryPackSource!.role = "full_sequence";
    const markup = renderToStaticMarkup(<PracticeLinkReceipt created={created} />);
    expect(markup).toContain("frozen diagnostic, intervention cards, and linked recheck");
    expect(markup).not.toContain("one frozen delayed probe");
    expect(
      renderToStaticMarkup(
        <PackPracticeAttribution source={created.followup.recoveryPackSource} />,
      ),
    ).toContain("Recovery Pack full sequence");
  });

  it("renders frozen Pack history context and a library link without source bodies or answers", () => {
    const source = createdPackPractice().followup.recoveryPackSource!;
    const markup = renderToStaticMarkup(<PackPracticeAttribution source={source} />);
    expect(markup).toContain("Recovery Pack delayed probe");
    expect(markup).toContain("Halves &lt; whole");
    expect(markup).toContain('published version <span lang="">2</span>');
    expect(markup).toContain('href="/recovery-packs"');
    expect(markup).not.toContain(source.contentHash);
    expect(markup).not.toContain(source.sourceItemId);
    expect(markup).not.toContain("correctValue");
    expect(renderToStaticMarkup(<PackPracticeAttribution source={null} />)).toBe("");
  });

  it.each(supportedLocales)(
    "localizes supporting chrome in %s while retaining authored prompts, citations, and private links",
    (locale) => {
      const copy = packPracticeDetailCopy(locale);
      const version = publishedPracticePack();
      const card = version.content.interventions[0]!;
      card.title = "Diagnostic";
      card.body = `Copy\n${"unbroken-raw-body".repeat(50)} <script>plain text</script>`;
      card.citations = [
        {
          sourceName: "Card citations",
          sourceDigest: "b".repeat(64),
          locator: "Linked recheck",
          excerpt: "Download links CSV",
        },
      ];
      version.content.diagnostic.explanation = "PRIVATE-DIAGNOSTIC-ANSWER";
      version.content.recheck.explanation = "PRIVATE-RECHECK-ANSWER";
      version.content.delayedProbe!.prompt = "FUTURE-DELAYED-PROBE";
      const before = structuredClone(version);
      const full = PackPracticePreview({ version, mode: "full_sequence", locale });
      const fullNodes = elements(full);
      const fullText = nodeText(full);
      expect(full.props.lang).toBe(locale);
      expect(full.props["aria-label"]).toBe(copy("Frozen full-sequence preview"));
      expect(fullText).toContain(copy("Intervention cards in order"));
      expect(fullText).toContain(copy("Linked recheck"));
      expect(fullNodes.find((node) => node.type === "ul")!.props["aria-label"]).toBe(
        copy("Card citations"),
      );
      for (const authored of [
        version.content.diagnostic.prompt,
        card.title,
        card.body,
        "Card citations, Linked recheck — Download links CSV",
        version.content.recheck.prompt,
      ])
        expect(
          fullNodes.some((node) => node.props.lang === "" && nodeText(node) === authored),
        ).toBe(true);
      for (const hidden of [
        "FUTURE-DELAYED-PROBE",
        "PRIVATE-DIAGNOSTIC-ANSWER",
        "PRIVATE-RECHECK-ANSWER",
        "correctValue",
        card.citations[0]!.sourceDigest,
      ])
        expect(fullText).not.toContain(hidden);
      expect(renderToStaticMarkup(full)).not.toContain("<script>");
      expect(fullNodes.some((node) => node.type === "input" || node.type === "textarea")).toBe(
        false,
      );

      const delayed = PackPracticePreview({ version, mode: "delayed_probe", locale });
      expect(nodeText(delayed)).toContain("FUTURE-DELAYED-PROBE");
      expect(nodeText(delayed)).toContain(
        copy(
          "Only this published delayed probe is copied. Draft edits and future Pack changes do not update the assignment.",
        ),
      );
      expect(nodeText(delayed)).not.toContain(card.body);
      expect(nodeText(delayed)).not.toContain(version.content.diagnostic.prompt);
      expect(version).toEqual(before);

      const created = createdPackPractice();
      created.personalAccess[0]!.nickname = `Copy ${"longname".repeat(50)}`;
      const createdBefore = structuredClone(created);
      for (const role of ["delayed_probe", "full_sequence"] as const) {
        created.followup.recoveryPackSource!.role = role;
        const receipt = renderToStaticMarkup(
          <PracticeLinkReceipt created={created} locale={locale} />,
        );
        expect(receipt).toContain(`lang="${locale}"`);
        expect(receipt).toContain(copy("Save your private links"));
        expect(receipt).toContain(copy("Download links CSV"));
        expect(receipt).toContain(copy("Manage practice"));
        expect(receipt).toContain(
          copy(
            role === "full_sequence"
              ? "This assignment contains the frozen diagnostic, intervention cards, and linked recheck, not the optional delayed probe or a delayed recovery trail."
              : "This assignment contains one frozen delayed probe, not the full Recovery Pack or a delayed recovery trail.",
          ),
        );
        expect(receipt).toContain(
          copy(
            "Save or download these links now. Polling Pops stores only token hashes; these exact links are not displayed again in practice management. Keep them private.",
          ),
        );
        expect(receipt).toContain(created.genericUrl);
        expect(receipt).toContain(created.personalAccess[0]!.url);
        expect(receipt).toContain(`<span lang="">${created.personalAccess[0]!.nickname}</span>`);
        expect(receipt).toContain(`/practice/${created.followup.id}`);
      }
      created.followup.recoveryPackSource!.role = createdBefore.followup.recoveryPackSource!.role;
      expect(created).toEqual(createdBefore);
    },
  );

  it("projects only frozen source identity in every locale without fetching or adding disclosure", () => {
    const fetch = vi.fn(() => {
      throw new Error("Attribution must never load the source Pack");
    });
    vi.stubGlobal("fetch", fetch);
    const source = createdPackPractice().followup.recoveryPackSource!;
    source.packTitle = `Copy <${"raw-title".repeat(40)}>`;
    source.packVersion = 123456;
    for (const locale of supportedLocales) {
      const copy = packPracticeDetailCopy(locale);
      for (const role of ["full_sequence", "delayed_probe"] as const) {
        const frozen = { ...source, role };
        const tree = PackPracticeAttribution({ source: frozen, locale });
        const nodes = elements(tree);
        expect(tree!.props.lang).toBe(locale);
        expect(nodeText(tree)).toContain(
          copy(
            role === "full_sequence"
              ? "Recovery Pack full sequence"
              : "Recovery Pack delayed probe",
          ),
        );
        expect(nodeText(tree)).toContain(copy("published version"));
        expect(nodeText(tree)).toContain("123456");
        expect(nodes.find((node) => node.type === "span")!.props).toMatchObject({
          lang: "",
          children: source.packTitle,
        });
        const markup = renderToStaticMarkup(tree);
        expect(markup).toContain('href="/recovery-packs"');
        for (const hidden of [
          source.packId,
          source.packVersionId,
          source.contentHash,
          source.sourceItemId,
        ])
          expect(markup).not.toContain(hidden);
        expect(markup).not.toContain("<details");
        expect(markup).not.toContain("<script");
      }
      expect(renderToStaticMarkup(<PackPracticeAttribution locale={locale} />)).toBe("");
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps one receipt mounted while pending copy and live locale changes preserve tokens and focus", async () => {
    let resolveCopy!: () => void;
    const writeText = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveCopy = resolve;
        }),
    );
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const created = createdPackPractice();
    created.genericUrl = `https://example.test/followup/assignment?raw=%2B%2F#token=private&label=${"token".repeat(100)}`;
    const before = structuredClone(created);
    const view = mountReceipt(created);
    expect(view.focus).toHaveBeenCalledTimes(1);
    view.click("Copy");
    view.render("ko-KR");
    expect(writeText).toHaveBeenCalledExactlyOnceWith(created.genericUrl);
    expect(recordPracticeAssignmentShared).not.toHaveBeenCalled();
    resolveCopy();
    await flushPromises();
    expect(view.text()).toContain(packPracticeDetailCopy("ko-KR")("Generic link copied."));
    view.render("de-DE");
    expect(view.text()).toContain(packPracticeDetailCopy("de-DE")("Generic link copied."));
    const inputs = view.nodes().filter((node) => node.type === "input");
    expect(inputs.map((node) => node.props.value)).toEqual([
      created.genericUrl,
      created.personalAccess[0]!.url,
    ]);
    for (const input of inputs) expect(input.props).toMatchObject({ lang: "", readOnly: true });
    expect(view.focus).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(recordPracticeAssignmentShared).toHaveBeenCalledTimes(1);
    expect(created).toEqual(before);
  });

  it.each(["Generic link", "Copy", "Save your private links", "{label} $& <name>"])(
    "keeps the personal name %s authored in copied feedback across locale changes",
    async (label) => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal("navigator", { clipboard: { writeText } });
      const created = createdPackPractice();
      created.personalAccess[0]!.nickname = label;
      const view = mountReceipt(created);
      view.click("Copy", 1);
      await flushPromises();
      for (const locale of ["en-CA", "ko-KR", "de-DE", "zh-CN"] as const) {
        view.render(locale);
        const status = view.nodes().find((node) => node.props.role === "status")!;
        expect(nodeText(status)).toBe(packPracticeDetailCopy(locale)("{label} copied.", { label }));
        expect(elements(status).find((node) => node.type === "span")!.props).toMatchObject({
          lang: "",
          children: label,
        });
      }
      expect(writeText).toHaveBeenCalledExactlyOnceWith(created.personalAccess[0]!.url);
      expect(recordPracticeAssignmentShared).toHaveBeenCalledTimes(1);
      expect(view.focus).toHaveBeenCalledTimes(1);
    },
  );

  it("reprojects blocked-copy feedback without retrying or hiding the exact readonly links", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("clipboard blocked"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const created = createdPackPractice();
    const view = mountReceipt(created);
    view.click("Copy");
    await flushPromises();
    for (const locale of ["en-CA", "ja-JP", "fr-FR"] as const) {
      view.render(locale);
      expect(nodeText(view.nodes().find((node) => node.props.role === "alert"))).toBe(
        packPracticeDetailCopy(locale)("Copy was blocked. Select and copy the link instead."),
      );
      expect(
        view.nodes().find((node) => node.props.id === "pack-practice-generic-link")!.props,
      ).toMatchObject({
        value: created.genericUrl,
        readOnly: true,
        lang: "",
      });
    }
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(recordPracticeAssignmentShared).not.toHaveBeenCalled();
    expect(view.focus).toHaveBeenCalledTimes(1);
  });

  it("downloads identical CSV bytes and filename while localized download feedback remains live", async () => {
    const created = createdPackPractice();
    created.personalAccess[0]!.nickname = '=Name, "Copy"';
    const expectedCsv =
      '"access","participant","link"\r\n' +
      '"generic","Anonymous","https://example.test/followup/assignment#token=generic-private"\r\n' +
      '"personal","\'=Name, ""Copy""","https://example.test/followup/assignment#token=personal-private"';
    expect(practiceLinksCsv(created)).toBe(expectedCsv);
    const link = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
    const createElement = vi.fn(() => link),
      append = vi.fn();
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:private-links");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const setTimeout = vi.fn();
    vi.stubGlobal("document", { createElement, body: { append } });
    vi.stubGlobal("window", { setTimeout });
    const view = mountReceipt(created, "ko-KR");
    view.click(packPracticeDetailCopy("ko-KR")("Download links CSV"));
    expect(createElement).toHaveBeenCalledExactlyOnceWith("a");
    expect(append).toHaveBeenCalledExactlyOnceWith(link);
    expect(link).toMatchObject({
      href: "blob:private-links",
      download: `polling-pops-practice-${created.followup.id}-links.csv`,
    });
    expect(link.click).toHaveBeenCalledTimes(1);
    expect(link.remove).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0]![0] as Blob;
    expect(blob.type).toBe("text/csv;charset=utf-8");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new TextEncoder().encode(expectedCsv));
    for (const locale of ["ko-KR", "de-DE", "en-CA"] as const) {
      view.render(locale);
      expect(nodeText(view.nodes().find((node) => node.props.role === "status"))).toBe(
        packPracticeDetailCopy(locale)("Private practice links downloaded."),
      );
    }
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(recordPracticeAssignmentShared).toHaveBeenCalledTimes(1);
    expect(view.focus).toHaveBeenCalledTimes(1);
    expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 0);
    (setTimeout.mock.calls[0]![0] as () => void)();
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:private-links");
  });

  it.each(["recoveryPacksEnabled", "practiceAssignmentsEnabled", "canEdit", "followups"] as const)(
    "does not offer a new assignment while %s is false",
    (gate) => {
      const markup = renderToStaticMarkup(
        <PackPracticeAction
          packId={packPracticeIds.pack}
          version={publishedPracticePack()}
          {...gates}
          {...{ [gate]: false }}
        />,
      );
      expect(markup).toContain('disabled=""');
      expect(markup).not.toContain("/assign?");
    },
  );
});
