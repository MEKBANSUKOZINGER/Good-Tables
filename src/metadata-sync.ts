import { EditorState, StateField, Transaction, TransactionSpec } from '@codemirror/state';
import { exclusiveInline } from './inline';
import { Format } from './model';
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
  if (!tr.docChanged) return tr;
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
      for (const [r, row] of rows.entries())
        for (const [c, raw] of row.entries()) {
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
  return changes.length ? [tr, { changes, sequential: true }] : tr;
}
export const metadataSynchronization = (
  movement?: (tr: Transaction) => MovementResolver | undefined,
) => [
  exclusiveHistory,
  EditorState.transactionFilter.of((tr) => synchronizeMetadata(tr, movement?.(tr))),
];
