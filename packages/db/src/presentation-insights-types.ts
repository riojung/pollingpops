import { ScopedQnaReceiptSchema } from "@openround/contracts";

export interface PresentationRevealRosterSelector {
  blockId: string;
  sequence: number;
}
export interface PresentationRevealRosterCount extends PresentationRevealRosterSelector {
  participantCount: number | null;
}
export const presentationRevealRosterSelectors = {
  parse(value: PresentationRevealRosterSelector[]): PresentationRevealRosterSelector[] {
    if (!Array.isArray(value) || value.length > 200)
      throw new Error("Choose at most200 reveal selectors");
    return value.map((row) => {
      const blockId = ScopedQnaReceiptSchema.shape.resourceId.parse(row.blockId).toLowerCase();
      if (!Number.isSafeInteger(row.sequence) || row.sequence < 1)
        throw new Error("Invalid reveal sequence");
      return { blockId, sequence: row.sequence };
    });
  },
};
export interface ScopedQnaInsightsCounts {
  status: "available" | "not_enabled" | "unavailable";
  audienceSeq: number | null;
  asOf: Date;
  publicQuestionCount: number;
  answeredQuestionCount: number;
  unansweredQuestionCount: number;
  upvoteCount: number;
}
export interface ScopedQnaInsightsContext {
  workspaceId: string;
  scopeId: string;
  now?: Date;
}
