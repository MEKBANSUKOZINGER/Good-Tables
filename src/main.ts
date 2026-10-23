import {
  Component,
  Editor,
  MarkdownPostProcessorContext,
  MarkdownRenderChild,
  MarkdownRenderer,
  MarkdownView,
  Menu,
  MenuItem,
  Notice,
  Plugin,
  editorInfoField,
  editorLivePreviewField,
  getLanguage,
} from 'obsidian';
import { EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { forceParsing } from '@codemirror/language';
import {
  Axis,
  FormatKind,
  Metadata,
  Rect,
  Settings,
  TableError,
  DEFAULTS,
  normalizeSettings,
  positions,
  isTitle,
  makeMetadata,
} from './model';
import {
  Table,
  escapeCell,
  metadataBlock,
  reconcile,
  scanTables,
  serializeEdit,
  serializeRows,
  values,
} from './markdown';
import {
  applyFormat,
  checkRect,
  colorCells,
  editCell,
  mergeCells,
  pasteCells,
  structure,
  toggleDiagonal,
  toggleTitle,
  unmergeCells,
} from './operations';
import { Message, translator } from './i18n';
import { ColorModal, FormModal, confirmModal } from './dialogs';
import { Decorated, decorateTable } from './render';
import { GoodTablesSettings } from './settings';
import { metadataField } from './metadata-view';
import { closeSubmenuOnExit, watchSelectionBoundary } from './interactions';
import {
  afterNativeContextMenu,
  appendMenuGroup,
  nativeMovement,
  MenuDOM,
  nativeSelection,
} from './native-table';
import { metadataSynchronization } from './metadata-sync';

interface Binding {
  element: HTMLTableElement;
  table: Table;
  source: string;
  editor: Editor;
  cm: EditorView;
  controller: Controller;
  decorated: Decorated;
  rect: Rect;
  axis: Axis;
  native?: boolean;
}
type Mutation = (rows: string[][], m: Metadata, a: Rect) => void;
interface ContextMenuRequest {
  binding: Binding;
  menu?: Menu;
}
class Controller {
  bindings: Binding[] = [];
  private timer: number | undefined;
  private observer: MutationObserver;
  private dragging: { binding: Binding; r: number; c: number } | undefined;
  private dead = false;
  private down: (e: MouseEvent) => void;
  private move: (e: MouseEvent) => void;
  private up: () => void;
  private context: (e: MouseEvent) => void;
  private paste: (e: ClipboardEvent) => void;
  private releaseSelection: () => void;
  private pointerDown: (e: PointerEvent) => void;
  private nativeIntent:
    | {
        id: string;
        row: number;
        col: number;
        widget: { editor?: { tableCell?: { cell?: { row: number; col: number } } } };
      }
    | undefined;
  private cancelNativeMove = (e: KeyboardEvent) => {
    if (e.key === 'Escape' || !this.view.dom.ownerDocument.querySelector('.menu'))
      this.nativeIntent = undefined;
  };
  constructor(
    private p: GoodTables,
    public view: EditorView,
  ) {
    p.controllers.add(this);
    this.observer = new MutationObserver((records) => {
      if (
        records.some(
          (record) =>
            record.type === 'attributes' &&
            (record.oldValue?.split(/\s+/).includes('is-selected') ?? false) !==
              (record.target as Element).classList.contains('is-selected'),
        )
      )
        this.syncNativeSelection();
      if (
        records.some((record) => {
          const target =
            record.target.nodeType === 1 ? (record.target as Element) : record.target.parentElement;
          if (target?.closest('.gt-display,.gt-merge-overlay,.gt-diagonal-overlay')) return false;
          return [...record.addedNodes, ...record.removedNodes].some(
            (n) =>
              n.nodeType === 3 ||
              (n.nodeType === 1 && !(n as Element).className.toString().startsWith('gt-')),
          );
        })
      )
        this.schedule();
    });
    this.observe();
    this.pointerDown = (e) => {
      this.nativeIntent = undefined;
      const target = e.target as Element;
      const handle = target.closest?.('.table-row-drag-handle,.table-col-drag-handle');
      if (!handle || e.button !== 0) return;
      const found = this.cell(handle);
      if (!found) return;
      const { binding: b, r, c } = found;
      this.rememberMove(b, r, c);
      const axis = handle.classList.contains('table-row-drag-handle') ? 'row' : 'column';
      // Observe the native gesture without preventing its selection/reorder handlers.
      this.select(
        b,
        axis === 'row'
          ? { r0: r, r1: r, c0: 0, c1: b.element.rows[0].cells.length - 1 }
          : { r0: 0, r1: b.element.rows.length - 1, c0: c, c1: c },
        axis,
      );
      queueMicrotask(() => {
        if (!this.dead) this.syncNativeSelection();
      });
    };
    this.down = (e) => {
      if (
        (e.target as Element)?.closest(
          '.table-row-drag-handle,.table-col-drag-handle,.gt-resize-row,.gt-resize-column,.gt-merge-overlay,.gt-diagonal-overlay',
        )
      )
        return;
      const found = this.cell(e.target);
      if (!found) {
        if (this.p.active?.controller === this) {
          this.p.active.decorated.select(null);
          this.p.active = undefined;
        }
        return;
      }
      const { binding: b, r, c } = found;
      if (
        e.button === 2 &&
        this.p.active === b &&
        r >= b.rect.r0 &&
        r <= b.rect.r1 &&
        c >= b.rect.c0 &&
        c <= b.rect.c1
      ) {
        this.p.active = b;
        return;
      }
      const rect =
        e.shiftKey && this.p.active === b
          ? {
              r0: Math.min(b.rect.r0, r),
              r1: Math.max(b.rect.r1, r),
              c0: Math.min(b.rect.c0, c),
              c1: Math.max(b.rect.c1, c),
            }
          : { r0: r, r1: r, c0: c, c1: c };
      this.select(b, rect, 'cell');
      if (e.button === 0) this.dragging = { binding: b, r, c };
    };
    this.move = (e) => {
      if (!this.dragging || !(e.buttons & 1)) return;
      const found = this.cell(e.target);
      if (!found || found.binding !== this.dragging.binding) return;
      const { r, c } = this.dragging;
      this.select(
        found.binding,
        {
          r0: Math.min(r, found.r),
          r1: Math.max(r, found.r),
          c0: Math.min(c, found.c),
          c1: Math.max(c, found.c),
        },
        'cell',
      );
    };
    this.up = () => {
      this.dragging = undefined;
      this.syncNativeSelection();
    };
    this.context = (e) => {
      const found = this.cell(e.target);
      this.p.contextBinding = found?.binding;
      if (!found) return;
      const { binding: b, r, c } = found;
      this.rememberMove(b, r, c);
      const target = e.target as Element;
      const preferred = target.closest('.table-row-drag-handle')
        ? 'row'
        : target.closest('.table-col-drag-handle')
          ? 'column'
          : b.axis;
      const selected = nativeSelection(b.element, preferred);
      const handle = target.closest('.table-row-drag-handle,.table-col-drag-handle');
      if (handle) {
        this.select(
          b,
          preferred === 'row'
            ? { r0: r, r1: r, c0: 0, c1: b.element.rows[0].cells.length - 1 }
            : { r0: 0, r1: b.element.rows.length - 1, c0: c, c1: c },
          preferred,
        );
      } else if (
        selected &&
        r >= selected.rect.r0 &&
        r <= selected.rect.r1 &&
        c >= selected.rect.c0 &&
        c <= selected.rect.c1
      ) {
        b.native = true;
        this.select(b, selected.rect, selected.axis);
      } else if (
        this.p.active !== b ||
        !(r >= b.rect.r0 && r <= b.rect.r1 && c >= b.rect.c0 && c <= b.rect.c1)
      ) {
        b.native = false;
        this.select(b, { r0: r, r1: r, c0: c, c1: c }, 'cell');
      }
      this.p.active = b;
      const contextBinding = { ...b, rect: { ...b.rect } };
      const request: ContextMenuRequest = { binding: contextBinding };
      this.p.contextRequest = request;
      // Let every native handler and editor-menu listener finish first. Reuse
      // that exact event's menu; never replace it with a separate table menu.
      afterNativeContextMenu(
        e,
        () => {
          if (!this.dead && b.element.isConnected)
            this.p.menu(request.menu ?? Menu.forEvent(e), b.editor, contextBinding);
        },
        () => {
          if (this.p.contextRequest === request) this.p.contextRequest = undefined;
          return !!request.menu || e.defaultPrevented;
        },
      );
    };
    this.paste = (e) => {
      const b = this.p.active;
      if (
        !b ||
        b.controller !== this ||
        !b.element.contains(e.target as Node) ||
        (b.rect.r0 === b.rect.r1 && b.rect.c0 === b.rect.c1)
      )
        return;
      const text = e.clipboardData?.getData('text/plain');
      // Obsidian's own table clipboard carries structure/alignment information.
      if (e.clipboardData?.types.includes('obsidian/table')) return;
      if (text === undefined) return;
      e.preventDefault();
      e.stopPropagation();
      this.p.apply(b, (rows, m, a) => pasteCells(rows, m, a, text));
    };
    view.dom.addEventListener('pointerdown', this.pointerDown, true);
    view.dom.addEventListener('mousedown', this.down, true);
    view.dom.addEventListener('mouseover', this.move, true);
    view.dom.ownerDocument.addEventListener('mouseup', this.up);
    view.dom.ownerDocument.addEventListener('keydown', this.cancelNativeMove);
    view.dom.addEventListener('contextmenu', this.context, true);
    view.dom.addEventListener('paste', this.paste, true);
    this.releaseSelection = watchSelectionBoundary(
      view.dom.ownerDocument,
      (target) =>
        this.bindings.some(
          (b) =>
            b.element.contains(target) ||
            (target as Element).closest?.('.gt-merge-overlay,.gt-diagonal-overlay')
              ?.parentElement === b.element.parentElement,
        ),
      () => {
        const b = this.p.active;
        if (!b || b.controller !== this) return;
        b.decorated.select(null);
        this.p.active = undefined;
        if (this.p.contextBinding?.controller === this) this.p.contextBinding = undefined;
        this.dragging = undefined;
      },
    );
    this.schedule();
  }
  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged || update.geometryChanged) this.schedule();
  }
  rememberMove(b: Binding, row: number, col: number): void {
    const container = b.element.closest<
      HTMLElement & { cmTile?: { widget?: NonNullable<Controller['nativeIntent']>['widget'] } }
    >('.cm-table-widget');
    const widget = container?.cmTile?.widget;
    this.nativeIntent =
      widget && b.table.metadata ? { id: b.table.metadata.id, row, col, widget } : undefined;
  }
  movement(old: Table, current: Table) {
    const intent = this.nativeIntent,
      destination = intent?.widget.editor?.tableCell?.cell;
    if (!intent || intent.id !== old.metadata?.id || !destination) return;
    const result = nativeMovement(values(old), values(current), intent, destination);
    if (result) this.nativeIntent = undefined;
    return result;
  }
  private observe(): void {
    this.observer.observe(this.view.dom, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class'],
      attributeOldValue: true,
    });
  }
  private syncNativeSelection(): void {
    for (const b of this.bindings) {
      const selected = nativeSelection(b.element, b.axis);
      if (selected) {
        b.native = true;
        b.rect = selected.rect;
        b.axis = selected.axis;
        if (this.p.active === b || b.element.contains(b.element.ownerDocument.activeElement))
          this.select(b, selected.rect, selected.axis);
      } else if (b.native) {
        b.native = false;
        b.decorated.select(null);
        if (this.p.active === b) {
          this.p.active = undefined;
        }
      }
    }
  }
  schedule(): void {
    if (this.dead) return;
    const window = this.view.dom.ownerDocument.defaultView!;
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.refresh(), 60);
  }
  private cell(target: EventTarget | null): { binding: Binding; r: number; c: number } | undefined {
    const td = (target as Element | null)?.closest?.('td,th') as HTMLTableCellElement | null;
    if (!td) return;
    const binding = this.bindings.find((b) => b.element === td.closest('table'));
    if (!binding) return;
    const r = Number(td.dataset.gtRow),
      c = Number(td.dataset.gtCol);
    if (!Number.isInteger(r) || !Number.isInteger(c)) return;
    return { binding, r, c };
  }
  private select(b: Binding, a: Rect, axis: Axis): void {
    if (this.p.active && this.p.active !== b) this.p.active.decorated.select(null);
    b.rect = a;
    b.axis = axis;
    b.decorated.select(a);
    this.p.active = b;
  }
  refresh(): void {
    if (this.dead) return;
    this.observer.disconnect();
    const previous = this.bindings;
    this.bindings = [];
    for (const b of previous) b.decorated.dispose();
    try {
      if (!this.view.state.field(editorLivePreviewField, false)) return;
      // Hidden extension data can leave the incremental syntax tree behind the
      // visible viewport. Let the native parser catch up before finding widgets.
      forceParsing(this.view, Math.min(this.view.state.doc.length, this.view.viewport.to + 1), 20);
      const editor = this.view.state.field(editorInfoField, false)?.editor;
      if (!editor) return;
      const source = editor.getValue(),
        tables = scanTables(source);
      for (const element of this.view.dom.querySelectorAll<HTMLTableElement>('table')) {
        if (element.closest('.internal-embed')) continue;
        let offset: number;
        try {
          offset = this.view.posAtDOM(element);
        } catch {
          continue;
        }
        const matches = tables.filter((t) => offset >= t.from - 1 && offset <= t.to);
        if (matches.length !== 1) continue;
        const table = matches[0];
        let data: Metadata | undefined;
        try {
          data = reconcile(table);
        } catch {
          /* Preserve stale/invalid data, render native table. */
        }
        const old = previous.find((b) =>
          table.metadata?.id
            ? b.table.metadata?.id === table.metadata.id
            : b.table.from === table.from,
        );
        const b: Binding = {
          element,
          table,
          source,
          editor,
          cm: this.view,
          controller: this,
          rect: old?.rect ?? { r0: 0, r1: 0, c0: 0, c1: 0 },
          axis: old?.axis ?? 'cell',
          native: old?.native,
          decorated: { dispose: () => {}, select: () => {}, refreshLayout: () => {} },
        };
        try {
          checkRect(values(table), b.rect);
        } catch {
          b.rect = { r0: 0, r1: 0, c0: 0, c1: 0 };
          b.axis = 'cell';
        }
        const component = new Component();
        component.load();
        const path = this.view.state.field(editorInfoField, false)?.file?.path ?? '';
        b.decorated = decorateTable(
          element,
          values(table),
          data,
          this.p.settings,
          {
            label: (key) => this.p.t(key),
            select: (a, axis, event) => {
              if (event.shiftKey && this.p.active === b && axis === b.axis) {
                a = {
                  r0: Math.min(a.r0, b.rect.r0),
                  r1: Math.max(a.r1, b.rect.r1),
                  c0: Math.min(a.c0, b.rect.c0),
                  c1: Math.max(a.c1, b.rect.c1),
                };
              }
              this.select(b, a, axis);
            },
            edit: (r, c) => this.p.edit(b, r, c),
            resize: (axis, index, size) =>
              this.p.apply(b, (_, m) => {
                m[axis === 'row' ? 'heights' : 'widths'][index] = size;
              }),
          },
          (text, target) => {
            void MarkdownRenderer.render(this.p.app, text, target, path, component);
          },
        );
        const dispose = b.decorated.dispose;
        b.decorated.dispose = () => {
          component.unload();
          dispose();
        };
        this.bindings.push(b);
        if (old && this.p.active === old) {
          this.p.active = b;
          b.decorated.select(b.rect);
        }
      }
    } finally {
      if (!this.dead) this.observe();
    }
  }
  destroy(): void {
    this.dead = true;
    this.releaseSelection();
    this.view.dom.ownerDocument.defaultView!.clearTimeout(this.timer);
    this.observer.disconnect();
    this.nativeIntent = undefined;
    this.bindings.forEach((b) => b.decorated.dispose());
    if (this.bindings.includes(this.p.active!)) this.p.active = undefined;
    if (this.p.contextRequest?.binding.controller === this) this.p.contextRequest = undefined;
    if (this.p.contextBinding?.controller === this) this.p.contextBinding = undefined;
    this.view.dom.removeEventListener('mousedown', this.down, true);
    this.view.dom.removeEventListener('pointerdown', this.pointerDown, true);
    this.view.dom.removeEventListener('mouseover', this.move, true);
    this.view.dom.removeEventListener('contextmenu', this.context, true);
    this.view.dom.removeEventListener('paste', this.paste, true);
    this.view.dom.ownerDocument.removeEventListener('mouseup', this.up);
    this.view.dom.ownerDocument.removeEventListener('keydown', this.cancelNativeMove);
    this.p.controllers.delete(this);
  }
}
export default class GoodTables extends Plugin {
  settings: Settings = structuredClone(DEFAULTS);
  controllers = new Set<Controller>();
  active: Binding | undefined;
  contextBinding: Binding | undefined;
  contextRequest: ContextMenuRequest | undefined;
  private readings = new Set<{ refresh: () => void; dispose: () => void }>();
  private quitting = false;
  private enhancedMenus = new WeakSet<Menu>();
  private submenuDisposers = new Set<() => void>();
  get t(): (key: Message) => string {
    return translator(this.settings, getLanguage());
  }
  async onload(): Promise<void> {
    this.settings = normalizeSettings(await this.loadData());
    this.registerEditorExtension(metadataField);
    this.registerEditorExtension(
      metadataSynchronization((tr) => {
        const controller = [...this.controllers].find((c) => c.view.state === tr.startState);
        return controller ? (old, current) => controller.movement(old, current) : undefined;
      }),
    );
    this.registerEditorExtension(
      ViewPlugin.define((view) => {
        const controller = new Controller(this, view);
        return {
          update: (update: ViewUpdate) => controller.update(update),
          destroy: () => controller.destroy(),
        };
      }),
    );
    this.addCommand({
      id: 'create-table',
      name: this.t('create'),
      editorCallback: (editor) =>
        this.create(this.app.workspace.getActiveViewOfType(MarkdownView)?.editor ?? editor),
    });
    this.addCommand({
      id: 'reset-table',
      name: this.t('reset'),
      editorCallback: (editor) =>
        this.reset(this.app.workspace.getActiveViewOfType(MarkdownView)?.editor ?? editor),
    });
    this.addRibbonIcon('table-2', 'Good Tables: ' + this.t('create'), () => {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (view?.getMode() === 'source') this.create(view.editor);
      else new Notice(this.t('readonly'));
    });
    this.addSettingTab(new GoodTablesSettings(this.app, this));
    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu, _editor, info) => {
        const request = this.contextRequest;
        if (request && info.file === request.binding.cm.state.field(editorInfoField, false)?.file)
          request.menu = menu;
      }),
    );
    this.registerEvent(this.app.workspace.on('quit', () => (this.quitting = true)));
    this.registerMarkdownPostProcessor((el, ctx) => this.reading(el, ctx));
  }
  onunload(): void {
    for (const dispose of this.submenuDisposers) dispose();
    for (const c of [...this.controllers]) c.destroy();
    for (const r of [...this.readings]) r.dispose();
    if (this.settings.warned && !this.quitting) new Notice(this.t('warn'), 10000);
  }
  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    for (const c of this.controllers) c.schedule();
    for (const r of this.readings) r.refresh();
  }
  private warn(): void {
    if (this.settings.warned) return;
    this.settings.warned = true;
    void this.saveData(this.settings);
    confirmModal(this.app, this.t, this.t('warningTitle'), this.t('warn'), () => {});
  }
  private fail(error: unknown): void {
    const code = error instanceof TableError ? error.code : 'error';
    const alias = code === 'size' ? 'sizeError' : code === 'title' ? 'titleError' : code;
    new Notice(this.t(alias as Message) || this.t('error'), 8000);
    if (!(error instanceof TableError)) console.error('Good Tables', error);
  }
  private locate(b: Binding): { table: Table; source: string } {
    const source = b.editor.getValue(),
      tables = scanTables(source);
    const expected = b.source.slice(b.table.from, b.table.metadataTo ?? b.table.to);
    const matches = tables.filter((t) => source.slice(t.from, t.metadataTo ?? t.to) === expected);
    const table =
      source === b.source
        ? tables.find((t) => t.from === b.table.from)
        : matches.length === 1
          ? matches[0]
          : undefined;
    if (!table) throw new TableError('conflict');
    return { table, source };
  }
  apply(b: Binding, mutate: Mutation): void {
    try {
      const { table } = this.locate(b),
        rows = values(table),
        m = reconcile(table);
      checkRect(rows, b.rect);
      mutate(rows, m, b.rect);
      const text = serializeEdit(table, rows, m);
      b.editor.transaction(
        {
          changes: [
            {
              from: b.editor.offsetToPos(table.from),
              to: b.editor.offsetToPos(table.metadataTo ?? table.to),
              text,
            },
          ],
        },
        'good-tables',
      );
      this.warn();
      b.controller.schedule();
    } catch (error) {
      this.fail(error);
    }
  }
  create(editor: Editor): void {
    const original = editor.getValue();
    let cursor = editor.getCursor();
    const t = this.t;
    const at = editor.posToOffset(cursor),
      inside = scanTables(original).find((table) => at >= table.from && at <= table.to);
    if (inside) cursor = editor.offsetToPos(inside.metadataTo ?? inside.to);
    new FormModal(
      this.app,
      t('create'),
      (modal) => {
        const rows = modal.number(t('rows'), this.settings.rows),
          cols = modal.number(t('columns'), this.settings.columns),
          diagonal = modal.toggle(t('diagonal'), this.settings.diagonal);
        return () => {
          try {
            const nr = Number(rows.value),
              nc = Number(cols.value);
            if (
              !Number.isInteger(nr) ||
              !Number.isInteger(nc) ||
              nr < 1 ||
              nc < 1 ||
              nr > 100 ||
              nc > 100 ||
              nr * nc > 5000
            )
              throw new TableError('size');
            if (editor.getValue() !== original) throw new TableError('conflict');
            const data = Array.from({ length: nr }, () => Array<string>(nc).fill(''));
            const m = makeMetadata(data);
            if (diagonal()) m.diagonal = { lower: '', upper: '' };
            const at = editor.posToOffset(cursor),
              eol = original.includes('\r\n') ? '\r\n' : '\n';
            const before = original.slice(0, at);
            const lead =
              before && !before.endsWith(eol + eol) ? (before.endsWith(eol) ? eol : eol + eol) : '';
            const text =
              lead + serializeRows(data, '', eol) + eol + eol + metadataBlock(m) + eol + eol;
            // Keep the initial cursor outside the newly inserted table so Obsidian can
            // immediately replace its Markdown with its native table widget.
            const preceding = (before + text).slice(0, at + text.length - eol.length).split('\n');
            const target = {
              line: preceding.length - 1,
              ch: preceding[preceding.length - 1].length,
            };
            editor.transaction(
              { changes: [{ from: cursor, text }], selection: { from: target } },
              'good-tables',
            );
            modal.close();
            editor.setCursor(target);
            editor.focus();
            editor.scrollIntoView({ from: target, to: target }, true);
            if (diagonal()) this.warn();
          } catch (error) {
            this.fail(error);
          }
        };
      },
      t,
    ).open();
  }
  edit(b: Binding, r: number, c: number): void {
    try {
      const { table } = this.locate(b),
        rows = values(table),
        m = reconcile(table),
        t = this.t;
      const merge = m.merges.find((a) => r >= a.r0 && r <= a.r1 && c >= a.c0 && c <= a.c1);
      if (merge) {
        r = merge.r0;
        c = merge.c0;
      }
      new FormModal(
        this.app,
        t('edit'),
        (modal) => {
          const lower = modal.text(
            m.diagonal && r === 0 && c === 0 ? t('lower') : t('value'),
            (m.diagonal && r === 0 && c === 0 ? m.diagonal.lower : rows[r][c]).replace(
              /<br\s*\/?>/gi,
              '\n',
            ),
            true,
          );
          const upper =
            m.diagonal && r === 0 && c === 0
              ? modal.text(t('upper'), m.diagonal.upper.replace(/<br\s*\/?>/gi, '\n'), true)
              : undefined;
          return () => {
            this.apply(b, (current, meta) => {
              if (upper && meta.diagonal) {
                meta.diagonal = { lower: escapeCell(lower.value), upper: escapeCell(upper.value) };
                current[0][0] = meta.diagonal.lower + meta.diagonal.upper;
              } else editCell(current, meta, r, c, escapeCell(lower.value));
            });
            modal.close();
          };
        },
        t,
      ).open();
    } catch (error) {
      this.fail(error);
    }
  }
  private submenu(menu: Menu, label: string, build: (sub: Menu) => void): void {
    menu.addItem((item) => {
      item.setTitle(label).setSection('good-tables');
      const extended = item as MenuItem & { setSubmenu?: () => Menu };
      if (typeof extended.setSubmenu === 'function') {
        const child = extended.setSubmenu();
        build(child);
        const owner = (item as MenuItem & { dom?: HTMLElement }).dom;
        const panel = (child as Menu & { dom?: HTMLElement }).dom;
        if (owner && panel) {
          const runtime = menu as Menu & {
            selected?: number;
            items?: MenuItem[];
            openSubmenuSoon?: { cancel: () => void };
          };
          const dispose = closeSubmenuOnExit(
            owner,
            panel,
            () => {
              if (runtime.selected !== undefined && runtime.items?.[runtime.selected] === item)
                runtime.openSubmenuSoon?.cancel();
              child.hide();
            },
            150,
            () => this.submenuDisposers.delete(dispose),
          );
          this.submenuDisposers.add(dispose);
        }
      } else
        item.setTitle(label + ' ›').onClick((event) => {
          const child = new Menu();
          build(child);
          child.showAtPosition({
            x: event instanceof MouseEvent ? event.clientX : 0,
            y: event instanceof MouseEvent ? event.clientY : 0,
          });
        });
    });
  }
  menu(menu: Menu, editor: Editor, contextBinding = this.active): void {
    const b = contextBinding;
    if (!b || b.editor !== editor || !b.element.isConnected) return;
    if (this.enhancedMenus.has(menu)) return;
    this.enhancedMenus.add(menu);
    const t = this.t;
    let m: Metadata;
    try {
      m = reconcile(this.locate(b).table);
    } catch {
      menu.addSeparator();
      menu.addItem((item) =>
        item
          .setTitle('Good Tables: ' + t('reset'))
          .setSection('good-tables')
          .onClick(() => this.reset(editor, b)),
      );
      this.refreshMenu(menu);
      return;
    }
    const binding = b;
    const act = (fn: Mutation) => this.apply(binding, fn);
    const item = (target: Menu, label: string, fn: () => void, checked?: boolean) =>
      target.addItem((i) => {
        i.setTitle(label).setSection('good-tables').onClick(fn);
        if (checked !== undefined) i.setChecked(checked);
      });
    menu.addSeparator();
    const addFormat = (
      target: Menu,
      kind: FormatKind,
      custom?: { prefix: string; suffix: string },
      label?: string,
    ) => {
      const eligible = positions(binding.rect).filter(
        ([r, c]) => this.settings.formatTitles || !isTitle(m, r, c),
      );
      const checked =
        eligible.length > 0 &&
        eligible.every(([r, c]) => {
          const f = m.cells[r][c].format;
          return (
            f?.kind === kind &&
            (kind !== 'custom' || (f.prefix === custom?.prefix && f.suffix === custom?.suffix))
          );
        });
      item(
        target,
        label ?? t(kind),
        () => {
          if (kind === 'custom' && !custom) {
            new FormModal(
              this.app,
              t('custom'),
              (modal) => {
                const prefix = modal.text(t('prefix'), ''),
                  suffix = modal.text(t('suffix'), '');
                return () => {
                  act((rows, meta, a) =>
                    applyFormat(rows, meta, a, binding.axis, kind, this.settings, {
                      prefix: prefix.value,
                      suffix: suffix.value,
                    }),
                  );
                  modal.close();
                };
              },
              t,
            ).open();
          } else
            act((rows, meta, a) =>
              applyFormat(rows, meta, a, binding.axis, kind, this.settings, custom),
            );
        },
        checked,
      );
    };
    for (const key of this.settings.menuOrder) {
      if (key === 'diagonal')
        item(
          menu,
          t('diagonal'),
          () => act((rows, meta) => toggleDiagonal(rows, meta)),
          !!m.diagonal,
        );
      else if (key === 'title') {
        const checked =
          binding.axis === 'row'
            ? Array.from(
                { length: binding.rect.r1 - binding.rect.r0 + 1 },
                (_, n) => n + binding.rect.r0,
              ).every((r) => m.headerRows.includes(r))
            : binding.axis === 'column'
              ? Array.from(
                  { length: binding.rect.c1 - binding.rect.c0 + 1 },
                  (_, n) => n + binding.rect.c0,
                ).every((c) => m.headerCols.includes(c))
              : false;
        menu.addItem((i) =>
          i
            .setTitle(t(checked ? 'clearTitle' : 'title'))
            .setSection('good-tables')
            .setDisabled(binding.axis === 'cell')
            .setChecked(checked)
            .onClick(() => act((_, meta, a) => toggleTitle(meta, a, binding.axis))),
        );
      } else if (key === 'format')
        this.submenu(menu, t('format'), (sub) => {
          for (const kind of this.settings.formatOrder) addFormat(sub, kind);
          if (this.settings.presets.length) sub.addSeparator();
          for (const preset of this.settings.presets) addFormat(sub, 'custom', preset, preset.name);
        });
      else if (key === 'merge') {
        item(menu, t('merge'), () => act((_, meta, a) => mergeCells(meta, a)));
        item(menu, t('unmerge'), () => act((_, meta, a) => unmergeCells(meta, a)));
      } else if (key === 'background' || key === 'color')
        item(menu, t(key), () => {
          const colors = new Set<string>();
          for (const table of scanTables(editor.getValue())) {
            if (
              table.metadata &&
              (table.metadata.headerRows.length || table.metadata.headerCols.length)
            ) {
              if (this.settings.titleBackground) colors.add(this.settings.titleBackground);
              if (this.settings.titleColor) colors.add(this.settings.titleColor);
            }
            for (const row of table.metadata?.cells ?? [])
              for (const cell of row) {
                if (cell.background) colors.add(cell.background);
                if (cell.color) colors.add(cell.color);
              }
          }
          const first = m.cells[binding.rect.r0][binding.rect.c0];
          new ColorModal(
            this.app,
            t,
            t(key),
            first[key] ?? '',
            Array.from(colors),
            this.settings.favorites,
            (color) => act((_, meta, a) => colorCells(meta, a, key, color)),
          ).open();
        });
      else if (key === 'structure')
        this.submenu(menu, t('structure'), (sub) => {
          const a = binding.rect;
          for (const [label, axis, index, action, count] of [
            ['beforeRow', 'row', a.r0, 'insert', 1],
            ['afterRow', 'row', a.r1 + 1, 'insert', 1],
            ['beforeColumn', 'column', a.c0, 'insert', 1],
            ['afterColumn', 'column', a.c1 + 1, 'insert', 1],
            ['deleteRows', 'row', a.r0, 'delete', a.r1 - a.r0 + 1],
            ['deleteColumns', 'column', a.c0, 'delete', a.c1 - a.c0 + 1],
          ] as const)
            item(sub, t(label), () =>
              act((rows, meta) => structure(rows, meta, axis, index, action, count)),
            );
        });
      else if (key === 'size')
        item(menu, t('size'), () =>
          new FormModal(
            this.app,
            t('size'),
            (modal) => {
              const width = modal.number(t('width'), m.widths[binding.rect.c0] ?? 120, 24, 4000),
                height = modal.number(t('height'), m.heights[binding.rect.r0] ?? 32, 24, 4000);
              modal.contentEl.createEl('button', { text: t('resetSize') }).onclick = () => {
                act((_, meta, a) => {
                  positions(a).forEach(([r, c]) => {
                    delete meta.widths[c];
                    delete meta.heights[r];
                  });
                });
                modal.close();
              };
              return () => {
                if (!width.checkValidity() || !height.checkValidity()) return;
                act((_, meta, a) =>
                  positions(a).forEach(([r, c]) => {
                    meta.widths[c] = Number(width.value);
                    meta.heights[r] = Number(height.value);
                  }),
                );
                modal.close();
              };
            },
            t,
          ).open(),
        );
    }
    item(menu, t('edit'), () => this.edit(binding, binding.rect.r0, binding.rect.c0));
    item(menu, t('copy'), () => {
      const data = values(binding.table),
        a = binding.rect;
      void binding.element.ownerDocument.defaultView?.navigator.clipboard
        .writeText(
          data
            .slice(a.r0, a.r1 + 1)
            .map((row) => row.slice(a.c0, a.c1 + 1).join('\t'))
            .join('\n'),
        )
        .catch((error) => this.fail(error));
    });
    item(menu, t('paste'), () =>
      new FormModal(
        this.app,
        t('paste'),
        (modal) => {
          const input = modal.text(t('paste'), '', true);
          return () => {
            act((rows, meta, a) => pasteCells(rows, meta, a, input.value));
            modal.close();
          };
        },
        t,
      ).open(),
    );
    this.refreshMenu(menu);
  }
  private refreshMenu(menu: Menu): void {
    // Focused cell editors create their own Menu rather than Menu.forEvent.
    // If its DOM was attached synchronously, update that same menu's groups.
    appendMenuGroup(menu as Menu & MenuDOM, 'good-tables');
  }
  private reset(editor: Editor, binding?: Binding): void {
    const source = editor.getValue(),
      at = editor.posToOffset(editor.getCursor());
    let table: Table | undefined;
    try {
      table = binding
        ? this.locate(binding).table
        : scanTables(source).find((t) => at >= t.from && at <= (t.metadataTo ?? t.to));
    } catch (error) {
      this.fail(error);
      return;
    }
    if (!table) {
      new Notice(this.t('noTable'));
      return;
    }
    if (table.metadataFrom === undefined) return;
    confirmModal(this.app, this.t, this.t('reset'), this.t('resetWarning'), () => {
      if (editor.getValue() !== source) {
        new Notice(this.t('conflict'));
        return;
      }
      editor.transaction(
        {
          changes: [
            {
              from: editor.offsetToPos(table.to),
              to: editor.offsetToPos(table.metadataTo!),
              text: '',
            },
          ],
        },
        'good-tables',
      );
    });
  }
  private async reading(el: HTMLElement, ctx: MarkdownPostProcessorContext): Promise<void> {
    const file = this.app.vault.getFileByPath(ctx.sourcePath);
    if (!file) return;
    const source = await this.app.vault.cachedRead(file);
    const tables = scanTables(source);
    for (const element of el.querySelectorAll<HTMLTableElement>('table')) {
      const info = ctx.getSectionInfo(element);
      if (!info) continue;
      const matches = tables.filter((t) => t.line >= info.lineStart && t.line <= info.lineEnd);
      const sectionTables = Array.from(el.querySelectorAll('table'));
      const table = matches.length === 1 ? matches[0] : matches[sectionTables.indexOf(element)];
      if (!table) continue;
      let rendered: Decorated | undefined;
      let component: Component | undefined;
      const entry = {
        refresh: () => {
          rendered?.dispose();
          component?.unload();
          component = new Component();
          component.load();
          try {
            rendered = decorateTable(
              element,
              values(table),
              reconcile(table),
              this.settings,
              undefined,
              (text, target) => {
                void MarkdownRenderer.render(this.app, text, target, ctx.sourcePath, component!);
              },
            );
          } catch {
            rendered = undefined;
          }
        },
        dispose: () => {
          rendered?.dispose();
          component?.unload();
          this.readings.delete(entry);
        },
      };
      class Child extends MarkdownRenderChild {
        onunload() {
          entry.dispose();
        }
      }
      this.readings.add(entry);
      ctx.addChild(new Child(element));
      entry.refresh();
    }
  }
}
