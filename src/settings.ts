import { App, Notice, PluginSettingTab, SettingDefinition, SettingDefinitionItem } from 'obsidian';
import type GoodTables from './main';
import { ColorModal, FormModal, OrderModal } from './dialogs';
import { formatMenuOrder, formatMenuLabel, uid } from './model';
import { Message } from './i18n';

export class GoodTablesSettings extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: GoodTables,
  ) {
    super(app, plugin);
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    const p = this.plugin;
    const t = p.t;
    const save = () => void p.saveSettings();
    const refresh = () => void p.saveSettings().then(() => this.update());
    const numeric = (
      label: Message,
      key: 'rows' | 'columns' | 'decimals' | 'ratingMax',
      min: number,
      max: number,
    ): SettingDefinition => ({
      name: t(label),
      render: (row) => {
        row.addText((input) => {
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
      },
    });
    const defaults: SettingDefinition[] = [
      numeric('rows', 'rows', 1, 100),
      numeric('columns', 'columns', 1, 100),
    ];
    defaults.push({
      name: t('diagonal'),
      render: (row) => {
        row.addToggle((toggle) =>
          toggle.setValue(p.settings.diagonal).onChange((value) => {
            p.settings.diagonal = value;
            save();
          }),
        );
      },
    });
    const tableSettings: SettingDefinition[] = [];
    for (const key of ['fullWidth', 'formatTitles'] as const) {
      tableSettings.push({
        name: t(key),
        render: (row) => {
          row.addToggle((toggle) =>
            toggle.setValue(p.settings[key]).onChange((value) => {
              p.settings[key] = value;
              save();
            }),
          );
        },
      });
    }
    for (const key of ['titleBackground', 'titleColor'] as const) {
      tableSettings.push({
        name: t(key),
        render: (row) => {
          row.addText((input) => {
            input
              .setPlaceholder(t('theme'))
              .setValue(p.settings[key])
              .onChange((value) => {
                if (value !== '' && !/^#[\da-f]{6}$/i.test(value)) return;
                p.settings[key] = value.toLowerCase();
                save();
              });
            input.inputEl.setAttribute('aria-label', t(key) + ' HEX');
            input.inputEl.addEventListener('blur', () => {
              input.setValue(p.settings[key]);
            });
          });
          row.addButton((button) =>
            button.setButtonText(t('pickColor')).onClick(() => {
              new ColorModal(
                this.app,
                t,
                t(key),
                p.settings[key],
                [],
                p.settings.favorites,
                (color) => {
                  p.settings[key] = color ?? '';
                  refresh();
                },
              ).open();
            }),
          );
        },
      });
    }
    tableSettings.push(
      numeric('decimals', 'decimals', 0, 10),
      numeric('ratingMax', 'ratingMax', 1, 100),
      {
        name: t('barLabel'),
        render: (row) => {
          row.addDropdown((dropdown) =>
            dropdown
              .addOptions({ value: t('value'), percent: t('percentLabel') })
              .setValue(p.settings.barLabel)
              .onChange((value) => {
                if (value !== 'value' && value !== 'percent') return;
                p.settings.barLabel = value;
                save();
              }),
          );
        },
      },
    );
    for (const key of ['date', 'datetime', 'time'] as const) {
      const tokens =
        key === 'date'
          ? ['YYYY', 'MM', 'DD']
          : key === 'time'
            ? ['HH', 'mm']
            : ['YYYY', 'MM', 'DD', 'HH', 'mm'];
      tableSettings.push({
        name: t(key),
        desc: tokens.join(', '),
        render: (row) => {
          row.addText((input) => {
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
        },
      });
    }
    tableSettings.push({
      name: t('favorites'),
      render: (row) => {
        row.addButton((button) =>
          button.setButtonText(t('edit')).onClick(() => {
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
            ).open();
          }),
        );
      },
    });
    for (const key of ['menuOrder', 'formatOrder'] as const) {
      tableSettings.push({
        name: t(key),
        render: (row) => {
          row.addButton((button) =>
            button.setButtonText(t('editOrder')).onClick(() => {
              new OrderModal(
                this.app,
                t,
                t(key),
                key === 'formatOrder' ? formatMenuOrder(p.settings) : p.settings[key],
                (id) =>
                  key === 'formatOrder'
                    ? formatMenuLabel(id, p.settings, (kind) => t(kind))
                    : t(id as Message),
                (order) => {
                  if (key === 'menuOrder') p.settings.menuOrder = order;
                  else p.settings.formatOrder = order;
                  save();
                },
              ).open();
            }),
          );
        },
      });
    }
    const editPreset = (index: number) => {
      const existing = p.settings.presets[index] ?? { name: '', prefix: '', suffix: '' };
      new FormModal(
        this.app,
        t('custom'),
        (modal) => {
          const name = modal.text(t('name'), existing.name);
          const prefix = modal.text(t('prefix'), existing.prefix);
          const suffix = modal.text(t('suffix'), existing.suffix);
          return () => {
            if (!name.value.trim()) {
              name.focus();
              return;
            }
            const preset = {
              id: existing.id ?? uid(),
              name: name.value.trim(),
              prefix: prefix.value,
              suffix: suffix.value,
            };
            if (index < 0) p.settings.presets.push(preset);
            else p.settings.presets[index] = preset;
            p.settings.formatOrder = formatMenuOrder(p.settings);
            refresh();
            modal.close();
          };
        },
        t,
      ).open();
    };
    const presets: SettingDefinition[] = p.settings.presets.map((preset, index) => ({
      name: preset.name,
      desc: preset.prefix + '…' + preset.suffix,
      render: (row) => {
        row.addButton((button) => button.setButtonText(t('edit')).onClick(() => editPreset(index)));
        row.addButton((button) =>
          button.setButtonText('×').onClick(() => {
            p.settings.presets.splice(index, 1);
            p.settings.formatOrder = formatMenuOrder(p.settings);
            refresh();
          }),
        );
      },
    }));
    presets.push({
      name: t('add'),
      render: (row) => {
        row.addButton((button) => button.setButtonText(t('add')).onClick(() => editPreset(-1)));
      },
    });
    return [
      {
        name: t('language'),
        render: (row) => {
          row.addDropdown((dropdown) =>
            dropdown
              .addOptions({ auto: t('auto'), en: 'English', ko: '한국어' })
              .setValue(p.settings.language)
              .onChange((value) => {
                if (value !== 'auto' && value !== 'en' && value !== 'ko') return;
                p.settings.language = value;
                refresh();
              }),
          );
        },
      },
      { type: 'group', heading: t('defaults'), items: defaults },
      { type: 'group', heading: t('tableSettings'), items: tableSettings },
      { type: 'group', heading: t('presets'), items: presets },
    ];
  }
}
