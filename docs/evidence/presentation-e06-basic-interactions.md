# Presentation E06 basic interactions

Implementation branch: `codex/presentation-e06-basic-interactions`, based on merged E05
`e39ac10a366247026c32bb89e4549fa0059a973a` ([PR #197](https://github.com/riojung/pollingpops/pull/197)).
This is E06's planned broad-pilot slice: local reveal/hide panels and safe external links.
This basic software increment is complete and prepared for pull request review. It remains undeployed.
Richer E06 interactions remain separate.

## Behavior and compatibility

The native editor adds reveal panels and links with explicit labels, public audience text and
safe web destinations. Geometry, reading order, duplication, grouping, design, history and local
draft recovery preserve the new nodes. Invalid or rejected URL input stays in the current editor
with a correction message instead of entering autosave. Incomplete labels/body/URL can remain in
a draft but block publication. Scripts, arbitrary HTML, unknown fields and broadcast scope fail
validation.

Scene version 5 opts into Presentation document 11 without changing ordinary creation defaults,
retained JSON, immutable hashes, mutation envelopes or scoring. Migration 094 adds interaction
write guards for drafts/history/publications/live snapshots and admits existing opinion/text
responses in v11. It preserves response storage versions and moderation/receipt meanings. Earlier
native scenes and activities can coexist with the new nodes. Theme, image-fit, composition and
question import/launch actions preserve the document/scene version floor.

The shared renderer supplies native buttons and anchors, visible local-state and new-tab notices,
44-pixel minimum controls, focus indication and a readable outline in semantic order. Editor
previews remain inert. Audience reveal bodies are absent from the DOM until opened and are plain
text. The outline reuses the same controls instead of creating duplicate active disclosures.
Stage, participant, host and Companion state is independent; local interactions have no command,
response, model, scoring or report mutation. Replacement block/session/credential/scene/source
starts closed. Ordinary snapshots do not close a panel; a brief transient reconnect can preserve
local state. Page reload starts closed.

Reveal content is public audience data, not a confidentiality boundary or an assessment answer
policy. Private speaker notes, provenance and hidden slides retain their existing projection
rules. Companion renders the interaction scene using the existing accessible fallback for images;
this increment adds no new Companion media authorization endpoint.

The implementation reuses existing contracts, design tokens and client state. It adds no
dependency, AI provider, paid API, per-click job, storage record or subscription entitlement.
External links load only when the viewer chooses them. Measured operating cost and customer
subscription pricing remain product acceptance work, not claims established by these checks.

## Executed verification

- Focused API checks passed **31 tests** across native scenes, authoring and Companion published
  questions. Coverage includes exact retries, immutable v11 delivery/reporting, private-field
  exclusion, invalid actions and publication blockers, plus opinion/text imports and launches
  that retain the new version floor. The first integration run caught a test assuming a no-op
  save advanced the revision; the test now uses the returned revision.
- Focused authoring checks passed **100 tests** in six files, root deck/recovery checks passed
  **86 tests** in two files, and native design controls passed **12 tests**. Shared delivery,
  Companion and Unicode-link checks passed their targeted suites. These runs overlap; totals are
  not a distinct combined test count. Scoped ESLint, formatting and diff checks passed.
- Restricted PostgreSQL 17 run **`241c2be387` passed all seven selected cases**: v11 persistence,
  raw guards, mixed opinion/text responses, legacy guards, ordinary response concurrency and
  shared repository conformance. All **94 migrations and exact checksum-ledger checks passed
  twice**. The additional baseline verifier retained an immutable v9 hash and rejected 65 raw
  legacy mutations. The run took **14.8 seconds** including setup/cleanup. Runtime privileges and
  forced RLS were verified; the owned container/SSH forward were removed and all fourteen
  pre-existing containers retained their state, with no OOM. Tmpfs verifies correctness, not
  production fsync latency. Private results: `/tmp/pollingpops-e06-pg/result-241c2be387.json`
  and `migration-result-241c2be387.json`.
- Earlier owned PostgreSQL runs exposed helper-name ambiguity, a JSON/text SQL expression error
  and Unicode bound mismatch. These were fixed before the successful final run. New bounds match
  the installed validator's code-point limits while retaining existing explicit title/rich-text
  UTF-16 checks. Accepted URL shapes include IDN, IPv6, percent-encoded hosts, padded ports and
  query/fragment `@`; unsafe schemes and credential authorities fail. The renderer's Unicode URL
  bound has matching exact-limit and over-limit regressions.
- **Four production browser cases passed**, with zero failures/skips, across desktop Chromium
  and Firefox plus mobile Chromium and WebKit (**102.68 seconds** including production build).
  The real in-memory API and production web assets exercised authoring, unsafe URL feedback,
  reading order, duplication/reordering, reload, publication and stage/Companion/participant
  delivery. Keyboard actions, outline behavior, independent panels, private-field exclusion,
  no command/response mutations, unchanged live state, reduced motion, Axe and overflow checks
  passed. All four saved stage captures were inspected. Mobile participant/Companion checks use
  narrow viewports; saved captures are stage popups, not narrow participant captures. Owned
  Firefox data was removed, both task ports closed and actual `HOME` unchanged. Private result:
  `/tmp/pollingpops-e06-basic-browser-final-72d40ff68470/result.json`.
- Before the URL review follow-up below, **`VITEST_MAX_WORKERS=1 pnpm check` passed**, including formatting, Docker context checks,
  lint, all package typechecks/tests, smoke-support tests, production builds and the admin CLI.
  Principal totals: contracts **668**, database **519**, server **1,162**, web **2,446**, and
  smoke support **354**. Ordinary DB execution skipped 356 PostgreSQL-dependent tests; the
  selected real-PG coverage is recorded above. Server retained 15 existing skips and smoke
  support one. The initial repository run caught a legacy unknown-scene-version test still
  using newly supported scene5; its future-version case now uses scene6. Runtime code did not
  change for that correction, so the earlier browser/PG results still apply. Private final log:
  `/tmp/pollingpops-e06-check.log`; initial log: `/tmp/pollingpops-e06-check-initial.log`.

## Requested URL review follow-up

The requested review found that `https:///example.com` passed the existing editor/contract
policy but failed PostgreSQL autosave because the new SQL guard extracted an empty authority.
Related extra-slash and empty-user-info spellings had the same mismatch, including existing
rich-text links on slides upgraded from scene4 to scene5.

The SQL guard now ignores additional scheme-adjacent slashes and empty `@`/`:@` user-info markers
only in its temporary authority value. Original stored URL strings, existing contract semantics
and immutable hashes remain unchanged. Nonempty credentials, unsafe schemes, missing hosts,
controls, backslashes and out-of-range ports remain rejected.

New tests reproduced **18 failing PostgreSQL autosaves** before the fix: nine accepted URL
spellings through both new-link and old-rich-text upgrade paths. Final restricted PostgreSQL 17
run **`643752f0bb` passed 26/26 selected cases**: those eighteen complete save/retry/publication/
history/live-snapshot lifecycles, a thirty-variant unsafe-URL matrix and seven E06/legacy/
concurrency baselines. Exact original href text and earlier immutable content hashes are checked.
All **94 migrations and exact checksum checks passed twice**, with 65 additional raw legacy
rejections preserved. The run took **12.21 seconds** including setup/cleanup. The owned
container/SSH forward were removed, all fourteen pre-existing containers retained their state,
and no OOM occurred. Private results: `/tmp/pollingpops-e06-pg/result-643752f0bb.json` and
`migration-result-643752f0bb.json`.

The focused contract file passed **71 tests**, both contracts/database typechecks and scoped
ESLint passed, and formatting/diff checks passed. A final pre-PR
**`VITEST_MAX_WORKERS=1 pnpm check` passed after this fix**, including formatting, Docker context,
lint, all package typechecks/tests, smoke support, production builds and the admin CLI. Principal
totals: contracts **716**, database **519**, server **1,162**, web **2,446**, and smoke support
**354**. Ordinary DB execution skipped 375 PostgreSQL-dependent tests; the real-PG run above
exercises the added cases. Server retained 15 existing skips and smoke support one. Private log:
`/tmp/pollingpops-e06-pr-check.log`. The earlier browser runs were not repeated for this SQL/test
follow-up; UI code is unchanged.

## Rollout and acceptance boundary

Deploy migration 094 and matching document-v11 readers/writers/web assets before accepting new
interactions. See the [rollout and rollback instructions](../runbooks/upgrade.md#presentation-basic-interactions-compatibility).
No running local or hosted feature policy is changed by this source increment.

Labeled hotspots, detail dialogs/focus restoration, internal navigation, host-broadcast reveals,
answer-based branching and branch-target validation are later E06 increments. E07 durable nonlinear
navigation remains separate. This record does not claim hosted rollout, physical-device/manual
screen-reader/zoom acceptance, capacity qualification, subscription pricing or competitor parity.
