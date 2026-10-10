# Polling Pops user guide

Polling Pops helps a facilitator run a complete comprehension-recovery loop:
**ask → diagnose → intervene → recheck → prove**. Participants join as session-scoped guests and
do not need accounts.

For a local first run, complete the [quick start](quick-start.md) first.

The Core-Parity foundation includes gated Presentation Q&A and a gated self-paced Survey beta
using polls and ratings. Presentation replies/chat/Pulse, Q&A-only feedback rooms, new opinion
formats and advanced feedback exports remain pending. Existing learning Q&A's Anonymous public display still lets
moderators see the session alias; it is not organizer-blind feedback. Track availability in the
[implementation status](implementation-status.md), not by enabling reserved future flags.

## Choose an activity and a template

Select **Create → Round**. Choose **Live quiz** for knowledge checks/recovery, **Live poll** for
unscored host-paced opinions, **Survey** for independent responses over time, or **Custom Round** for
mixed live questions. Older starting links still work as custom workflows. Formats can be changed
later in the Round editor. A live poll is not a self-paced Survey.

Search the 24 original templates and filter by category/type. **Preview questions** shows prompts
and options without creating content. **Use starter** makes an independent draft with fresh IDs.
Review every answer, explanation and recheck for your audience before publishing. Original template
content is English; chooser/filter controls are localized.

## Standalone Surveys (beta)

Your operator must enable the flags/allowlist in the quick start. Owners/editors create, edit,
publish and share; viewers can read content/results.

1. Choose **Survey**, then a feedback template or **Create blank Survey**.
2. Edit details, add poll/rating questions, label scale endpoints, select required/optional, and
   reorder/remove items. Other opinion formats are not included yet.
3. **Save draft**, preview, then **Publish Survey**. Saves are explicit; save before leaving.
   Revision conflicts require reloading, not silently overwriting another editor's work.
4. Choose a window (seven days by default, up to 30 within retention) and **Create sharing link**.
   Share the code, link or downloadable QR. New sharing links are separate runs; later edits never
   alter an already shared version.
5. Participants use the normal Join page without an account, nickname or avatar. They answer at
   their own pace, **Save progress** before leaving, then **Submit Survey**. Required items must be
   answered. Refresh resumes saved answers on the same browser. One completion per credential is
   enforced, not verified one-person identity; another browser/device is a new credential.
6. Return through **Library → Browse Surveys** (`/surveys`) to content, sharing links and results.
   Refresh results to count finalized submissions. **Close admissions and submissions**, or wait for
   the deadline, to release final distributions. Each question needs at least five finalized answers;
   optional unanswered items do not count toward that minimum. Open runs never show changing
   distributions, which could reveal individual answers through consecutive result comparisons.
7. Owners/editors may close a run; only the workspace owner may permanently **Delete survey run**.
   **Duplicate** an archived Survey to create a new editable draft without altering the original.

Organizers cannot inspect linked respondent answers. A room-only bearer credential is stored locally
for resume and only its hash server-side. Clearing site data loses resume access. Closing blocks new
admissions/submissions; saved receipts remain readable until retention. Deleting a run removes its
attempts/receipts, including its sharing-link creation receipt. Survey opinions are separate from
learning accuracy and Recovery evidence.

For video guidance, open **Help** (`/help`). The quick start follows sign-in, authoring,
preview, publishing, hosting, QR/link joining, answering, and results. The longer user guide
covers themes, confidence, linked rechecks, Presentations, Audience Pulse, chat/Q&A,
recovery evidence, and account-free practice. Both include conversational English neural
narration, matching captions, transcripts, and clickable chapters. The figures and conversations
are synthetic demonstrations, not customer or long-term learning evidence. Help shows only
videos whose demonstrated capabilities are enabled; quick start does not require every advanced
feature. The MP4s are also bundled under `/guides/polling-pops-quick-start.mp4` and
`/guides/polling-pops-user-guide.mp4` for direct viewing.

### Feature-specific written guidance in Help

Open **Help → Written feature guides**, or `/help#feature-guides`. Each feature has an original
Polling Pops illustrated cover and a shareable `/help/<guide>` page. Search the guide text or
filter by topic. Each page includes prerequisites, numbered steps, a success check, safety/permission
notes, troubleshooting, related guides, and an appropriate next action. Relevant pages also link
to the exact chapter of an available video; chapter links load paused, never autoplay.

Coverage includes:

- **Getting started:** sign-in, your first Round, and troubleshooting.
- **Create and organize:** response types, starters, confidence/concepts, linked rechecks,
  experiences, preview/publication, Presentations, import/export, Library, question reuse,
  Question Health, source authoring, and Recovery Packs.
- **Host and participate:** host setup/QR, timing/scoring, guest participation/reconnect,
  cohost/presenter/embed access, and accessibility.
- **Audience interaction:** Pulse, moderated room chat, and Q&A.
- **Recovery and evidence:** the Recovery Loop, reports, Decision replay, rehearsal,
  standalone practice, and session follow-ups.
- **Workspace and safety:** Groups, members/branding/billing, privacy/export/deletion, and
  approved institution integrations.

The written guides are currently in English and marked with their content language. Optional
guides remain readable when a capability is disabled, but are labelled **Not enabled here** and
do not offer a disabled-feature action. Creator actions are not offered to read-only members.
This documentation does not enable beta, institution, provider, or paid capabilities.

Guide content is maintained in `apps/web/lib/help-feature-guides.ts`; tests verify unique routes,
required sections, search/filter behavior, feature/role-safe actions, and valid video chapter links.

The default Community setup uses the classic Round workflow. The professional workspace and
Presentation builder require operator-enabled beta flags and a workspace allowlist. Live
Presentations, whole-room flex timing, Question Health, and decision replay have additional
workspace rollout gates. A feature described here may therefore be absent from your deployment;
see [optional beta configuration](quick-start.md#optional-beta-workflows). These controls do not
mean that public production or institutional readiness gates have passed.

## Roles and screens

| Role               | Main job                                                       | Access                                        |
| ------------------ | -------------------------------------------------------------- | --------------------------------------------- |
| Workspace owner    | Manage people, billing, deletion, content, rounds, and reports | Full workspace                                |
| Editor             | Create Rounds, host sessions, and use reports                  | No membership, billing, or permanent deletion |
| Viewer             | Review content and reports                                     | Read only                                     |
| Session cohost     | Help control one assigned live round                           | Revocable round-scoped credential             |
| Presenter          | Show a clean room-facing display                               | Separate read-only credential                 |
| Participant        | Join, answer, ask questions, and resume on one device          | Accountless, round-scoped credential          |
| Community operator | Deploy, secure, back up, and support the service               | Deployment and runbooks                       |

Education onboarding defaults to accuracy scoring, private results, generated aliases, calmer
motion, Q&A premoderation, and participant replies off. Workplace onboarding defaults to speed
scoring, a leaderboard, entered aliases, Q&A postmoderation, and participant replies on. A
facilitator can change round settings before creating a room.

## Sign in and workspace access

1. Select **Create a free checkpoint set** or open `/signin`.
2. Choose education or workplace learning.
3. Enter an email address, accept the displayed policies, and request a sign-in link.
4. Follow the single-use link. Local Compose captures it in Mailpit at
   <http://localhost:8025>; after requesting the link, select **Open local email inbox** on the
   sign-in page. If the configured public address differs from the browser address, move to the
   configured sign-in page first and continue using that origin after authentication.

Use **Home** or **Library** to return to your Rounds in the professional workspace; the classic view
uses **My checkpoint sets**. Select **Sign out** to revoke the current browser session. Owners can
invite editors or viewers from **Account**. An invitation is single-use and expiring. A person who
belongs to multiple workspaces can switch the active workspace there.

## Create and organize Rounds

In the professional workspace, select **Create**, then **Round**, and choose a starter, trusted
source, structured import, or blank Round. In the classic view, enter a title under **Your
checkpoint sets** and select **Create checkpoint set**. Draft changes autosave after a short pause.
Wait for **Saved** before leaving the editor.

The editor supports:

- Single select and true/false
- Multiple select with exact-set scoring
- Numeric responses with decimal normalization, absolute tolerance, and an optional unit
- Unscored ratings and polls

For a diagnostic or practice checkpoint, choose whether confidence is off, optional, or required.
Confidence uses **Not sure**, **Somewhat sure**, and **Very sure**. Add concept keys to connect
evidence across a main checkpoint and its linked recheck. For wrong choices, optional private
misconception keys and participant feedback turn the distribution into a more useful diagnosis.
Ratings and polls are always opinion checkpoints, unscored, and confidence-free.

Use **Add linked recheck** to create a differently worded check for the same concept. Rechecks are
unscored by default. A main checkpoint may link to one recheck; a recheck cannot link onward.

### Reuse questions from another Round

When the UX beta is enabled, an owner or editor can select **Reuse from your workspace** in the
question Insert area. Search by Round title, question prompt, response type, or concept, then choose
one or more main questions. A valid linked recheck is included with its main question and counts
toward the current Round's 200-question limit.

Selecting **Add _N_ questions** appends one independent snapshot to the current draft and
autosaves it through the normal editor queue. Every copy receives fresh question and choice IDs;
copied main-to-recheck links point to the copied recheck. The source Round is not changed, and
later edits to either Round do not synchronize. Use the editor's one-step **Undo** immediately
after the add to remove the whole copied selection.

Optional images are private. When an operator enables malware scanning, provide meaningful alt
text, select a JPEG, PNG, or WebP file up to 10 MB, and wait for upload and safety checking to
finish.

Select **Preview** to inspect the participant experience, then **Publish**. Publishing creates an
immutable version. Editing afterward changes only the draft until it is published again; an
active round always retains the version it started with.

### Review Question Health

When Question Health is enabled in the professional Round builder, expand **Question Health ·
advisory** and select **Review saved draft**. Wait for **Saved** first: the review describes one
saved draft revision and becomes stale after an edit. Each finding identifies the question and
field, explains the observed evidence, and suggests an action. Checks include duplicate or
overlapping choices, length cues, missing distractor feedback, explanations or citations, mobile
density, conflicting question settings, and linked-recheck wording or concepts. They are
deterministic authoring advice and do not block publishing.

Owners and editors can choose a reason and **Dismiss finding**, then **Reopen finding** later. The
decision is shared in the workspace and applies only while the relevant content and rules match;
editing that content can make the finding appear again. Saved decisions remain available to review
and reopen if an operator pauses new Question Health reviews.

For a supported finding, choose **Prepare draft revision**, write the proposed replacement, and
select **Preview before/after** before **Apply to saved draft**. A settings correction can align an
opinion question's scoring and confidence settings. Other findings still require normal
manual editing. Apply changes only the draft. **Undo this revision** restores that one change
while it is still the current saved revision; another edit makes that undo unavailable. Review the
result, preview it, and publish explicitly when ready.

After publishing, **Question Health · published version (read-only)** offers **Review published
version** against that exact immutable version. It does not change the version or its existing
sessions. **Edit matching question in current draft** opens the matching draft question when it
still exists; publish the revised draft to use it in future sessions.

In the same panel, **Review post-use observations** summarizes retained completed-session reports
for that exact published version. It examines at most the 250 most recent eligible reports and
keeps trust mode, timed/flex mode, and speed/accuracy scoring groups separate. A question needs at
least 20 responses in each included session. Cross-session accuracy variation is flagged only
after at least three compatible sessions and a range of at least 30 percentage points; unused
distractors require complete retained choice-count evidence. Ratings, polls, opinion questions,
and linked rechecks are excluded from these main-question checks. These aggregates suggest where
to review wording or instruction; they do not establish cause, create learner profiles, or prove
long-term learning. No eligible observations yet is a normal state.

### Source-grounded authoring assistant

When an operator configures an approved provider, expand **Draft checkpoints from a trusted
source** on the dashboard.

1. Paste at least 50 characters or choose a private PDF, DOCX, or PPTX file up to 6 MB.
2. Select **Create review proposal**. Arbitrary URL ingestion is intentionally unavailable.
3. Wait while an isolated worker extracts bounded text and asks the configured provider for a
   main checkpoint, linked recheck, answers, rationales, misconception labels, and citations.
4. Compare every citation and answer with the source.
5. Select **Create unpublished review draft** only when the proposal is useful.
6. Edit and explicitly publish through the normal editor.

The assistant never publishes content. Its citations remain on the created draft and are private
to creators; participant/session data is never sent in authoring prompts. If the panel says the
assistant is disabled, the deployment sends no source to a model. Hosted Free allows three jobs
per month, Hosted Pro allows 100, and a community operator controls provider access.

## Create and host a Presentation

When Presentations are enabled for your workspace, select **Create**, then **Presentation**. Add
content slides and interactive question blocks, or copy questions from a published Round. Copied
questions are independent; later source edits do not synchronize. Wait for **Saved**, inspect
**Preview**, and **Publish** an immutable version before hosting. Speaker notes and source
citations remain private authoring/facilitator information.

Live Presentation creation requires its separate realtime rollout gate. Select **Host**, create a
session from the published version, and share its code or direct link. Advance through content
slides and open, close, reveal, or recheck interactive questions using the controls offered for
the current phase. Participants receive complete slide content and question controls on their
own devices. When live flex mode is also enabled, choose **Flex** during setup to remove question
countdowns and deadlines for the whole room; the host closes responses. The live code expires
after 24 hours independently of how long session history is retained.

### Collect Presentation Q&A

An operator must enable `FEATURE_AUDIENCE_SCOPES=true` and include the workspace UUID in
`CORE_PARITY_WORKSPACE_ALLOWLIST`, in addition to the existing live Presentation gates.

1. On the live host screen, select **Activate audience Q&A**. Activation does not start or advance
   the Presentation. The panel opens with the segment's moderation and public-name defaults.
2. Participants join using the same code, link, or QR, then expand **Questions and answers**.
   Submit with **Ask question**; premoderated questions appear to their author and facilitator
   while awaiting review. **I have this question** adds one vote to a published question.
3. In the host panel, use **Publish**, **Dismiss**, **Remove**, or **Mark answered**. **Remove and
   block** blocks the author from Presentation Q&A, not from checkpoint answering.
   The host can pause Q&A or change public names and moderation in **Q&A controls**.
4. Companion can expand the same panel to read public questions and votes. It cannot publish,
   submit, vote, remove, block, or change Q&A settings; moderate in the host window.
5. If an acknowledgement is lost, choose **Retry the same Q&A action**. It resends the original
   intent, not a second question or vote. Collapsing and reopening the panel preserves that retry.
   Refresh restores accepted questions; it does not preserve an unconfirmed local draft.

Temporary discovery or Q&A read failures retry automatically, even if the realtime connection
still says Connected. A failed Q&A read hides the old list while current state is recovered. You
may use **Refresh** to request a new read; repeated clicks coalesce instead of discarding slow
successful results. Expired/revoked credentials require reopening through the appropriate join or
host flow rather than repeated retries.

The facilitator can see each author's session alias, even under Anonymous public display.
This is not organizer-blind feedback. Presentation replies remain unavailable; use **Mark
answered** after addressing a question verbally. At Presentation end, retained Q&A is read-only
until credential expiry/revocation or session retention/deletion. Disabling new activation does
not remove previously activated Q&A.

### Arrange text on a Presentation slide

Content slides support up to eight text elements total: exactly one title and up to seven text
boxes. The title accepts up to 160 characters; each text box accepts up to 4,000. Select a title
or text box on the canvas to edit it, or use **Content** in the inspector. Choose **Add text box** to
add another text element. Drag its move handle to position it on the bounded 16:9 canvas. Drag the
selected element's corner handle to change its width and height. With either handle focused, arrow
keys move or resize by 1% of the slide; hold Shift for 5%. **Show layout guides** in the **Layout**
inspector displays a 10% grid, safe margins, and alignment cues. The inspector also provides
horizontal and vertical position, width, and height as percentages for precise adjustment.
Adding text to an unchanged starter arrangement creates additional rows or columns. Once placement
is customized, adding a text box preserves the existing rectangles and looks for an empty area.

**Position on slide** provides nine quick region arrangements, stacking text in that region.
Use **Move up** and **Move down** to exchange positions and reading order within a region. The title
stays on the slide, while other text boxes can be removed. Resize a box if a fit warning appears;
overflowing text remains scrollable in preview and delivery. Narrow screens show complete text in
a single reading column rather than shrinking it to the desktop rectangles.

Custom text rectangles may overlap each other; the editor warns about the overlap rather than
rejecting the arrangement. The attached image area remains protected.

The six structured layouts—**Title**, **Title + body**, **Media**, **Quote**, **Section**, and
**Callout**—provide starting arrangements and visual styles. Applying one resets text positions to
that layout's defaults, and **Undo** restores the previous arrangement.
The canvas, preview, facilitator view, and participant view share the same slide arrangement, with
narrow screens reading top to bottom and left to right.

Attached images keep their preset placement. The guides mark a reserved **Image area**; attaching
an image reflows starter text and adjusts custom text boxes that intersect that area. Moving or
resizing text keeps it clear of the image. Removing an image restores starter text space while
preserving customized arrangements.
Region shortcuts use neighboring slots when the image occupies the requested region, keeping
multiple text boxes stacked in order.

Bounded positioning, resizing, and layout guides are in scope. Rotation, shapes, detailed font
styling, and a full freeform design canvas remain deferred.

## Organize and manage the Library

### Import, export, folders, and tags

Use folders, tags, and search to organize the library. Imports support bulk paste, CSV, versioned
Polling Pops JSON, and the supported QTI 3 profile. Every import displays validation errors and
warnings; unsupported content is never silently discarded. Polling Pops JSON is the lossless native
format. QTI supports selected-response, multiple-select, and numeric checkpoints; unsupported
types and omitted media are reported.

Export a checkpoint set as Polling Pops JSON, formula-safe UTF-8 CSV, or QTI ZIP. Hosted portability
exports require Pro; community deployments do not impose an application paywall.

### Delete archived content and session history

Workspace owners can permanently delete archived Rounds and Presentations in **Library**.
Filter by **Archived**, open an item's **More** menu, and choose **Delete permanently**.
To delete several archived items, select them and choose **Delete (N)** in the selection bar.
With a mixed selection, only the archived items are included. Confirm before deletion; canceling
keeps every item. Deletion removes all drafts, published versions, recovery history, favorites,
and group links for the item and cannot be undone. **Restore** remains available while an item
is archived.

An item with retained sessions or practice assignments cannot be deleted. Delete its associated
sessions first; content used by retained practice assignments must stay archived until those
assignments are removed by retention cleanup.

In **Sessions**, owners can choose **Delete session** for a finished or expired Round or
Presentation session. Confirmation permanently removes that session's responses, report, and
linked follow-ups. The source Round or Presentation remains in the Library. Active rooms must
finish or expire before the session list offers deletion. Editors and viewers cannot permanently
delete content or sessions.

Live access expiry does not immediately remove retained session history. An **Expired** session
can remain listed for its retention period, but cannot be resumed. Deleting its history also
removes the retained-session reference that otherwise prevents deletion of its source item.

### Choose a Round Experience

Every checkpoint set has one category and a versioned experience preset. The category recommends
a visual treatment; choosing a category never silently changes a preset you selected yourself.

| Category          | Recommended preset | Intended character                      |
| ----------------- | ------------------ | --------------------------------------- |
| General           | Candy Pop          | Berry, cream, and mint; calm, rounded   |
| Education         | Campus             | Friendly academic pattern               |
| Business          | Studio             | Professional slate and teal             |
| Technical         | Blueprint          | Structured grid and cyan accents        |
| Safety/compliance | Signal             | High contrast and restrained motion     |
| Icebreaker        | Spark              | Bright cards and optional lively motion |

The preset changes only presentation: semantic colours, accessible answer colours, bundled/system
typography, original patterns, card treatment, motion profile, and optional sound cues. It never
changes scoring, timing, order, visibility rules, or control placement. Publish after choosing a
preset so the immutable version records it. At session setup, the host can preview and override
the preset for that one round. Session creation freezes the resolved experience.

On a live device, **High contrast**, **Reduce motion**, and **Mute** are local preferences. They
always override the room presentation without changing another person’s screen. Sound starts
muted and duplicates visual status rather than carrying unique information.

## Host a live round

Select **Host** on a published set. Review audience, response timing, scoring, result visibility,
late joining, nickname policy, Round Experience, presenter sound, and Q&A settings before creating
the room. Timed is the default. An allowlisted workspace with live flex mode enabled can choose
**Flex** for a whole room: no response countdown or deadline, no speed scoring, and the host
decides when to close each question. The choice is frozen when the session is created.
Polling Pops then issues a seven-digit code, direct link, downloadable QR, and one-time host
credential.

Keep the host tab open. Host, cohost, and presenter credentials are separate and stored only in
the tab that received them. From the host screen you can issue revocable cohost or presenter
access instead of sharing the host credential.

### Lobby and multi-device entry

- Share the same room code, direct link, or QR with every participant; each receives an
  independent resume credential.
- If a local QR contains `localhost`, use **Change join address** and enter the computer's
  reachable trusted-LAN address. A public event requires a deployed HTTPS domain.
- Watch the roster, remove or ban abusive guests, and lock or unlock admission.
- Open the presenter popout for a room-facing display. The dedicated embed route is read-only and
  works only for HTTPS origins on the workspace allowlist.

### Run the Recovery Loop

1. **Start round** opens the main checkpoint. Timed rooms use a server-owned deadline; flex rooms
   stay open until the host closes responses.
2. Participants answer and optionally report confidence. An answer is complete only after
   **Answer received and saved**.
3. In a timed room, let the deadline close responses or select **Lock answers** early. In a flex
   room, select **Lock answers** when participants have had enough time.
4. Review the measured participation, correctness, confidence, and misconception signals. Every
   insight card shows the threshold and measurement behind its suggestion; it is guidance, not an
   automated judgment.
5. Before reveal, peer discussion is available. After reveal, record an explanation, example, or
   break intervention.
6. Run the linked recheck, or use a same-checkpoint revote when no linked recheck exists.
7. Finish the recovery branch before showing standings or moving to the next main checkpoint.

Pause and resume preserve remaining server time in timed rooms; flex rooms remain untimed.
Reconnect restores the exact lobby, checkpoint, intervention, or recheck state. Open checkpoint
payloads never expose answer keys, explanations, misconception labels, private citations, or
response distributions.

## Audience Pulse and room chat

Audience Pulse provides four structured, non-judgmental signals throughout the Recovery Loop:
**Got it**, **I’m unsure**, **Show an example**, and **Too fast**. A participant has one current
signal per lobby, checkpoint, recheck, revote, or intervention context and may change or clear it.
The next context starts with no signal.

Hosts and cohosts see each session alias, current signal, connection/answer state, last activity,
chat count, and moderation state. Presenter and participant screens receive aggregate counts only,
and those counts remain hidden until at least five unique participants signal in the context. An
open checkpoint never exposes an individual answer, correctness, confidence, or score effect in
the activity dashboard. Pulse remains separate from Recovery Loop recommendations in this
release—it is facilitator context, not an automated judgment.

Room chat is separate from Q&A and starts disabled for every session. A host can:

- Enable or close chat, choose public or room-anonymous participant aliases, and set 0/5/15/30
  second slow mode.
- Select an off, pinned-only, or live presenter feed. Pinned-only is the default.
- Pin or remove a message and mute a participant for 5, 15, or 60 minutes.
- Ban audience interaction, restore access, or kick the participant from the round.

Chat supports plain text up to 500 characters, one-level replies, and like/love/insight/laugh
reactions. It does not render links, attachments, Markdown, or private messages. A message created
in private-alias mode remains **Anonymous** to the room even if the host later switches to public
aliases; moderators retain the session alias for safety. Participants can report another person’s
message. Slow mode and distributed hard limits remain server-enforced across processes.

The participant interface explains: “The facilitator can see your session alias and signal; the
room sees totals only.”

## Audience Q&A

When Q&A is enabled, participants can submit questions and vote once per question. Depending on
the round settings, a question appears immediately or waits for a host/cohost moderator. Hosts and
cohosts can publish, answer, dismiss, or remove it, add replies, and remove abusive replies.
Participant replies are optional.

Education's default public display is anonymous while retaining a facilitator-visible alias for
moderation. Workplace defaults show aliases publicly. Q&A has independent rate and payload limits,
cursor pagination, sanitization, kick/ban integration, retention, export, and deletion.

## Join and participate

Open the home join form, `/join`, a direct link, or the QR code.

1. Enter the seven-digit code, choose a session avatar, and, when enabled, enter a nickname.
2. Wait in the lobby until a checkpoint opens.
3. Submit the displayed response format: one choice, an exact set of choices, a decimal value, a
   rating, or a poll selection.
4. If confidence is requested, choose one of the three confidence levels.
5. Wait for the durable saved acknowledgement. Retrying the same submission cannot create a
   second score effect.
6. After reveal, review private correctness, explanation, and choice feedback when available.

Session avatars come from a fixed set: Comet, Fox, Owl, Otter, Panda, Robot, Rocket, and Star.
They are cosmetic, contain no uploaded or free-form profile data, and are not learner accounts.
Older clients and direct API callers may omit the avatar; the server then chooses a stable avatar
from the participant's session ID. The resolved choice is saved with the live session, so refresh
and reconnect keep it. Hosts and presenters can use avatars with nicknames to follow the room, and
authorized reports retain them with participant detail. When results are private, a participant
can see their own avatar but not another participant's avatar.

No persistent learner identity is created. The resume credential lives in that browser tab's
session storage. Refreshing the same tab can recover state; another browser normally joins as a
new guest.

## Reports and recovery evidence

Reports are generated asynchronously from durable answers and should be ready within 60 seconds.
Report v3 includes initial accuracy, confidence-versus-correctness, misconception distribution,
interventions, linked-recheck recovery, separately labelled revote improvement, unresolved
concepts, participation, response time, the frozen experience, aggregate Pulse distributions,
conversation/moderation counts, Q&A, and participant-private feedback.

For Rounds created while decision replay capture is enabled, report v4 adds **Decision replay**.
Its **Facilitator decisions** timeline records the insight measurements and recommendation shown
at lock, including the rule version, plus answer reveal, intervention start/finish, recheck or
revote opening, question advance, and session finish. These are recorded server events; the report
does not infer actions from answers or record audio/video. Capture is frozen at session creation,
so enabling it later does not reconstruct an older session. Existing captured sessions retain it
when new capture is paused. A missing or partial timeline is labelled explicitly; capture is
bounded to 5,000 events per session. Replay is descriptive context, not evidence that an action
caused recovery, and is included in the versioned report exports.

Linked recovery always displays its numerator, denominator, evidence type, and a small-sample
warning. It means initially incorrect participants who answered both checks and later answered the
linked recheck correctly. It is session evidence, not proof of long-term learning.

Download versioned JSON or formula-safe UTF-8 CSV where the edition permits it. Workspace owners
can use **Delete session and report** to permanently remove the session tree. Hosted Free defaults
to 30-day report retention, Hosted Pro to 365 days, and community operators configure their own
default.

The standard report stays aggregate-first and does not embed raw chat or participant-level signal
history. An authorized owner, editor, or viewer can open the interaction transcript; only an
owner/editor audit view can reveal a removed body. Transcript CSV follows the existing export
entitlement and escapes spreadsheet formula prefixes.

## Create an accountless follow-up

Pro and community facilitators can select unresolved concepts on a completed report and create an
immutable self-paced follow-up.

- Choose timed or no-countdown time-flex mode and an optional close date.
- Copy the generic anonymous link or download one-time personal links for live participants.
- Create a revocable 1.5× or 2× accommodation pass without storing a reason or revealing it to
  others.
- Close the follow-up early or revoke an individual link from the report.

Personal bearer links allow one attempt by default. A generic link creates an unpaired anonymous
attempt. Progress and deadlines are server-owned, attempts can resume on the same device, and
follow-up deletion/retention cascades with its source session.

## Assign practice from a published Round

When standalone practice is enabled for your workspace, open a published Round and choose
**Assign practice**. Polling Pops freezes the current published version, so publishing later edits does
not change an assignment that learners have already opened.

- Choose an optional title, a timed or no-countdown mode, and a close date within your plan's
  retention window.
- Use the generic link for anonymous, unpaired practice or add recipient labels to create
  revocable one-attempt links. Labels help you distribute links; learners still do not need
  accounts.
- Copy or download every new bearer link when it is shown. Polling Pops stores only its hash and does
  not reveal the same URL again.
- Open **Practice** to see aggregate started/completed counts, add another labelled personal link,
  revoke a link, create an accommodation pass, or close the assignment early.

Standalone practice includes the published Round's main questions. Linked rechecks remain
conditional Recovery Loop material and are not added as unconditional practice questions. If a
workspace administrator later disables new assignment creation, already-created assignments stay
available to manage and complete until they close or expire.

## Account and data controls

Open **Account** to manage members, workspace selection, branding, secure embed origins, billing,
data export, and deletion. Workspace branding requires readable colours and is layered only onto
safe Round Experience surfaces. Account export includes owned collaboration, Q&A, Pulse, chat,
moderation, recovery, follow-up, and authoring data without bearer-token hashes. Permanent
deletion requires typing `DELETE` and removes private objects before durable workspace records.

### Institution-enabled workspaces

An operator-approved institution workspace also shows its permanent home region, capability
policy, linked identities, LMS registrations, and—when approved—an owner-only audit export.
Workspace owners cannot self-enable contract-gated capabilities.

For creator OIDC, first sign in by email and explicitly link the institution identity from
**Account**. Polling Pops keys the link by workspace, issuer, and subject; it never links by matching
email. The Account screen then provides the workspace-specific institution sign-in URL and lets
you revoke the link.

For LTI 1.3, an LMS administrator and the Polling Pops operator must register matching issuer,
client, deployment, authorization, JWKS, and return-origin values. The first verified instructor
launch requires explicit linking to an existing creator. A Deep Linking launch opens a selection
screen containing published checkpoint sets and returns one signed resource link to the LMS.
Learner LTI launch, roster access, and grade passback are not available in this release; continue
to use the anonymous live-round QR or direct link for participants.

See the [institution integration guide](institution-integrations.md) for operator configuration,
security behavior, and pilot gates.

The included legal pages are drafts. A public operator must replace them with counsel-approved
text and set the corresponding policy version.

## Accessibility and facilitation

- Prefer accuracy mode for formative learning; use speed only when speed has instructional value.
- Where enabled, use whole-room **Flex** for host-led live questions. Use time-flex follow-up or
  accommodation passes for self-paced work where timing is not part of the construct.
- Keep prompts concise, but put every essential fact and answer label on participant devices.
- Never rely on colour, position, a projector, or an image alone.
- Test keyboard operation, screen readers, 200% zoom, reduced motion, contrast, and the actual
  participant network before an important event.
- Use anonymous participation when names are unnecessary, especially in education.

## Troubleshooting

| Message or symptom                                      | Meaning and response                                                                        |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Invalid code**                                        | Check all seven digits; the round may have ended or expired.                                |
| **Session is not accepting participants**               | The lobby is locked, late join is off, or the round ended.                                  |
| **Time expired before the server received that answer** | The timed room's authoritative deadline passed before receipt. Flex rooms have no deadline. |
| **This tab does not have the host credential**          | Return to the original host tab or issue a new scoped staff credential.                     |
| **Reconnecting…**                                       | Leave the tab open; the client requests an authoritative snapshot.                          |
| **Room chat is closed**                                 | The host must enable chat for this session; Pulse may still be available.                   |
| **You are sending messages too quickly**                | Wait for the displayed slow-mode/rate-limit interval, then retry once.                      |
| Pulse totals are hidden                                 | Fewer than five unique participants have signalled in the current context.                  |
| Report says **Finalizing…**                             | Wait up to 60 seconds, then ask the operator to inspect report jobs.                        |
| Authoring says **disabled**                             | The operator has not configured an approved provider; no source is sent.                    |
| An authoring proposal **needs attention**               | Review its extraction/provider message and submit a corrected source or retry later.        |
| Question Health review is stale                         | Wait for the latest draft to show **Saved**, then review that saved revision again.         |
| **Undo this revision** is unavailable                   | Another draft revision has followed the applied change; use normal editing instead.         |
| No post-use observations yet                            | No retained report meets the per-question sample requirement for that version and group.    |
| Decision replay is missing or partial                   | Older sessions lack captured events, or bounded capture omitted events; do not infer them.  |

Operators should continue with the [production readiness checklist](runbooks/production-readiness.md)
and [incident response runbook](runbooks/incident-response.md).
