import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { decorateTable } from '../src/render';
import { DEFAULTS, makeMetadata } from '../src/model';
import { ColorPicker, hexToHsv, hsvToHex } from '../src/color-picker';
import { applyFormat, mergeCells } from '../src/operations';
import { closeSubmenuOnExit, watchSelectionBoundary } from '../src/interactions';
import { afterNativeContextMenu, appendMenuGroup, nativeSelection } from '../src/native-table';
function fixture() {
  const window = new Window();
  const document = window.document;
  Object.assign(window.HTMLElement.prototype, {
    createEl(
      this: HTMLElement,
      tag: string,
      options?: { cls?: string; text?: string; type?: string; attr?: Record<string, string> },
    ) {
      const child = this.ownerDocument.createElement(tag);
      if (options?.cls) child.className = options.cls;
      if (options?.text) child.textContent = options.text;
      if (options?.type) child.setAttribute('type', options.type);
      for (const [key, value] of Object.entries(options?.attr ?? {}))
        child.setAttribute(key, value);
      this.append(child);
      return child;
    },
    createDiv(this: HTMLElement, options?: DomElementInfo) {
      return this.createEl('div', options);
    },
    createSpan(this: HTMLElement, options?: DomElementInfo) {
      return this.createEl('span', options);
    },
    setCssStyles(this: HTMLElement, styles: Partial<CSSStyleDeclaration>) {
      Object.assign(this.style, styles);
    },
    setCssProps(this: HTMLElement, styles: Record<string, string>) {
      for (const [key, value] of Object.entries(styles)) this.style.setProperty(key, value);
    },
    empty(this: HTMLElement) {
      this.replaceChildren();
    },
  });
  document.body.innerHTML =
    '<div class="wrapper"><table class="native"><thead><tr><th><strong>A</strong></th><th>B</th></tr></thead><tbody><tr><td>1</td><td>3</td></tr></tbody></table></div>';
  return { window, document, table: document.querySelector('table')! };
}
test('visual formatting leaves original cell nodes, content and native event handlers intact; dispose restores markup', () => {
  const { table, window } = fixture();
  const before = table.outerHTML,
    cell = table.rows[1].cells[0];
  let clicks = 0;
  cell.addEventListener('click', () => clicks++);
  const rows = [
      ['A', 'B'],
      ['1', '3'],
    ],
    m = makeMetadata(rows);
  applyFormat(rows, m, { r0: 1, r1: 1, c0: 0, c1: 1 }, 'row', 'calc', DEFAULTS);
  const render = decorateTable(table as unknown as HTMLTableElement, rows, m, DEFAULTS);
  assert.equal(table.rows[1].cells[0], cell);
  assert.equal(cell.firstChild?.textContent, '1');
  assert.equal(cell.querySelector('.gt-display')?.textContent, '25%');
  cell.dispatchEvent(new window.MouseEvent('click'));
  assert.equal(clicks, 1);
  render.dispose();
  assert.equal(table.outerHTML, before);
});

test('refresh preserves decoration nodes, native width changes, and current focus', () => {
  const { table, document } = fixture();
  const rows = [
      ['A', 'B'],
      ['1', '3'],
    ],
    m = makeMetadata(rows);
  m.widths[0] = 180;
  applyFormat(rows, m, { r0: 1, r1: 1, c0: 0, c1: 0 }, 'cell', 'rating', DEFAULTS);
  const render = decorateTable(table as unknown as HTMLTableElement, rows, m, DEFAULTS);
  const cell = table.rows[1].cells[0],
    display = cell.querySelector('.gt-display');
  const input = document.createElement('input');
  cell.append(input);
  input.focus();
  rows[1][0] = '4';
  render.update(rows, m, DEFAULTS);
  assert.equal(cell.querySelector('.gt-display'), display);
  assert.equal(display?.textContent, '★★★★');
  assert.equal(cell.style.width, '180px');
  assert.equal(document.activeElement, input);
  assert.ok(render.isCurrent());
  cell.style.width = '210px';
  render.update(rows, m, DEFAULTS);
  render.dispose();
  assert.equal(cell.style.width, '210px', 'Release plugin ownership without undoing native layout');
});

test('inline diagonal fields survive updates, respect IME, route history and clean up on toggle', () => {
  const { table, document, window } = fixture();
  const rows = [
      ['A', 'B'],
      ['1', '3'],
    ],
    m = makeMetadata(rows);
  m.diagonal = { lower: 'A', upper: '' };
  const edits: string[][] = [],
    history: boolean[] = [];
  const render = decorateTable(table as unknown as HTMLTableElement, rows, m, DEFAULTS, {
    label: (key) => key,
    select: () => {},
    edit: () => {},
    diagonalEdit: (lower, upper) => edits.push([lower, upper]),
    history: (redo) => history.push(redo),
  });
  const lower = document.querySelector(
    'textarea.gt-diagonal-lower',
  )! as unknown as import('happy-dom').HTMLTextAreaElement;
  lower.focus();
  lower.value = '한글';
  lower.setSelectionRange(1, 1);
  lower.dispatchEvent(new window.InputEvent('input', { isComposing: true, bubbles: true }));
  assert.equal(edits.length, 0);
  lower.dispatchEvent(new window.CompositionEvent('compositionend', { bubbles: true }));
  assert.deepEqual(edits, [['한글', '']]);
  m.diagonal.lower = '한글';
  render.update(rows, m, DEFAULTS);
  assert.equal(document.querySelector('textarea.gt-diagonal-lower'), lower);
  assert.equal(document.activeElement, lower);
  assert.equal(lower.selectionStart, 1);
  lower.dispatchEvent(
    new window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }),
  );
  lower.dispatchEvent(
    new window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true }),
  );
  assert.deepEqual(history, [false, true]);
  delete m.diagonal;
  render.update(rows, m, DEFAULTS);
  assert.equal(document.querySelector('.gt-diagonal-overlay'), null);
  assert.ok(render.isCurrent());
  m.diagonal = { lower: 'again', upper: '' };
  render.update(rows, m, DEFAULTS);
  assert.notEqual(document.querySelector('textarea.gt-diagonal-lower'), lower);
  assert.ok(render.isCurrent());
  render.dispose();
  assert.equal(document.querySelector('textarea'), null);
});

test('color conversion round trips RGB and visible picker synchronizes hue, surface and HEX', () => {
  for (const color of ['#ff0000', '#00ff00', '#0000ff', '#ffffff', '#000000', '#729bf5', '#8f9a7b'])
    assert.equal(hsvToHex(hexToHsv(color)), color);
  const { document, window } = fixture();
  const selected: string[] = [];
  const picker = new ColorPicker(
    document.body as unknown as HTMLElement,
    '#ff0000',
    (value) => selected.push(value),
    { surface: 'SV', hue: 'Hue' },
  );
  Object.defineProperty(picker.surface, 'getBoundingClientRect', {
    value: () => ({ left: 0, top: 0, width: 100, height: 100 }),
  });
  (picker.surface as unknown as import('happy-dom').HTMLElement).dispatchEvent(
    new window.PointerEvent('pointerdown', { button: 0, clientX: 50, clientY: 50 }),
  );
  assert.equal(selected.at(-1), '#804040');
  picker.hue.value = '120';
  (picker.hue as unknown as import('happy-dom').HTMLElement).dispatchEvent(
    new window.Event('input'),
  );
  assert.equal(selected.at(-1), '#408040');
  picker.setColor('#0000ff');
  assert.equal(picker.hue.value, '240');
  (picker.surface as unknown as import('happy-dom').HTMLElement).dispatchEvent(
    new window.KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true }),
  );
  assert.equal(selected.at(-1), '#1919ff');
  assert.equal(document.querySelector('input[type=color]'), null);
});

test('native table replacement transfers the same diagonal inputs and removes obsolete listeners', () => {
  const { table, document, window } = fixture();
  const rows = [
      ['A', 'B'],
      ['1', '3'],
    ],
    m = makeMetadata(rows);
  m.diagonal = { lower: 'A', upper: 'B' };
  let oldEdits = 0,
    newEdits = 0;
  const hooks = {
    label: (key: 'lower' | 'upper' | 'edit') => key,
    select: () => {},
    edit: () => {},
    diagonalEdit: () => {
      oldEdits++;
    },
  };
  const original = table.outerHTML;
  const render = decorateTable(table as unknown as HTMLTableElement, rows, m, DEFAULTS, hooks);
  const lower = document.querySelector(
    'textarea.gt-diagonal-lower',
  )! as unknown as import('happy-dom').HTMLTextAreaElement;
  lower.focus();
  lower.setSelectionRange(1, 1);
  const holder = document.createElement('div');
  holder.innerHTML = original;
  const next = holder.querySelector('table')!;
  table.replaceWith(next);
  const continuity = render.releaseDiagonal();
  render.dispose();
  const replacement = decorateTable(
    next as unknown as HTMLTableElement,
    rows,
    m,
    DEFAULTS,
    {
      ...hooks,
      diagonalEdit: () => {
        newEdits++;
      },
    },
    undefined,
    continuity,
  );
  assert.equal(document.querySelector('textarea.gt-diagonal-lower'), lower);
  assert.equal(lower.selectionStart, 1);
  lower.dispatchEvent(new window.InputEvent('input', { bubbles: true }));
  assert.equal(oldEdits, 0);
  assert.equal(newEdits, 1);
  assert.ok(replacement.isCurrent());
  replacement.dispose();
  assert.equal(document.querySelector('.gt-diagonal-overlay'), null);
});
test('merge across Markdown header boundary is drawn without changing native thead/tbody geometry', () => {
  const { table } = fixture();
  const rows = [
      ['A', 'B'],
      ['1', '3'],
    ],
    m = makeMetadata(rows);
  mergeCells(m, { r0: 0, r1: 1, c0: 0, c1: 0 });
  const render = decorateTable(table as unknown as HTMLTableElement, rows, m, DEFAULTS);
  assert.equal(table.querySelector('thead')?.children.length, 1);
  assert.equal(table.querySelector('tbody')?.children.length, 1);
  assert.equal(table.rows[0].cells[0].rowSpan, 1);
  assert.equal(table.parentElement?.querySelector('.gt-merge-overlay')?.textContent, 'A');
  render.dispose();
  assert.equal(table.parentElement?.querySelector('.gt-merge-overlay'), null);
});

test('decoration adds no numbered handles and preserves native selector nodes and gestures', () => {
  const { table, document, window } = fixture();
  const handle = document.createElement('div');
  handle.className = 'table-row-drag-handle';
  table.rows[1].cells[0].append(handle);
  let gestures = 0;
  handle.addEventListener('pointerdown', (event) => {
    assert.equal(event.defaultPrevented, false);
    gestures++;
  });
  const render = decorateTable(
    table as unknown as HTMLTableElement,
    [
      ['A', 'B'],
      ['1', '3'],
    ],
    undefined,
    DEFAULTS,
    {
      label: (key) => key,
      select: () => {},
      edit: () => {},
    },
  );
  assert.equal(table.querySelector('.gt-row-handle,.gt-column-handle'), null);
  assert.equal(table.querySelector('.gt-resize-row,.gt-resize-column'), null);
  assert.equal(table.querySelector('.table-row-drag-handle'), handle);
  handle.dispatchEvent(
    new window.PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }),
  );
  assert.equal(gestures, 1);
  render.dispose();
  assert.equal(table.querySelector('.table-row-drag-handle'), handle);
});

test('refresh/dispose preserves new native selection, active handle and inline layout state', () => {
  const { table } = fixture();
  const rows = [
    ['A', 'B'],
    ['1', '3'],
  ];
  const m = makeMetadata(rows);
  m.widths[0] = 140;
  const cell = table.rows[1].cells[0];
  const render = decorateTable(table as unknown as HTMLTableElement, rows, m, DEFAULTS);
  cell.classList.add('is-selected', 'start', 'mod-active-row-handle');
  table.classList.add('native-dragging');
  cell.style.width = '180px';
  cell.style.setProperty('text-align', 'right');
  render.dispose();
  assert.equal(cell.className, 'is-selected start mod-active-row-handle');
  assert.equal(table.className, 'native native-dragging');
  assert.equal(cell.style.width, '180px');
  assert.equal(cell.style.textAlign, 'right');
  assert.equal(cell.style.minWidth, '');
  const again = decorateTable(table as unknown as HTMLTableElement, rows, m, DEFAULTS);
  assert.ok(cell.classList.contains('is-selected'));
  cell.classList.remove('is-selected', 'start');
  again.dispose();
  assert.equal(
    cell.classList.contains('is-selected'),
    false,
    'Must not resurrect a cleared native selection',
  );
});

test('native selection maps full rows/columns and rejects disconnected shapes', () => {
  const { table } = fixture();
  table.rows[1].cells[0].classList.add('is-selected');
  table.rows[1].cells[1].classList.add('is-selected');
  assert.deepEqual(nativeSelection(table as unknown as HTMLTableElement), {
    rect: { r0: 1, r1: 1, c0: 0, c1: 1 },
    axis: 'row',
  });
  table.rows[1].cells[1].classList.remove('is-selected');
  table.rows[0].cells[0].classList.add('is-selected');
  assert.equal(nativeSelection(table as unknown as HTMLTableElement)?.axis, 'column');
  table.rows[0].cells[0].classList.remove('is-selected');
  table.rows[0].cells[1].classList.add('is-selected');
  assert.equal(nativeSelection(table as unknown as HTMLTableElement), undefined);
});

test('context extension waits through capture microtasks for the complete native menu event', async () => {
  const { window } = fixture();
  const event = new window.MouseEvent('contextmenu', { cancelable: true, view: window });
  let appended = 0;
  afterNativeContextMenu(event as unknown as Event, () => appended++);
  await Promise.resolve();
  assert.equal(event.defaultPrevented, false);
  assert.equal(appended, 0, 'Capture microtasks must not suppress native table listeners');
  event.preventDefault(); // The later native cell/bubble handler creates its menu.
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(appended, 1);
  const unhandled = new window.MouseEvent('contextmenu', { cancelable: true, view: window });
  afterNativeContextMenu(unhandled as unknown as Event, () => appended++);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(appended, 1, 'Do not create a replacement menu for an unhandled native event');
});

test('appending a section to an already displayed menu preserves every native group and callback node', () => {
  const { document } = fixture();
  const dom = document.createElement('div');
  dom.className = 'menu';
  const scrollEl = document.createElement('div');
  dom.append(scrollEl);
  const native = document.createElement('div');
  native.className = 'menu-group';
  native.innerHTML =
    '<div class="menu-item has-submenu">Native format</div><div class="menu-item">Native clipboard</div>';
  scrollEl.append(native);
  document.body.append(dom);
  const before = native.outerHTML;
  const separator = document.createElement('div');
  separator.className = 'menu-separator';
  const own = document.createElement('div');
  own.className = 'menu-item';
  own.textContent = 'Good Tables';
  const entries = [
    { dom: native.firstElementChild },
    { dom: native.lastElementChild },
    { dom: separator },
    { section: 'good-tables', dom: own },
  ];
  const menu = { dom, scrollEl, items: entries } as unknown as Parameters<
    typeof appendMenuGroup
  >[0];
  appendMenuGroup(menu, 'good-tables');
  assert.equal(native.outerHTML, before);
  assert.equal(scrollEl.firstElementChild, native);
  assert.equal(scrollEl.children[1], separator);
  assert.equal(scrollEl.lastElementChild?.firstElementChild, own);
  assert.equal(menu.items, entries);
  appendMenuGroup(menu, 'good-tables');
  assert.equal(scrollEl.children.length, 3, 'Repeated refresh must not duplicate groups');
});
test('formatted text is inserted as text rather than executable HTML', () => {
  const { table } = fixture();
  const rows = [
      ['A', 'B'],
      ['1', '3'],
    ],
    m = makeMetadata(rows);
  applyFormat(rows, m, { r0: 1, r1: 1, c0: 0, c1: 1 }, 'row', 'custom', DEFAULTS, {
    prefix: '<img src=x onerror=alert(1)>',
    suffix: '',
  });
  const render = decorateTable(table as unknown as HTMLTableElement, rows, m, DEFAULTS);
  assert.equal(table.querySelectorAll('img').length, 0);
  assert.ok(table.querySelector('.gt-display')?.textContent?.includes('<img'));
  render.dispose();
});

test('rating returns after blur even when the native cell editor remains mounted', async () => {
  const { table, document, window } = fixture();
  const rows = [
    ['A', 'B'],
    ['4', '3'],
  ];
  const m = makeMetadata(rows);
  applyFormat(rows, m, { r0: 1, r1: 1, c0: 0, c1: 0 }, 'cell', 'rating', DEFAULTS);
  const cell = table.rows[1].cells[0];
  const native = document.createElement('div');
  native.className = 'cm-editor';
  const input = document.createElement('input');
  native.append(input);
  cell.append(native);
  const outside = document.createElement('button');
  document.body.append(outside);
  const render = decorateTable(table as unknown as HTMLTableElement, rows, m, DEFAULTS);
  assert.equal(cell.classList.contains('gt-editing'), false);
  input.focus();
  assert.equal(cell.classList.contains('gt-editing'), true);
  outside.focus();
  await Promise.resolve();
  assert.equal(cell.querySelector('.cm-editor'), native);
  assert.equal(cell.classList.contains('gt-editing'), false);
  assert.equal(cell.querySelector('.gt-display')?.textContent, '★★★★');
  input.focus();
  outside.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
  assert.equal(cell.classList.contains('gt-editing'), false);
  render.dispose();
});

test('table range clears for outside clicks, keyboard focus and app blur, but survives a context menu', async () => {
  const { table, document, window } = fixture();
  const outside = document.createElement('button');
  const menu = document.createElement('div');
  menu.className = 'menu';
  const command = document.createElement('button');
  menu.append(command);
  document.body.append(outside, menu);
  const input = document.createElement('input');
  table.rows[1].cells[0].append(input);
  let cleared = 0;
  const dispose = watchSelectionBoundary(
    document as unknown as Document,
    (target) => table.contains(target as never),
    () => cleared++,
  );
  input.focus();
  input.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
  input.blur();
  await Promise.resolve();
  assert.equal(cleared, 0, 'Transient native editor blur must retain a drag range');
  input.focus();
  command.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
  command.focus();
  await Promise.resolve();
  assert.equal(cleared, 0);
  outside.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
  assert.equal(cleared, 1);
  outside.focus();
  await Promise.resolve();
  assert.ok(cleared >= 2);
  const before = cleared;
  window.dispatchEvent(new window.Event('blur'));
  assert.equal(cleared, before + 1);
  dispose();
  outside.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
  window.dispatchEvent(new window.Event('blur'));
  assert.equal(cleared, before + 1);
});

test('submenu stays open across its gap, then closes when the pointer leaves both regions', async () => {
  const { document, window } = fixture();
  const root = document.createElement('div');
  const owner = document.createElement('div');
  root.append(owner);
  const submenu = document.createElement('div');
  const command = document.createElement('button');
  submenu.append(command);
  document.body.append(root, submenu);
  let closed = 0,
    disposed = 0;
  const stop = closeSubmenuOnExit(
    owner as unknown as HTMLElement,
    submenu as unknown as HTMLElement,
    () => closed++,
    25,
    () => disposed++,
  );
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  owner.dispatchEvent(new window.MouseEvent('mouseenter'));
  owner.dispatchEvent(new window.MouseEvent('mouseleave', { relatedTarget: document.body }));
  await wait(5);
  submenu.dispatchEvent(new window.MouseEvent('mouseenter'));
  command.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true }));
  await wait(40);
  assert.equal(closed, 0);
  submenu.dispatchEvent(new window.MouseEvent('mouseleave', { relatedTarget: document.body }));
  document.body.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true }));
  await wait(40);
  assert.equal(closed, 1);
  owner.dispatchEvent(new window.MouseEvent('mouseenter'));
  owner.dispatchEvent(new window.MouseEvent('mouseleave', { relatedTarget: document.body }));
  root.remove();
  await wait(40);
  assert.equal(disposed, 1);
  assert.equal(closed, 1);
  // The caller may also dispose while unloading the plugin.
  stop();
  assert.equal(disposed, 1);
});

test('native menu extension uses the event owner window timer', async () => {
  const { window } = fixture();
  const schedule = window.setTimeout.bind(window);
  let scheduled = 0,
    appended = 0;
  window.setTimeout = (...args) => {
    scheduled++;
    return schedule(...args);
  };
  const event = new window.MouseEvent('contextmenu', { cancelable: true, view: window });
  event.preventDefault();
  afterNativeContextMenu(event as unknown as Event, () => appended++);
  assert.equal(scheduled, 1, 'The context menu must use its own popout timer');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(appended, 1);
  window.close();
});
test('submenu timers and cancellation belong to the menu owner window', async () => {
  const { window, document } = fixture();
  const owner = document.createElement('div');
  const submenu = document.createElement('div');
  document.body.append(owner, submenu);
  let scheduled = 0,
    cancelled = 0,
    closed = 0;
  const schedule = window.setTimeout.bind(window);
  const cancel = window.clearTimeout.bind(window);
  window.setTimeout = (...args) => {
    scheduled++;
    return schedule(...args);
  };
  window.clearTimeout = (...args) => {
    cancelled++;
    cancel(...args);
  };
  const dispose = closeSubmenuOnExit(
    owner as unknown as HTMLElement,
    submenu as unknown as HTMLElement,
    () => closed++,
    20,
  );
  owner.dispatchEvent(new window.MouseEvent('mouseenter'));
  owner.dispatchEvent(new window.MouseEvent('mouseleave', { relatedTarget: document.body }));
  submenu.dispatchEvent(new window.MouseEvent('mouseenter'));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(scheduled, 1);
  assert.ok(cancelled >= 1);
  assert.equal(closed, 0);
  dispose();
  window.close();
});
