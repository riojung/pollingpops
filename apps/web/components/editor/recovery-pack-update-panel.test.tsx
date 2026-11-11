import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { hookHarness, flushPromises } from "../canvas-artifact-links/test-support";
import { packUpdateCopy } from "../../lib/i18n/pack-update-copy";
import { renderToStaticMarkup } from "react-dom/server";
import { RecoveryPackContentSchema, type RecoveryPackUpdatePreview } from "@openround/contracts";
import { describe, expect, it, vi } from "vitest";
import { RecoveryPackLinkIssue, RecoveryPackUpdatePanel } from "./recovery-pack-update-panel";

vi.mock("react", async (original) => {
  const { hookReact } = await import("../canvas-artifact-links/test-support");
  return hookReact(await original<typeof ReactModule>());
});

const diagnostic = {
  id: "10000000-0000-4000-8000-000000000001",
  type: "numeric",
  prompt: "Compare two quantities",
  purpose: "diagnostic",
  delivery: "main",
  conceptKeys: ["ratios"],
  linkedRecheckQuestionId: "10000000-0000-4000-8000-000000000002",
  timeLimitSeconds: 30,
  basePoints: 100,
  explanation: "Use a ratio.",
  mediaId: null,
  mediaAlt: null,
  correctValue: "2",
  tolerance: "0",
  unit: null,
};
const referenceContent = RecoveryPackContentSchema.parse({
  schemaVersion: 1,
  title: "Ratios",
  description: "",
  diagnostic,
  recheck: {
    ...diagnostic,
    id: diagnostic.linkedRecheckQuestionId,
    prompt: "Compare a different pair of quantities",
    delivery: "recheck",
    linkedRecheckQuestionId: null,
  },
  interventions: [
    {
      id: "10000000-0000-4000-8000-000000000003",
      title: "Example",
      body: "Accepted baseline guidance.",
    },
  ],
  conceptKeys: ["ratios"],
});

describe("Recovery Pack update panel", () => {
  it("announces a specific invalid linked-pair selection without hiding the recovery action", () => {
    const issue = "Use the latest diagnostic to link the restored recheck, or keep it deleted.";
    const markup = renderToStaticMarkup(<RecoveryPackLinkIssue issue={issue} />);
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('aria-label="Linked checkpoint choices"');
    expect(markup).toContain(issue);
    expect(renderToStaticMarkup(<RecoveryPackLinkIssue issue={null} />)).toBe("");
  });
  it("explains the saved-draft barrier and keeps read-only review available after rollout is disabled", () => {
    const markup = renderToStaticMarkup(
      <RecoveryPackUpdatePanel
        quizId="round"
        insertionId="insertion"
        title="Ratios"
        canEdit={false}
        featureEnabled={false}
        currentDraftRevision={3}
        draftSignature="original"
        draftSaved
        mutationBusy={false}
        receiptRetryable={false}
        onReview={async () => {
          throw new Error("unused");
        }}
        onApply={async () => {
          throw new Error("unused");
        }}
        onUndo={async () => {
          throw new Error("unused");
        }}
      />,
    );
    expect(markup).toContain("Review Pack updates");
    expect(markup).toContain('<span lang="">Ratios</span>');
    expect(markup).toContain("Conflicts and deleted checkpoints require an explicit choice");
    expect(markup).toContain("Review first saves pending Round edits");
    expect(markup).toContain("Existing references and update comparisons remain readable");
    expect(markup).not.toContain('disabled=""');
  });
  it("labels Presentation review and saving without changing the default Round copy", () => {
    const markup = renderToStaticMarkup(
      <RecoveryPackUpdatePanel
        quizId="presentation"
        artifactLabel="Presentation"
        allowDisabledReceiptRetry
        insertionId="insertion"
        title="Ratios"
        canEdit
        featureEnabled={false}
        currentDraftRevision={3}
        draftSignature="original"
        draftSaved
        mutationBusy
        receiptRetryable={false}
        onReview={async () => {
          throw new Error("unused");
        }}
        onApply={async () => {
          throw new Error("unused");
        }}
        onUndo={async () => {
          throw new Error("unused");
        }}
      />,
    );
    expect(markup).toContain("Saving or reviewing the Presentation draft");
    expect(markup).toContain("Review first saves pending Presentation edits");
    expect(markup).not.toContain("Round");
  });
  it.each(["Round", "Presentation"] as const)(
    "describes conditional live playback for new %s sessions without changing accepted references",
    (artifactLabel) => {
      const markup = renderToStaticMarkup(
        <RecoveryPackUpdatePanel
          quizId="artifact"
          artifactLabel={artifactLabel}
          insertionId="insertion"
          title="Ratios"
          referenceContent={referenceContent}
          canEdit={false}
          featureEnabled={false}
          currentDraftRevision={3}
          draftSignature="original"
          draftSaved
          mutationBusy={false}
          receiptRetryable={false}
          onReview={async () => {
            throw new Error("unused");
          }}
          onApply={async () => {
            throw new Error("unused");
          }}
          onUndo={async () => {
            throw new Error("unused");
          }}
        />,
      );
      expect(markup).toContain("These copied references change only when you accept a Pack update");
      expect(markup).toContain(
        `Live explanation or worked-example playback is available in eligible new ${artifactLabel} sessions when enabled for the workspace`,
      );
      expect(markup).toContain(
        "The facilitator explicitly selects a card after revealing the Pack diagnostic",
      );
      expect(markup).toContain("Accepted baseline guidance.");
      expect(markup).not.toContain("not available yet");
      expect(markup).not.toContain("Compare two quantities");
      expect(markup).not.toContain("delayed probe");
    },
  );
});

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function mountedPanel(
  initial: Partial<Parameters<typeof RecoveryPackUpdatePanel<{ title: string }>>[0]> = {},
) {
  const review: RecoveryPackUpdatePreview = {
    quizId: "round",
    insertionId: "insertion",
    draftRevision: 3,
    baselineVersion: 1,
    baselineVersionId: "version-1",
    latestVersion: 2,
    latestVersionId: "version-2",
    baselineContent: referenceContent,
    latestContent: referenceContent,
    contextChanged: true,
    items: [
      {
        role: "diagnostic",
        questionId: referenceContent.diagnostic.id,
        baseline: referenceContent.diagnostic,
        local: referenceContent.diagnostic,
        latest: { ...referenceContent.diagnostic, prompt: "New author prompt 原文" },
        status: "source_changed",
      },
      {
        role: "recheck",
        questionId: referenceContent.recheck.id,
        baseline: referenceContent.recheck,
        local: referenceContent.recheck,
        latest: referenceContent.recheck,
        status: "conflict",
      },
    ],
  };
  const props = {
    quizId: "round",
    insertionId: "insertion",
    title: "AUTHORED 原文",
    canEdit: true,
    featureEnabled: true,
    currentDraftRevision: 3,
    draftSignature: "original",
    draftSaved: true,
    mutationBusy: false,
    receiptRetryable: false,
    onReview: vi.fn().mockResolvedValue(review),
    onApply: vi.fn().mockResolvedValue({
      quiz: { id: "round", draft: { title: "applied" }, draftRevision: 4 },
      undo: { sourceRevision: 3, appliedRevision: 4 },
    }),
    onUndo: vi.fn().mockResolvedValue(undefined),
    ...initial,
  };
  const view = hookHarness(() => RecoveryPackUpdatePanel<{ title: string }>(props));
  const render = () => view.render();
  const controls = (type: string) => elements(render()).filter((element) => element.type === type);
  const button = (label: string) => {
    const found = controls("button").find((element) => element.props.children === label);
    if (!found) throw new Error(`Missing button: ${label}`);
    return found;
  };
  return {
    ...view,
    props,
    review,
    render,
    controls,
    button,
    html: () => renderToStaticMarkup(render()),
    click: async (label: string) => {
      (button(label).props.onClick as () => void)();
      await flushPromises();
      render();
    },
    select: (index: number, value: string) => {
      (controls("select")[index]!.props.onChange as (event: unknown) => void)({
        target: { value },
      });
      render();
    },
  };
}

describe("mounted localized Pack update state", () => {
  it("retains a review and explicit conflict selection through locale changes without rereading or changing canonical fields", async () => {
    const view = mountedPanel();
    await view.click("Review latest Pack version");
    expect(view.controls("select").map((element) => element.props.value)).toEqual([
      "use_latest",
      "",
    ]);
    view.props.locale = "ko-KR";
    view.render();
    expect(view.props.onReview).toHaveBeenCalledTimes(1);
    expect(view.controls("select").map((element) => element.props.value)).toEqual([
      "use_latest",
      "",
    ]);
    expect(view.button(packUpdateCopy("ko-KR")("Apply reviewed Pack update")).props.disabled).toBe(
      true,
    );
    view.select(1, "keep_local");
    view.props.locale = "de-DE";
    expect(view.controls("select").map((element) => element.props.value)).toEqual([
      "use_latest",
      "keep_local",
    ]);
    const html = view.html();
    expect(html).toContain('<span lang="">AUTHORED 原文</span>');
    expect(html).toContain('<span lang="">New author prompt 原文</span>');
    expect(html).toContain('lang="en-CA">numeric');
    expect(html).toContain('<pre lang="en-CA">');
    expect(html).toContain("&quot;linkedRecheckQuestionId&quot;");
    await view.click(packUpdateCopy("de-DE")("Apply reviewed Pack update"));
    expect(view.props.onApply).toHaveBeenCalledWith(
      expect.objectContaining({
        quizId: "round",
        insertionId: "insertion",
        packVersionId: "version-2",
        expectedRevision: 3,
        choices: [
          { role: "diagnostic", action: "use_latest" },
          { role: "recheck", action: "keep_local" },
        ],
      }),
    );
    expect(
      JSON.stringify((view.props.onApply as ReturnType<typeof vi.fn>).mock.calls[0]),
    ).not.toContain("locale");
    view.unmount();
  });
  it("retries exact apply and undo attempts across locale changes and preserves permission and disabled-feature fences", async () => {
    const applyBodies: string[] = [],
      undoBodies: string[] = [];
    const view = mountedPanel({
      artifactLabel: "Presentation",
      allowDisabledReceiptRetry: true,
      onApply: vi.fn(async (input) => {
        applyBodies.push(JSON.stringify(input));
        if (applyBodies.length === 1) throw new Error("Network failure — canonical diagnostic");
        return {
          quiz: { id: "round", draft: { title: "applied" }, draftRevision: 4 },
          undo: { sourceRevision: 3, appliedRevision: 4 },
        };
      }),
      onUndo: vi.fn(async (input) => {
        undoBodies.push(JSON.stringify(input));
        if (undoBodies.length === 1) throw new Error("Network failure");
      }),
    });
    await view.click("Review latest Pack version");
    view.select(1, "keep_local");
    await view.click("Apply reviewed Pack update");
    view.props.receiptRetryable = true;
    view.props.draftSaved = false;
    view.props.featureEnabled = false;
    view.props.locale = "de-DE";
    const retry = packUpdateCopy("de-DE")("Retry Pack update acknowledgement");
    expect(view.html()).toContain('lang="en-CA">Network failure — canonical diagnostic');
    expect(view.button(retry).props.disabled).toBe(false);
    view.props.canEdit = false;
    expect(view.button(retry).props.disabled).toBe(true);
    await view.click(retry);
    expect(applyBodies).toHaveLength(1);
    view.props.canEdit = true;
    view.props.allowDisabledReceiptRetry = false;
    expect(view.button(retry).props.disabled).toBe(true);
    await view.click(retry);
    expect(applyBodies).toHaveLength(1);
    view.props.allowDisabledReceiptRetry = true;
    await view.click(retry);
    expect(applyBodies).toHaveLength(2);
    expect(applyBodies[1]).toBe(applyBodies[0]);
    view.props.receiptRetryable = false;
    view.props.draftSaved = true;
    view.props.currentDraftRevision = 4;
    view.props.draftSignature = JSON.stringify({ title: "applied" });
    expect(view.button(packUpdateCopy("de-DE")("Undo this Pack update")).props.disabled).toBe(
      false,
    );
    await view.click(packUpdateCopy("de-DE")("Undo this Pack update"));
    view.props.receiptRetryable = true;
    view.props.draftSaved = false;
    view.props.locale = "ko-KR";
    await view.click(packUpdateCopy("ko-KR")("Retry undo acknowledgement"));
    expect(undoBodies).toHaveLength(2);
    expect(undoBodies[1]).toBe(undoBodies[0]);
    expect(view.html()).toContain(
      packUpdateCopy("ko-KR")("Pack update undone as a new draft revision."),
    );
    view.unmount();
  });
  it("keeps read-only comparisons available and invalidates only when the actual draft changes", async () => {
    const view = mountedPanel({ canEdit: false, featureEnabled: false, locale: "ko-KR" });
    await view.click(packUpdateCopy("ko-KR")("Review latest Pack version"));
    expect(view.controls("select").every((element) => element.props.disabled)).toBe(true);
    await view.click(packUpdateCopy("ko-KR")("Apply reviewed Pack update"));
    expect(view.props.onApply).not.toHaveBeenCalled();
    view.props.locale = "de-DE";
    expect(view.controls("select")).toHaveLength(2);
    view.props.draftSignature = "new local work";
    expect(view.controls("select")).toHaveLength(0);
    expect(view.html()).toContain(
      packUpdateCopy("de-DE")(
        "The draft changed. Review the Pack update again before applying it.",
      ),
    );
    view.unmount();
  });
  it("translates exact callback guards while retaining an in-flight review through a locale switch", async () => {
    let resolve!: (review: RecoveryPackUpdatePreview) => void;
    const pending = new Promise<RecoveryPackUpdatePreview>((done) => {
      resolve = done;
    });
    const view = mountedPanel({ onReview: vi.fn().mockReturnValue(pending) });
    (view.button("Review latest Pack version").props.onClick as () => void)();
    view.props.locale = "ko-KR";
    view.render();
    resolve(view.review);
    await flushPromises();
    expect(view.controls("select")).toHaveLength(2);
    expect(view.props.onReview).toHaveBeenCalledTimes(1);
    view.props.onReview = vi
      .fn()
      .mockRejectedValue(
        new Error("Finish saving or reload this Presentation before reviewing a Pack update."),
      );
    await view.click(packUpdateCopy("ko-KR")("Review latest Pack version"));
    expect(view.html()).toContain('role="alert" lang="ko-KR"');
    expect(view.html()).toContain("저장을 완료하거나 다시 불러오세요");
    view.unmount();
  });
});
