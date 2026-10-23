import { EditorState, Transaction, TransactionSpec } from '@codemirror/state';
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

/** Keep native edits and their metadata in one history transaction. */
export function synchronizeMetadata(
  tr: Transaction,
  movement?: MovementResolver,
): TransactionSpec | readonly TransactionSpec[] {
  if (!tr.docChanged || tr.isUserEvent('undo') || tr.isUserEvent('redo')) return tr;
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
) => EditorState.transactionFilter.of((tr) => synchronizeMetadata(tr, movement?.(tr)));
