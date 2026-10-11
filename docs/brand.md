# Polling Pops brand and interface

Polling Pops is the public product name from October 7, 2026. It brings live polls,
interactive presentations, learning rounds, audience conversation, and recovery evidence
into one facilitator workspace. The tagline is **Make every voice pop.**

## Identity

The original lollipop mark combines a circular candy, a stick, and three rising poll bars.
The bars connect the playful identity to participation and evidence. Cream and yellow
strokes suggest candy ribbons; the small mint rays suggest an idea arriving.

The artwork is original repository SVG geometry. It uses no competitor logo, lettering,
flower badge, wrapper, illustration, or trademark. Project-created artwork is Apache-2.0.
See the [asset register](asset-register.md) for distribution details.

| Color         | Value     | Use                                                    |
| ------------- | --------- | ------------------------------------------------------ |
| Berry         | `#AC2855` | Limited brand accents; not an application surface wash |
| Pink          | `#F9688A` | Candy artwork and decorative accents                   |
| Cream         | `#FFF8EF` | Candy artwork and versioned Candy Pop experience       |
| Mint          | `#D8EEE3` | Decorative backgrounds                                 |
| Mint ink      | `#146552` | Readable mint controls and focus outlines              |
| Butter yellow | `#FFC857` | Decorations; never white-text buttons                  |
| Plum          | `#39243C` | Logo outline and original experience artwork           |

### Neutral interface palette

The application uses a neutral-first palette: the logo carries the candy colors, while
working surfaces, forms, secondary controls, and borders stay quiet. Mint connects
selected navigation, recommendations, links, and focus states to the logo's idea rays.
Primary actions are graphite in light mode and near-white in dark mode, not pink.

| Semantic use       | Light mode | Dark mode |
| ------------------ | ---------- | --------- |
| Canvas             | `#F6F7F9`  | `#16191E` |
| Surface            | `#FFFFFF`  | `#20242B` |
| Soft surface       | `#F1F3F5`  | `#262B33` |
| Strong text        | `#242931`  | `#F6F7F9` |
| Primary action     | `#262B33`  | `#EDF0F4` |
| Selection fill     | `#E6F2EC`  | `#253B34` |
| Selection/link ink | `#146552`  | `#B9EACE` |
| Focus outline      | `#146552`  | `#9CDEBC` |

Use shared `--ui-*` tokens rather than literal colors in components. Global and workspace
canvases have no decorative gradient; hero/brand artwork may use restrained pink, mint,
or yellow details. Controls use modest rounded corners and soft shadows rather than
raised candy-button edges. Status colors retain their meaning. Rounded display type is
reserved for the wordmark and landing headline; editing controls and data retain the
readable system font stack. Automated checks cover text, actions, selections, statuses,
focus outlines, and input boundaries in both modes, with browser axe and keyboard checks
on desktop and phone templates.

This interface update does not rewrite versioned experience presets or frozen live
session themes. Explicit Candy Pop and other preset selections keep their authored
colors; participant high-contrast and reduced-motion preferences still take precedence.

## Assets

The source assets are in `apps/web/public/brand`:

- `polling-pops-mark.svg`: transparent standalone lollipop.
- `polling-pops-icon.svg`: cream-backed browser icon.
- `polling-pops-logo.svg` and `.png`: horizontal logo on a transparent background.
- `polling-pops-apple.png`: 180-pixel home-screen icon.
- `polling-pops-social.svg` and `.png`: 1200×630 share card.

Run `pnpm brand:assets` to regenerate the PNGs from their SVG masters. Display the
wordmark on a light surface; use the icon on a dark surface. The in-product `Brand`
component renders a decorative inline mark and one accessible product name. Workspace
organization branding keeps its organization name and initials.

## Experience rules

Candy Pop is the new signature preset (`pops`, version 1). New blank Rounds and
Presentations select it. General-category recommendations point to Candy Pop. Its motion
is calm and sound is off. All six earlier presets remain available with their original
versioned tokens; existing authored selections and frozen session themes are preserved.

Decorations surround the question rather than covering prompts, answers, codes, timers,
or reports. No new animation or sound is required. Reduced-motion, high-contrast,
keyboard, and screen-reader controls continue to take precedence over decorations.

The Recovery Loop remains Ask → Diagnose → Intervene → Recheck → Prove. Product nouns
such as Round, Presentation, Assignment, Recovery Pack, and Results retain their meaning.

## Compatibility and rollout

This is a public identity update. Existing `@openround/*` packages, environment variables,
cookies, browser resume keys, database names, migration checksums, API paths, export
format discriminators, QTI extension keys, metrics, and registry image locations
remain compatible. Download filenames use `polling-pops-`; native JSON still accepts and
emits the established `openround` format identifiers. Do not bulk-rename those identifiers.

Deploy the web and server images from the same release. Candy Pop adds the `pops` preset
identifier, which older clients and servers do not know. Refresh clients during promotion;
older images must not serve newly created Candy Pop content during a mixed-version rollout.

The original copyright attribution is preserved in LICENSE and NOTICE. SMTP sender
display names configured by an operator override the new default; update EMAIL_FROM
when promoting an existing deployment. The canonical GitHub repository is now
`riojung/pollingpops`, and new clones use the `pollingpops` directory. Repository links,
operator API calls, and new workflow signing identities use that name. Previously signed
release records keep their original identities; verification accepts only the explicitly
trusted old/new repository pair. Registry image paths and DNS are separate operator changes.
See the [repository rename guide](runbooks/repository-rename.md) for preserved identifiers,
checkout moves, and existing deployment roots.

Local Compose application image tags are `polling-pops-server:development` and
`polling-pops-web:development`. The Compose project name remains `openround` to preserve
existing named volumes, databases, and media. Do not rename or delete the data namespace
merely to match the public name. Service bundles remain `core`, `media`, and `observability`.
Rebuild the local app images once before using `--no-build`; a missing Docker socket instead
requires starting or selecting the existing runtime. The service wrapper supports
`--docker-context NAME` without changing the global Docker context. See the
[deployment runbook](runbooks/deployment.md#docker-readiness-and-the-polling-pops-rebrand).

Set `OPENROUND_PUBLIC_URL` on the web process to the public product origin so social-card
URLs point to the deployed site. Local Compose supplies this automatically. The fallback
origin is localhost and is intended only for development, not public sharing.

Help now uses fresh Polling Pops quick-start and user-guide videos, recorded from isolated
synthetic workspaces. Each includes conversational English neural narration, matching
captions, a transcript, and chapter shortcuts. The quick start covers the enabled Round
Builder; the longer guide is shown only when its advanced capabilities are available.
Older `openround-*` media URLs remain for compatibility and retain their original captions.
Recording and rendering commands, provenance, and narration terms are in the asset register.
