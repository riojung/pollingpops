# Idea Board canvas architecture

Date: October 29, 2026; productivity extension October 30, 2026

## Decision

The initial customer pilot implements orders 0–4 of the
[canvas implementation plan](../idea-board-canvas-implementation-plan.md); Order 5 extends it
with the productivity tools described below. Orders 6–7 remain deferred. Use a separately
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
include retained undo history. Generic media/content routes cannot attach or serve those assets.
Guest image delivery requires a currently published object and a fresh source-board credential.
Public children are flattened from omitted private frames; private children and connector
endpoints are never promoted. The original manually authored template factory runs inside canvas
creation, remaps all IDs and contains neither guest responses nor cloned media. Seven English
starters have localized chooser controls and previews. Workshop starters deliberately seed
published authored scaffolding; ordinary new objects retain their private default.

Image reservations are bounded to 100 per board lifetime and 200 MiB in total, with JPEG, PNG or
WebP files of at most 10 MiB and required alternative text. Scanning and authorized private byte
delivery reuse the existing media pipeline. Unattached reservations become cleanup-eligible after
15 minutes; current objects and retained inverse history protect referenced images from pruning.

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

Order 5's focused verification passes; final full repository and browser results are tracked in
the [implementation status](../implementation-status.md#canvas-productivity-order-5-october-30-2026).
The browser fixture substitutes in-memory object storage and
scanning. Physical touch hardware, production media operation, production load, post-commit peer
latency and rendering performance remain unmeasured for this increment. The October 29 repository
acknowledgement measurements belong to the earlier pilot and do not accept these gates.
