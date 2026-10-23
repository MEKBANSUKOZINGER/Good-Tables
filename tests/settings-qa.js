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
  const document = tab.containerEl.ownerDocument;
  const window = document.defaultView;
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
    const definitions = flatten(tab.getSettingDefinitions());
    assert(
      definitions.some((item) => item.name === p.t('language')) &&
        definitions.some((item) => item.name === p.t('rows')),
      'Settings search definitions missing',
    );
    assert(row(p.t('rows'))?.querySelector('input'), 'Declarative numeric setting did not render');
    results.push('settings definitions expose searchable labels and render native controls');

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

    p.settings.favorites = ['#123456'];
    await p.saveSettings();
    tab.update();
    await wait();
    row(p.t('favorites')).querySelector('button').click();
    await wait();
    const modal = document.querySelector('.gt-modal');
    assert(modal, 'Color dialog missing');
    assert(
      window.getComputedStyle(modal.querySelector('.gt-color-picker')).height === '130px',
      'Color picker size changed',
    );
    const swatch = window.getComputedStyle(modal.querySelector('.gt-swatch'));
    assert(swatch.width === '30px' && swatch.height === '30px', 'Favorite swatch size changed');
    assert(
      window.getComputedStyle(modal.querySelector('.gt-delete-swatch')).height === '17px',
      'Delete swatch size changed',
    );
    results.push('scoped CSS preserves picker and swatch dimensions without important');

    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
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
