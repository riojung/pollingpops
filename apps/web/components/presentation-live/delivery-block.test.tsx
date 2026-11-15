import { randomUUID } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  PresentationParticipantCurrentBlockSchema,
  type PresentationParticipantCurrentBlock,
} from "@openround/contracts";
import { PresentationDeliveryBlock } from "./delivery-block";
import { LocaleProvider } from "../locale-provider";
import { loadMessages } from "../../lib/i18n/catalog";
import {
  createNativeContentBlock,
  createNativeLinkNode,
  createNativeRevealNode,
} from "../../lib/presentation-native-scene";

vi.mock("next/navigation", () => ({
  usePathname: () => "/presentation-session/session/stage",
}));

const design = { theme: "sunset", font: "serif", spacing: "compact" } as const;

function questionBlock(type = "single_select") {
  return PresentationParticipantCurrentBlockSchema.parse({
    id: randomUUID(),
    kind: "question",
    design,
    question: {
      id: randomUUID(),
      type,
      prompt: "A live audience question",
      choices: ["single_select", "true_false", "multi_select", "poll", "ranking"].includes(type)
        ? [
            { id: randomUUID(), label: "First answer", isCorrect: true },
            { id: randomUUID(), label: "Second answer", isCorrect: false },
          ]
        : [],
      ...(type === "rating"
        ? { rating: { min: 2, max: 4, minLabel: "Not yet", maxLabel: "Ready" } }
        : {}),
      timeLimitSeconds: 30,
      basePoints: ["rating", "poll", "ranking", "open_text", "word_cloud"].includes(type) ? 0 : 100,
      mediaId: null,
      mediaAlt: null,
    },
  });
}

function render(block: PresentationParticipantCurrentBlock) {
  return renderToStaticMarkup(<PresentationDeliveryBlock block={block} renderMedia={() => null} />);
}

describe("Presentation live delivery artwork", () => {
  it("keeps fixed-layout native display artwork interactive and leaves ordinary delivery unchanged", () => {
    const draft = createNativeContentBlock();
    const link = {
      ...createNativeLinkNode(),
      label: "Audience evidence",
      href: "https://example.test/evidence",
    };
    const reveal = {
      ...createNativeRevealNode(),
      label: "More audience context",
      body: "Audience context stays closed until requested",
    };
    const mediaId = randomUUID();
    draft.scene!.schemaVersion = 5;
    draft.scene!.nodes.push(link, reveal, {
      id: "authorized-image",
      type: "image",
      mediaId,
      altText: "Authorized display image",
      frame: { x: 70, y: 50, width: 20, height: 30 },
    });
    draft.scene!.readingOrder.push(link.id, reveal.id, "authorized-image");
    const { speakerNotes: privateNotes, ...publicBlock } = draft;
    void privateNotes;
    const block = PresentationParticipantCurrentBlockSchema.parse({ ...publicBlock, design });
    const before = structuredClone(block);
    const renderMedia = vi.fn((_mediaId, altText) => (
      <img src="/authorized-stage-image" alt={altText ?? ""} />
    ));
    const fixed = renderToStaticMarkup(
      <PresentationDeliveryBlock
        block={block}
        renderMedia={renderMedia}
        interactionRuntime={{ mode: "live_audience" }}
        fixedLayout
      />,
    );
    expect(fixed).toMatch(/<article[^>]*data-native-fixed-layout="true"/);
    expect(fixed).toContain('href="https://example.test/evidence"');
    expect(fixed).toContain('target="_blank" rel="noopener noreferrer"');
    expect(fixed).toContain('data-native-interaction="reveal"');
    expect(fixed).toContain('aria-expanded="false"');
    expect(fixed).toContain("Show on this screen");
    expect(fixed).not.toContain(reveal.body);
    expect(fixed).not.toContain('inert=""');
    expect(fixed).not.toContain("data-static-thumbnail");
    expect(renderMedia).toHaveBeenCalledWith(mediaId, "Authorized display image");
    expect(fixed).toContain('src="/authorized-stage-image"');
    const ordinary = renderToStaticMarkup(
      <PresentationDeliveryBlock
        block={block}
        renderMedia={renderMedia}
        interactionRuntime={{ mode: "live_audience" }}
      />,
    );
    expect(ordinary).not.toContain("data-native-fixed-layout");
    expect(fixed.replace(' data-native-fixed-layout="true"', "")).toBe(ordinary);
    expect(block).toEqual(before);
  });

  it("localizes Korean moderation guidance using only delivery messages and preserves authored material", async () => {
    const markup = renderToStaticMarkup(
      <LocaleProvider
        initialLocale="ko-KR"
        initialDomains={["live-delivery"]}
        initialMessages={await loadMessages("ko-KR", ["live-delivery"])}
      >
        <PresentationDeliveryBlock block={questionBlock("open_text")} renderMedia={() => null} />
      </LocaleProvider>,
    );
    expect(markup).toContain('<p lang="ko-KR">응답은 검토 후 표시됩니다.</p>');
    expect(markup).toContain("A live audience question");
    expect(markup).not.toContain("Responses are reviewed before they appear.");
    expect(markup).not.toContain("Correct answer");
  });

  it("uses shared deck styling and marks answers only after an explicit reveal", () => {
    const block = questionBlock();
    if (block.kind !== "question") throw new Error("Expected question");
    const open = render(block);
    expect(open).toContain('data-presentation-activity="true"');
    expect(open).toContain('data-activity-theme="sunset"');
    expect(open).toContain('data-activity-font="serif"');
    expect(open).toContain('data-activity-spacing="compact"');
    expect(open).not.toContain("Correct answer");
    expect(open).not.toContain("data-revealed-correct");
    const revealed = renderToStaticMarkup(
      <PresentationDeliveryBlock
        block={block}
        renderMedia={() => null}
        revealedAnswer={{
          kind: "choice",
          correctChoiceIds: [block.question.choices[1]!.id],
          explanation: "Revealed explanation",
        }}
      />,
    );
    expect(revealed.match(/data-revealed-correct="true"/g)).toHaveLength(1);
    expect(revealed).toContain("Correct answer");
    expect(revealed).toContain("Revealed explanation");
  });

  it("defaults old questions to Paper and renders authorized media only when present", () => {
    const block = questionBlock();
    if (block.kind !== "question") throw new Error("Expected question");
    const { design: _design, ...legacy } = block;
    void _design;
    const renderMedia = vi.fn(() => <img alt="Authorized diagram" />);
    const markup = renderToStaticMarkup(
      <PresentationDeliveryBlock block={legacy} renderMedia={renderMedia} />,
    );
    expect(markup).toContain('data-activity-theme="paper"');
    expect(markup).toContain('data-has-media="false"');
    expect(renderMedia).not.toHaveBeenCalled();
    const mediaId = randomUUID();
    const withMedia = renderToStaticMarkup(
      <PresentationDeliveryBlock
        block={{
          ...block,
          question: { ...block.question, mediaId, mediaAlt: "Authorized diagram" },
        }}
        renderMedia={renderMedia}
      />,
    );
    expect(renderMedia).toHaveBeenCalledWith(mediaId, "Authorized diagram");
    expect(withMedia).toContain('data-has-media="true"');
    expect(withMedia).toContain('alt="Authorized diagram"');
  });

  it.each(["numeric", "rating", "open_text", "word_cloud"])(
    "renders the public %s format with default empty choices",
    (type) => {
      const markup = render(questionBlock(type));
      expect(markup).toContain("A live audience question");
      expect(markup).not.toContain('aria-label="Answer choices"');
      if (type === "rating") {
        expect(markup).toContain('aria-label="Rating scale from 2 to 4"');
        expect(markup).toContain("Not yet");
        expect(markup).toContain("Ready");
      }
      if (type === "open_text" || type === "word_cloud")
        expect(markup).toContain("Responses are reviewed before they appear.");
    },
  );

  it("keeps numeric answer material in the explicit reveal footer", () => {
    const block = questionBlock("numeric");
    expect(render(block)).not.toContain("42");
    const revealed = renderToStaticMarkup(
      <PresentationDeliveryBlock
        block={block}
        renderMedia={() => null}
        revealedAnswer={{
          kind: "numeric",
          correctValue: "42",
          tolerance: "2",
          unit: "units",
          explanation: "Revealed numeric explanation",
        }}
      />,
    );
    expect(revealed).toContain("42 ± 2 units");
    expect(revealed).toContain("Revealed numeric explanation");
  });

  it("passes inherited design to public imported content", () => {
    const block = PresentationParticipantCurrentBlockSchema.parse({
      id: randomUUID(),
      kind: "content",
      layout: "title",
      textElements: [
        { id: "title", role: "title", text: "Imported takeaway", region: "top_center", order: 0 },
      ],
      mediaId: null,
      mediaAlt: null,
      design,
    });
    expect(render(block)).toContain('data-design-theme="sunset"');
    expect(render(block)).toContain("Imported takeaway");
  });
});
