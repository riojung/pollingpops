# Presentation E05 visual import

Implementation branch: `codex/presentation-e05-visual-import`, based on E04 commit
`9482d7c0be357d521c715ed994412e751bb0f7b2` ([PR #196](https://github.com/riojung/pollingpops/pull/196)).
E05's PDF/image import software scope is complete and merged in
[PR #197](https://github.com/riojung/pollingpops/pull/197). This increment remains undeployed;
the executed checks and remaining acceptance boundaries follow.

## Behavior

Visual import accepts one PDF or a PNG/JPEG/WebP image set and converts asynchronously without
an AI provider or AI credits. A private preview supplies ordered page selection, extracted text
suggestions and a loss report. Before insertion, authors supply a title, image description and
reviewed reading text and acknowledge reading order/meaning and fidelity limitations.

Every selected page creates a fitted visual slide and an editable native reading slide. The
ordinary Builder can interleave, edit and reorder content and activities afterward. A sole empty
initial placeholder is replaced; meaningful slides, notes and hidden planning content are retained.
Existing native fields and optional per-block source disclosure express these slides, without a
new content version or changed defaults/historical hashes.

New migration 093 supplies separate conversion jobs, leases, immutable source identity, tenant
scope, temporary page ownership and workspace usage limits. Original files are erased on ready,
terminal failure or cancellation. Pending originals and private previews expire after 24 hours;
the retention sweep releases expired job references. Generated objects always have a reserved
media row before writes and use ordinary quarantine/scan/promotion and reference/deletion rules.
Draft/history/publication references protect inserted images after preview cancellation or expiry.

Creation and insertion keep exact retry identities. Readiness is checked inside the draft commit
against concurrent cancellation/expiry. Moderation, live responses and scoring are unaffected.
The current source-grounded PDF/DOCX/PPTX proposal flow retains its separate name and AI policy.

## Executed verification

- After the EXIF review follow-up and before the fixture XML follow-up below,
  **`VITEST_MAX_WORKERS=1 pnpm check` passed**, including
  repository formatting, Docker context checks, lint, types, package tests, smoke-support tests,
  production builds and the admin CLI.
  Principal totals: contracts **645**, database **516**, server **1,158** and web **2,403**.
  Ordinary DB execution skipped 353 PostgreSQL-dependent tests; server retained 15 existing skips.
  Smoke support passed **354**, with one existing skip. Restricted PostgreSQL was checked below.
  Protected pre-PR log: `/tmp/pollingpops-e05-pr-check.log`. The initial support run caught
  the expected CI artifact list needing the new visual-import diagnostics; that expectation was
  updated before both successful repository checks.

- Initial converter suite: **17 tests passed**, including real PDF raster pixels/text/rotation, PNG/JPEG/
  WebP normalization, encrypted/owner-only PDFs, text truncation, page/pixel/decompression limits,
  malformed/oversized images and timeout recovery. Literal `/Encrypt` content and abbreviated
  Flate filter names have explicit regressions.
- The final production build and compiled `--jitless` child smoke passed after all parser guards.
  Two PDF pages rendered at 1,600×800 and 800×1,600, extracted text and a red raster pixel were
  verified, WebP normalized to PNG, malformed/timeout codes stayed safe, and no converter children
  remained. Private result: `/tmp/pollingpops-e05-compiled-smoke.json`.
- API integration: **8 tests passed** with real routes/repository/worker and synthetic media IO.
  Coverage includes ordered reviewed pairs and publication, repeated creation/insertion receipts,
  changed-intent conflicts, viewer/wrong-presentation denial, cancellation before draft commit and
  during generated-media writes, failed encryption, creation receipts while uploads are disabled,
  and the maximum review-envelope byte budget. Exact insertion receipts also recover after
  cancellation, preview expiry and later edits removing the source anchor and inserted blocks.
  Oversized envelopes return a useful 413 rather than an internal error. Related jobs/runtime,
  Presentation API, retention and existing source-authoring request-budget checks also passed.
- Web focused checks: **25 tests passed** for file budgets, selection/reordering, reading review,
  disclosures, local receipt recovery, lost upload acknowledgements and exact insertion replay.
  Scoped lint, formatting and web typecheck passed; final repository checks include the fixture.
- Contracts/database focused checks passed **6/6**, with package typechecks, scoped lint and
  formatting. New bounds explicitly count UTF-16 units, matching browser limits and SQL even
  where the installed string validator's built-in maximum counts differently.
- Restricted PostgreSQL 17 run **`83a59b0906` passed all five selected cases**, with 130 filtered
  out. All **93 migrations and checksum-ledger checks passed twice**, along with 65 existing SQL
  guards and new input, ownership, manifest, pixel, Unicode, quota and lease/cancellation checks.
  The fixture completed in **11.00 seconds**. Its container and SSH forward were removed; all
  fourteen pre-existing containers retained their state, with no OOM. Private results:
  `/tmp/pollingpops-e05-pg/result-83a59b0906.json` and `migration-result-83a59b0906.json`.
  Tmpfs validates correctness and restricted privileges, not production fsync latency.
- **Four production browser cases passed**, one each in desktop Chromium/Firefox and emulated
  mobile Chromium/WebKit, with no failures or skips in the final run (**70.74 seconds** including
  startup). The real converter, worker and APIs used a synthetic clean scanner and loopback
  object store. Coverage includes loaded private previews, anonymous denial, page review/order,
  loss disclosure, lost acknowledgement/reload/exact replay, insertion counts, interleaving,
  publication and replay after subsequent edits. Axe, keyboard dialog use and overflow checks
  passed. Desktop/mobile captures were inspected. Owned Firefox data was removed and actual
  `HOME` was unchanged. Results: `/tmp/pollingpops-e05-visual-browser-canvas.{log,json}`.
  Earlier runs exposed one accessible-name mismatch in reorder buttons (fixed) and a fixture
  assertion targeting a shortened object label instead of the full canvas text (corrected).

## Requested review follow-up

The requested review found that valid EXIF-rotated JPEGs were rejected as malformed because
the decoded, oriented dimensions were compared only with the unrotated file header. The same
case was reproduced for WebP. The converter now accepts the exact original axes or their swap,
then sizes the output from the decoder's oriented dimensions. No additional rotation is applied.
Other dimension mismatches still fail, and the existing predecode edge/pixel budgets remain
unchanged because swapping axes preserves both limits.

Regression coverage adds all eight JPEG/WebP EXIF orientations in both TIFF byte orders,
checking output dimensions and four corner colors to detect stretching, mirroring errors or
double rotation. Two rotated-JPEG cases also verify that oversized headers are rejected before
decoding. Before the fix, exactly sixteen rotated/transposed cases failed; afterward **59/59
focused tests passed** (51 converter and eight import API), with no failures or skips. Server
typecheck, scoped ESLint, formatting and production build also passed.

The rebuilt compiled `--jitless` converter passed PDF pixel/text, ordinary image, safe-error and
child-cleanup smoke checks. Four additional compiled JPEG/WebP orientation-6/8 cases verified
portrait dimensions, corner pixels and zero remaining converter children. Private result:
`/tmp/pollingpops-e05-exif-compiled-smoke.json`. This follow-up changes image normalization only;
the earlier PostgreSQL/browser runs were not repeated.

## PR #197 XML review follow-up

CodeQL identified sequential XML entity decoding in the synthetic object-store batch-delete
handler. A key containing literal `&lt;` or `&gt;` could delete a different key containing `<` or
`>`. The handler now decodes the five named entities in a single replacement pass, preserving
literal entity text and supporting quoted/apostrophe keys.

An isolated loopback harness executing the fixture's actual storage handler reproduced five
failures before the fix. Afterward, all ten cases passed: intended objects were deleted, decoy
objects and their bodies were preserved, and response keys round-tripped exactly. Cases include
nested entity text, all five named entities and combined characters. Scoped ESLint, Prettier and
`git diff --check` passed. This change affects the synthetic fixture only; the full repository,
PostgreSQL and browser suites were not repeated for this follow-up.

## Runtime and fidelity limits

The installed PDF.js and canvas libraries are reused; no service dependency or model call is
added. Conversion uses a separate Node 26 child with network/child/worker/filesystem-write
permissions denied, V8 evaluation disabled, a 192 MiB heap, 384 MiB RSS watchdog, timeout and
bounded IPC/output. File reads are limited to worker code, installed modules and bundled renderer
assets/fonts. Environment
credentials and proxy/addon overrides are not inherited. Unsupported Node runtimes fail closed.

Node's permission model is a runtime restriction, not an OS or hostile-native-code sandbox.
The canvas addon remains trusted; RSS sampling is not a hard allocation cap. Deployment container
memory limits remain necessary. See the [Node permission documentation](https://nodejs.org/api/permissions.html)
and [network permission flag](https://github.com/nodejs/node/blob/main/doc/api/cli.md).

Sources/pages, decoded dimensions, decompression, canvas allocations, output pixels/bytes,
attempts, deadlines and queue usage are bounded as recorded in the
[upgrade runbook](../runbooks/upgrade.md#presentation-visual-import-compatibility). Some valid but
complex PDFs require a simpler export or page images. Source objects are flattened; animations,
links, audio/video and editable source objects are not imported. Fitted stage layout and font
substitution may differ. OCR is absent. Extracted text is unverified until the author reviews it.

## Acceptance boundary

PPTX visual conversion, editable object import and E13 static export are separate scopes. No
hosted rollout, physical-device/manual screen-reader or zoom acceptance, target-capacity latency,
measured operating cost, subscription price or competitor parity is claimed here. A local
synthetic scanner/object-store browser fixture verifies product integration without representing
an actual ClamAV/S3 deployment rehearsal. The running local and hosted app flags are unchanged.
