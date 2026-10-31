# Idea Board canvas architecture

Date: October 29, 2026; productivity, facilitation and diagram/reference extensions October 30, 2026

## Decision

The initial customer pilot implements orders 0–4 of the
[canvas implementation plan](../idea-board-canvas-implementation-plan.md); Order 5 extends it
with productivity tools, and Order 6 adds the bounded facilitation tools described below.
Order 7 adds diagram styles, private authoring references and capacity evidence tooling while
keeping higher limits gated. Use a separately
versioned, typed canvas domain with server-authoritative object operations, board-scoped sharing,
and metadata-only live notifications. Preserve the existing Idea Board workshop state machine,
guest credentials, moderation, voting, and scanned media.

The initial renderer uses original SVG geometry with DOM text editing and an accessible outline.
SVG is generated from bounded typed objects; the server never accepts SVG markup, HTML, scripts,
or an editor package's arbitrary scene payload. No editor SDK or additional runtime dependency
is introduced for this release.

## Renderer boundary

The editor adapter accepts normalized sticky notes, text, rectangles, ellipses, connectors,
protected idea references, frames, pen strokes, images and HTTP(S) links. Viewport state and
selection stay local. Objects have stable IDs,
versions, finite geometry, a bounded color palette, and explicit visibility. Input fields handle
text composition; the visual surface and numeric inspector provide pointer and keyboard editing.

Order 5 adds geometric groups, multiselect layout, inherited locking, freehand and private scanned
image assets alongside the frame and link tools. Maintaining interaction and accessibility
behavior is our responsibility; replacing the renderer later must preserve the
document schema, board permissions, operation receipts and guest-card protections.

The [Excalidraw integration API](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/integration)
and [collaboration FAQ](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/faq) were evaluated
as a possible adapter. Its embedded package does not provide application collaboration. This
release does not adopt its scene/history model or claim that its general-purpose editing surface
has been integrated with our protected idea cards. An SDK adoption remains contingent on a
working domain adapter and the acceptance cases in the plan.

[tldraw's production licensing](https://tldraw.dev/community/license) also requires a separate
decision for hosted and downstream self-hosted installations. Keeping the first renderer free
of a commercially licensed SDK avoids introducing that deployment requirement before it is
selected. The existing repository license continues to cover the original renderer code.

## Storage and concurrent operations

The productivity increment uses explicit V2 snapshots and objects with a frozen V1 reader and
deterministic scene/history upcasts. Original V1 input fingerprints remain unchanged. Migration
080 records schema versions and board-image provenance; no applied migration is rewritten.

Children retain world coordinates. Frame movement updates the complete descendant closure;
resizing changes the frame boundary. Geometric groups bind same-parent objects independently of
the source workshop's semantic groups. A shared affected-object planner and repository checks
enforce permissions, ancestry, lock-only toggles, expected related versions and a 50-object atomic
budget. Privacy removals stay terminal even when removing their dependent scene relationships.

Native images use board authorization, private scanned bytes and explicit media references that
include retained undo history and manual saved versions. Generic media/content routes cannot attach or serve those assets.
Guest image delivery requires a currently published object and a fresh source-board credential.
Public children are flattened from omitted private frames; private children and connector
endpoints are never promoted. The original manually authored template factory runs inside canvas
creation, remaps all IDs and contains neither guest responses nor cloned media. Eight English
starters have localized chooser controls and previews. Workshop starters deliberately seed
published authored scaffolding; ordinary new objects retain their private default.

Image reservations are bounded to 100 per board lifetime and 200 MiB in total, with JPEG, PNG or
WebP files of at most 10 MiB and required alternative text. Scanning and authorized private byte
delivery reuse the existing media pipeline. Unattached reservations become cleanup-eligible after
15 minutes; current objects, retained inverse history and saved versions protect referenced images from pruning.

Guided starter creation checkpoints source and canvas retry keys plus the acknowledged source ID
in bounded account/workspace-scoped tab storage. HTTP setup context is a mismatch guard against
fresh authenticated identity and the intended workspace, never a source of authority. Retrying
after partial success resumes the unfinished step; keeping the source without a canvas never
deletes it. Successful product logout clears saved setup and invalidates late checkpoints.

Store canvas metadata, objects, grants, invitations, receipts and outbox records separately from
the existing bounded Idea Board aggregate. The first release supports at most 500 objects and
2 MiB of normalized document data, with separately bounded commands and geometry. These are
hard admission limits, not measured concurrent-editor capacity.

Workspaces retain at most 100 canvas documents. Workshops reserve 200 object slots for protected
guest ideas, leaving up to 300 ordinary objects. A canvas has a lifetime pilot budget of 5,000
accepted mutation receipts; inverse history is separately bounded to 4 MiB and 400 KiB per undo
record. Reaching the operation budget rejects further mutations clearly; owner deletion remains
available. This is a bounded pilot document, not an indefinite editing log.

Team-canvas retention is captured when created: 30 days for Free, the paid offer's report
retention (365 days when absent), or the Community operator's configured duration. An attached
workshop canvas always keeps the source workshop's original expiry.

Use per-object optimistic versions and an independent canvas sequence. An operation ID and
fingerprint make uncertain retries safe. Batch changes, sequence advancement, the receipt and
outbox metadata commit together. Commands derive identity from the session and recheck board
access inside their transaction. Undo and redo refer to the actor's own accepted operation and
reject if intervening edits would rewind somebody else's work.

Text editing initially uses explicit save and conflict review. Two users may edit different
objects concurrently. Simultaneous character-level editing and unrestricted offline coauthoring
are outside this release. Rejected or uncertain text remains available locally for recovery;
an ordinary refresh must not silently replace a dirty text field.

## Facilitation and historical views

Order 6 uses an independent facilitation schema-version-1 protocol and migration 081. Its
operation IDs and thread/timer version fences leave the strict Canvas V1/V2 request shapes and
accepted retry hashes unchanged. Comment threads/messages, timer state and named checkpoints
use board-scoped forced-RLS tables and the existing source/board lifecycle boundary.

Comments are plain text attached to current objects and visible only to authorized team readers.
Eligible editors create/reply and edit/delete their own messages; owners/facilitators resolve,
reopen and moderate. Viewers remain read-only, and guest projections contain no discussions or
history. Local failed text stays in editor memory for exact retry or explicit conflict review;
it is not written to browser guest-content storage. Discussion bounds are 100 threads, 20 messages
per thread, 500 messages and 512 KiB in total. Object removal and source moderation remove
dependent discussions; author deletion purges that author's retained messages.

The owner/facilitator timer is a durable server-clock countdown of 5 seconds to 2 hours, with
revision-fenced start, pause, resume and reset. Guests receive only its read-only projection.
Browser elapsed time uses the server snapshot and a monotonic clock; expiry never changes the
workshop phase.

Presenter state is an independent 15-second cache lease rather than durable canvas content.
Memory and Redis use compare-and-set fencing so competing starts and stale heartbeat/stop
requests cannot replace a newer lease. Production instances share Redis. Following requires
explicit opt-in and ends on pan, zoom, Escape, access loss or expiry. Team viewers may receive
the presenter's world region; guests receive only a currently authorized, explicitly published
frame reference, with neither presenter identity nor private viewport coordinates. Presenter
delivery is gated by the existing canvas live-update policy.

Manual checkpoints are bounded to ten versions, 2 MiB per scene and 4 MiB of total retained
history. A checkpoint never freezes canonical guest bodies. Preview and historical media reads
recheck current board access and current guest moderation, so old snapshots cannot revive
removed source content. Historical-image authorization includes checkpoint references even
when no live or undo object still uses those bytes. **Restore layout** is an ordinary V2 batch
over existing current objects only: current expected versions, locks, protected cards, parent
cycles, group/frame translation coherence and the 50-object limit remain authoritative. It
does not restore text, media identity, visibility or deleted objects; an incompatible layout
is rejected as a whole.

Exports render a fresh authorized object projection to a closed SVG subset with embedded
authorized image bytes. Links become plain text; remote URLs, executable content, pending ideas,
credentials and system identity metadata are excluded. PNG conversion happens locally from the
validated SVG. Whole-board, current-view and selected-frame-area exports are clipped regions,
not a new publication grant. Bounds are 25 image placements, 10 MiB per image, 20 MiB per export,
15-second operation budgets and a maximum 4,096 pixels per output side. Access and content
visibility are revalidated after asynchronous media reads. Already downloaded bytes cannot be
recalled.

## Board sharing

A board belongs to its original workspace and organization. Board invitations do not grant
workspace membership, change the active workspace, or allocate a creator license. Only verified
members of the same organization may accept an invitation in this release. An explicit Viewer
grant may permit a billing-only member to read that board; editing additionally requires current
creator eligibility and the appropriate board role.

Resolve board access from the signed-in user and the specific resource. The client receives
board capabilities instead of deriving permission from ownership of its selected workspace.
Seat/member removal, board grant revocation, suspension and deletion must fence subsequent
commands and terminate protected live delivery across nodes.

## Workshops and guest privacy

A workshop canvas references its original Idea Board. Its moderation, semantic groups, guest
submissions and final ballots remain authoritative there. Team notes and shapes default to team
visibility. A facilitator deliberately publishes objects for guests. Guest ideas are projected
through protected references and cannot be rewritten as ordinary text objects. Canvas editors
cannot rearrange or regroup those guest references.

Canvas and legacy workshop changes share the source-board lifecycle lock. Starting voting freezes
the scene; closed and voting legacy boards cannot be upgraded into an editable canvas. Direct
legacy phase changes enforce the same boundary as the new editor controls.

Guest images retain their original provenance. Shared authenticated collaborators use a canvas
authorization endpoint for image bytes, followed by another access check after storage reads.
Guests keep the existing board bearer and cookie-omitted media requests. Removed and expired
content is excluded from current views, historical undo/replay projections and queued deliveries.

## Live updates

Use authenticated HTTP commands and bounded fetch streams for metadata invalidations in the
first release. Each node tracks its own stream connections and outbox cursor; it does not compete
with other nodes in one consumer group. Source-workshop revision changes also invalidate views.
Coalesce client reads while preserving a final notification received during an in-flight read.

Both team and guest streams reauthorize current access, enforce connection and queue limits,
expire idle connections, and recover from interruption through authorized snapshots. Guest
streams use `fetch` with `credentials: "omit"`; native EventSource or same-origin WebSockets
are not assumed to provide the same cookie boundary. Existing Socket.IO gameplay contracts
are unchanged.

Presence is transient and independently bounded. It is exposed only to authorized team members,
not as public guest identities or as a replacement for the admitted-participant count. Outbox
and presence metadata never contain guest bearers, idea text or ballots.

## Rollout and verification

Creation, sharing and live updates have independent operator policies. New writers are opt-in;
authorized existing reads and lifecycle controls remain available when creation is paused.
Workshop retention remains unchanged, and canvas expiry follows its recorded origin policy.

Ship only after contract tests, memory/PostgreSQL conformance, HTTP authorization, multi-node live
delivery, legacy workshop regressions and desktop/mobile browser acceptance pass. Benchmark
claims require their own measured evidence; the plan's editor-count, latency and frame-rate
targets are not implied by a passing functional suite.

Migration 081 requires a coordinated maintenance cutover: drain and stop all old API writers
and cleanup jobs, apply 081, and restart only matching facilitation-aware server/jobs/web images
before admitting checkpoints. No independent checkpoint-admission flag exists. Once checkpoints
exist, an 080-era server or jobs writer is not a compatible rollback: it can drop checkpoint-only
media references even with migration 081 retained. Keep 079–081 and use matching readers/writers
or a reviewed forward repair. Pausing canvas creation does not stop old scene writes or jobs.

Order 5's completed verification and Order 6's results are tracked in the
[implementation status](../implementation-status.md#canvas-facilitation-order-6-october-30-2026).
Order 6 passes the full repository check and all 17 configured desktop/mobile canvas browser cases.
The browser fixture substitutes in-memory object storage and
scanning. Physical touch hardware, production media operation, production load, post-commit peer
latency and rendering performance remain unmeasured for this increment. The October 29 repository
acknowledgement measurements belong to the earlier pilot and do not accept these gates.

## Diagram and activity-reference extension

Canvas scene V3 introduces diamond/parallelogram nodes and bounded connector labels, cardinal ports,
straight/elbow routes, solid/dashed strokes, start/end arrows and palette colors. Shared pure
geometry keeps the interactive surface, fit bounds, saved previews and closed SVG/PNG export aligned.
Missing or unauthorized endpoints remain omitted before geometry is calculated. The renderer
accepts typed fields only; exports never accept arbitrary path markup or remote resources. Original
V1/V2 input contracts are frozen, including template IDs and retry hashes. Readers deterministically
upcast retained scenes/history; new writers use V3. Saved-version view V2 independently carries V3
objects; old view V1 upcasts, while facilitation commands stay V1. Existing resumable template intents
retain their captured schema version so an uncertain V2 retry does not become a different request.

Migration 082 extends the existing one-way scene-version constraint without rewriting 079–081.
Migration 083 adds forced-RLS references and receipts scoped to Round/Presentation targets. References
store exact source/version IDs rather than copied object bodies, pixels or live source pointers.
Source owner plus target editor is required to create/delete; same-workspace source access and target
access intersect on every metadata, preview and media read. Native and currently approved guest media
use a target-scoped private proxy, including reauthorization after storage waits. Current moderation,
source/version lifecycle and source deadlines remain authoritative at delivery. Archived targets
retain authorized reads but accept no new references. Unique live reference IDs, canonical request
hashes, target tombstones and bounded receipts make retries safe across memory and PostgreSQL.

The bounds are 20 references and 2,000 receipts per target, reserving deletion headroom. Source,
version and target deletion cascade; identity deletion clears attribution while organization-owned
content remains. References are creator-only authoring aids: they do not enter published documents,
participant/live payloads, activity/image exports or duplicated artifacts. Client previews watch source metadata,
poll target access, expire their TTL and release private image URLs on invalidation. This does not
grant target readers access to a source board, create workspace membership or publish a canvas.

Use coordinated maintenance for 082/083 and matching V3 server/jobs/web readers/writers. Keep
079–083; never downgrade accepted scenes or run a pre-checkpoint cleanup writer. An older V2-only
reader/writer is not a safe rollback once V3 data or references exist. Higher object/editor workload
claims require separate evidence; map-indexed persistence comparisons and shorter notification
coalescing are bounded optimizations, not authorization to raise limits. See
[capacity evidence](../canvas-capacity-evidence.md) for methods, observed results and missing gates.
