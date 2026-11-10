import { describe, expect, it } from "vitest";
import {
  PresentationCommandSchema,
  supportedLocales,
  type PresentationControlCommand,
} from "@openround/contracts";
import {
  branchNavigationCopy,
  branchNavigationCopyKeys,
  branchNavigationRetryLabel,
  localizeBranchNavigationFeedback,
} from "./branch-navigation-copy";
import {
  companionCopy,
  type CompanionCopySource,
} from "../../lib/i18n/domains/live-delivery/companion-translations";

const id = "ABCDEFAB-1234-4123-8123-ABCDEFABCDEF";
const commandFields = {
  sessionId: id,
  commandId: id,
  controlToken: "host-control-pass".repeat(4),
  expectedRevision: 17,
};
const retryCommands = [
  { action: "jump_to_block", targetBlockId: id },
  { action: "return_to_path" },
  { action: "navigate_scene", blockId: id, nodeId: "Original Node ID" },
  { action: "follow_branch", blockId: id, branchId: id },
  { action: "set_reveal", blockId: id, nodeId: "Original Node ID", revealed: true },
  { action: "advance" },
].map((fields) => Object.freeze(PresentationCommandSchema.parse({ ...commandFields, ...fields })));

describe("branch and navigation system copy", () => {
  it.each(supportedLocales)("covers every key and interpolation in %s", (locale) => {
    const copy = branchNavigationCopy(locale);
    expect(new Set(branchNavigationCopyKeys).size).toBe(branchNavigationCopyKeys.length);
    for (const key of branchNavigationCopyKeys) {
      expect(copy(key).trim(), key).not.toBe("");
      expect(
        copy(key)
          .match(/\{\w+\}/g)
          ?.sort() ?? [],
        key,
      ).toEqual(key.match(/\{\w+\}/g)?.sort() ?? []);
      expect(copy(key, { number: "Original NUMBER", count: "Original COUNT" }), key).not.toMatch(
        /\{\w+\}/,
      );
    }
    expect(copy("Branch {number}", { number: "<raw> $& {count}" })).toContain("<raw> $& {count}");
    if (locale !== "en-CA") {
      expect(copy("Answer branches")).not.toBe("Answer branches");
      expect(copy("Presentation navigation")).not.toBe("Presentation navigation");
      expect(copy("Branch {number} minimum percent", { number: 1 })).not.toBe(
        "Branch 1 minimum percent",
      );
    }
  });

  it("retains English defaults for callers without an explicit locale", () => {
    const copy = branchNavigationCopy();
    for (const key of branchNavigationCopyKeys) expect(copy(key)).toBe(key);
  });

  it.each(supportedLocales)(
    "reuses identical Companion retry and acknowledgement wording in %s",
    (locale) => {
      for (const key of [
        "Waiting for server confirmation…",
        "Action not yet confirmed. Retry to confirm the original action.",
        "Retry return acknowledgement",
        "Retry jump acknowledgement",
        "Retry slide link acknowledgement",
        "Retry branch acknowledgement",
        "Retry broadcast reveal acknowledgement",
        "Retry action acknowledgement",
      ] as const satisfies readonly CompanionCopySource[]) {
        expect(branchNavigationCopy(locale)(key)).toBe(companionCopy(locale)(key));
      }
    },
  );

  it.each(supportedLocales)("localizes only canonical policy feedback in %s", (locale) => {
    for (const original of [
      "Enable sections and navigation in the presentation before publishing.",
      "This presentation has finished. Start a new session to present it again.",
      "Close and reveal the current activity before navigating.",
      "Complete the linked recheck before navigating.",
      "Choose a block in this session's published presentation.",
      "Present this recheck through its linked diagnostic and intervention.",
      "Start the linked diagnostic before entering this recovery sequence.",
      "You are on this block.",
      "Close and reveal this activity before following an answer branch.",
      "This branch target is unavailable.",
      "The accepted responses do not meet this branch condition.",
      "Slide navigation is unavailable here.",
    ]) {
      const result = localizeBranchNavigationFeedback(locale, original);
      expect(result.lang).toBe(locale);
      expect(result.text.trim()).not.toBe("");
      if (locale !== "en-CA") expect(result.text).not.toBe(original);
    }
    for (const count of [1, 12, 10000]) {
      const result = localizeBranchNavigationFeedback(
        locale,
        `This branch needs at least ${count} accepted responses.`,
      );
      expect(result).toEqual({
        text: branchNavigationCopy(locale)(
          "This branch needs at least {count} accepted responses.",
          {
            count,
          },
        ),
        lang: locale,
      });
    }
    for (const original of [
      "Unknown service diagnostic 74 <script>",
      "This branch needs at least 0 accepted responses.",
      "This branch needs at least 10001 accepted responses.",
      "This branch needs at least 01 accepted responses.",
      "This branch needs at least 1 accepted responses. Extra diagnostic",
    ])
      expect(localizeBranchNavigationFeedback(locale, original)).toEqual({
        text: original,
        lang: "en-CA",
      });
  });

  it.each(supportedLocales)(
    "changes retry labels without changing command identity in %s",
    (locale) => {
      for (const command of retryCommands) {
        const before = structuredClone(command);
        const label = branchNavigationRetryLabel(locale, command);
        expect(label.trim()).not.toBe("");
        if (locale !== "en-CA") expect(label).not.toContain("Retry");
        expect(command).toEqual(before);
        expect(command.commandId).toBe(id);
        expect(command.expectedRevision).toBe(17);
        expect(Object.isFrozen(command)).toBe(true);
      }
      const companion: PresentationControlCommand = {
        sessionId: id,
        commandId: id,
        expectedRevision: 17,
        companionToken: "companion-pass".repeat(4),
        action: "follow_branch",
        blockId: id,
        branchId: id,
      };
      expect(branchNavigationRetryLabel(locale, companion)).toBe(
        branchNavigationCopy(locale)("Retry branch acknowledgement"),
      );
      expect(companion.branchId).toBe(id);
    },
  );
});
