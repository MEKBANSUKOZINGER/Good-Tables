import { Metadata, Settings, isTitle } from './model';
import { numeric } from './operations';
import { inlineCell } from './inline';
export interface Display {
  text: string;
  fraction?: number;
  error?: boolean;
}
const numberFormats = new Map<number, Intl.NumberFormat>();
function rounded(n: number, decimals: number): string {
  let fmt = numberFormats.get(decimals);
  if (!fmt) {
    fmt = new Intl.NumberFormat('en-US', { useGrouping: false, maximumFractionDigits: decimals });
    numberFormats.set(decimals, fmt);
  }
  return fmt.format(n);
}
export function ratioLabel(n: number, decimals: number): string {
  return `${rounded(n * 100, decimals)}%`;
}
interface CalculationGroup {
  negative: boolean;
  shift: number;
  scale: number;
  total: number;
  shiftedTotal: number;
}

function calculationGroups(
  rows: string[][],
  m: Metadata,
  s: Settings,
): Map<string, CalculationGroup> {
  const members = new Map<string, number[]>();
  for (const row of m.cells)
    for (const { format } of row)
      if (format && (format.kind === 'calc' || format.kind === 'bar') && !members.has(format.group))
        members.set(format.group, []);
  const groups = new Map<string, CalculationGroup>();
  if (!members.size) return groups;
  const columns = rows[0].length,
    covered = new Set<number>();
  for (const merge of m.merges)
    for (let r = merge.r0; r <= merge.r1; r++)
      for (let c = merge.c0; c <= merge.c1; c++)
        if (r !== merge.r0 || c !== merge.c0) covered.add(r * columns + c);
  for (let r = 0; r < rows.length; r++)
    for (let c = 0; c < columns; c++) {
      const format = m.cells[r][c].format;
      if (
        !format ||
        !members.has(format.group) ||
        (isTitle(m, r, c) && !s.formatTitles) ||
        covered.has(r * columns + c)
      )
        continue;
      const value = numeric(rows[r][c]);
      if (value !== null) members.get(format.group)!.push(value);
    }
  for (const [id, values] of members) {
    const scale = Math.max(1, ...values.map((value) => Math.abs(value)));
    const shift = Math.min(0, ...values);
    groups.set(id, {
      negative: values.some((value) => value < 0),
      scale,
      shift,
      total: values.reduce((sum, value) => sum + value / scale, 0),
      shiftedTotal: values.reduce((sum, value) => sum + (value / scale - shift / scale), 0),
    });
  }
  return groups;
}

/** A render pass shares group totals; a new pass reads fresh values and settings. */
export function formatTable(
  rows: string[][],
  m: Metadata,
  s: Settings,
): (r: number, c: number) => Display {
  const groups = calculationGroups(rows, m, s);
  return (r, c) => displayCell(rows, m, r, c, s, groups);
}
export function displayCell(
  rows: string[][],
  m: Metadata,
  r: number,
  c: number,
  s: Settings,
  groups?: Map<string, CalculationGroup>,
): Display {
  const presentation = inlineCell(rows[r][c]);
  const raw = presentation.text,
    format = m.cells[r][c].format;
  if (!format || (isTitle(m, r, c) && !s.formatTitles)) return { text: rows[r][c] };
  if (presentation.hidden) return { text: '' };
  const error = (code: string): Display => ({ text: `${raw}(${code})`, error: true });
  if (format.kind === 'custom')
    return { text: (format.prefix ?? '') + raw + (format.suffix ?? '') };
  if (['date', 'datetime', 'time'].includes(format.kind)) {
    const len = format.kind === 'date' ? 8 : format.kind === 'datetime' ? 12 : 4;
    if (!new RegExp(`^\\d{${len}}$`).test(raw)) return error('!NODATE');
    const parts =
      format.kind === 'time'
        ? { HH: raw.slice(0, 2), mm: raw.slice(2, 4) }
        : {
            YYYY: raw.slice(0, 4),
            MM: raw.slice(4, 6),
            DD: raw.slice(6, 8),
            HH: raw.slice(8, 10),
            mm: raw.slice(10, 12),
          };
    const pattern =
      format.kind === 'date' ? s.date : format.kind === 'datetime' ? s.datetime : s.time;
    return {
      text: pattern.replace(/YYYY|MM|DD|HH|mm/g, (t) => parts[t as keyof typeof parts] ?? t),
    };
  }
  const n = numeric(raw);
  if (n === null) return raw === '' ? { text: '' } : error('!NUM');
  if (format.kind === 'rating') {
    const clipped = Math.max(0, Math.min(s.ratingMax, n));
    const score = clipped % 1 === 0.5 ? clipped : Math.round(clipped);
    if (score > 10) return { text: `★ X ${Math.round(score)}` };
    return { text: '★'.repeat(Math.floor(score)) + (score % 1 === 0.5 ? '☆' : '') };
  }
  if (format.kind === 'percent')
    return n < 0 ? error('!NUM') : { text: `${rounded(n, s.decimals)}%` };
  const group = (groups ?? calculationGroups(rows, m, s)).get(format.group)!;
  if (format.kind === 'calc' && group.negative) return error('!NUM');
  const shift = format.kind === 'bar' ? group.shift : 0;
  const scale = group.scale;
  const total = format.kind === 'bar' ? group.shiftedTotal : group.total;
  const fraction = total === 0 ? 0 : Math.max(0, Math.min(1, (n / scale - shift / scale) / total));
  if (format.kind === 'calc') return { text: ratioLabel(fraction, s.decimals) };
  return { text: s.barLabel === 'percent' ? ratioLabel(fraction, s.decimals) : raw, fraction };
}
