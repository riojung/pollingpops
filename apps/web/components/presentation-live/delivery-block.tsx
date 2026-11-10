import type { ReactNode } from "react";
import type {
  PresentationParticipantCurrentBlock,
  PresentationRevealedAnswer,
} from "@openround/contracts";
import { ContentSlideView } from "../presentation/content-slide-view";
import { PresentationActivitySlide } from "../presentation/presentation-activity-slide";
import styles from "./presentation-delivery.module.css";
import type { NativeSceneInteractionRuntime } from "../presentation/native-scene-interaction-view";
import { useLocale } from "../locale-provider";
import { presentationActivityCopy } from "../presentation/presentation-activity-copy";

export function PresentationDeliveryBlock({
  block,
  renderMedia,
  revealedAnswer = null,
  interactionSourceKey,
  interactionRuntime,
}: {
  block: PresentationParticipantCurrentBlock;
  renderMedia: (mediaId: string | null, altText: string | null) => ReactNode;
  revealedAnswer?: PresentationRevealedAnswer | null;
  interactionSourceKey?: string;
  interactionRuntime?: NativeSceneInteractionRuntime;
}) {
  const { locale } = useLocale();
  const copy = presentationActivityCopy(locale);
  if (block.kind === "content") {
    return (
      <ContentSlideView
        block={block}
        designOverride={block.design}
        interactionSourceKey={interactionSourceKey}
        interactionRuntime={interactionRuntime}
        variant="live"
        media={renderMedia(block.mediaId, block.mediaAlt)}
        renderSceneImage={(id, alt) => renderMedia(id, alt)}
      />
    );
  }
  return (
    <div className={styles.block}>
      <PresentationActivitySlide
        question={block.question}
        design={block.design}
        media={
          block.question.mediaId
            ? renderMedia(block.question.mediaId, block.question.mediaAlt)
            : undefined
        }
        revealedChoiceIds={
          revealedAnswer?.kind === "choice" ? revealedAnswer.correctChoiceIds : undefined
        }
      />
      {block.question.type === "open_text" || block.question.type === "word_cloud" ? (
        <p lang={locale}>{copy.reviewNotice}</p>
      ) : null}
      {revealedAnswer?.kind === "numeric" ? (
        <p lang="">
          {revealedAnswer.correctValue}
          {revealedAnswer.tolerance !== "0" ? ` ± ${revealedAnswer.tolerance}` : ""}
          {revealedAnswer.unit ? ` ${revealedAnswer.unit}` : ""}
        </p>
      ) : null}
      {revealedAnswer?.explanation ? <p lang="">{revealedAnswer.explanation}</p> : null}
    </div>
  );
}
