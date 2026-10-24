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
  formatMenuOrder,
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
  hasCellFormatting,
  editCell,
  mergeCells,
  pasteCells,
  toggleDiagonal,
  toggleTitle,
  unmergeCells,
} from './operations';
import { Message, translator } from './i18n';
import { ColorModal, FormModal, confirmModal } from './dialogs';
import { Decorated, decorateTable } from './render';
import { GoodTablesSettings } from './settings';
import { canFormat, selectionActions } from './menu-state';
import { metadataField } from './metadata-view';
import { closeSubmenuOnExit, watchSelectionBoundary } from './interactions';
import {
  afterNativeContextMenu,
  appendMenuGroup,
  filterTableMenu,
  extendClearFormatting,
  placeFormatGroup,
  nativeMovement,
  MenuDOM,
  nativeSelection,
} from './native-table';
import { metadataSynchronization, withNativeClearFormatting } from './metadata-sync';

const FORMAT_ICONS: Record<FormatKind, string> = {
  percent: 'percent',
  calc: 'calculator',
  bar: 'chart-bar',
  date: 'calendar-days',
  datetime: 'calendar-clock',
  time: 'clock',
  rating: 'star',
  custom: 'settings-2',
};

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
  append?: () => void;
  event?: MouseEvent;
}
class Controller {
  bindings: Binding[] = [];
  private scheduled = false;
  private contextTimer: number | undefined;
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
          if (record.type === 'childList') return true;
          if (record.attributeName === 'style') return !!target?.matches('.gt-cell,.gt-table');
          return ['gt-table', 'gt-cell'].some(
            (name) =>
              record.oldValue?.split(/\s+/).includes(name) && !target?.classList.contains(name),
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
      if (!found) return;
      this.p.contextBinding = found.binding;
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
      const request: ContextMenuRequest = { binding: contextBinding, event: e };
      this.p.contextRequest = request;
      // Let every native handler and editor-menu listener finish first. Reuse
      // that exact event's menu; never replace it with a separate table menu.
      const owner = this.view.dom.ownerDocument.defaultView!;
      owner.clearTimeout(this.contextTimer);
      request.append = () => {
        if (this.dead || this.p.contextRequest !== request) return;
        this.refresh();
        const current = this.bindings.find((candidate) =>
          contextBinding.table.metadata?.id
            ? candidate.table.metadata?.id === contextBinding.table.metadata.id
            : candidate.table.from === contextBinding.table.from,
        );
        if (current)
          this.p.menu(request.menu ?? Menu.forEvent(e), current.editor, {
            ...current,
            rect: contextBinding.rect,
            axis: contextBinding.axis,
          });
        this.p.contextRequest = undefined;
        owner.clearTimeout(this.contextTimer);
      };
      // Focused-cell native menus can await selection updates before firing
      // editor-menu. Keep this request alive until that event actually arrives.
      this.contextTimer = owner.setTimeout(() => {
        if (this.p.contextRequest === request) this.p.contextRequest = undefined;
      }, 1000);
      afterNativeContextMenu(e, request.append, () => !!request.menu || e.defaultPrevented);
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
      attributeFilter: ['class', 'style'],
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
    if (this.dead || this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      if (!this.dead) this.refresh();
    });
  }
  private cell(target: EventTarget | null): { binding: Binding; r: number; c: number } | undefined {
    const td = (target as Element | null)?.closest?.('td,th') as HTMLTableCellElement | null;
    if (!td) return;
    const binding = this.bindings.find((b) => b.element === td.closest('table'));
    if (!binding) return;
    const r = td.closest('tr')?.rowIndex ?? -1,
      c = td.cellIndex;
    if (r < 0 || c < 0) return;
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
    try {
      if (!this.view.state.field(editorLivePreviewField, false)) return;
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
        const matches = tables.filter((table) => offset >= table.from - 1 && offset <= table.to);
        if (matches.length !== 1) continue;
        const table = matches[0],
          rows = values(table);
        if (
          element.rows.length !== rows.length ||
          [...element.rows].some((row, r) => row.cells.length !== rows[r].length)
        )
          continue;
        let data: Metadata | undefined;
        try {
          data = reconcile(table);
        } catch {
          /* Keep invalid metadata and native table content. */
        }
        const same = previous.find(
          (binding) => binding.element === element && binding.decorated.isCurrent(),
        );
        const old =
          same ??
          previous.find((binding) =>
            table.metadata?.id
              ? binding.table.metadata?.id === table.metadata.id
              : binding.table.from === table.from,
          );
        const b: Binding = same ?? {
          element,
          table,
          source,
          editor,
          cm: this.view,
          controller: this,
          rect: old?.rect ?? { r0: 0, r1: 0, c0: 0, c1: 0 },
          axis: old?.axis ?? 'cell',
          native: old?.native,
          decorated: {
            dispose: () => {},
            select: () => {},
            refreshLayout: () => {},
            update: () => {},
            isCurrent: () => false,
            focusDiagonal: () => {},
            releaseDiagonal: () => undefined,
          },
        };
        b.table = table;
        b.source = source;
        try {
          checkRect(rows, b.rect);
        } catch {
          b.rect = { r0: 0, r1: 0, c0: 0, c1: 0 };
          b.axis = 'cell';
        }
        if (same) b.decorated.update(rows, data, this.p.settings);
        else {
          const diagonal = data?.diagonal ? old?.decorated.releaseDiagonal() : undefined;
          old?.decorated.dispose();
          const path = this.view.state.field(editorInfoField, false)?.file?.path ?? '';
          b.decorated = decorateTable(
            element,
            rows,
            data,
            this.p.settings,
            {
              label: (key) => this.p.t(key),
              select: (rect, axis, event) => {
                if (event.shiftKey && this.p.active === b && axis === b.axis)
                  rect = {
                    r0: Math.min(rect.r0, b.rect.r0),
                    r1: Math.max(rect.r1, b.rect.r1),
                    c0: Math.min(rect.c0, b.rect.c0),
                    c1: Math.max(rect.c1, b.rect.c1),
                  };
                this.select(b, rect, axis);
              },
              edit: (r, c) => this.p.edit(b, r, c),
              diagonalEdit: (lower, upper) => {
                this.p.apply(b, (current, metadata) => {
                  if (!metadata.diagonal) return;
                  metadata.diagonal = { lower: escapeCell(lower), upper: escapeCell(upper) };
                  current[0][0] = metadata.diagonal.lower + metadata.diagonal.upper;
                });
              },
              history: (redo) => {
                if (redo) b.editor.redo();
                else b.editor.undo();
              },
            },
            (text, target) => {
              const component = new Component();
              component.load();
              void MarkdownRenderer.render(this.p.app, text, target, path, component);
              return () => component.unload();
            },
            diagonal,
          );
        }
        this.bindings.push(b);
        if (old && this.p.active === old) {
          this.p.active = b;
          b.decorated.select(b.rect);
        }
      }
    } finally {
      for (const old of previous) if (!this.bindings.includes(old)) old.decorated.dispose();
      if (!this.dead) this.observe();
    }
  }
  destroy(): void {
    this.dead = true;
    this.view.dom.ownerDocument.defaultView?.clearTimeout(this.contextTimer);
    if (this.p.contextRequest?.binding.controller === this) this.p.contextRequest = undefined;
    this.releaseSelection();
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
    // Persist IDs once so saved-format menu positions survive later launches.
    if (this.settings.presets.length) await this.saveData(this.settings);
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
        if (request && info.file === request.binding.cm.state.field(editorInfoField, false)?.file) {
          request.menu = menu;
          if (request.event && request.append)
            afterNativeContextMenu(request.event, request.append, () => true);
        }
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
      // Inline fields may dispatch several inputs before the queued view refresh.
      // Advance the live binding, while menu/modal snapshots retain conflict checks.
      const currentSource = b.editor.getValue();
      const currentTable = scanTables(currentSource).find(
        (candidate) => candidate.metadata?.id === m.id,
      );
      if (currentTable) {
        b.source = currentSource;
        b.table = currentTable;
      }
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
      if (m.diagonal && r === 0 && c === 0) {
        b.decorated.focusDiagonal();
        return;
      }
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
  private submenu(menu: Menu, label: string, icon: string, build: (sub: Menu) => void): void {
    menu.addItem((item) => {
      item.setTitle(label).setIcon(icon).setSection('good-tables');
      const extended = item as MenuItem & { setSubmenu?: () => Menu };
      if (typeof extended.setSubmenu === 'function') {
        const child = extended.setSubmenu();
        build(child);
        this.watchSubmenu(menu, item, child);
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
  private watchSubmenu(menu: Menu, item: MenuItem, child: Menu): void {
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
  }
  menu(menu: Menu, editor: Editor, contextBinding = this.active): void {
    const b = contextBinding;
    if (!b || b.editor !== editor || !b.element.isConnected) return;
    if (this.enhancedMenus.has(menu)) return;
    filterTableMenu(menu as Menu & MenuDOM);
    this.enhancedMenus.add(menu);
    const t = this.t;
    let m: Metadata;
    let rows: string[][];
    try {
      const table = this.locate(b).table;
      m = reconcile(table);
      rows = values(table);
    } catch {
      menu.addSeparator();
      menu.addItem((item) =>
        item
          .setTitle('Good Tables: ' + t('reset'))
          .setIcon('rotate-ccw')
          .setSection('good-tables')
          .onClick(() => this.reset(editor, b)),
      );
      this.refreshMenu(menu);
      return;
    }
    const binding = b;
    const actions = selectionActions(rows, m, binding.rect, binding.axis, this.settings);
    const availableFormats = formatMenuOrder(this.settings).filter((id) => {
      const preset = this.settings.presets.find((entry) => `preset:${entry.id}` === id);
      return canFormat(
        rows,
        m,
        binding.rect,
        preset ? 'custom' : (id as FormatKind),
        this.settings,
        preset,
      );
    });
    const act = (fn: Mutation) => this.apply(binding, fn);
    const item = (target: Menu, label: string, icon: string, fn: () => void, checked?: boolean) =>
      target.addItem((i) => {
        i.setTitle(label).setIcon(icon).setSection('good-tables').onClick(fn);
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
            (kind !== 'custom' ||
              (f.prefix === (custom ?? m.cells[eligible[0][0]][eligible[0][1]].format)?.prefix &&
                f.suffix === (custom ?? m.cells[eligible[0][0]][eligible[0][1]].format)?.suffix))
          );
        });
      item(
        target,
        label ?? t(kind),
        label ? 'bookmark' : FORMAT_ICONS[kind],
        () => {
          if (kind === 'custom' && !custom) {
            new FormModal(
              this.app,
              t('custom'),
              (modal) => {
                const existing = eligible.length
                  ? m.cells[eligible[0][0]][eligible[0][1]].format
                  : undefined;
                const prefix = modal.text(
                    t('prefix'),
                    existing?.kind === 'custom' ? (existing.prefix ?? '') : '',
                  ),
                  suffix = modal.text(
                    t('suffix'),
                    existing?.kind === 'custom' ? (existing.suffix ?? '') : '',
                  );
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
    const nativeItem = (
      menu as Menu & { items?: (MenuItem & { section?: string; submenu?: Menu })[] }
    ).items?.find(
      (entry) =>
        (entry.section === 'selection' || entry.section === 'selection.format') && entry.submenu,
    );
    if (nativeItem?.submenu)
      extendClearFormatting(
        nativeItem.submenu as Menu & {
          items?: (MenuItem & {
            section?: string;
            callback?: (event: MouseEvent | KeyboardEvent) => unknown;
          })[];
        },
        (native) => withNativeClearFormatting(binding.cm, m.id, binding.rect, native),
        hasCellFormatting(m, binding.rect),
      );
    if (actions.format && availableFormats.length) {
      const build = (target: Menu) => {
        for (const id of availableFormats) {
          const preset = this.settings.presets.find((entry) => `preset:${entry.id}` === id);
          if (preset) addFormat(target, 'custom', preset, preset.name);
          else addFormat(target, id as FormatKind);
        }
      };
      if (nativeItem?.submenu) {
        build(nativeItem.submenu);
        placeFormatGroup(nativeItem.submenu as Menu & MenuDOM, 'good-tables');
        this.watchSubmenu(menu, nativeItem, nativeItem.submenu);
      } else this.submenu(menu, t('format'), 'paintbrush', build);
    }
    for (const key of this.settings.menuOrder) {
      if (key === 'diagonal' && actions.diagonal)
        item(
          menu,
          t('diagonal'),
          'square-slash',
          () => act((rows, meta) => toggleDiagonal(rows, meta)),
          !!m.diagonal,
        );
      else if (key === 'title' && actions.title) {
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
            .setIcon('heading')
            .setSection('good-tables')
            .setChecked(checked)
            .onClick(() => act((_, meta, a) => toggleTitle(meta, a, binding.axis))),
        );
      } else if (key === 'merge') {
        if (actions.merge)
          item(menu, t('merge'), 'table-cells-merge', () =>
            act((_, meta, a) => mergeCells(meta, a)),
          );
        if (actions.unmerge)
          item(menu, t('unmerge'), 'table-cells-split', () =>
            act((_, meta, a) => unmergeCells(meta, a)),
          );
      } else if (
        (key === 'background' || key === 'color' || key === 'barColor') &&
        (key === 'barColor' ? actions.barColor : actions.color)
      )
        item(
          menu,
          t(key),
          key === 'background' ? 'paint-bucket' : key === 'barColor' ? 'chart-bar' : 'baseline',
          () => {
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
                  for (const color of [
                    cell.background,
                    cell.color,
                    cell.titleBackground,
                    cell.titleColor,
                    cell.barColor,
                  ])
                    if (color) colors.add(color);
                }
            }
            if (this.settings.barColor) colors.add(this.settings.barColor);
            const selectedColors = new Set(
              positions(binding.rect)
                .filter(([r, c]) => key !== 'barColor' || m.cells[r][c].format?.kind === 'bar')
                .map(([r, c]) => {
                  const cell = m.cells[r][c];
                  if (key === 'barColor') return cell.barColor ?? this.settings.barColor;
                  if (isTitle(m, r, c))
                    return key === 'background'
                      ? (cell.titleBackground ?? this.settings.titleBackground)
                      : (cell.titleColor ?? this.settings.titleColor);
                  return cell[key] ?? '';
                }),
            );
            new ColorModal(
              this.app,
              t,
              t(key),
              selectedColors.size === 1 ? [...selectedColors][0] : null,
              Array.from(colors),
              this.settings.favorites,
              (color) => act((_, meta, a) => colorCells(meta, a, key, color)),
            ).open();
          },
        );
    }
    if (actions.edit)
      item(menu, t('edit'), 'pencil', () => this.edit(binding, binding.rect.r0, binding.rect.c0));
    if (actions.copy)
      item(menu, t('copy'), 'copy', () => {
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
    if (actions.paste)
      item(menu, t('paste'), 'clipboard-paste', () =>
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
      const entry = {
        refresh: () => {
          try {
            if (rendered?.isCurrent()) {
              rendered.update(values(table), reconcile(table), this.settings);
              return;
            }
            rendered?.dispose();
            rendered = decorateTable(
              element,
              values(table),
              reconcile(table),
              this.settings,
              undefined,
              (text, target) => {
                const component = new Component();
                component.load();
                void MarkdownRenderer.render(this.app, text, target, ctx.sourcePath, component);
                return () => component.unload();
              },
            );
          } catch {
            rendered = undefined;
          }
        },
        dispose: () => {
          rendered?.dispose();
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
