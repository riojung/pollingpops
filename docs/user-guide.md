# Polling Pops user guide

Polling Pops helps a facilitator run a complete comprehension-recovery loop:
**ask → diagnose → intervene → recheck → prove**. Participants join as session-scoped guests and
do not need accounts.

For a local first run, complete the [quick start](quick-start.md) first.

The Core-Parity foundation includes gated Presentation Q&A and a gated self-paced Survey beta
using single- or multiple-selection opinion polls and ratings. Presentation replies/chat/Pulse,
Q&A-only feedback rooms and advanced feedback exports remain pending. Live Rounds support gated
multiple-selection polls, ranking, moderated open text and word clouds.
Existing learning Q&A's Anonymous public display still lets
moderators see the session alias; it is not organizer-blind feedback. Track availability in the
[implementation status](implementation-status.md), not by enabling reserved future flags.

## Choose an activity and a template

Select **Create → Round**. Choose **Live quiz** for knowledge checks/recovery, **Live poll** for
unscored host-paced opinions, **Survey** for independent responses over time, or **Custom Round** for
mixed live questions. Older starting links still work as custom workflows. Formats can be changed
later in the Round editor. A live poll is not a self-paced Survey.

Open **Templates** and choose **Rounds**, **Presentations**, or **Surveys**. Search original
Round and Survey templates and filter by category/type. **Preview questions** shows prompts
and options without creating content. **Use this starter** makes an independent draft with fresh IDs.
Presentation templates provide ready-to-edit slides and interactions for meetings, training,
reviews, and workshops. Survey templates contain opinion polls and ratings for self-paced feedback.
Review every answer, explanation and recheck for your audience before publishing. Original template
content is English; chooser/filter controls are localized.

## Idea Boards and shared canvases

When enabled for your workspace, open **Idea boards → New board** and choose **Team canvas**
for a shared spatial workspace or **Guided workshop** for moderated guest ideas and voting.
Review the title before creating. Workshop settings contain the participant identity, review,
visibility, vote budget and lifetime choices. Existing workshop links continue to work; a facilitator can
choose **Add canvas view** while the workshop is still a draft or collecting ideas.

Choose a blank board or preview one of seven original starters for brainstorming, retrospectives,
project planning, decisions and learning reflection. Starter content is in English and remains
editable. Review the title, workshop prompt and settings before creating. Guided starters create
both the workshop and its canvas, with published instructions and prompt notes rather than
invented guest responses. If setup is interrupted, return in the same tab and retry;
the saved setup resumes the unfinished step. Restore the original account and owning workspace
if the setup reports that they changed. **Keep workshop without canvas** retains an
already-created workshop and its direct link. Signing out clears saved setup. If tab storage is
unavailable, use a blank guided workshop or allow storage before retrying a starter. Search finds
matching titles throughout the selected board view; **Load more boards** pages through those matches.

On a Team canvas, add sticky notes, text, rectangles and ellipses. Select an object to change its
text, color, size and position in the inspector, then choose **Save changes**. The object outline
provides equivalent selection without dragging. Use **Connector** and select two objects, or
choose the endpoints in the inspector. **Fit board**, **Fit selection** and zoom controls help
navigate; the hand tool pans, and touch devices support pinch zoom. Duplicate, delete, arrow-key
movement and your own undo/redo are available outside text fields.

Use Shift-click, outline checkboxes or **Select area** to select several objects. **Group selection**
keeps objects in the same parent frame together; **Frame selection** wraps them in a frame.
**Parent frame** moves selected items into or out of a frame. Moving a frame carries its contents;
resizing changes its border. The selection panel provides alignment, distribution, duplicate,
delete and numeric movement controls. Actions affecting more than 50 objects, including frame
contents and connected objects, stay disabled until you choose a smaller selection. Lock a
selection to prevent editing, and explicitly unlock it before making changes. Workshop guest-card
and publication permissions continue to apply inside groups and frames.

**Freehand** creates a saved stroke when you finish drawing; use two fingers to navigate. **Link**
adds an HTTP(S) link card with a label, without fetching a remote preview. **Image** accepts JPEG,
PNG and WebP files up to 10 MiB when the operator has enabled image storage and scanning. Add an
image description for people who cannot see it. Images become usable after successful malware
scanning. Uploaded images remain private to the board until a facilitator deliberately publishes
their objects to workshop guests. You can
undo image deletion while its operation remains in retained history.

**Share board** invites a verified teammate in the same organization as a Viewer, Editor or
Facilitator. The recipient opens the invitation link and chooses **Accept board invitation**;
the accepted board appears under **Shared with me**. This leaves the teammate's workspace and
license unchanged. Editing requires an active creator
license. Owners can revoke pending invitations and change or revoke accepted board roles.
Presence is optional and visible only to
authorized team members. Sharing is not available between personal accounts or organizations.

Changes save when you finish a gesture or explicitly save text. Different objects can be edited
at the same time. If another person changes the same object, your draft stays available for
review; **Apply reviewed change** submits it against the latest version. An interrupted request
can be retried without duplicating its accepted operation. Check the saved/connection state
before leaving. This release does not provide simultaneous character editing or offline editing.
Interrupted live connections reopen automatically; when live updates are unavailable, authorized
snapshot polling continues and the saved state identifies that fallback.

If a collaborator deletes a note while you are editing it, **Object no longer available** keeps
your unsaved text visible. Use **Copy draft text** to recover it for another note, or explicitly
choose **Discard my draft**. The leave-page warning remains active until you discard the draft.

For workshops, open **Workshop controls** to start collection, review pending ideas, arrange
approved cards, manage groups, start voting and close the board. Guest submissions keep their
original identity and privacy rules. For an ordinary selected object, facilitators use **Guest
visibility → Published to guests** and save to publish it; **Team only** keeps it private.
Publishing an object does not publish its children. Editors cannot change published workshop
objects or move or rewrite guest idea cards.
Published instructions and images remain visible while peer ideas are hidden during collection.
Workshop groups organize ideas for voting; canvas groups organize their positions.
Starting voting freezes the workshop canvas, and accepted guest ballots remain final after
refresh. Guests keep the guided submission and voting list beside the published canvas and
never need creator accounts.
Owners can choose **Switch workspace and open workshop** in Workshop controls to return to
the original grouped list and its deletion controls. This explicit action selects the owning
workspace before navigating.

Open **Facilitation** for **Comments**, **Timer** and **Saved versions**. Select an object and
choose **Comment on selected object** to start a discussion attached to it. Eligible editors can
reply and edit or delete their own comments; owners and facilitators can resolve, reopen and
moderate discussions. Viewers can read comments. These discussions are team-only and are not
shown to workshop guests. If a request is interrupted or conflicts with another update, **Your
draft** stays available for retry or explicit review and resend. Hiding and reopening
**Facilitation** preserves unsent comments, version names and pending retries. Discard a draft
explicitly when it is no longer needed. Draft text is kept only in the open editor; it is not an
offline backup.

Owners and facilitators use **Timer** to start, pause, resume or reset a countdown of up to two
hours. Everyone sees the server's remaining time, including admitted workshop guests. The
countdown never starts voting, closes a workshop or changes its phase automatically.

When live updates are enabled, an owner or facilitator can choose **Present my view** for team
members. Following is optional: choose **Follow presenter**, and use **Stop following**, pan,
zoom or Escape to return to your own view. For workshop guests, select an explicitly published
frame and choose **Present selected frame to guests**. Guests follow that published frame;
private team viewport coordinates and presenter identities are not shared with them. A stopped
or expired presentation stops following without changing the canvas.

**Export** downloads **Whole board**, **Current view** or the area of one **Selected frame** as
SVG or PNG, with a white or transparent background. A frame export includes authorized objects
within its area, not just objects assigned to that frame. Links appear as plain text, without
opening websites. Exports omit pending ideas, comment threads, system identity metadata and
credentials. Downloads are bounded to 25 image placements and 20 MiB, with dimensions up to
4,096 pixels per side. Choose a smaller area if a download cannot finish. Export is a team
account action; workshop guests do not receive export controls.

In **Saved versions**, eligible editors enter a **Version name** and choose **Save version**.
Up to ten manual checkpoints are retained within the board's history allowance; owners and
facilitators can delete saved versions to make room. **Preview** shows the saved layout using
current access and guest-moderation rules. Removed guest content does not reappear in an older
version. **Restore layout** changes only the layout of objects that still exist. It preserves
current text, image descriptions, publication choices and content, and never recreates deleted
objects. Locks, protected cards, current object versions and the 50-object action limit still
apply. A restore that cannot move current groups and frame contents together is unavailable;
review the current arrangement before trying again.

Canvases allow up to 500 objects, 2 MiB of document data and 5,000 accepted changes over their
pilot lifetime. Reaching that change budget stops further editing; deletion remains available.
Workshops reserve space for their
existing limit of 200 idea cards, leaving up to 300 ordinary canvas objects. Existing workshop
participant, lifetime and retention limits still apply. Team boards have a recorded retention
window; deletion requires confirmation. Each board allows up to 100 image upload reservations
and 200 MiB of reserved image data over its lifetime. Saved versions have a separate 4 MiB total
allowance and a 2 MiB limit per saved scene. Higher canvas capacity remains gated on measured
evidence; these tools do not add AI features.

Use **Diamond** for a decision and **Parallelogram** for an input/output step, or start from
**Flow to action**. Select a connector to edit its visible label, straight/elbow route, solid/dashed
line, palette color and start/end arrows. Choose source and destination objects and their cardinal
ports in the inspector; detached endpoints use coordinates. Selected nodes also have rotation and
layer controls. Object outline and numeric fields provide keyboard alternatives to canvas gestures.

In a Round or Presentation builder, open **Canvas snapshots**, choose **Link saved canvas**, then
select an eligible board and its named saved version. Save a version on the canvas first if none
is available. The reference keeps that exact layout instead of following later edits. Creation
requires ownership of the source canvas and editing access to the activity in the same workspace.
Use **Preview snapshot** to inspect it; viewing requires current access to both. **Remove link**
leaves the canvas and saved version intact. Deleted, expired or inaccessible sources disappear,
and current moderation still hides removed guest content. Up to 20 references fit one activity.
These references are private authoring aids; participants and published activities do not receive them.

## Standalone Surveys (beta)

Surveys are a first-class **Library → Surveys** tab alongside Rounds and Presentations. Search
titles/descriptions and folder names; combine Status, Folder, Favorites and Ownership filters.
Grid/List uses the same workspace preference as the other tabs. Star a Survey to save a private
favorite; select one or more Surveys to move them into a workspace folder, duplicate them, or
archive them. Owners/editors may organize existing Surveys even when new creation is paused.
Archiving preserves published versions and existing run evidence. Survey restore/permanent artifact
deletion are not offered yet; duplicate an archived Survey when creation is enabled.

**Survey runs and results** opens delivery history in **Sessions → Surveys**. To review completed
outcomes directly, choose **Results → Surveys**. Old `/surveys` bookmarks open the Library Surveys
tab; survey editor and management-room links remain available.

Your operator must enable the flags/allowlist in the quick start. Owners/editors create, edit,
publish and share; viewers can read content/results.

## Send product feedback

Choose **Feedback** in the workspace header from any creator workspace page. Pick a problem,
usability issue, suggestion or other feedback and describe what you tried, what happened and what
you expected (10–4,000 characters). Follow-up by account email is optional and unchecked by default.
Submit and keep the receipt reference. If delivery fails, your message stays in the dialog; retrying
the same message reuses its receipt rather than creating a duplicate. Escape/Cancel closes the
dialog and returns focus to Feedback. Do not close a draft you want to keep: unsent feedback is not
saved outside the open dialog.

Only the product team's administrator interface can review submitted feedback. The stored page
type excludes queries, fragments and object identifiers. Screenshots, participant responses and
logs are not collected automatically. Do not include passwords, tokens or participant details.
Feedback is retained for 90 days and removed by scheduled retention or account/workspace deletion.
Submitting feedback does not mean public beta or production launch has been approved.

## Create and run a Survey

1. Choose **Survey**, then a feedback template or **Create blank Survey**.
2. Edit details, add poll/rating questions, label scale endpoints, select required/optional, and
   reorder/remove items. For a poll, choose **Maximum selections**: one uses radio buttons; two or
   more uses checkboxes. The limit cannot exceed the number of options (two to six). Participants
   may deselect choices, but cannot select more than the limit. Removing an option reduces the
   limit if necessary. These opinion polls have no correct answers, confidence or scores.
   Option text uses multiline fields. The trash button beside each option removes only that option;
   at least two options must remain. Long labels wrap in previews and participant views.
   Open text, word clouds and ranking are available in enabled Live Rounds; Surveys currently
   support polls and ratings.
3. Draft edits autosave after a short pause. Watch **Waiting to save…**, **Saving…**, then **Saved.**
   You can keep typing during a save, or use **Save draft** to save immediately. Preview, then
   **Publish Survey**; publishing first waits for all current edits to be saved. Autosave does not
   publish changes. After editing a published Survey, publish again before creating a new sharing link.
   If saving fails, use **Retry save** before leaving. Retry preserves the original request even
   if you have made newer edits. On a revision conflict, saving pauses and your edits stay in this
   editor. Workspace links, search, and sign-out ask for confirmation while saves or operations
   remain unsettled, including during the debounce window. Cancel keeps you in the editor;
   confirm only when discarding that local work is intentional. Reload/close also warn.
   **Download local draft** keeps a JSON copy on your device; it is a recovery copy, not a
   supported Survey import. **Reload latest version** asks for confirmation before discarding local
   edits and loading the other editor's version. Edits are not backed up automatically to browser
   storage; wait for **Saved.** before closing or refreshing the page.
4. Choose a window (seven days by default, up to 30) and **Create sharing link**.
   Share the code, link or downloadable QR. New sharing links are separate runs; later edits never
   alter an already shared version.
   New runs retain results after their scheduled close for 30 days on Free, 365 on Pro, or the
   Community operator setting. The sharing screen shows the expiry date. Closing early does not
   extend the frozen deadline. Existing runs keep their original deadline; close an older run early
   if its displayed expiry coincides with its scheduled close.
5. Participants use the normal Join page without an account, nickname or avatar. They answer at
   their own pace, **Save progress** before leaving, then **Submit Survey**. Required items must be
   answered. Refresh resumes saved answers on the same browser. One completion per credential is
   enforced, not verified one-person identity; another browser/device is a new credential.
6. Return through **Library → Surveys** (`/library?type=surveys`) for content. Use **Sessions → Surveys**
   for sharing and closing runs, and **Results → Surveys** (`/results?view=surveys`) for completed outcomes.
   Refresh results to count finalized submissions. **Close admissions and submissions**, or wait for
   the deadline, to release final distributions. Each question needs at least five finalized answers;
   optional unanswered items do not count toward that minimum. Open runs never show changing
   distributions, which could reveal individual answers through consecutive result comparisons.
   Multi-selection counts show respondents who selected each option; their sum can exceed the
   number of responses. A respondent is counted only once for each selected option.
7. Owners/editors may close a run; only the workspace owner may permanently **Delete survey run**.
   **Duplicate** an archived Survey to create a new editable draft without altering the original.

Organizers cannot inspect linked respondent answers. A room-only bearer credential is stored locally
for resume and only its hash server-side. Clearing site data loses resume access. Closing blocks new
admissions/submissions; saved receipts remain readable until retention. Deleting a run removes its
attempts/receipts, including its sharing-link creation receipt. Survey opinions are separate from
learning accuracy and Recovery evidence.

## Password-protected sessions

Paid workspaces can optionally require a password when launching a Round, starting a live
Presentation, or creating a Survey sharing link. Choose **Require a password for this run** and
enter a **Room password** of 8–128 characters before creating it. On Round setup, expand
**Review settings** to find the option. Passwords are case-sensitive;
spaces are preserved. The option starts off. Free workspaces can create normal sessions and see
an explanation that password protection requires a paid plan. A paid Event Credit launch can use
the option where Event Credits are enabled.

Share the room code, joining link or QR, and send the password separately. Joining links and QR
codes do not contain the password. Participants enter it on the Join page or the direct Survey
page before admission. Incorrect passwords leave them on that page to retry. No participant
account is required. An admitted participant can resume with the same browser credential without
entering the password again.

Protection belongs to that specific session or Survey run. Reusing published content creates a
new run with its own choice of protection. Existing protected runs keep their password requirement
after the workspace changes plan. The original password cannot be recovered from the server;
keep it available to share with your intended audience.

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

Use **Collapse navigation** at the top of the desktop sidebar to switch to an icon rail and gain
more working space. Hover or focus an icon to see its destination. **Expand navigation** restores
the labels. This preference is saved in your browser across workspace pages and reloads. On phones,
the workspace continues to use its horizontal navigation.

The default workspace opens at **Home**, with **Library**, **Sessions**, and **Results** on every
plan. It does not require UX beta flags or pilot allowlist membership. An administrator can still
disable the workspace navigation or restrict its included plans. The professional Round builder,
Presentations, and Surveys retain their separate feature and plan gates. Live Presentations,
whole-room flex timing, Question Health, and decision replay have additional
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

Education onboarding defaults to accuracy scoring, private results, calmer
motion, Q&A premoderation, and participant replies off. Workplace onboarding defaults to speed
scoring, a leaderboard, Q&A postmoderation, and participant replies on. Both let participants choose
a nickname or leave it blank for a generated one. A facilitator can require generated-only
nicknames or change other round settings before creating a room.

For a scored Round with **Leaderboard** results, the competition dashboard shows the top three,
current standings and each participant's own position and points gap. Scores update only after
the facilitator reveals a scored main question. Choose **Show standings** for the full competition
phase; finishing retains the final podium and personal result after refresh. Interventions and
rechecks pause the audience race view. Private results remain private, and opinion-only polls
show an unscored explanation without winners. See the [competition dashboard guide](idea-016-competition-dashboard-plan.md).

Switch between **Race view** and **Table view** to compare released scores. The dashboard highlights
the biggest climb, the latest scored-question gain and correct streaks without bonus points.
The host keeps a compact standings summary beside the question flow; **Show standings** and the
final screen use the full main stage. Secondary recovery/staff tools are collapsed. On the host
and projector, expand the scoring/motion disclosure for display controls. Audience tools use
responsive participant cards in narrow drawers, with counts refreshed as participants join.
At the finish, **Replay celebration** repeats only the visual effects. The **Motion effects** choice
is saved for your browser; device and **Display & sound → Reduce motion** settings take precedence.

## Sign in and workspace access

1. Select **Create a free checkpoint set** or open `/signin`.
2. For a new account, select **Create account**, choose education or workplace learning, enter
   your email, accept the displayed policies, and select **Send verification email**.
3. Open the verification email and follow its single-use link within 15 minutes. Verification
   creates the free account and returns you to sign-in; it does not sign you in.
4. Select **Sign in**, enter your verified email, accept the displayed policies, and select
   **Send sign-in PIN**. PIN entry opens immediately while the email request is in progress.
   Enter the six-digit PIN from the newest email, then select **Sign in** once the request is
   accepted. The PIN expires after ten minutes and can be used once. Future sign-ins use this
   PIN step directly.

Normal sign-in opens **Home** (`/home`). If you were returning to a specific page, that destination
is preserved. An accepted invitation opens Home in the invited workspace after PIN sign-in.
If an administrator has disabled the workspace navigation for your plan, the classic view remains
the fallback.

Keep the sign-in tab open while waiting for the email. Once the request is accepted, that tab
remembers the pending sign-in across a refresh; it never stores the PIN digits. If the first
request's response is interrupted before acceptance is confirmed, wait for the displayed cooldown
and request a new PIN.

Wait at least 60 seconds before requesting another PIN. An accepted resend replaces the previous
PIN. If a resend is rate-limited, the current PIN entry stays available and the existing PIN still
works until it expires. Follow the displayed wait time before retrying. Rejected cooldown retries
do not use the three-request email quota, and requests made before account verification do not
block the first request after verification. If sending fails, the page shows a delivery error;
wait for the cooldown and request a new PIN.

Local Compose captures both emails in Mailpit at <http://localhost:8025>. Select **Open local
email inbox** on the sign-in page. If the configured public address differs from the browser
address, move to the configured sign-in page first and continue using that origin after
authentication. Participants can use **Join a Round** without creating a creator account.

Use **Home** or **Library** to return to your Rounds and enabled Presentation or Survey tools;
the classic fallback uses **My checkpoint sets**. Select **Sign out** to revoke the current browser
session. Owners can invite editors or viewers from **Account**. An invitation is single-use and expiring; anonymous
invitees accept it and then separately sign in with an email PIN. A person who
belongs to multiple workspaces can switch the active workspace there.

Platform administrator access uses a separate console and account. Provisioned administrators
open the console directly and enter their username, password and authenticator code; normal local
bundles serve it at <http://localhost:3002>. Customer sign-in does not create administrator access,
and customer sign-out only ends the customer session. See the
[administrator setup guide](../apps/control/README.md#standalone-password-authentication).

## Create and organize Rounds

Choice answers use multiline fields with a separate trash button for each removable answer.
Click inside the text field to edit; use the correctness control beside it for scored questions.
Polls and ranking questions give that space to the answer text. At least two answers must remain.

In the professional workspace, select **Create**, then **Round**, and choose a starter, trusted
source, structured import, or blank Round. In the classic view, enter a title under **Your
checkpoint sets** and select **Create checkpoint set**. Draft changes autosave after a short pause.
Wait for **Saved** before leaving the editor.

The editor supports:

- Single select and true/false
- Multiple select with exact-set scoring
- Numeric responses with decimal normalization, absolute tolerance, and an optional unit
- Unscored ratings and polls, plus gated live ranking, open text and word clouds

For a diagnostic or practice checkpoint, turn confidence off or on with an optional response.
Previously authored required settings remain readable for practice assignments. Confidence is always optional
in a live Round, including older questions authored with required confidence. Live setup has a separate
**Ask for confidence (optional)** switch, which starts off. Confidence uses **Not sure**,
**Somewhat sure**, and **Very sure**. Add concept keys to connect
evidence across a main checkpoint and its linked recheck. For wrong choices, optional private
misconception keys and participant feedback turn the distribution into a more useful diagnosis.
Ratings, polls, ranking and text are always opinion checkpoints, unscored, and confidence-free.

When live multiple-selection polls are enabled for your workspace, a Poll question offers
**Maximum selections** from one to the number of options, up to six. Participants select their
choices with checkboxes and then submit; reaching the limit still permits deselection. A refresh
restores all saved choices. Removing an option in the editor lowers the limit when necessary.

Results count people choosing each option, so percentages can total more than 100%. Polls do not
have correct answers or contribute to learning accuracy. Multiple-selection opinion polls currently
run in live Rounds; use a Survey for self-paced opinions. Presentation imports and practice
assignments explain when a Round contains this unsupported format.

A **Ranking** question offers two to six options. Choose the full list or a top-N count.
Participants add options and use labelled Move up/Move down buttons before submitting; the same
controls work by keyboard and on phones. Refresh restores the submitted order. Results show
weighted scores, the number of people ranking each option, and average rank. Ranking is unscored.

**Open text** accepts one response up to 1,000 characters. **Word cloud** accepts one phrase up
to 80 characters. Participants see a saved receipt after submission and on refresh; their text
is not copied into ordinary session snapshots. Hosts and cohosts review the private queue and
approve or remove each response. Removed responses cannot be restored. Finish moderation before
ending the session, when reports become immutable.

Public text results require reveal and at least five approved responses. Pending and removed
text stays out of public results, reports and ordinary account exports. Word clouds group
normalized phrases without case differences and include a readable frequency list. These formats
are available in enabled Live Rounds; Presentation, practice, Companion and Recovery Pack paths
do not accept them yet. Text rooms support up to ten text checkpoints and 250 participants.

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

### Find sessions and Survey runs

Open **Sessions** and choose **Rounds**, **Presentations**, or **Surveys**. Each tab shows
the workspace's retained delivery history; its badge counts all retained sessions of that type.
Search by the title recorded when the room was created or its room code. Use **Status**, the
source-content selector, and date filters to narrow the list. Round and Presentation dates refer
to when the session started; Survey dates refer to its collection deadline.

Choose **Grid** or **List** to save a layout for this workspace. Sessions keeps its own layout
preference. The selected tab, search, and filters can be bookmarked or shared with another
workspace member through the page URL. **Back to … library** opens the matching Library tab.

Active Rounds and Presentations offer host access to owners and editors. Survey runs offer
**Manage sharing** while open and **View results** while their results remain retained. Survey
history stays available when new Survey creation is paused. Survey cards do not expose
respondent identities or individual answers. Existing `/surveys/runs` links open the Surveys tab.

### Review Survey outcomes

Open **Results → Surveys** to browse closed runs whose results remain retained. Runs appear after
explicit closure or their collection deadline; open and expired runs stay out of this results list.
Search by the recorded Survey title or run code, select a source Survey, filter by collection
deadline, and choose **Grid** or **List**. Results keeps its own workspace layout preference.

**View Results** opens the aggregate report directly at `/results/surveys/{runId}`, without passing
through Sessions. It shows finalized submissions and question-level distributions, with no scores
or respondent identities. Distributions remain hidden below five responses per question. The report
provides refresh and, where enabled, **Share summary** and summary downloads. **Back to Survey results**
returns to the Surveys tab; owners/editors can choose **Manage Survey run** for sharing and closure.
Existing results remain readable when new Survey creation is paused.

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
delete content or sessions. Owners can also choose **Delete Survey run** for a closed or expired
Survey run; this permanently removes the run and its retained responses while keeping its source
Survey in the Library.

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

**Ask for confidence (optional)** starts off for every new live Round, including when you reload
setup. Turn it on to offer the
three confidence choices on scored diagnostic and practice questions; participants can always
skip them. Enabling it applies to that Round. You can also change it from the host
screen during a live question. Turning it off hides the controls and clears confidence that has
not been submitted. Answers already saved retain their recorded confidence and points. Opinion
questions remain confidence-free.

Keep the host tab open. Host, cohost, and presenter credentials are separate and stored only in
the tab that received them. From the host screen you can issue revocable cohost or presenter
access instead of sharing the host credential.

### Lobby and multi-device entry

- Share the same room code, direct link, or QR with every participant; each receives an
  independent resume credential.
- If a local QR contains `localhost`, use **Change join address** and enter the computer's
  reachable trusted-LAN address. A public event requires a deployed HTTPS domain.
- **Copy join link** supports HTTPS and local HTTP browsers. If copying is blocked, use the
  selectable link field to copy it manually.
- Watch the roster, remove or ban abusive guests, and lock or unlock admission.
- Open the presenter popout for a room-facing display. The dedicated embed route is read-only and
  works only for HTTPS origins on the workspace allowlist.

### Run the Recovery Loop

1. **Start round** opens the main checkpoint. Timed rooms use a server-owned deadline; flex rooms
   stay open until the host closes responses.
2. Participants answer and optionally report confidence. An answer is complete only after
   **Answer received and saved**.
   Recovery questions retain explicit submission. Once a participant starts a draft, the submit
   control stays in view with an unsaved notice. Confidence is optional. If the
   question closes without a saved response, an explicit notice explains that outcome.
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

1. Enter the seven-digit code and choose a session avatar. Choose a nickname or leave it blank
   for a generated one. If the host requires generated-only nicknames, one is assigned when you join.
2. Wait in the lobby until a checkpoint opens.
3. If optional confidence is shown, choose a level or skip it. In competitive single-choice and
   true/false main questions, confidence appears before the answers so you can choose it first.
4. Answer the displayed response format: one choice, an exact set of choices, a decimal value, a
   rating, or a poll selection. Selected choices and confidence show a checkmark and distinct
   highlight. In competitive single-choice and true/false main questions, the professional
   experience saves immediately when you choose an answer, with or without confidence. Other
   formats, private rounds and rechecks use **Submit response** to save after review. Confidence
   never blocks a live answer.
5. Wait for the durable saved acknowledgement. Retrying the same submission cannot create a
   second score effect.
6. After reveal, review private correctness, explanation, and choice feedback when available.

Only accepted responses can earn points. Correct scored answers receive the authored base points
in accuracy mode and 60–100% of them in speed mode. Time spent in a host pause does not reduce
speed points. Unsaved selections cannot be reconstructed or scored after a question closes.
The participant's standings show saved and correct response counts for revealed scored questions.
The receipt distinguishes an unanswered question from a saved incorrect answer. When every score
is zero, standings show a neutral points message without a winner podium.

Choose from 24 session avatars, including animals, space characters and a robot. Scroll the
avatar grid to see every option; the original eight choices remain available.
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

The **Results** page includes an **At a glance** overview for the selected activity. Its widgets
summarize the results currently shown with your filters; **Load More** expands that scope.
Round recovery combines recovered and eligible opportunities from ready reports. Practice shows
completed attempts out of all recorded attempts. Presentation response counts sum the sessions
shown. These counts do not identify unique people across runs. Survey widgets show runs and
the Surveys they represent; open an individual report for response counts and question results.
No-evidence states remain separate from a measured zero.

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

Where **Share summary** is enabled, ready Round/Presentation reports and closed Survey runs offer
an aggregate preview plus PDF, image, and spreadsheet downloads. Images show a labelled overview
excerpt or a selected checkpoint; PDF/spreadsheet files contain the complete summary. Participant
names, submitted text, word-cloud terms, and transcripts are excluded. Results with fewer than
five respondents stay hidden, opinions remain unscored, and recovery keeps its paired sample.

Owners and editors with report-export access can add next steps and explicitly create an expiring
link, with an optional guest download permission. Next steps are shared with everyone holding the
link. Copy the complete link when it is first shown; a lost link cannot be recovered. Manage
existing links in the same dialog to revoke them. Deletion, retention expiry, or loss of the
publisher's sharing permission stops the link. Revocation cannot remove files already downloaded.
Operators manage availability and plan assignments through the admin console's **Features** page.
Unconfigured features retain the operator's workspace rollout defaults.

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

If you see **This browser cannot use this round's response formats**, refresh Polling Pops in the
same tab, then rejoin. Your accepted answers remain saved. Do not clear browser session storage:
it holds the credential needed to resume your session alias. If refreshing does not help, ask the
operator to check that the web and server releases support the same Round protocol.

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
