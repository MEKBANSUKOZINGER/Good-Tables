import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type GoodTables from './main';
import { ColorModal, FormModal, OrderModal } from './dialogs';
import { FormatKind } from './model';
import { Message } from './i18n';
export class GoodTablesSettings extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: GoodTables,
  ) {
    super(app, plugin);
  }
  display(): void {
    const { containerEl: el, plugin: p } = this;
    el.empty();
    const t = p.t;
    const save = () => void p.saveSettings();
    new Setting(el).setName(t('language')).addDropdown((d) =>
      d
        .addOptions({ auto: t('auto'), en: 'English', ko: '한국어' })
        .setValue(p.settings.language)
        .onChange((v) => {
          p.settings.language = v as 'auto' | 'en' | 'ko';
          void p.saveSettings().then(() => this.display());
        }),
    );
    const numeric = (
      label: Message,
      key: 'rows' | 'columns' | 'decimals' | 'ratingMax',
      min: number,
      max: number,
    ) => {
      new Setting(el).setName(t(label)).addText((input) => {
        input.inputEl.type = 'number';
        input.inputEl.min = String(min);
        input.inputEl.max = String(max);
        input.setValue(String(p.settings[key]));
        input.inputEl.addEventListener('change', () => {
          const n = Number(input.getValue());
          if (Number.isInteger(n) && n >= min && n <= max) {
            p.settings[key] = n;
            save();
          } else input.setValue(String(p.settings[key]));
        });
      });
    };
    el.createEl('h3', { text: t('defaults') });
    numeric('rows', 'rows', 1, 100);
    numeric('columns', 'columns', 1, 100);
    for (const [label, key] of [
      ['diagonal', 'diagonal'],
      ['fullWidth', 'fullWidth'],
      ['formatTitles', 'formatTitles'],
    ] as const)
      new Setting(el).setName(t(label)).addToggle((toggle) =>
        toggle.setValue(p.settings[key]).onChange((v) => {
          p.settings[key] = v;
          save();
        }),
      );
    for (const key of ['titleBackground', 'titleColor'] as const) {
      const row = new Setting(el).setName(t(key));
      row.addButton((b) =>
        b.setButtonText(p.settings[key] || t('theme')).onClick(() =>
          new ColorModal(
            this.app,
            t,
            t(key),
            p.settings[key],
            [],
            p.settings.favorites,
            (color) => {
              p.settings[key] = color ?? '';
              void p.saveSettings().then(() => this.display());
            },
          ).open(),
        ),
      );
    }
    numeric('decimals', 'decimals', 0, 10);
    numeric('ratingMax', 'ratingMax', 1, 100);
    new Setting(el).setName(t('barLabel')).addDropdown((d) =>
      d
        .addOptions({ value: t('value'), percent: t('percentLabel') })
        .setValue(p.settings.barLabel)
        .onChange((v) => {
          p.settings.barLabel = v as 'value' | 'percent';
          save();
        }),
    );
    for (const key of ['date', 'datetime', 'time'] as const) {
      const tokens =
        key === 'date'
          ? ['YYYY', 'MM', 'DD']
          : key === 'time'
            ? ['HH', 'mm']
            : ['YYYY', 'MM', 'DD', 'HH', 'mm'];
      new Setting(el)
        .setName(t(key))
        .setDesc(tokens.join(', '))
        .addText((input) => {
          input.setValue(p.settings[key]);
          input.inputEl.addEventListener('change', () => {
            const value = input.getValue();
            if (tokens.every((token) => value.includes(token))) {
              p.settings[key] = value;
              save();
            } else {
              input.setValue(p.settings[key]);
              new Notice(t('invalidPattern'));
            }
          });
        });
    }
    new Setting(el).setName(t('favorites')).addButton((b) =>
      b.setButtonText(t('edit')).onClick(() =>
        new ColorModal(
          this.app,
          t,
          t('favorites'),
          '#729bf5',
          [],
          p.settings.favorites,
          () => {},
          (colors) => {
            p.settings.favorites = colors;
            save();
          },
        ).open(),
      ),
    );
    for (const [label, key] of [
      ['menuOrder', 'menuOrder'],
      ['formatOrder', 'formatOrder'],
    ] as const)
      new Setting(el).setName(t(label)).addButton((b) =>
        b.setButtonText(t('editOrder')).onClick(() =>
          new OrderModal(
            this.app,
            t,
            t(label),
            p.settings[key],
            (id) => t(id as Message),
            (order) => {
              if (key === 'menuOrder') p.settings.menuOrder = order;
              else p.settings.formatOrder = order as FormatKind[];
              save();
            },
          ).open(),
        ),
      );
    el.createEl('h3', { text: t('presets') });
    const editPreset = (index: number) => {
      const existing = p.settings.presets[index] ?? { name: '', prefix: '', suffix: '' };
      new FormModal(
        this.app,
        t('custom'),
        (m) => {
          const name = m.text(t('name'), existing.name),
            prefix = m.text(t('prefix'), existing.prefix),
            suffix = m.text(t('suffix'), existing.suffix);
          return () => {
            if (!name.value.trim()) {
              name.focus();
              return;
            }
            const preset = { name: name.value.trim(), prefix: prefix.value, suffix: suffix.value };
            if (index < 0) p.settings.presets.push(preset);
            else p.settings.presets[index] = preset;
            void p.saveSettings().then(() => this.display());
            m.close();
          };
        },
        t,
      ).open();
    };
    p.settings.presets.forEach((preset, index) =>
      new Setting(el)
        .setName(preset.name)
        .setDesc(preset.prefix + '…' + preset.suffix)
        .addButton((b) => b.setButtonText(t('edit')).onClick(() => editPreset(index)))
        .addButton((b) =>
          b.setButtonText('×').onClick(() => {
            p.settings.presets.splice(index, 1);
            void p.saveSettings().then(() => this.display());
          }),
        ),
    );
    new Setting(el).addButton((b) => b.setButtonText(t('add')).onClick(() => editPreset(-1)));
  }
}
