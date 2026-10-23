import { App, Modal, Setting } from 'obsidian';
import { Message } from './i18n';
import { ColorPicker } from './color-picker';
type T = (key: Message) => string;
export class FormModal extends Modal {
  private apply: () => void = () => {};
  constructor(
    app: App,
    private title: string,
    private build: (modal: FormModal) => () => void,
    private t: T,
  ) {
    super(app);
  }
  onOpen(): void {
    this.titleEl.setText(this.title);
    this.modalEl.addClass('gt-modal');
    this.apply = this.build(this);
    const actions = this.contentEl.createDiv({ cls: 'gt-actions' });
    actions.createEl('button', { text: this.t('cancel') }).onclick = () => this.close();
    actions.createEl('button', { text: this.t('confirm'), cls: 'mod-cta' }).onclick = () =>
      this.apply();
    this.scope.register(['Mod'], 'Enter', () => this.apply());
  }
  text(label: string, value: string, multiline = false): HTMLInputElement | HTMLTextAreaElement {
    const wrap = this.contentEl.createEl('label', { cls: 'gt-field', text: label });
    const input = multiline ? wrap.createEl('textarea') : wrap.createEl('input', { type: 'text' });
    input.value = value;
    return input;
  }
  number(label: string, value: number, min = 1, max = 100): HTMLInputElement {
    const wrap = this.contentEl.createEl('label', { cls: 'gt-field', text: label });
    const input = wrap.createEl('input', { type: 'number' });
    input.value = String(value);
    input.min = String(min);
    input.max = String(max);
    input.step = '1';
    input.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        input.value = String(
          Math.max(min, Math.min(max, (Number(input.value) || min) + (e.deltaY < 0 ? 1 : -1))),
        );
        input.dispatchEvent(new Event('input'));
      },
      { passive: false },
    );
    return input;
  }
  toggle(label: string, value: boolean): () => boolean {
    let current = value;
    new Setting(this.contentEl)
      .setName(label)
      .addToggle((toggle) => toggle.setValue(value).onChange((v) => (current = v)));
    return () => current;
  }
}
export function confirmModal(app: App, t: T, title: string, text: string, apply: () => void): void {
  new FormModal(
    app,
    title,
    (m) => {
      m.contentEl.createEl('p', { text });
      return () => {
        apply();
        m.close();
      };
    },
    t,
  ).open();
}
export class ColorModal extends Modal {
  private value: string;
  private picker!: ColorPicker;
  private hex!: HTMLInputElement;
  private preview!: HTMLElement;
  private previewHex!: HTMLElement;
  private drawPalette: () => void = () => {};
  private rgb: HTMLInputElement[] = [];
  private selected = -1;
  constructor(
    app: App,
    private t: T,
    private title: string,
    private initial: string | null,
    private used: string[],
    private favorites: string[],
    private change: (color: string | null) => void,
    private manage?: (colors: string[]) => void,
  ) {
    super(app);
    this.value = initial && /^#[\da-f]{6}$/i.test(initial) ? initial : '#729bf5';
    this.favorites = [...favorites];
  }
  onOpen(): void {
    this.titleEl.setText(this.title);
    this.modalEl.addClass('gt-modal');
    this.picker = new ColorPicker(this.contentEl, this.value, (value) => this.set(value), {
      surface: this.t('saturationValue'),
      hue: this.t('hue'),
    });
    const comparison = this.contentEl.createDiv({ cls: 'gt-color-comparison' });
    const original = comparison.createDiv({ cls: 'gt-color-preview-card' });
    original.createSpan({ text: this.t('currentColor') });
    const originalSwatch = original.createDiv({ cls: 'gt-color-preview-swatch' });
    if (this.initial) originalSwatch.setCssStyles({ backgroundColor: this.initial });
    original.createSpan({
      text: this.initial === null ? this.t('mixedColors') : this.initial || this.t('theme'),
    });
    const chosen = comparison.createDiv({ cls: 'gt-color-preview-card' });
    chosen.createSpan({ text: this.t('selectedColor') });
    this.preview = chosen.createDiv({ cls: 'gt-color-preview-swatch' });
    this.previewHex = chosen.createSpan();
    this.updatePreview();
    const inputs = this.contentEl.createDiv({ cls: 'gt-color-inputs' });
    const row = inputs.createDiv({ cls: 'gt-rgb' });
    const hexLabel = inputs.createEl('label', { cls: 'gt-hex', text: 'HEX' });
    this.hex = hexLabel.createEl('input', {
      type: 'text',
      attr: { 'aria-label': 'HEX', placeholder: '#123456', maxlength: '7' },
    });
    this.hex.value = this.value;
    this.hex.oninput = () => {
      if (/^#[\da-f]{6}$/i.test(this.hex.value)) this.set(this.hex.value);
    };
    this.rgb = ['R', 'G', 'B'].map((label, i) => {
      const wrap = row.createEl('label', { text: label });
      const input = wrap.createEl('input', { type: 'number' });
      input.min = '0';
      input.max = '255';
      input.value = String(parseInt(this.value.slice(1 + i * 2, 3 + i * 2), 16));
      input.oninput = () => {
        if (
          this.rgb.every(
            (v) =>
              v.value !== '' &&
              Number.isInteger(Number(v.value)) &&
              Number(v.value) >= 0 &&
              Number(v.value) <= 255,
          )
        )
          this.set(
            '#' + this.rgb.map((v) => Number(v.value).toString(16).padStart(2, '0')).join(''),
          );
      };
      return input;
    });
    const palette = this.contentEl.createDiv({ cls: 'gt-palette-wrap' });
    const draw = () => {
      palette.empty();
      if (!this.manage) palette.createEl('p', { text: this.t('favorites') });
      const favorites = palette.createDiv({ cls: 'gt-swatches' });
      this.favorites.forEach((color, i) => {
        const wrap = favorites.createDiv({ cls: 'gt-swatch-wrap' });
        const swatch = this.swatch(wrap, color, () => {
          this.selected = this.manage ? i : -1;
          this.set(color, false);
        });
        if (this.manage) {
          swatch.classList.toggle('is-selected', this.selected === i);
          swatch.setAttribute('aria-pressed', String(this.selected === i));
        }
        if (this.manage) {
          const remove = wrap.createEl('button', {
            text: '×',
            cls: 'gt-delete-swatch',
            attr: { 'aria-label': 'Remove color' },
          });
          remove.onclick = () => {
            this.favorites.splice(i, 1);
            this.selected = -1;
            draw();
          };
        }
      });
      if (this.manage && this.favorites.length < 6)
        favorites.createEl('button', {
          text: '+',
          cls: 'gt-swatch',
          attr: { 'aria-label': this.t('add') },
        }).onclick = () => {
          this.favorites.push(this.value);
          this.selected = this.favorites.length - 1;
          draw();
        };
      if (this.used.length) {
        palette.createEl('p', { text: this.t('usedColors') });
        const used = palette.createDiv({ cls: 'gt-swatches' });
        this.used.forEach((color) =>
          this.swatch(used, color, () => {
            this.selected = -1;
            this.set(color, false);
          }),
        );
      }
    };
    this.drawPalette = draw;
    draw();
    const actions = this.contentEl.createDiv({ cls: 'gt-actions' });
    actions.createEl('button', { text: this.t('cancel') }).onclick = () => this.close();
    if (!this.manage)
      actions.createEl('button', { text: this.t('remove') }).onclick = () => {
        this.change(null);
        this.close();
      };
    actions.createEl('button', { text: this.t('confirm'), cls: 'mod-cta' }).onclick = () => {
      if (this.rgb.some((v) => !v.checkValidity() || v.value === '')) return;
      if (!/^#[\da-f]{6}$/i.test(this.hex.value)) {
        this.hex.focus();
        return;
      }
      if (this.manage) this.manage(this.favorites);
      else this.change(this.value);
      this.close();
    };
  }
  private swatch(parent: HTMLElement, color: string, select: () => void): HTMLButtonElement {
    const b = parent.createEl('button', {
      cls: 'gt-swatch',
      attr: { 'aria-label': color, title: color },
    });
    b.style.backgroundColor = color;
    b.onclick = select;
    return b;
  }
  private set(value: string, updateFavorite = true): void {
    this.value = value.toLowerCase();
    this.picker.setColor(this.value);
    this.hex.value = this.value;
    this.updatePreview();
    this.rgb.forEach(
      (input, i) => (input.value = String(parseInt(value.slice(1 + i * 2, 3 + i * 2), 16))),
    );
    if (updateFavorite && this.manage && this.selected >= 0) this.favorites[this.selected] = value;
    this.drawPalette();
  }
  private updatePreview(): void {
    this.preview.setCssStyles({ backgroundColor: this.value });
    this.preview.setAttribute('aria-label', this.t('selectedColor') + ' ' + this.value);
    this.previewHex.textContent = this.value;
  }
}
export class OrderModal extends Modal {
  constructor(
    app: App,
    private t: T,
    private title: string,
    private items: string[],
    private label: (id: string) => string,
    private save: (items: string[]) => void,
    private fixedLast?: string,
  ) {
    super(app);
    this.items = [...items];
  }
  onOpen(): void {
    this.titleEl.setText(this.title);
    this.modalEl.addClass('gt-modal');
    const list = this.contentEl.createDiv();
    let source = -1;
    const move = (from: number, to: number) => {
      if (this.items[from] === this.fixedLast || this.items[to] === this.fixedLast) return;
      const [item] = this.items.splice(from, 1);
      this.items.splice(to, 0, item);
      draw();
    };
    const draw = () => {
      list.empty();
      this.items.forEach((id, i) => {
        const row = list.createDiv({ cls: 'gt-order-item', attr: { draggable: 'true' } });
        const fixed = id === this.fixedLast;
        if (fixed) row.draggable = false;
        row.createSpan({ text: '⠿ ' + this.label(id) });
        row.ondragstart = () => (source = i);
        row.ondragover = (e) => e.preventDefault();
        row.ondrop = (e) => {
          e.preventDefault();
          if (source >= 0) move(source, i);
          source = -1;
        };
        const up = row.createEl('button', { text: '↑', attr: { 'aria-label': 'Move up' } });
        up.disabled = i === 0 || fixed;
        up.onclick = () => move(i, i - 1);
        const down = row.createEl('button', { text: '↓', attr: { 'aria-label': 'Move down' } });
        down.disabled =
          i === this.items.length - 1 || fixed || this.items[i + 1] === this.fixedLast;
        down.onclick = () => move(i, i + 1);
      });
    };
    draw();
    const actions = this.contentEl.createDiv({ cls: 'gt-actions' });
    actions.createEl('button', { text: this.t('cancel') }).onclick = () => this.close();
    actions.createEl('button', { text: this.t('confirm'), cls: 'mod-cta' }).onclick = () => {
      this.save(this.items);
      this.close();
    };
  }
}
