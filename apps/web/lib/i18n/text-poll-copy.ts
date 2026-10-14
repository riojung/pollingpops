/** English fallback for the new moderated text workflow, matching the Companion rollout. */
export const textPollAuthoringEnglishMessages = {
  "delivery.builder.type.open_text": "Open text",
  "delivery.builder.type.word_cloud": "Word cloud",
  "delivery.builder.textResponseHelp":
    "Participants submit plain text up to {limit} characters. Responses wait for facilitator approval. This opinion question is unscored.",
  "delivery.builder.textQuestionLimit":
    "Use up to {limit} open-text or word-cloud questions in one Round. Split additional questions into another Round.",
  "delivery.builder.textLiveOnly":
    "Moderated text and word-cloud polls currently support live Rounds only.",
} as const;

export const textPollLiveEnglishMessages = {
  "live.text.responseLabel": "Your response",
  "live.text.phraseLabel": "A word or short phrase",
  "live.text.characterLimit": "{count} of {limit} characters",
  "live.text.reviewPrivacy":
    "Your response goes to the facilitator for review. Only approved responses can appear publicly after reveal. Do not include private information.",
  "live.text.receiptPending": "Response saved and waiting for facilitator review.",
  "live.text.receiptApproved": "Response saved and approved.",
  "live.text.receiptRemoved": "Response saved. The facilitator removed it from public results.",
  "live.text.error.empty": "Enter a response before submitting.",
  "live.text.error.length": "Use up to {limit} characters.",
  "live.text.error.characters": "Remove unsupported control characters from your response.",
  "live.text.approvedResults": "Approved responses",
  "live.text.approvedRespondents": "{count} approved respondents",
  "live.text.publicThreshold":
    "Approved responses appear after reveal and at least five approved respondents.",
  "live.text.wordCounts": "Word-cloud counts",
  "live.text.term": "Word or phrase",
  "live.text.count": "Count",
  "live.text.loading": "Loading responses…",
  "live.text.refresh": "Refresh responses",
  "live.text.previousPage": "Previous page",
  "live.text.nextPage": "Next page",
  "live.text.connectionRequired": "Reconnect to refresh responses.",
  "live.text.scope": "Question moderation scope",
  "live.text.currentQuestion": "Current question",
  "live.text.allQuestions": "All questions",
  "live.text.earlierQuestion": "Earlier question",
  "live.text.moderation": "Text response moderation",
  "live.text.moderationHelp":
    "Review plain-text responses before approving them for public results. Removal is permanent for this session.",
  "live.text.moderationClosed":
    "This session has ended. Text responses can no longer be moderated.",
  "live.text.filter": "Response moderation filter",
  "live.text.status.pending": "Pending",
  "live.text.status.approved": "Approved",
  "live.text.status.removed": "Removed",
  "live.text.emptyQueue": "No responses in this view.",
  "live.text.removedBody": "Removed response",
  "live.text.approve": "Approve response",
  "live.text.remove": "Remove response",
  "live.text.participant": "Participant",
  "live.text.roomCapacity":
    "Rounds with text or word-cloud polls support up to {limit} participants.",
} as const;
