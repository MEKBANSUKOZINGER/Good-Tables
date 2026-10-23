import { Metadata, Rect, Settings, contains, isTitle } from './model';
import { displayCell } from './formats';
import { restoreClasses } from './native-table';
export interface RenderHooks {
  label: (key: 'edit' | 'lower' | 'upper') => string;
  select: (a: Rect, axis: 'cell' | 'row' | 'column', event: MouseEvent) => void;
  edit: (r: number, c: number) => void;
  resize: (axis: 'row' | 'column', index: number, size: number) => void;
}
export interface Decorated {
  dispose: () => void;
  select: (a: Rect | null) => void;
  refreshLayout: () => void;
}
/** Add visual layers and handles; leave native row/cell nodes and their editing listeners intact. */
export function decorateTable(
  table: HTMLTableElement,
  rows: string[][],
  m: Metadata | undefined,
  s: Settings,
  hooks?: RenderHooks,
  renderMarkdown?: (text: string, target: HTMLElement) => void,
): Decorated {
  const document = table.ownerDocument;
  const cells = Array.from(table.rows).map((row) => Array.from(row.cells));
  const disposers: (() => void)[] = [];
  const added: HTMLElement[] = [];
  const overlays: { element: HTMLElement; rect: Rect }[] = [];
  const track = (el: HTMLElement) => {
    added.push(el);
    return el;
  };
  const listen = (el: EventTarget, name: string, fn: EventListener) => {
    el.addEventListener(name, fn);
    disposers.push(() => el.removeEventListener(name, fn));
  };
  const tableClass = table.getAttribute('class');
  const restoreTable = () => restoreClasses(table, tableClass, ['gt-table', 'gt-full-width']);
  table.classList.add('gt-table');
  if (s.fullWidth) table.classList.add('gt-full-width');
  const original = new Map<
    HTMLElement,
    {
      className: string | null;
      style: string | null;
      properties: Map<string, { value: string; priority: string; applied: string }>;
    }
  >();
  const save = (el: HTMLElement) => {
    if (!original.has(el))
      original.set(el, {
        style: el.getAttribute('style'),
        className: el.getAttribute('class'),
        properties: new Map(),
      });
  };
  const style = (el: HTMLElement, property: string, value: string) => {
    save(el);
    const properties = original.get(el)!.properties;
    if (!properties.has(property))
      properties.set(property, {
        value: el.style.getPropertyValue(property),
        priority: el.style.getPropertyPriority(property),
        applied: '',
      });
    el.style.setProperty(property, value);
    properties.get(property)!.applied = el.style.getPropertyValue(property);
  };
  if (cells.length !== rows.length || cells.some((row, r) => row.length !== rows[r].length))
    return {
      dispose: restoreTable,
      select: () => {},
      refreshLayout: () => {},
    };
  const data = m;
  for (let r = 0; r < cells.length; r++)
    for (let c = 0; c < cells[r].length; c++) {
      const cell = cells[r][c];
      save(cell);
      cell.classList.add('gt-cell');
      cell.dataset.gtRow = String(r);
      cell.dataset.gtCol = String(c);
      if (data) {
        const cm = data.cells[r][c],
          title = isTitle(data, r, c);
        const bg = title ? s.titleBackground || 'var(--background-secondary)' : cm.background;
        const color = title ? s.titleColor || 'var(--text-normal)' : cm.color;
        if (bg) {
          style(cell, '--gt-bg', bg);
          style(cell, 'background-color', bg);
        }
        if (color) {
          style(cell, '--gt-fg', color);
          style(cell, 'color', color);
        }
        if (title) cell.classList.add('gt-title');
        if (data.widths[c]) {
          style(cell, 'min-width', `${data.widths[c]}px`);
          style(cell, 'width', `${data.widths[c]}px`);
        }
        if (data.heights[r]) style(cell, 'height', `${data.heights[r]}px`);
        const formatted = cm.format && (!title || s.formatTitles);
        if (formatted) {
          const output = displayCell(rows, data, r, c, s);
          const overlay = track(document.createElement('span'));
          overlay.className = 'gt-display';
          overlay.textContent = output.text;
          overlay.setAttribute('aria-label', output.text);
          if (output.fraction !== undefined) {
            overlay.classList.add('gt-bar');
            overlay.style.setProperty('--gt-fraction', `${output.fraction * 100}%`);
          }
          if (output.error) overlay.classList.add('gt-error');
          cell.append(overlay);
          style(
            cell,
            'min-width',
            `${Math.max(data.widths[c] ?? 0, Math.min(600, output.text.length * 9 + 28))}px`,
          );
        }
      }
      if (hooks && (r === 0 || c === 0)) {
        for (const axis of [
          ...(r === 0 ? (['column'] as const) : []),
          ...(c === 0 ? (['row'] as const) : []),
        ]) {
          const handle = track(document.createElement('span'));
          handle.className = `gt-resize-${axis}`;
          cell.append(handle);
          listen(handle, 'pointerdown', ((event: PointerEvent) => {
            event.preventDefault();
            event.stopPropagation();
            const start = axis === 'column' ? event.clientX : event.clientY,
              rect = cell.getBoundingClientRect(),
              size = axis === 'column' ? rect.width : rect.height;
            const finish = (e: PointerEvent) => {
              document.removeEventListener('pointerup', finish);
              hooks.resize(
                axis,
                axis === 'column' ? c : r,
                Math.round(
                  Math.max(
                    24,
                    Math.min(4000, size + (axis === 'column' ? e.clientX : e.clientY) - start),
                  ),
                ),
              );
            };
            document.addEventListener('pointerup', finish, { once: true });
            disposers.push(() => document.removeEventListener('pointerup', finish));
          }) as EventListener);
        }
      }
    }
  let pointerOutside = false;
  let windowBlurred = false;
  const focus = () => {
    for (const row of cells)
      for (const cell of row) {
        // Obsidian retains the cell editor after blur. Its presence does not mean
        // the raw value is still being edited.
        const editing =
          !pointerOutside &&
          !windowBlurred &&
          document.activeElement !== document.body &&
          cell.contains(document.activeElement);
        cell.classList.toggle('gt-editing', editing);
      }
  };
  listen(table, 'focusin', () => {
    pointerOutside = false;
    focus();
  });
  listen(table, 'focusout', () => queueMicrotask(focus));
  listen(document, 'mousedown', (event) => {
    if (!table.contains(event.target as Node)) {
      pointerOutside = true;
      focus();
    }
  });
  if (document.defaultView) {
    listen(document.defaultView, 'blur', () => {
      windowBlurred = true;
      focus();
    });
    listen(document.defaultView, 'focus', () => {
      windowBlurred = false;
      focus();
    });
  }
  focus();
  const parent = table.parentElement;
  const parentPosition = parent?.style.position ?? '';
  const parentStyle = parent?.getAttribute('style');
  if (parent) parent.style.position = 'relative';
  const addOverlay = (rect: Rect, className: string) => {
    const overlay = track(document.createElement('div'));
    overlay.className = className;
    parent?.append(overlay);
    overlays.push({ element: overlay, rect });
    if (hooks) {
      overlay.setAttribute('aria-label', hooks.label('edit'));
      overlay.setAttribute('role', 'button');
      overlay.tabIndex = 0;
      listen(overlay, 'dblclick', () => hooks.edit(rect.r0, rect.c0));
      listen(overlay, 'keydown', ((e: KeyboardEvent) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          hooks.edit(rect.r0, rect.c0);
        }
      }) as EventListener);
      listen(overlay, 'mousedown', ((e: MouseEvent) => {
        hooks.select(rect, 'cell', e);
      }) as EventListener);
      // Let the native table build its regular context menu at the anchor cell.
      listen(overlay, 'contextmenu', ((e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        cells[rect.r0][rect.c0].dispatchEvent(
          new PointerEvent('contextmenu', {
            pointerType: 'mouse',
            bubbles: true,
            cancelable: true,
            clientX: e.clientX,
            clientY: e.clientY,
            button: 2,
          }),
        );
      }) as EventListener);
    }
    return overlay;
  };
  if (data && parent) {
    for (const a of data.merges) {
      const overlay = addOverlay(a, 'gt-merge-overlay');
      const anchor = cells[a.r0][a.c0];
      overlay.style.backgroundColor =
        anchor.style.getPropertyValue('--gt-bg') || 'var(--background-primary)';
      overlay.style.color = anchor.style.getPropertyValue('--gt-fg') || 'var(--text-normal)';
      if (isTitle(data, a.r0, a.c0)) overlay.classList.add('gt-title');
      const output = displayCell(rows, data, a.r0, a.c0, s);
      overlay.textContent = output.text.replace(/<br\s*\/?>/gi, '\n');
      if (!data.cells[a.r0][a.c0].format && renderMarkdown) {
        overlay.textContent = '';
        const content = document.createElement('div');
        content.className = 'gt-merge-content';
        overlay.append(content);
        renderMarkdown(output.text, content);
      }
      if (output.fraction !== undefined) {
        overlay.classList.add('gt-bar');
        overlay.style.setProperty('--gt-fraction', `${output.fraction * 100}%`);
      }
    }
    if (data.diagonal) {
      const overlay = addOverlay({ r0: 0, r1: 0, c0: 0, c1: 0 }, 'gt-diagonal-overlay');
      const lower = document.createElement('span'),
        upper = document.createElement('span');
      lower.className = 'gt-diagonal-lower';
      upper.className = 'gt-diagonal-upper';
      lower.textContent = data.diagonal.lower.replace(/<br\s*\/?>/gi, '\n');
      upper.textContent = data.diagonal.upper.replace(/<br\s*\/?>/gi, '\n');
      lower.setAttribute('aria-label', hooks?.label('lower') ?? 'Lower left');
      upper.setAttribute('aria-label', hooks?.label('upper') ?? 'Upper right');
      overlay.append(lower, upper);
      const longest = Math.max(
        ...[lower.textContent, upper.textContent].flatMap((v) =>
          v.split('\n').map((x) => x.length),
        ),
      );
      style(cells[0][0], 'min-width', `${Math.max(data.widths[0] ?? 0, 100, longest * 16 + 40)}px`);
      style(
        cells[0][0],
        'height',
        `${Math.max(data.heights[0] ?? 0, 72, (lower.textContent.split('\n').length + upper.textContent.split('\n').length) * 26 + 20)}px`,
      );
      overlay.style.backgroundColor =
        cells[0][0].style.getPropertyValue('--gt-bg') || 'var(--background-primary)';
      overlay.style.color = cells[0][0].style.getPropertyValue('--gt-fg') || 'var(--text-normal)';
    }
  }
  const layout = () => {
    if (!parent) return;
    const p = parent.getBoundingClientRect();
    for (const { element, rect } of overlays) {
      const a = cells[rect.r0][rect.c0].getBoundingClientRect(),
        b = cells[rect.r1][rect.c1].getBoundingClientRect();
      Object.assign(element.style, {
        left: `${a.left - p.left + parent.scrollLeft}px`,
        top: `${a.top - p.top + parent.scrollTop}px`,
        width: `${b.right - a.left}px`,
        height: `${b.bottom - a.top}px`,
      });
    }
  };
  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(layout) : undefined;
  observer?.observe(table);
  layout();
  return {
    refreshLayout: layout,
    select: (a) => {
      for (let r = 0; r < cells.length; r++)
        for (let c = 0; c < cells[r].length; c++)
          cells[r][c].classList.toggle('gt-selected', !!a && contains(a, r, c));
      for (const overlay of overlays)
        overlay.element.classList.toggle(
          'gt-selected',
          !!a && contains(a, overlay.rect.r0, overlay.rect.c0),
        );
    },
    dispose: () => {
      observer?.disconnect();
      disposers.forEach((fn) => fn());
      added.forEach((el) => el.remove());
      for (const [el, state] of original) {
        for (const [property, before] of state.properties) {
          if (el.style.getPropertyValue(property) !== before.applied) continue;
          if (before.value) el.style.setProperty(property, before.value, before.priority);
          else el.style.removeProperty(property);
        }
        if (!el.style.length && state.style === null) el.removeAttribute('style');
        restoreClasses(el, state.className, ['gt-cell', 'gt-title', 'gt-editing', 'gt-selected']);
        delete el.dataset.gtRow;
        delete el.dataset.gtCol;
      }
      restoreTable();
      if (parent) {
        if (parent.style.position === 'relative') parent.style.position = parentPosition;
        if (!parent.style.length && parentStyle == null) parent.removeAttribute('style');
      }
    },
  };
}
