import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import type * as ApiModule from "../../lib/api";
import { hookHarness, flushPromises } from "../canvas-artifact-links/test-support";
import { packInsertionCopy } from "../../lib/i18n/pack-insertion-copy";
import { randomUUID } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import {
  RecoveryPackContentSchema,
  recoveryPackContentHash,
  type RecoveryPackInsertion,
} from "@openround/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  RecoveryPackPresentationPicker,
  RecoveryPackPresentationReferences,
} from "./recovery-pack-insertion";

const mocked = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("../../lib/api", async (original) => ({
  ...(await original<typeof ApiModule>()),
  apiFetch: mocked.fetch,
}));
vi.mock("react", async (original) => {
  const { hookReact } = await import("../canvas-artifact-links/test-support");
  return hookReact(await original<typeof ReactModule>());
});

function insertion(): RecoveryPackInsertion {
  const recheckId = randomUUID();
  const diagnostic = {
    id: randomUUID(),
    type: "numeric",
    prompt: "What is half of 8?",
    correctValue: "4",
    tolerance: "0",
    unit: null,
    purpose: "diagnostic",
    delivery: "main",
    confidence: "off",
    conceptKeys: ["halves"],
    linkedRecheckQuestionId: recheckId,
    timeLimitSeconds: 30,
    basePoints: 1_000,
    explanation: "Divide by two.",
    mediaId: null,
    mediaAlt: null,
  };
  const content = RecoveryPackContentSchema.parse({
    schemaVersion: 1,
    title: "Half < whole",
    description: "",
    diagnostic,
    recheck: {
      ...diagnostic,
      id: recheckId,
      prompt: "What is half of 12?",
      correctValue: "6",
      delivery: "recheck",
      linkedRecheckQuestionId: null,
    },
    interventions: [
      {
        id: randomUUID(),
        title: "Compare < quantities",
        body: '<script>alert("card")</script>\nDraw two equal groups.',
        citations: [
          {
            sourceName: "Teacher < notes",
            sourceDigest: "a".repeat(64),
            locator: "p. 2",
            excerpt: "Equal groups",
          },
        ],
      },
    ],
    delayedProbe: null,
    conceptKeys: ["halves"],
    misconceptionKeys: [],
    citations: [],
  });
  return {
    id: randomUUID(),
    packId: randomUUID(),
    packVersionId: randomUUID(),
    packVersion: 2,
    contentHash: recoveryPackContentHash(content),
    diagnosticQuestionId: randomUUID(),
    recheckQuestionId: randomUUID(),
    originalContent: content,
  };
}

describe("Presentation Recovery Pack authoring", () => {
  it("renders frozen plaintext references without fetching the source or exposing checkpoint answers", () => {
    const markup = renderToStaticMarkup(
      <RecoveryPackPresentationReferences insertions={[insertion()]} />,
    );
    expect(markup).toContain('aria-label="Recovery Pack facilitator references"');
    expect(markup).toContain("Half &lt; whole");
    expect(markup).toContain('<h2 lang="">Compare &lt; quantities</h2>');
    expect(markup).toContain("version 2");
    expect(markup).toContain("&lt;script&gt;");
    expect(markup).not.toContain("<script>");
    expect(markup).toContain("Teacher &lt; notes, p. 2");
    expect(markup).toContain("Equal groups");
    expect(markup).toContain("Frozen facilitator references from the accepted source baseline");
    expect(markup).toContain("do not update these cards until you accept an update");
    expect(markup).toContain(
      "Live explanation or worked-example playback is available in eligible new Presentation sessions when enabled for the workspace",
    );
    expect(markup).toContain(
      "The facilitator explicitly selects a card after revealing the Pack diagnostic",
    );
    expect(markup).not.toContain("not available yet");
    expect(markup).not.toContain("What is half of 8?");
    expect(renderToStaticMarkup(<RecoveryPackPresentationReferences insertions={[]} />)).toBe("");
  });

  it("reads accepted update context while retaining the original inserted snapshot", () => {
    const original = insertion();
    const acceptedContent = {
      ...original.originalContent,
      title: "Accepted newer Pack",
      interventions: original.originalContent.interventions.map((card) => ({
        ...card,
        body: "New accepted guidance",
      })),
    };
    const markup = renderToStaticMarkup(
      <RecoveryPackPresentationReferences
        insertions={[
          {
            ...original,
            updateBaseline: {
              packVersionId: randomUUID(),
              packVersion: 3,
              contentHash: recoveryPackContentHash(acceptedContent),
              content: acceptedContent,
            },
          },
        ]}
      />,
    );
    expect(markup).toContain("Accepted newer Pack");
    expect(markup).toContain("version 3");
    expect(markup).toContain("New accepted guidance");
    expect(markup).not.toContain("Draw two equal groups");
    expect(original.originalContent.title).toBe("Half < whole");
  });

  it("keeps initial insertion unavailable until a published version has loaded", () => {
    const markup = renderToStaticMarkup(
      <RecoveryPackPresentationPicker
        busy={false}
        error=""
        retryVersionId={null}
        afterSelectedBlock
        onInsert={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain("Loading published Packs");
    expect(markup).toContain("after the selected block");
    expect(markup).toContain("Cards are not audience slides.");
    expect(markup).toContain(
      "Live explanation or worked-example playback is available in eligible new Presentation sessions when enabled for the workspace",
    );
    expect(markup).toContain(
      "The facilitator explicitly selects a card after revealing the Pack diagnostic",
    );
    expect(markup).not.toContain("or live playback");
    expect(markup).toContain('<button disabled="" type="button">Insert Pack checkpoints</button>');
  });

  it("offers only the retained operation on a lost acknowledgement and prevents cancellation", () => {
    const markup = renderToStaticMarkup(
      <RecoveryPackPresentationPicker
        busy={false}
        error="Network failure"
        retryVersionId={randomUUID()}
        afterSelectedBlock={false}
        onInsert={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(markup).toContain("Retry Pack insertion");
    expect(markup).toContain("without creating another copy");
    expect(markup).toContain('<button disabled="" type="button">Cancel</button>');
    expect(markup).not.toContain("Open Recovery Pack library");
  });
});

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}

describe("mounted localized Presentation picker", () => {
  it("retains the selected immutable version across locale changes and exposes authored content without relabeling its language", async () => {
    const pack = insertion();
    mocked.fetch.mockReset().mockImplementation(async (path: string) =>
      path === "/v1/recovery-packs"
        ? {
            packs: [
              {
                id: pack.packId,
                title: pack.originalContent.title,
                currentVersionId: pack.packVersionId,
              },
            ],
          }
        : { version: { id: pack.packVersionId, version: 2, content: pack.originalContent } },
    );
    vi.stubGlobal("document", { activeElement: null });
    vi.stubGlobal("HTMLElement", class {});
    const props: Parameters<typeof RecoveryPackPresentationPicker>[0] = {
      locale: "ko-KR",
      busy: false,
      error: "",
      retryVersionId: null,
      afterSelectedBlock: false,
      onInsert: vi.fn(),
      onClose: vi.fn(),
    };
    const view = hookHarness(() => RecoveryPackPresentationPicker(props));
    try {
      view.render();
      await flushPromises();
      view.render();
      await flushPromises();
      const initial = view.render();
      expect(mocked.fetch).toHaveBeenCalledTimes(2);
      const html = renderToStaticMarkup(initial);
      expect(html).toContain('role="dialog"');
      expect(html).toContain('lang="ko-KR"');
      expect(html).toContain('aria-label="게시된 Pack 미리보기"');
      expect(html).toContain('<dd lang="">What is half of 8?</dd>');
      expect(html).toContain('lang="" value="' + pack.packId + '"');
      props.locale = "de-DE";
      const tree = view.render();
      expect(mocked.fetch).toHaveBeenCalledTimes(2);
      const insert = elements(tree).find(
        (element) =>
          element.type === "button" &&
          element.props.children === packInsertionCopy("de-DE")("Insert Pack checkpoints"),
      )!;
      expect(insert.props.disabled).toBe(false);
      (insert.props.onClick as () => void)();
      expect(props.onInsert).toHaveBeenCalledWith(pack.packVersionId);
      props.retryVersionId = pack.packVersionId;
      props.error = "Save the latest Presentation changes before inserting a Pack.";
      const retryTree = view.render(),
        retryHtml = renderToStaticMarkup(retryTree);
      expect(retryHtml).toContain('role="alert" lang="de-DE"');
      expect(retryHtml).not.toContain("Open Recovery Pack library");
      expect(elements(retryTree).find((element) => element.type === "select")?.props.disabled).toBe(
        true,
      );
      const retry = elements(retryTree).find(
        (element) =>
          element.type === "button" &&
          element.props.children === packInsertionCopy("de-DE")("Retry Pack insertion"),
      )!;
      (retry.props.onClick as () => void)();
      expect(props.onInsert).toHaveBeenNthCalledWith(2, pack.packVersionId);
      props.error = "Unknown diagnostic — private source id";
      expect(renderToStaticMarkup(view.render())).toContain(
        'role="alert" lang="en-CA">Unknown diagnostic — private source id',
      );
    } finally {
      view.unmount();
      vi.unstubAllGlobals();
    }
  });
  it("traps keyboard focus, blocks Escape for an outstanding receipt, and restores the opener", () => {
    const opener = { focus: vi.fn() },
      first = { focus: vi.fn(), offsetParent: {} },
      last = { focus: vi.fn(), offsetParent: {} };
    class Element {}
    Object.setPrototypeOf(opener, Element.prototype);
    const documentStub = { activeElement: opener as unknown };
    vi.stubGlobal("HTMLElement", Element);
    vi.stubGlobal("document", documentStub);
    mocked.fetch.mockReset().mockReturnValue(new Promise(() => undefined));
    const props: Parameters<typeof RecoveryPackPresentationPicker>[0] = {
      busy: false,
      error: "",
      retryVersionId: "exact-version",
      afterSelectedBlock: true,
      onInsert: vi.fn(),
      onClose: vi.fn(),
      locale: "ko-KR",
    };
    const view = hookHarness(() => RecoveryPackPresentationPicker(props));
    try {
      const event = {
        key: "Escape",
        shiftKey: false,
        preventDefault: vi.fn(),
        currentTarget: { querySelectorAll: () => [first, last], focus: vi.fn() },
      };
      const key = () =>
        elements(view.render()).find((element) => element.props.role === "dialog")!.props
          .onKeyDown as (event: unknown) => void;
      key()(event);
      expect(props.onClose).not.toHaveBeenCalled();
      props.retryVersionId = null;
      props.busy = true;
      key()(event);
      expect(props.onClose).not.toHaveBeenCalled();
      props.busy = false;
      key()(event);
      expect(props.onClose).toHaveBeenCalledTimes(1);
      event.key = "Tab";
      documentStub.activeElement = last;
      key()(event);
      expect(first.focus).toHaveBeenCalledOnce();
      event.shiftKey = true;
      documentStub.activeElement = first;
      key()(event);
      expect(last.focus).toHaveBeenCalledOnce();
      props.locale = "de-DE";
      view.render();
      expect(opener.focus).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      expect(opener.focus).toHaveBeenCalledOnce();
      vi.unstubAllGlobals();
    }
  });
  it("localizes frozen reference chrome while retaining original citations and accepted content", () => {
    const pack = insertion();
    const html = renderToStaticMarkup(
      <RecoveryPackPresentationReferences locale="ko-KR" insertions={[pack]} />,
    );
    expect(html).toContain('aria-label="Recovery Pack 진행자 참조"');
    expect(html).toContain('<h2 lang="">Compare &lt; quantities</h2>');
    expect(html).toContain('aria-label="카드 인용"');
    expect(html).toContain('lang="">Teacher &lt; notes, p. 2 — Equal groups');
    expect(html).toContain("버전 2");
    expect(pack.originalContent.diagnostic.prompt).toBe("What is half of 8?");
  });
});
