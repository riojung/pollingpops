# Idea Board canvas architecture

Date: October 29, 2026

## Decision

Implement the first customer release in orders 0–4 of the
[canvas implementation plan](../idea-board-canvas-implementation-plan.md). Use a separately
versioned, typed canvas domain with server-authoritative object operations, board-scoped sharing,
and metadata-only live notifications. Preserve the existing Idea Board workshop state machine,
guest credentials, moderation, voting, and scanned media.

The initial renderer uses original SVG geometry with DOM text editing and an accessible outline.
SVG is generated from bounded typed objects; the server never accepts SVG markup, HTML, scripts,
or an editor package's arbitrary scene payload. No editor SDK or additional runtime dependency
is introduced for this release.

## Renderer boundary

The editor adapter accepts normalized sticky notes, text, rectangles, ellipses, connectors, and
protected idea references. Viewport state and selection stay local. Objects have stable IDs,
versions, finite geometry, a bounded color palette, and explicit visibility. Input fields handle
text composition; the visual surface and numeric inspector provide pointer and keyboard editing.

This deliberately limits the first editor to the primitives needed by the selected release.
More advanced layout, drawing and asset tools remain separate increments. Maintaining interaction
and accessibility behavior is our responsibility; replacing the renderer later must preserve the
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
