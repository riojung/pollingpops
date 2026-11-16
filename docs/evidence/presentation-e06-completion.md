# Presentation E06 advanced interactions

Implementation branch: `codex/presentation-interactions-sharing`. This increment builds on the
reviewed E07 navigation work included in this change. The selected E06 software scope and local verification
are complete. No deployment or running feature-policy change has been performed.

## Behavior and boundaries

Opt-in document13/scene6 adds labeled image hotspots, local detail dialogs, internal slide links,
presenter-controlled broadcast reveals and explicit answer branches. Existing scene5 local
reveals/links, document defaults, frozen hashes and legacy receipts retain their meaning. There
are no executable scripts, arbitrary HTML, hover-only actions or required model calls.

Hotspots reference an existing unrotated image in the same scene. Their frame must remain inside
that image at publication; moving/resizing the image carries its hotspots, and duplication remaps
the reference. Detail dialogs have an accessible name, plain audience text, keyboard operation,
Escape dismissal and focus return. The readable outline provides the same actions. Authoring
previews stay inert. Local details never submit responses or change the live cursor.

Internal controls store a stable frozen block target. In live delivery only host/Companion can
activate them through server-authorized `navigate_scene` commands. Participant/stage projections
contain no target graph and cannot issue shared navigation. Recipient review links follow targets
using their own local cursor. Missing, hidden, self and recheck targets fail publication.

Broadcast controls use absolute `set_reveal` commands, never toggles. State is separate from the
scene and commits under the existing aggregate lock with revision, receipt and timeline. It
survives reconnect, reload, cohost takeover and revisits without resetting local dialogs. Closed
bodies are removed before audience JSON serialization and remain absent from audience DOM.
Staff retain the frozen authored body. No response, score, deadline or navigation progress changes
when a reveal changes. Companion images use a pass-only current-block media endpoint.

Answer branches are explicit host choices after reveal; ordinary Next keeps the numbered path.
Rules use a selected choice's share of accepted responses or the correct share of assessed
responses, with a minimum response count and percentage. The server computes eligibility and
revalidates aggregate evidence under the row lock. No participant submission automatically routes
the room. Branches are limited to unlinked main questions and forward, safe published targets;
this avoids loops and preserves linked recheck sequences. Revisited questions keep their closed
attempt, original windows and points. Branch conditions and targets stay staff-only.

ReportV7 adds typed reveal/branch events and counts, with `includeInteractions=true` required
alongside the existing navigation and result opt-ins. Reports contain node IDs and aggregate
evidence, not reveal bodies or private notes. Earlier report enums remain unchanged.

## Verification

- Focused navigation/advanced API checks passed **7 tests**; the broader server integration sweep
  passed **62**, and Companion API checks passed **13**. Coverage includes body withholding,
  absolute state, exact late receipts, internal navigation, real responses, eligible branches,
  ReportV7 and current-block media isolation/revocation. Counts overlap and must not be summed.
- Focused contracts passed **316 tests**; the web sweep passed **307**, with typechecks and scoped
  lint. A later **31-test** detail-dialog sweep verifies Escape and Close returning focus to the
  actual trigger even when touch activation leaves `document.activeElement` on the body.
- Restricted PostgreSQL 17 run **`20df94cce3` passed 69 selected cases**, including the E07 baseline,
  advanced state/receipt/branch guards and sharing lifecycle. All **97 migration checksums matched
  twice** under restricted runtime roles and forced RLS. The verifier preserved an immutable v9
  hash and rejected **65 legacy raw mutations**. Owned container/SSH/lock cleanup passed, all
  fourteen pre-existing containers retained their state and no OOM occurred. Tmpfs verifies
  correctness, not production fsync latency. Private evidence:
  `/tmp/pollingpops-interactions-sharing-pg/result-20df94cce3.json`.
- The combined **eight production-browser cases passed** across Chromium, Firefox, mobile
  Chromium and mobile WebKit, with no skips/failures (**107.86 seconds**, including build,
  fixture and cleanup). Four advanced-interaction workflows exercise real UI image uploads,
  hotspots, detail dialogs, shared reveals, internal links, newer publication versus frozen live
  targets, actual participant answers, eligible branches and V7 report/CSV. Accepted-ACK loss,
  reload/cohost recovery and closed revisits preserve the original score/attempt. HTTP/socket
  privacy, keyboard/focus, reduced motion, Axe and overflow checks pass. The unchanged WebKit
  focus assertion caught and verified the explicit-trigger fix.
- All **16 final captures** were inspected: twelve advanced live/dialog/report captures and four
  review captures. Reports show one actual response, 100 points, two reveal changes, one branch
  and skipped evidence. Some small authored fixture frames clip secondary hints, and the desktop
  review fixture image overlaps parts of other controls; the readable outline and mobile stacking
  retain the actions. Manual design/assistive-technology acceptance remains open.
- The browser uses production Next assets and the real local in-memory API with the existing
  synthetic clean scanner and ephemeral loopback object store. It does not qualify hosted S3,
  a production scanner, physical phones or WAN/soak behavior. Owned Firefox data was removed,
  actual `HOME` remained unchanged and task ports 13408/14408/14411 had no listeners afterward.
  Private result: `/tmp/pollingpops-interactions-sharing-browser-verified-98dc50c0276c/result.json`.
- **`VITEST_MAX_WORKERS=1 pnpm check` passed**: formatting, Docker-context checks, lint, all
  package typechecks/tests, smoke-support, production builds and the admin CLI. Principal passed
  counts are contracts 896, database 529, server 1,177, web 2,514 and smoke-support 354. Opt-in
  integration tests remain skipped in the default task; the selected PostgreSQL cases above ran
  separately. Private full log: `/tmp/pollingpops-interactions-sharing-check.log`.

## Rollout

Apply migration096 after095 and deploy compatible document13/scene6/report7 API, worker, artifact,
history and web readers before enabling new writes. Retain prior migrations and immutable content;
rollback requires compatible readers or forward repair, not stripping nodes/state or changing
hashes. Sharing uses separate migration097 and its own evidence record. No new paid API,
microservice, AI provider or commercial entitlement is introduced.

Automated verification does not close physical-device, manual screen-reader/zoom, hosted load,
operating-cost, customer usability or competitor-parity gates. Drag/drop mechanics, variables and
general scripting remain beyond the selected E06 scope.
