import {
  Axis,
  FormatKind,
  Metadata,
  Rect,
  Settings,
  TableError,
  contains,
  intersects,
  isTitle,
  positions,
  uid,
  inheritedFormat,
} from './model';
import { escapeCell } from './markdown';
import { exclusiveInline, inlineCell } from './inline';
export function checkRect(rows: string[][], a: Rect): void {
  if (
    ![a.r0, a.r1, a.c0, a.c1].every(Number.isInteger) ||
    a.r0 < 0 ||
    a.c0 < 0 ||
    a.r1 < a.r0 ||
    a.c1 < a.c0 ||
    a.r1 >= rows.length ||
    a.c1 >= rows[0].length
  )
    throw new TableError('selection');
}
export function expandSelection(rows: string[][], a: Rect, axis: Axis): Rect {
  return axis === 'row'
    ? { ...a, c0: 0, c1: rows[0].length - 1 }
    : axis === 'column'
      ? { ...a, r0: 0, r1: rows.length - 1 }
      : a;
}
export function toggleTitle(m: Metadata, a: Rect, axis: Axis): void {
  if (axis === 'cell') throw new TableError('selectAxis');
  const list = axis === 'row' ? m.headerRows : m.headerCols,
    start = axis === 'row' ? a.r0 : a.c0,
    end = axis === 'row' ? a.r1 : a.c1;
  const all = Array.from({ length: end - start + 1 }, (_, i) => start + i),
    remove = all.every((i) => list.includes(i));
  const next = remove ? list.filter((i) => !all.includes(i)) : [...new Set([...list, ...all])];
  const trial = structuredClone(m);
  if (axis === 'row') trial.headerRows = next;
  else trial.headerCols = next;
  for (const merge of trial.merges) {
    const flags = positions(merge).map(([r, c]) => isTitle(trial, r, c));
    if (flags.some(Boolean) && !flags.every(Boolean)) throw new TableError('titleMerge');
  }
  if (axis === 'row') m.headerRows = next;
  else m.headerCols = next;
}
export const numeric = (raw: string): number | null => {
  const value = inlineCell(raw).text;
  if (exclusiveInline(raw)) return null;
  return /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value) && Number.isFinite(Number(value))
    ? Number(value)
    : null;
};
export function applyFormat(
  rows: string[][],
  m: Metadata,
  a: Rect,
  axis: Axis,
  kind: FormatKind,
  s: Settings,
  custom?: { prefix: string; suffix: string },
): void {
  const cells = positions(a).filter(([r, c]) => s.formatTitles || !isTitle(m, r, c));
  if (!cells.length) throw new TableError('title');
  if (cells.some(([r, c]) => exclusiveInline(rows[r][c]))) throw new TableError('exclusiveFormat');
  const existing = cells.map(([r, c]) => m.cells[r][c].format);
  const identical = existing.every(
    (f) =>
      f?.kind === kind &&
      (kind !== 'custom' || (f.prefix === custom?.prefix && f.suffix === custom?.suffix)),
  );
  if (identical) {
    cells.forEach(([r, c]) => delete m.cells[r][c].format);
    return;
  }
  if (
    (kind === 'percent' || kind === 'calc') &&
    cells.some(([r, c]) => {
      const n = numeric(rows[r][c]);
      return n !== null && n < 0;
    })
  )
    throw new TableError('negative');
  const groups = new Map<number, string>();
  for (const [r, c] of cells) {
    const index = axis === 'row' ? r : axis === 'column' ? c : 0;
    if (!groups.has(index)) groups.set(index, uid());
    m.cells[r][c].format = {
      kind,
      group: groups.get(index)!,
      scope: axis,
      ...(kind === 'custom' ? custom : {}),
    };
  }
}
export const CELL_FORMAT_PROPERTIES = [
  'format',
  'background',
  'color',
  'titleBackground',
  'titleColor',
  'barColor',
] as const;
export function hasCellFormatting(m: Metadata, a: Rect): boolean {
  return positions(a).some(([r, c]) =>
    CELL_FORMAT_PROPERTIES.some((key) => m.cells[r]?.[c]?.[key] !== undefined),
  );
}
/** Clear presentation only; preserve cell identity and all table structure. */
export function clearCellFormatting(m: Metadata, a: Rect): void {
  for (const [r, c] of positions(a))
    for (const key of CELL_FORMAT_PROPERTIES) delete m.cells[r][c][key];
}
export function colorCells(
  m: Metadata,
  a: Rect,
  property: 'background' | 'color' | 'barColor',
  color: string | null,
): void {
  if (color !== null && !/^#[\da-f]{6}$/i.test(color)) throw new TableError('color');
  const cells = positions(a).filter(
    ([r, c]) => property !== 'barColor' || m.cells[r][c].format?.kind === 'bar',
  );
  cells.forEach(([r, c]) => {
    const key =
      isTitle(m, r, c) && property !== 'barColor'
        ? property === 'background'
          ? 'titleBackground'
          : 'titleColor'
        : property;
    if (color === null) delete m.cells[r][c][key];
    else m.cells[r][c][key] = color;
  });
}
export function mergeCells(m: Metadata, a: Rect): void {
  if (a.r0 === a.r1 && a.c0 === a.c1) throw new TableError('selection');
  if (m.merges.some((b) => intersects(a, b))) throw new TableError('merged');
  const titles = positions(a).map(([r, c]) => isTitle(m, r, c));
  if (titles.some(Boolean) && !titles.every(Boolean)) throw new TableError('titleMerge');
  if (m.diagonal && contains(a, 0, 0)) throw new TableError('diagonalMerge');
  m.merges.push({ ...a });
}
export function unmergeCells(m: Metadata, a: Rect): void {
  if (!m.merges.some((b) => intersects(a, b))) throw new TableError('notMerged');
  m.merges = m.merges.filter((b) => !intersects(a, b));
}
export function toggleDiagonal(rows: string[][], m: Metadata): void {
  if (m.diagonal) {
    rows[0][0] = m.diagonal.lower + m.diagonal.upper;
    delete m.diagonal;
  } else {
    if (m.merges.some((b) => contains(b, 0, 0))) throw new TableError('diagonalMerge');
    m.diagonal = { lower: rows[0][0], upper: '' };
  }
}
export function editCell(rows: string[][], m: Metadata, r: number, c: number, value: string): void {
  const merge = m.merges.find((a) => contains(a, r, c));
  if (merge) {
    r = merge.r0;
    c = merge.c0;
  }
  if (r === 0 && c === 0 && m.diagonal) {
    m.diagonal.lower = value;
    rows[0][0] = value + m.diagonal.upper;
  } else rows[r][c] = value;
}
/** Explicit structural changes are exact: move metadata along with the original cells. */
export function structure(
  rows: string[][],
  m: Metadata,
  axis: 'row' | 'column',
  index: number,
  action: 'insert' | 'delete',
  count = 1,
): void {
  const length = axis === 'row' ? rows.length : rows[0].length;
  if (
    index < 0 ||
    index > (action === 'insert' ? length : length - 1) ||
    count < 1 ||
    (action === 'delete' && length - count < 1)
  )
    throw new TableError('last');
  if (
    action === 'insert' &&
    (length + count > 100 ||
      (axis === 'row'
        ? (rows.length + count) * rows[0].length
        : rows.length * (rows[0].length + count)) > 5000)
  )
    throw new TableError('size');
  if (
    m.merges.some((a) => {
      const start = axis === 'row' ? a.r0 : a.c0,
        end = axis === 'row' ? a.r1 : a.c1;
      return action === 'insert'
        ? index > start && index <= end
        : index <= end && index + count - 1 >= start;
    })
  )
    throw new TableError('unmergeFirst');
  if (m.diagonal && index === 0) throw new TableError('diagonalStructure');
  const before = structuredClone(m.cells);
  if (axis === 'column' && m.alignments) {
    if (action === 'insert') m.alignments.splice(index, 0, ...Array<string>(count).fill('---'));
    else m.alignments.splice(index, count);
  }
  if (axis === 'row') {
    if (action === 'insert') {
      rows.splice(index, 0, ...Array.from({ length: count }, () => rows[0].map(() => '')));
      m.cells.splice(
        index,
        0,
        ...Array.from({ length: count }, () =>
          rows[0].map((_, c) => {
            const format = inheritedFormat(
              before.map((row) => row[c]),
              'column',
            );
            return { id: uid(), ...(format ? { format } : {}) };
          }),
        ),
      );
    } else {
      rows.splice(index, count);
      m.cells.splice(index, count);
    }
  } else
    for (let r = 0; r < rows.length; r++) {
      if (action === 'insert') {
        rows[r].splice(index, 0, ...Array<string>(count).fill(''));
        m.cells[r].splice(
          index,
          0,
          ...Array.from({ length: count }, () => {
            const format = inheritedFormat(before[r], 'row');
            return { id: uid(), ...(format ? { format } : {}) };
          }),
        );
      } else {
        rows[r].splice(index, count);
        m.cells[r].splice(index, count);
      }
    }
  const remap = (i: number) =>
    action === 'insert'
      ? i >= index
        ? i + count
        : i
      : i >= index && i < index + count
        ? -1
        : i >= index + count
          ? i - count
          : i;
  const title = axis === 'row' ? 'headerRows' : 'headerCols';
  m[title] = m[title].map(remap).filter((i) => i >= 0);
  const sizes = axis === 'row' ? 'heights' : 'widths';
  m[sizes] = Object.fromEntries(
    Object.entries(m[sizes]).flatMap(([k, v]) =>
      remap(Number(k)) < 0 ? [] : [[remap(Number(k)), v]],
    ),
  );
  m.merges = m.merges.map((a) =>
    axis === 'row'
      ? { ...a, r0: remap(a.r0), r1: remap(a.r1) }
      : { ...a, c0: remap(a.c0), c1: remap(a.c1) },
  );
}
export function pasteCells(rows: string[][], m: Metadata, a: Rect, text: string): void {
  const pasted = text
    .replace(/\r\n/g, '\n')
    .replace(/\n$/, '')
    .split('\n')
    .map((row) => row.split('\t'));
  const width = Math.max(...pasted.map((row) => row.length));
  if (a.r0 + pasted.length > rows.length || a.c0 + width > rows[0].length)
    throw new TableError('pasteSize');
  const target = { r0: a.r0, c0: a.c0, r1: a.r0 + pasted.length - 1, c1: a.c0 + width - 1 };
  if (m.merges.some((b) => intersects(target, b))) throw new TableError('unmergeFirst');
  for (let r = 0; r < pasted.length; r++)
    for (let c = 0; c < width; c++)
      editCell(rows, m, a.r0 + r, a.c0 + c, escapeCell(pasted[r][c] ?? ''));
}
