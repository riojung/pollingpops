# Reviewed local question starters

Branch: `codex/presentation-question-starters`, from merged translation baseline
`a9b6602aedf1450e3f4d2e1978e28ae850b3cb30` (PR #208). This bounded E12 authoring increment remains
undeployed. It is independent of the layout work in PR #207.

## Creator workflow and useful scope

Choose **Question starters** on a visible native slide with a nonblank title and body text.
Review one of three local templates: **Discussion** (open text), **Clarity rating** (1–5) and,
when eligible, **Priority poll** using the complete authored body points. Read the complete
question, options/settings and private source context, then **Insert reviewed question** or
**Cancel**. Insertion creates an editable independent question immediately after the source.
It inherits the source section, receives a spatial frame when needed and creates one ordinary
Undo step through the normal autosave/recovery flow. Focus moves to the new question prompt.

These are English template prompts quoting the author's wording, not AI comprehension or quiz
generation. All starters are opinions with confidence off, zero points, no correct choices and
no linked recheck. The unchanged **Add question** workflow remains available. Starters use no
provider, job, AI allowance, new service, dependency, entitlement, migration or persisted version.
Source-grounded AI questions remain separately planned E12 scope.

Source context uses only native title/body text in reading order, including visible rich-text
wording and declared language. It does not inspect images, table/chart data, shapes, URLs behind
links or closed interaction details. Literal authored text stays literal; no URL is opened.
The current bound is one title and up to eight nonblank body objects with at most 4,000 total
body characters. Classic slides and hidden or incomplete sources are not supported in this slice.

Priority polls require all 2–6 distinct complete body points, each at most 180 characters. Empty
separators are ignored; options are never truncated or silently selected from a longer list.
Oversized, duplicate or otherwise unsuitable lists retain discussion and clarity starters.
Creators can edit an inserted question using the existing controls.

## Source identity, privacy and preservation

Review binds exact visible text, node identities, per-node languages, list structure and reading
order, plus source block identity. Source edits, hiding/removal, selection changes, permission
loss and mutation barriers invalidate application. Geometry/style and private-note changes do
not invalidate an unchanged text source. The UI rejects stale radio/Insert events and preserves
queued selections across intermediate renders. The builder checks current actor/target/barriers
and revalidates the complete insertion both before and inside the ordinary commit. IDs are
allocated once per attempt, so React updater replay cannot create different questions.

Existing blocks, notes, citations, source disclosure, latest AI-edit metadata, IDs, language,
design and published versions retain their state. Section membership follows the exact source;
existing spatial frames stay intact. Normal document validation rejects duplicate IDs, more
than 200 blocks, more than 10 text questions or the existing 3MiB document limit before a new
history/recovery entry. There is no second save or receipt path.

The new question stores private source citation chunks and a truthful `local / question-starters-v1`
disclosure, with an exact SHA256 digest of its reviewed text projection and node/language notes.
Citation chunking preserves Unicode surrogate pairs. This is copied attribution, not a live
source link or independent verification. Original import/AI provider identities are not reused
as the producer of a local template, and Round-only provenance is not fabricated. Participant,
private-review and static-export projections omit this private context while retaining the
public question and options. Later source edits do not silently rewrite the independent question.

An additive contracts utility hashes exact UTF8 source fingerprints without trimming or borrowing
another workflow's text-length policy. Existing contracts, canonical hashes, schemas and content
versions retain their behavior.

## Verification

Focused engine, UI, builder integration and source-projection privacy checks pass. The combined
web qualification has 95 passing tests across four files; contracts qualification has 18 passing
tests across three files. These overlap the full-suite totals below. Engine checks
include full 4,000-character source review, exact copied points, language/identity/order fences,
frame-only changes, source preservation, sections/spatial placement and limit/budget refusal.
Six server privacy cases cover poll/open-text/rating starters across documents10/16 and the
participant, private-review and PDF/PNG/HTML export boundaries.

**18 production-browser workflows pass** across Chromium/Firefox desktop and Chromium/WebKit
mobile (5/5/4/4). Eight new starter workflows cover Cancel/no write, complete source/language
review, all three editable question formats, full-list refusal, insertion focus/modal cleanup,
exact source/section/spatial preservation, one Undo/Redo step, reload, unchanged publication and
allowance, no assistance jobs, live participant response and unscored report evidence. Ten
existing design/arrangement/spatial workflows also pass. These use the final fresh production
bundle and fresh memory APIs, with AI disabled and existing rate limits retained. Axe checks and
strict horizontal-overflow checks pass at 320px. Desktop and narrow review captures were
visually inspected. Browser strict TypeScript, lint and formatting pass. The normal beta CI
suite discovers the new spec. Private matrix: `/tmp/pollingpops-question-starters-browser/final-result.json`.

**`VITEST_MAX_WORKERS=1 pnpm check` passes** in 406.9 seconds, including formatting,
Docker-context checks, lint, types, all package/support tests, production builds and the admin
CLI build. Passing totals include **938 contracts, 578 database, 1,393 server, 2,878 web and 354
repository-support tests**. Normal opt-in database/Redis skips remain. No database runtime,
schema, migration or persistent version changes require a new PostgreSQL qualification for
this increment. Private mode600 log: `/tmp/pollingpops-question-starters/full-check.log`.
Owned browser/API listeners and Firefox fixture directories have been cleaned up.

AI question generation, hosted rollout, physical-device/manual accessibility and measured
creator task acceptance remain separate from this local implementation.
