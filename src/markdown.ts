import { Metadata, TableError, makeMetadata, FormatKind, inheritedFormat } from './model';
import { exclusiveInline } from './inline';
export interface Row {
  raw: string;
  prefix: string;
  values: string[];
  spans: { from: number; to: number }[];
}
export interface Table {
  from: number;
  to: number;
  line: number;
  endLine: number;
  prefix: string;
  eol: string;
  rows: Row[];
  divider: Row;
  metadata?: Metadata;
  invalidMetadata: boolean;
  metadataFrom?: number;
  metadataTo?: number;
}
export function splitRow(line: string): Row | null {
  const prefix = line.match(/^(?: {0,3}> ?)*[ \t]*/)?.[0] ?? '';
  const start = prefix.length;
  if (!line.slice(start).includes('|')) return null;
  const cuts: number[] = [];
  let slashes = 0;
  for (let i = start; i < line.length; i++) {
    if (line[i] === '|' && slashes % 2 === 0) cuts.push(i);
    slashes = line[i] === '\\' ? slashes + 1 : 0;
  }
  if (!cuts.length) return null;
  const left = line.slice(start, cuts[0]).trim() === '' ? cuts.shift()! + 1 : start;
  const last = cuts[cuts.length - 1];
  const right =
    last !== undefined && line.slice(last + 1).trim() === '' ? cuts.pop()! : line.length;
  const bounds = [left, ...cuts.map((i) => i + 1), right + 1];
  const values: string[] = [],
    spans: { from: number; to: number }[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const a = bounds[i],
      b = i === bounds.length - 2 ? right : bounds[i + 1] - 1;
    if (b < a) continue;
    const part = line.slice(a, b);
    const leading = part.match(/^\s*/)?.[0].length ?? 0;
    const trailing = part.match(/\s*$/)?.[0].length ?? 0;
    values.push(part.trim());
    spans.push({ from: a + leading, to: Math.max(a + leading, b - trailing) });
  }
  return values.length ? { raw: line, prefix, values, spans } : null;
}
const divider = (r: Row) => r.values.every((v) => /^:?-{2,}:?$/.test(v));
export function scanTables(source: string): Table[] {
  const lines = source.split(/\r?\n/);
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset +=
      line.length +
      (source.slice(offset + line.length, offset + line.length + 2) === '\r\n' ? 2 : 1);
  }
  const result: Table[] = [];
  let fence: { char: string; size: number } | undefined;
  let comment = false;
  let frontmatter = lines[0] === '---';
  for (let i = 0; i < lines.length - 1; i++) {
    if (frontmatter) {
      if (i > 0 && /^(---|\.\.\.)\s*$/.test(lines[i])) frontmatter = false;
      continue;
    }
    const line = lines[i];
    const content = line.replace(/^(?: {0,3}> ?)* {0,3}/, '');
    const f = content.match(/^(`{3,}|~{3,})/);
    if (f) {
      if (!fence) fence = { char: f[1][0], size: f[1].length };
      else if (f[1][0] === fence.char && f[1].length >= fence.size) fence = undefined;
      continue;
    }
    if (fence) continue;
    if (comment) {
      if (line.includes('-->')) comment = false;
      continue;
    }
    if (content.startsWith('<!--')) {
      comment = !content.includes('-->');
      continue;
    }
    if (/^ {4}|^\t/.test(line)) continue;
    const first = splitRow(line),
      div = splitRow(lines[i + 1]);
    if (
      !first ||
      !div ||
      first.prefix !== div.prefix ||
      !divider(div) ||
      first.values.length !== div.values.length
    )
      continue;
    const rows = [first];
    let j = i + 2;
    while (j < lines.length) {
      const row = splitRow(lines[j]);
      if (!row || row.prefix !== first.prefix || row.values.length > first.values.length) break;
      while (row.values.length < first.values.length) {
        row.values.push('');
        row.spans.push({ from: row.raw.length, to: row.raw.length });
      }
      rows.push(row);
      j++;
    }
    const table: Table = {
      from: offsets[i],
      to: offsets[j - 1] + lines[j - 1].length,
      line: i,
      endLine: j - 1,
      prefix: first.prefix,
      eol: source.includes('\r\n') ? '\r\n' : '\n',
      rows,
      divider: div,
      invalidMetadata: false,
    };
    let metadataLine = j;
    if (lines[j] !== undefined && lines[j].trim() === first.prefix.trim()) metadataLine++;
    const next = lines[metadataLine]?.slice(first.prefix.length);
    const definition = next?.match(/^\[good-tables-([\da-f-]+)-0-(\d+)\]: good-tables:(\S+)\s*$/);
    if (definition) {
      table.metadataFrom = offsets[metadataLine];
      table.metadataTo = offsets[metadataLine] + lines[metadataLine].length;
      try {
        const id = definition[1],
          count = Number(definition[2]);
        if (count < 1 || count > 100000) throw Error();
        const chunks: string[] = [];
        for (let part = 0; part < count; part++) {
          const line = lines[metadataLine + part]?.slice(first.prefix.length),
            match = line?.match(/^\[good-tables-([\da-f-]+)-(\d+)-(\d+)\]: good-tables:(\S+)\s*$/);
          if (!match || match[1] !== id || Number(match[2]) !== part || Number(match[3]) !== count)
            throw Error();
          chunks.push(match[4]);
          table.metadataTo = offsets[metadataLine + part] + lines[metadataLine + part].length;
        }
        const value: unknown = JSON.parse(decodeURIComponent(chunks.join('')));
        if (!validMetadata(value) || value.id !== id) throw Error();
        table.metadata = value;
      } catch {
        table.invalidMetadata = true;
      }
    } else if (next?.startsWith('<!-- good-tables:')) {
      table.metadataFrom = offsets[metadataLine];
      table.metadataTo = offsets[metadataLine] + lines[metadataLine].length;
      try {
        const parts = [next];
        let last = metadataLine;
        while (!parts[parts.length - 1].includes('-->') && last + 1 < lines.length) {
          const part = lines[last + 1].slice(first.prefix.length);
          if (!/^(?:[A-Za-z0-9%_.!~*'()]*|-->)\s*$/.test(part)) throw Error();
          parts.push(part);
          last++;
        }
        const match = parts.join('\n').match(/^<!-- good-tables:([\s\S]*?)-->\s*$/);
        if (!match) throw Error();
        table.metadataTo = offsets[last] + lines[last].length;
        const value: unknown = JSON.parse(decodeURIComponent(match[1].replace(/\s/g, '')));
        if (!validMetadata(value)) throw Error();
        table.metadata = value;
      } catch {
        table.invalidMetadata = true;
      }
    }
    result.push(table);
    i = j - 1;
  }
  return result;
}
export const values = (t: Table): string[][] => t.rows.map((row) => [...row.values]);
export function validMetadata(v: unknown): v is Metadata {
  if (!v || typeof v !== 'object') return false;
  const m = v as Metadata;
  if (
    m.version !== 1 ||
    typeof m.id !== 'string' ||
    !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(m.id) ||
    !Array.isArray(m.snapshot) ||
    !m.snapshot.length ||
    m.snapshot.length > 100 ||
    !Array.isArray(m.cells)
  )
    return false;
  const cols = m.snapshot[0]?.length;
  if (
    !cols ||
    cols > 100 ||
    cols * m.snapshot.length > 5000 ||
    m.cells.length !== m.snapshot.length
  )
    return false;
  if (
    m.alignments !== undefined &&
    (!Array.isArray(m.alignments) ||
      m.alignments.length !== cols ||
      !m.alignments.every((v) => typeof v === 'string' && /^:?-{2,}:?$/.test(v)))
  )
    return false;
  const kinds: FormatKind[] = [
    'percent',
    'calc',
    'bar',
    'date',
    'datetime',
    'time',
    'rating',
    'custom',
  ];
  const ids = new Set<string>();
  for (let r = 0; r < m.snapshot.length; r++) {
    if (
      !Array.isArray(m.snapshot[r]) ||
      m.snapshot[r].length !== cols ||
      !m.snapshot[r].every((x) => typeof x === 'string') ||
      !Array.isArray(m.cells[r]) ||
      m.cells[r].length !== cols
    )
      return false;
    for (const cell of m.cells[r]) {
      if (!cell || typeof cell.id !== 'string' || ids.has(cell.id)) return false;
      ids.add(cell.id);
      if (
        ['background', 'color', 'titleBackground', 'titleColor', 'barColor'].some((key) => {
          const value = (cell as unknown as Record<string, unknown>)[key];
          return (
            value !== undefined && (typeof value !== 'string' || !/^#[\da-f]{6}$/i.test(value))
          );
        })
      )
        return false;
      if (
        cell.format &&
        (!kinds.includes(cell.format.kind) ||
          typeof cell.format.group !== 'string' ||
          (cell.format.prefix !== undefined && typeof cell.format.prefix !== 'string') ||
          (cell.format.suffix !== undefined && typeof cell.format.suffix !== 'string'))
      )
        return false;
      if (
        cell.format?.scope !== undefined &&
        !['cell', 'row', 'column'].includes(cell.format.scope)
      )
        return false;
    }
  }
  const indexes = (a: unknown, n: number) =>
    Array.isArray(a) && a.every((i) => Number.isInteger(i) && i >= 0 && i < n);
  if (
    !indexes(m.headerRows, m.snapshot.length) ||
    !indexes(m.headerCols, cols) ||
    !Array.isArray(m.merges)
  )
    return false;
  for (const a of m.merges)
    if (
      !a ||
      ![a.r0, a.r1, a.c0, a.c1].every(Number.isInteger) ||
      a.r0 < 0 ||
      a.c0 < 0 ||
      a.r1 < a.r0 ||
      a.c1 < a.c0 ||
      a.r1 >= m.snapshot.length ||
      a.c1 >= cols
    )
      return false;
  for (const sizes of [m.widths, m.heights])
    if (
      !sizes ||
      typeof sizes !== 'object' ||
      Object.entries(sizes).some(
        ([k, n]) => !/^\d+$/.test(k) || !Number.isFinite(n) || n < 20 || n > 4000,
      )
    )
      return false;
  if (m.diagonal && (typeof m.diagonal.lower !== 'string' || typeof m.diagonal.upper !== 'string'))
    return false;
  return true;
}
export function metadataBlock(m: Metadata, prefix = '', eol = '\n'): string {
  const encoded = encodeURIComponent(JSON.stringify(m)).replace(/-/g, '%2D');
  const chunks = encoded.match(/.{1,120}/g) ?? [];
  // Unused Markdown reference definitions are hidden by standard Markdown readers
  // and do not introduce a multiline HTML tokenizer state into native table editing.
  return chunks
    .map(
      (chunk, index) =>
        `${prefix}[good-tables-${m.id}-${index}-${chunks.length}]: good-tables:${chunk}`,
    )
    .join(eol);
}
export function escapeCell(value: string): string {
  return value.replace(/\r?\n/g, '<br>').replace(/(^|[^\\])((?:\\\\)*)\|/g, '$1$2\\|');
}
export function serializeRows(
  rows: string[][],
  prefix = '',
  eol = '\n',
  dividerValues?: string[],
): string {
  const line = (row: string[]) => prefix + '| ' + row.join(' | ') + ' |';
  return [
    line(rows[0]),
    line(dividerValues ?? rows[0].map(() => '---')),
    ...rows.slice(1).map(line),
  ].join(eol);
}
export function serializeEdit(t: Table, rows: string[][], m: Metadata): string {
  m.snapshot = structuredClone(rows);
  if (!validMetadata(m)) throw new TableError('metadata');
  const sameShape =
    rows.length === t.rows.length && rows.every((row, r) => row.length === t.rows[r].values.length);
  let body: string;
  if (sameShape) {
    const output = t.rows.map((row, r) => {
      let line = row.raw;
      if (
        splitRow(row.raw)!.values.length < rows[r].length &&
        rows[r].some((v, c) => v !== row.values[c])
      )
        return row.prefix + '| ' + rows[r].join(' | ') + ' |';
      for (let c = rows[r].length - 1; c >= 0; c--)
        if (rows[r][c] !== row.values[c]) {
          const span = row.spans[c];
          line = line.slice(0, span.from) + rows[r][c] + line.slice(span.to);
        }
      return line;
    });
    output.splice(1, 0, t.divider.raw);
    body = output.join(t.eol);
  } else
    body = serializeRows(
      rows,
      t.prefix,
      t.eol,
      m.alignments ?? rows[0].map((_, c) => t.divider.values[c] ?? '---'),
    );
  return body + t.eol + t.prefix + t.eol + metadataBlock(m, t.prefix, t.eol);
}
/** Map externally edited rows/columns by stable content; refuse ambiguous structural edits. */
function mapAxis(old: string[][], current: string[][]): number[] {
  const oldKeys = old.map((row) => JSON.stringify(row)),
    newKeys = current.map((row) => JSON.stringify(row));
  const used = new Set<number>();
  const out = newKeys.map((k) => {
    const found = oldKeys.map((v, i) => (v === k && !used.has(i) ? i : -1)).filter((i) => i >= 0);
    if (found.length === 1) {
      used.add(found[0]);
      return found[0];
    }
    return -1;
  });
  const remainingOld = oldKeys.map((_, i) => i).filter((i) => !used.has(i)),
    remainingNew = out.map((v, i) => (v < 0 ? i : -1)).filter((i) => i >= 0);
  if (old.length === current.length && out.every((v, i) => v < 0 || v === i))
    return out.map((v, i) => (v < 0 ? i : v));
  if (remainingOld.length === 1 && remainingNew.length === 1) {
    out[remainingNew[0]] = remainingOld[0];
    return out;
  }
  if (remainingOld.length === 0) return out;
  if (remainingNew.length === 0) return out;
  // Duplicate unchanged rows can keep their original relative order.
  if (
    remainingOld.length === remainingNew.length &&
    remainingNew.every((n, i) => newKeys[n] === oldKeys[remainingOld[i]])
  ) {
    remainingNew.forEach((n, i) => (out[n] = remainingOld[i]));
    return out;
  }
  throw new TableError('stale');
}
const transpose = (rows: string[][]) => rows[0].map((_, c) => rows.map((row) => row[c]));
export interface TablePermutation {
  rows: number[];
  columns: number[];
}
function combinedPermutation(before: string[][], after: string[][]): TablePermutation | undefined {
  if (before.length !== after.length || before[0].length !== after[0].length) return;
  const axis = (old: string[][], next: string[][]) => {
    const keys = old.map((row) => JSON.stringify([...row].sort()));
    if (new Set(keys).size !== keys.length) return;
    const map = next.map((row) => keys.indexOf(JSON.stringify([...row].sort())));
    return map.every((i) => i >= 0) && new Set(map).size === map.length ? map : undefined;
  };
  const rows = axis(before, after),
    columns = axis(transpose(before), transpose(after));
  if (
    rows &&
    columns &&
    after.every((row, r) => row.every((value, c) => value === before[rows[r]][columns[c]]))
  )
    return { rows, columns };
}
export function reconcile(t: Table): Metadata {
  if (t.invalidMetadata) throw new TableError('metadata');
  const rows = values(t);
  if (!t.metadata) {
    const m = makeMetadata(rows);
    m.alignments = [...t.divider.values];
    return m;
  }
  const m = structuredClone(t.metadata);
  m.alignments = [...t.divider.values];
  if (JSON.stringify(m.snapshot) === JSON.stringify(rows)) return removeExclusiveFormats(m, rows);
  const combined = combinedPermutation(m.snapshot, rows);
  if (combined && combined.rows.some((r, i) => r !== i) && combined.columns.some((c, i) => c !== i))
    return remapMetadata(m, rows, combined.rows, combined.columns);
  let rm: number[], cm: number[];
  if (m.snapshot[0].length === rows[0].length) {
    try {
      rm = mapAxis(m.snapshot, rows);
      cm = rows[0].map((_, c) => c);
    } catch {
      if (m.snapshot.length !== rows.length) throw new TableError('stale');
      cm = mapAxis(transpose(m.snapshot), transpose(rows));
      rm = rows.map((_, r) => r);
    }
    // A native column reorder also changes all rows; prefer a provable column permutation.
    if (m.snapshot.length === rows.length) {
      try {
        const candidate = mapAxis(transpose(m.snapshot), transpose(rows));
        if (candidate.every((c) => c >= 0) && candidate.some((c, i) => c !== i)) {
          cm = candidate;
          rm = rows.map((_, r) => r);
        }
      } catch {
        /* Row mapping already resolved the edit. */
      }
    }
  } else if (m.snapshot.length === rows.length) {
    cm = mapAxis(transpose(m.snapshot), transpose(rows));
    rm = rows.map((_, r) => r);
  } else throw new TableError('stale');
  return remapMetadata(m, rows, rm, cm);
}
export function remapMetadata(
  metadata: Metadata,
  rows: string[][],
  rm: number[],
  cm: number[],
  nativeMove = false,
): Metadata {
  const m = structuredClone(metadata),
    before = structuredClone(metadata);
  m.cells = rows.map((row, r) =>
    row.map((_, c) => {
      const old = before.cells[rm[r]]?.[cm[c]];
      if (old) return old;
      const format =
        rm[r] < 0 && cm[c] >= 0
          ? inheritedFormat(
              before.cells.map((row) => row[cm[c]]),
              'column',
            )
          : cm[c] < 0 && rm[r] >= 0
            ? inheritedFormat(before.cells[rm[r]], 'row')
            : undefined;
      return { id: crypto.randomUUID(), ...(format ? { format } : {}) };
    }),
  );
  m.headerRows = rm.flatMap((old, r) => (before.headerRows.includes(old) ? [r] : []));
  m.headerCols = cm.flatMap((old, c) => (before.headerCols.includes(old) ? [c] : []));
  m.widths = Object.fromEntries(
    cm.flatMap((old, c) => (before.widths[old] !== undefined ? [[c, before.widths[old]]] : [])),
  );
  m.heights = Object.fromEntries(
    rm.flatMap((old, r) => (before.heights[old] !== undefined ? [[r, before.heights[old]]] : [])),
  );
  m.merges = before.merges.flatMap((a) => {
    const rs = rm.flatMap((old, r) => (old >= a.r0 && old <= a.r1 ? [r] : [])),
      cs = cm.flatMap((old, c) => (old >= a.c0 && old <= a.c1 ? [c] : []));
    if (
      rs.length !== a.r1 - a.r0 + 1 ||
      cs.length !== a.c1 - a.c0 + 1 ||
      Math.max(...rs) - Math.min(...rs) + 1 !== rs.length ||
      Math.max(...cs) - Math.min(...cs) + 1 !== cs.length
    ) {
      if (nativeMove) return [];
      throw new TableError('stale');
    }
    return [{ r0: Math.min(...rs), r1: Math.max(...rs), c0: Math.min(...cs), c1: Math.max(...cs) }];
  });
  if (m.diagonal) {
    if (rm[0] !== 0 || cm[0] !== 0) {
      if (nativeMove) delete m.diagonal;
      else throw new TableError('stale');
    }
    if (m.diagonal && rows[0][0] !== m.diagonal.lower + m.diagonal.upper)
      m.diagonal = { lower: rows[0][0], upper: '' };
  }
  m.snapshot = rows;
  return removeExclusiveFormats(m, rows);
}

function removeExclusiveFormats(m: Metadata, rows: string[][]): Metadata {
  rows.forEach((row, r) =>
    row.forEach((raw, c) => {
      if (exclusiveInline(raw)) delete m.cells[r][c].format;
    }),
  );
  return m;
}
