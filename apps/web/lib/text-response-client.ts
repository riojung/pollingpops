import type { RoundResponseModerationPage, RoundTextResponseResults } from "@openround/contracts";

export type TextModerationPage = RoundResponseModerationPage;
export type TextResponseResults = RoundTextResponseResults;

export interface TextReadState<T> {
  key: string;
  credential: string;
  data: T | null;
  error: string;
}

/** Never paint approved/staff text from an earlier room version or credential context. */
export function currentTextRead<T>(
  state: TextReadState<T> | null,
  key: string,
  credential: string,
) {
  return state?.key === key && state.credential === credential ? state : null;
}
