# Polling Pops localization implementation plan

## Outcome

Polling Pops will provide a localized facilitator workspace without changing the meaning of
user-authored Rounds, Presentations, responses, or evidence. The interface language is a user
preference, follows BCP 47 locale identifiers, persists across signed-in devices, and falls back
safely to Canadian English when a translation is unavailable.

The first supported set covers Polling Pops’ initial North American, European, and Asian markets:

- English (Canada) — `en-CA`
- French (France) — `fr-FR`
- German (Germany) — `de-DE`
- Spanish (Spain) — `es-ES`
- Italian (Italy) — `it-IT`
- Portuguese (Portugal) — `pt-PT`
- Japanese (Japan) — `ja-JP`
- Korean (South Korea) — `ko-KR`
- Chinese, Simplified — `zh-CN`
- Chinese, Traditional — `zh-TW`

Language names are shown in their own language so a user can recover from choosing an unfamiliar
locale. User-generated content is never translated automatically.

## Product rules

1. On authentication callbacks, the signed-in user's explicit account preference is copied to the
   web-origin cookie before the workspace renders. On a direct request, server rendering resolves
   the cookie, then browser `Accept-Language`, then `en-CA`; authenticated workspace bootstrap
   reconciles a stale or missing cookie with the account preference. Eliminating that possible
   direct-request first-paint mismatch requires a server-side account preload in Phase 2.
2. Selecting a language updates the current interface immediately, persists it to the account and
   a same-site cookie, and updates the document `lang` attribute.
3. Dates, times, counts, percentages, and list conjunctions use `Intl` with the active locale. Stored
   timestamps and API payloads remain locale-neutral ISO values.
4. Runtime catalog merging falls back per key to Canadian English, and a failed catalog chunk
   falls back as a unit. Shipping catalogs must pass full key and placeholder parity in CI, so the
   fallback is defensive rather than a substitute for translation coverage.
5. Polling Pops terminology such as Round, Presentation, Recovery Loop, diagnostic, intervention,
   and recheck follows the [localization glossary](./localization-glossary.md).
6. Layouts must tolerate at least 40% text expansion, CJK line breaking, keyboard-only operation,
   zoom, and reduced motion. No UI meaning may depend on colour or translated text length.
7. Locale choice is independent from workspace, content language, time zone, and colour mode.

## Delivery sequence

### First delivery slice implemented with this plan

- Ten-locale shared contract, locale matching, and `Accept-Language` negotiation.
- Lazy typed catalogs with Canadian-English fallback and placeholder-parity tests.
- Locale-aware date, number, list, and plural-rule helpers.
- Persisted user preference with an explicit-preference marker so a new account inherits the
  browser or existing locale cookie instead of being reset to the database default.
- A web-origin redirect bridge so users completing a supported authentication callback receive
  their account locale before the first rendered workspace page, including deployments where API
  and web use different hosts.
- Accessible global language selection with native language names, keyboard radio behaviour,
  cached rollback, and non-blocking catalog-load errors.
- A visible Preview label on every non-English locale until it passes the production linguistic
  gate.
- Explicit page-region language boundaries so partially migrated English content remains correctly
  pronounced by assistive technology while localized workspace chrome uses the selected locale.
- Localized workspace navigation, Create menu, appearance controls, page introductions, Home
  entry experience, Round and Presentation launchers, and starter metadata.
- Unit, API, repository, and SSR coverage for negotiation, catalog completeness, persistence,
  language boundaries, and localized rendering, plus a desktop browser flow for selection and
  reload. Automated keyboard interaction, failure rollback, CJK/mobile accessibility, and
  multi-workspace preference scenarios remain explicit follow-up coverage below.

The included translations are an implementation seed and beta-quality preview. They must pass the
professional linguistic and in-context review gate in Phase 3 before a locale is marketed as fully
localized. English-only surfaces remain tracked work in Phases 2 and 3.

### Phase 1 — foundation and professional workspace

- Define the supported-locale contract and validation shared by web and server.
- Persist account locale through the existing `users.locale` column and a narrow authenticated
  preferences endpoint.
- Resolve the initial locale on the server without an English hydration flash.
- Add a typed, lazy-loaded message catalog with interpolation and English per-key fallback.
- Add locale-aware date and number helpers.
- Add an accessible language selector to the global workspace header.
- Localize global navigation, Create menu, appearance controls, account actions, loading states,
  workspace page headings, and the Home entry experience.
- Cover locale matching, fallback, persistence, HTML language, selector accessibility, and the
  translated workspace shell with unit and browser tests.

### Phase 2 — complete facilitator and delivery workflows

- Migrate Library controls and empty states; Sessions, Assignments, Results, Discover, Groups, and
  Workspace settings content.
- Migrate Round and Presentation launchers, builders, validation/readiness messages, Preview,
  Publish, and recovery/conflict dialogs.
- Localize host, participant, practice, reports, transactional errors, and accountless join flows.
- Replace remaining fixed `en-CA` formatters with the shared locale formatter.
- Add localized notification and email templates while retaining stable machine-readable error
  codes.
- Preload an authenticated account locale during server rendering so a direct visit with a stale
  locale cookie cannot briefly render the stale language.

### Phase 3 — translation operations and expansion

Implemented preparation: `pnpm localization:review` exports deterministic bilingual
editorial packets and checks separately recorded decisions against current HEAD, bound
source files and canonical content. The bounded inventory covers creation/practice copy,
all Presentation/Round starter content, Survey projections and default/scaffold examples.
See the [native-language review workflow](evidence/native-language-review.md). This does
not implement catalog import, professional review or locale production approval.

- Export/import catalogs in a translator-friendly format and enrich the existing glossary with
  per-message context notes.
- Add pseudo-locales for expansion and bidirectional layout testing before introducing Arabic or
  Hebrew.
- Require professional linguistic review and in-context QA before marking a locale production
  complete.
- Add a per-locale readiness gate; remove the Preview label and market a locale only after that
  locale clears linguistic, accessibility, support, and legal review.
- Add catalog coverage dashboards, missing-key telemetry without user content, and release gates
  for changed English source messages.
- Add regional variants only where wording or formatting materially differs.

## Engineering boundaries

- Locale identifiers and the preference mutation are public contracts; unsupported values return a
  validation error.
- Storage distinguishes an inherited/default locale from an explicit account preference. The first
  signed-in workspace visit promotes the resolved cookie/browser locale to the account; subsequent
  explicit account choices take precedence on every device.
- Catalogs contain interface copy only. API records, authored content, titles, answers, citations,
  and participant input remain unchanged.
- The default URL structure remains stable during Phase 1 because this is an authenticated product
  workspace, not an SEO locale rollout. Locale-prefixed public marketing routes can be evaluated
  separately.
- The browser must not derive authorization, scoring, validation, or Recovery Loop behavior from a
  translated label. All logic continues using stable IDs and enums.
- Translation loading failures preserve the last usable catalog and expose a recoverable status to
  the user.

## Acceptance criteria

### First delivery slice

- A user can switch among every supported language from migrated workspace-shell destinations
  without signing out or losing in-progress work. Builder command bars join this acceptance scope
  when builder localization ships in Phase 2.
- The chosen locale survives reload and a new authenticated session. A fresh authentication
  callback applies the account locale before rendering; a direct visit with a stale cookie is
  reconciled during authenticated workspace bootstrap.
- The initial document has the correct `lang` value and does not render raw message keys.
- Unsupported or malformed locale input cannot be persisted.
- Every selectable preview locale contains the complete Phase 1 catalog with placeholder parity;
  runtime fallback protects against chunk failure or a future partial catalog.
- English behavior and API compatibility remain unchanged.
- Keyboard and screen-reader users can discover, open, change, and confirm the language selector.
- Date and number tests demonstrate different English, German, French, and Japanese output.

### Production locale gate

- Keyboard automation covers Arrow keys, Home, End, Escape, focus restoration, persistence
  failure rollback, and catalog-load failure.
- Workspace pages pass automated accessibility checks in at least one Latin-script and one CJK
  locale at desktop and mobile widths.
- One user retains one locale while switching among workspaces and roles; another user's preference
  remains isolated.
- Professional linguistic and in-context review is complete for the locale, and support/legal copy
  has an approved fallback or translation.
