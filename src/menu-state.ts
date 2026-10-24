import {
  Axis,
  FormatKind,
  Metadata,
  Rect,
  Settings,
  contains,
  intersects,
  isTitle,
  positions,
} from './model';
import { checkRect, numeric, toggleTitle } from './operations';
import { exclusiveInline } from './inline';

/** Only expose actions that can run for this selection, using the same rules as edits. */
export function selectionActions(
  rows: string[][],
  metadata: Metadata,
  rect: Rect,
  axis: Axis,
  settings: Settings,
) {
  checkRect(rows, rect);
  const selected = positions(rect);
  const single = rect.r0 === rect.r1 && rect.c0 === rect.c1;
  const merged = metadata.merges.some((merge) => intersects(merge, rect));
  const decorated =
    merged ||
    !!(metadata.diagonal && contains(rect, 0, 0)) ||
    selected.some(([r, c]) => {
      const cell = metadata.cells[r][c];
      return !!(cell.format || cell.background || cell.color || isTitle(metadata, r, c));
    });
  const titleFlags = selected.map(([r, c]) => isTitle(metadata, r, c));
  let title = axis !== 'cell';
  if (title) {
    try {
      toggleTitle(structuredClone(metadata), rect, axis);
    } catch {
      title = false;
    }
  }
  return {
    diagonal: single && rect.r0 === 0 && rect.c0 === 0 && !merged,
    title,
    merge:
      !single &&
      !merged &&
      (!titleFlags.some(Boolean) || titleFlags.every(Boolean)) &&
      !(metadata.diagonal && contains(rect, 0, 0)),
    unmerge: merged,
    color: true,
    barColor: selected.some(([r, c]) => metadata.cells[r][c].format?.kind === 'bar'),
    copy: decorated,
    edit:
      decorated &&
      (single ||
        metadata.merges.some(
          (merge) =>
            merge.r0 === rect.r0 &&
            merge.r1 === rect.r1 &&
            merge.c0 === rect.c0 &&
            merge.c1 === rect.c1,
        )),
    paste: !merged,
    format: selected.some(([r, c]) => settings.formatTitles || !isTitle(metadata, r, c)),
  };
}
export function canFormat(
  rows: string[][],
  metadata: Metadata,
  rect: Rect,
  kind: FormatKind,
  settings: Settings,
  custom?: { prefix: string; suffix: string },
): boolean {
  const selected = positions(rect).filter(
    ([r, c]) => settings.formatTitles || !isTitle(metadata, r, c),
  );
  if (!selected.length) return false;
  if (selected.some(([r, c]) => exclusiveInline(rows[r][c]))) return false;
  const existing = selected.map(([r, c]) => metadata.cells[r][c].format);
  const target = kind === 'custom' && !custom ? existing[0] : custom;
  if (
    existing.every(
      (format) =>
        format?.kind === kind &&
        (kind !== 'custom' ||
          (format.prefix === target?.prefix && format.suffix === target?.suffix)),
    )
  )
    return true;
  return !(
    (kind === 'percent' || kind === 'calc') &&
    selected.some(([r, c]) => {
      const value = numeric(rows[r][c]);
      return value !== null && value < 0;
    })
  );
}
