# Reviewed selected-text translation

Implementation branch: `codex/presentation-e12-translation`, based on merged selected-text
assistance commit `48429d7d10294dc021fe52e9c3f6f38b18687ae1` (PR #206). This increment is independent
of the reviewed layout changes in PR #207. Source remains undeployed.

## Creator workflow and scope

Select one plain native title/body object and choose **Translate text**. Opening the panel
drains pending saves and checks the existing allowance without admitting a job. Choose a target
language explicitly, then **Generate translation proposal**. Review complete original and
translated wording, the requested language, prior citations and the unverified-content warning.
Confirm the translation review before **Apply reviewed translation**. Generation never changes
or publishes the deck; Apply uses the normal saved draft and current-tab Undo/Redo workflow.

The initial canonical languages are English, French, Spanish, German, Italian, Portuguese,
Dutch, Polish, Japanese, Korean, Simplified Chinese and Traditional Chinese. Existing title/body
limits remain 160/4,000 UTF-16 characters. Formatted rich text, whole-deck translation and RTL
layout are outside this bounded slice. A marked source cannot target its own language. Proper
nouns can retain identical wording when their language annotation changes. Provider output is
not algorithmic proof of language or translation accuracy; creators review meaning, terminology,
claims and fit before application.

Each text object stores its own optional `lang`, independent of the slide's latest AI-edit record.
Multiple translated objects therefore retain their languages after another object is edited.
**Text language** also permits a manual correction or clearing to **Unspecified**, without AI use.
Ordinary text edits, formatting, duplication, layout and history retain existing annotations.
The shared plain/rich renderer and readable static HTML set language on the text content, keeping
the surrounding English controls separate. Recipient/review/export projections retain the public
language annotation and omit private edit provenance, notes and citation excerpts.

## Persistence, exact recovery and cost

Translation extends the existing private text-assistance queue, provider and worker. The provider
receives only selected text, role, operation and canonical target language. It receives no original
language annotation, notes, citations, other objects, navigation or participant data. Existing
2,048-token, 64KiB-response, 45-second, three-claim and 24-hour-retention bounds remain. Translation
shares the monthly authoring allowance and combined two-active-job workspace limit with outline
and rewrite/shorten assistance; no provider, service, dependency or entitlement is added.

Requests, jobs, proposals, Apply and tab recovery bind the exact source and target languages.
An unmarked original has `sourceLanguage: null`. Canonical codes are accepted without alias or
case normalization. Changing only the original language annotation invalidates a fresh request,
application or exact-target rebase just as changing the selected wording does. Exact accepted
receipt recovery still precedes later source/expiry checks. Tab recovery retains intent and
digests, not original/proposed text; uncertain outcomes keep their original request identity.

SchemaVersion1 rewrite/shorten payloads, canonical field order, hashes and recovery retain their
existing bytes. The language fields are appended and required only for translation; old operations
forbid them. Scene7 and document16 gate persisted text annotations and translation provenance.
Apply changes only selected text/language plus the latest-edit record and required version floors.
Other content, frames, styles, reading order, citations, source disclosure, notes, assets, published
versions, response/scoring contracts and Report V1–V7 retain their state and meanings.

Migration103 adds nullable queue language columns, conditional canonical-language checks, immutable
intent/proposal guards and compatible scene/document readers. Migrations001–102 remain unchanged.
The runtime upcasters, optimized responses and SQL guards recognize document16 while retaining
older compatibility paths. Account export/erasure use the existing private-job lifecycle.

## Verification

- Focused checks pass: 111 contract tests, 137 pure web-helper tests, 40 client/dialog tests,
  111 editor/renderer/history integration tests, 25 static-renderer tests, 66 database tests and
  32 provider/API tests. These are overlapping qualification groups, not an aggregate total.
  Contract, web, database and server typing and scoped ESLint also pass.
- **48 selected real PostgreSQL cases pass** on isolated PG17, including the existing shared,
  outline, creation, review, insights and spatial cases. Translation coverage exercises canonical
  source/target pairs, raw SQL column/immutability/proposal/hash guards, exact receipts after
  expiry/manual correction, unchanged proper-noun wording and multiple independently annotated
  nodes. Mixed document15 **and document16** sessions retain uppercase identities, scored/opinion
  response behavior and optimized acknowledgement snapshots. All 103 migrations apply twice,
  checksums of migrations001–102 match the base commit and all 65 legacy SQL rejection probes
  pass. Run `8e79510910` cleaned up its container, forward and lock without OOM; all fourteen
  original containers retained their states. Private result:
  `/tmp/pollingpops-e12-translation-pg/result-8e79510910.json`.
- **32 production-browser workflows pass** across Chromium/Firefox desktop and Chromium/WebKit
  mobile: 24 existing outline/creation/rewrite/recovery workflows plus eight translation cases.
  They use the same fresh final production web build, loopback provider and separate fresh
  memory APIs for each regression/translation batch. Existing authoring rates remain enabled;
  the split avoids sharing a five-minute actor burst budget across unrelated fixtures. CI
  mirrors that separation and retains each batch's reports, diagnostics and failure artifacts.
  Six CI-wiring tests and exact case collection across all four profiles pass.
  Translation checks cover explicit choice/no automatic jobs, complete review and exact prompt
  boundaries, proper nouns, one Undo/Redo edit, retained version floors, reload, independent
  title/body languages, unchanged publication/allowance accounting, lost creation/Apply replies,
  byte-identical retries and refusal after language-only source corrections. Axe and strict
  document overflow checks pass at 320px. Browser-spec strict TypeScript, ESLint and formatting
  pass; a final review capture was inspected. Private matrices:
  `/tmp/pollingpops-e12-translation-browser/translation-regressions-matrix-result.json` and
  `/tmp/pollingpops-e12-translation-browser/translation-languages-matrix-result.json`.
- **`VITEST_MAX_WORKERS=1 pnpm check` passes**, including formatting, Docker-context checks,
  lint, types, package tests, smoke support, production builds and the admin CLI build.
  Passing totals include **936 contracts, 578 database, 1,387 server, 2,830 web and 354
  smoke-support tests**. The contracts retain every prior lower-version gate, explicitly accept
  document16 and reject unknown document17. Normal opt-in PostgreSQL/Redis skips remain; the
  separate real PostgreSQL qualification is recorded above. The final check completed in
  371.5 seconds with normal file-creation permissions and a private mode600 log at
  `/tmp/pollingpops-e12-translation/full-check.log`. Owned browser/provider/API listeners and
  Firefox fixture directories are cleaned up.

## Rollout and remaining scope

See the [translation upgrade instructions](../runbooks/upgrade.md#selected-text-translation-and-document16).
All queue and document readers need the matching operation/language support before translation
admission or scene7/document16 writes. Re-enable admission only after the reader floor and active
editor refresh are complete. Retain matching readers and migrations for rollback once translated
jobs or content exist; do not strip language/provenance or rewrite immutable versions.

Hosted rollout, real-provider translation quality/cost, physical-device/manual accessibility and
measured creator acceptance remain separate from local software verification. Question
suggestions, rich-text translation, model-generated design, conversational editing, generated
media, RTL and self-paced attempts remain independently scoped work.
