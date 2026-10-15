export const sessionSummaryEnglishMessages = {
  "summary.open": "Share summary",
  "summary.title": "Session summary",
  "summary.close": "Close",
  "summary.description":
    "Preview the aggregate summary, download it, or create an expiring share link.",
  "summary.loading": "Loading summary…",
  "summary.failed": "The summary could not be updated. Refresh and try again.",
  "summary.unavailable": "This summary is unavailable. Ask the organizer for a current share link.",
  "summary.downloads": "Download summary",
  "summary.download.pdf": "Download PDF",
  "summary.download.png": "Download image",
  "summary.download.xlsx": "Download spreadsheet",
  "summary.downloadsUnavailable": "Downloads are not available for this summary.",
  "summary.downloadFailed":
    "The download could not finish. Try again or ask the organizer for a current link.",
  "summary.downloaded": "Summary downloaded.",
  "summary.imageContent": "Image content",
  "summary.wholeSummary": "Whole summary",
  "summary.create": "Create share link",
  "summary.expiryDays": "Link lifetime in days (1–30)",
  "summary.allowDownloads": "Allow recipients to download this summary",
  "summary.bearerNotice":
    "Anyone with this link can read the aggregate summary until it expires or you revoke it. Downloaded copies cannot be revoked.",
  "summary.nextSteps": "Next steps",
  "summary.nextStepsHint":
    "Optional organizer notes (2,000 characters). These notes will be shared; leave out names and personal information.",
  "summary.expires": "Expires {date}",
  "summary.retention": "Links cannot outlive this session’s retention deadline: {date}.",
  "summary.working": "Working…",
  "summary.created": "Share link created.",
  "summary.replayed":
    "This share was already accepted. Its original link is not available again. Review existing links before creating another.",
  "summary.uncertain":
    "The request could not be confirmed. The share list has been refreshed; retrying unchanged details uses the same request.",
  "summary.saveLink":
    "Save this link now. Its secret is not stored and this exact link will not be shown again.",
  "summary.link": "Share link",
  "summary.copy": "Copy link",
  "summary.copied": "Link copied.",
  "summary.copyFailed": "Copy was blocked. Select and copy the link instead.",
  "summary.links": "Existing share links",
  "summary.noLinks": "No share links have been created.",
  "summary.refresh": "Refresh links",
  "summary.linkCreated": "Created {date}",
  "summary.linkActive": "Active",
  "summary.linkExpired": "Expired",
  "summary.linkRevoked": "Revoked",
  "summary.revoke": "Revoke link",
  "summary.revoked": "Share link revoked.",
  "summary.reason.feature_disabled":
    "New summary sharing is paused. Existing links can still be managed.",
  "summary.reason.role":
    "Your workspace role allows viewing summaries, but not creating or revoking links.",
  "summary.reason.exports_entitlement":
    "Summary exports and sharing were not included for this session.",
  "summary.participants": "Participants",
  "summary.responses": "Responses",
  "summary.questions": "Checkpoints",
  "summary.results": "Question results",
  "summary.questionRegion": "Question {number} results: {prompt}",
  "summary.response": "Response",
  "summary.value": "Value",
  "summary.sample": "{count} respondents",
  "summary.notAssessed": "Content slide · Not assessed",
  "summary.notScored": "Opinion feedback · Not scored",
  "summary.multiSelect":
    "Multiple selections allowed. Counts show respondents selecting each option; totals may exceed the respondent count.",
  "summary.accuracyValue": "Accuracy: {percent}% ({correct} of {responses} assessed responses)",
  "summary.initialAccuracy":
    "Initial accuracy: {percent}% ({correct} of {responses} assessed responses)",
  "summary.recovery": "Recovery evidence",
  "summary.recovery.linked": "Linked recheck",
  "summary.recovery.revote": "Revote",
  "summary.recoveryValue": "{recovered} of {eligible} eligible pairs recovered ({percent}%)",
  "summary.measure.respondents": "Respondent counts",
  "summary.measure.selections": "Selection counts",
  "summary.measure.weighted_points": "Weighted ranking points",
  "summary.suppression.insufficient_sample": "Evidence is hidden below five respondents.",
  "summary.suppression.participant_text":
    "Participant-written text is excluded from shared summaries.",
  "summary.suppression.unavailable": "This evidence is unavailable.",
  "summary.note.aggregate_only":
    "Aggregate results only. Participant names, individual outcomes, and raw submissions are excluded.",
  "summary.note.insufficient_sample": "Evidence from samples smaller than five is hidden.",
  "summary.note.participant_text_excluded":
    "Participant-written text and word-cloud terms are excluded.",
  "summary.note.paired_evidence":
    "Recovery counts paired recheck outcomes, not unique people or a proven causal effect.",
  "summary.note.no_scored_evidence":
    "No scored learning evidence is available; opinion feedback does not measure correctness.",
} as const;

export type SessionSummaryMessageKey = keyof typeof sessionSummaryEnglishMessages;
export type SessionSummaryMessages = Record<SessionSummaryMessageKey, string>;
export default sessionSummaryEnglishMessages;
