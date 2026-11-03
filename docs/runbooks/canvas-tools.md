# Canvas tools

## Editing and selection

Navigation, save status, history, insertion, presentation, sharing, and panel controls share one compact top bar. **Insert** opens image, link, and SVG-image actions; secondary controls move into **More board actions** on narrow screens.

The sliding **Inspector** separates Objects, Properties, Arrange, and Board controls. Facilitation and workshop controls appear where available. Closing the inspector or switching sections preserves local property and discussion drafts. Desktop canvases resize beside the open inspector; on small screens the panel covers and temporarily disables the canvas beneath it. Opening it from a covered canvas control moves keyboard focus into the selected inspector section; closing it restores the originating control. Adding an item on a small screen keeps the canvas and floating formatting controls available. Use **Close inspector** or Escape from its navigation controls to return to the canvas.

The canvas rail keeps selection, pan, area selection, notes, text, basic shapes, frames, and connectors within reach. Its grouped controls open sticky colors, the searchable shape catalog, and drawing settings. Escape dismisses a flyout and returns focus to its trigger.

Selecting objects opens the formatting toolbar. Eligible selections support type conversion, font family and size, bold, italic, underline, alignment, color, opacity, stroke width, locking, duplication, and deletion. **More actions** opens the detailed inspector and layout tools. Locked objects can be unlocked by an eligible collaborator; protected workshop ideas keep their existing moderation boundary.

Double-click an editable text-bearing object, use **Edit text**, or press F2 to edit in place. Ctrl/Cmd+Enter saves; Escape cancels. Failed or conflicting saves retain the local text for recovery. Changes use the object's original version and never silently overwrite a collaborator's newer edit.

## Shapes, connectors, and drawing

The catalog includes basic and flowchart shapes, 17 rectangle variants, and line, arrow, and elbow connector presets. Drag an object's side handle to another object or to a free point. Attached endpoints follow their objects. Existing two-object connector selection remains available.

Drawing settings provide 16 colors and bounded stroke widths. Highlighters use a translucent stroke. The eraser removes whole eligible strokes; it does not perform pixel editing or cascade a hit into deleting other grouped or connected objects. Undo and redo use the normal canvas operation history.

Sticky colors can add one note or a bounded stack. Templates insert a complete new selection into the current board. Inserted content starts team-only, including in Guided workshops; a facilitator chooses what to publish. Existing objects are preserved. Existing object, document, and batch limits still apply.

## SVG images

**Add SVG image** accepts simple, bounded SVG artwork and adds it through the normal image upload flow. SVG artwork becomes an image rather than an editable custom vector shape.

The importer reconstructs supported geometry, text, and transforms, then converts it to PNG. Scripts, event handlers, external references, images, stylesheets, filters, embedded HTML, entities, and document types are rejected. Imports are limited to 512 KiB, 2,000 nodes, depth 32, 64 KiB per path, and a maximum raster of 2,048 pixels per side / 4 megapixels. Image uploads must be available for the board. Failed imports leave the board unchanged.

## Deployment and compatibility

Apply migration **087_canvas_object_styles.sql** and deploy the API and web app together. Canvas content now uses version 4; saved scene responses use envelope version 3. Older stored content is deterministically read into the current projection, and legacy version 1–3 create/mutation requests retain their original parsing and retry hashes. Immutable historical snapshots are not rewritten. Cached older web clients should reload after deployment to read the new response format.

New fields are bounded enums and numbers. No arbitrary HTML, CSS, remote fonts, or SVG markup enter the persisted canvas format. Permissions, creator licenses, guest privacy, and capacity limits are unchanged.
