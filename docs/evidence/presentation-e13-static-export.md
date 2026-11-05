# Presentation E13 static export

Implementation branch: `codex/presentation-e13-static-export`. This is the broad-creator pilot's
static portability slice. Editable PPTX, offline interactive packages, media transcoding and
self-paced assignments remain separate work. The selected static software scope and local
verification are complete; the feature remains undeployed.

## Scope

An authorized owner/editor selects an immutable published version and downloads a whole-deck
PDF, one-page PNG, or self-contained accessible HTML. The published page picker uses the selected
version's page IDs and titles rather than draft order. Later draft changes and publications do
not enter an already selected export. Hidden planning slides are excluded at publication.

The export uses the private-review recipient allowlist without creating a share link. Speaker
notes, answer keys, explanations, provenance, branches, moderation, participant records, scores,
live state and credentials are excluded. Only current clean, frozen-version image references
are loaded; authorization and media status are rechecked after asynchronous work before delivery.

PDF and PNG flatten controls into the slide layout. They may clip text overflowing authored
frames. HTML includes the complete semantic reading order, tables, chart data, image descriptions
and public reveal/detail bodies alongside the visual pages. It has no scripts or remote assets.
The PDF is a visual document, not a claim of tagged-PDF accessibility. A downloaded copy cannot
be revoked like a live review link.

Rendering reuses the existing canvas, PDF and bundled-font facilities. A bounded worker isolates
CPU work from live sessions; limits cover pages, dimensions, decoded pixels, media/output bytes,
admission, concurrency and deadlines. No paid service, AI call, dependency, subscription
entitlement, content-schema rewrite or database migration is required.

Visual pages are 1280×720, with at most 100 pages, 40 unique images, 10 MiB per image, 40 MiB
total media and 40 MiB output. Header inspection rejects images above 16 million pixels each
or 32 million aggregate pixels before native decoding; decoded images are reused within a job
and page bitmaps are released after encoding. Two export jobs may be active per server, with
five requests per creator per minute and a 30-second cancellation deadline. A pending bounded
storage read retains its admission slot until it actually settles. Cancellation terminates and
awaits the owned rendering worker before releasing that slot.

All formats use the same visual drawing path for themes, frames, rotation, crop, charts and
typography. Generic font families can vary by host; bundled CJK/emoji fallback covers supported
characters, and unsupported glyphs fail explicitly. This does not promise identical font metrics
across every browser/device. The HTML preserves full text independently of visual clipping.

## Verification

- **20 contract/API tests pass**: strict requests, safe published page metadata, pinned versions,
  recipient projection, role/session/workspace/feature checks, selected-page media isolation,
  size/admission limits, late media revocation and disconnect during admission. Deadline/abort
  regressions retain both slots until an uncancellable media read or renderer actually settles.
- **28 renderer tests pass**: the disposable worker produces parsed three-page 16:9 PDF, decoded
  PNG and complete HTML; mid-render cancellation permits a subsequent successful job. Pixel
  checks cover themes, no footer overdraw, image contain/cover/focal points, rotated shapes,
  connectors and all three chart types. Semantic checks cover native/legacy reading order,
  rich text, chart tables, public detail bodies, safe links, escaping and embedded image alt text.
  Supported CJK/emoji render; unsupported glyphs fail clearly. Missing media and excessive
  declared pixels reject before decoding; repeated media decodes once per render.
- **46 focused web tests pass**, including 31 client/dialog and 15 existing Builder checks.
  They cover pinned page metadata, bounded response streams, MIME validation, cancellation,
  uncertain late results, explicit retry, download cleanup and disabled/unpublished behavior.
  Current server/contracts/web typechecks and scoped lint pass.
- **Four production-browser workflows pass**: desktop Chromium/Firefox and mobile Chromium/WebKit
  each create and publish an original deck with uploaded imagery, rich text, data and an activity,
  then change its draft. All twelve downloads retain the chosen publication and exclude hidden
  planning slides, private notes/answers and the later draft. PDF page count, PNG dimensions,
  semantic HTML, decoded images, no external requests, Axe, focus return and viewport overflow
  checks pass. Resizing to 320px preserves access to the inspector toggle. Real browser checks
  found and verified fixes for a dialog banner, repeated HTML landmark names and fixed-height
  drawers overlapping wrapped commands. No force clicks or disabled accessibility checks are used.
  Each profile uses a fresh owned in-memory API to respect the real per-actor render budget;
  they share the same production Next bundle, synthetic scanner and ephemeral loopback S3 fixture.
  Private browser logs, captures and twelve files are under `/tmp/pollingpops-e13-browser/`.
- **Compiled worker smoke passes** for PDF/PNG/HTML using the shipped entry points and existing
  font assets. The synthetic three-page PDF is 101,446 bytes, its PNG is 50,230 bytes and HTML is
  187,191 bytes. `pdfinfo` confirms three 1280×720 pages, no forms, JavaScript or encryption, and
  an untagged visual PDF. PNG and all three PDF rasterizations were visually inspected for
  multilingual text, rich text, images, rotation, tables and charts. Private artifacts are under
  `/tmp/pollingpops-e13-compiled-output/`.

**`VITEST_MAX_WORKERS=1 pnpm check` passed**, including formatting, Docker-context checks, lint,
typechecks, package/support tests, production builds and the admin CLI. Principal passed counts
are contracts 898, database 530, server 1,224, web 2,564 and smoke-support 354. Existing opt-in
integration skips remain. Private full log: `/tmp/pollingpops-e13-background-fix-check.log`.

All owned browser fixture ports (14520/15520/15523) had no listeners afterward, owned Firefox
fixture data was removed, and actual `HOME` was unchanged. The final scope check found only
27 intended source/test/doc files, with no generated artifacts, credentials, dependency churn or
migrations. No database migration or persistence behavior changed; this slice does not claim a
new PostgreSQL qualification run. Manual assistive technology, physical devices, hosted
storage/scanning, production capacity, operating cost and observed creator usability remain
release qualification work.

## Review follow-up: opaque data frames

The review identified that exported table and chart frames omitted the opaque themed background
used by the shared preview. Lower shapes or images could therefore bleed through cells and plots.
The visual renderer now paints each data node's background inside its transformed, clipped frame
before drawing its contents. This applies to PNG, PDF and the embedded HTML snapshots without
changing semantic content or other layers.

Seven new real-pixel regressions failed against the original implementation and pass after the
fix. They cover tables and charts over both shape/image layers with default white, paper and
midnight backgrounds, plus a rotated table. Pixels outside the data frames retain their lower
layers. All 24 core renderer tests and four worker/facade tests pass.

The full repository pipeline passed again after the fix. A separate compiled-worker check
verified the same opaque interior and preserved exterior pixels in both PNG downloads, both
embedded HTML snapshots and both rasterized PDF pages. Private artifacts are under
`/tmp/pollingpops-e13-opaque-compiled-output/`.

## Rollout

Deploy the matching export API, renderer worker entry points and web controls together. Retain
the already bundled summary-font assets in the server image. Existing Presentation feature and
workspace-role policies apply. Static export does not mutate drafts, published JSON, immutable
hashes, accepted mutation receipts, live sessions or learner attempts.

Rollback may remove the export API and controls without deleting or rewriting source content.
Previously downloaded files remain in their recipients' possession.
