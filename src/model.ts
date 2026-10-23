export type FormatKind =
  'percent' | 'calc' | 'bar' | 'date' | 'datetime' | 'time' | 'rating' | 'custom';
export type Axis = 'cell' | 'row' | 'column';
export interface Rect {
  r0: number;
  r1: number;
  c0: number;
  c1: number;
}
export interface Format {
  kind: FormatKind;
  group: string;
  scope?: Axis;
  prefix?: string;
  suffix?: string;
}
export interface CellMeta {
  id: string;
  format?: Format;
  background?: string;
  color?: string;
}
export interface Metadata {
  version: 1;
  id: string;
  snapshot: string[][];
  cells: CellMeta[][];
  headerRows: number[];
  headerCols: number[];
  merges: Rect[];
  diagonal?: { lower: string; upper: string };
  widths: Record<string, number>;
  heights: Record<string, number>;
  alignments?: string[];
}
export interface Settings {
  language: 'auto' | 'en' | 'ko';
  rows: number;
  columns: number;
  diagonal: boolean;
  fullWidth: boolean;
  titleBackground: string;
  titleColor: string;
  decimals: number;
  date: string;
  datetime: string;
  time: string;
  ratingMax: number;
  formatTitles: boolean;
  barLabel: 'value' | 'percent';
  favorites: string[];
  presets: { id?: string; name: string; prefix: string; suffix: string }[];
  menuOrder: string[];
  formatOrder: string[];
  warned: boolean;
}
export const FORMAT_ORDER: FormatKind[] = [
  'percent',
  'calc',
  'bar',
  'date',
  'datetime',
  'time',
  'rating',
  'custom',
];
export const MENU_ORDER = ['diagonal', 'title', 'format', 'merge', 'background', 'color'];
export const DEFAULTS: Settings = {
  language: 'auto',
  rows: 3,
  columns: 3,
  diagonal: false,
  fullWidth: false,
  titleBackground: '',
  titleColor: '',
  decimals: 2,
  date: 'YYYY-MM-DD',
  datetime: 'YYYY-MM-DD HH:mm',
  time: 'HH:mm',
  ratingMax: 5,
  formatTitles: false,
  barLabel: 'value',
  favorites: [],
  presets: [],
  menuOrder: MENU_ORDER,
  formatOrder: FORMAT_ORDER,
  warned: false,
};
export const uid = (): string => crypto.randomUUID();
export const key = (r: number, c: number): string => `${r}:${c}`;
export function contains(a: Rect, r: number, c: number): boolean {
  return r >= a.r0 && r <= a.r1 && c >= a.c0 && c <= a.c1;
}
export function intersects(a: Rect, b: Rect): boolean {
  return a.r0 <= b.r1 && a.r1 >= b.r0 && a.c0 <= b.c1 && a.c1 >= b.c0;
}
export function positions(a: Rect): [number, number][] {
  const out: [number, number][] = [];
  for (let r = a.r0; r <= a.r1; r++) for (let c = a.c0; c <= a.c1; c++) out.push([r, c]);
  return out;
}
export function makeMetadata(rows: string[][]): Metadata {
  return {
    version: 1,
    id: uid(),
    snapshot: structuredClone(rows),
    cells: rows.map((row) => row.map(() => ({ id: uid() }))),
    headerRows: [],
    headerCols: [],
    merges: [],
    widths: {},
    heights: {},
  };
}
export const isTitle = (m: Metadata, r: number, c: number): boolean =>
  m.headerRows.includes(r) || m.headerCols.includes(c);
export function inheritedFormat(candidates: CellMeta[], scope: Axis): Format | undefined {
  const formats = candidates
    .map((cell) => cell.format)
    .filter((f): f is Format => !!f && f.scope === scope);
  return new Set(formats.map((f) => f.group)).size === 1 ? structuredClone(formats[0]) : undefined;
}
export class TableError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
export function normalizeSettings(raw: unknown): Settings {
  const input =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Partial<Settings>) : null;
  const s = { ...structuredClone(DEFAULTS), ...input };
  const integer = (v: unknown, min: number, max: number, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v)
      ? Math.max(min, Math.min(max, Math.round(v)))
      : fallback;
  s.rows = integer(s.rows, 1, 100, 3);
  s.columns = integer(s.columns, 1, 100, 3);
  s.decimals = integer(s.decimals, 0, 10, 2);
  s.ratingMax = integer(s.ratingMax, 1, 100, 5);
  for (const name of ['diagonal', 'fullWidth', 'formatTitles', 'warned'] as const)
    s[name] = typeof s[name] === 'boolean' ? s[name] : DEFAULTS[name];
  if (!['auto', 'en', 'ko'].includes(s.language)) s.language = 'auto';
  if (!['value', 'percent'].includes(s.barLabel)) s.barLabel = 'value';
  for (const name of ['titleBackground', 'titleColor'] as const)
    if (typeof s[name] !== 'string' || !/^$|^#[\da-f]{6}$/i.test(s[name])) s[name] = '';
  for (const name of ['date', 'datetime', 'time'] as const) {
    const tokens =
      name === 'date'
        ? ['YYYY', 'MM', 'DD']
        : name === 'time'
          ? ['HH', 'mm']
          : ['YYYY', 'MM', 'DD', 'HH', 'mm'];
    if (typeof s[name] !== 'string' || !tokens.every((t) => s[name].includes(t)))
      s[name] = DEFAULTS[name];
  }
  s.favorites = Array.isArray(s.favorites)
    ? s.favorites.filter((v) => typeof v === 'string' && /^#[\da-f]{6}$/i.test(v)).slice(0, 6)
    : [];
  s.presets = Array.isArray(s.presets)
    ? s.presets.filter(
        (v) =>
          v &&
          typeof v.name === 'string' &&
          typeof v.prefix === 'string' &&
          typeof v.suffix === 'string',
      )
    : [];
  const presetIds = new Set<string>();
  s.presets = s.presets.map((preset) => {
    let id = preset.id;
    if (!id || !/^[\da-f-]{36}$/i.test(id) || presetIds.has(id)) id = uid();
    presetIds.add(id);
    return { ...preset, id };
  });
  s.menuOrder = ordered(s.menuOrder, MENU_ORDER);
  s.formatOrder = formatMenuOrder(s);
  return s;
}
export function formatMenuOrder(settings: Pick<Settings, 'presets' | 'formatOrder'>): string[] {
  return [
    ...ordered(settings.formatOrder, [
      ...FORMAT_ORDER,
      ...settings.presets.map((preset) => `preset:${preset.id ?? ''}`),
    ]).filter((id) => id !== 'custom'),
    'custom',
  ];
}
export function formatMenuLabel(
  id: string,
  settings: Settings,
  label: (kind: FormatKind) => string,
): string {
  return id.startsWith('preset:')
    ? (settings.presets.find((preset) => `preset:${preset.id}` === id)?.name ?? '')
    : label(id as FormatKind);
}
function ordered<T extends string>(input: unknown, defaults: readonly T[]): T[] {
  return [
    ...new Set([
      ...(Array.isArray(input)
        ? input.filter(
            (v: unknown): v is T => typeof v === 'string' && defaults.some((value) => value === v),
          )
        : []),
      ...defaults,
    ]),
  ];
}
