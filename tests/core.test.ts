import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, makeMetadata, normalizeSettings } from '../src/model';
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
import { displayCell } from '../src/formats';
import { EditorState, Transaction } from '@codemirror/state';
import { metadataSynchronization } from '../src/metadata-sync';
import { nativeMovement } from '../src/native-table';
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
test('formatting is atomic, toggles off and blocks partially formatted selections', () => {
  const rows = [['1', '2']],
    m = makeMetadata(rows),
    s = settings();
  applyFormat(rows, m, cell, 'cell', 'percent', s);
  const before = structuredClone(m);
  throws(() => applyFormat(rows, m, { ...cell, c1: 1 }, 'row', 'calc', s), 'overlap');
  assert.deepEqual(m, before);
  applyFormat(rows, m, cell, 'cell', 'percent', s);
  assert.equal(m.cells[0][0].format, undefined);
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
