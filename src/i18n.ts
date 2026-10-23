import { Settings } from './model';
const messages = {
  create: ['Create table', '표 만들기'],
  rows: ['Rows', '행'],
  columns: ['Columns', '열'],
  diagonal: ['Diagonal first cell', '첫 칸 대각선'],
  confirm: ['Apply', '적용'],
  cancel: ['Cancel', '취소'],
  remove: ['Remove style', '스타일 없애기'],
  close: ['Close', '닫기'],
  title: ['Set title row / column', '제목 행 / 열 설정'],
  clearTitle: ['Clear title', '제목 해제'],
  format: ['Format', '서식 설정'],
  merge: ['Merge cells', '칸 병합'],
  unmerge: ['Unmerge cells', '병합 취소'],
  background: ['Background color', '배경색 설정'],
  color: ['Text color', '글자색 선택'],
  structure: ['Rows and columns', '행·열 편집'],
  size: ['Cell size', '칸 크기'],
  percent: ['Percentage (%)', '비율(%)'],
  calc: ['Percentage (Calc%)', '비율(Calc%)'],
  bar: ['Horizontal bar (Calc)', '가로 막대(Calc)'],
  date: ['Date', '날짜'],
  datetime: ['Date and time', '날짜 (시각 포함)'],
  time: ['Time', '시각'],
  rating: ['Rating', '별점'],
  custom: ['Custom', '사용자 지정'],
  prefix: ['Prefix', '접두사'],
  suffix: ['Suffix', '접미사'],
  name: ['Name', '이름'],
  edit: ['Edit original value', '원본 값 편집'],
  lower: ['Lower left', '왼쪽 아래'],
  upper: ['Upper right', '오른쪽 위'],
  beforeRow: ['Insert row above', '위에 행 추가'],
  afterRow: ['Insert row below', '아래에 행 추가'],
  beforeColumn: ['Insert column left', '왼쪽에 열 추가'],
  afterColumn: ['Insert column right', '오른쪽에 열 추가'],
  deleteRows: ['Delete selected rows', '선택한 행 삭제'],
  deleteColumns: ['Delete selected columns', '선택한 열 삭제'],
  selectRow: ['Select row', '행 선택'],
  selectColumn: ['Select column', '열 선택'],
  width: ['Column width (px)', '열 너비 (px)'],
  height: ['Row height (px)', '행 높이 (px)'],
  resetSize: ['Reset size', '크기 초기화'],
  language: ['Language', '언어'],
  auto: ['Follow Obsidian', 'Obsidian 언어 따르기'],
  defaults: ['New table defaults', '새 표 기본값'],
  fullWidth: ['Fit table to document width', '표를 문서 너비에 맞춤'],
  titleBackground: ['Title background color', '제목 배경색'],
  titleColor: ['Title text color', '제목 글자색'],
  decimals: ['Percentage decimal places', '비율 소수점 표시 한도'],
  ratingMax: ['Maximum rating', '별점 최댓값'],
  formatTitles: ['Allow formats on title cells', '제목 행·열에도 서식 적용'],
  barLabel: ['Bar label', '막대 표시 값'],
  value: ['Original number', '원본 숫자'],
  percentLabel: ['Percentage', '비율'],
  favorites: ['Favorite colors', '자주 쓰는 색'],
  presets: ['Favorite custom formats', '자주 쓰는 사용자 서식'],
  menuOrder: ['Context menu order', '우클릭 메뉴 순서'],
  formatOrder: ['Format menu order', '서식 메뉴 순서'],
  add: ['Add', '추가'],
  editOrder: ['Reorder', '순서 변경'],
  usedColors: ['Colors used in this note', '이 문서에서 사용한 색'],
  theme: ['Use theme default', '테마 기본색 사용'],
  copy: ['Copy original values', '원본 값 복사'],
  paste: ['Paste cells', '여러 셀 붙여넣기'],
  warn: [
    'Without Good Tables, tables appear as ordinary Markdown tables; merged, diagonal and formatted displays disappear. Original Markdown values are kept.',
    'Good Tables를 끄면 일반 Markdown 표로 표시되며 병합·대각선·서식 표시가 사라집니다. Markdown 원본 값은 유지됩니다.',
  ],
  selection: ['Select a rectangular range of cells.', '직사각형 셀 범위를 선택하세요.'],
  selectAxis: [
    'Select a row or column using its selection handle.',
    '선택 버튼으로 행 또는 열을 선택하세요.',
  ],
  overlap: [
    'A selected cell already has a format. Remove it before applying another.',
    '선택 영역에 이미 서식이 있습니다. 기존 서식을 먼저 해제하세요.',
  ],
  negative: [
    'Percentage formats cannot be applied to negative values.',
    '음수가 포함된 영역에는 비율 서식을 적용할 수 없습니다.',
  ],
  titleError: [
    'This operation does not apply to title cells.',
    '제목 칸에는 이 작업을 적용할 수 없습니다.',
  ],
  titleMerge: [
    'A merge cannot cross title and ordinary cells.',
    '제목 영역과 일반 영역을 가로질러 병합할 수 없습니다.',
  ],
  merged: ['Unmerge existing merged cells first.', '기존 병합을 먼저 취소하세요.'],
  notMerged: ['No merged cells are selected.', '선택 영역에 병합된 칸이 없습니다.'],
  diagonalMerge: ['A diagonal cell cannot be merged.', '대각선 칸은 병합할 수 없습니다.'],
  unmergeFirst: [
    'Unmerge intersecting cells before changing this structure.',
    '이 영역의 병합을 취소한 뒤 구조를 변경하세요.',
  ],
  diagonalStructure: [
    'Turn off the diagonal before inserting or deleting the first row or column.',
    '첫 행·열을 추가하거나 삭제하기 전에 대각선을 해제하세요.',
  ],
  last: [
    'A table must keep at least one row and one column.',
    '표에는 최소 한 행과 한 열이 있어야 합니다.',
  ],
  sizeError: [
    'Use 1–100 rows and columns, with at most 5,000 cells.',
    '행·열은 각각 1~100, 전체 칸은 5,000개 이하여야 합니다.',
  ],
  pasteSize: [
    'The pasted range does not fit. Add rows or columns first.',
    '붙여넣을 영역이 표보다 큽니다. 행·열을 먼저 추가하세요.',
  ],
  stale: [
    'The table structure changed ambiguously. Extension information has been preserved but is not applied. Undo the structural change or use Reset Good Tables information for this table.',
    '표 구조 변경의 셀 대응을 확인할 수 없습니다. 확장 정보는 보존했으나 적용하지 않습니다. 구조 변경을 실행 취소하거나 이 표의 Good Tables 정보 초기화를 사용하세요.',
  ],
  metadata: [
    'Extension information is invalid or from an unsupported version. It has not been overwritten.',
    '확장 정보가 손상되었거나 지원하지 않는 버전입니다. 기존 정보를 덮어쓰지 않았습니다.',
  ],
  conflict: [
    'The table changed while the dialog was open. Reopen the dialog and try again.',
    '창이 열린 동안 표가 변경되었습니다. 창을 다시 열어 시도하세요.',
  ],
  readonly: [
    'Switch to editing view to change this table.',
    '편집 보기로 전환한 뒤 표를 변경하세요.',
  ],
  reset: ['Reset Good Tables information for this table', '이 표의 Good Tables 정보 초기화'],
  resetWarning: [
    'Remove this table’s extension information? Markdown cell contents will be kept. You can undo this change.',
    '이 표의 확장 정보를 초기화할까요? Markdown 셀 내용은 유지됩니다. 실행 취소할 수 있습니다.',
  ],
  invalidPattern: [
    'Required date/time tokens are missing. The previous value was restored.',
    '필수 날짜·시각 토큰이 없습니다. 이전 값으로 복원했습니다.',
  ],
  noTable: ['Place the cursor in a Markdown table.', 'Markdown 표 안에 커서를 놓으세요.'],
  warningTitle: ['Good Tables display compatibility', 'Good Tables 표시 호환성'],
  error: [
    'The operation could not be completed. See the console for details.',
    '작업을 완료하지 못했습니다. 콘솔에서 상세 내용을 확인하세요.',
  ],
} as const;
export type Message = keyof typeof messages;
export function translator(s: Settings, obsidianLanguage: string): (key: Message) => string {
  const lang =
    s.language === 'auto'
      ? obsidianLanguage.toLowerCase().startsWith('ko')
        ? 'ko'
        : 'en'
      : s.language;
  return (key) => messages[key][lang === 'ko' ? 1 : 0];
}
