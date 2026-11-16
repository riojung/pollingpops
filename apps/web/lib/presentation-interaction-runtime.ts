import type {
  PresentationHostSnapshot,
  PresentationParticipantSnapshot,
  PresentationCompanionSnapshot,
  PresentationStageSnapshot,
} from "@openround/contracts";
import type { NativeSceneInteractionRuntime } from "../components/presentation/native-scene-interaction-view";

type Snapshot =
  | PresentationHostSnapshot
  | PresentationParticipantSnapshot
  | PresentationCompanionSnapshot
  | PresentationStageSnapshot;

export function presentationInteractionRuntime(
  snapshot: Snapshot | null,
  options: Pick<NativeSceneInteractionRuntime, "mode" | "disabled" | "onNavigate" | "onSetReveal">,
): NativeSceneInteractionRuntime {
  const blockId = snapshot?.currentBlock?.id;
  return {
    ...options,
    revealedNodeIds:
      snapshot?.interactionState?.reveals
        .filter((entry) => entry.blockId.toLowerCase() === blockId?.toLowerCase() && entry.revealed)
        .map((entry) => entry.nodeId) ?? [],
    navigationTargets:
      snapshot && "navigation" in snapshot
        ? (snapshot.navigation?.entries.map((entry) => ({
            blockId: entry.blockId,
            available: entry.canJump && entry.status !== "current",
            blockedReason: entry.blockedReason,
          })) ?? [])
        : [],
  };
}
