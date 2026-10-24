import { test } from 'node:test';
import { canFormat, selectionActions } from '../src/menu-state';
import assert from 'node:assert/strict';
import {
  DEFAULTS,
  makeMetadata,
  normalizeSettings,
  formatMenuOrder,
  formatMenuLabel,
} from '../src/model';
import {
  escapeCell,
  metadataBlock,
  reconcile,
  scanTables,
  serializeEdit,
  serializeRows,
  splitRow,
  validMetadata,
  values,
} from '../src/markdown';
import {
  applyFormat,
  colorCells,
  editCell,
  mergeCells,
  numeric,
  pasteCells,
  structure,
  toggleDiagonal,
  toggleTitle,
  unmergeCells,
} from '../src/operations';
import { displayCell, formatTable } from '../src/formats';
import { EditorState, Transaction } from '@codemirror/state';
import { metadataSynchronization } from '../src/metadata-sync';
import { nativeMovement } from '../src/native-table';
import { inlineCell, exclusiveInline } from '../src/inline';
const settings = () => structuredClone(DEFAULTS);
const cell = { r0: 0, r1: 0, c0: 0, c1: 0 };
const throws = (fn: () => void, code: string) =>
  assert.throws(fn, (error: unknown) => error instanceof Error && error.message === code);
test('parses optional edges, escaped pipes, alignment and padded cells', () => {
  assert.deepEqual(splitRow('one | [[two\\|alias]] | three')?.values, [
    'one',
    '[[two\\|alias]]',
    'three',
  ]);
  assert.deepEqual(splitRow('| \\| | x |')?.values, ['\\|', 'x']);
  const t = scanTables('a | b\n:-- | --:\nonly |\n')[0];
  assert.deepEqual(values(t), [
    ['a', 'b'],
    ['only', ''],
  ]);
});
test('ignores YAML, fenced code, HTML comments and indented code; supports blockquotes', () => {
  const source =
    '---\nexample: |\n  a | b\n  -- | --\n---\n```md\n| a |\n| --- |\n```\n<!--\n| x |\n| --- |\n-->\n    | x |\n    | --- |\n> | real |\n> | --- |\n> | 1 |\n';
  const tables = scanTables(source);
  assert.equal(tables.length, 1);
  assert.equal(tables[0].prefix, '> ');
});
test('Markdown roundtrip preserves surrounding text, alignment, spacing, CRLF and raw values', () => {
  const body = '| **a**  | [[b\\|alias]] |\r\n| :--- | ---: |\r\n| 10 | 20 |';
  const source = 'before\r\n\r\n' + body + '\r\n\r\nafter';
  const t = scanTables(source)[0];
  const rows = values(t),
    m = reconcile(t);
  applyFormat(rows, m, { r0: 1, r1: 1, c0: 0, c1: 1 }, 'row', 'calc', settings());
  const next = source.slice(0, t.from) + serializeEdit(t, rows, m) + source.slice(t.to);
  assert.ok(next.includes(body));
  assert.ok(next.startsWith('before\r\n\r\n'));
  assert.ok(next.endsWith('\r\n\r\nafter'));
  assert.deepEqual(values(scanTables(next)[0]), rows);
  assert.ok(validMetadata(scanTables(next)[0].metadata));
});
test('metadata encoding cannot break comments, even with arbitrary custom text', () => {
  const rows = [['x']],
    m = makeMetadata(rows);
  m.cells[0][0].format = {
    kind: 'custom',
    group: 'g',
    prefix: '--> | <script>\n한글',
    suffix: '--',
  };
  const encoded = metadataBlock(m);
  assert.equal(encoded.includes('-->'), false);
  const t = scanTables(serializeRows(rows) + '\n' + encoded)[0];
  assert.deepEqual(t.metadata, m);
});
test('invalid and unsupported metadata is preserved and refused', () => {
  for (const tail of ['<!-- good-tables:bad -->', '<!-- good-tables:%7B%22version%22%3A2%7D -->']) {
    const t = scanTables('| a |\n| --- |\n' + tail)[0];
    assert.ok(t.invalidMetadata);
    throws(() => reconcile(t), 'metadata');
  }
  const m = makeMetadata([['a', 'b']]);
  m.cells[0][1].id = m.cells[0][0].id;
  assert.equal(validMetadata(m), false);
});
test('format choices replace existing and partial formats, and identical selections toggle off', () => {
  const rows = [['1', '2']],
    m = makeMetadata(rows),
    s = settings();
  applyFormat(rows, m, cell, 'cell', 'percent', s);
  applyFormat(rows, m, { ...cell, c1: 1 }, 'row', 'calc', s);
  assert.ok(m.cells[0].every((c) => c.format?.kind === 'calc'));
  applyFormat(rows, m, { ...cell, c1: 1 }, 'row', 'calc', s);
  assert.ok(m.cells[0].every((c) => !c.format));
  applyFormat(rows, m, cell, 'cell', 'percent', s);
  const before = structuredClone(m);
  throws(() => applyFormat([['-1', '2']], m, { ...cell, c1: 1 }, 'row', 'calc', s), 'negative');
  assert.deepEqual(m, before);
});
test('strict numeric input rejects commas, units, exponent and nonfinite values', () => {
  for (const value of ['1,000', '10%', '10kg', '1e3', 'NaN', 'Infinity', ' 3 ', '3.'])
    assert.equal(numeric(value), null);
  for (const [value, n] of [
    ['-2', -2],
    ['.5', 0.5],
    ['+3.5', 3.5],
    ['0004', 4],
  ] as const)
    assert.equal(numeric(value), n);
});
test('percentages exclude title/blank/invalid values, trim zeros, handle total 0 and reject negatives', () => {
  const rows = [['100'], ['1'], ['3'], ['no'], ['']],
    m = makeMetadata(rows),
    s = settings();
  m.headerRows = [0];
  applyFormat(rows, m, { r0: 0, r1: 4, c0: 0, c1: 0 }, 'column', 'calc', s);
  assert.equal(displayCell(rows, m, 1, 0, s).text, '25%');
  assert.equal(displayCell(rows, m, 3, 0, s).text, 'no(!NUM)');
  assert.equal(displayCell(rows, m, 4, 0, s).text, '');
  assert.equal(m.cells[0][0].format, undefined);
  rows[1][0] = '-1';
  assert.equal(displayCell(rows, m, 2, 0, s).text, '3(!NUM)');
  const negative = [['-1']],
    nm = makeMetadata(negative);
  throws(() => applyFormat(negative, nm, cell, 'cell', 'percent', s), 'negative');
  const zero = [['0']],
    zm = makeMetadata(zero);
  applyFormat(zero, zm, cell, 'cell', 'calc', s);
  assert.equal(displayCell(zero, zm, 0, 0, s).text, '0%');
});
test('negative bars shift all values by the minimum, labels use original by default', () => {
  const rows = [['-5'], ['0'], ['5']],
    m = makeMetadata(rows),
    s = settings();
  applyFormat(rows, m, { r0: 0, r1: 2, c0: 0, c1: 0 }, 'column', 'bar', s);
  assert.deepEqual(
    rows.map((_, r) => displayCell(rows, m, r, 0, s).fraction),
    [0, 1 / 3, 2 / 3],
  );
  assert.equal(displayCell(rows, m, 0, 0, s).text, '-5');
  s.barLabel = 'percent';
  assert.equal(displayCell(rows, m, 1, 0, s).text, '33.33%');
});
test('large finite numbers do not overflow percentage calculations', () => {
  const huge = '9'.repeat(308),
    rows = [[huge], [huge]],
    m = makeMetadata(rows);
  applyFormat(rows, m, { ...cell, r1: 1 }, 'column', 'calc', settings());
  assert.equal(displayCell(rows, m, 0, 0, settings()).text, '50%');
});
test('date/time requires exact digit counts without calendar validation and supports configurable patterns', () => {
  for (const [kind, raw, expected] of [
    ['date', '20261399', '2026-13-99'],
    ['datetime', '202613992599', '2026-13-99 25:99'],
    ['time', '9999', '99:99'],
  ] as const) {
    const rows: string[][] = [[raw]],
      m = makeMetadata(rows),
      s = settings();
    applyFormat(rows, m, cell, 'cell', kind, s);
    assert.equal(displayCell(rows, m, 0, 0, s).text, expected);
    rows[0][0] = '1';
    assert.equal(displayCell(rows, m, 0, 0, s).text, '1(!NODATE)');
  }
});
test('rating preserves exact halves, rounds other decimals, clamps, and abbreviates above 10', () => {
  const rows = [['3.5']],
    m = makeMetadata(rows),
    s = settings();
  applyFormat(rows, m, cell, 'cell', 'rating', s);
  for (const [raw, expected] of [
    ['3.5', '★★★☆'],
    ['1.64', '★★'],
    ['4.2', '★★★★'],
    ['-1', ''],
    ['7', '★★★★★'],
  ]) {
    rows[0][0] = raw;
    assert.equal(displayCell(rows, m, 0, 0, s).text, expected);
  }
  s.ratingMax = 100;
  rows[0][0] = '12.5';
  assert.equal(displayCell(rows, m, 0, 0, s).text, '★ X 13');
});
test('title toggle preserves underlying styles, supports multiple rows and forbids crossing merges', () => {
  const rows = [
      ['a', 'b'],
      ['c', 'd'],
    ],
    m = makeMetadata(rows);
  colorCells(m, cell, 'background', '#aabbcc');
  toggleTitle(m, cell, 'row');
  assert.equal(m.cells[0][0].background, '#aabbcc');
  throws(() => mergeCells(m, { ...cell, r1: 1 }), 'titleMerge');
  toggleTitle(m, cell, 'row');
  assert.equal(m.cells[0][0].background, '#aabbcc');
  mergeCells(m, { ...cell, r1: 1 });
  throws(() => toggleTitle(m, cell, 'row'), 'titleMerge');
  assert.deepEqual(m.headerRows, []);
});
test('merging preserves all originals and editing changes only the anchor, including after roundtrip', () => {
  const rows = [
      ['A', 'B'],
      ['C', 'D'],
    ],
    m = makeMetadata(rows),
    a = { r0: 0, r1: 1, c0: 0, c1: 1 };
  m.cells[1][1].background = '#abcdef';
  mergeCells(m, a);
  editCell(rows, m, 1, 1, 'edited');
  const source = serializeRows(rows) + '\n' + metadataBlock({ ...m, snapshot: rows });
  const next = scanTables(source)[0],
    nm = reconcile(next),
    nr = values(next);
  unmergeCells(nm, a);
  assert.deepEqual(nr, [
    ['edited', 'B'],
    ['C', 'D'],
  ]);
  assert.equal(nm.cells[1][1].background, '#abcdef');
  assert.deepEqual(nm.merges, []);
});
test('diagonal toggles concatenate without whitespace and stores both values safely', () => {
  const rows = [['left']],
    m = makeMetadata(rows);
  toggleDiagonal(rows, m);
  m.diagonal!.upper = 'right';
  rows[0][0] = 'leftright';
  toggleDiagonal(rows, m);
  assert.equal(rows[0][0], 'leftright');
  assert.equal(m.diagonal, undefined);
});
test('insertion/deletion preserves cell metadata and title coordinates, refuses merged intersections', () => {
  const rows = [
      ['a', 'b'],
      ['c', 'd'],
    ],
    m = makeMetadata(rows);
  m.cells[1][0].color = '#123456';
  m.headerRows = [1];
  const id = m.cells[1][0].id;
  structure(rows, m, 'row', 1, 'insert');
  assert.equal(m.cells[2][0].id, id);
  assert.deepEqual(m.headerRows, [2]);
  structure(rows, m, 'column', 0, 'insert');
  assert.equal(m.cells[2][1].id, id);
  assert.equal(m.cells[2][1].color, '#123456');
  structure(rows, m, 'row', 1, 'delete');
  assert.deepEqual(m.headerRows, [1]);
  mergeCells(m, { r0: 0, r1: 0, c0: 0, c1: 1 });
  throws(() => structure(rows, m, 'column', 1, 'insert'), 'unmergeFirst');
});
test('external row reorder, row insertion, column reorder and ordinary editing carry styles safely', () => {
  const original = [
      ['a', '1'],
      ['b', '2'],
      ['c', '3'],
    ],
    m = makeMetadata(original);
  m.cells[1][1].background = '#abcdef';
  const parse = (rows: string[][]) => scanTables(serializeRows(rows) + '\n' + metadataBlock(m))[0];
  assert.equal(
    reconcile(parse([original[0], original[2], original[1]])).cells[2][1].background,
    '#abcdef',
  );
  assert.equal(
    reconcile(parse([original[0], ['new', ''], original[1], original[2]])).cells[2][1].background,
    '#abcdef',
  );
  assert.equal(
    reconcile(parse(original.map((row) => [row[1], row[0]]))).cells[1][0].background,
    '#abcdef',
  );
  assert.equal(
    reconcile(parse([original[0], ['changed', '2'], original[2]])).cells[1][1].background,
    '#abcdef',
  );
});
test('ambiguous simultaneous external structure changes refuse to apply metadata', () => {
  const original = [
      ['a', '1'],
      ['b', '2'],
    ],
    m = makeMetadata(original);
  const t = scanTables(
    serializeRows([
      ['new', '0'],
      ['other', '3'],
      ['extra', '4'],
    ]) +
      '\n' +
      metadataBlock(m),
  )[0];
  throws(() => reconcile(t), 'stale');
});

test('stored metadata recovers a provable row and column permutation together', () => {
  const rows = [
    ['Item', 'Rating', 'Value'],
    ['A', '1.64', '10'],
    ['B', '3', '20'],
    ['C', '4.5', '30'],
  ];
  const m = makeMetadata(rows);
  m.cells[1][1].background = '#123456';
  const current = [rows[0], rows[2], rows[3], rows[1]].map((row) => [row[0], row[2], row[1]]);
  const table = scanTables(serializeRows(current) + '\n\n' + metadataBlock(m))[0];
  const next = reconcile(table);
  assert.equal(next.cells[3][2].id, m.cells[1][1].id);
  assert.equal(next.cells[3][2].background, '#123456');
});

test('native edits persist metadata in the same transaction across alternating row/column moves and undo', () => {
  const rows = [
    ['Item', 'Rating', 'Value'],
    ['A', '1.64', '10'],
    ['B', '3', '20'],
    ['C', '4.5', '30'],
  ];
  const m = makeMetadata(rows);
  m.cells[1][1].background = '#123456';
  m.widths[1] = 140;
  m.heights[1] = 50;
  m.headerCols = [1];
  const original = serializeRows(rows) + '\n\n' + metadataBlock(m);
  let state = EditorState.create({ doc: original, extensions: [metadataSynchronization()] });
  const move = (rows: string[][]) => {
    const t = scanTables(state.doc.toString())[0];
    const tr = state.update({ changes: { from: t.from, to: t.to, insert: serializeRows(rows) } });
    state = tr.state;
    const next = scanTables(state.doc.toString())[0].metadata!;
    assert.deepEqual(next.snapshot, rows);
    return next;
  };
  const columns = rows.map((row) => [row[0], row[2], row[1]]);
  const first = move(columns);
  assert.equal(first.cells[1][2].background, '#123456');
  assert.equal(first.widths[2], 140);
  const afterColumn = state.doc.toString();
  const current = [columns[0], columns[2], columns[3], columns[1]];
  const second = move(current);
  assert.equal(second.cells[3][2].id, m.cells[1][1].id);
  assert.equal(second.heights[3], 50);
  assert.deepEqual(second.headerCols, [2]);
  state = state.update({
    changes: { from: 0, to: state.doc.length, insert: afterColumn },
    annotations: Transaction.userEvent.of('undo'),
  }).state;
  assert.equal(state.doc.toString(), afterColumn);
  state = state.update({
    changes: { from: 0, to: state.doc.length, insert: original },
    annotations: Transaction.userEvent.of('undo'),
  }).state;
  assert.equal(state.doc.toString(), original);
});

test('ordinary native value edits update the snapshot before a later move', () => {
  const rows = [
      ['A', '1'],
      ['B', '2'],
      ['C', '3'],
    ],
    m = makeMetadata(rows);
  m.cells[1][1].color = '#112233';
  let state = EditorState.create({
    doc: serializeRows(rows) + '\n\n' + metadataBlock(m),
    extensions: [metadataSynchronization()],
  });
  const t = scanTables(state.doc.toString())[0];
  const changed = [rows[0], ['B', '2.5'], rows[2]];
  state = state.update({
    changes: { from: t.from, to: t.to, insert: serializeRows(changed) },
  }).state;
  assert.deepEqual(scanTables(state.doc.toString())[0].metadata!.snapshot, changed);
  const next = scanTables(state.doc.toString())[0];
  state = state.update({
    changes: {
      from: next.from,
      to: next.to,
      insert: serializeRows([changed[0], changed[2], changed[1]]),
    },
  }).state;
  assert.equal(scanTables(state.doc.toString())[0].metadata!.cells[2][1].color, '#112233');
});

test('observed native movement preserves distinct styles when moved rows have identical values', () => {
  const rows = [
      ['H', 'V'],
      ['same', '1'],
      ['same', '1'],
    ],
    m = makeMetadata(rows);
  m.cells[1][1].background = '#123456';
  m.cells[2][1].background = '#654321';
  const extension = metadataSynchronization(
    () => (old, current) =>
      nativeMovement(values(old), values(current), { row: 1, col: 0 }, { row: 2, col: 0 }),
  );
  const state = EditorState.create({
    doc: serializeRows(rows) + '\n\n' + metadataBlock(m),
    extensions: [extension],
  });
  const t = scanTables(state.doc.toString())[0];
  const tr = state.update({ changes: { from: t.from, to: t.to, insert: serializeRows(rows) } });
  const meta = scanTables(tr.newDoc.toString())[0].metadata!;
  assert.equal(meta.cells[1][1].id, m.cells[2][1].id);
  assert.equal(meta.cells[2][1].background, '#123456');
});

test('explicit Good Tables metadata changes are not rewritten by native synchronization', () => {
  const rows = [
      ['A', '1'],
      ['B', '2'],
    ],
    m = makeMetadata(rows);
  const state = EditorState.create({
    doc: serializeRows(rows) + '\n\n' + metadataBlock(m),
    extensions: [metadataSynchronization()],
  });
  const t = scanTables(state.doc.toString())[0];
  m.cells[1][1].color = '#123456';
  const edit = serializeEdit(t, rows, m);
  assert.equal(
    state.update({ changes: { from: 0, to: state.doc.length, insert: edit } }).newDoc.toString(),
    edit,
  );
});

test('a moved first cell keeps its raw text and styles when its first-cell-only diagonal ends', () => {
  const rows = [
      ['lowerupper', 'H'],
      ['A', '1'],
    ],
    m = makeMetadata(rows);
  m.diagonal = { lower: 'lower', upper: 'upper' };
  m.cells[0][0].color = '#123456';
  const moved = rows.map((row) => [row[1], row[0]]);
  const state = EditorState.create({
    doc: serializeRows(rows) + '\n\n' + metadataBlock(m),
    extensions: [
      metadataSynchronization(
        () => (old, current) =>
          nativeMovement(values(old), values(current), { row: 0, col: 0 }, { row: 0, col: 1 }),
      ),
    ],
  });
  const t = scanTables(state.doc.toString())[0];
  const next = scanTables(
    state
      .update({ changes: { from: 0, to: t.to, insert: serializeRows(moved) } })
      .newDoc.toString(),
  )[0];
  assert.equal(next.metadata!.diagonal, undefined);
  assert.equal(next.metadata!.cells[0][1].color, '#123456');
  assert.equal(values(next)[0][1], 'lowerupper');
});

test('native movement unmerges only a merge that can no longer form a rectangle, preserving all cells', () => {
  const rows = [
      ['A', 'B', 'C'],
      ['1', '2', '3'],
    ],
    m = makeMetadata(rows);
  mergeCells(m, { r0: 1, r1: 1, c0: 0, c1: 1 });
  m.cells[1][0].color = '#123456';
  const moved = rows.map((row) => [row[0], row[2], row[1]]);
  const state = EditorState.create({
    doc: serializeRows(rows) + '\n\n' + metadataBlock(m),
    extensions: [
      metadataSynchronization(
        () => (old, current) =>
          nativeMovement(values(old), values(current), { row: 0, col: 1 }, { row: 0, col: 2 }),
      ),
    ],
  });
  const t = scanTables(state.doc.toString())[0];
  const next = scanTables(
    state
      .update({ changes: { from: 0, to: t.to, insert: serializeRows(moved) } })
      .newDoc.toString(),
  )[0];
  assert.deepEqual(next.metadata!.merges, []);
  assert.deepEqual(values(next), moved);
  assert.equal(next.metadata!.cells[1][0].color, '#123456');
});
test('pasting remains rectangular and refuses overflow or intersecting merges', () => {
  const rows = [
      ['a', 'b'],
      ['c', 'd'],
    ],
    m = makeMetadata(rows);
  pasteCells(rows, m, cell, '1\t2\n3\t4');
  assert.deepEqual(rows, [
    ['1', '2'],
    ['3', '4'],
  ]);
  throws(() => pasteCells(rows, m, cell, '1\t2\t3'), 'pasteSize');
  mergeCells(m, { ...cell, c1: 1 });
  throws(() => pasteCells(rows, m, cell, 'x'), 'unmergeFirst');
});
test('settings restore invalid patterns, clamp limits and preserve menu membership', () => {
  const s = normalizeSettings({
    decimals: 20,
    ratingMax: 0,
    date: 'MM-DD',
    menuOrder: ['color', 'color', 'invalid'],
    favorites: ['#123456', 'bad'],
  });
  assert.equal(s.decimals, 10);
  assert.equal(s.ratingMax, 1);
  assert.equal(s.date, 'YYYY-MM-DD');
  assert.equal(s.menuOrder[0], 'color');
  assert.equal(new Set(s.menuOrder).size, DEFAULTS.menuOrder.length);
  assert.deepEqual(s.favorites, ['#123456']);
});
test('escapeCell preserves already escaped pipes and multiline values', () => {
  assert.equal(escapeCell('a|b\nc\\|d'), 'a\\|b<br>c\\|d');
});
test('editing a padded Markdown row materializes missing cells without corrupting delimiters', () => {
  const t = scanTables('| a | b |\n| --- | --- |\n| x |')[0],
    rows = values(t),
    m = reconcile(t);
  rows[1][1] = 'new';
  assert.deepEqual(values(scanTables(serializeEdit(t, rows, m))[0]), [
    ['a', 'b'],
    ['x', 'new'],
  ]);
});
test('new cells inherit a whole-column or whole-row format and join its calculation group', () => {
  const rows = [['1'], ['3']],
    m = makeMetadata(rows),
    s = settings();
  applyFormat(rows, m, { ...cell, r1: 1 }, 'column', 'calc', s);
  structure(rows, m, 'row', 2, 'insert');
  rows[2][0] = '4';
  assert.equal(displayCell(rows, m, 2, 0, s).text, '50%');
  assert.equal(displayCell(rows, m, 0, 0, s).text, '12.5%');
  const original = [['1'], ['3']],
    nm = makeMetadata(original);
  applyFormat(original, nm, { ...cell, r1: 1 }, 'column', 'calc', s);
  const t = scanTables(serializeRows([['1'], ['3'], ['4']]) + '\n' + metadataBlock(nm))[0],
    reconciled = reconcile(t);
  assert.equal(displayCell(values(t), reconciled, 2, 0, s).text, '50%');
});
test('percentage suffix format follows decimal limit with ordinary decimal rounding', () => {
  const rows = [['2.675']],
    m = makeMetadata(rows),
    s = settings();
  applyFormat(rows, m, cell, 'cell', 'percent', s);
  assert.equal(displayCell(rows, m, 0, 0, s).text, '2.68%');
  s.decimals = 0;
  assert.equal(displayCell(rows, m, 0, 0, s).text, '3%');
});
test('pasted literal pipes remain within their original cell', () => {
  const rows = [['', '']],
    m = makeMetadata(rows);
  pasteCells(rows, m, cell, 'a|b\tc');
  assert.deepEqual(values(scanTables(serializeRows(rows))[0]), [['a\\|b', 'c']]);
});
test('metadata uses short lines, supports blockquotes, and keeps following tables parseable', () => {
  const rows = [
      ['a', 'b'],
      ['1', '2'],
    ],
    m = makeMetadata(rows);
  const comment = metadataBlock(m, '> ', '\r\n');
  assert.ok(comment.split('\r\n').every((line) => line.length <= 210));
  const source =
    serializeRows(rows, '> ', '\r\n') +
    '\r\n> \r\n' +
    comment +
    '\r\n\r\n' +
    serializeRows([['next']]);
  const tables = scanTables(source);
  assert.equal(tables.length, 2);
  assert.deepEqual(tables[0].metadata, m);
  assert.equal(tables[1].rows[0].values[0], 'next');
});
test('column insertion and deletion preserve native alignment of the original columns', () => {
  const t = scanTables('| A | B |\n| :--- | ---: |\n| 1 | 2 |')[0],
    rows = values(t),
    m = reconcile(t);
  structure(rows, m, 'column', 0, 'insert');
  const next = scanTables(serializeEdit(t, rows, m))[0];
  assert.deepEqual(next.divider.values, ['---', ':---', '---:']);
  const nr = values(next),
    nm = reconcile(next);
  structure(nr, nm, 'column', 1, 'delete');
  assert.deepEqual(scanTables(serializeEdit(next, nr, nm))[0].divider.values, ['---', '---:']);
});

test('saved-format IDs migrate once and menu order survives rename, removal and new presets', () => {
  const settings = normalizeSettings({
    presets: [
      { name: 'USD', prefix: '$', suffix: '' },
      { name: 'kg', prefix: '', suffix: ' kg' },
    ],
  });
  const [first, second] = settings.presets;
  assert.ok(first.id && second.id && first.id !== second.id);
  const firstKey = `preset:${first.id}`,
    secondKey = `preset:${second.id}`;
  settings.formatOrder = [secondKey, 'rating', firstKey];
  const normalized = normalizeSettings(JSON.parse(JSON.stringify(settings)));
  assert.equal(normalized.presets[0].id, first.id);
  assert.deepEqual(normalized.formatOrder.slice(0, 3), [secondKey, 'rating', firstKey]);
  normalized.presets[0].name = 'Dollars';
  assert.equal(
    formatMenuLabel(firstKey, normalized, (kind) => kind),
    'Dollars',
  );
  normalized.presets.splice(1, 1);
  assert.ok(!formatMenuOrder(normalized).includes(secondKey));
  const repeated = normalizeSettings({ presets: [first, first] });
  assert.notEqual(repeated.presets[0].id, repeated.presets[1].id);
});

test('context actions hide invalid scopes, title crossings, merged paste and redundant controls', () => {
  const rows = [
      ['A', 'B'],
      ['1', '2'],
      ['3', '4'],
    ],
    m = makeMetadata(rows);
  const one = { r0: 1, r1: 1, c0: 0, c1: 0 },
    first = { r0: 0, r1: 0, c0: 0, c1: 0 };
  assert.equal(selectionActions(rows, m, one, 'cell', DEFAULTS).merge, false);
  assert.equal(selectionActions(rows, m, one, 'cell', DEFAULTS).diagonal, false);
  assert.equal(selectionActions(rows, m, first, 'cell', DEFAULTS).diagonal, true);
  assert.equal(selectionActions(rows, m, one, 'cell', DEFAULTS).title, false);
  m.headerRows = [0];
  assert.equal(selectionActions(rows, m, first, 'cell', DEFAULTS).color, true);
  assert.equal(
    selectionActions(rows, m, { r0: 0, r1: 1, c0: 0, c1: 0 }, 'cell', DEFAULTS).merge,
    false,
  );
  m.headerRows = [];
  m.merges = [{ r0: 0, r1: 1, c0: 0, c1: 0 }];
  const actions = selectionActions(rows, m, first, 'cell', DEFAULTS);
  assert.equal(actions.diagonal, false);
  assert.equal(actions.unmerge, true);
  assert.equal(actions.paste, false);
  assert.equal(
    selectionActions(rows, m, { r0: 0, r1: 0, c0: 0, c1: 1 }, 'row', DEFAULTS).title,
    false,
  );
  const settings = normalizeSettings({
    menuOrder: ['structure', 'size', 'format'],
    formatOrder: ['custom', 'rating'],
  });
  assert.ok(!settings.menuOrder.includes('structure') && !settings.menuOrder.includes('size'));
  assert.equal(formatMenuOrder(settings).at(-1), 'custom');
});

test('format availability includes replacements and partial selections, while respecting restrictions', () => {
  const rows = [
      ['A', 'B'],
      ['-1', '2'],
    ],
    m = makeMetadata(rows),
    rect = { r0: 1, r1: 1, c0: 0, c1: 1 };
  assert.equal(canFormat(rows, m, rect, 'percent', DEFAULTS), false);
  assert.equal(canFormat(rows, m, rect, 'bar', DEFAULTS), true);
  applyFormat(rows, m, rect, 'row', 'rating', DEFAULTS);
  assert.equal(canFormat(rows, m, rect, 'rating', DEFAULTS), true);
  assert.equal(canFormat(rows, m, rect, 'bar', DEFAULTS), true);
  delete m.cells[1][1].format;
  assert.equal(canFormat(rows, m, rect, 'rating', DEFAULTS), true);
  delete m.cells[1][0].format;
  applyFormat(rows, m, rect, 'row', 'custom', DEFAULTS, { prefix: '$', suffix: '' });
  assert.equal(canFormat(rows, m, rect, 'custom', DEFAULTS, { prefix: '$', suffix: '' }), true);
  assert.equal(canFormat(rows, m, rect, 'custom', DEFAULTS, { prefix: '', suffix: 'kg' }), true);
  assert.equal(canFormat(rows, m, rect, 'custom', DEFAULTS), true);
});

test('native emphasis coexists with every table format without changing Markdown', () => {
  for (const [raw, marks] of [
    ['**1.64**', ['strong']],
    ['_1.64_', ['em']],
    ['~~1.64~~', ['s']],
    ['==1.64==', ['mark']],
    ['***1.64***', ['strong', 'em']],
    ['==~~***1.64***~~==', ['mark', 's', 'strong', 'em']],
  ] as const) {
    assert.deepEqual(inlineCell(raw), { text: '1.64', marks: [...marks], hidden: false });
    assert.equal(numeric(raw), 1.64);
    const rows = [[raw]],
      m = makeMetadata(rows);
    applyFormat(rows, m, cell, 'cell', 'percent', DEFAULTS);
    assert.equal(displayCell(rows, m, 0, 0, DEFAULTS).text, '1.64%');
    applyFormat(rows, m, cell, 'cell', 'rating', DEFAULTS);
    assert.equal(displayCell(rows, m, 0, 0, DEFAULTS).text, '★★');
    assert.equal(rows[0][0], raw);
  }
  const rows = [['**20261024**']],
    m = makeMetadata(rows);
  applyFormat(rows, m, cell, 'cell', 'date', DEFAULTS);
  assert.equal(displayCell(rows, m, 0, 0, DEFAULTS).text, '2026-10-24');
});

test('native code, comments and math remove table formats in the same undoable transaction', () => {
  for (const raw of ['`3`', '``3``', '%%3%%', '$3$', '$$3$$', '**`3`**']) {
    assert.equal(exclusiveInline(raw), true);
    const rows = [['3', '4']],
      m = makeMetadata(rows);
    applyFormat(rows, m, { ...cell, c1: 1 }, 'row', 'rating', DEFAULTS);
    const original = serializeRows(rows) + '\n\n' + metadataBlock(m);
    let state = EditorState.create({ doc: original, extensions: [metadataSynchronization()] });
    const table = scanTables(original)[0];
    const changed = [[raw, '4']];
    const tr = state.update({
      changes: { from: table.from, to: table.to, insert: serializeRows(changed) },
    });
    const formatted = tr.newDoc.toString(),
      next = scanTables(formatted)[0].metadata!;
    assert.equal(next.cells[0][0].format, undefined);
    assert.equal(next.cells[0][1].format?.kind, 'rating');
    assert.equal(next.cells[0][0].id, m.cells[0][0].id);
    assert.deepEqual(next.snapshot, changed);
    assert.equal(canFormat(changed, next, cell, 'rating', DEFAULTS), false);
    throws(() => applyFormat(changed, next, cell, 'cell', 'rating', DEFAULTS), 'exclusiveFormat');
    state = tr.state.update({
      changes: { from: 0, to: tr.newDoc.length, insert: original },
      annotations: Transaction.userEvent.of('undo'),
    }).state;
    assert.equal(scanTables(state.doc.toString())[0].metadata!.cells[0][0].format?.kind, 'rating');
    state = state.update({
      changes: { from: 0, to: state.doc.length, insert: formatted },
      annotations: Transaction.userEvent.of('redo'),
    }).state;
    assert.equal(scanTables(state.doc.toString())[0].metadata!.cells[0][0].format, undefined);
    // Legacy metadata must not resurrect after removing an exclusive wrapper.
    const legacy = reconcile(
      scanTables(serializeRows(changed) + '\n\n' + metadataBlock({ ...m, snapshot: changed }))[0],
    );
    assert.equal(legacy.cells[0][0].format, undefined);
  }
});

test('title colors and bar colors persist independently from ordinary colors and validate strictly', () => {
  const rows = [['1', '2']],
    m = makeMetadata(rows);
  m.cells[0][0].background = '#112233';
  m.headerRows = [0];
  colorCells(m, cell, 'background', '#445566');
  colorCells(m, cell, 'color', '#778899');
  assert.equal(m.cells[0][0].titleBackground, '#445566');
  assert.equal(m.cells[0][0].background, '#112233');
  assert.equal(m.cells[0][0].titleColor, '#778899');
  applyFormat(rows, m, { ...cell, c1: 1 }, 'row', 'bar', { ...DEFAULTS, formatTitles: true });
  colorCells(m, cell, 'barColor', '#aabbcc');
  assert.equal(selectionActions(rows, m, cell, 'cell', DEFAULTS).barColor, true);
  assert.deepEqual(scanTables(serializeRows(rows) + '\n\n' + metadataBlock(m))[0].metadata, m);
  colorCells(m, cell, 'background', null);
  assert.equal(m.cells[0][0].titleBackground, undefined);
  assert.equal(m.cells[0][0].background, '#112233');
  const broken = structuredClone(m);
  broken.cells[0][0].barColor = 'red';
  assert.equal(validMetadata(broken), false);
  assert.equal(normalizeSettings({ barColor: 'red' }).barColor, '');
  assert.equal(normalizeSettings({ barColor: '#abcdef' }).barColor, '#abcdef');
});

test('native cell-local undo restores the format displaced by code, math or comments', () => {
  for (const raw of ['`3`', '$3$', '%%3%%']) {
    const rows = [['3']],
      m = makeMetadata(rows);
    applyFormat(rows, m, cell, 'cell', 'rating', DEFAULTS);
    let state = EditorState.create({
      doc: serializeRows(rows) + '\n\n' + metadataBlock(m),
      extensions: [metadataSynchronization()],
    });
    const edit = (value: string, event: string) => {
      const table = scanTables(state.doc.toString())[0];
      state = state.update({
        changes: { from: table.from, to: table.to, insert: serializeRows([[value]]) },
        annotations: Transaction.userEvent.of(event),
      }).state;
      return scanTables(state.doc.toString())[0].metadata!;
    };
    assert.equal(edit(raw, 'input').cells[0][0].format, undefined);
    assert.equal(edit('3', 'undo').cells[0][0].format?.kind, 'rating');
    assert.deepEqual(edit(raw, 'redo').snapshot, [[raw]]);
    assert.equal(
      edit('3', 'input').cells[0][0].format,
      undefined,
      'Manually removing code must not resurrect old formatting',
    );
  }
});

test('native colored highlights strip only their marker and retain the native color attribute', () => {
  for (const [token, color] of [
    ['🔴', 'red'],
    ['🟠', 'orange'],
    ['🟡', 'yellow'],
    ['🟢', 'green'],
    ['🔵', 'blue'],
    ['🟣', 'purple'],
  ]) {
    const raw = '==' + token + '***10***==';
    assert.equal(numeric(raw), 10);
    const parsed = inlineCell(raw);
    assert.deepEqual(parsed.marks, ['mark', 'strong', 'em']);
    assert.equal(parsed.highlightColors?.[0], color);
    assert.equal(numeric(token + '10'), null);
    assert.equal(numeric('==🔴10kg=='), null);
  }
});

test('plain selections hide original-value commands while decorated selections retain valid commands', () => {
  const rows = [
      ['A', 'B'],
      ['4', '3'],
    ],
    m = makeMetadata(rows),
    one = { r0: 1, r1: 1, c0: 0, c1: 0 },
    pair = { ...one, c1: 1 };
  for (const rect of [one, pair]) {
    const actions = selectionActions(rows, m, rect, 'cell', DEFAULTS);
    assert.equal(actions.copy, false);
    assert.equal(actions.edit, false);
  }
  for (const decoration of ['format', 'color', 'background', 'title', 'merge', 'diagonal']) {
    const meta = makeMetadata(rows);
    let rect = one;
    if (decoration === 'format') applyFormat(rows, meta, one, 'cell', 'rating', DEFAULTS);
    if (decoration === 'color') meta.cells[1][0].color = '#123456';
    if (decoration === 'background') meta.cells[1][0].background = '#123456';
    if (decoration === 'title') meta.headerRows = [1];
    if (decoration === 'merge') meta.merges = [pair];
    if (decoration === 'diagonal') {
      meta.diagonal = { lower: 'A', upper: '' };
      rect = { r0: 0, r1: 0, c0: 0, c1: 0 };
    }
    assert.equal(selectionActions(rows, meta, rect, 'cell', DEFAULTS).copy, true, decoration);
    assert.equal(selectionActions(rows, meta, rect, 'cell', DEFAULTS).edit, true, decoration);
  }
  m.cells[1][0].color = '#123456';
  assert.equal(selectionActions(rows, m, pair, 'cell', DEFAULTS).copy, true);
  assert.equal(selectionActions(rows, m, pair, 'cell', DEFAULTS).edit, false);
  delete m.cells[1][0].color;
  m.cells[1][0].barColor = '#123456';
  m.cells[1][0].titleColor = '#123456';
  assert.equal(
    selectionActions(rows, m, one, 'cell', DEFAULTS).copy,
    false,
    'Inactive stored colors do not decorate a plain cell',
  );
});

test('table calculation passes preserve independent groups and refresh titles, merges and edited values', () => {
  const rows = [
      ['100', '100'],
      ['1', '3'],
      ['3', '9'],
      ['bad', ''],
    ],
    m = makeMetadata(rows);
  m.headerRows = [0];
  applyFormat(rows, m, { r0: 0, r1: 3, c0: 0, c1: 1 }, 'column', 'calc', DEFAULTS);
  let display = formatTable(rows, m, DEFAULTS);
  assert.equal(display(1, 0).text, '25%');
  assert.equal(display(2, 0).text, '75%');
  assert.equal(display(1, 1).text, '25%');
  assert.equal(display(3, 0).text, 'bad(!NUM)');
  assert.equal(display(3, 1).text, '');
  m.merges = [{ r0: 1, r1: 2, c0: 0, c1: 0 }];
  display = formatTable(rows, m, DEFAULTS);
  assert.equal(display(1, 0).text, '100%');
  assert.equal(display(1, 1).text, '25%');
  // A later title setting includes existing title formats rather than cached totals.
  m.cells[0][0].format = structuredClone(m.cells[1][0].format);
  display = formatTable(rows, m, { ...DEFAULTS, formatTitles: true });
  assert.equal(display(1, 0).text, '0.99%');
  rows[1][0] = '**5**';
  display = formatTable(rows, m, { ...DEFAULTS, formatTitles: true });
  assert.equal(display(1, 0).text, '4.76%');
});

test('shared bar totals keep negative shifting, zero totals and finite extreme values stable', () => {
  const rows = [['-5'], ['0'], ['5']],
    m = makeMetadata(rows);
  applyFormat(rows, m, { r0: 0, r1: 2, c0: 0, c1: 0 }, 'column', 'bar', DEFAULTS);
  let display = formatTable(rows, m, { ...DEFAULTS, barLabel: 'percent' });
  assert.equal(display(0, 0).fraction, 0);
  assert.equal(display(1, 0).text, '33.33%');
  assert.equal(display(2, 0).text, '66.67%');
  rows[0][0] = '-10';
  display = formatTable(rows, m, { ...DEFAULTS, barLabel: 'percent' });
  assert.equal(display(1, 0).text, '40%');
  assert.equal(display(2, 0).text, '60%');
  rows[0][0] = '0';
  rows[2][0] = '0';
  display = formatTable(rows, m, DEFAULTS);
  assert.equal(display(1, 0).fraction, 0);
  rows[0][0] = '1' + '0'.repeat(308);
  rows[2][0] = rows[0][0];
  display = formatTable(rows, m, DEFAULTS);
  assert.equal(display(0, 0).fraction, 0.5);
});

test('a 5000-cell calculation pass produces the expected percentages for every cell', () => {
  const rows = Array.from({ length: 100 }, () => Array<string>(50).fill('1')),
    m = makeMetadata(rows);
  applyFormat(rows, m, { r0: 0, r1: 99, c0: 0, c1: 49 }, 'cell', 'calc', DEFAULTS);
  const display = formatTable(rows, m, DEFAULTS);
  for (let r = 0; r < 100; r++)
    for (let c = 0; c < 50; c++) assert.equal(display(r, c).text, '0.02%');
});
