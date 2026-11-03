# Polling Pops presentation benchmark

Research date: November 3, 2026. Repository checkpoint: `f76153d`.

Polling Pops should become an affordable presentation creator that combines polished slides,
interactive experiences, flexible presenting and useful follow-up. The first release should let
someone create an attractive deck from a template or existing material, present it confidently,
collect audience responses and share it afterward. Broad presentation creation is the product
owner's selected market; the lowest sustainable customer subscription price is the selected
commercial constraint.

Genially provides the strongest reference for interactive content and reusable experiences.
Prezi provides the strongest reference for contextual navigation and a connected preparation,
live participation and review workflow. PowerPoint, Google Slides and Canva set expectations for
ordinary authoring. Matching those jobs requires more than adding question types, but it does
not require building every advanced design or media feature at once.

The companion [implementation plan](presentation-implementation-plan-2026-11.md) turns these
findings into scoped Codex work, acceptance criteria, cost controls and release decisions.

## Scope and evidence

The supplied [Prezent comparison](https://www.prezent.ai/blog/best-presentation-software) is a
useful discovery list, published by a competing vendor that ranks its own product first. It is
not an independent market-share ranking. The comparison below checks first-party product and
support material rather than adopting its prices or ranking.

Competitor capabilities are documented vendor claims, not measured hands-on results. Repository
capabilities are source-inspected implementations, sometimes behind flags; they are not proof
of production availability. Customer workflows and pricing proposals are hypotheses to validate.
No customer interviews, authenticated product trials or competitor load tests were conducted.
Pricing is an observed list-price snapshot, with regional, eligibility and billing differences.

## Market expectations

The twelve products in the supplied article are covered below, with Genially and two audience
interaction specialists added because they compete directly with Polling Pops' combined workflow.
These are representative strengths, not claims that other capabilities are absent.

| Product                                                                                                                | Documented emphasis                                                                                                                                     | What Polling Pops should learn                                                     |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [PowerPoint](https://support.microsoft.com/en-gb/powerpoint/present-live-engage-your-audience-with-live-presentations) | Browser audience joining, slide viewing and live translated subtitles alongside the established slide workflow                                          | Device access and inclusive presenting matter alongside slide appearance           |
| [Google Slides](https://support.google.com/a/users/answer/9310270?hl=en)                                               | Shared editing and presenter notes; [native audience Q&A](https://support.google.com/docs/answer/6386827?hl=en)                                         | Make collaboration and private presenter controls understandable                   |
| [Canva](https://www.canva.com/presentations/)                                                                          | AI-assisted design, visual templates, comments, simultaneous editing, animation and multiple export formats                                             | Authors expect a polished result without learning professional design              |
| [Gamma](https://gamma.app/pricing)                                                                                     | Prompt-based creation, PDF/PPTX import and export, with advanced branding and analytics on higher tiers                                                 | Editable structure and a fast first useful draft matter more than generation alone |
| [Pitch](https://pitch.com/)                                                                                            | Collaborative slide creation, editable AI output and brand guardrails                                                                                   | Team consistency should come from reusable themes and layouts                      |
| [Prezi](https://prezi.com/)                                                                                            | Spatial presentation, native audience activities and review experiences                                                                                 | Keep context when changing direction and connect live sessions to follow-up        |
| [Visme](https://www.visme.co/presentation-software/)                                                                   | Visual/data components, branded templates, interactive presentations and downloadable formats                                                           | Simple charts and diagrams belong in the broad creator roadmap                     |
| [Storydoc](https://www.storydoc.com/)                                                                                  | Interactive business documents, trackable links and sales follow-up                                                                                     | A shared presentation should remain useful without the presenter                   |
| [Zoho Show](https://www.zoho.com/show/)                                                                                | Templates, shared editing, charts, media and office-file interchange                                                                                    | Practical editing and portability remain important at a low price                  |
| [Keynote](https://support.apple.com/guide/keynote/intro-to-collaboration-tan4e89e275c/mac)                             | Real-time shared presentations with explicit access roles; [PowerPoint export](https://support.apple.com/en-ie/guide/keynote/tana0d19882a/15.4/mac/1.0) | Separate view, edit and redistribution permissions                                 |
| [Venngage](https://venngage.com/ai-tools/presentation-generator)                                                       | Template/AI-assisted visual communication and PDF/PPT/HTML delivery                                                                                     | Reusable information layouts are more useful than a large decorative asset count   |
| [Prezent](https://www.prezent.ai/)                                                                                     | Branded AI communication with expert services, currently emphasizing life sciences                                                                      | Brand governance and service labor have costs beyond software subscriptions        |
| [Genially](https://genially.com/features/present-and-play-live/)                                                       | Interactive authored content, games and live participation                                                                                              | Content-level interactions should coexist with session-level assessment            |
| [Mentimeter](https://www.mentimeter.com/plans)                                                                         | Interactive slides, imported decks, participant responses and results                                                                                   | Existing slides must be easy to combine with activities                            |
| [Slido](https://www.slido.com/features-integrations)                                                                   | Polls, quizzes and Q&A inside presentation and meeting tools                                                                                            | Avoid disruptive switching between slides and audience controls                    |

This market has at least four different buying decisions: create beautiful material, explain it
live, involve an audience, and distribute it afterward. A low price will not compensate for a
failure in the buyer's primary job. Polling Pops needs a coherent basic workflow across all four,
then depth where repeated use demonstrates value.

## Genially in depth

### Interactive authoring

Genially combines hotspots, tooltips, modals, show/hide actions, page navigation, drag/drop and
timed animations. These support diagrams, tours, games and explanatory content rather than just
slide changes. Its value is that an author can make information explorable without programming.
[Interactions and animations](https://genially.com/features/interactions-and-animations/)

Polling Pops should first support a small, accessible vocabulary: reveal a panel, open a detail
dialog, jump to a section and follow a safe external link. An image hotspot needs a visible label
and keyboard equivalent. Hover cannot be the only way to discover content. Drag/drop, elaborate
timelines and variable-based games can extend the same model later, after real authoring tasks
justify their complexity.

Genially's assessment authoring includes multiple choice, image-based questions, sorting,
fill-in-the-blank and open responses, plus hints, retries and answer-dependent navigation.
This connects content exploration to feedback and practice.
[Quiz Builder](https://genially.com/features/quiz-builder/)

For Polling Pops, use the existing question and recovery engines for submitted answers. A local
reveal or decorative click should not create a scored attempt. Branching needs explicit targets,
validation and a clear distinction between a host's live choice and an individual's self-paced
path.

### Live facilitation

The live feature page describes account-free QR/code joining and synchronized presentation with
audience participation. The official live help describes identity choices, public results modes,
reactions, raised hands, join locking, participant removal and a shared cursor. Navigation follows
the host while interactions inside a page can remain individual. One presenter controls a session.
[Live product page](https://genially.com/features/present-and-play-live/),
[live help](https://help.genially.com/en_us/how-to-present-live-on-genially-Hy6i99yuke)

There is a material documentation conflict: the feature page describes a lobby, while the help
article reviewed, dated October 6, says there is no waiting room. Test this in a trial rather than
treating either description as a design requirement. Polling Pops already has its own session
lifecycle; changing it should solve a user problem.

The useful lesson is explicit host control: collect privately, decide when to reveal, distinguish
participation from correctness, and let people join without interrupting the talk. Reactions and
sound effects are secondary to predictable controls and legible results.

### Import and delivery

PPTX import has a documented 100 MB limit. Text remains editable; shapes/pictures become images,
while some charts and tables can remain editable. PowerPoint-specific animation and resources
do not transfer reliably. Even a mature importer has fidelity boundaries.
[PPTX import help](https://help.genially.com/import-a-powerpoint-pptx-into-genially-H1FSoDH2i)

Genially offers hosted sharing/embedding and plan-dependent downloads including HTML, PDF, images,
video and its offline viewer. A downloaded resource and a connected live session are different
products; offline playback does not imply offline audience polling.
[Sharing and publishing](https://genially.com/features/sharing-and-publishing/),
[download formats](https://help.genially.com/en_us/how-to-download-a-genially-SJS85wB3s)

Its LMS offering includes SCORM and LTI, with tracking and update workflows.
[LMS integration](https://genially.com/features/lms-integration/)
For a broad creator release, reliable links, static export and useful import have wider immediate
coverage. LMS standards remain a later vertical capability with their own implementation and
support budget.

### Measurement and team work

Genially documents visits, page views, interaction tracking, individual response tracking and CSV
export. Identity collection changes what can be attributed to a particular learner.
[Analytics and assessment](https://genially.com/features/analytics-and-assessment/)
Polling Pops should distinguish content views, responses, completion and learning evidence in its
reports. Time spent or a clicked hotspot cannot establish understanding.

Live co-authoring, comments, roles, version history and a separate Publish Changes action support
team production without immediately changing the published experience.
[Collaboration and team management](https://genially.com/features/collaboration-and-team-management/)
Polling Pops already has frozen publication and draft conflict protection. Preserve those
boundaries while extending review and collaboration.

### AI and accessibility

Genially describes draft creation, question generation, text/image/audio assistance, translation
and summaries. Some administrative AI controls depend on plan.
[Genially AI](https://genially.com/features/ai/)
For Polling Pops, deterministic templates and import should produce a useful deck without AI.
Optional generation can accelerate that path, with bounded use and visible author approval.

Genially's WCAG 2.1 AA claim applies to published content in View mode. Its accessibility tools
include alternative text and reading-order controls. That is not a blanket claim about editor or
live-session conformance.
[Accessibility](https://genially.com/features/accessibility/)
Polling Pops should verify each surface and provide semantic, keyboard-accessible and low-motion
alternatives to visual effects.

## Prezi in depth

### Spatial storytelling and navigation

Prezi's current workflow combines a canvas with a timeline of slides and activities. Its AI
conversion guide describes document/outline generation, chat refinement and a phone remote with
notes. This supports both preparation and delivery.
[October 20 conversion guide](https://prezi.com/blog/convert-doc-or-outline-to-presentation-with-ai/)

The underlying customer job is answering a question without losing the structure of the story.
Polling Pops can first deliver an overview, named sections, jump controls and a return-to-path
action. A later spatial scene can make relationships visible, with camera paths as a presentation
effect. The audience needs a readable linear alternative on small screens and when motion is
reduced.

The cost trap is treating an infinite canvas as the starting point. It creates difficult editing,
selection, performance and accessibility problems before a user can make a competent ordinary
deck. A bounded slide editor with a section graph captures useful navigation sooner.

### Existing material and native participation

Prezi's current PowerPoint feature page claims editable imported designs and distribution into
interactive presenting and review. Google Slides/Canva migration can involve exported files;
that should not be mistaken for continuous bidirectional synchronization.
[PowerPoint to Prezi](https://prezi.com/features/powerpoint-to-prezi/)

Prezi now advertises native polls, quizzes, Q&A and word clouds, with account-free QR joining.
Its homepage also advertises follow-up learning formats.
[Current homepage](https://prezi.com/)
Describing Prezi as only a zooming canvas, or as requiring another polling product, would create
an outdated benchmark.

The classroom guide describes private activity controls, launch and result-reveal actions,
question queues and quiz delivery. The practical sequence is prepare, explain, ask, collect,
reveal and discuss.
[Interactive classroom guide](https://prezi.com/blog/how-to-use-prezi-for-interactive-classroom-presentations-with-polls-and-qa/)
Polling Pops can apply this sequence to meetings, demos and pitches as well as learning. Hosts
need a clear backstage surface that cannot accidentally appear in a screen share.

### Review and analytics

Prezi's October analytics guide describes reach, completion, dwell-time and drop-off reports,
plus shared activities and content questions. That report requires public/unlisted visibility,
AI Analytics enabled and a view; private presentations do not produce it.
[October analytics guide](https://prezi.com/blog/which-slides-did-people-skip/)

Established Present analytics separately documents link-based viewers, active viewing time,
topic-level data and CSV export, with Premium/Teams gating. A person on two devices can count as
two viewers.
[Present analytics help](https://support.prezi.com/hc/en-us/articles/360003478014-How-to-use-Prezi-Present-Analytics-dashboard)
These distinctions matter: live answers, later visits and identified course completion have
different denominators and privacy implications. Polling Pops should not merge them into an
unqualified engagement or understanding score.

### Hybrid presenting and portability

Prezi Video places the speaker and visuals in a camera feed, including a documented Teams
virtual-camera workflow. This is a separate desktop/media capability from browser screen sharing.
[Teams support](https://support.prezi.com/hc/en-us/articles/360045348633-Live-streaming-and-video-conferencing-in-Microsoft-Teams-with-Prezi-Video),
[Video desktop](https://prezi.com/video/download/)

Current 2026 material documents PPTX export as well as PDF and SCORM, with notes/fonts in the newer
export workflow. It also describes brand kits, phone controls and review activities. Those are
newer claims than some established Present support pages.
[September 30 product and pricing overview](https://prezi.com/blog/presentation-software-remote-hybrid-teams/)
Do not claim that Prezi cannot export PowerPoint. Do test what happens to motion, activities and
editable objects in a real exported file.

Established support covers paid desktop/offline use, portable presentations and mobile viewers.
[Present FAQ](https://support.prezi.com/hc/en-us/articles/360003478254-Prezi-Present-FAQ)
Offline presentation should be benchmarked separately from live response delivery. A Polling Pops
static backup can be valuable even while live answering still requires the server.

### Collaboration and accessibility

Prezi documents team branding, comments, administration and SSO resources. License compatibility
and private collaboration depend on plan and product generation.
[Team resources](https://prezi.com/learn/teams-resources/),
[plan guide](https://support.prezi.com/hc/en-us/articles/360003478934-Guide-to-Prezi-plans)
Benchmark the cost of the complete author/reviewer/host workflow, not just one advertised seat.

Prezi publishes product-specific accessibility reports and guidance.
[Accessibility](https://prezi.com/accessibility/)
Their existence is not proof that every spatial interaction is accessible. Polling Pops should
make its linear reading order and keyboard navigation first-class alongside spatial effects.

## Polling Pops baseline and gaps

The repository has useful foundations that reduce implementation cost. Its main gap is the breadth
and finish of presentation creation, rather than a missing live response backend.

| Area               | Source-inspected baseline                                                                  | Enhancement required                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Slide structure    | Six layouts, stable text IDs, notes, citations, one image, up to 200 blocks                | Multiple images, shapes, charts, richer typography and reusable layout rules                                     |
| Editing            | Bounded 16:9 positioning/resizing, guides and fit warnings                                 | Comfortable selection, grouping/layers, broader media placement, undo ergonomics and responsive inspector        |
| Design             | Nine original scenario templates and existing themes                                       | Broad pitch, business, portfolio, event and explainer templates; brand tokens and original assets                |
| Durability         | Autosave, revision conflicts, history and local recovery                                   | Extend these guarantees to every new element and import operation                                                |
| Publication        | Immutable published versions and frozen live content                                       | New content types must preserve old readers, media retention and publish validation                              |
| Questions          | Six established formats including scored multi-select, numeric, poll and rating            | Ranking, multi-select opinion polls, moderated open text and word clouds are explicitly excluded on this surface |
| Live sessions      | Accountless joining, authoritative phases/timing, reconnect, scoring, recovery and reports | More polished stage/backstage controls, section navigation and a scoped phone remote                             |
| Q&A and Companion  | Existing gated Q&A and browser sidecar, with insertion/recovery workflows                  | Improve discoverability and screen-share flow; do not rebuild from scratch                                       |
| AI/import          | Reviewed source proposals from text/PDF/DOCX/PPTX                                          | Source extraction is not faithful slide import; add a visual path with explicit fidelity                         |
| Distribution       | Existing exports/retention infrastructure and Round practice                               | Full Presentation share/review/assignment modes and slide-file export need explicit work                         |
| Visual interaction | No Presentation hotspot/action graph or spatial camera path                                | Add bounded actions, section links, then spatial scenes                                                          |
| Collaboration      | Whole-draft revision/conflict protection                                                   | Comments/review first; object-level concurrent Presentation editing later                                        |
| Canvas             | Separate subsystem has shapes, pan/zoom, frames, collaboration and SVG/PNG export          | Reuse utilities; current linked snapshots are private authoring aids, not delivered slides                       |

Evidence: [Presentation contracts](../packages/contracts/src/index.ts),
[builder helpers](../apps/web/lib/presentation-builder.ts),
[templates](../apps/web/lib/presentation-templates.ts),
[API routes](../apps/server/src/presentation-routes.ts),
[response policy](../apps/server/src/presentation-session-response-policy.ts),
[shared renderer](../apps/web/components/presentation/content-slide-view.tsx),
[architecture](architecture.md), [user guide](user-guide.md),
[Canvas decision](decisions/002-idea-board-canvas.md).

Canvas geometry is reusable, but its temporary presenter-follow lease cannot replace durable
Presentation navigation, attempts or scoring. Publishing Canvas content also requires a new
authorization/visibility contract. Current moderation and deletion must still hide removed
guest content; an old saved layout cannot make it public again.

## Customer workflows to design and validate

These scenarios express broad creator needs. They are proposed research tasks, not measured demand
or evidence of willingness to pay. Validate them against customers' current tools and workarounds.

| Customer and job                            | Complete target workflow                                                                       | First useful scope                                                           | What to observe                                                      |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Founder or consultant pitching an idea      | Choose a professional template, replace text/charts, rehearse, present and send a PDF/link     | Themes, text/images/shapes, simple charts, notes, export                     | Time to a deck they would send; manual repair and brand mistakes     |
| Small business presenting a proposal        | Reuse last deck, update sections, privately share and respond to questions                     | Duplication, assets, private links, section navigation, comments             | Repeated work, permission confusion and recipient comprehension      |
| Product specialist running a demo           | Start with an overview, explore a requested topic, reveal details, collect feedback and return | Section map, labeled hotspots, dialogs, polls                                | Navigation recovery and whether the audience follows the story       |
| Creator publishing a portfolio or explainer | Combine images/text/video, offer optional detail, publish a mobile-friendly resource           | Visual layouts, media, safe interactions, responsive viewer                  | Phone usability, author effort and accessibility                     |
| Event or community host                     | Prepare an attractive deck, join by QR, run polls/Q&A and share a recap                        | Stage/backstage, predictable join/results, usable reports                    | Setup friction, backstage leaks and cost for an occasional event     |
| Teacher or trainer                          | Reuse existing slides, teach, diagnose confusion, explain/recheck and assign review            | Visual import, existing recovery, expanded activities, later self-paced mode | Preparation time, accepted responses and recovery-loop completion    |
| Small team producing recurring decks        | Keep a theme/library, request feedback and publish a checked version                           | Reusable layouts/assets, review comments, controlled publication             | Review cycles, lost edits and number of paid authors actually needed |

A template should represent a complete scenario, with suitable layouts and optional activities.
Business and creative templates should not force educational terminology, scoring, confidence
questions or a leaderboard into every presentation. Rounds remain available as reusable assessment
content when appropriate.

## Pricing and customer cost

Official prices are quoted in their displayed currencies and billing terms. They are not converted
into Canadian dollars or treated as like-for-like bundles. Genially's tax inclusion was not
established from the retrieved page; displayed list prices are not verified checkout totals.

| Product                                                                                      | Observed benchmark                                                                                               | Important boundary                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Genially plans](https://genially.com/plans/)                                                | Free; Pro €6/month; Master €20/member/month; Author €40/member/month, annually billed                            | Per-session participant caps shown as 50/50/200/200/400 through Enterprise. Master advertises no monthly participant limit. Free/Pro monthly limits remain unresolved. Education/region differ |
| [Prezi official overview](https://prezi.com/blog/presentation-software-remote-hybrid-teams/) | Basic free; Standard US$7, Plus $19, Premium $29, Teams $39/user/month, annually billed                          | Education prices differ. New activity/export entitlements need checkout/trial confirmation                                                                                                     |
| [Mentimeter plans](https://www.mentimeter.com/plans)                                         | Free includes 50 participants/month and one unlimited-participant occasion/month; paid Basic/Pro annually billed | A monthly participant allowance differs from a simultaneous-room cap. Numeric paid prices were not exposed reliably in the retrieved page                                                      |
| [Gamma plans](https://gamma.app/pricing)                                                     | Free includes PDF/PPTX import and multiple export formats; paid tiers add branding/analytics/AI capacity         | Current numeric prices were not exposed reliably; do not reuse the supplied article's numbers as a quote                                                                                       |

There are free alternatives. Polling Pops cannot promise the lowest price for every presentation
task, especially against bundled office tools, education discounts or self-hosting. The proposed
position is a very low-priced combined creator and interactive presenter, with understandable
limits and no audience-seat charges.

Customer cost is subscription + extra creator seats + AI/media/event purchases + preparation and
repair time + installation/administration. A cheap plan that requires rebuilding an existing deck
or buying a second polling tool may cost more overall. Measure that workflow cost in pilots.

Test a US$5/creator/month annual offer and US$7 monthly offer as hypotheses. Make ordinary private
slide creation useful on Free, and keep viewers, reviewers and participants free. Meter expensive
conversion, storage, media delivery and optional generation. The implementation plan contains the
margin model and launch rules; these are not approved prices or promises of unlimited use.

## Feature coverage decisions

| Feature family                         | Recommended treatment                                                    | Implementation work |
| -------------------------------------- | ------------------------------------------------------------------------ | ------------------- |
| Attractive conventional decks          | First release core                                                       | E01, E02            |
| Existing slides and reliable output    | First release PDF visual import/static delivery; later editable PPTX     | E05, E13            |
| Native polls, quizzes and Q&A          | Extend the current engine and preserve recovery features                 | E03, E04            |
| Basic reveals and safe links           | Broad pilot using an allowlisted action model                            | E06                 |
| Hotspots, detail dialogs and branching | Later expansion of the action model                                      | E06                 |
| Nonlinear storytelling                 | Sections first, spatial scenes second                                    | E07, E10            |
| Audio/video and recorded delivery      | Safe captioned playback before uploads/transcoding/recording             | E02, E14            |
| Reusable independent viewing           | Read-only review, then genuine self-paced attempts                       | E08                 |
| Useful analytics                       | Separate viewing, participation and answer evidence                      | E09                 |
| Team creation                          | Free review roles, then bounded concurrent editing                       | E11                 |
| AI creation and translation            | Extend optional reviewed authoring with quotas                           | E12                 |
| Offline portability                    | Static backup first; later offline interactive viewing with clear limits | E13                 |
| LMS/native add-ins/virtual camera      | Later funded extensions with dedicated acceptance and support            | E14                 |

This is a path to the main capability families, not a claim of complete feature parity. General
animation scripting, a large stock marketplace, unrestricted video production and perfect office
round-tripping each require separate investment. Templates, sections and a constrained scene/action
model make the initial product useful while retaining an extension path.

## Empirical benchmark before implementation commitments

Run the same fixtures in Polling Pops, Genially and Prezi; use PowerPoint/Slides/Canva as the
authoring baseline. Record plan, browser, device, feature generation, task completion, time,
errors and repair work. Keep results unfilled until observed.

1. Build a ten-slide business pitch with a brand theme, two images, one chart and notes.
2. Bring in a twenty-slide deck containing fonts, tables, charts, media and animations; record
   what remains editable, what becomes a picture and what is lost.
3. Create an interactive product overview with four topics, detail panels and return navigation.
4. Present to a mixed mobile/laptop audience; open, close and reveal a poll; moderate Q&A.
5. Disconnect/reconnect a participant, refresh the host and hand off controls without losing state.
6. Share a private recap, revoke access and attempt an unauthorized media/read/export request.
7. Export and open files on another machine without Polling Pops; record static/interactive losses.
8. Complete core tasks by keyboard and screen reader, at 200% zoom and with reduced motion.
9. Have a reviewer suggest changes while another author edits; verify publication and conflict behavior.

Do not turn an untested feature checklist into a numeric quality score. After observing these tasks,
compare successful outcomes and total customer cost. Select the first implementation scope from
the broad creator jobs above, while preserving the repository's operational release requirements.
