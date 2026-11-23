import {
  BoardLaunchUnavailableReasonSchema,
  type BoardLaunchUnavailableReason,
} from "@openround/contracts";
import { ApiClientError } from "./api";

const messageKeys = {
  operational_pause: "boards.launch.operationalPause",
  organization_restricted: "boards.launch.organizationRestricted",
} as const satisfies Record<BoardLaunchUnavailableReason, string>;

export type BoardLaunchNoticeKey = (typeof messageKeys)[BoardLaunchUnavailableReason];

export function boardLaunchUnavailableKey(reason?: BoardLaunchUnavailableReason) {
  return reason ? messageKeys[reason] : undefined;
}

export function boardLaunchErrorKey(error: unknown) {
  if (!(error instanceof ApiClientError)) return undefined;
  return boardLaunchUnavailableKey(
    BoardLaunchUnavailableReasonSchema.safeParse(error.details?.boardLaunchUnavailableReason).data,
  );
}
