# Polling Pops user guide

Polling Pops helps a facilitator run a complete comprehension-recovery loop:
**ask → diagnose → intervene → recheck → prove**. Participants join as session-scoped guests and
do not need accounts.

For a local first run, complete the [quick start](quick-start.md) first.

The Core-Parity foundation includes gated Presentation Q&A and a gated self-paced Survey beta
using single- or multiple-selection opinion polls and ratings. Presentation replies/chat/Pulse,
Q&A-only feedback rooms and advanced feedback exports remain pending. Live Rounds support gated
multiple-selection polls, ranking, moderated open text and word clouds.
Presentations also support multiple-selection opinion polls and full/top-N rankings after the
matching release is deployed. Moderated open text and word clouds additionally require the
document-v10/response-v3/report-V5 release and migration 092.
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
The 21-template Presentation catalogue contains 12 native scenario decks and the nine retained facilitated
templates. Each native scenario has eight editable slides and works without an audience activity:
startup pitch, client proposal, project update, quarterly strategy, portfolio case study, event talk,
product demo, customer onboarding, practical workshop, lesson/explainer, research findings and
business decision brief. Their worked examples and data are explicitly illustrative; review the
speaker notes and replace example assumptions with your own sourced information.
**Preview structure** opens a read-only, shared-renderer deck preview. Use **Previous slide**,
**Next slide**, Left/Right arrow keys, Home or End to navigate, and Escape or **Close preview** to
return to the chooser. Only the current preview slide is mounted. **Use presentation template**
creates an independent draft with fresh IDs; viewing the preview creates no content. The existing
facilitated templates retain their slides, questions and linked rechecks. Survey templates contain
opinion polls and ratings for self-paced feedback.
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

Questions are optional. A content-only Presentation needs at least one complete slide and can be
published and hosted without adding a poll or quiz. Empty slides, missing image descriptions and
unavailable or unscanned images still block publication. A deck containing questions retains the
main-question and linked-recheck requirements.

Live Presentation creation requires its separate realtime rollout gate. Select **Host**, create a
session from the published version, and share its code or direct link. Advance through content
slides and open, close, reveal, or recheck interactive questions using the controls offered for
the current phase. Participants receive complete slide content and question controls on their
own devices. When live flex mode is also enabled, choose **Flex** during setup to remove question
countdowns and deadlines for the whole room; the host closes responses. The live code expires
after 24 hours independently of how long session history is retained.

For a content-only deck, use **Start Presentation**, **Next block** and **Finish Presentation**.
The finished room thanks participants, and its report shows join counts, slide titles and the
facilitation timeline. It does not assign quiz standings or learning outcomes to slide viewing.
Ordinary content slides retain the existing text/image layout tools. Native slides add independently
positioned text, images, labeled shapes and connectors in the same deck.

### Organize sections and navigate live

In the Builder, choose **Enable sections and navigation**, then **Add section**. Rename sections
and assign each selected block with **Selected block section**. Section names are published, so
use audience-appropriate labels. Sections group blocks; numbered slide order remains the default
presentation path. Deleting a section keeps its blocks. Hidden slides are omitted when published.
Wait for **Saved**, publish, and start a new session to use the new map.

On the host or Companion, choose **Open navigation** to see current, visited and not-visited
blocks. Choose an available slide or activity to jump there. The map explains unavailable targets.
Close and reveal an open activity before navigating, and complete any linked recheck first.
Revisiting an activity shows its saved closed phase/results without collecting another response
or awarding points again.

The first jump retains your original block as **Return target**. Further jumps keep that anchor;
**Return to path** restores it. A jump from the lobby anchors the first published block. Ordinary
**Next** continues in numbered order. If confirmation is lost, use the offered retry to confirm the
same action; reload preserves that pending action in the same browser tab. Finished reports and
CSV distinguish presented and skipped blocks without treating skipped activities as wrong answers.

### Add reveal panels and safe links

On a native slide, choose **Add reveal panel** or **Add link**. Give each control a short,
descriptive label. For a panel, enter **Revealed audience content**; for a link, enter a complete
HTTP or HTTPS address without embedded credentials. An invalid address stays in the editor with
a correction message until it can be saved safely. Complete labels, content and links before
publishing. Position, duplicate, group and reorder these objects using the ordinary native tools.

In Preview or live delivery, activate a panel to show or hide its content **on this screen**.
Participants and the presenter operate their own panels independently; opening one does not
broadcast a reveal, submit an answer, change scores or call an AI provider. Panel text is audience
content, so put confidential facilitator cues in speaker notes. Use activity controls when you
want the host to reveal an assessment answer to the room.

Use **Show accessible outline** for a readable layout in the slide's semantic order; the same
panels and links work there. Buttons support touch, Enter and Space, and links announce that they
open a new tab. Editing previews do not navigate. Page reloads or a new slide/source begin with
panels collapsed. Hotspots, pop-up dialogs and branching are not part of this basic release.

### Add hotspots, detail dialogs and shared reveals

Use **Add native image** with a complete image description, then **Add image hotspot**. Choose its
image, label, detail title and audience content. Keep the hotspot inside its unrotated image;
moving or resizing the image carries its hotspots. **Add detail dialog** provides the same local
detail without an image anchor. Viewers can open these details by touch or keyboard, close with
Escape and return focus to the activating button. The accessible outline offers the same actions.
Keep private facilitator cues in speaker notes.

For a reveal panel, choose **This screen only** or **Facilitator reveals for everyone** under
**Reveal audience**. During live delivery, a shared reveal waits for host/Companion confirmation.
Its body is withheld from audience snapshots while closed, and its state survives reload and
revisits. Shared review links make these reveals local to each reader. Reveals never submit an
answer, change scores or call an AI provider.

Use **Add slide link**, enter a label and choose **Target slide or activity**. The host/Companion
uses this link to navigate the live room through the same safe jump rules as the map. A private
review reader follows it only on their own screen. Hidden slides, rechecks and the current slide
cannot be selected. Fix missing targets before publication.

On an unlinked main activity, choose **Add answer branch**. Set its label, an accepted-choice or
correct-response percentage, minimum response count and a forward target. After closing/revealing
the activity, the server enables matching branch buttons for the facilitator. Choose one to
follow it. **Next block** keeps the numbered path. Branches never create another response or reset
points; linked diagnostic/recheck sequences stay indivisible.

### Share a private review link

Publish the deck, then choose **Share review link**. Select a one-, seven- or thirty-day expiry,
choose **Create link**, and copy the private link. It grants access to anyone who has it, without
requiring a recipient account. Use **Retry link creation** after uncertain confirmation to recover
the original request and link, including after reload.

If the server confirms that an unaccepted request has expired, the expiry selector and **Create
link** become available again. Choose an expiry and create a fresh link. A connection failure
continues to retain the original request for an exact retry.

Save or copy the link before closing the dialog; the server keeps only its hash and cannot show
the secret again later. Create another link if you need a replacement, and revoke unused links.

Every link stays on its published version. Later draft edits or publications do not update it;
create a new link to share a newer version. Reviewers can move through pages/sections and use local
details or links, but questions are for reading and responses are not collected. Speaker notes,
answer keys, explanations, private provenance, scores and live state are excluded.

Open **Share review link** again and choose **Revoke link** to stop subsequent access. The reader
checks authorization before moving to another page and before image access. A temporary network
failure keeps the current page and offers retry. Expiry, removal of the publisher's editing
authority or source deletion also ends access. Archiving blocks new links while existing links
remain valid until revoked or expired. Already delivered content cannot be recalled.

Each deck permits twenty active and one hundred retained links; expired metadata is removed after
seven days. These review links do not create assignments, learner attempts or completion records.

### Import a PDF or a set of slide images

In the Builder, choose **Import visual slides**. Export PowerPoint, Google Slides or Canva slides
as PDF first, or choose PNG/JPEG/WebP images. This conversion does not call an AI provider and is
separate from source-grounded content proposals. Use one PDF up to 6 MB/40 pages, or at most forty
images totaling 20 MB, each no larger than 10 MiB. If import is unavailable, an operator must
configure the required conversion and scanned private-media services.

Wait for the conversion preview, select the pages you want and use the page controls to reorder
them. Review the fidelity report: pages become fitted images, while source objects, animations,
active links, audio and video are not imported. Check each title and image description, then write
or correct its accessible reading version. Extracted PDF text may omit diagrams, reorder content
or contain mistakes; scanned pages/images have no OCR. Confirm reading order and meaning yourself.

Each selected page inserts a visual slide followed by an editable reading slide after the chosen
block. You can add, edit and reorder other native slides and activities between them. A new deck's
empty starting placeholder is replaced; meaningful existing content is preserved. Preview and
publish the resulting deck normally. A pending insert retry keeps its exact request until the
receipt is known, including after a reload. If another editor changed the deck, reload the latest
draft and review the insertion point again.

You can cancel a queued conversion or discard its preview. Originals are erased after successful
conversion, terminal failure or cancellation; unfinished work expires after 24 hours for cleanup.
Previews expire after 24 hours, so keep the source yourself if you may need another conversion.
Canceling a preview does not remove slides already inserted into the deck.

### Collect Presentation polls and rankings

Add an interactive question and choose **Poll** or **Ranking** under **Question type**. For a poll,
set **Maximum selections** from one to the number of choices. A limit above one lets each
participant choose up to that many options and then explicitly **Submit response**. Unselected
options stop accepting selections at the limit; participants can deselect an option to change
their selection before submitting.

For a ranking, add two to six choices and set **Choices to rank**. Choosing the full number asks
for a complete order; a smaller number asks for exactly that many priorities. Participants use
the **Add**, **Remove**, **Move up** and **Move down** controls, including the keyboard, before
submitting. The first position is the highest priority. Reducing the number of authored choices
also reduces a selection/ranking limit that would otherwise exceed the remaining choices.

These new opinion formats have no correct answer, confidence prompt, participant points or
paired recovery question. Their opinion/scoring/recovery controls are locked. Changing an
assessment into a poll or ranking clears its correctness and incompatible recovery links while
preserving compatible choice text. **From published Round** can copy multiple-selection polls
and rankings with fresh destination IDs; later source edits do not update those independent
copies. Moderated open text and word clouds use the separate workflow below.

Wait for **Saved**, preview and publish, then host the immutable version. Later draft edits or a
new publication do not change a running session's question, choices or limits. Participants
should wait for **Saved** after submission. **Saving…** or **Reconnecting—not yet saved** means
confirmation is still pending; leave the tab open while it reconciles. Refresh recovers an
accepted response rather than submitting another vote or ranking.

Use **Reveal and close question** to show **Poll results** or **Ranking results**. The host,
participant and audience stage show results for the current revealed activity only; Companion
opens them through **Show results**. Before reveal, a submitted response does not expose the
aggregate. The tables contain aggregate choices, not participant identities, private notes or
source citations.

After reveal, the audience stage puts the results before question media and explanations so
repeated choices do not hide the data. Wide tables scroll horizontally; focus **Opinion result
table** and use Left/Right Arrow, or swipe, to reach every column.

Poll percentages use the number of respondents who submitted an accepted response as the
denominator. With two respondents, a choice selected by both shows 100%, even if each respondent
also selected another choice. Multiple-selection percentages can therefore total more than
100%; they are not percentages of all selections or of everyone who joined the room.

Ranking results use the total number of available choices as the first-place weight, decreasing
by one at each ranked position. Ranking three of six choices gives weights **6, 5, 4**, with zero
for unranked choices. **Ranked by**, **Average rank** and rank-position counts describe submitted
orders. These result weights are not participant scores or evidence of learning accuracy.

At the end, open the session report for anonymous choice evidence and select **Export evidence
CSV** to download poll counts/percentages and ranking weights/rank-position counts. An opinion-only
session has no scored leaderboard, accuracy result or paired recovery outcome. Existing
assessment questions in a mixed deck retain their own scoring and recovery behavior.

Operators must complete the [document-v9/report-v4 rollout](runbooks/upgrade.md#presentation-opinion-formats-compatibility)
before enabling these writes. See the [first-family implementation record](evidence/presentation-e04-opinion-formats.md)
for verification status and remaining scope.

### Collect moderated Presentation text

Add an interactive question and select **Open text** or **Word cloud**. Open text accepts one
response up to 1,000 characters; a word cloud accepts one short phrase up to 80. Both are
unscored opinions without correct answers, confidence or recovery links. **From published Round**
can copy these questions independently. Save, preview and publish before starting the session.

Participants type on their own device and select **Submit response**. Wait for **Saved**;
**Saving…** and **Reconnecting—not yet saved** mean receipt confirmation is pending. Reload
restores saved/moderation status without restoring the private body into the input. The session
accepts one response per person and question, including after the facilitator removes it.

In the host tab, use **Text response moderation**, choose the current or all questions, and select
**Pending**, **Approved** or **Removed**. The facilitator can see aliases and pending bodies.
Choose **Approve response** to make a response eligible for public results, or **Remove response**
to erase the body permanently. An approval can later be removed. If an update is unconfirmed,
use **Retry review acknowledgement** to check the original operation before reviewing another.
Moderation leaves the question's response window open until the host closes it.

Use **Reveal and close question** to show approved results. The host, participant and audience
stage show the current question; Companion uses **Show results**. At least five approved
respondents are required. Pending and removed bodies never appear there. Removing an approved
response below five hides all text and cloud counts. Cloud grouping ignores case, composes
Unicode characters and collapses whitespace. The decorative cloud has an equivalent **Word-cloud
counts** table; focus the table region to scroll its columns with the keyboard.

Use queue filters and pagination for larger rooms. Text activities support at most 250 people
and ten text questions in a room. Finish after reviewing: new moderation closes when the
session ends. The report and **Export evidence CSV** contain only revealed results meeting the
five-approval threshold. Raw pending and removed responses are excluded. These results do not
establish learning accuracy or participant scores; aliases remain visible to the facilitator.

Operators must complete the [migration-092 rollout](runbooks/upgrade.md#presentation-moderated-text-compatibility)
before accepting these formats. The [verification record](evidence/presentation-e04-moderated-text.md)
distinguishes executed checks from remaining manual/device and cost acceptance.

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

### Present with private notes and an audience stage

In an eligible live Presentation, the presenter workspace shows **Current slide**, **Private
speaker notes** and **Next slide preview**. These use the version frozen when the session began.
Editing or republishing the deck later does not change those live cues. Hidden planning slides
are excluded. Notes remain read-only in this workspace; edit the deck for a future session.

Choose **Open audience stage**, then share that separate window with the audience. If your browser
blocks it, follow **Open audience stage in a new tab**. The stage shows the current public slide
or question and keeps the join code, visible address and QR available. **Enter full screen** is
optional; the stage remains usable when the browser does not permit it. Share only the audience
stage window because the presenter workspace contains private information.
Native slides fit the available canvas. Use Tab to focus **Audience slide** when you need to
scroll dense content; the header keeps the join code accessible in short windows.

The stage pass expires within one hour. Opening a replacement stage invalidates the previous
stage pass; **Revoke audience stage access** closes access without changing host controls.
If another host tab has replaced the pass, revoking from the older tab shows a warning instead
of reporting success. Use the tab that opened the current stage, or open a replacement stage
here and then revoke it. The older tab cannot silently revoke a different tab's newer pass.
Refreshing the stage retains access in that tab when browser storage is available. On a lost
connection it labels the last confirmed slide; expired or revoked access clears that content.

The **Presentation timer** measures local elapsed time with **Start**, **Pause** and **Reset**.
It recovers running/paused time after refresh when tab storage is available. It does not change
the response deadline or advance the room. Right Arrow, Page Down and Space advance the current
phase using the same server confirmation as the main button. Shortcuts pause while an action is
pending and leave focused controls, scrollable data, editing and modal dialogs alone.

See the [stage rollout instructions](runbooks/upgrade.md#presentation-stage-credential-compatibility)
before enabling these routes in a deployment. Joining as a participant or receiving a stage pass
does not grant presenter control or deck editing. The existing Companion remains a separate
scoped control surface.

### Organize Presentation slides and recover edits

Choose **Create → Presentation → Blank presentation** to open a native slide with its Design panel
ready above the canvas. **New slide** in the top slide toolbar adds another designed slide.
For an existing ordinary slide, **Convert to native slide** is in that same toolbar; conversion
retains content and notes and supports Undo. Hide/show, duplicate and reorder actions are above
the canvas as well. Existing decks are converted only when you choose that action.

Use the slide map to add, duplicate, move or delete slides. **Hide slide** keeps a visual slide in
the editable deck and its history while omitting it from preview and the next published version.
Choose **Show slide** to include it again. Hiding and showing support **Undo** and **Redo**.
Activities cannot be hidden; remove an activity explicitly when it should leave the deck. At least
one visible slide or activity is required to publish. Changes to the draft never alter an existing
published version or running Presentation.

A linked recheck must follow its source. The map disables moves that would reverse that order.
Duplicating a recheck creates a standalone activity; deleting its source makes the retained
recheck standalone while preserving its content.

Wait for **Saved** before leaving. If saving fails, **Retry save** settles the pending save before
sending newer edits. Recovery is kept in this browser, including an uncertain pending save; clearing
site data removes it. When a local copy matches the saved revision, **Restore local copy** restores
it for editing. If the server copy has diverged, use **Preview local copy**, **Download local copy**
or **Duplicate local copy** to preserve your work. A revision conflict stops writes until you choose
how to continue; reloading the current server copy does not silently apply old local edits to it.

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

These structured layouts retain their existing positioning and image rules. Use a native slide
when you need several images, shapes or connectors.

### Build a native slide

Choose **New slide** above the canvas for a designed native starter; **Add native slide** in the
map still adds a plain native starter. Select a node in the slide or its reading
order list to edit its text, image description, shape or connector. The position and size fields
use percentages of the slide. Focus a move or resize button and use arrow keys for 1% steps,
or hold Shift for 5% steps.
Give shapes meaningful labels and images useful descriptions for people who cannot see them.

On a desktop, drag an object or its move button to reposition it. Drag its resize button to change
its width and height from the bottom-right corner. Release to save the change as one **Undo** step;
press Escape before releasing to cancel. Movement stays inside the slide. During movement, local
snap guides appear within six screen pixels of nearby object or slide edges/centres. Hold Alt to
move freely. Guides are temporary editor feedback and are not saved in the slide.

Hold Shift while clicking objects or use their **Include … in selection** checkboxes to select
several. Drag a selected object's move button, use its arrow keys, or use the **Move selection**
buttons to move them together. They keep their spacing when reaching a slide edge. Resize and
numeric fields apply to the object being inspected, except that a stored group's resize handle
resizes its members proportionally. **Delete selected objects** removes selected
objects and their connectors while keeping the required slide title. Selection is temporary and
does not create a saved group. On phones, use selection, movement buttons and numeric fields;
the reading column keeps ordinary scrolling and does not support geometric dragging.

Add images through the existing private upload and scan flow. Each image keeps its own placement
and description. Uploads remain unavailable until the operator configures image storage and
malware scanning; an unavailable or unscanned image cannot be published.

Adding objects pauses while an image uploads and scans. If Undo fills the last slot or removes
the original slide, the finished image waits for space or for that slide to be restored. Finish
the attachment or choose **Discard uploaded image** before starting another upload. Keep the
builder open until the image is attached; leaving or reloading can discard a waiting upload.

Reading order is independent of visual placement. Arrange it to make the slide understandable as
a reading column on a phone or with assistive technology. Deleting a node also removes connectors
that refer to it. Duplicating a slide creates independent nodes and reconnects its copied edges.

Native edits use the same autosave, **Undo**, **Redo**, recovery and conflict review as the existing
builder. Wait for **Saved**, reload to verify the saved slide, then preview and publish. Publication
freezes that version; later draft edits do not change a running Presentation. Speaker notes and
source information remain private.

In **Design**, choose **Enable slide design** to select a color theme, system font and spacing.
**Apply design to all native slides** applies those choices to existing native slides, including
hidden ones. Ordinary slides and activities keep their current appearance. Undo/Redo restores
the complete design change. System fonts use those available on the viewer's device; review fit
feedback after changing the font or layout.

Choose an available layout button to reposition existing text and images. Presets require the
shown object combination and never delete content to make it fit. Use **Undo** to restore the
previous positions. Select multiple objects to align them or distribute at least three evenly.
Distribution is unavailable when their sizes cannot fit without overlap. Layer controls move the
last selected object, or its stored group, in front of or behind other visual objects; reading order stays unchanged.
Connectors follow their objects and stay behind them.

For an image, **Contain** shows the whole image; **Cover** crops it to fill the frame. Adjust its
focal X/Y position to keep the important area in view. Narrow screens show the complete image in
the reading column. Cropping never changes the source image or its access permissions. Preview
and published delivery use the same design; later draft changes leave existing sessions unchanged.

In **Group and rotate**, choose **Group selected objects** to save a group, or
**Ungroup selected objects** to release its members. Groups are flat: an object belongs to at most
one group, and connectors are not members. Selecting a member selects its group for movement,
proportional resizing, alignment and layering. **Grow selection 5%** and **Shrink selection 5%**
provide resize controls. Grouping leaves reading order and connector references intact; duplicating
a slide gives its copied groups and members fresh IDs.

Use **Rotate selection left 15°**, **Rotate selection right 15°**, or
**Last selected angle (degrees)**. The angle field sets the last selected object's angle while
preserving relative angles in the selection. Rotation follows the physical 16:9 slide shape;
both the object's frame and its rotated visible bounds must remain inside the slide. If the
selection would leave the slide, move it away from the edge or reduce its size before retrying.
Narrow reading views retain semantic order and show unrotated content.

### Add a table or chart

Choose **Add table**, **Add bar chart**, **Add line chart**, or **Add pie chart** on a native slide,
then select the object in **Slide objects · reading order**. A table supports up to 20 data rows
and six columns. Give it a **Table caption** and readable column headings. Charts support up to
20 categories and four numeric series; provide a **Chart title** and **Chart description** that
explain the important pattern. A pie chart uses one nonnegative series with a positive total.

Edit the staged cells or use **Paste CSV or TSV data**, then **Preview pasted data**. The first
row supplies headings; chart data starts with category labels followed by numeric series. Quoted
cells and quoted newlines are supported. Table cells remain literal text; no spreadsheet formula
or live spreadsheet connection is executed. A new paste replaces the staged grid.

Choose **Apply table changes** or **Apply chart changes** to update the slide as one **Undo** step.
Until then, edits remain local to the data editor and do not change the saved object. Choose
**Discard staged changes** to return to the object's current data. Invalid or over-limit input
shows an error and retains the staged work; correct it before applying. Apply before switching
objects or leaving when you want to keep a staged edit.

Charts use local SVG geometry and show their full data table and description. Tables retain all
cells, with a readable narrow-screen presentation. Review both the plot and its data alternative
after changing values, fonts or size; update the description when the message changes. The editor,
preview and live delivery share these renderers.

### Link to an external video

In **External video**, enter **Video title**, **Video HTTPS link**, and
**Captions or transcript HTTPS link**, then choose **Add external video link**. Both destinations
appear on the slide with a fallback explanation. The audience chooses whether to open the
external site; use the captions/transcript link if playback is unavailable. Destination availability
is not checked by the editor.

These are ordinary rich-text links, not an embedded player. Opening a link uses a new tab without
opener/referrer access. Adding or previewing the slide does not load provider scripts, iframes,
remote thumbnails or video bytes. Uploaded-video hosting/transcoding is not part of this feature.

To add formatting, select a native text object and choose **Format text**. Select characters in its
text field, then choose **Bold** or **Italic**. **Paragraph style** changes the current or selected
paragraphs to ordinary paragraphs, bullets or a numbered list. Titles support emphasis and links;
use body text for lists. Each line in the text field is a separate paragraph.

For a link, select its text, enter a complete `https://` or `http://` address and choose **Apply link**.
Links with usernames, passwords, unsupported schemes or whitespace are rejected. **Remove link**
removes a link from the selected characters. Links open in a new tab in preview and during delivery;
clicks in the editor keep you in the editor. Pasting adds plain text and preserves formatting on
unchanged text. Image, file and other clipboard payloads without plain text leave selected text unchanged.
Edits that exceed text, formatting or slide limits show an error and leave the previous text intact.
Design and image-fit changes also leave the slide unchanged when they exceed its limit. Follow
the displayed guidance to shorten text or remove an object, then retry the change.
**Remove formatting** returns the object to plain text; **Undo** restores its formatting.
While editing native text, use Cmd/Ctrl+Z for **Undo** and Cmd/Ctrl+Shift+Z (or Ctrl+Y) for **Redo**.
These commands restore text and formatting together, including the initial formatting change.

Choosing **Format text** upgrades that slide and deck to the compatible rich-text format. Other
objects stay unchanged, and plain-text slides continue to work. Formatting supports up to 100
paragraphs per object within the existing 160-character title and 4,000-character body limits.

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
