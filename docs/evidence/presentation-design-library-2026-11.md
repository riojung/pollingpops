# Presentation design library

Research and implementation evidence, November 13, 2026.

## Product distinction

Content templates provide a starting story, questions or a subject-specific workflow.
Design templates provide a coordinated visual system that can be reused with another story.
Polling Pops keeps the existing Presentation, Round and Survey content catalogs and adds a
separate Presentation design collection.

## Primary-source benchmark

| Product                                                                                      | Publicly verified pattern                                                                                                                                                                                                                                                                               | Implementation decision                                                                                                                        |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| [Canva presentation templates](https://www.canva.com/presentations/templates/)               | Visual presentation cards and multipage sets support browsing complete designs. [Styles](https://www.canva.com/help/color-and-font-combinations/) applies palette/font combinations; [changing a template](https://www.canva.com/help/change-template/) is a distinct operation that can replace pages. | Preview a coordinated set, and distinguish applying appearance from adding an example layout.                                                  |
| [Slidesgo 2026 collection](https://slidesgo.com/presentation-trends-2026)                    | Industry/content filters are separate from style, color and format filters.                                                                                                                                                                                                                             | Design discovery uses visual-style filters and search, independently of scenario categories.                                                   |
| [Adobe Express presentation templates](https://www.adobe.com/express/templates/presentation) | Visual grids expose multipage, free/premium and static/animated choices. [Styles](https://helpx.adobe.com/express/web/add-images-and-visuals/images-and-backgrounds/apply-styles.html) supports font/color combinations and an all-pages action.                                                        | Use real rendered slide previews and explicit current-slide/whole-presentation style controls. Only expose choices the local product supports. |

These observations come from public catalogs and official help pages. Signed-in competitor
editors were not exercised. The Slidesgo collection is a curated catalog, rather than evidence
of universal customer preferences or an apply-to-existing-content guarantee.

## Original collection

Eight original families provide 64 editable native layouts:

| Family     | Visual direction                 | Existing palette and typography |
| ---------- | -------------------------------- | ------------------------------- |
| Studio     | Minimal, open composition        | Paper / sans / relaxed          |
| Editorial  | Asymmetric editorial composition | Paper / serif / relaxed         |
| Midnight   | Bold dark composition            | Midnight / sans / relaxed       |
| Blueprint  | Technical composition            | Ocean / mono / compact          |
| Terracotta | Warm editorial composition       | Sunset / serif / relaxed        |
| Signal     | Compact bold composition         | Sunset / sans / compact         |
| Monograph  | Dark technical composition       | Midnight / mono / compact       |
| Canvas     | Cool minimal composition         | Ocean / sans / relaxed          |

Each family includes cover, section, body, split text, image-left, image-right, data and closing
layouts. Authored proportions and recurring native geometric marks distinguish the sets.
The same localized, illustrative copy is used across families for comparison. Image slots are
editable placeholders, and data values are explicitly illustrative.

All names, geometry and sample copy are authored for Polling Pops. The collection uses the
existing native scene primitives and device/renderer font families. It adds no downloaded
competitor assets, external image/font service, AI request, dependency or paid media license.
Original source follows the repository's Apache-2.0 license and clean-room contribution rules.

## Existing-work behavior

- **Apply style** changes theme, typography and spacing while preserving native objects,
  frames, reading order, rich text, language, media references, interactions and notes.
- Ordinary content slides use the established deterministic native conversion before styling.
  Their block identities, text/media references, geometry and metadata are retained.
- Existing motion is retained, including borrowed motion on unstyled native and ordinary
  slides. Explicit static designs remain motion-inheritance barriers.
- Activity questions and answers remain intact. They inherit appearance from nearby visible
  content slides; an activity alone cannot store its own independent style under the existing
  contract. The current-slide action therefore requires a content slide.
- Imported image pages keep the colors baked into their original artwork. Styling preserves
  their source and geometry.
- **Add layout** inserts one selected native example with fresh identities. It preserves the
  chosen family instead of replacing it with the neighboring slide's design.
- **Start with this design** creates an editable coordinated draft. It does not replace an
  existing presentation.
- Failed creation keeps its exact account-scoped request for safe retries. **Start another**
  explicitly retires that local attempt and creates a fresh draft if the previous target was
  edited, archived or deleted. Any existing server draft is kept. Recovery remains available
  in the gallery and its matching preview, with copy in all ten interface languages.

Editor operations use the existing undo/redo, recovery and autosave transaction. Complete
document validation runs before application/insertion, including spatial-frame reconciliation
for an inserted slide. Stored and published records use the existing scene/document versions;
this collection requires no new migration or persisted family identifier.

## Delivery consistency

The static-export projection resolves effective public design before page selection. Native,
ordinary and activity pages retain inherited static palettes/fonts in PNG, PDF, readable HTML
and offline HTML. Motion remains a still poster for exported pages. Donor-less legacy exports
keep their defaults. Hidden-donor rules, explicit static barriers, private fields and published
source bytes remain covered by regression tests.

Qualification results are recorded in `docs/implementation-status.md`; local browser captures
are retained separately from source. Local fixtures and automated checks do not advance hosted,
native-language, customer or physical-device acceptance gates.
