"use client";

import type {
  ApplyPresentationRecoveryPackUpdate,
  PresentationDraft,
  PresentationRecoveryPackUpdatePreview,
  RecoveryPackContent,
  SupportedLocale,
} from "@openround/contracts";
import {
  RecoveryPackUpdatePanel,
  type RecoveryPackUpdateUndo,
} from "../editor/recovery-pack-update-panel";
import {
  presentationPackReviewForPanel,
  presentationPackUpdateFromPanel,
} from "../../lib/presentation-pack-update-ui";

export interface PresentationRecoveryPackUpdateApplied {
  presentation: { id: string; draft: PresentationDraft; draftRevision: number };
  undo: { sourceRevision: number; appliedRevision: number };
}

export function PresentationRecoveryPackUpdateReview({
  presentationId,
  onReview,
  onApply,
  ...props
}: {
  presentationId: string;
  locale?: SupportedLocale;
  insertionId: string;
  title: string;
  referenceContent?: RecoveryPackContent;
  canEdit: boolean;
  featureEnabled: boolean;
  currentDraftRevision: number;
  draftSignature: string;
  draftSaved: boolean;
  mutationBusy: boolean;
  receiptRetryable: boolean;
  onReview: (insertionId: string) => Promise<PresentationRecoveryPackUpdatePreview>;
  onApply: (
    input: ApplyPresentationRecoveryPackUpdate,
  ) => Promise<PresentationRecoveryPackUpdateApplied>;
  onUndo: (input: RecoveryPackUpdateUndo) => Promise<void>;
}) {
  return (
    <RecoveryPackUpdatePanel<PresentationDraft>
      {...props}
      quizId={presentationId}
      artifactLabel="Presentation"
      allowDisabledReceiptRetry
      onReview={async (insertionId) => presentationPackReviewForPanel(await onReview(insertionId))}
      onApply={async (input) => {
        const result = await onApply(presentationPackUpdateFromPanel(input));
        return { quiz: result.presentation, undo: result.undo };
      }}
    />
  );
}
