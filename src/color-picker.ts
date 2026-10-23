export interface HSV {
  h: number;
  s: number;
  v: number;
}
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
export function hexToHsv(hex: string): HSV {
  const [r, g, b] = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    delta = max - min;
  const hue = !delta
    ? 0
    : max === r
      ? ((g - b) / delta) % 6
      : max === g
        ? (b - r) / delta + 2
        : (r - g) / delta + 4;
  return { h: (hue * 60 + 360) % 360, s: max ? delta / max : 0, v: max };
}
export function hsvToHex({ h, s, v }: HSV): string {
  h = ((h % 360) + 360) % 360;
  s = clamp(s);
  v = clamp(v);
  const c = v * s,
    x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
    m = v - c;
  const values =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return (
    '#' +
    values
      .map((value) =>
        Math.round((value + m) * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

/** An always-visible saturation/value surface and hue strip, in its owner's document. */
export class ColorPicker {
  readonly element: HTMLElement;
  readonly surface: HTMLElement;
  readonly hue: HTMLInputElement;
  private thumb: HTMLElement;
  private hsv: HSV;
  private value: string;
  constructor(
    parent: HTMLElement,
    initial: string,
    private change: (color: string) => void,
    labels: { surface: string; hue: string },
  ) {
    this.value = initial.toLowerCase();
    this.hsv = hexToHsv(this.value);
    this.element = parent.createDiv({ cls: 'gt-color-picker' });
    this.surface = this.element.createDiv({
      cls: 'gt-color-surface',
      attr: {
        role: 'slider',
        tabindex: '0',
        'aria-label': labels.surface,
        'aria-valuemin': '0',
        'aria-valuemax': '100',
      },
    });
    this.thumb = this.surface.createSpan({ cls: 'gt-color-thumb' });
    this.hue = this.element.createEl('input', {
      type: 'range',
      cls: 'gt-hue-strip',
      attr: { min: '0', max: '360', step: '1', 'aria-label': labels.hue },
    });
    const pick = (event: PointerEvent) => {
      const rect = this.surface.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      this.hsv.s = clamp((event.clientX - rect.left) / rect.width);
      this.hsv.v = 1 - clamp((event.clientY - rect.top) / rect.height);
      this.emit();
    };
    this.surface.onpointerdown = (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      this.surface.focus();
      this.surface.setPointerCapture?.(event.pointerId);
      pick(event);
    };
    this.surface.onpointermove = (event) => {
      if (event.buttons & 1) pick(event);
    };
    this.surface.onkeydown = (event) => {
      const step = event.shiftKey ? 0.1 : 0.01;
      if (event.key === 'ArrowLeft') this.hsv.s = clamp(this.hsv.s - step);
      else if (event.key === 'ArrowRight') this.hsv.s = clamp(this.hsv.s + step);
      else if (event.key === 'ArrowUp') this.hsv.v = clamp(this.hsv.v + step);
      else if (event.key === 'ArrowDown') this.hsv.v = clamp(this.hsv.v - step);
      else return;
      event.preventDefault();
      this.emit();
    };
    this.hue.oninput = () => {
      this.hsv.h = Number(this.hue.value);
      this.emit();
    };
    this.draw();
  }
  setColor(value: string): void {
    value = value.toLowerCase();
    if (value === this.value) return;
    const next = hexToHsv(value);
    if (!next.s || !next.v) next.h = this.hsv.h;
    this.hsv = next;
    this.value = value;
    this.draw();
  }
  private emit(): void {
    this.value = hsvToHex(this.hsv);
    this.draw();
    this.change(this.value);
  }
  private draw(): void {
    this.element.setCssProps({
      '--gt-picker-hue': `hsl(${this.hsv.h} 100% 50%)`,
      '--gt-picker-color': this.value,
    });
    this.thumb.setCssProps({
      '--gt-picker-x': `${this.hsv.s * 100}%`,
      '--gt-picker-y': `${(1 - this.hsv.v) * 100}%`,
    });
    this.hue.value = String(this.hsv.h);
    this.surface.setAttribute('aria-valuenow', String(Math.round(this.hsv.s * 100)));
    this.surface.setAttribute(
      'aria-valuetext',
      `${Math.round(this.hsv.s * 100)}%, ${Math.round(this.hsv.v * 100)}%`,
    );
  }
}
