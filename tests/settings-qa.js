// Run through the official Obsidian CLI. Restores plugin settings after checking the real settings window.
(async () => {
  const p = app.plugins.plugins['good-tables'];
  const saved = structuredClone(p.settings);
  const results = [];
  const assert = (condition, message) => {
    if (!condition) throw Error(message);
  };
  const wait = () => new Promise((resolve) => setTimeout(resolve, 300));
  const tab = app.setting.pluginTabs.find((tab) => tab.plugin === p);
  assert(tab, 'Good Tables settings tab missing');
  let document = tab.containerEl.ownerDocument;
  let window = document.defaultView;
  const flatten = (items) => items.flatMap((item) => (item.items ? flatten(item.items) : [item]));
  const row = (label) =>
    [...tab.containerEl.querySelectorAll('.setting-item')].find(
      (el) => el.querySelector('.setting-item-name')?.textContent === label,
    );
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  try {
    app.setting.open();
    app.setting.openTabById('good-tables');
    await wait();
    document = tab.containerEl.ownerDocument;
    window = document.defaultView;
    const definitions = flatten(tab.getSettingDefinitions());
    assert(
      definitions.some((item) => item.name === p.t('language')) &&
        definitions.some((item) => item.name === p.t('rows')),
      'Settings search definitions missing',
    );
    assert(row(p.t('rows'))?.querySelector('input'), 'Declarative numeric setting did not render');
    results.push('settings definitions expose searchable labels and render native controls');
    const groups = tab.getSettingDefinitions().filter((item) => item.type === 'group');
    assert(
      groups.find((group) => group.heading === p.t('defaults'))?.items.length === 3,
      'New table defaults must contain exactly rows, columns and diagonal',
    );
    assert(
      groups.some((group) => group.heading === p.t('tableSettings')),
      'Table settings group missing',
    );
    for (const key of ['titleBackground', 'titleColor']) {
      const input = row(p.t(key)).querySelector('input[type=text]');
      assert(input, 'Title color HEX input missing');
      input.value = '#abcdef';
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
      await wait();
      assert(p.settings[key] === '#abcdef', 'Title color HEX did not save');
      assert(
        row(p.t(key)).querySelector('.gt-setting-color-preview')?.style.backgroundColor ===
          'rgb(171, 205, 239)',
        'Visible title color preview did not update',
      );
      input.value = '#invalid';
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
      assert(p.settings[key] === '#abcdef', 'Invalid title HEX saved');
    }
    results.push('new table defaults separated and both title color HEX fields save valid values');

    const rowsInput = row(p.t('rows')).querySelector('input');
    rowsInput.value = '0';
    rowsInput.dispatchEvent(new window.Event('change', { bubbles: true }));
    assert(
      rowsInput.value === String(saved.rows) && p.settings.rows === saved.rows,
      'Invalid row count was accepted',
    );
    rowsInput.value = String(saved.rows === 4 ? 5 : 4);
    rowsInput.dispatchEvent(new window.Event('change', { bubbles: true }));
    await wait();
    assert(p.settings.rows === Number(rowsInput.value), 'Valid row count did not save');
    results.push('numeric bounds and persistence preserved');

    const language = row(p.t('language')).querySelector('select');
    language.value = 'en';
    language.dispatchEvent(new window.Event('change', { bubbles: true }));
    await wait();
    assert(row('Language'), 'Language change did not refresh the tab');
    assert(
      flatten(tab.getSettingDefinitions()).some((item) => item.name === 'Language'),
      'Search labels did not refresh',
    );
    results.push('language changes refresh controls and search labels through update');

    p.settings.presets = [{ name: 'QA preset', prefix: '[', suffix: ']' }];
    await p.saveSettings();
    tab.update();
    await wait();
    assert(row('QA preset'), 'Preset definition did not render');
    row('QA preset').querySelectorAll('button')[1].click();
    await wait();
    assert(
      !row('QA preset') &&
        !flatten(tab.getSettingDefinitions()).some((item) => item.name === 'QA preset'),
      'Preset deletion did not refresh',
    );
    results.push('dynamic presets update rendered rows and search definitions');
    row(p.t('add')).querySelector('button').click();
    await wait();
    const form =
      document.querySelector('.gt-modal') ?? globalThis.document.querySelector('.gt-modal');
    const fields = form.querySelectorAll('input');
    fields[0].value = 'QA saved format';
    fields[1].value = '[';
    fields[2].value = ']';
    form.querySelector('.mod-cta').click();
    await wait();
    const created = p.settings.presets.find((preset) => preset.name === 'QA saved format');
    assert(
      created?.id && p.settings.formatOrder.includes(`preset:${created.id}`),
      'New saved format missing stable menu ID',
    );
    row(p.t('formatOrder')).querySelector('button').click();
    await wait();
    const order =
      document.querySelector('.gt-modal') ?? globalThis.document.querySelector('.gt-modal');
    const item = [...order.querySelectorAll('.gt-order-item')].find((el) =>
      el.textContent.includes('QA saved format'),
    );
    assert(item, 'Saved format missing from order dialog');
    const fixed = order.querySelector('.gt-order-item:last-child');
    assert(
      fixed.textContent.includes(p.t('custom')) &&
        fixed.draggable === false &&
        [...fixed.querySelectorAll('button')].every((button) => button.disabled),
      'Custom order row must remain fixed at the bottom',
    );
    const previous = p.settings.formatOrder.indexOf(`preset:${created.id}`);
    item.querySelector('button').click();
    order.querySelector('.mod-cta').click();
    await wait();
    assert(
      p.settings.formatOrder.indexOf(`preset:${created.id}`) === previous - 1,
      'Saved format order did not change',
    );
    assert(p.settings.formatOrder.at(-1) === 'custom', 'Custom format must remain last');
    results.push('adding a saved format creates an independently reorderable menu item');

    p.settings.favorites = ['#123456'];
    await p.saveSettings();
    tab.update();
    await wait();
    row(p.t('favorites')).querySelector('button').click();
    await wait();
    const modal =
      document.querySelector('.gt-modal') ?? globalThis.document.querySelector('.gt-modal');
    assert(modal, 'Color dialog missing');
    modal.querySelector('.gt-swatch').click();
    const selected = modal.querySelector('.gt-swatch.is-selected[aria-pressed=true]');
    assert(
      selected &&
        modal.querySelector('.gt-color-preview-card:last-child .gt-color-preview-swatch')?.style
          .backgroundColor === 'rgb(18, 52, 86)',
      'Favorite selection or chosen-color preview missing',
    );
    results.push('favorite editor marks the selected color and displays a live preview');
    assert(
      window.getComputedStyle(modal.querySelector('.gt-color-surface')).height === '220px' &&
        modal.querySelector('.gt-hue-strip[type=range]'),
      'Always-visible color surface and hue strip missing',
    );
    const swatch = window.getComputedStyle(modal.querySelector('.gt-swatch'));
    assert(swatch.width === '30px' && swatch.height === '30px', 'Favorite swatch size changed');
    assert(
      window.getComputedStyle(modal.querySelector('.gt-delete-swatch')).height === '17px',
      'Delete swatch size changed',
    );
    results.push('scoped CSS preserves picker and swatch dimensions without important');

    modal.ownerDocument.dispatchEvent(
      new modal.ownerDocument.defaultView.KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
      }),
    );
    await wait();
    assert(
      !Object.hasOwn(Object.getPrototypeOf(tab), 'display'),
      'Deprecated display override remains',
    );
    results.push('settings use declarative rendering without a deprecated display override');
    return JSON.stringify({ pass: results.length, results });
  } catch (error) {
    return JSON.stringify({
      pass: results.length,
      results,
      error: error.message,
      stack: error.stack,
    });
  } finally {
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    p.settings = saved;
    await p.saveSettings();
    tab.update();
    app.setting.close();
  }
})();
