import { isolateHistory } from '@codemirror/commands';
import {
  Annotation,
  EditorState,
  StateField,
  Transaction,
  TransactionSpec,
} from '@codemirror/state';
import { exclusiveInline } from './inline';
import { CellMeta, Format, Rect, positions } from './model';
import { CELL_FORMAT_PROPERTIES, clearCellFormatting, hasCellFormatting } from './operations';
import {
  Table,
  TablePermutation,
  metadataBlock,
  reconcile,
  remapMetadata,
  scanTables,
  validMetadata,
  values,
} from './markdown';

export type MovementResolver = (oldTable: Table, newTable: Table) => TablePermutation | undefined;

interface FormattingClear {
  tableId: string;
  rect: Rect;
  applied: boolean;
}
const nativeClear = Annotation.define<FormattingClear>();
const pendingClears = new WeakMap<EditorState, FormattingClear>();
/** Let the original native command keep its text/selection handling. Its document
 * transaction clears our metadata too, including commands that change no text. */
export function withNativeClearFormatting(
  editor: { state: EditorState; dispatch: (spec: TransactionSpec) => void },
  tableId: string,
  rect: Rect,
  native: () => unknown,
): unknown {
  const state = editor.state,
    request = { tableId, rect: { ...rect }, applied: false };
  pendingClears.set(state, request);
  try {
    const result = native();
    if (!request.applied) editor.dispatch({ annotations: nativeClear.of(request) });
    return result;
  } finally {
    pendingClears.delete(state);
  }
}
interface ClearedPresentation {
  cell: CellMeta;
  value: string;
  clearedValue: string;
}
const presentationHistory = StateField.define<Map<string, ClearedPresentation>>({
  create: () => new Map(),
  update(previous, tr) {
    if (!tr.docChanged) return previous;
    const request = tr.annotation(nativeClear) ?? pendingClears.get(tr.startState);
    if (!request?.applied && !previous.size) return previous;
    const after = scanTables(tr.newDoc.toString());
    const present = new Set(after.flatMap((t) => t.metadata?.cells.flat().map((c) => c.id) ?? []));
    const next = new Map(previous);
    for (const id of next.keys()) if (!present.has(id)) next.delete(id);
    if (!request?.applied) return next;
    const before = scanTables(tr.startState.doc.toString()).find(
      (t) => t.metadata?.id === request.tableId,
    );
    const current = after.find((t) => t.metadata?.id === request.tableId);
    if (!before?.metadata || !current?.metadata) return next;
    const oldRows = values(before),
      rows = values(current);
    for (const [r, c] of positions(request.rect)) {
      const cell = before.metadata.cells[r]?.[c];
      if (!cell || !hasCellFormatting(before.metadata, { r0: r, r1: r, c0: c, c1: c })) continue;
      next.set(cell.id, {
        cell: structuredClone(cell),
        value: oldRows[r][c],
        clearedValue: rows[r][c],
      });
    }
    return next;
  },
});

interface ClearedFormat {
  format: Format;
  value: string;
  exclusiveValue: string;
}
// Native cell editors keep their own text history. Remember only the format
// displaced by an exclusive wrapper so their undo can restore the same state.
const exclusiveHistory = StateField.define<Map<string, ClearedFormat>>({
  create: () => new Map(),
  update(previous, tr) {
    if (!tr.docChanged || !tr.startState.doc.toString().includes('good-tables:')) return previous;
    const before = scanTables(tr.startState.doc.toString()),
      after = scanTables(tr.newDoc.toString());
    const next = new Map(previous),
      present = new Set<string>();
    for (const table of after) {
      if (!table.metadata || table.invalidMetadata) continue;
      const rows = values(table),
        old = before.find((t) => t.metadata?.id === table.metadata!.id);
      const oldRows = old ? values(old) : [];
      const oldCells = new Map(
        old?.metadata?.cells.flatMap((row, r) =>
          row.map((cell, c) => [cell.id, { cell, value: oldRows[r]?.[c] }] as const),
        ) ?? [],
      );
      table.metadata.cells.forEach((row, r) =>
        row.forEach((cell, c) => {
          present.add(cell.id);
          const prior = oldCells.get(cell.id),
            raw = rows[r]?.[c];
          if (
            prior?.cell.format &&
            !cell.format &&
            typeof prior.value === 'string' &&
            typeof raw === 'string' &&
            !exclusiveInline(prior.value) &&
            exclusiveInline(raw)
          )
            next.set(cell.id, {
              format: structuredClone(prior.cell.format),
              value: prior.value,
              exclusiveValue: raw,
            });
        }),
      );
    }
    for (const id of next.keys()) if (!present.has(id)) next.delete(id);
    return next;
  },
});

/** Keep native edits and their metadata in one history transaction. */
export function synchronizeMetadata(
  tr: Transaction,
  movement?: MovementResolver,
): TransactionSpec | readonly TransactionSpec[] {
  const request = tr.annotation(nativeClear) ?? pendingClears.get(tr.startState);
  const clearing = request && !request.applied ? request : undefined;
  if (!tr.docChanged && !clearing) return tr;
  const before = tr.startState.doc.toString(),
    after = tr.newDoc.toString();
  if (!before.includes('good-tables:')) return tr;
  const oldTables = scanTables(before),
    newTables = scanTables(after);
  const changes: { from: number; to: number; insert: string }[] = [];
  for (const old of oldTables) {
    if (
      !old.metadata ||
      old.invalidMetadata ||
      old.metadataFrom === undefined ||
      old.metadataTo === undefined
    )
      continue;
    const current = newTables.filter((t) => t.metadata?.id === old.metadata!.id);
    if (current.length !== 1) continue;
    const table = current[0];
    if (table.invalidMetadata || table.metadataFrom === undefined || table.metadataTo === undefined)
      continue;
    // Explicit metadata edits (including Good Tables commands) already specify their own state.
    if (
      before.slice(old.metadataFrom, old.metadataTo) !==
      after.slice(table.metadataFrom, table.metadataTo)
    )
      continue;
    try {
      const baseline = reconcile(old),
        rows = values(table),
        permutation = movement?.(old, table);
      const meta = permutation
        ? remapMetadata(baseline, rows, permutation.rows, permutation.columns, true)
        : reconcile({ ...table, metadata: baseline });
      meta.alignments = [...table.divider.values];
      if (clearing?.tableId === meta.id) {
        clearCellFormatting(meta, clearing.rect);
        clearing.applied = true;
      }
      for (const [r, row] of rows.entries())
        for (const [c, raw] of row.entries()) {
          const cell = meta.cells[r][c],
            cleared = tr.startState.field(presentationHistory, false)?.get(cell.id);
          if (cleared && cleared.value !== cleared.clearedValue) {
            if (
              tr.isUserEvent('undo') &&
              raw === cleared.value &&
              baseline.snapshot[r]?.[c] === cleared.clearedValue &&
              !hasCellFormatting(meta, { r0: r, r1: r, c0: c, c1: c })
            ) {
              for (const key of CELL_FORMAT_PROPERTIES) {
                const value = cleared.cell[key];
                if (value !== undefined) Object.assign(cell, { [key]: structuredClone(value) });
              }
            } else if (
              tr.isUserEvent('redo') &&
              raw === cleared.clearedValue &&
              baseline.snapshot[r]?.[c] === cleared.value
            ) {
              clearCellFormatting(meta, { r0: r, r1: r, c0: c, c1: c });
            }
          }
          if (exclusiveInline(raw)) delete meta.cells[r][c].format;
          else if (tr.isUserEvent('undo')) {
            const cell = meta.cells[r][c],
              history = tr.startState.field(exclusiveHistory, false)?.get(cell.id);
            if (
              !cell.format &&
              history?.value === raw &&
              history.exclusiveValue === baseline.snapshot[r]?.[c]
            )
              cell.format = structuredClone(history.format);
          }
        }
      if (!validMetadata(meta) || JSON.stringify(meta) === JSON.stringify(table.metadata)) continue;
      changes.push({
        from: table.metadataFrom,
        to: table.metadataTo,
        insert: metadataBlock(meta, table.prefix, table.eol),
      });
    } catch {
      /* Preserve ambiguous or unsupported source rather than guess its cell mapping. */
    }
  }
  return changes.length
    ? [
        tr,
        {
          changes,
          sequential: true,
          annotations: clearing?.applied ? isolateHistory.of('full') : undefined,
        },
      ]
    : tr;
}
export const metadataSynchronization = (
  movement?: (tr: Transaction) => MovementResolver | undefined,
) => [
  exclusiveHistory,
  presentationHistory,
  EditorState.transactionFilter.of((tr) => synchronizeMetadata(tr, movement?.(tr))),
];
