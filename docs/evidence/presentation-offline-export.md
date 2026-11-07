# Presentation offline interactive HTML

Branch: `codex/presentation-offline-export`, based on `02ac808` (merged discussion suggestions,
PR #210). This bounded E13 portability increment remains undeployed and independent of the
separately open layout proposal in PR #207.

## Creator and recipient workflow

Publish a deck, then choose **Export**, **Offline interactive HTML — whole presentation** and
**Download export**. One `polling-pops-presentation-offline.html` contains the selected immutable
publication's visual snapshots, complete public readable content and embedded clean images.
Later drafts and publications cannot enter an already selected download.

Native disclosure panels make authored reveal, dialog and image-hotspot details available in
reading order. They start closed. Page/section indexes, previous/next links and authored page
links navigate within the file. These controls work without JavaScript or network access;
visual snapshots remain flat. Public broadcast bodies deliberately become viewer-local
disclosures, with no host synchronization. External links, including rich-text links, clearly
leave the file and may require internet access.

Activities are readable previews: no answer entry, submissions, scoring, live results, learner
attempts, progress persistence or completion records. This does not implement E08 self-paced
delivery, editable PPTX or the live presentation stage. Every included public disclosure body
is in the downloaded file regardless of whether its panel is open. A downloaded copy cannot
be revoked. Existing readable HTML continues to show all public details expanded.

## Compatibility, privacy and cost

The only new request value is `format: "offline_html"`, for the complete published deck. The
response is `text/html` with physical `.html` extension. Existing PDF/PNG/HTML request bytes,
document/scene versions, immutable hashes, drafts, receipts and live response/report semantics
retain their meanings. No migration, dependency, service, AI call, subscription entitlement or
new stored job type is introduced.

The export reuses the existing recipient projection, creator/source/media reauthorization,
disposable renderer worker, rate/concurrency admission, cancellation deadline, and page,
decoded-pixel, media/output-byte budgets. Notes, answer keys, explanations, branches, private
source/AI attribution, moderation, participant records and credentials stay outside this projection.
Images are embedded; no private object URLs are exported. Authored text and link labels remain
escaped rather than executable.

The generated file has no script, form, iframe, embedded application or storage logic. Its
content policy denies scripts, connections, frames, objects, workers, forms and base URLs;
image resources are limited to data URIs. Safe external navigation remains explicit. This is
not a claim of browser/operating-system sandboxing or cross-application document compatibility.
See the [upgrade instructions](../runbooks/upgrade.md#presentation-offline-interactive-html-compatibility).

## Verification

- **Four focused contract tests pass:** the new whole-deck request, strict fields, normalized
  version identity, rejected page selection and retained PDF/PNG/HTML request bytes/behavior.
- **83 focused server tests pass** across renderer core, disposable worker, API and existing
  starter/suggestion privacy suites. These cover complete semantic content, three closed native
  disclosures, safe/escaped links, actual worker output and recipient projections, valid unique
  navigation targets, no scripts/forms/remote resources, and the existing resource limits.
  Late cookie/member/workspace/source/feature loss, media changes during reads/rendering/final
  authorization, pinned hash/version changes and deadline/slot retention remain enforced for
  offline downloads. Translated titles keep their languages in index links; generated English
  notices have their own language. Detail headings retain their order even before the title.
- **45 focused web tests pass:** format-specific MIME and fixed filenames, whole-deck requests,
  selected-only capability guidance, pinned publication, bounded streams, invalid responses,
  cancellation, late results, explicit retry, download cleanup and focus return.
- **Eight production-browser workflows pass** across Chromium/Firefox desktop and
  Chromium/WebKit mobile: four combined static/offline download workflows and four existing
  visual-import workflows. All sixteen downloads retain their chosen publication and omit the
  later draft, hidden planning slide, notes and answer keys. Actual downloaded offline files
  open with both JavaScript and networking disabled. Keyboard Enter/Space, touch disclosure
  controls, authored page links, previous/next navigation, embedded image decoding and closed
  panels after reload pass. Axe reports zero violations with panels closed/open and in the
  export dialog; the offline file has no horizontal overflow at 320px. Desktop and compact
  captures were inspected. Each profile gets a fresh isolated in-memory API/media fixture;
  unchanged export rate and concurrency budgets apply. The matching CI media-fixture batch
  now executes these download tests as well as visual import, retaining its five-minute limit
  and job failure status. Private matrix: `/tmp/pollingpops-offline-export/browser-result.json`.
- **Compiled-worker smoke passes** for all four formats with an embedded synthetic image and
  public reveal/detail/navigation content. The two-page offline HTML is 104,035 bytes; its
  disclosures, embedded image, escaped authored markup, CSP, MIME and physical extension are
  checked. PDF has two 1280×720 pages with no forms/JavaScript and remains untagged. The compiled
  PNG was visually checked. Private results: `/tmp/pollingpops-offline-export/compiled-result.json`.
- **`VITEST_MAX_WORKERS=1 pnpm check` passes** in 328.1 seconds, including formatting,
  Docker-context checks, lint, strict types, tests, production builds and the admin CLI build.
  Principal totals are **960 contracts, 584 database, 1,445 server, 2,960 web and 354 support
  tests**. Normal opt-in integration skips remain. Browser strict TypeScript, scoped ESLint,
  formatting and CI wiring checks also pass. Private log:
  `/tmp/pollingpops-offline-export/full-check.log`.

The unit-test run uses its ordinary API environment; the production browser build separately
uses the loopback fixture API. Firefox's first local launch needed owned private application
directories; all final profiles passed without repurposing `HOME`. Owned browser,
API and object-store listeners and Firefox fixture directories are cleaned up. Logs/results are
retained privately. No database persistence change requires a new PostgreSQL qualification run
for this increment.

Physical-device/manual assistive-technology checks, observed creator usability, hosted
storage/scanning, production capacity, operating cost and deployment remain separate gates.
