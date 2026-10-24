export type InlineMark = 'strong' | 'em' | 's' | 'mark' | 'code';
export interface InlineCell {
  text: string;
  marks: InlineMark[];
  hidden: boolean;
  highlightColors?: Record<number, string>;
}

export function exclusiveInline(raw: string): boolean {
  return (
    /(^|[^\\])`+[^`\n]+`+/.test(raw) || /(^|[^\\])\$[^$\n]+\$/.test(raw) || /%%[\s\S]*?%%/.test(raw)
  );
}

/** Read whole-cell inline presentation without changing the stored Markdown. */
export function inlineCell(raw: string): InlineCell {
  const marks: InlineMark[] = [];
  const highlightColors: Record<number, string> = {};
  const colors: Record<string, string> = {
    '🔴': 'red',
    '🟠': 'orange',
    '🟡': 'yellow',
    '🟢': 'green',
    '🔵': 'blue',
    '🟣': 'purple',
  };
  let text = raw;
  for (let depth = 0; depth < 20; depth++) {
    if (text.startsWith('%%') && text.endsWith('%%') && text.length >= 4)
      return { text: '', marks, hidden: true };
    const code = text.match(/^(`+)([\s\S]*?)\1$/);
    if (code && code[2] && !code[2].includes(code[1])) {
      text = code[2];
      if (text.startsWith(' ') && text.endsWith(' ') && text.trim()) text = text.slice(1, -1);
      marks.push('code');
      break;
    }
    const pair = (
      [
        ['**', 'strong'],
        ['__', 'strong'],
        ['~~', 's'],
        ['==', 'mark'],
        ['*', 'em'],
        ['_', 'em'],
      ] as const
    ).find(
      ([delimiter]) =>
        text.length > delimiter.length * 2 &&
        text.startsWith(delimiter) &&
        text.endsWith(delimiter) &&
        !text.endsWith('\\' + delimiter),
    );
    if (!pair) break;
    marks.push(pair[1]);
    text = text.slice(pair[0].length, -pair[0].length);
    if (pair[1] === 'mark') {
      const token = Object.keys(colors).find((token) => text.startsWith(token));
      if (token) {
        highlightColors[marks.length - 1] = colors[token];
        text = text.slice(token.length);
      }
    }
  }
  return {
    text,
    marks,
    hidden: false,
    ...(Object.keys(highlightColors).length ? { highlightColors } : {}),
  };
}

export function fillInline(element: HTMLElement, text: string, presentation: InlineCell): void {
  element.empty();
  if (presentation.hidden) return;
  let target = element;
  for (const [index, tag] of presentation.marks.entries()) {
    target = target.createEl(tag);
    if (tag === 'mark' && presentation.highlightColors?.[index])
      target.setAttribute('data-highlight', presentation.highlightColors[index]);
  }
  target.textContent = text;
}
