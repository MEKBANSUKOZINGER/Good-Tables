import { Axis, Rect } from './model';
import { TablePermutation } from './markdown';

/** Validate the observed native gesture against the resulting table. Native
 * rebuilds replace cell objects, so use source/destination rather than text IDs. */
export function nativeMovement(
  before: string[][],
  after: string[][],
  from: { row: number; col: number },
  to: { row: number; col: number },
): TablePermutation | undefined {
  if (before.length !== after.length || after.some((row) => row.length !== before[0].length))
    return;
  const rows = before.map((_, r) => r),
    columns = before[0].map((_, c) => c);
  if (
    from.row !== to.row &&
    from.col === to.col &&
    from.row >= 0 &&
    to.row >= 0 &&
    from.row < rows.length &&
    to.row < rows.length
  )
    rows.splice(to.row, 0, rows.splice(from.row, 1)[0]);
  else if (
    from.col !== to.col &&
    from.row === to.row &&
    from.col >= 0 &&
    to.col >= 0 &&
    from.col < columns.length &&
    to.col < columns.length
  )
    columns.splice(to.col, 0, columns.splice(from.col, 1)[0]);
  else return;
  return after.every((row, r) => row.every((value, c) => value === before[rows[r]][columns[c]]))
    ? { rows, columns }
    : undefined;
}

/** Real browser events run microtasks between listeners. Wait for native bubbling
 * before reading defaultPrevented, without preventing the native menu itself. */
export function afterNativeContextMenu(
  event: Event,
  append: () => void,
  handled = () => event.defaultPrevented,
): void {
  setTimeout(() => {
    if (handled()) append();
  }, 0);
}

export interface MenuDOM {
  dom?: HTMLElement;
  scrollEl?: HTMLElement;
  items?: { section?: string; dom?: HTMLElement }[];
}

/** A focused-cell menu may already have rendered native section submenus.
 * Append only our new DOM; sorting the entire menu again would regroup those
 * native submenus and change their order. The Menu keeps its original entries. */
export function appendMenuGroup(menu: MenuDOM, section: string): void {
  const { dom, scrollEl, items } = menu;
  if (!dom?.isConnected || !scrollEl || !items) return;
  const own = items.filter(
    (item) => item.section === section && item.dom && !scrollEl.contains(item.dom),
  );
  if (!own.length) return;
  const first = items.indexOf(own[0]);
  const separator = items[first - 1]?.dom;
  if (separator?.classList.contains('menu-separator') && !scrollEl.contains(separator))
    scrollEl.append(separator);
  const group = dom.ownerDocument.createElement('div');
  group.className = 'menu-group';
  for (const item of own) group.append(item.dom!);
  scrollEl.append(group);
  const rect = dom.getBoundingClientRect();
  const body = dom.ownerDocument.body;
  if (rect.bottom > body.clientHeight)
    dom.style.top = `${Math.max(0, (parseFloat(dom.style.top) || 0) + body.clientHeight - rect.bottom - 4)}px`;
  if (rect.right > body.clientWidth)
    dom.style.left = `${Math.max(0, (parseFloat(dom.style.left) || 0) + body.clientWidth - rect.right - 4)}px`;
}

/** Read Obsidian's existing selection; never create or replace native handles. */
export function nativeSelection(
  table: HTMLTableElement,
  preferred: Axis = 'cell',
): { rect: Rect; axis: Axis } | undefined {
  const selected = Array.from(table.rows).flatMap((row, r) =>
    Array.from(row.cells).flatMap((cell, c) =>
      cell.classList.contains('is-selected') ? [{ r, c }] : [],
    ),
  );
  if (!selected.length) return;
  const rect = {
    r0: Math.min(...selected.map((x) => x.r)),
    r1: Math.max(...selected.map((x) => x.r)),
    c0: Math.min(...selected.map((x) => x.c)),
    c1: Math.max(...selected.map((x) => x.c)),
  };
  if (selected.length !== (rect.r1 - rect.r0 + 1) * (rect.c1 - rect.c0 + 1)) return;
  const wholeRows = rect.c0 === 0 && rect.c1 === table.rows[0].cells.length - 1;
  const wholeCols = rect.r0 === 0 && rect.r1 === table.rows.length - 1;
  const axis =
    preferred === 'column' && wholeCols
      ? 'column'
      : preferred === 'row' && wholeRows
        ? 'row'
        : wholeRows && !wholeCols
          ? 'row'
          : wholeCols && !wholeRows
            ? 'column'
            : 'cell';
  return { rect, axis };
}

/** Remove only our classes, preserving native selection/drag state changed meanwhile. */
export function restoreClasses(el: HTMLElement, original: string | null, owned: string[]): void {
  const before = new Set(original?.split(/\s+/).filter(Boolean) ?? []);
  for (const name of owned) el.classList.toggle(name, before.has(name));
  if (el.classList.length === 0 && original === null) el.removeAttribute('class');
}
