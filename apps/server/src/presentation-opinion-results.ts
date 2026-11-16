import type { PresentationBlock, PresentationOpinionResultSummary } from "@openround/contracts";
import type { PresentationSessionResponseRecord } from "@openround/db";
import { presentationResponseForBlock } from "./presentation-response-identifiers.js";

/** Aggregate allowlist shared by live delivery and durable reports. No response identities escape. */
export function presentationOpinionSummary(
  block: PresentationBlock | null,
  responses: readonly PresentationSessionResponseRecord[],
): PresentationOpinionResultSummary | undefined {
  if (block?.kind !== "question") return undefined;
  const question = block.question;
  const current = responses.flatMap((response) => {
    const projected = presentationResponseForBlock(block, response);
    return projected ? [projected] : [];
  });
  if (question.type === "poll" && (question.maxSelections ?? 1) > 1) {
    return {
      kind: "poll",
      blockId: block.id,
      responseCount: current.length,
      maxSelections: question.maxSelections ?? 1,
      totalSelections: current.reduce(
        (sum, entry) => sum + (entry.response.choiceIds?.length ?? 0),
        0,
      ),
      choices: question.choices.map(({ id, label }) => {
        const count = current.filter((entry) => entry.response.choiceIds?.includes(id)).length;
        return {
          choiceId: id,
          label,
          count,
          percentOfRespondents: current.length
            ? Math.round((count / current.length) * 10_000) / 100
            : 0,
        };
      }),
    };
  }
  if (question.type !== "ranking") return undefined;
  const rankCount = question.rankCount ?? question.choices.length;
  const choices = question.choices.map(({ id, label }, authoredIndex) => {
    const rankCounts = Array.from({ length: rankCount }, () => 0);
    let weightedScore = 0;
    let rankedRespondents = 0;
    let sumRank = 0;
    for (const entry of current) {
      const index = entry.response.orderedChoiceIds?.indexOf(id) ?? -1;
      if (index < 0 || index >= rankCount) continue;
      rankCounts[index]! += 1;
      // This is the Round weighting, including top-N rankings: authored choice count minus
      // zero-based position. Unranked choices receive zero points.
      weightedScore += question.choices.length - index;
      rankedRespondents += 1;
      sumRank += index + 1;
    }
    return {
      choiceId: id,
      label,
      weightedScore,
      rankedRespondents,
      averageRank: rankedRespondents ? Math.round((sumRank / rankedRespondents) * 100) / 100 : null,
      rankCounts,
      authoredIndex,
    };
  });
  choices.sort((a, b) => b.weightedScore - a.weightedScore || a.authoredIndex - b.authoredIndex);
  return {
    kind: "ranking",
    blockId: block.id,
    responseCount: current.length,
    rankCount,
    totalRankings: current.reduce(
      (sum, entry) => sum + (entry.response.orderedChoiceIds?.length ?? 0),
      0,
    ),
    choices: choices.map(({ authoredIndex: _authoredIndex, ...choice }) => choice),
  };
}
