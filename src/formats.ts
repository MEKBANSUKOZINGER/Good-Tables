import { Metadata, Settings, contains, isTitle } from './model';
import { numeric } from './operations';
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
export function displayCell(
  rows: string[][],
  m: Metadata,
  r: number,
  c: number,
  s: Settings,
): Display {
  const raw = rows[r][c],
    format = m.cells[r][c].format;
  if (!format || (isTitle(m, r, c) && !s.formatTitles)) return { text: raw };
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
  const members: number[] = [];
  for (let rr = 0; rr < rows.length; rr++)
    for (let cc = 0; cc < rows[rr].length; cc++) {
      if (m.cells[rr][cc].format?.group !== format.group || (isTitle(m, rr, cc) && !s.formatTitles))
        continue;
      if (m.merges.some((a) => contains(a, rr, cc) && (a.r0 !== rr || a.c0 !== cc))) continue;
      const value = numeric(rows[rr][cc]);
      if (value !== null) members.push(value);
    }
  if (format.kind === 'calc' && members.some((v) => v < 0)) return error('!NUM');
  const shift = format.kind === 'bar' ? Math.min(0, ...members) : 0;
  // Scale before summing to prevent finite, very large inputs overflowing the denominator.
  const scale = Math.max(1, ...members.map((v) => Math.abs(v)));
  const shifted = members.map((v) => v / scale - shift / scale);
  const total = shifted.reduce((a, b) => a + b, 0);
  const fraction = total === 0 ? 0 : Math.max(0, Math.min(1, (n / scale - shift / scale) / total));
  if (format.kind === 'calc') return { text: ratioLabel(fraction, s.decimals) };
  return { text: s.barLabel === 'percent' ? ratioLabel(fraction, s.decimals) : raw, fraction };
}
