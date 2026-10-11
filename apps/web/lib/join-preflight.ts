import type { JoinPreflightResponse } from "@openround/contracts";

export interface JoinPreflightState {
  requestId: number;
  code: string;
  status: "idle" | "checking" | "ready" | "failed";
  nicknamePolicy: JoinPreflightResponse["nicknamePolicy"] | null;
  artifactType: "round" | "presentation" | "feedback_room" | null;
  destination: string | null;
  message: string;
}

export const idleJoinPreflightState: JoinPreflightState = {
  requestId: 0,
  code: "",
  status: "idle",
  nicknamePolicy: null,
  artifactType: null,
  destination: null,
  message: "",
};

export function beginJoinPreflight(code: string, requestId: number): JoinPreflightState {
  return {
    requestId,
    code,
    status: "checking",
    nicknamePolicy: null,
    artifactType: null,
    destination: null,
    message: "",
  };
}

export function completeJoinPreflight(
  current: JoinPreflightState,
  requestId: number,
  response: JoinPreflightResponse,
): JoinPreflightState {
  if (current.requestId !== requestId || current.status !== "checking") return current;
  return {
    ...current,
    status: "ready",
    nicknamePolicy: response.nicknamePolicy,
    artifactType: response.artifactType ?? "round",
    destination: response.destination ?? "/join",
    message: "",
  };
}

export function failJoinPreflight(
  current: JoinPreflightState,
  requestId: number,
  message: string,
): JoinPreflightState {
  if (current.requestId !== requestId || current.status !== "checking") return current;
  return {
    ...current,
    status: "failed",
    nicknamePolicy: null,
    artifactType: null,
    destination: null,
    message,
  };
}

export function joinArtifactFor(state: JoinPreflightState, code: string) {
  if (state.code === code && state.status === "ready") return state.artifactType ?? "round";
  return null;
}

export async function resolveJoinPreflightForSubmission(
  current: JoinPreflightState,
  code: string,
  requestId: number,
  preflight: (code: string) => Promise<JoinPreflightResponse>,
): Promise<JoinPreflightState> {
  if (current.code === code && current.status === "ready") return current;

  const checking = beginJoinPreflight(code, requestId);
  return completeJoinPreflight(checking, requestId, await preflight(code));
}

export function shouldCollectJoinNickname(state: JoinPreflightState, code: string) {
  if (joinArtifactFor(state, code) === "feedback_room") return false;
  if (joinArtifactFor(state, code) === "presentation") return true;
  return !(
    state.code === code &&
    state.status === "ready" &&
    state.nicknamePolicy === "friendly_only"
  );
}

export function nicknameForJoin(
  state: JoinPreflightState,
  code: string,
  nickname: string,
): string | undefined {
  if (!shouldCollectJoinNickname(state, code)) return undefined;
  return nickname.trim() || undefined;
}
