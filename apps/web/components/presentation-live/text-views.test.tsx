import { renderToStaticMarkup } from "react-dom/server";
import type * as ReactModule from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { translate, type MessageKey } from "../../lib/i18n/catalog";
import { liveDeliveryEnglishMessages } from "../../lib/i18n/domains/live-delivery";
import { PresentationTextResults, type PresentationTextResultsProps } from "./text-results";
import { PresentationTextModerationPanel } from "./text-moderation";

const fixtures = vi.hoisted(() => ({ cursor: 0, read: null as unknown }));
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useState: <T,>(initial: T | (() => T)) => {
      if (initial === null && fixtures.cursor++ === 1) return react.useState(fixtures.read as T);
      return react.useState(initial);
    },
  };
});
vi.mock("../locale-provider", () => ({
  useLocale: () => ({
    locale: "en-CA",
    t: (key: MessageKey, values?: Record<string, string | number>) =>
      translate(liveDeliveryEnglishMessages, key, values),
  }),
}));
const props: PresentationTextResultsProps = {
  sessionId: "session",
  blockId: "block",
  type: "open_text",
  revision: 3,
  seq: 7,
  phase: "question_reveal",
  projection: "participant",
  credential: "fixture-credential",
};
const publicKey = JSON.stringify([
  "session",
  "block",
  "open_text",
  3,
  7,
  "question_reveal",
  "participant",
  null,
  0,
]);
const publicRead = {
  key: publicKey,
  credential: props.credential,
  error: "",
  data: {
    visible: true,
    approvedRespondents: 5,
    items: [{ textValue: "<script>Approved literal text</script>" }],
    terms: [],
    nextCursor: null,
  },
};

beforeEach(() => {
  fixtures.cursor = 0;
  fixtures.read = null;
});

describe("Presentation text views", () => {
  it("renders approved anonymous text literally with the existing accessible view", () => {
    fixtures.read = publicRead;
    const markup = renderToStaticMarkup(<PresentationTextResults {...props} />);
    expect(markup).toContain("5 approved respondents");
    expect(markup).toContain("&lt;script&gt;Approved literal text&lt;/script&gt;");
    expect(markup).not.toContain("<script>");
    expect(markup).not.toContain("responseId");
  });
  it.each([
    { compact: false, largestFont: 40 },
    { compact: true, largestFont: 24 },
  ])(
    "keeps complete stage counts with compact=$compact decorative sizing",
    ({ compact, largestFont }) => {
      fixtures.read = {
        ...publicRead,
        key: JSON.stringify([
          "session",
          "block",
          "word_cloud",
          3,
          7,
          "question_reveal",
          "stage",
          null,
          0,
        ]),
        data: {
          ...publicRead.data,
          items: [],
          terms: [
            { value: "café f18b536a", label: "café f18b536a", count: 3 },
            { value: "practice f18b536a", label: "practice f18b536a", count: 2 },
          ],
        },
      };
      const markup = renderToStaticMarkup(
        <PresentationTextResults
          {...props}
          type="word_cloud"
          projection="stage"
          compact={compact}
        />,
      );
      expect(markup).toContain(`font-size:${largestFont}px`);
      expect(markup).toContain('aria-hidden="true"');
      expect(markup).toContain("<caption>Word-cloud counts</caption>");
      expect(markup).toContain('scope="row" lang="">café f18b536a</th><td>3</td>');
      expect(markup).toContain('scope="row" lang="">practice f18b536a</th><td>2</td>');
      expect(markup).not.toContain("responseId");
    },
  );
  it.each([
    { seq: 8 },
    { revision: 4 },
    { blockId: "next-block" },
    { sessionId: "another-session" },
    { credential: "replacement-credential" },
    { phase: "question_open" },
    { projection: "stage" as const },
  ])("hides old text immediately when its read context changes", (change) => {
    fixtures.read = publicRead;
    const markup = renderToStaticMarkup(<PresentationTextResults {...props} {...change} />);
    expect(markup).not.toContain("Approved literal text");
  });
  it("shows useful suppression guidance without a public body or result navigation", () => {
    fixtures.read = {
      ...publicRead,
      data: { ...publicRead.data, visible: false, approvedRespondents: 4, items: [] },
    };
    const markup = renderToStaticMarkup(<PresentationTextResults {...props} />);
    expect(markup).toContain("after reveal and at least five approved respondents");
    expect(markup).not.toContain("Approved literal text");
    expect(markup).not.toContain("Next page");
  });
  it("does not reuse an earlier body after a read error", () => {
    fixtures.read = { ...publicRead, data: null, error: "Response access expired." };
    const markup = renderToStaticMarkup(<PresentationTextResults {...props} />);
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Response access expired.");
    expect(markup).not.toContain("Approved literal text");
  });

  const privateProps = {
    sessionId: "session",
    blockId: "block",
    revision: 3,
    seq: 7,
    phase: "question_open",
    credential: "host-fixture",
    disabled: false,
  };
  const privateKey = JSON.stringify([
    "session",
    "block",
    3,
    7,
    "question_open",
    "current",
    "pending",
    null,
    0,
  ]);
  const privateRead = {
    key: privateKey,
    credential: "host-fixture",
    error: "",
    data: {
      items: [
        {
          responseId: "response",
          blockId: "block",
          questionPrompt: "A question",
          authorAlias: "Private alias",
          submittedAt: "2026-11-04T12:00:00.000Z",
          textValue: "PRIVATE QUEUE BODY",
          status: "pending",
        },
      ],
      nextCursor: null,
    },
  };

  it("offers private approval/removal only with the matching current host read", () => {
    fixtures.read = privateRead;
    const markup = renderToStaticMarkup(<PresentationTextModerationPanel {...privateProps} />);
    expect(markup).toContain("PRIVATE QUEUE BODY");
    expect(markup).toContain("Approve response");
    expect(markup).toContain("Remove response");
  });
  it.each([{ seq: 8 }, { credential: "new-host" }, { credential: "" }, { phase: "finished" }])(
    "does not paint a private queue after authority or scope changes",
    (change) => {
      fixtures.read = privateRead;
      const markup = renderToStaticMarkup(
        <PresentationTextModerationPanel {...privateProps} {...change} />,
      );
      expect(markup).not.toContain("PRIVATE QUEUE BODY");
      expect(markup).not.toContain("Approve response");
      expect(markup).not.toContain("Remove response");
    },
  );
});
