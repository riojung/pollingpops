# Native-language review preparation

This workflow prepares source-bound editorial packets for the ten configured locales.
It records no acceptance automatically. English is reference material; other languages
retain their Preview status until the existing production locale gate is satisfied.

## Prepare a candidate

From the repository root, choose the exact current HEAD and a fresh output directory:

```sh
git rev-parse HEAD
pnpm localization:review export --locale ko-KR --source-ref FULL_CURRENT_HEAD --out artifacts/localization-review/CANDIDATE/ko-KR
```

Repeat for `en-CA`, `fr-FR`, `de-DE`, `es-ES`, `it-IT`, `pt-PT`, `ja-JP`, `ko-KR`,
`zh-CN` and `zh-TW`. The command requires the actual current 40-character HEAD. The
packet also hashes the relevant working source files and canonical generated content,
so an uncommitted source change cannot silently reuse an earlier decision. Freeze the
candidate before collecting decisions; after a bound source or HEAD change, export to
a new directory and preserve earlier records. Export refuses an existing `decisions.json`.
Generated packets are ignored build artifacts and excluded from repository formatting.

Each locale receives:

- `review.html`: complete, expanded English/target pairs with field paths, context,
  source helpers and hashes. Use browser Find; no script, form or external resource is
  needed. Text is escaped, including synthetic HTML and substitution-token examples.
- `bundle.json`: deterministic canonical content and source binding.
- `decisions.json`: a separate human-owned record, initially entirely pending.

The current scope has **374 entries per locale**: all 21 Presentation template definitions
and generated drafts, all 36 Round starters and 17 Survey-compatible projections, typed
creation/practice interface inventories, and action-created default/scaffold examples.
This is a bounded review inventory, not a claim that every product message is included.
It contains repository copy and synthetic authored examples, not customer records.

## Record and check decisions

Read the [localization glossary](../localization-glossary.md), then review the wording
and its context. In each decision entry, preserve its item ID and content hashes. Record
`accepted` or `needs-change`, a meaningful `reviewerReference`, and `reviewedAt` as an
ISO UTC timestamp with milliseconds. A change request requires an `issue`; an accepted
entry must have no unresolved issue. `evidenceReference` can identify the associated
in-context review evidence. Pending entries retain empty reviewer/time/evidence fields.
Do not have an assistant invent reviewer identities, decisions or observation results.

```sh
pnpm localization:review check --bundle artifacts/localization-review/CANDIDATE/ko-KR/bundle.json --decisions artifacts/localization-review/CANDIDATE/ko-KR/decisions.json
```

The checker rebuilds the current canonical packet before accepting its binding:

| Exit | Meaning                                                                            |
| ---- | ---------------------------------------------------------------------------------- |
| `0`  | Every entry has a well-formed recorded acceptance; English remains reference-only. |
| `2`  | Valid record with pending or needs-change entries.                                 |
| `1`  | Malformed, duplicate, stale or mismatched records/source.                          |

An exit of zero validates record consistency. It cannot establish reviewer identity,
native-language quality, accessibility, support/legal approval or release readiness.
The command does not import copy into the product, remove Preview labels or update the
release ledger. Corrections to canonical copy remain reviewed code changes followed by
a new source-bound packet. In-context review still covers complete flows, error/retry
states, dates/numbers, long labels and assistive-technology pronunciation. Use the
[production locale criteria](../localization-implementation-plan.md#production-locale-gate)
and the existing human evidence records for actual acceptance.
