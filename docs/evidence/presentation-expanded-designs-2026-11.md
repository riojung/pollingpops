# Expanded presentation design collection

Research and original implementation brief, November 13, 2026.

The existing eight collections form the starting point. This expansion adds 22 visual
systems and 176 coordinated native layouts, bringing the library to 30 collections and 240
layouts. Content templates remain a separate starting point.

## Additional public examples inspected

The [Canva presentation gallery](https://www.canva.com/presentations/templates/) was reopened.
The eight additional detail pages below were inspected visually at full size: their cover and
page 3, including the selected page indicator. The workshop and introduction examples expose
playback controls; this review inspected their static previews and does not claim motion parity.
These selections establish breadth and composition patterns, not a verified popularity ranking.

| Public example                                                                                                                                   | Observed design pattern                                                                                                            | Useful product lesson                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [Blue and white company profile](https://www.canva.com/templates/EAFbWcD5qZQ-blue-white-company-profile-presentation/)                           | Centered capitals, blue endcaps and a bright field; the interior uses a strong side panel and three numbered service explanations. | Carry a visual motif into structured business interiors.                              |
| [Green monochromatic minimalist](https://www.canva.com/templates/EAFDFO9krR4-green-monochromatic-simple-the-minimalist-presentation-template/)   | Centered serif hierarchy and a subdued footer band; the interior pairs a narrow reading column with a large photograph.            | Offer calm, restrained systems alongside bold designs.                                |
| [Autumn leaves](https://www.canva.com/templates/EAHVPPxlHLk-orange-brown-and-beige-autumn-leaves-presentation/)                                  | Seasonal illustration around the perimeter; an interior keeps a central reading area inside an organic panel.                      | Keep expressive decoration outside the content region.                                |
| [Doodle self-introduction](https://www.canva.com/templates/EAFL13ir2Kw-y2k-doodle-self-introduction-basic-presentation/)                         | A patterned surround and informal central card; the interior becomes a spacious notebook-style quotation.                          | Learning and personal presentations benefit from a distinct, friendly visual grammar. |
| [Resume-writing workshop](https://www.canva.com/templates/EAErRXanZpg-green-and-gray-bold-resume-writing-workshop-webinar-keynote-presentation/) | Bold white headings on teal, geometric constructions and speaker metadata; the interior frames an audience activity.               | Workshop sets should coordinate explanatory and activity-oriented compositions.       |
| [White, blue and grey startup pitch](https://www.canva.com/templates/EAGqwpf_JeA-white-blue-and-grey-modern-startup-pitch-deck-presentation/)    | Oversized lower-left typography beneath a small masthead; an interior pairs a photographic band with a dark two-column panel.      | Vary scale and arrangement while retaining a recognizable system.                     |
| [Pink and purple creative presentation](https://www.canva.com/templates/EAHBzO_jqHI-pink-and-purple-gradient-modern-creative-presentation/)      | A warm textured color field; the interior places a pale inset panel around a reading column and three numbered blocks.             | Creative systems need practical information layouts beyond an attractive cover.       |
| [Beige cream brand proposal](https://www.canva.com/templates/EAFIcQySh5E-minimalist-beige-cream-brand-proposal-presentation/)                    | Generous white space, a small central photograph and serif title; the interior uses a restrained photo/text split.                 | Include quieter brand and client-presentation options.                                |

## Original collection briefs

| Collection | Presentation need          | Original visual system                                                             |
| ---------- | -------------------------- | ---------------------------------------------------------------------------------- |
| Atlas      | Business strategy          | Map-like axes, quadrant framing and asymmetric light-space composition.            |
| Ledger     | Financial report           | Monospace hierarchy, fine ledger rules and disciplined columns.                    |
| Prism      | Marketing launch           | Angular wedges, bold typographic scale and contrasting pale planes.                |
| Folio      | Customer case study        | Inset manuscript frames, serif hierarchy and numbered marginal structure.          |
| Horizon    | Product roadmap            | Horizontal horizons, a rising circular motif and broad timeline-like bands.        |
| Circuit    | Technology demonstration   | Dark technical canvas, stepped paths and outlined terminals.                       |
| Slate      | Executive update           | Restrained dark panels, offset horizontal blocks and clear executive hierarchy.    |
| Spectrum   | Data story                 | Vertical channels, stepped bands and number-focused arrangements.                  |
| Botanica   | Sustainability report      | Light paper, a forest rail and grouped elliptical leaves.                          |
| Archive    | History lecture            | Double archival frames, warm paper and marginal metadata.                          |
| Workshop   | Facilitated learning       | Rounded note-like cards, slight rotations and step markers.                        |
| Scholar    | Research defense           | A chapter rail, serif hierarchy and disciplined annotations.                       |
| Ribbon     | Conference keynote         | Interlocking ovals and broad ribbon-like framing around a clear reading area.      |
| Mosaic     | Creative project           | Asymmetric modular tiles and repeated quadrant geometry.                           |
| Linen      | Brand proposal             | Narrow stripes, inset frames and delicate tabs.                                    |
| Beacon     | Nonprofit impact           | Offset rays and stair-step framing around the impact story.                        |
| Summit     | Corporate briefing         | Structured headline and capability ladder with restrained sand and olive geometry. |
| Atelier    | Design showcase            | Rose editorial fields, asymmetric oval artwork and serif-led spreads.              |
| Campus     | Course lecture             | Pale academic paper, a left chapter index and dark blue serif hierarchy.           |
| Meadow     | Environmental field report | Pale forest paper, leaf medallions and rolling geometric footer forms.             |
| Confetti   | Community celebration      | Centered monospace headlines, perimeter accents and offset note panels.            |
| Facet      | Innovation proposal        | Dark technical planes, outlined diamonds and lime geometric punctuation.           |

Every collection supplies cover, section, body, comparison, image-left, image-right, data and
closing layouts. The examples and discovery copy are localized in the existing ten languages.
Images remain clearly labeled editable placeholders. Original native shapes, system fonts and
existing named palettes keep the collection usable without external asset subscriptions.

## Implementation boundary

The compositions are original Polling Pops work, not reproductions of the referenced artwork.
No competitor images, wording, photographs, textures, fonts or assets are redistributed. The
shared composer preserves caller-supplied ID generation, editable objects, reading order, bounded typography,
decorative semantics and the existing scene 9/document 18 contracts. Adding collections requires
no storage migration or new dependency.

The gallery initially renders twelve covers, exposes full-catalog search and ten overlapping category filters and
reveals the next twelve on demand. Full eight-slide preview decks are created only when opened.
This avoids eagerly constructing all 240 slide scenes on gallery entry.

Automated local validation and captures are recorded separately under
`artifacts/presentation-expanded-designs/`. Hosted, native-language human review and
physical-device qualification remain separate acceptance work.

## Existing-presentation application

Full design applies real collection artwork, frames and typography to existing authored objects.
It replaces only unreferenced empty decorative shapes; meaningful node IDs and content remain.
Colors and fonts remains a separate geometry-preserving option. Previews and editor commits use
the same pure, budget-validated transformation, so rejection cannot partially alter editor history.
Complex connected, grouped, interactive, rotated or imported canvases keep their geometry with a
visible explanation. Base color themes explicitly identify collection palettes and allow color-only
overrides without discarding composition. Automated evidence must include full preview/apply,
content preservation, deterministic repeat application, atomic undo and save/reload.

## Local verification

The final repository check passes 8,941 tests with 526 existing opt-in skips, four production
build tasks and the compiled-server startup smoke. Focused coverage passes 245 tests; all 4,913
web tests pass. Eight targeted production browser checks pass across desktop Chromium/Firefox
and phone Chromium/WebKit. The initial complete-catalog run passed 24 journeys and 960 rendered
layout checks with no text overflow. The 64 original layout object arrays remain byte-identical
to `d82eeab`. Source/artifact provenance, typed browser fixtures and localized publication checks
pass. Captures and receipts are under `artifacts/presentation-expanded-designs/`, with the final
repository checkpoint in `pre-pr-qualification.json`.

## Review corrections

Page-marker recognition remains stable when a design moves folios to a header or when a font
change removes their per-object font override. Reapplying Linen to a complete Studio deck is a
no-op, including after an intervening style change. Ordinary small numeric content remains in
content regions. Text fitting now reports failure when the minimum size cannot fit the assigned
box; every text region is checked before any geometry or artwork changes. Such slides retain
their geometry and expose the existing retained-layout notice.

The corrections pass all 4,913 web tests, 245 focused tests, an optimized production web build,
web/fixture types and scoped lint. Eight targeted production journeys pass across desktop
Chromium/Firefox and phone Chromium/WebKit, verifying real header folios, repeat application,
save/reload and a six-line paragraph that remains fully visible in its original frame. The 64
original layout arrays remain byte-identical. This targeted verification is recorded in
`artifacts/presentation-expanded-designs/review-fixes-qualification.json`. The final full-repository
check is recorded separately in `pre-pr-qualification.json`, alongside the original catalog receipt.
