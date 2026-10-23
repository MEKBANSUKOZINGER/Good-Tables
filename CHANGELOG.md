# Changelog

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
