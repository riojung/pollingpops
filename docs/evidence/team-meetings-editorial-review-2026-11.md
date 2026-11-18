# Team meetings collection: editorial and verification record

Record: **WX-04 / team-meetings / 2026-11**. Implementation branch:
`codex/team-meeting-collection`, based on `edac7b6` after Library discovery merged in PR #272.

Reviewer/reference: **Codex, automated implementation and content review**. This identifies
the actual review performed during implementation. Human editorial acceptance, native-language
acceptance and observed customer usability remain **pending**; no person or acceptance is inferred.

## Selected originals

These five existing templates are alternatives for a customer job, not a mandatory sequence.
All activities collect opinions without correctness, points or diagnostic concept claims.

| Format       | Existing ID          | Content                                     | Planning time                                        | Intended use and follow-up                                                                                                              |
| ------------ | -------------------- | ------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Round        | `meeting-priorities` | 4 questions                                 | 8 minutes                                            | Focus one real discussion; record the decision, owner, deadline and update location.                                                    |
| Round        | `team-retrospective` | 4 questions                                 | 12 minutes                                           | Review one completed work cycle; choose a small experiment, owner, observable signal and review date.                                   |
| Presentation | `meeting`            | 5 slides, including 2 audience activities   | 20 minutes                                           | Work through options and constraints with colleagues who can make the decision; send the decision/action record within one working day. |
| Presentation | `retrospective`      | 6 slides, including 3 audience activities   | 25 minutes                                           | Discuss observations without blame; record and revisit one bounded experiment.                                                          |
| Survey       | `team-collaboration` | 4 items, including an optional context item | 3 minutes answering; allow 10 minutes for discussion | Ask people who recently shared work about handoffs and context; discuss patterns and report back on one improvement.                    |

Durations and audience guidance are authored planning estimates, not measured completion times.
An opinion distribution or clarity rating does not prove agreement, identify a cause or establish
that an experiment worked. Guides explicitly separate observations from possible explanations.

## Content and provenance checks

- Reuse stable catalog IDs and the existing independent-copy factories. Source definitions and
  already stored drafts, published versions, rooms and results are separate; catalog updates apply
  to future template instantiation only.
- Expand the two short Rounds to four purposeful prompts each. Retain neutral options for no
  change or insufficient experience. Keep the collaboration Survey at four items and allow the
  context item to be skipped. The retrospective Presentation offers a neutral friction choice.
- Keep preparation, facilitation, interpretation and follow-up visible in the existing preview
  guide. The two Presentation guides supplement their existing slide notes.
- Copy is original Polling Pops material. No competitor templates, images, audio, fonts or other
  assets were added; no new dependency or asset licence is required. The existing
  [benchmark](../workspace-experience-benchmark-2026-11.md) informed the workflow, not the wording.
- Displayed counts come from the current filtered catalog and actual generated content. The full
  catalogs remain 36 Round originals, 21 Presentation originals and six displayed curated Survey
  cards; 17 existing IDs remain compatible with Survey projection.

## Language review and source binding

English content received automated code/content review in this implementation. **Human editorial
review is pending for English and every translation.** Available translations are seed content,
and existing non-English Preview labels remain unchanged.

| Language | Human editorial/native-language acceptance                       |
| -------- | ---------------------------------------------------------------- |
| en-CA    | Pending human editorial review; English packet is reference-only |
| fr-FR    | Pending                                                          |
| de-DE    | Pending                                                          |
| es-ES    | Pending                                                          |
| it-IT    | Pending                                                          |
| pt-PT    | Pending                                                          |
| ja-JP    | Pending                                                          |
| ko-KR    | Pending                                                          |
| zh-CN    | Pending                                                          |
| zh-TW    | Pending                                                          |

The [existing review workflow](native-language-review.md) exports complete bilingual content and
hashes of current source files against the exact candidate HEAD. New review items include all
collection interface copy, the five stable memberships and both complete Presentation guides.
Existing Round/Survey entries include updated prompts, guides, introductions and item requirements.
All generated decisions start pending. Preserve earlier packets; re-export after any bound source
or HEAD change rather than reusing earlier decisions.

Bound sources include `apps/server/src/starter-meeting-collection.ts`,
`apps/server/src/starter-meeting-copy.ts`, the existing starter factories,
`apps/web/lib/template-collections.ts`, `apps/web/lib/i18n/template-collection-copy.ts`,
the existing Presentation definitions and their nine translation catalogs. The packet generator
follows transitive imports and records exact file/content hashes.

Worktree preparation produced ten fresh packets under
`artifacts/localization-review/wx04-team-meetings-edac7b6-20261118T044500Z`, each with **625 items**
and every decision pending. Candidate HEAD is `edac7b6cfe0c9062383ceed4cf465b38d45239f9`;
the source-file binding is
`sha256:b0fc097f7f29a3f9704dda9ec8df2bb5bfbec7ae4420684607d1febfb560b49b`.
The Korean packet passed source/record validation with expected exit2 (valid pending decisions).
These are ignored local preparation artifacts, not committed acceptance. Re-export from the
final committed candidate before collecting actual reviewer decisions.

## Verification

- Server content: **63 tests** across five starter suites, including **32 new tests** for all ten
  creation languages. Existing English content digest and Survey introduction assertions were
  updated for the intentional content changes. Server TypeScript, scoped lint and formatting pass.
- Web integration: **76 component/route tests** and **89 metadata/Presentation locale tests** pass.
  Web TypeScript, browser-test strict TypeScript and focused lint pass.
- Localization: **33 workflow tests** and the script's strict TypeScript check pass. The new guide
  words and collection selection are visible in the source-bound bilingual inventory; no decision
  is accepted automatically.
- Browser: **10 executions** pass across desktop Chromium, mobile Chromium and mobile WebKit.
  Real APIs verify read-only previews, exact membership/counts, independent editable copies and
  source immutability; viewer/paused-feature behavior, URL/history/reload and Korean content are
  covered. Scoped Axe audits retain contrast checks in light/dark/forced-colors at desktop and
  390px/320px mobile widths. Representative screenshots were visually inspected for wrapping,
  clipping and preview/guide navigation.
- Collection copy lifecycle: changing the collection resets browsing filters while preserving
  stable gallery ownership, pending-copy guards, response navigation, errors and exact retry bodies.
  Regression tests reproduce the former Survey duplicate-copy risk before the fix. **Nine new
  browser executions** pass across desktop Chromium and mobile Chromium/WebKit, checking held
  successful responses and lost acknowledgements against real APIs. Survey retries reuse the
  original idempotency body; Presentation retries reuse the original draft and save mutation.
  Existing actor/workspace/language/authority invalidation remains covered by the gallery tests.
  The reporting reviewer verified the correction with no remaining actionable issue. Web lint,
  TypeScript and the production build also pass after this fix.
  Generated Next.js environment paths from browser verification are excluded from the feature.
- The final `VITEST_MAX_WORKERS=1 pnpm check` passed after the collection-lifecycle correction:
  formatting, Docker-context validation,
  repository lint/TypeScript, all configured test tasks, production builds and compiled server
  startup/configuration smoke. This includes **489 web files / 5,913 tests**, **1,636 server tests**
  and **523 smoke-support tests**. Environment-dependent skips retain their existing policy.
  An earlier implementation run hit a five-second timeout in an existing synthetic release-signature operations
  test. It passed in isolation and the complete gate passed on retry with its original timeout
  and assertions; no unrelated test or release-operation code was changed.

Automated checks do not establish professional linguistic approval, physical-device accessibility
or observed customer outcomes.
