import { Metadata, Rect, Settings, contains, isTitle } from './model';
import { displayCell } from './formats';
import { restoreClasses } from './native-table';
import { escapeCell } from './markdown';
import { exclusiveInline, fillInline, inlineCell } from './inline';
export interface RenderHooks {
  label: (key: 'edit' | 'lower' | 'upper') => string;
  select: (a: Rect, axis: 'cell' | 'row' | 'column', event: MouseEvent) => void;
  edit: (r: number, c: number) => void;
  diagonalEdit?: (lower: string, upper: string) => void;
  history?: (redo: boolean) => void;
}
export interface Decorated {
  dispose: () => void;
  select: (a: Rect | null) => void;
  refreshLayout: () => void;
  update: (rows: string[][], metadata: Metadata | undefined, settings: Settings) => void;
  isCurrent: () => boolean;
  focusDiagonal: () => void;
  releaseDiagonal: () => DiagonalSurface | undefined;
}
export interface DiagonalSurface {
  element: HTMLElement;
  lower: HTMLTextAreaElement;
  upper: HTMLTextAreaElement;
  focused?: HTMLTextAreaElement;
}
interface Overlay {
  element: HTMLElement;
  rect: Rect;
  text?: string;
  cleanup?: () => void;
  geometry?: string;
  listeners: (() => void)[];
}
const positionedParents = new WeakMap<
  HTMLElement,
  { count: number; position: string; style: string | null }
>();
/** Keep decoration nodes and native cell nodes alive across edits and layout updates. */
export function decorateTable(
  table: HTMLTableElement,
  initialRows: string[][],
  initialMetadata: Metadata | undefined,
  initialSettings: Settings,
  hooks?: RenderHooks,
  renderMarkdown?: (text: string, target: HTMLElement) => void | (() => void),
  continuity?: DiagonalSurface,
): Decorated {
  const document = table.ownerDocument,
    window = document.defaultView!;
  const cells = Array.from(table.rows, (row) => Array.from(row.cells));
  const tableClass = table.getAttribute('class');
  const parent = table.parentElement;
  const disposers = new Set<() => void>(),
    added = new Set<HTMLElement>();
  const displays = new Map<HTMLTableCellElement, HTMLElement>();
  const measures = new Map<HTMLTableCellElement, HTMLElement>();
  const displayKeys = new WeakMap<HTMLElement, string>();
  const fillDisplay = (element: HTMLElement, text: string, raw: string) => {
    const presentation = inlineCell(raw),
      key = JSON.stringify([text, presentation]);
    if (displayKeys.get(element) !== key) {
      fillInline(element, text, presentation);
      displayKeys.set(element, key);
    }
  };
  const overlays = new Map<string, Overlay>();
  const originals = new Map<
    HTMLElement,
    {
      className: string | null;
      style: string | null;
      properties: Map<string, { value: string; priority: string; applied: string }>;
    }
  >();
  let data = initialMetadata,
    rows = initialRows,
    settings = initialSettings;
  let selected: Rect | null = null,
    dead = false,
    pointerOutside = false,
    windowBlurred = false;
  let diagonalFields: { lower: HTMLTextAreaElement; upper: HTMLTextAreaElement } | undefined;
  let diagonalInitialized = false;
  let focusedDiagonal: HTMLTextAreaElement | undefined;
  const listen = (element: EventTarget, name: string, callback: EventListener, owner?: Overlay) => {
    element.addEventListener(name, callback);
    const stop = () => {
      element.removeEventListener(name, callback);
      disposers.delete(stop);
    };
    disposers.add(stop);
    owner?.listeners.push(stop);
  };
  const track = <T extends HTMLElement>(element: T): T => {
    added.add(element);
    return element;
  };
  const remove = (element: HTMLElement) => {
    element.remove();
    added.delete(element);
  };
  for (const [r, row] of cells.entries())
    for (const [c, cell] of row.entries()) {
      originals.set(cell, {
        className: cell.getAttribute('class'),
        style: cell.getAttribute('style'),
        properties: new Map(),
      });
      cell.classList.add('gt-cell');
      cell.dataset.gtRow = String(r);
      cell.dataset.gtCol = String(c);
    }
  table.classList.add('gt-table');
  if (parent) {
    let ownership = positionedParents.get(parent);
    if (!ownership) {
      ownership = {
        count: 0,
        position: parent.style.position,
        style: parent.getAttribute('style'),
      };
      positionedParents.set(parent, ownership);
      parent.setCssStyles({ position: 'relative' });
    }
    ownership.count++;
  }
  const applyStyles = (cell: HTMLElement, wanted: Record<string, string>) => {
    const state = originals.get(cell)!;
    for (const [property, before] of state.properties) {
      if (property in wanted) continue;
      if (cell.style.getPropertyValue(property) === before.applied) {
        if (before.value) cell.style.setProperty(property, before.value, before.priority);
        else cell.style.removeProperty(property);
      }
      state.properties.delete(property);
    }
    for (const [property, value] of Object.entries(wanted)) {
      const current = cell.style.getPropertyValue(property);
      let before = state.properties.get(property);
      if (!before) {
        before = {
          value: current,
          priority: cell.style.getPropertyPriority(property),
          applied: '',
        };
        state.properties.set(property, before);
      } else if (current !== before.applied) {
        before.value = current;
        before.priority = cell.style.getPropertyPriority(property);
      }
      if (current !== value) cell.style.setProperty(property, value);
      before.applied = cell.style.getPropertyValue(property);
    }
    if (!cell.style.length && state.style === null) cell.removeAttribute('style');
  };
  const focus = () => {
    for (const row of cells)
      for (const cell of row) {
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
    if (!overlays.get('diagonal')?.element.contains(event.target as Node))
      focusedDiagonal = undefined;
    if (!table.contains(event.target as Node)) {
      pointerOutside = true;
      focus();
    }
  });
  listen(document, 'focusin', (event) => {
    if (
      event.target !== document.body &&
      !overlays.get('diagonal')?.element.contains(event.target as Node)
    )
      focusedDiagonal = undefined;
  });
  listen(window, 'blur', () => {
    windowBlurred = true;
    focus();
  });
  listen(window, 'focus', () => {
    windowBlurred = false;
    focus();
  });
  const select = (rect: Rect | null) => {
    selected = rect;
    for (const [r, row] of cells.entries())
      for (const [c, cell] of row.entries())
        cell.classList.toggle('gt-selected', !!rect && contains(rect, r, c));
    for (const overlay of overlays.values())
      overlay.element.classList.toggle(
        'gt-selected',
        !!rect && contains(rect, overlay.rect.r0, overlay.rect.c0),
      );
  };
  const makeOverlay = (id: string, rect: Rect, cls: string): Overlay => {
    const existing = overlays.get(id);
    if (existing) {
      existing.rect = rect;
      return existing;
    }
    const carried = id === 'diagonal' ? continuity : undefined;
    const overlay = carried?.element ?? (parent ?? table).createDiv({ cls });
    if (carried) {
      (parent ?? table).append(overlay);
      diagonalFields = carried;
    }
    const entry: Overlay = {
      element: track(overlay),
      rect,
      listeners: [],
    };
    overlays.set(id, entry);
    const element = entry.element;
    if (hooks) {
      if (id !== 'diagonal') {
        element.setAttribute('role', 'button');
        element.tabIndex = 0;
        element.setAttribute('aria-label', hooks.label('edit'));
        listen(element, 'dblclick', () => hooks.edit(entry.rect.r0, entry.rect.c0), entry);
        listen(
          element,
          'keydown',
          ((event: KeyboardEvent) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              hooks.edit(entry.rect.r0, entry.rect.c0);
            }
          }) as EventListener,
          entry,
        );
      }
      listen(
        element,
        'mousedown',
        ((event: MouseEvent) => {
          if (!(event.target as Element).closest('textarea'))
            hooks.select(entry.rect, 'cell', event);
        }) as EventListener,
        entry,
      );
      listen(
        element,
        'contextmenu',
        ((event: MouseEvent) => {
          event.preventDefault();
          event.stopPropagation();
          cells[entry.rect.r0][entry.rect.c0].dispatchEvent(
            new window.PointerEvent('contextmenu', {
              pointerType: 'mouse',
              bubbles: true,
              cancelable: true,
              clientX: event.clientX,
              clientY: event.clientY,
              button: 2,
              view: window,
            }),
          );
        }) as EventListener,
        entry,
      );
    }
    return entry;
  };
  const clearOverlay = (id: string, entry: Overlay) => {
    entry.cleanup?.();
    entry.listeners.forEach((stop) => stop());
    remove(entry.element);
    overlays.delete(id);
    if (id === 'diagonal') diagonalFields = undefined;
    if (id === 'diagonal') diagonalInitialized = false;
  };
  const layout = () => {
    if (!parent || dead) return;
    const p = parent.getBoundingClientRect();
    for (const entry of overlays.values()) {
      const a = cells[entry.rect.r0]?.[entry.rect.c0]?.getBoundingClientRect(),
        b = cells[entry.rect.r1]?.[entry.rect.c1]?.getBoundingClientRect();
      if (!a || !b) continue;
      const styles = {
        left: `${a.left - p.left + parent.scrollLeft}px`,
        top: `${a.top - p.top + parent.scrollTop}px`,
        width: `${b.right - a.left}px`,
        height: `${b.bottom - a.top}px`,
      };
      const geometry = JSON.stringify(styles);
      if (entry.geometry !== geometry) {
        entry.element.setCssStyles(styles);
        entry.geometry = geometry;
      }
    }
  };
  const fillDiagonal = (entry: Overlay) => {
    if (!data?.diagonal) return;
    const diagonal = data.diagonal;
    if (hooks?.diagonalEdit) {
      if (!diagonalInitialized) {
        const lower =
          diagonalFields?.lower ??
          entry.element.createEl('textarea', {
            cls: 'gt-diagonal-lower gt-diagonal-input',
          });
        const upper =
          diagonalFields?.upper ??
          entry.element.createEl('textarea', {
            cls: 'gt-diagonal-upper gt-diagonal-input',
          });
        diagonalFields = { lower, upper };
        diagonalInitialized = true;
        const commit = () => hooks.diagonalEdit?.(lower.value, upper.value);
        for (const field of [lower, upper]) {
          listen(
            field,
            'focus',
            () => {
              focusedDiagonal = field;
            },
            entry,
          );
          field.spellcheck = false;
          listen(
            field,
            'input',
            ((event: InputEvent) => {
              if (!event.isComposing) commit();
            }) as EventListener,
            entry,
          );
          listen(field, 'compositionend', commit, entry);
          listen(field, 'mousedown', (event) => event.stopPropagation(), entry);
          listen(
            field,
            'keydown',
            ((event: KeyboardEvent) => {
              if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
                event.preventDefault();
                event.stopPropagation();
                hooks.history?.(event.shiftKey);
                queueMicrotask(() => {
                  if (field.isConnected) field.focus();
                });
              } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
                event.preventDefault();
                event.stopPropagation();
                hooks.history?.(true);
                queueMicrotask(() => {
                  if (field.isConnected) field.focus();
                });
              } else if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                field.blur();
              } else if (!event.ctrlKey && !event.metaKey) event.stopPropagation();
            }) as EventListener,
            entry,
          );
        }
      }
      for (const key of ['lower', 'upper'] as const) {
        const field = diagonalFields![key],
          value = diagonal[key].replace(/<br\s*\/?>/gi, '\n').replace(/\\\|/g, '|');
        if (escapeCell(field.value) !== diagonal[key]) field.value = value;
        field.rows = Math.max(1, value.split('\n').length);
        field.setAttribute('aria-label', hooks.label(key));
      }
    } else {
      const text = diagonal.lower + '\u0000' + diagonal.upper;
      if (entry.text !== text) {
        entry.element.empty();
        entry.element.createSpan({
          cls: 'gt-diagonal-lower',
          text: diagonal.lower.replace(/<br\s*\/?>/gi, '\n'),
        });
        entry.element.createSpan({
          cls: 'gt-diagonal-upper',
          text: diagonal.upper.replace(/<br\s*\/?>/gi, '\n'),
        });
        entry.text = text;
      }
    }
  };
  const update = (nextRows: string[][], nextData: Metadata | undefined, nextSettings: Settings) => {
    if (dead) return;
    rows = nextRows;
    data = nextData;
    settings = nextSettings;
    table.classList.toggle('gt-full-width', settings.fullWidth);
    table.classList.add('gt-table');
    for (const [r, row] of cells.entries())
      for (const [c, cell] of row.entries()) {
        cell.classList.add('gt-cell');
        const wanted: Record<string, string> = {};
        const meta = data?.cells[r]?.[c],
          title = !!data && isTitle(data, r, c);
        cell.classList.toggle(
          'gt-colored-background',
          !!(title ? (meta?.titleBackground ?? settings.titleBackground) : meta?.background),
        );
        cell.classList.toggle(
          'gt-colored-text',
          !!(title ? (meta?.titleColor ?? settings.titleColor) : meta?.color),
        );
        cell.classList.toggle('gt-title', title);
        const background = title
          ? meta?.titleBackground || settings.titleBackground || 'var(--background-secondary)'
          : meta?.background;
        const color = title
          ? meta?.titleColor || settings.titleColor || 'var(--text-normal)'
          : meta?.color;
        if (background) {
          wanted['--gt-bg'] = background;
          wanted['background-color'] = background;
        }
        if (color) {
          wanted['--gt-fg'] = color;
          wanted.color = color;
        }
        if (data?.widths[c]) {
          wanted['min-width'] = `${data.widths[c]}px`;
          wanted.width = `${data.widths[c]}px`;
        }
        if (data?.heights[r]) wanted.height = `${data.heights[r]}px`;
        if (
          data &&
          meta?.format &&
          (!title || settings.formatTitles) &&
          !exclusiveInline(rows[r][c])
        ) {
          const output = displayCell(rows, data, r, c, settings);
          let display = displays.get(cell);
          if (!display) {
            display = track(cell.createSpan({ cls: 'gt-display' }));
            displays.set(cell, display);
          }
          fillDisplay(display, output.text, rows[r][c]);
          display.setAttribute('aria-label', output.text);
          display.classList.toggle('gt-bar', output.fraction !== undefined);
          display.classList.toggle('gt-error', !!output.error);
          display.classList.toggle('gt-rating', meta.format.kind === 'rating');
          if (output.fraction !== undefined)
            display.style.setProperty(
              '--gt-bar-color',
              meta.barColor || settings.barColor || 'var(--interactive-accent)',
            );
          if (output.fraction !== undefined)
            display.style.setProperty('--gt-fraction', `${output.fraction * 100}%`);
          wanted['min-width'] =
            `${Math.max(data.widths[c] ?? 0, Math.min(600, output.text.length * 9 + 28))}px`;
          if (meta.format.kind === 'rating') {
            let measure = measures.get(cell);
            if (!measure) {
              measure = track(
                cell.createSpan({ cls: 'gt-rating-measure', attr: { 'aria-hidden': 'true' } }),
              );
              measures.set(cell, measure);
            }
            fillDisplay(measure, output.text, rows[r][c]);
            const measured = measure.getBoundingClientRect().width;
            const fallback =
              output.text.length * (parseFloat(window.getComputedStyle(cell).fontSize) || 16) + 28;
            wanted['min-width'] =
              `${Math.max(data.widths[c] ?? 0, Math.ceil(measured ? measured + 4 : fallback))}px`;
          }
        } else {
          const display = displays.get(cell);
          if (display) {
            remove(display);
            displays.delete(cell);
          }
        }
        if (
          meta?.format?.kind !== 'rating' ||
          (title && !settings.formatTitles) ||
          exclusiveInline(rows[r][c])
        ) {
          const measure = measures.get(cell);
          if (measure) {
            remove(measure);
            measures.delete(cell);
          }
        }
        if (data?.diagonal && r === 0 && c === 0) {
          const texts = [data.diagonal.lower, data.diagonal.upper].map((value) =>
            value.replace(/<br\s*\/?>/gi, '\n'),
          );
          const longest = Math.max(
            ...texts.flatMap((value) => value.split('\n').map((line) => line.length)),
          );
          const fontSize = parseFloat(window.getComputedStyle(cell).fontSize) || 16;
          wanted['min-width'] =
            `${Math.max(data.widths[0] ?? 0, 100, longest * fontSize * 2 + 40)}px`;
          wanted.height = `${Math.max(data.heights[0] ?? 0, 72, texts.reduce((count, text) => count + text.split('\n').length, 0) * 26 + 20)}px`;
        }
        applyStyles(cell, wanted);
      }
    const keep = new Set<string>();
    if (parent && data) {
      for (const rect of data.merges) {
        const id = `merge:${rect.r0}:${rect.r1}:${rect.c0}:${rect.c1}`;
        keep.add(id);
        const entry = makeOverlay(id, rect, 'gt-merge-overlay'),
          anchor = cells[rect.r0][rect.c0];
        entry.element.setCssStyles({
          backgroundColor: anchor.style.getPropertyValue('--gt-bg') || 'var(--background-primary)',
          color: anchor.style.getPropertyValue('--gt-fg') || 'var(--text-normal)',
        });
        entry.element.classList.toggle('gt-title', isTitle(data, rect.r0, rect.c0));
        entry.element.classList.toggle(
          'gt-colored-text',
          anchor.classList.contains('gt-colored-text'),
        );
        entry.element.setCssProps({ '--gt-fg': anchor.style.getPropertyValue('--gt-fg') });
        const output = displayCell(rows, data, rect.r0, rect.c0, settings);
        const rich = !data.cells[rect.r0][rect.c0].format && !!renderMarkdown;
        const contentKey = `${rich}:${output.text}:${rows[rect.r0][rect.c0]}`;
        if (entry.text !== contentKey) {
          entry.cleanup?.();
          entry.cleanup = undefined;
          entry.element.empty();
          if (rich) {
            const target = entry.element.createDiv({ cls: 'gt-merge-content' });
            const cleanup = renderMarkdown?.(output.text, target);
            if (cleanup) entry.cleanup = cleanup;
          } else
            fillDisplay(
              entry.element,
              output.text.replace(/<br\s*\/?>/gi, '\n'),
              rows[rect.r0][rect.c0],
            );
          entry.text = contentKey;
        }
        entry.element.classList.toggle('gt-bar', output.fraction !== undefined);
        entry.element.classList.toggle(
          'gt-rating',
          data.cells[rect.r0][rect.c0].format?.kind === 'rating',
        );
        if (output.fraction !== undefined)
          entry.element.style.setProperty(
            '--gt-bar-color',
            data.cells[rect.r0][rect.c0].barColor ||
              settings.barColor ||
              'var(--interactive-accent)',
          );
        if (output.fraction !== undefined)
          entry.element.style.setProperty('--gt-fraction', `${output.fraction * 100}%`);
      }
      if (data.diagonal) {
        keep.add('diagonal');
        const entry = makeOverlay(
          'diagonal',
          { r0: 0, r1: 0, c0: 0, c1: 0 },
          'gt-diagonal-overlay',
        );
        entry.element.setCssStyles({
          backgroundColor:
            cells[0][0].style.getPropertyValue('--gt-bg') || 'var(--background-primary)',
          color: cells[0][0].style.getPropertyValue('--gt-fg') || 'var(--text-normal)',
        });
        fillDiagonal(entry);
      }
    }
    for (const [id, entry] of overlays) if (!keep.has(id)) clearOverlay(id, entry);
    select(selected);
    focus();
    layout();
  };
  const observer = window.ResizeObserver ? new window.ResizeObserver(layout) : undefined;
  observer?.observe(table);
  update(rows, data, settings);
  if (continuity?.focused && document.activeElement === document.body && data?.diagonal)
    continuity.focused.focus();
  return {
    update,
    select,
    refreshLayout: layout,
    isCurrent: () =>
      !dead &&
      cells.length === table.rows.length &&
      cells.every(
        (row, r) =>
          row.length === table.rows[r].cells.length &&
          row.every((cell, c) => cell === table.rows[r].cells[c]),
      ) &&
      [...added].every((element) => element.isConnected),
    focusDiagonal: () => diagonalFields?.lower.focus(),
    releaseDiagonal: () => {
      const entry = overlays.get('diagonal');
      if (!entry || !diagonalFields) return;
      entry.listeners.forEach((stop) => stop());
      overlays.delete('diagonal');
      added.delete(entry.element);
      const focused =
        focusedDiagonal &&
        (document.activeElement === focusedDiagonal || document.activeElement === document.body)
          ? focusedDiagonal
          : undefined;
      return { element: entry.element, ...diagonalFields, focused };
    },
    dispose: () => {
      if (dead) return;
      dead = true;
      observer?.disconnect();
      disposers.forEach((dispose) => dispose());
      for (const entry of overlays.values()) entry.cleanup?.();
      for (const element of added) element.remove();
      for (const [cell, state] of originals) {
        applyStyles(cell, {});
        restoreClasses(cell, state.className, [
          'gt-cell',
          'gt-title',
          'gt-editing',
          'gt-selected',
          'gt-colored-background',
          'gt-colored-text',
        ]);
        delete cell.dataset.gtRow;
        delete cell.dataset.gtCol;
      }
      restoreClasses(table, tableClass, ['gt-table', 'gt-full-width']);
      if (parent) {
        const ownership = positionedParents.get(parent);
        if (ownership && --ownership.count === 0) {
          if (parent.style.position === 'relative')
            parent.setCssStyles({ position: ownership.position });
          if (!parent.style.length && ownership.style === null) parent.removeAttribute('style');
          positionedParents.delete(parent);
        }
      }
    },
  };
}
