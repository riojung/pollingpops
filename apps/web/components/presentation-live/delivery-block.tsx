import type { ReactNode } from "react";
import type {
  PresentationParticipantCurrentBlock,
  PresentationRevealedAnswer,
} from "@openround/contracts";
import { ContentSlideView } from "../presentation/content-slide-view";
import styles from "./presentation-delivery.module.css";

export function PresentationDeliveryBlock({
  block,
  renderMedia,
  revealedAnswer = null,
  interactionSourceKey,
}: {
  block: PresentationParticipantCurrentBlock;
  renderMedia: (mediaId: string | null, altText: string | null) => ReactNode;
  revealedAnswer?: PresentationRevealedAnswer | null;
  interactionSourceKey?: string;
}) {
  if (block.kind === "content") {
    return (
      <ContentSlideView
        block={block}
        interactionSourceKey={interactionSourceKey}
        variant="live"
        media={renderMedia(block.mediaId, block.mediaAlt)}
        renderSceneImage={(id, alt) => renderMedia(id, alt)}
      />
    );
  }
  return (
    <div className={styles.block}>
      <h1 lang="">{block.question.prompt}</h1>
      {renderMedia(block.question.mediaId, block.question.mediaAlt)}
      <div className={styles.choices}>
        {block.question.choices.map((choice) => {
          const correct =
            revealedAnswer?.kind === "choice" &&
            revealedAnswer.correctChoiceIds.includes(choice.id);
          return (
            <div
              className={`${styles.choice}${correct ? ` ${styles.correct}` : ""}`}
              key={choice.id}
            >
              <span lang="">{choice.label}</span>
              {correct ? <p lang="en-CA">Correct answer</p> : null}
            </div>
          );
        })}
      </div>
      {!block.question.choices.length ? (
        <p lang="en-CA">
          {block.question.type === "numeric"
            ? "Enter a number on your device."
            : block.question.type === "open_text" || block.question.type === "word_cloud"
              ? "Respond on your device. Responses are reviewed before they appear."
              : "Choose a rating on your device."}
        </p>
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
