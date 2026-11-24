# WX-12 first integration provider evaluation

Evaluated November 24, 2026, against `871a646` after [PR #318](https://github.com/riojung/pollingpops/pull/318).
**Investigate Microsoft PowerPoint desktop first.** The candidate is one live Polling Pops
checkpoint shown inside an existing PowerPoint slideshow. The audience uses the same Polling Pops
room and account-free join flow as today. This selects the first feasibility test. Production
selection still depends on managed-client results and observed partner demand.

## Why start here

IDEA-007 and E07 prioritize an existing-deck workflow before adding meeting providers. Polling Pops
already keeps the current checkpoint, response acceptance, reveal, and results in one authoritative
Presentation room. Browser Companion supplies presenter controls, and Stage supplies a scoped
display. A native slide display could remove an audience-facing window switch while retaining those
boundaries. Presenting a flattened PDF import or following a link remains an existing fallback.
Slido and Mentimeter document live deck integrations, which establish a comparable workflow. They
do not establish demand among Polling Pops partners or support for our add-in.
[E06/E07 and release gates](slido-feature-gap-analysis-and-development-plan-2026-10.md#presentation-and-meeting-integrations)
· [Slido for PowerPoint](https://community.slido.com/powerpoint-244/how-to-use-slido-for-powerpoint-546)
· [Mentimeter PowerPoint add-in](https://help.mentimeter.com/en/articles/1720503-add-and-present-mentimeter-slides-in-the-powerpoint-add-in)

## Provider comparison

Evaluate fit to the existing-deck job, the minimum permissions and distribution path, and the
remaining live-client risk. These are documentation findings. The managed test below qualifies
actual behavior.

| Provider             | Documented surface and constraint                                                                                                                                                                                                                                                                                | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Microsoft PowerPoint | Office content add-ins can host web content in PowerPoint. The add-in-only manifest supports the PowerPoint host. Microsoft 365 admins can assign add-ins, subject to deployment and tenant requirements. Client-specific slideshow and Presenter View behavior still needs testing.                             | **First feasibility candidate.** Test a content add-in on managed Windows desktop first. Qualify Mac, web, PowerPoint Live, and other clients separately. [Content add-ins](https://learn.microsoft.com/en-us/office/dev/add-ins/design/content-add-ins) · [Office host support](https://learn.microsoft.com/en-us/office/dev/add-ins/develop/specify-office-hosts-and-api-requirements) · [Centralized deployment](https://learn.microsoft.com/en-us/microsoft-365/admin/manage/centralized-deployment-of-add-ins?view=o365-worldwide)                                                             |
| Google Slides        | Editor add-ons provide menus and sidebars. Documented open/install triggers concern editor activity. They do not establish a dependable event for a slide entering a show. Slido documents a Chrome extension in its own workflow.                                                                               | **Second deck candidate.** Evaluate if observed partners favor Slides and can deploy any needed component. Start by qualifying the slideshow surface and the current-document permissions it needs. [Slides editor add-ons](https://developers.google.com/workspace/add-ons/editors/slides) · [Editor triggers](https://developers.google.com/workspace/add-ons/concepts/editor-triggers) · [Google add-on scopes](https://developers.google.com/workspace/add-ons/concepts/workspace-scopes) · [Slido setup](https://community.slido.com/google-slides-245/how-to-use-slido-for-google-slides-513) |
| Microsoft Teams      | Meeting side panel and meeting stage are documented. Interactive stage sharing uses delegated resource-specific consent `MeetingStage.Write.Chat`. Participation depends on meeting role, client, and tenant policy. Microsoft's general meeting matrix and stage API guidance differ on anonymous stage access. | Revisit for a demonstrated meeting-first job. Treat native anonymous stage access as unverified and use the browser join flow for that audience in the meantime. [Teams stage](https://learn.microsoft.com/en-us/microsoftteams/platform/apps-in-teams-meetings/build-apps-for-teams-meeting-stage) · [Meeting compatibility](https://learn.microsoft.com/en-us/microsoftteams/platform/apps-in-teams-meetings/teams-apps-in-meetings)                                                                                                                                                              |
| Zoom                 | Zoom Apps offers Collaborate Mode and Guest Mode. The in-meeting app is user-authorized with `zoomapp:inmeeting`. Private distribution is limited to the app owner's account, and sharing a beta authorization URL beyond it requires Zoom approval.                                                             | Revisit for Zoom-heavy partners. Qualify organizer installation, client/guest paths, and cross-account pilot distribution. [App creation](https://developers.zoom.us/docs/zoom-apps/create/) · [Collaborate Mode](https://developers.zoom.us/docs/zoom-apps/guides/collaborate-mode/) · [Guest Mode](https://developers.zoom.us/docs/zoom-apps/guides/guest-mode/) · [Private and beta distribution](https://developers.zoom.us/docs/distribute/sharing-private-and-beta-apps/)                                                                                                                     |
| Cisco Webex          | Embedded Apps supports a shared web experience via **Open for all**. The framework flow can use a presenter panel and an audience view without calling Webex REST APIs. Internal deployment and access to participant identity are separately governed by Control Hub.                                           | Clearest documented meeting-only fallback if partners request it. Qualify the third-party app path and guest access in actual client and admin configurations. [Embedded Apps guide](https://developer.webex.com/create/docs/embedded-apps-guide)                                                                                                                                                                                                                                                                                                                                                   |
| Google Meet          | The Meet add-on SDK provides an in-meeting side panel and main stage. Distribution is through Google Workspace Marketplace, and meetings can restrict who may start an activity.                                                                                                                                 | Revisit with a Meet-specific workflow. Qualify guest entry and iframe storage behavior. Meet activity does not qualify Google Slides slideshow integration. [Meet SDK](https://developers.google.com/workspace/meet/add-ons/guides/overview) · [Meeting policy errors](https://developers.google.com/workspace/meet/add-ons/guides/troubleshoot)                                                                                                                                                                                                                                                    |

Google Sheets addresses post-session reporting. Track it under IDEA-005/R2-11 as one explicit
write of an approved aggregate snapshot. A later spike can evaluate per-file `drive.file` access,
destination choice, consent, retry safety, and disconnect behavior. Existing XLSX export remains
the comparison workflow. [R2-11](competitor-backlog-2026-10-27.md#r2-11-aggregate-delivery-to-google-sheets)
· [Sheets API scopes](https://developers.google.com/workspace/sheets/api/scopes)

## Bound the first PowerPoint test

1. Use a synthetic deck with a normal slide, a manually placed HTML content add-in, and a second
   normal slide. Use one unscored multi-select poll with text choices in an existing synthetic
   Presentation room so the browser Stage can render the same aggregate.
   The presenter confirms the selected workspace, room, and checkpoint in the normal authenticated
   Polling Pops browser, then uses the existing Host or Companion controls to open the poll and
   reveal and close it. The add-in displays current room state and the join QR and link. Guests
   answer through the existing browser workflow. Advance to the next slide using normal controls.
   This tests live rendering inside Slide Show and the handoff. It leaves automatic activation on
   slide change for a separate qualification.
2. Use a pilot XML content add-in manifest with `<AllowSnapshot>false</AllowSnapshot>`.
   Office defaults to saving a snapshot, which can display live content from a saved deck
   even on an offline or unsupported client. The static slide fallback contains generic join
   instructions. Keep room QR codes, poll results, and pairing prompts in the live display.
   [Office AllowSnapshot reference](https://learn.microsoft.com/en-us/javascript/api/manifest/allowsnapshot?view=word-js-preview)

   Start with the `Restricted` document permission as the test hypothesis. Manually inserting
   the content object avoids the PowerPoint-specific document editing APIs. Microsoft requires
   `ReadWriteDocument` for those APIs even for a read. The first design uses Polling Pops
   browser sign-in and no Microsoft OAuth scopes, Graph calls,
   presenter notes, deck upload, or meeting identity. Document permissions and admin installation
   are separate from OAuth consent. If an API requires a broader grant, record and review it
   before changing the candidate. [Office permissions](https://learn.microsoft.com/en-us/office/dev/add-ins/develop/requesting-permissions-for-api-use-in-content-and-task-pane-add-ins)

3. Require a short-lived, revocable display binding authorized in the browser for the exact
   workspace, canonical region, room, and checkpoint. Keep the display proof in memory. A lost
   network connection can resume only while the binding and its issuer remain authorized.
   Reload or a new instance requires explicit browser re-pairing. Use the read-only Stage
   projection as a reference for role isolation. Project only the bound checkpoint's public
   prompt and choices, current phase, valid join details, and authorized aggregate after reveal.
   Keep creator cookies, host or Companion credentials, provider identities, raw answers, and
   private notes out of the add-in, deck settings, URLs, logs, and telemetry. End the binding
   on revocation, room end, issuer authority loss, or expiry. Cap its lifetime at the live-room
   deadline. Delete verification material at termination and keep only minimal lifecycle audit
   under the approved workspace audit and deletion policy. Canonical room retention governs the
   report separately.
4. Qualify a dedicated HTTPS display route and the necessary ancestor origins on each tested
   host. Use the fallback if the client cannot run under a narrow frame policy. Keep ordinary
   routes protected by their existing frame policy. The current Round
   presenter embed is read-only and limited to allowed origins. A Presentation Stage or browser
   Companion URL is a separate role and route family. The pilot must establish that the content
   object can update without third-party creator cookies or persistent bearer storage.
   [Stage API](api.md#live-session-staff-presenter-and-embed-apis)
   · [Companion API](api.md#presentation-companion-foundation)
   · [Existing frame policy](../apps/web/proxy.ts)
5. For the pilot, cap on-screen freshness at **five seconds** from the server's latest
   successful check of the display binding, issuer, room, and checkpoint, or sooner if the
   binding expires. Clear the prompt, results, join QR, and pairing data immediately on
   detected disconnection or an invalid binding. If loss goes undetected, switch to a neutral
   unavailable state by the freshness deadline. Use periodic authorized state reads even
   while the room is quiet. Derive the deadline from the time of the server check and ignore
   expired responses and replies to earlier connections. Keepalive traffic cannot renew
   freshness. Before showing live content after reconnect or runtime resume, revalidate the
   binding and current checkpoint with the server. Test the pixels the audience sees. If
   Office freezes those pixels past the deadline, the client fails qualification and uses the
   browser fallback.

### Test acceptance and fallback

Compare the same deck, poll, join and reveal steps, and screen-sharing setup using the existing
browser workflow first. The proposed pass target is a continuous slideshow with at least one
audience-visible window switch avoided and the correct aggregate shown. Count presenter-side
tab and device switches separately because the presenter still uses browser controls.

| Check                                                                                | Expected result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Installation on a managed Microsoft 365 Windows device                               | Record tenant policy, license, install/approval path, exact Office version and build, and runtime APIs. Exercise permitted install, blocked add-in, offline or allowlist failure, and removal. Public distribution needs Microsoft Marketplace review separately. [Managed deployment](https://learn.microsoft.com/en-us/microsoft-365/admin/manage/manage-deployment-of-add-ins?view=o365-worldwide) · [Marketplace submission](https://learn.microsoft.com/en-us/office/dev/add-ins/publish/publish-office-add-ins-to-appsource)                                                                                                                                                                                                                                            |
| Save, copy, and reopen the deck                                                      | Confirm the installed pilot manifest disables snapshots. Save test copies with the pairing prompt visible and after reveal, copy them, and revoke the display. Reopen offline and on a client without add-in support. The saved deck and any static add-in preview show no pairing prompt, live QR, or poll content.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Slide Show and Presenter View, including external display or shared slideshow window | The live display shows the intended checkpoint, then approved results. Private notes and controls stay off the shared display. Verify animations, moving away, returning, and reopening separately, and record observer-visible window switching against the current browser Companion workflow. `getActiveViewAsync` conflates Slide Show and Reading View under its read state. Microsoft's slide-selection event is documented as preview, so these signals alone cannot qualify auto-activation. [PowerPoint view API](https://learn.microsoft.com/en-us/office/dev/add-ins/powerpoint/core-concepts) · [Preview slide-selection event](https://learn.microsoft.com/en-us/javascript/api/powerpoint/powerpoint.slideselectionchangedeventargs?view=powerpoint-js-preview) |
| Lost connection, repeated launch, and new host tab                                   | Resume the same authorized room when the binding remains valid. A reload can display a fresh pairing prompt. Repeat a browser command with its original intent and key after acknowledgement loss. Reload and slide navigation do not create a room or advance a checkpoint. An explicit host reopen follows existing control-credential rotation. On expiry, revocation, or mismatched room/checkpoint, clear the display.                                                                                                                                                                                                                                                                                                                                                   |
| Only PowerPoint loses its network or its content runtime is suspended                | Leave the presenter browser connected and advance the room or revoke the display while PowerPoint is disconnected. Confirm the audience sees a neutral state within five seconds of the last authorized check. Cover silent packet loss, Office suspend and resume, and delayed responses. Content can return only after the server validates the current binding and checkpoint.                                                                                                                                                                                                                                                                                                                                                                                             |
| Unsupported client or missing installation                                           | Continue the original deck with a readable browser join URL and QR or code supplied from the active room. Use browser Companion and the separate Stage window for display and control. A fallback browser launch or static slide is tracked as a fallback, not as a successful native display.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Access and data                                                                      | Qualify a different workspace, copied deck, stale pairing, blocked cookies, and expired room. Verify no private content or extra provider grant is required and no duplicate acceptance reaches the retained report. Record the supported build and sign-off independently for each client before offering production support.                                                                                                                                                                                                                                                                                                                                                                                                                                                |

## Decision and verification

PowerPoint desktop is the recommendation for the managed-client test. A launch-only ribbon or
task-pane action is a useful comparison; without a working live slideshow display or measured
benefit it leaves the native workflow unqualified. If an installed client cannot render safely,
retain the browser workflow and revisit Google Slides or a meeting application only with evidence
of the different workflow. Keep the E07 dependencies open, including E06 Companion qualification,
requests from three paying partners for the same native workflow that Companion cannot meet,
managed-device feasibility, and independent deployment review. The later acceptance milestone
requires those partners to run full sessions. Product, security, privacy, and operations acceptance
require exact-build and native delivery evidence. Hosted release acceptance follows its separate
ledger. [First integration stage and partner criteria](slido-feature-gap-analysis-and-development-plan-2026-10.md)
· [Release readiness](release-readiness.json)

On `871a646`, 51 existing server tests passed for Presentation credentials, realtime commands,
Companion access, and opinion formats. Twenty-seven web tests passed for Stage, pass capture,
and frame policy. These validate existing Polling Pops behavior. The managed Office test, tenant
install, consent validation, and partner sessions remain pending.
