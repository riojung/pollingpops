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
  source helpers and hashes. **Review by template collection** links directly to the WX-04
  material. Browser Find works across the full packet. Text is escaped, including
  synthetic HTML and substitution-token examples.
- `bundle.json`: deterministic canonical content and source binding.
- `decisions.json`: a separate human-owned record, initially entirely pending.

The current scope has **804 entries per locale**: all 21 Presentation template definitions
and generated drafts, all 36 Round starters and 17 Survey-compatible projections, typed
creation/practice/report/insights interface inventories, and action-created default/scaffold examples.
This includes 54 creation-method, navigation and Survey interface phrases covering inputs,
assistance, explicit draft creation and the existing editor’s visual-import guidance.
It also includes 37 exact structured-import preview, explicit-creation and confirmation-recovery
phrases, with one review item for each displayed string from `importPreviewCopy`.
Thirteen Round starter-copy phrases cover durable retries, browser-storage recovery,
explicit renewal, conflicts and opening a confirmed copy, with one item per `starterCopyCopy` string.
Twenty-three Survey page-reader phrases cover progress, navigation, required-field validation,
safe save/retry, resume, closure and read-only creator previews, with one item per
`surveyPagesCopy` string. Another 34 `surveyPageAuthoringCopy` strings cover page organization,
question movement, confirmation, publishing validation and capability/view-only states.
Conditional paths remain a subsequent checkpoint.
Team meetings, Training and onboarding, Workshops, and Event feedback each add five memberships and two
complete Presentation guides, with all collection labels and descriptions in the interface inventory.
Existing Round and Survey entries include authored content, owner guides and item requirements.
See the [Team meetings editorial record](team-meetings-editorial-review-2026-11.md), the
[Training and onboarding editorial record](training-onboarding-editorial-review-2026-11.md),
[Workshops editorial record](workshops-editorial-review-2026-11.md), and
[Event feedback editorial record](event-feedback-editorial-review-2026-11.md).
This is a bounded review inventory, not a claim that every product message is included.
It contains repository copy and synthetic authored examples, not customer records.

## Review the four template collections

Use **Review by template collection** to jump to each collection's title, description and
membership. The index covers 20 format-qualified templates and links to 62 existing review
entries. Round links open the preview and facilitator guide or the generated draft.
Presentation links open the template definition, generated draft or facilitator guide.
Survey links open the Survey context and guide or the shared Round questions. Event
experience has separate Round and Survey entries with independent guides.

Each link's accessible name includes its collection or format-qualified template. After
reviewing an entry, use its **Back to** link to resume at the named collection or template
heading. Shared entries offer a return link for each template that references them. Record
decisions against the existing item IDs in `decisions.json`. The index opens the same articles
and decision entries used by the complete packet.

### Check one collection's progress

After recording decisions, inspect the selected collection without changing either input file:

```sh
pnpm --silent run localization:review collection-status \
  --bundle artifacts/localization-review/CANDIDATE/ko-KR/bundle.json \
  --decisions artifacts/localization-review/CANDIDATE/ko-KR/decisions.json \
  --collection event-feedback
```

The supported slugs are `team-meetings`, `training-onboarding`, `workshops` and
`event-feedback`. The command validates the full packet against current sources and checks
every decision, including entries outside the selected collection.

The JSON report identifies the locale, collection and source-bound bundle. It counts accepted
entries, pending entries and change requests. Each unresolved entry includes its item ID, context,
decision, issue and `reviewFragment`. Append that fragment to the original packet's `review.html`
path to open the review article.

Each collection includes the three shared selector labels. Event feedback has **17 entries**
because its Round and Survey share the Event experience draft. The other collections each have
**18 entries**.

`fullPacketComplete` reflects recorded decisions across the whole packet. `referenceOnly`
identifies English reference material and `nativeAcceptance` is always `false`.
Human editorial and native-language acceptance still require the existing review process.

| Exit | Meaning                                                                                |
| ---- | -------------------------------------------------------------------------------------- |
| `0`  | Valid collection progress report, including pending or needs-change entries.           |
| `1`  | Invalid collection, malformed decisions, or stale/mismatched packet or source binding. |

Use the full-packet `check` command below for a completion exit code.

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
