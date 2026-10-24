// Official CLI only; changes the generated QA note and restores plugin settings.
(async () => {
  const view = app.workspace.activeLeaf.view,
    path = 'qa-vault/Good Tables QA.md';
  if (view.file?.path !== path) throw Error('Open generated QA note first');
  const p = app.plugins.plugins['good-tables'];
  if (!p) throw Error('Plugin is not loaded');
  if (
    typeof app.plugins.disablePlugin !== 'function' ||
    typeof app.plugins.enablePlugin !== 'function'
  )
    throw Error('Plugin lifecycle API unavailable');
  const saved = structuredClone(p.settings),
    doc = view.containerEl.ownerDocument,
    win = doc.defaultView,
    results = [];
  const wait = () => new Promise((resolve) => win.setTimeout(resolve, 150));
  const assert = (ok, message) => {
    if (!ok) throw Error(message);
  };
  const binding = (plugin) =>
    [...plugin.controllers].flatMap((c) => c.bindings).find((b) => b.editor === view.editor);
  try {
    p.settings.warned = true;
    await p.saveSettings();
    view.editor.setValue(
      '# Good Tables QA\n\n| Title | Value | Note |\n| --- | --- | --- |\n| **4** | 3 | A |\n| Hidden | 2 | B |\n\nOutside.\n',
    );
    view.editor.setCursor(0, 0);
    await wait();
    p.apply(binding(p), (rows, m) => {
      m.diagonal = { lower: 'Lower', upper: 'Upper' };
      rows[0][0] = 'LowerUpper';
      m.cells[1][0].format = { kind: 'rating', group: crypto.randomUUID(), scope: 'cell' };
      m.cells[1][0].color = '#123456';
      m.cells[1][0].background = '#abcdef';
      m.merges = [{ r0: 1, r1: 2, c0: 2, c1: 2 }];
    });
    await wait();
    assert(
      view.containerEl.querySelector('.gt-display') &&
        view.containerEl.querySelector('.gt-diagonal-overlay') &&
        view.containerEl.querySelector('.gt-merge-overlay'),
      'Fixture decorations missing',
    );
    const source = view.editor.getValue();
    await app.plugins.disablePlugin('good-tables');
    await wait();
    assert(!app.plugins.plugins['good-tables'], 'Plugin remains loaded');
    assert(
      !view.containerEl.querySelector(
        '.gt-cell,.gt-table,.gt-display,.gt-merge-overlay,.gt-diagonal-overlay',
      ),
      'Unload left decoration nodes/classes',
    );
    assert(
      view.containerEl.querySelector('table.cm-table-widget, .cm-table-widget table'),
      'Native table widget missing after unload',
    );
    assert(
      ![...view.containerEl.querySelectorAll('td,th')].some(
        (cell) => cell.style.getPropertyValue('--gt-fg') || cell.style.getPropertyValue('--gt-bg'),
      ),
      'Unload left custom styles',
    );
    assert(view.editor.getValue() === source, 'Unload rewrote source');
    results.push(
      'disabling restores native tables and removes colors, overlays and classes without changing source',
    );
    await app.plugins.enablePlugin('good-tables');
    let current = app.plugins.plugins['good-tables'];
    for (let i = 0; i < 20 && !binding(current); i++) await wait();
    assert(binding(current), 'Reloaded controller missing');
    assert(
      view.containerEl.querySelector('.gt-display') &&
        view.containerEl.querySelector('.gt-diagonal-overlay') &&
        view.containerEl.querySelector('.gt-merge-overlay'),
      'Re-enable did not restore decorations',
    );
    results.push('re-enabling restores formats, colors, merges and inline diagonal fields');
    assert(view.editor.getValue() === source, 'Re-enable rewrote source');
    current.settings = saved;
    await current.saveSettings();
    assert(JSON.stringify(current.settings) === JSON.stringify(saved), 'Settings not restored');
    results.push('source and user settings survive a complete disable/enable cycle');
    return JSON.stringify({ pass: results.length, results });
  } catch (error) {
    return JSON.stringify({
      pass: results.length,
      results,
      error: error.message,
      stack: error.stack,
    });
  } finally {
    if (!app.plugins.plugins['good-tables']) await app.plugins.enablePlugin('good-tables');
    const current = app.plugins.plugins['good-tables'];
    if (current) {
      current.settings = saved;
      await current.saveSettings();
    }
  }
})();
