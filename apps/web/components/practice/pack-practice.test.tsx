import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  createdPackPractice,
  packPracticeIds,
  publishedPracticePack,
} from "../../test-utils/recovery-pack-practice";
import { PackPracticeAction } from "./pack-practice-action";
import { PackPracticeAttribution } from "./pack-practice-attribution";
import { PracticeLinkReceipt } from "./practice-link-receipt";
import { PackPracticePreview } from "./pack-practice-preview";
import { supportedLocales } from "@openround/contracts";
import { packPracticeCopy } from "../../lib/i18n/pack-practice-copy";

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
    expect(preview).toContain("min-width:0;overflow-wrap:anywhere");
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
    expect(markup).toContain("published version 2");
    expect(markup).toContain('href="/recovery-packs"');
    expect(markup).not.toContain(source.contentHash);
    expect(markup).not.toContain(source.sourceItemId);
    expect(markup).not.toContain("correctValue");
    expect(renderToStaticMarkup(<PackPracticeAttribution source={null} />)).toBe("");
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
