import type { WorkspaceProductFeatures } from "@openround/contracts";
import { helpVideoScripts, type HelpVideoKey } from "./help-video-scripts";
import {
  professionalRoundBuilderAvailable,
  professionalBuilderGuidesAvailable,
} from "./help-guide-availability";

export const helpGuideTopics = {
  start: "Getting started",
  create: "Create and organize",
  host: "Host and participate",
  interact: "Audience interaction",
  evidence: "Recovery and evidence",
  manage: "Workspace and safety",
} as const;
export type HelpGuideTopic = keyof typeof helpGuideTopics;
export type HelpGuideIcon =
  | "book"
  | "edit"
  | "choices"
  | "theme"
  | "screen"
  | "qr"
  | "people"
  | "pulse"
  | "chat"
  | "chart"
  | "shield"
  | "loop";
type ActionTarget =
  | "create"
  | "source"
  | "import"
  | "library"
  | "presentation"
  | "results"
  | "sessions"
  | "practice"
  | "groups"
  | "packs"
  | "account"
  | "join"
  | "surveys"
  | "status";
// Survey guidance is separate from graded practice and live polls.

export interface HelpFeatureGuide {
  id: string;
  title: string;
  summary: string;
  topic: HelpGuideTopic;
  icon: HelpGuideIcon;
  audience: string;
  before: readonly string[];
  steps: readonly { title: string; body: string }[];
  check: string;
  notes: readonly string[];
  troubleshooting: readonly { symptom: string; fix: string }[];
  requiredFeatures?: readonly (keyof WorkspaceProductFeatures)[];
  action: { target: ActionTarget; label: string; editorOnly?: boolean };
  video?: { guide: HelpVideoKey; chapter: string };
}

// Public instructional content only. Never store workspace or participant data here.
export const helpFeatureGuides: readonly HelpFeatureGuide[] = [
  {
    id: "sign-in",
    title: "Sign in and return to your workspace",
    topic: "start",
    icon: "shield",
    summary: "Find your email link, return to saved work, and sign out safely.",
    audience: "Creators and workspace members",
    before: [
      "Use the same browser address throughout sign-in. Participants do not need creator accounts.",
    ],
    steps: [
      {
        title: "Request a link",
        body: "Open Sign in, choose education or workplace learning, enter your email, accept the displayed policies, and select Send sign-in link.",
      },
      {
        title: "Open the right inbox",
        body: "On a hosted deployment, check that email inbox. Local Compose captures mail in Mailpit: use Open local email inbox or localhost:8025. A development-only shortcut appears only when explicitly enabled; it is not the normal production login.",
      },
      {
        title: "Return to your saved work",
        body: "Follow the single-use link. Home and Library show your saved Rounds in the professional workspace. The classic workflow uses the dashboard and My checkpoint sets.",
      },
      {
        title: "Leave securely",
        body: "Select Sign out in the workspace or account navigation. This revokes the current creator browser session, not every session on every device.",
      },
    ],
    check: "You can reopen a saved Round after signing in again, instead of creating a new one.",
    notes: [
      "Workspaces determine membership and permissions. If you belong to more than one, switch the active workspace from Account.",
    ],
    troubleshooting: [
      {
        symptom: "The page says to check your inbox, but no email arrives",
        fix: "For local Compose, open Mailpit, not your external email inbox. For hosted use, check spam and the spelling of the address; ask the operator to check SMTP delivery. Request a new link if the old one expired or was already used.",
      },
    ],
    action: { target: "account", label: "Open Account" },
    video: { guide: "quickStart", chapter: "01-sign-in" },
  },
  {
    id: "first-round",
    title: "Create your first Round",
    topic: "start",
    icon: "edit",
    summary: "Start small: one clear question, a saved draft, and a ready-to-host version.",
    audience: "Owners and editors",
    before: [
      "Sign in with editing permission. A Round is a reusable checkpoint set; a live round is one delivery of it.",
    ],
    steps: [
      {
        title: "Choose a starting point",
        body: "In the professional workspace, choose Create → Round and a blank Round, starter, source, or import. In the classic dashboard, enter a title and choose Create checkpoint set.",
      },
      {
        title: "Write one question",
        body: "Add a single-select question with a short prompt, complete answer labels, and one correct choice. Add an explanation that teaches the method, not just the answer.",
      },
      {
        title: "Save and check",
        body: "Wait for Saved. Preview the participant view and fix any validation message in the named question or field.",
      },
      {
        title: "Publish before hosting",
        body: "Publish creates an immutable delivery version. Then choose Host to create a new lobby and invite your audience.",
      },
    ],
    check:
      "Your saved Round is listed in Library or the dashboard, and has a published version you can host.",
    notes: [
      "Start with one or two questions while learning the workflow. You can expand the draft later without changing an active room.",
    ],
    troubleshooting: [
      {
        symptom: "Publish is unavailable or reports missing content",
        fix: "Complete the question prompt, every required answer label, and the correct-answer selection. Wait for Saved, then try publishing again.",
      },
    ],
    action: { target: "create", label: "Create a blank Round", editorOnly: true },
    video: { guide: "quickStart", chapter: "02-create" },
  },
  {
    id: "question-types",
    title: "Choose and configure question types",
    topic: "create",
    icon: "choices",
    summary: "Use choices, multiple selections, numbers, ratings, or polls with the right rules.",
    audience: "Owners, editors, and participants",
    before: ["Open a draft. Decide whether you need a scored check or an unscored opinion."],
    steps: [
      {
        title: "Use selected responses",
        body: "Single select allows one correct answer; true/false uses two choices. Multiple select requires the exact correct set in this release: partial selections do not receive partial credit.",
      },
      {
        title: "Use a numeric check",
        body: "Set a decimal answer, an absolute tolerance, and an optional unit. Check the accepted interval and the unit instructions in Preview. Avoid ambiguous units in the prompt.",
      },
      {
        title: "Ask for an opinion",
        body: "Rating and poll questions are unscored and have confidence turned off. They collect audience views rather than correct/incorrect judgments.",
      },
      {
        title: "Set delivery and feedback",
        body: "Choose the timer, points where applicable, and explanation. For a private instructional image, provide meaningful alt text and wait for upload/scanning to finish. Image upload depends on operator configuration.",
      },
      {
        title: "Test the participant view",
        body: "Preview each format, including a narrow screen. Ensure the response instructions make sense without a projector or colour cues.",
      },
    ],
    check:
      "A participant can tell exactly what to submit, and the scoring rules match your purpose.",
    notes: [
      "Numeric responses use decimal normalization and absolute tolerance, not approximate floating-point comparisons. Ratings and polls cannot be turned into scored diagnostics.",
    ],
    troubleshooting: [
      {
        symptom: "A multiple-select response is marked incorrect",
        fix: "Compare the full selected set with the full correct set; selecting only some correct choices or an extra wrong choice is not an exact match.",
      },
      {
        symptom: "Image upload is disabled",
        fix: "Ask the deployment operator to configure private storage and malware scanning. Do not place essential instructions only in an image.",
      },
    ],
    action: { target: "library", label: "Open your Rounds" },
    video: { guide: "quickStart", chapter: "03-question" },
  },
  {
    id: "starters-and-discover",
    title: "Find and adapt a starter",
    topic: "create",
    icon: "book",
    summary: "Use first-party patterns as independent drafts, not ready-made learning evidence.",
    audience: "Owners and editors",
    before: ["Review the starter against your actual audience, concepts, and source material."],
    steps: [
      {
        title: "Browse starting patterns",
        body: "Create → Round first offers Live quiz, Live poll, Survey and Custom Round. Search the 24 original templates, filter by category/type, and preview questions before making a copy. Live polls are host-paced; Surveys are self-paced.",
      },
      {
        title: "Create your own draft",
        body: "Use the selected starter to create an independent draft. Inspect every prompt, answer, concept, and linked recheck before treating it as your content.",
      },
      {
        title: "Adapt the teaching context",
        body: "Replace examples, explanations, and distractors to fit your audience. Keep each recheck about the same concept in a fresh situation.",
      },
      {
        title: "Preview and publish",
        body: "Wait for Saved, test the participant view, and publish explicitly before hosting.",
      },
    ],
    check: "You have an audience-specific published Round rather than an unreviewed template.",
    notes: [
      "Discover is a purpose-led first-party library, not a public content marketplace. A starter does not guarantee learning quality or pilot demand.",
    ],
    troubleshooting: [
      {
        symptom: "Discover is missing from navigation",
        fix: "Discover has a separate rollout gate. Use the available template/starter gallery or start a blank Round; do not assume a missing navigation item means saved content was deleted.",
      },
    ],
    action: { target: "library", label: "Open Library" },
  },
  {
    id: "self-paced-surveys",
    title: "Create a self-paced Survey",
    topic: "create",
    icon: "choices",
    summary:
      "Share independent opinion feedback without participant accounts or linked respondent reports.",
    audience: "Owners/editors create; workspace viewers can read results",
    requiredFeatures: ["surveys"],
    before: [
      "An operator must enable the Survey beta and allowlist your workspace.",
      "Use opinion polls or rating scales, not graded diagnostics.",
    ],
    steps: [
      {
        title: "Choose Survey",
        body: "Select Create → Round → Survey, then start blank or use a feedback template. Survey creates a separate self-paced artifact, not a live Round or graded assignment.",
      },
      {
        title: "Build and review",
        body: "Edit details, add poll/rating questions, label scale endpoints, mark required/optional items, reorder, and preview. Select Save draft before leaving; this beta uses explicit saves.",
      },
      {
        title: "Publish and share",
        body: "Publish the saved draft, choose a window (seven days by default, up to 30), and create a sharing link. Copy the link, show its code or download its QR. A new link is a separate frozen run. New runs retain results after scheduled closure for 30 days on Free, 365 on Pro, or the Community operator setting; the sharing screen shows expiry. Closing early does not extend it.",
      },
      {
        title: "Answer independently",
        body: "Participants join without a nickname or account, answer at their own pace, save progress, and submit once. Refresh resumes saved responses on the same browser. Missing required items are explained before submission.",
      },
      {
        title: "Return to results",
        body: "Use Library → Browse Surveys to find your content and runs. Refresh results to count finalized submissions. Close admissions and submissions, or wait for the deadline, to release final distributions; each question needs five responses. Owners/editors can close a run, but only owners can permanently delete it. Duplicate an archived Survey to reuse its content.",
      },
    ],
    check:
      "A participant can resume saved progress and receive a submission receipt; the facilitator sees question-level totals, not linked respondent rows.",
    notes: [
      "One completion per room credential is enforced, not verified one-person participation. Another browser/device is a new credential.",
      "No alias, learning identity, score or timer is collected. Clearing browser site data loses resume access.",
      "Open text, word clouds, ranking, advanced exports, passcodes and individual credential revocation remain pending. Free shares five published items across Rounds and Surveys.",
    ],
    troubleshooting: [
      {
        symptom: "Survey creation is unavailable",
        fix: "Ask your operator to enable FEATURE_AUDIENCE_SCOPES, FEATURE_FEEDBACK_ROOMS and FEATURE_SURVEYS and include your workspace in CORE_PARITY_WORKSPACE_ALLOWLIST. Existing Surveys remain readable during a creation pause.",
      },
      {
        symptom: "Results are hidden",
        fix: "Wait for five finalized respondents; saved drafts do not count. Optional skipped questions may have fewer answers.",
      },
      {
        symptom: "A save fails",
        fix: "For uncertain network failures, retry the same operation. For a stale revision, reload before editing; never silently overwrite another editor or browser tab.",
      },
    ],
    action: { target: "surveys", label: "Open Surveys" },
  },
  {
    id: "linked-rechecks",
    title: "Prepare a linked recheck or revote",
    topic: "create",
    icon: "loop",
    summary:
      "Ask a fresh check of the same concept and keep it distinct from repeating a question.",
    audience: "Owners, editors, and facilitators",
    before: [
      "Begin with a scored main checkpoint and a clear concept. Rechecks cannot link onward or form cycles.",
    ],
    steps: [
      {
        title: "Add the recovery branch",
        body: "In the professional builder, use Recover to add a recheck for this concept. In the classic editor, use Add linked recheck.",
      },
      {
        title: "Change the situation, not the concept",
        body: "Write a fresh prompt with valid answer choices or numeric settings. Retain consistent concept tags and an explanation that teaches the method.",
      },
      {
        title: "Review the pair",
        body: "Check that the main checkpoint links to the intended recheck, preview both, wait for Saved, and publish. A main checkpoint can link to only one pre-authored recheck.",
      },
      {
        title: "Open it after an intervention",
        body: "During a live recovery branch, run the linked recheck. When there is no linked recheck, the host can use a same-question revote instead.",
      },
    ],
    check:
      "The host can open the intended recovery check and the report identifies whether it was linked-recheck or revote evidence.",
    notes: [
      "Rechecks are unscored by default. Correctly repeating an already-revealed question is a different strength of evidence from applying the concept to a fresh prompt.",
    ],
    troubleshooting: [
      {
        symptom: "The link is rejected",
        fix: "Check that it targets a valid recheck, not another main checkpoint or a recheck that links onward. Remove duplicate/cyclic relationships before publishing.",
      },
    ],
    action: { target: "library", label: "Prepare a checkpoint pair" },
    video: { guide: "userGuide", chapter: "03-recheck" },
  },
  {
    id: "confidence-and-concepts",
    title: "Add confidence, concepts, and misconception feedback",
    topic: "create",
    icon: "chart",
    summary: "Distinguish uncertainty from confident errors without profiling learners.",
    audience: "Owners and editors",
    before: [
      "Use a diagnostic or practice question. Ratings and polls always keep confidence off.",
    ],
    steps: [
      {
        title: "Open diagnostic details",
        body: "In the professional builder, open Diagnose and expand Diagnostic details and recheck link. The classic editor exposes the same question settings in its question form.",
      },
      {
        title: "Choose confidence",
        body: "Set Off, Optional, or Required. Participants choose Not sure, Somewhat sure, or Very sure after selecting their response.",
      },
      {
        title: "Tag the concept",
        body: "Use a consistent concept key, such as completion-rates, for the main question and its linked recheck. Concept tags connect the session evidence, not people across sessions.",
      },
      {
        title: "Label a distractor privately",
        body: "For a wrong choice, add a misconception key and helpful feedback when you can explain the likely error. Keep the label factual and avoid diagnosing a person.",
      },
      {
        title: "Review and publish",
        body: "Preview, wait for Saved, and publish. Hosts inspect confidence and misconceptions only after answers close; participants never receive hidden labels while the question is open.",
      },
    ],
    check:
      "The report can separate correctness and confidence and identify unresolved tagged concepts.",
    notes: [
      "Confidence never changes the score. A misconception label describes an authored distractor, not a verified psychological explanation for a learner's choice.",
    ],
    troubleshooting: [
      {
        symptom: "Confidence controls are unavailable",
        fix: "Check the question type and purpose. Opinion questions, ratings, and polls must be unscored and confidence-free.",
      },
    ],
    action: { target: "library", label: "Open a Round to edit" },
    video: { guide: "userGuide", chapter: "02-diagnose" },
  },
  {
    id: "themes",
    title: "Choose a Round Experience",
    topic: "create",
    icon: "theme",
    summary: "Match the room with Candy Pop, Campus, Studio, Blueprint, Signal, or Spark.",
    audience: "Creators and facilitators",
    before: [
      "Round Experiences must be enabled. Presets change presentation, never scoring or question order.",
    ],
    requiredFeatures: ["roundExperiences"],
    steps: [
      {
        title: "Set a category",
        body: "Open Round settings in the builder and choose general, education, business, technical, safety/compliance, or icebreaker. The category recommends a preset without silently replacing your choice.",
      },
      {
        title: "Preview a preset",
        body: "Choose Candy Pop, Campus, Studio, Blueprint, Signal, or Spark and inspect the preview. Consider projector readability and participant phones, not just appearance.",
      },
      {
        title: "Publish the default",
        body: "Wait for Saved and publish. The published version records the default category and preset.",
      },
      {
        title: "Override one delivery if needed",
        body: "At host setup, review the preset and choose a one-session override. The resolved experience is frozen when the room is created.",
      },
    ],
    check: "Host, presenter, and participant screens use the same frozen room experience.",
    notes: [
      "High contrast, reduced motion, and mute are local preferences and override the host presentation. Workspace branding affects safe surfaces only; arbitrary CSS and uploaded theme assets are unsupported.",
    ],
    troubleshooting: [
      {
        symptom: "Changing the workspace theme does not change a running room",
        fix: "This is intentional: active rooms preserve the theme they started with. Create a new session to use a new published default or host override.",
      },
    ],
    action: { target: "library", label: "Choose a Round" },
    video: { guide: "userGuide", chapter: "01-themes" },
  },
  {
    id: "preview-and-publish",
    title: "Preview, publish, and update safely",
    topic: "create",
    icon: "shield",
    summary:
      "Understand autosave, immutable versions, and why live content never changes mid-round.",
    audience: "Owners and editors",
    before: ["Have a draft with complete prompts and valid responses."],
    steps: [
      {
        title: "Wait for Saved",
        body: "Autosave follows a short pause after editing. Resolve any field-specific validation error before leaving the page.",
      },
      {
        title: "Preview the participant view",
        body: "Check prompt length, answer labels, response format, images, and explanations. Preview is for review; it is not a live participant session.",
      },
      {
        title: "Publish explicitly",
        body: "Publish validates the saved draft and creates an immutable version. A newly created session uses that version, not later draft edits.",
      },
      {
        title: "Make the next revision",
        body: "Edit the draft, preview again, and publish again when ready. Existing sessions and practice assignments retain their original frozen versions.",
      },
    ],
    check:
      "You can explain which published version a session is using and which changes are still draft-only.",
    notes: [
      "Publishing is not an automatic consequence of autosave or AI drafting. Duplicate content when you need an independent variation.",
    ],
    troubleshooting: [
      {
        symptom: "A participant sees the old wording",
        fix: "Check whether the session was created before the latest publication. Finish or keep that session, and create a new one to deliver the newer version.",
      },
    ],
    action: { target: "library", label: "Review your Library" },
    video: { guide: "quickStart", chapter: "04-publish" },
  },
  {
    id: "presentations",
    title: "Build an interactive Presentation",
    topic: "create",
    icon: "screen",
    summary: "Combine context slides with questions and a consistent participant layout.",
    audience: "Owners and editors",
    requiredFeatures: ["uxBeta", "workspaceShell", "presentations"],
    before: [
      "Presentations must be enabled. Live Presentation delivery has an additional realtime rollout gate.",
    ],
    steps: [
      {
        title: "Choose a starting method",
        body: "Choose Create → Presentation. Start blank, use an available template/source method, or reuse published questions from your workspace.",
      },
      {
        title: "Arrange the blocks",
        body: "Add content slides and interactive questions in the intended delivery order. Give the presentation and each slide a useful title.",
      },
      {
        title: "Edit readable content",
        body: "Edit text on the canvas or in the inspector. Use supported placement, resizing, and layout guides. Resolve fit warnings rather than letting important content overflow.",
      },
      {
        title: "Add interaction",
        body: "Configure each question's responses, feedback, and recovery details. Content slides provide context; they do not silently change question scoring.",
      },
      {
        title: "Preview and publish",
        body: "Check facilitator, presenter, and phone layouts, then publish. Host the frozen version only when live Presentation delivery is enabled for your workspace.",
      },
    ],
    check: "Content and question blocks read coherently on both a shared display and a phone.",
    notes: [
      "This is a structured presentation companion, not a full freeform slide-design application. Native PowerPoint and Google Slides add-ins are not included.",
    ],
    troubleshooting: [
      {
        symptom: "Text does not fit a slide",
        fix: "Shorten or split the text, adjust its supported bounds, and review the phone layout. Do not hide essential instructions in a clipped region.",
      },
      {
        symptom: "You can edit but cannot host a Presentation",
        fix: "Ask the operator whether the separate presentationRealtime gate is enabled; editing availability alone does not enable live delivery.",
      },
    ],
    action: { target: "presentation", label: "Create a Presentation", editorOnly: true },
    video: { guide: "userGuide", chapter: "04-presentations" },
  },
  {
    id: "imports-and-exports",
    title: "Import and export checkpoint content",
    topic: "create",
    icon: "book",
    summary: "Bring in bulk text, CSV, native JSON, or supported QTI without silent data loss.",
    audience: "Owners and editors",
    before: [
      "Check portability permissions for your edition. Keep an untouched copy of the original file.",
    ],
    steps: [
      {
        title: "Choose the importer",
        body: "Use Create → Round → Import in the professional workspace or the import panel in the classic dashboard. Choose bulk paste, CSV, Polling Pops JSON, or the supported QTI ZIP profile.",
      },
      {
        title: "Read the validation report",
        body: "Inspect every warning and error. Unsupported question types, omitted media, and missing presentation metadata are reported rather than silently discarded.",
      },
      {
        title: "Create a review draft",
        body: "Import the supported content, inspect every prompt and correct answer, then preview and publish explicitly. An imported draft is not ready for live delivery until reviewed.",
      },
      {
        title: "Choose an export format",
        body: "Native JSON is the lossless checkpoint-set interchange format. CSV and QTI support a constrained checkpoint profile; read the displayed limitations before exporting.",
      },
    ],
    check:
      "The imported draft matches the source, and you understand which information the chosen export retains.",
    notes: [
      "Hosted portability exports require the applicable entitlement; Community has no artificial software paywall. Do not rename a file extension to bypass the importer. Formula prefixes in CSV exports are escaped for safety.",
    ],
    troubleshooting: [
      {
        symptom: "A QTI or CSV import reports unsupported content",
        fix: "Read the validation details and adjust the source or use native JSON when possible. Do not assume slide layout, images, or an entire Recovery Pack sequence fit the constrained interchange format.",
      },
    ],
    action: { target: "import", label: "Open content import", editorOnly: true },
  },
  {
    id: "library",
    title: "Organize and manage your Library",
    topic: "create",
    icon: "book",
    summary: "Search, use folders and tags, duplicate, archive, restore, and delete safely.",
    audience: "Workspace members; permanent deletion is owner-only",
    before: [
      "Professional workspaces use Library; classic deployments use the dashboard's checkpoint-set list.",
    ],
    steps: [
      {
        title: "Find your content",
        body: "Open Library, search by title, and use the available status, type, folder, and tag filters. Clear filters when a saved item seems missing.",
      },
      {
        title: "Keep reusable content organized",
        body: "Use folders and tags, rename items clearly, and duplicate a Round when you want an independent variation.",
      },
      {
        title: "Archive instead of deleting",
        body: "Archive items you no longer want in the active list. Use the Archived filter and Restore to bring them back.",
      },
      {
        title: "Delete only when certain",
        body: "Owners can permanently delete archived content after confirmation. Retained sessions or practice assignments can prevent deletion; remove eligible session history first, or wait for assignment retention cleanup.",
      },
    ],
    check:
      "You can find, reopen, and manage a saved Round without making another copy by accident.",
    notes: [
      "Permanent deletion cannot be undone. Editors can edit and host; viewers are read-only. Archiving does not automatically remove historical evidence.",
    ],
    troubleshooting: [
      {
        symptom: "An archived item cannot be permanently deleted",
        fix: "Check for retained sessions and practice assignments using it. Owners may delete finished/expired sessions; retained assignments keep their source content protected until cleanup.",
      },
    ],
    action: { target: "library", label: "Open Library" },
  },
  {
    id: "reuse-questions",
    title: "Reuse questions from your workspace",
    topic: "create",
    icon: "choices",
    summary: "Copy reviewed questions and their linked rechecks into an independent draft.",
    audience: "Owners and editors",
    requiredFeatures: ["uxBeta"],
    before: ["Open the target Round draft with editing permission."],
    steps: [
      {
        title: "Open the reuse picker",
        body: "Choose Reuse from your workspace in the question Insert area. Search by source Round, prompt, response type, or concept.",
      },
      {
        title: "Select main questions",
        body: "Choose the desired main questions. A valid linked recheck comes with its main question and counts toward the 200-question Round limit.",
      },
      {
        title: "Add and review the copies",
        body: "Choose Add N questions. Copies receive fresh IDs and preserve copied main-to-recheck links. Review order, concepts, and explanations, then wait for Saved.",
      },
      {
        title: "Keep or undo the selection",
        body: "Use the editor's immediate one-step Undo to remove the copied selection if needed. Otherwise preview and publish the new draft.",
      },
    ],
    check: "The target contains independent copies and the source Round is unchanged.",
    notes: [
      "Later source edits do not synchronize these copies. Use versioned Recovery Packs when you need an explicit source-update review workflow.",
    ],
    troubleshooting: [
      {
        symptom: "A linked recheck is missing from the picker",
        fix: "Select its main question rather than a recheck-only item, and check that the source link is valid.",
      },
    ],
    action: { target: "library", label: "Open a target Round" },
  },
  {
    id: "question-health",
    title: "Review Question Health",
    topic: "create",
    icon: "shield",
    summary: "Use transparent authoring checks, draft revisions, and post-use observations.",
    audience: "Owners and editors",
    requiredFeatures: ["uxBeta", "workspaceShell", "builderV2", "questionHealth"],
    before: ["Wait for Saved. A review describes one saved draft revision, not unsaved edits."],
    steps: [
      {
        title: "Review the saved draft",
        body: "Expand Question Health · advisory and choose Review saved draft. Read each finding's named question/field, evidence, and suggested action.",
      },
      {
        title: "Decide what to change",
        body: "Edit normally, or choose a dismissal reason when a finding is not useful. You can reopen a dismissal; content changes may make it applicable again.",
      },
      {
        title: "Preview a proposed revision",
        body: "For a supported finding, choose Prepare draft revision, write the replacement, and Preview before/after before Apply to saved draft. Undo is available only while that revision remains current.",
      },
      {
        title: "Review published and post-use evidence",
        body: "The published-version panel is read-only. Post-use observations use retained, compatible session aggregates with sample requirements; no eligible observations yet is a normal result.",
      },
    ],
    check:
      "You understand the evidence behind a finding and review changes before publishing a new version.",
    notes: [
      "These deterministic checks are advice, not a publish gate or proof of question quality. Post-use variation does not establish a cause or create cross-session learner profiles.",
    ],
    troubleshooting: [
      {
        symptom: "The review is stale",
        fix: "Wait for the latest Saved revision and review again. A later edit also prevents undoing an older applied revision.",
      },
    ],
    action: { target: "library", label: "Review a saved Round" },
  },
  {
    id: "source-authoring",
    title: "Draft questions from a trusted source",
    topic: "create",
    icon: "edit",
    summary: "Generate a cited review proposal, then check it yourself before publishing.",
    audience: "Owners and editors",
    before: [
      "An operator must configure an approved authoring provider. Check your job allowance and permission to share the source.",
    ],
    steps: [
      {
        title: "Supply bounded source material",
        body: "Use the source starting method or dashboard authoring panel. Paste at least 50 characters, or choose a private PDF, DOCX, or PPTX up to 6 MB. Arbitrary URL ingestion is not supported.",
      },
      {
        title: "Create a review proposal",
        body: "Submit the source and wait for extraction and generation. The proposal can include a main question, linked recheck, answers, rationales, misconception labels, and citations.",
      },
      {
        title: "Verify every claim",
        body: "Compare answers, rationales, and each cited page/slide/paragraph with the original source. Fix errors and reject unsupported suggestions.",
      },
      {
        title: "Keep it as a draft until reviewed",
        body: "Create the unpublished review draft only when useful. Edit, preview, and explicitly publish through the normal builder.",
      },
    ],
    check:
      "Your published questions are human-reviewed and traceable to the material you supplied.",
    notes: [
      "The assistant never publishes and never uses participant responses or session data in authoring prompts. A disabled panel sends no source to a model. Hosted allowances and operator limits still apply.",
    ],
    troubleshooting: [
      {
        symptom: "Authoring is disabled or needs attention",
        fix: "For disabled authoring, ask the operator about provider configuration. For a failed proposal, read the extraction/provider message, correct the file or source size, and retry only when appropriate.",
      },
    ],
    action: { target: "source", label: "Open source authoring", editorOnly: true },
  },
  {
    id: "recovery-packs",
    title: "Build and reuse a Recovery Pack",
    topic: "create",
    icon: "loop",
    summary:
      "Package a concept, intervention, recheck, and delayed probe with explicit versioning.",
    audience: "Owners and editors",
    requiredFeatures: ["recoveryPacks"],
    before: [
      "Recovery Packs must be enabled. Use a reviewed concept and valid diagnostic/recheck material.",
    ],
    steps: [
      {
        title: "Create or import a Pack",
        body: "Open Recovery Packs. Start a draft or use native Pack JSON, then review its concept, diagnostic, intervention content, recheck, and optional delayed probe.",
      },
      {
        title: "Save and publish a version",
        body: "Resolve validation errors, save the draft, and publish. Published versions remain frozen even when the Pack draft later changes.",
      },
      {
        title: "Insert into a draft",
        body: "Select a target Round or a supported Presentation and insert the published Pack. Review the resulting questions, links, and intervention material before publishing that target.",
      },
      {
        title: "Review future source updates",
        body: "When a newer Pack version is available, use the target's update-review workflow. Inspect proposed changes and local edits before applying; a source publication does not silently replace target content.",
      },
      {
        title: "Choose practice deliberately",
        body: "For a published Pack with the required content and practice enabled, choose a delayed-probe or full-sequence practice mode. Review the frozen source and copy new attempt links when shown.",
      },
    ],
    check: "You can identify the exact Pack version copied into a draft or frozen into practice.",
    notes: [
      "Native Pack JSON preserves the Pack structure. CSV/QTI checkpoint interchange is not a complete Recovery Pack sequence. Live Pack cards and practice modes can have additional deployment gates.",
    ],
    troubleshooting: [
      {
        symptom: "An update cannot be applied automatically",
        fix: "Inspect local changes and the review's explanation. Resolve conflicts explicitly or keep the current copy; do not overwrite a local adaptation without checking it.",
      },
      {
        symptom: "Delayed-probe practice is unavailable",
        fix: "Check that the frozen published version contains a valid delayed probe and that practice is enabled with the required entitlement.",
      },
    ],
    action: { target: "packs", label: "Open Recovery Packs" },
  },
  {
    id: "hosting-and-qr",
    title: "Host a round and share its QR code",
    topic: "host",
    icon: "qr",
    summary: "Create the lobby, review settings, and invite many devices into the same room.",
    audience: "Facilitators",
    before: [
      "Publish a Round first. Test the network participants will use and keep the host tab open.",
    ],
    steps: [
      {
        title: "Review host setup",
        body: "Choose Host on the published Round. Review scoring, timing, results visibility, aliases, late joining, Q&A, and available theme/sound options before creating the lobby.",
      },
      {
        title: "Share the room",
        body: "Show the seven-digit code, copy the direct join link, or display/download the QR. All devices can use the same code; each receives its own guest resume credential.",
      },
      {
        title: "Use a reachable address",
        body: "A phone cannot reach the host computer through localhost. For a trusted-LAN test, use Change join address and the computer's reachable LAN address. Public sessions need a deployed HTTPS address.",
      },
      {
        title: "Check the roster",
        body: "Wait for participants, confirm they are in the right room, and lock admission if needed. Kick disruptive guests using the host controls rather than sharing your host credential.",
      },
      {
        title: "Start and finish",
        body: "Start round, close/reveal each question, complete any recovery branch, and finish the round to generate a report.",
      },
    ],
    check:
      "At least two separate devices appear in the same lobby and can answer the same live question.",
    notes: [
      "The code and QR shown in the demo video are illustrative, not a reusable live room. Share the code generated by your own lobby.",
    ],
    troubleshooting: [
      {
        symptom: "A phone scans the QR but cannot connect",
        fix: "Check that the link is not localhost/127.0.0.1, both devices can reach the chosen network address, and the firewall permits the app. For public use, test the HTTPS join link before the event.",
      },
    ],
    action: { target: "library", label: "Choose a published Round" },
    video: { guide: "quickStart", chapter: "05-host" },
  },
  {
    id: "timing-and-scoring",
    title: "Choose timing, scoring, and result visibility",
    topic: "host",
    icon: "choices",
    summary: "Match speed, accuracy, private results, and optional flex timing to your purpose.",
    audience: "Facilitators",
    before: [
      "Review host setup before creating the session. These gameplay settings are separate from the visual theme.",
    ],
    steps: [
      {
        title: "Choose the facilitation style",
        body: "Review the setup recipe and expand Review settings when you need overrides. Education generally defaults to accuracy and private results; workplace settings usually offer competitive delivery.",
      },
      {
        title: "Choose meaningful scoring",
        body: "Accuracy awards base points for correct scored responses. Speed mode adds a server-measured time factor. Unscored polls and ratings never contribute correctness points.",
      },
      {
        title: "Set response timing",
        body: "Timed rooms use server-owned deadlines. When separately enabled, whole-room Flex removes countdown/deadline and speed scoring; the host closes responses manually.",
      },
      {
        title: "Set visibility and access",
        body: "Choose private results or a leaderboard, alias policy, and late joining before creating the room. Check the participant experience in Preview and test with a second device.",
      },
    ],
    check:
      "Participants know whether speed matters and whether their results are private before the first question.",
    notes: [
      "A device clock cannot change the deadline. Pausing timed delivery preserves remaining server time. Participant accessibility preferences do not alter scoring rules.",
    ],
    troubleshooting: [
      {
        symptom: "Speed scoring is unavailable in Flex",
        fix: "This is intentional: no-countdown delivery cannot use time-based scoring. Use accuracy, or choose a timed room if speed is genuinely part of the task.",
      },
    ],
    action: { target: "library", label: "Review a published Round's setup" },
  },
  {
    id: "participation",
    title: "Join, answer, and reconnect as a participant",
    topic: "host",
    icon: "people",
    summary: "Take part without an account and keep your identity in the same browser tab.",
    audience: "Participants and facilitators supporting them",
    before: [
      "Have the current room's seven-digit code, direct link, or QR. A creator sign-in is not required.",
    ],
    steps: [
      {
        title: "Join the room",
        body: "Open Join a round, use the direct link, or scan the QR. Enter the code, choose an avatar, and enter a nickname only when the room asks for one.",
      },
      {
        title: "Wait for the host",
        body: "Stay in the lobby until the host opens a question. Full prompts and answer labels appear on your device; a shared screen is optional.",
      },
      {
        title: "Submit the required response",
        body: "Choose one or several options, enter a numeric value, or provide a rating/poll response as instructed. Add confidence when requested, then submit.",
      },
      {
        title: "Confirm it was saved",
        body: "Wait for Answer received and saved. If reconnecting, leave the tab open or refresh the same tab so it can restore the server-owned state.",
      },
      {
        title: "Review and continue",
        body: "After reveal, review available private feedback and follow the next question or recheck. Use audience controls only when enabled.",
      },
    ],
    check:
      "The page confirms your response was saved and restores your session identity after a same-tab refresh.",
    notes: [
      "Another browser or device normally joins as a new guest. Avatars are cosmetic, not learner accounts. Do not clear browser session storage during a round.",
    ],
    troubleshooting: [
      {
        symptom: "The code is invalid or the room rejects entry",
        fix: "Check all seven digits and confirm the host has not ended, expired, or locked the room. Late joining may be disabled. Ask the host for the current room link.",
      },
      {
        symptom: "The answer arrived too late",
        fix: "The timed room uses the server receipt deadline. Wait for the next question; repeated submission cannot move the deadline or add another score.",
      },
    ],
    action: { target: "join", label: "Open participant join" },
    video: { guide: "quickStart", chapter: "06-join" },
  },
  {
    id: "recovery-loop",
    title: "Run the Recovery Loop",
    topic: "evidence",
    icon: "loop",
    summary: "Ask, diagnose, intervene, recheck, and interpret what changed in this session.",
    audience: "Hosts and cohosts",
    before: [
      "Use scored diagnostic/practice questions. Pre-author a linked recheck for stronger session evidence when possible.",
    ],
    steps: [
      {
        title: "Ask and close responses",
        body: "Open the main question and wait for participation. Let the deadline close it or use Lock answers. In an enabled flex room, the host closes responses manually.",
      },
      {
        title: "Diagnose from measurements",
        body: "Review participation, correctness, confidence, and labelled distractors after answers close. Insight cards explain their measurements and rules; they do not make automated judgments about participants.",
      },
      {
        title: "Choose an intervention",
        body: "Peer discussion can happen before reveal. After reveal, record an explanation, example, or break intervention, then finish it when the room is ready.",
      },
      {
        title: "Recheck deliberately",
        body: "Open the linked recheck when prepared. Otherwise use a same-question revote. Rechecks are unscored by default; these two evidence types are reported separately.",
      },
      {
        title: "Finish the branch",
        body: "Close and reveal the recheck, complete the recovery branch, then continue to standings/the next main question or finish the round.",
      },
    ],
    check:
      "The report shows the initial response, intervention, and linked-recheck recovery or separately labelled revote change.",
    notes: [
      "The evidence describes this session, not durable learning or proof that the intervention caused the change. Reconnect restores the exact recovery phase.",
    ],
    troubleshooting: [
      {
        symptom: "The next question or leaderboard is unavailable",
        fix: "Finish the current intervention/recheck branch first. Follow the host screen's next action rather than reopening the main question.",
      },
    ],
    action: { target: "library", label: "Prepare a recovery-ready Round" },
    video: { guide: "userGuide", chapter: "07-recovery" },
  },
  {
    id: "audience-pulse",
    title: "Read and send Audience Pulse signals",
    topic: "interact",
    icon: "pulse",
    summary: "Notice confusion and pacing needs while protecting individual signals from the room.",
    audience: "Participants, hosts, and cohosts",
    requiredFeatures: ["audiencePulse"],
    before: [
      "Pulse must be enabled for the deployment and session. Explain the visibility rules before inviting signals.",
    ],
    steps: [
      {
        title: "Send a signal",
        body: "Participants open their audience controls and choose Got it, I'm unsure, Show an example, or Too fast. They can change or clear their one current signal.",
      },
      {
        title: "Inspect the host view",
        body: "Hosts/cohosts open Audience Pulse to see aliases, connection state, answered/not-answered status, signals, and recent activity. Use available needs-help or disconnected filters.",
      },
      {
        title: "Respect the public threshold",
        body: "Presenter and participant screens receive totals only after at least five unique participants signal in the current context. They never receive individual signal-to-alias mappings.",
      },
      {
        title: "Respond without judging",
        body: "Check access, slow the pace, or provide an example when useful. A new question, intervention, recheck, or revote starts a fresh signal context.",
      },
    ],
    check:
      "The facilitator can interpret help/pacing requests without exposing an individual's comprehension signal to the room.",
    notes: [
      "The facilitator can see your session alias and signal; the room sees totals only. Signals do not change scores or automatically change Recovery Loop recommendations. Open-question dashboards hide individual answer content, correctness, and confidence.",
    ],
    troubleshooting: [
      {
        symptom: "Public Pulse totals are hidden",
        fix: "Fewer than five unique participants have signalled in this context. This privacy threshold is expected, not a synchronization error.",
      },
    ],
    action: { target: "sessions", label: "Open session history" },
    video: { guide: "userGuide", chapter: "05-pulse" },
  },
  {
    id: "room-chat",
    title: "Enable and moderate room chat",
    topic: "interact",
    icon: "chat",
    summary:
      "Host a bounded room conversation with replies, reactions, pinning, and safety controls.",
    audience: "Hosts, cohosts, and participants",
    requiredFeatures: ["roomChat"],
    before: ["Chat starts disabled in every room. The host must explicitly enable it."],
    steps: [
      {
        title: "Open chat deliberately",
        body: "Open Audience → Chat and enable Room chat. Choose public or private aliases, slow mode, and presenter feed: off, pinned, or live.",
      },
      {
        title: "Explain the room rules",
        body: "Ask for relevant, respectful plain-text messages. Chat supports 1–500 characters, one-level replies, and like/love/insight/laugh reactions; no attachments, private messages, Markdown, or clickable links.",
      },
      {
        title: "Highlight useful contributions",
        body: "Pin a helpful message for the presenter. Participants can reply or react when permitted, and can report another participant's message.",
      },
      {
        title: "Moderate promptly",
        body: "Remove messages, mute for 5/15/60 minutes, ban audience interaction, or kick a disruptive participant. Restore access when appropriate; closing chat stops new conversation without erasing retained history.",
      },
    ],
    check:
      "You can enable a conversation, pin one useful message, and remove or limit unsafe contributions.",
    notes: [
      "Private-alias messages stay Anonymous to the room even after switching back to public aliases. Moderators retain the session alias for safety. Slow mode and hard rate/capacity limits are server-enforced.",
    ],
    troubleshooting: [
      {
        symptom: "Room chat is closed or a message is rate-limited",
        fix: "Ask the host to enable chat, or wait for the displayed slow-mode/rate-limit interval. Do not repeatedly retry or open extra tabs to bypass a limit.",
      },
    ],
    action: { target: "sessions", label: "Open session history" },
    video: { guide: "userGuide", chapter: "06-conversation" },
  },
  {
    id: "q-and-a",
    title: "Collect and answer audience Q&A",
    topic: "interact",
    icon: "chat",
    summary: "Keep questions, votes, moderation, and facilitator answers distinct from chat.",
    audience: "Participants, hosts, and cohosts",
    before: [
      "Enable Q&A in the room settings. Education usually starts with premoderation and anonymous public display; workplace settings usually publish immediately with aliases.",
    ],
    steps: [
      {
        title: "Ask or vote",
        body: "Participants open Q&A, submit a concise question, and upvote useful questions once each. A premoderated question waits for review rather than appearing immediately.",
      },
      {
        title: "Review the queue",
        body: "Hosts/cohosts inspect pending questions, publish appropriate ones, or dismiss/remove unsuitable content.",
      },
      {
        title: "Respond clearly",
        body: "Add a facilitator reply and mark the question answered when resolved. Use available labels to organize the queue. Participant replies can be enabled or kept off.",
      },
      {
        title: "Maintain safety",
        body: "Remove abusive replies and use kick/ban controls when needed. Explain whether aliases are public or visible only to facilitators.",
      },
    ],
    check:
      "A participant can see that a published question has a facilitator answer without losing it in the chat stream.",
    notes: [
      "Q&A has its own moderation states and limits; enabling room chat does not replace Q&A. Both follow session retention and deletion.",
      "For allowlisted live Presentations, the host first selects Activate audience Q&A. Participants expand Questions and answers to ask and vote; Companion can only read public Q&A. Presentation replies remain unavailable—use Mark answered after a verbal answer. Anonymous public names still reveal the session alias to the facilitator.",
      "If a Presentation Q&A acknowledgement is lost, use Retry the same Q&A action. It preserves the original intent when you collapse and reopen the panel; refreshing restores accepted questions, not unconfirmed drafts. Q&A becomes read-only when the Presentation ends.",
    ],
    troubleshooting: [
      {
        symptom: "A submitted question is not visible to the room",
        fix: "Check whether it is pending moderator approval. If Q&A is disabled, the host must enable it; repeated posting does not bypass moderation.",
      },
    ],
    action: { target: "sessions", label: "Open session history" },
    video: { guide: "userGuide", chapter: "06-conversation" },
  },
  {
    id: "staff-and-presenter",
    title: "Share cohost and presenter access safely",
    topic: "host",
    icon: "screen",
    summary: "Give helpers scoped controls and give the room a separate read-only display.",
    audience: "Hosts and workspace owners",
    before: [
      "Create a session and keep its original host tab. Never distribute the host credential to participants.",
    ],
    steps: [
      {
        title: "Open staff controls",
        body: "On the host screen, expand Round staff and issue the appropriate scoped access. A cohost can help control the assigned room; a presenter credential is read-only.",
      },
      {
        title: "Open the presentation display",
        body: "Use Presenter view/popout for the room-facing screen. Select the permitted aggregate Pulse and chat feed rather than showing the private host dashboard.",
      },
      {
        title: "Revoke access when needed",
        body: "Revoke a staff credential when a helper changes or access is no longer needed. Do not substitute a creator account login or host token for presenter access.",
      },
      {
        title: "Configure a secure embed only if needed",
        body: "A workspace owner can allow up to ten HTTPS embed origins in Account. Use the dedicated read-only embed route; ordinary app routes deliberately deny framing.",
      },
    ],
    check:
      "The room sees a clean read-only display, while a cohost has only the intended session controls.",
    notes: [
      "Credentials live in the tab that received them. Presenter access cannot submit host commands or expose participant-private answers/signals.",
    ],
    troubleshooting: [
      {
        symptom: "This tab does not have the host credential",
        fix: "Return to the original host tab or use the authenticated resume/staff-access workflow available to your role. Do not paste a credential into public chat or a support ticket.",
      },
      {
        symptom: "An iframe refuses to display",
        fix: "Use the dedicated embed route and confirm the exact HTTPS origin is on the workspace allowlist. Normal routes must continue to reject framing.",
      },
    ],
    action: { target: "sessions", label: "Open Sessions" },
  },
  {
    id: "reports",
    title: "Read results and recovery evidence",
    topic: "evidence",
    icon: "chart",
    summary:
      "Interpret initial accuracy, confidence, recovery denominators, and conversation statistics.",
    audience: "Owners, editors, and viewers with report access",
    before: ["Finish the round and allow up to 60 seconds for durable report generation."],
    steps: [
      {
        title: "Open the report",
        body: "Use the finished host screen's report action, Results in the professional workspace, or report history in the classic dashboard.",
      },
      {
        title: "Inspect the starting evidence",
        body: "Review participation, initial accuracy, confidence/correctness, difficult questions, and labelled distractors. Small samples should temper interpretation.",
      },
      {
        title: "Read recovery with its denominator",
        body: "Linked recovery counts initially incorrect participants who answered both checks and later answered the linked recheck correctly. Read numerator, denominator, evidence type, and small-sample warning together.",
      },
      {
        title: "Keep evidence types separate",
        body: "A same-question revote is not a fresh linked recheck. Use unresolved concepts and the intervention timeline to plan next steps. Where captured, Decision replay describes recorded facilitator events, not a causal explanation.",
      },
      {
        title: "Review or export responsibly",
        body: "Authorized members can open the interaction transcript; standard reports remain aggregate-first. Removed bodies require an owner/editor audit view. Download JSON/CSV only where your edition permits exports.",
      },
    ],
    check:
      "You can identify an unresolved concept and explain what a 4/5 recovery figure does—and does not—mean.",
    notes: [
      "Recovery is session evidence, not proof of long-term learning. Hosted report retention is typically 30 days on Free and 365 on Pro; Community operators configure it. Do not invent a missing or partial Decision replay.",
    ],
    troubleshooting: [
      {
        symptom: "The report stays Finalizing",
        fix: "Wait up to 60 seconds. If it does not complete, contact the operator with the session/report identifier, not bearer links or raw private conversation; the operator should inspect report jobs.",
      },
    ],
    action: { target: "results", label: "Open Results" },
    video: { guide: "userGuide", chapter: "08-evidence" },
  },
  {
    id: "decision-replay",
    title: "Review recorded facilitator decisions",
    topic: "evidence",
    icon: "chart",
    summary:
      "Read a captured decision timeline without inferring missing actions or causal effects.",
    audience: "Authorized report readers",
    before: [
      "Decision replay exists only for sessions created while capture was enabled. Older reports remain valid without it.",
    ],
    steps: [
      {
        title: "Open an eligible completed report",
        body: "Look for Decision replay and Facilitator decisions. Capture availability is frozen at session creation; turning it on later cannot reconstruct an older session.",
      },
      {
        title: "Read the measured context",
        body: "Inspect the lock-time insight measurements, recommendation, and rule version shown with the recorded events.",
      },
      {
        title: "Follow actual recorded actions",
        body: "Review reveal, intervention start/finish, recheck/revote opening, advancement, and finish events. The timeline records server events, not audio/video or inferred participant motives.",
      },
      {
        title: "Respect incomplete coverage",
        body: "Read any missing/partial label and the bounded-capture limit. Use the timeline as descriptive facilitation context alongside the response evidence.",
      },
    ],
    check:
      "You can describe what was recorded without filling gaps or claiming a decision caused recovery.",
    notes: [
      "Capture is bounded to 5,000 events per session. Existing captured sessions retain their timeline when new capture is paused. Versioned exports include captured replay evidence where available.",
    ],
    troubleshooting: [
      {
        symptom: "Decision replay is missing or partial",
        fix: "The session may predate capture or exceed its bounds. Ask the operator about rollout for future sessions; do not infer absent actions from answer patterns.",
      },
    ],
    action: { target: "results", label: "Review completed results" },
  },
  {
    id: "rehearsal",
    title: "Rehearse a recovery decision",
    topic: "evidence",
    icon: "loop",
    summary:
      "Try synthetic low-participation, split-room, or misconception scenarios before going live.",
    audience: "Facilitators with rehearsal access",
    requiredFeatures: ["recoveryRehearsal"],
    before: [
      "Open an eligible Round and its Rehearse action when enabled. This is a simulation, not a participant room.",
    ],
    steps: [
      {
        title: "Choose the scenario",
        body: "Select an available synthetic scenario, such as low participation, split understanding, or a confident misconception.",
      },
      {
        title: "Follow the host controls",
        body: "Start the simulated question, close answers, read the measurements, and choose a suitable intervention.",
      },
      {
        title: "Test the recovery branch",
        body: "Use the authored linked recheck or a revote as available, then inspect the simulated outcome. Repeat to compare facilitation choices.",
      },
    ],
    check: "You can navigate the recovery controls confidently before inviting real participants.",
    notes: [
      "Rehearsal is clearly labelled synthetic, read-only, and in-memory. It does not create a durable real session, learner history, report, or follow-up.",
    ],
    troubleshooting: [
      {
        symptom: "Rehearse is unavailable",
        fix: "Check editing/hosting permission, eligible content, and the rehearsal deployment/workspace gate. Do not treat preview as a substitute for a real-device network test.",
      },
    ],
    action: { target: "library", label: "Choose a Round to rehearse" },
  },
  {
    id: "practice",
    title: "Assign account-free practice",
    topic: "evidence",
    icon: "book",
    summary: "Freeze a published Round and share anonymous or one-attempt personal practice links.",
    audience: "Facilitators and practice participants",
    requiredFeatures: ["practiceAssignments"],
    before: [
      "Publish a Round and check practice access for your edition. New standalone practice must be enabled.",
    ],
    steps: [
      {
        title: "Create an assignment",
        body: "Open the published Round and choose Assign practice. Set a title, timed or no-countdown mode, and a close date within the retention window.",
      },
      {
        title: "Choose the links",
        body: "Use a generic anonymous link for unpaired practice, or add distribution labels for revocable personal links. Participants still need no accounts.",
      },
      {
        title: "Save new links immediately",
        body: "Copy or download bearer links when first shown. Only hashes are stored; the same personal URL cannot be revealed again later.",
      },
      {
        title: "Manage attempts",
        body: "Open Practice/Assignments to inspect started/completed counts, issue another link, revoke access, create a 1.5×/2× accommodation pass, or close the assignment.",
      },
    ],
    check:
      "A participant opens the assignment and completes/resumes server-owned practice without signing in.",
    notes: [
      "The assignment freezes the published version. Main questions are included; linked rechecks are not automatically added as unconditional practice questions. Existing assignments remain manageable if new creation is later disabled.",
    ],
    troubleshooting: [
      {
        symptom: "A personal link was lost or already used",
        fix: "It cannot be revealed again. If appropriate, revoke the old link and issue a new one. Resume an unfinished attempt on the same device instead of starting another attempt.",
      },
    ],
    action: { target: "practice", label: "Open practice assignments" },
    video: { guide: "userGuide", chapter: "09-practice" },
  },
  {
    id: "follow-ups",
    title: "Follow up on unresolved concepts",
    topic: "evidence",
    icon: "loop",
    summary: "Turn a completed session's unresolved concepts into immutable self-paced follow-up.",
    audience: "Pro/Community facilitators and participants",
    before: [
      "Open a completed Round report with eligible unresolved concepts and follow-up entitlement.",
    ],
    steps: [
      {
        title: "Select concepts",
        body: "In the report, choose the unresolved concepts you want participants to revisit. Review the resulting content before creating the follow-up.",
      },
      {
        title: "Choose timing",
        body: "Set timed or no-countdown time-flex mode and an optional close date. Create an accommodation pass when a longer timed attempt is appropriate; no reason is stored.",
      },
      {
        title: "Distribute links safely",
        body: "Copy the generic anonymous link or download one-time personal links for live participants when shown. Treat personal bearer links as private access credentials.",
      },
      {
        title: "Review and close",
        body: "Manage attempts from the report, revoke individual links, or close the follow-up early. Review follow-up evidence separately from the original live session.",
      },
    ],
    check: "Participants can revisit selected concepts without a persistent learner account.",
    notes: [
      "Generic attempts are unpaired. Personal links normally allow one attempt. Deleting/expiring the source session cascades to its follow-up data.",
    ],
    troubleshooting: [
      {
        symptom: "There is no follow-up action",
        fix: "Check that the report is complete, has eligible concepts, and that your role/edition permits follow-ups. A standalone practice assignment is a separate workflow.",
      },
    ],
    action: { target: "results", label: "Choose a completed report" },
  },
  {
    id: "groups",
    title: "Coordinate a facilitator Group",
    topic: "manage",
    icon: "people",
    summary:
      "Curate artifacts, discuss delivery, and schedule work without creating learner accounts.",
    audience: "Workspace facilitators",
    requiredFeatures: ["uxBeta", "workspaceShell", "groups"],
    before: [
      "Groups must be enabled. Members are existing workspace facilitators, not a learner roster.",
    ],
    steps: [
      {
        title: "Create a focused Group",
        body: "Open Groups, give the group a purpose and description, and create it using the permitted workspace role.",
      },
      {
        title: "Add people and artifacts",
        body: "Choose available workspace members and share selected Rounds or Presentations from Library. Group curation does not bypass workspace permissions.",
      },
      {
        title: "Coordinate in discussion",
        body: "Post facilitator context, preparation notes, and questions in the group discussion. This is separate from a live room's participant chat.",
      },
      {
        title: "Schedule delivery",
        body: "Choose a published shared artifact, date/time, activity type, and optional note. Use the schedule action to open host setup or the assignment workflow when due.",
      },
    ],
    check:
      "Your facilitator team can find the shared artifact and planned delivery without mixing it with participant interaction.",
    notes: [
      "A scheduled item is a planning entry, not a promise that a room starts automatically. Publishing and relevant feature permissions still apply.",
    ],
    troubleshooting: [
      {
        symptom: "An artifact cannot be scheduled",
        fix: "Publish it and share it with the Group first. Check that the relevant Presentation or practice capability is enabled.",
      },
    ],
    action: { target: "groups", label: "Open Groups" },
  },
  {
    id: "workspace-settings",
    title: "Manage members, branding, and billing",
    topic: "manage",
    icon: "people",
    summary: "Use owner controls without granting unnecessary editing or administrative access.",
    audience: "Workspace owners; other members can review their permitted settings",
    before: ["Use Account. Owner-only controls depend on your workspace role and edition."],
    steps: [
      {
        title: "Invite with the right role",
        body: "Owners can invite an editor for content/hosting or a viewer for read-only content/reports. Invitations expire and are single-use; revoke unused invitations when needed.",
      },
      {
        title: "Manage access",
        body: "Review members, change permitted roles, remove access, and switch workspaces when you belong to several. A session cohost is not a workspace editor.",
      },
      {
        title: "Apply readable branding",
        body: "Where entitled, set the organization name and safe accent surfaces. Validate contrast; branding does not override participant accessibility preferences or the frozen theme of an active room.",
      },
      {
        title: "Review plan and billing",
        body: "Inspect your effective limits in Account. Hosted billing uses the configured checkout/customer portal; Community billing is disabled and the operator controls limits.",
      },
    ],
    check:
      "Every member has the minimum role they need and the account shows the correct current plan.",
    notes: [
      "Institution-only capabilities are contract/operator-gated and cannot be self-enabled by a workspace owner.",
    ],
    troubleshooting: [
      {
        symptom: "Membership, branding, or billing controls are missing",
        fix: "Check the active workspace, your owner role, and effective entitlements. Ask the owner/operator rather than signing in with someone else's account.",
      },
    ],
    action: { target: "account", label: "Open workspace settings" },
  },
  {
    id: "privacy-and-deletion",
    title: "Export and delete data safely",
    topic: "manage",
    icon: "shield",
    summary:
      "Understand retention, account export, session deletion, and irreversible content removal.",
    audience: "Workspace owners and operators",
    before: [
      "Check what must be retained and who authorizes deletion. Export needed evidence before permanent deletion.",
    ],
    steps: [
      {
        title: "Review retention",
        body: "Reports and interactions follow the session retention window. Hosted Free normally retains 30 days, Pro 365 days, and Community uses operator configuration.",
      },
      {
        title: "Export permitted data",
        body: "Use Account export for owned workspace data, and authorized report/transcript exports where entitled. Bearer-token hashes are not included in account export.",
      },
      {
        title: "Delete finished session history",
        body: "Owners use Sessions or a report's deletion action after a round finishes or expires. Confirmation removes responses, report, interactions, and linked follow-ups, not the source Round.",
      },
      {
        title: "Delete content or account deliberately",
        body: "Permanently delete only eligible archived content. Account deletion requires typing DELETE and removes private objects and durable owned records. Read the confirmation and dependencies before proceeding.",
      },
    ],
    check:
      "You know the scope of the deletion and have not confused archiving, expiry, and permanent removal.",
    notes: [
      "Removed chat bodies require an explicit authorized audit view. Do not copy raw conversations or bearer links into logs, screenshots, or public support tickets.",
    ],
    troubleshooting: [
      {
        symptom: "The delete action is blocked",
        fix: "Check owner permission and retained dependent sessions/assignments. Finish an active session first; wait for protected practice dependencies to be removed by the applicable retention workflow.",
      },
    ],
    action: { target: "account", label: "Open account data controls" },
  },
  {
    id: "accessibility",
    title: "Set up an accessible round",
    topic: "host",
    icon: "shield",
    summary: "Use readable content, local display preferences, and timing that matches the task.",
    audience: "Facilitators and participants",
    before: ["Test the actual participant devices and network before an important event."],
    steps: [
      {
        title: "Make content self-contained",
        body: "Put complete prompts and answer labels on participant devices. Keep text concise and use meaningful image alt text; do not rely on colour, placement, sound, or a shared screen alone.",
      },
      {
        title: "Choose fair timing",
        body: "Prefer accuracy scoring when speed has no instructional value. Where live flex is enabled, use host-led no-countdown questions. Self-paced work supports time-flex and accommodation passes.",
      },
      {
        title: "Set local preferences",
        body: "On live screens, use High contrast, Reduce motion, and Mute as needed. They override the theme locally without changing someone else's screen.",
      },
      {
        title: "Rehearse access",
        body: "Test keyboard-only operation, visible focus, screen-reader announcements, 200% zoom, phone touch targets, and network reconnect. Ask participants how to request a pacing change.",
      },
    ],
    check:
      "A participant can read, navigate, and answer without needing colour cues, audio, or a projector.",
    notes: [
      "Accommodation passes store no reason and do not publicly expose a participant's accommodation. Accessibility targets require ongoing automated and human verification, not a claim that every deployment is independently certified.",
    ],
    troubleshooting: [
      {
        symptom: "Flex timing is not offered",
        fix: "Live flex has a separate deployment/workspace gate. Use a longer configured timer or enabled self-paced time-flex mode while discussing access needs with the facilitator.",
      },
    ],
    action: { target: "library", label: "Review your content" },
  },
  {
    id: "institution-access",
    title: "Use approved institution sign-in and LMS access",
    topic: "manage",
    icon: "shield",
    summary:
      "Understand creator identity linking and the limits of institution pilot capabilities.",
    audience: "Approved institution owners and operators",
    before: [
      "Institution capabilities require operator approval, contracts, and matching identity/LMS configuration. They are not ordinary self-service features.",
    ],
    steps: [
      {
        title: "Check the approved policy",
        body: "In Account, review the permanent home region, institution capability policy, and approved integrations. Workspace owners cannot self-enable contract-gated access.",
      },
      {
        title: "Link a creator identity explicitly",
        body: "First sign in by email, then use the enabled institution linking action in Account. The link is scoped to workspace, issuer, and subject; matching email alone does not link accounts.",
      },
      {
        title: "Coordinate LMS registration",
        body: "An LMS administrator and the operator must configure matching LTI issuer, client, deployment, authorization, JWKS, and return-origin values.",
      },
      {
        title: "Use supported launches",
        body: "The first verified instructor launch links to an existing creator. Deep Linking selects a published checkpoint set. Continue to use guest QR/direct links for participants.",
      },
    ],
    check:
      "Approved creators can use their configured identity without weakening explicit account linking or guest participation privacy.",
    notes: [
      "Learner LTI launches, roster access, and grade passback are not available in this release. K–12 and public legal readiness remain separately gated.",
    ],
    troubleshooting: [
      {
        symptom: "Institution sign-in or LMS launch is unavailable",
        fix: "Ask the institution administrator/operator to verify the approved policy and registration. Do not create a new account expecting automatic email-based linking.",
      },
    ],
    action: { target: "account", label: "Review institution settings" },
  },
  {
    id: "troubleshooting",
    title: "Troubleshoot a live session",
    topic: "start",
    icon: "shield",
    summary:
      "Resolve login, joining, connection, saved-response, and report problems step by step.",
    audience: "Everyone",
    before: [
      "Keep the current tab open and avoid clearing session storage. Never include bearer credentials in a support request.",
    ],
    steps: [
      {
        title: "Identify the affected step",
        body: "Record whether the issue is sign-in, joining, authoring, answering, chat, or reporting. Read the full message and note the time and session/report identifier when safe.",
      },
      {
        title: "Check room access",
        body: "Confirm the current code, reachable join address, unlocked lobby, and late-join setting. A finished/expired room cannot be resumed as an active round.",
      },
      {
        title: "Let reconnect finish",
        body: "Leave Reconnecting visible while the client requests the authoritative snapshot. Refresh the same tab if needed; a new device may create a new guest.",
      },
      {
        title: "Confirm durability",
        body: "Look for Answer received and saved instead of assuming a click was accepted. Wait for Saved before leaving an editor. A timed late response cannot be accepted by changing the device clock.",
      },
      {
        title: "Escalate with safe context",
        body: "Check service status and contact the operator with the step, error, time, and identifier. Redact participant aliases, private content, and token-bearing links from screenshots.",
      },
    ],
    check:
      "You can describe the affected workflow and a reproducible symptom without exposing private access or conversation data.",
    notes: [
      "The Help videos use synthetic data and a test lobby. They do not supply a join code for your event.",
    ],
    troubleshooting: [
      {
        symptom: "Report remains Finalizing or many devices disconnect",
        fix: "Check service status, wait briefly for recovery/report generation, and ask the operator to inspect database, realtime, and report-worker health. Do not repeatedly create replacement rooms before recording the original issue.",
      },
    ],
    action: { target: "status", label: "Check service status" },
  },
];

export function findHelpGuide(id: string) {
  return helpFeatureGuides.find((guide) => guide.id === id);
}

export function filterHelpGuides(query: string, topic: HelpGuideTopic | "all" = "all") {
  const terms = query
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-CA")
    .split(/\s+/)
    .filter(Boolean);
  return helpFeatureGuides.filter((guide) => {
    if (topic !== "all" && guide.topic !== topic) return false;
    const text = [
      guide.title,
      guide.summary,
      helpGuideTopics[guide.topic],
      guide.audience,
      ...guide.before,
      ...guide.steps.flatMap((step) => [step.title, step.body]),
      ...guide.notes,
      ...guide.troubleshooting.flatMap((item) => [item.symptom, item.fix]),
    ]
      .join(" ")
      .normalize("NFKC")
      .toLocaleLowerCase("en-CA");
    return terms.every((term) => text.includes(term));
  });
}

export function helpGuideAvailable(
  guide: HelpFeatureGuide,
  features: WorkspaceProductFeatures | null | undefined,
) {
  return (
    !guide.requiredFeatures?.length ||
    guide.requiredFeatures.every((feature) => features?.[feature] === true)
  );
}

export function helpGuideAction(
  guide: HelpFeatureGuide,
  features: WorkspaceProductFeatures | null | undefined,
  canEdit: boolean,
) {
  if (!helpGuideAvailable(guide, features) || (guide.action.editorOnly && !canEdit)) return null;
  const shell = features?.uxBeta === true && features.workspaceShell === true;
  const builder = professionalRoundBuilderAvailable(features);
  const target = guide.action.target;
  const paths: Record<ActionTarget, string | null> = {
    create: builder ? "/create?start=blank" : "/dashboard",
    source: builder ? "/create?start=source" : "/dashboard",
    import: builder ? "/create?start=import" : "/dashboard",
    library: shell ? "/library" : "/dashboard",
    presentation: shell && features?.presentations ? "/create/presentation" : null,
    results: shell ? "/results" : "/dashboard",
    sessions: shell ? "/sessions" : "/dashboard",
    practice: shell && features?.practiceAssignments ? "/assignments" : "/dashboard",
    groups: shell && features?.groups ? "/groups" : null,
    packs: features?.recoveryPacks ? "/recovery-packs" : null,
    account: "/account",
    join: "/join",
    surveys: "/surveys",
    status: "/status",
  };
  const href = paths[target];
  if (!href) return null;
  return { href, label: href === "/dashboard" ? "Open Round dashboard" : guide.action.label };
}

export function helpGuideVideoLink(
  guide: HelpFeatureGuide,
  features: WorkspaceProductFeatures | null | undefined,
) {
  if (!guide.video) return null;
  const key = guide.video.guide;
  const available =
    key === "quickStart"
      ? professionalRoundBuilderAvailable(features)
      : professionalBuilderGuidesAvailable(features);
  if (!available) return null;
  const chapterIndex = helpVideoScripts[key].findIndex(
    (scene) => scene.id === guide.video!.chapter,
  );
  if (chapterIndex < 0) return null;
  const anchor = key === "quickStart" ? "quick-start" : "round-builder-guide";
  return {
    href: `/help?watch=${anchor}&chapter=${chapterIndex}#${anchor}`,
    title: helpVideoScripts[key][chapterIndex]!.title,
  };
}
