# Changelog

## 0.2.4 — 2026-10-24

- Give explicit Good Tables foreground colors priority over theme-specific bold, italic, and highlight colors in Live Preview, native cell editing, reading view, and merged content. Clearing the foreground restores theme styling.
- Hide original-value copy/edit commands for plain selections with no Good Tables formatting, colors, titles, merges, or diagonal cells. Keep native copy/editing and valid original-value actions available.

Validation: 66 automated tests and 29 live-app QA scenarios passed on Obsidian 1.14.5 with the Things theme.

## 0.2.3 — 2026-10-24

- Integrate Good Tables formats into the native Format submenu, after Code/Math/Comment and before Clear formatting, preserving native items and hover behavior.
- Keep all applicable formats visible, check the active format, replace existing or mixed formats, and toggle off an identical selection.
- Combine table formats with native bold, italic, strikethrough, and highlight. Applying Code, Comment, or Math removes the table format, with native cell and document undo/redo support.
- Measure rendered rating stars and native emphasis to keep them inside the cell border during display and editing.
- Allow individual title background/text colors while preserving underlying ordinary colors.
- Add a default Bar color setting and individual bar color controls, always retaining 25% opacity.

Validation: 64 automated tests and 70 live-app QA scenarios passed on Obsidian 1.14.5, including native cell undo/redo and all six native highlight colors.

## 0.2.2 — 2026-10-24

- Add native Obsidian icons to every Good Tables context-menu action and format, including saved custom formats and the reset fallback.
- Preserve checked states, submenu navigation, and the native editing menu while adding visual cues for colors, merges, dates, ratings, and calculations.
- Omit Fileclass note-property and schema commands inside table-cell menus while keeping them available in the ordinary note editor.

Validation: 55 automated tests, 6 live icon checks covering 20 distinct icons, and 8 native-menu compatibility checks passed on Obsidian 1.14.5.

## 0.2.1 — 2026-10-23

- Place HEX beside RGB in one compact input row to reduce color-dialog height.

- Restore colors immediately when native cell focus removes inline styles, and keep colors visible inside the native cell editor.
- Remove redundant Good Tables row/column and cell-size commands, their order settings, and extra resize handles. Retain existing stored dimensions and native table tools.
- Hide actions that cannot run on the selection, including invalid merge/diagonal/title actions, overlapping formats, and unsupported paste into merges.
- Highlight the favorite color being edited and show current/selected color previews, including mixed-color selections.
- Show title background/text colors directly in settings beside their HEX fields.
- Keep the general Custom format entry fixed below built-in and saved formats in both menus and order settings.

Validation: 54 automated tests and 57 live-app QA scenarios passed on Obsidian 1.14.5.

## 0.2.0 — 2026-10-23

- Reuse table decoration and coalesce refreshes before paint to prevent temporary loss of dimensions and formatting during edits and native row/column moves.
- Append Good Tables to asynchronously created single-cell context menus while preserving native entries.
- Replace the native color button with a visible saturation/brightness surface and hue strip, synchronized with HEX/RGB inputs.
- Edit both diagonal values in place with multiline input, IME composition, caret/focus continuity, and native undo/redo.
- Keep only rows, columns, and diagonal in New table defaults; group the remaining table options under Table settings and expose title background/text HEX inputs.
- Give saved custom formats stable menu IDs and independently configurable positions in the format menu.

Validation: 52 automated tests and 48 live-app QA scenarios passed on Obsidian 1.14.5, including frame sampling for layout stability and actual mouse/keyboard checks.

## 0.1.4 — 2026-10-23

- Address the automated source review with supported style helpers and searchable declarative settings definitions.
- Use timers and DOM helpers from the owning window/document for popout compatibility, retaining native table behavior and reversible decoration cleanup.
- Validate decoded metadata as unknown, normalize untrusted settings input, and remove unnecessary assertions and unused bindings.
- Replace CSS `!important` declarations with scoped selectors.
- Add the official Obsidian ESLint checks, two owner-window timer regression tests, and a manual GitHub Actions build/provenance workflow.
- Document clipboard usage and keep development notes and historical upload snapshots outside tracked source.

## 0.1.3 — 2026-10-23

- Keep formats, colors, dimensions, and title assignments with cells during consecutive native row and column moves, including identical rows and blank columns.
- Synchronize table contents and presentation metadata in the same editing transaction so native undo/redo restores both together.
- Unmerge only a region made nonrectangular by a move, retaining its original contents and styles. Clear the first-cell diagonal display if moved away from the first corner, retaining its raw text.
- Verify that native menus and other plugins' entries match with Good Tables enabled and disabled across five editing/selection states.

Validation: 45 automated tests and 32 live-app QA scenarios passed on Obsidian 1.14.4, with additional native mouse-drag and menu comparisons.

## 0.1.2 — 2026-10-23

- Remove numbered row/column selectors and use Obsidian's native handles and selected ranges.
- Preserve native selection, drag behavior, alignment, and table clipboard handling.
- Append Good Tables after native and other plugins' menu entries, including menus opened while editing a cell.

## 0.1.1 — 2026-10-23

- Reapply rating display after editing a value and moving focus away.
- Clear range highlights when focus leaves the table.
- Close hover submenus after the pointer leaves both their trigger and submenu.

## 0.1.0 — 2026-10-22

- Initial desktop development version for existing native Markdown tables.
- Add configurable title rows/columns, numeric/date/rating/custom formats, colors, dimensions, diagonal first cells, and reversible rectangular merges.
- Keep raw cell contents in Markdown with presentation metadata next to the table.
- Provide English/Korean settings and native undo/redo integration.
