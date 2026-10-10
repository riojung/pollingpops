import type { SurveyDraft, SurveyResponses } from "@openround/contracts/surveys";
export interface SurveyAttempt {
  roomId: string;
  content: SurveyDraft;
  closesAt: string;
  closed: boolean;
  revision: number;
  responses: SurveyResponses;
  finalized: boolean;
  receipt: string | null;
}
export interface SurveyRecordView {
  id: string;
  draft: SurveyDraft;
  revision: number;
  status: "draft" | "published" | "archived";
  publishedRevision: number | null;
  versionId: string | null;
}
export function surveyAccessToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
/** getRandomValues also works on LAN HTTP development URLs, unlike randomUUID. */
export function surveyMutationKey() {
  const value = surveyAccessToken();
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-4${value.slice(13, 16)}-8${value.slice(17, 20)}-${value.slice(20, 32)}`;
}
