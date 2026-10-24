// Official CLI QA: changes only the generated note and restores plugin settings.
(async () => {
  const p = app.plugins.plugins['good-tables'],
    view = app.workspace.activeLeaf.view;
  if (view.file?.path !== 'qa-vault/Good Tables QA.md') throw Error('Open generated QA note first');
  const saved = structuredClone(p.settings),
    doc = view.containerEl.ownerDocument,
    win = doc.defaultView,
    results = [];
  const wait = () => new Promise((resolve) => win.setTimeout(resolve, 220));
  const assert = (ok, message) => {
    if (!ok) throw Error(message);
  };
  const get = () =>
    [...p.controllers].flatMap((c) => c.bindings).find((b) => b.editor === view.editor);
  const rgb = 'rgb(18, 52, 86)',
    name = (i) => i.titleEl?.textContent;
  const one = { r0: 1, r1: 1, c0: 0, c1: 0 },
    pair = { ...one, c1: 1 };
  const open = async (rect) => {
    doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const b = get(),
      original = p.menu;
    let root;
    b.controller.select(b, rect, 'cell');
    p.menu = function (menu, editor, context) {
      root = menu;
      return original.call(this, menu, editor, context);
    };
    try {
      const cell = b.element.rows[rect.r0].cells[rect.c0];
      (cell.querySelector('.cm-content') ?? cell).dispatchEvent(
        new win.PointerEvent('contextmenu', {
          view: win,
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: 480,
          clientY: 300,
        }),
      );
      await wait();
      assert(root, 'Missing native menu');
      return root;
    } finally {
      p.menu = original;
    }
  };
  const originalMenus = async (rect, expected) => {
    const root = await open(rect),
      own = root.items.filter((i) => i.section === 'good-tables').map(name);
    assert(
      own.includes(p.t('copy')) === expected,
      'Original copy visibility: ' + JSON.stringify(own),
    );
    assert(
      own.includes(p.t('edit')) === (expected && rect.c0 === rect.c1 && rect.r0 === rect.r1),
      'Original edit visibility',
    );
    assert(
      root.items.some(
        (i) => i.section !== 'good-tables' && name(i) === p.t('copy').replace(p.t('copy'), '복사'),
      ),
      'Native copy missing',
    );
    root.hide();
  };
  try {
    p.settings.warned = true;
    await p.saveSettings();
    view.editor.setValue(
      '# Good Tables QA\n\n| **Header** | Header | Header |\n| --- | --- | --- |\n| **4** | **4** | ==**4**== |\n| **Merged** | Hidden | More |\n\nOutside **bold**.\n',
    );
    view.editor.setCursor(0, 0);
    await wait();
    await originalMenus(one, false);
    await originalMenus(pair, false);
    results.push('plain cells and ranges omit original-value commands while native copy remains');
    const baseline = win.getComputedStyle(
      get().element.rows[1].cells[1].querySelector('strong'),
    ).color;
    p.apply(get(), (_, m) => {
      m.cells[1][0].format = { kind: 'rating', group: crypto.randomUUID(), scope: 'cell' };
      m.cells[1][0].color = '#123456';
      m.cells[1][2].color = '#123456';
      m.headerRows = [0];
      m.cells[0][0].titleColor = '#123456';
    });
    await wait();
    assert(
      win.getComputedStyle(get().element.rows[1].cells[0].querySelector('.gt-display strong'))
        .color === rgb,
      'Theme overrides formatted bold',
    );
    assert(
      win.getComputedStyle(get().element.rows[1].cells[1].querySelector('strong')).color ===
        baseline,
      'Uncolored theme bold changed',
    );
    results.push('formatted bold uses explicit color; uncolored sibling retains theme color');
    assert(
      win.getComputedStyle(get().element.rows[1].cells[2].querySelector('mark strong')).color ===
        rgb,
      'Theme overrides highlighted bold',
    );
    assert(
      win.getComputedStyle(get().element.rows[0].cells[0].querySelector('strong')).color === rgb,
      'Theme overrides title bold',
    );
    results.push('native highlighted bold and title bold use Good Tables foreground');
    await originalMenus(one, true);
    results.push('decorated cells retain original-value commands');
    for (const c of [0, 2]) {
      get().element.closest('.cm-table-widget').cmTile.widget.setCellFocus(1, c);
      await wait();
      const text = get().element.rows[1].cells[c].querySelector('.cm-strong:not(.cm-formatting)');
      assert(text, 'Native bold editor missing');
      assert(
        win.getComputedStyle(text).color === rgb,
        'Theme overrides focused native editor: ' + win.getComputedStyle(text).color,
      );
    }
    results.push('focused native bold and highlighted-bold editors use Good Tables color');
    p.apply(get(), (_, m) => {
      delete m.cells[1][0].color;
    });
    await wait();
    assert(
      win.getComputedStyle(get().element.rows[1].cells[0].querySelector('.gt-display strong'))
        .color === baseline,
      'Clearing color did not restore theme',
    );
    results.push('clearing a custom foreground restores the theme color');
    p.apply(get(), (_, m) => {
      m.cells[1][0].color = '#123456';
      m.cells[2][0].color = '#123456';
      m.merges = [{ r0: 2, r1: 2, c0: 0, c1: 1 }];
    });
    await wait();
    let overlay = get().element.parentElement.querySelector('.gt-merge-overlay');
    assert(
      win.getComputedStyle(overlay.querySelector('strong')).color === rgb,
      'Merged Markdown color lost',
    );
    p.apply(get(), (_, m) => {
      delete m.cells[2][0].color;
    });
    await wait();
    overlay = get().element.parentElement.querySelector('.gt-merge-overlay');
    assert(
      win.getComputedStyle(overlay.querySelector('strong')).color === baseline,
      'Merged color reset did not restore theme',
    );
    results.push('merged Markdown obeys explicit foreground and restores theme after reset');
    const source = view.editor.getValue();
    await app.vault.modify(view.file, source);
    await view.leaf.setViewState({
      type: 'markdown',
      state: { file: view.file.path, mode: 'preview' },
    });
    await wait();
    const root = view.leaf.view.contentEl,
      table = root.querySelector('table.gt-table');
    assert(table, 'Reading table missing');
    assert(
      win.getComputedStyle(table.rows[1].cells[0].querySelector('.gt-display strong')).color ===
        rgb,
      'Reading formatted bold color lost',
    );
    assert(
      win.getComputedStyle(table.rows[1].cells[2].querySelector('mark strong')).color === rgb,
      'Reading highlighted color lost',
    );
    assert(
      win.getComputedStyle(table.rows[1].cells[1].querySelector('strong')).color === baseline,
      'Reading uncolored theme changed',
    );
    results.push('reading view preserves explicit colors and untouched theme styles');
    return JSON.stringify({ pass: results.length, results, themeColor: baseline });
  } catch (error) {
    return JSON.stringify({
      pass: results.length,
      results,
      error: error.message,
      stack: error.stack,
    });
  } finally {
    doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    if (view.leaf.view.getMode() === 'preview')
      await view.leaf.setViewState({
        type: 'markdown',
        state: { file: 'qa-vault/Good Tables QA.md', mode: 'source' },
      });
    p.settings = saved;
    await p.saveSettings();
  }
})();
