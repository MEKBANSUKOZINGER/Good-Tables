// Official Obsidian CLI QA; only edits the generated QA note and restores settings.
(async () => {
  const p = app.plugins.plugins['good-tables'],
    view = app.workspace.activeLeaf.view;
  if (view.file?.path !== 'qa-vault/Good Tables QA.md') throw Error('Open generated QA note first');
  const saved = structuredClone(p.settings),
    document = view.containerEl.ownerDocument,
    window = document.defaultView;
  const wait = () => new Promise((resolve) => window.setTimeout(resolve, 250));
  const assert = (ok, message) => {
    if (!ok) throw Error(message);
  };
  const binding = () =>
    [...p.controllers].flatMap((c) => c.bindings).find((b) => b.editor === view.editor);
  const name = (item) => item.dom?.querySelector('.menu-item-title')?.textContent;
  const own = (menu) => menu.items.filter((item) => item.section === 'good-tables').map(name);
  const menu = async (rect, axis = 'cell') => {
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const b = binding(),
      original = p.menu;
    let captured;
    b.controller.select(b, rect, axis);
    p.menu = function (root, editor, context) {
      captured = root;
      return original.call(this, root, editor, context);
    };
    try {
      const cell = b.element.rows[rect.r0].cells[rect.c0];
      (cell.querySelector('.cm-content') ?? cell).dispatchEvent(
        new window.PointerEvent('contextmenu', {
          view: window,
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: 500,
          clientY: 300,
        }),
      );
      await wait();
      assert(captured, 'Native menu not captured');
      return captured;
    } finally {
      p.menu = original;
    }
  };
  const one = { r0: 1, r1: 1, c0: 0, c1: 0 },
    pair = { r0: 1, r1: 2, c0: 0, c1: 0 },
    first = { r0: 0, r1: 0, c0: 0, c1: 0 };
  const results = [];
  try {
    p.settings.warned = true;
    p.settings.formatTitles = false;
    p.settings.presets = [{ id: crypto.randomUUID(), name: 'QA units', prefix: '', suffix: ' kg' }];
    p.settings.formatOrder = ['custom', 'rating'];
    await p.saveSettings();
    view.editor.setValue(
      '# Good Tables QA\n\n| Item | Value |\n| --- | --- |\n| A | 1.64 |\n| B | 3 |\n\nOutside.\n',
    );
    view.editor.setCursor(0, 0);
    await wait();
    let root = await menu(one),
      names = own(root);
    for (const key of ['diagonal', 'merge', 'unmerge', 'title', 'structure', 'size'])
      assert(!names.includes(p.t(key)), 'Inapplicable item visible: ' + key);
    assert(
      !binding().element.querySelector('.gt-resize-row,.gt-resize-column'),
      'Extra resize handles remain',
    );
    const formats = root.items
      .find((item) => name(item) === p.t('format'))
      .submenu.items.filter((i) => i.section === 'good-tables')
      .map(name);
    assert(
      formats.at(-1) === p.t('custom') && formats.includes('QA units'),
      'Custom is not pinned below saved formats',
    );
    results.push('single-cell menu hides invalid actions and removed controls; Custom stays last');
    root.hide();
    root = await menu(first);
    assert(own(root).includes(p.t('diagonal')), 'First-cell diagonal missing');
    root.hide();
    root = await menu(pair);
    assert(
      own(root).includes(p.t('merge')) && !own(root).includes(p.t('diagonal')),
      'Range merge/diagonal visibility wrong',
    );
    root.hide();
    results.push('diagonal appears only on the first cell and merge only on eligible ranges');
    p.apply(binding(), (_, m) => {
      m.merges = [{ ...pair }];
    });
    await wait();
    root = await menu(pair);
    names = own(root);
    assert(
      names.includes(p.t('unmerge')) &&
        !names.includes(p.t('merge')) &&
        !names.includes(p.t('paste')),
      'Merged selection has invalid commands',
    );
    root.hide();
    results.push('merged selection offers unmerge while hiding merge and unsupported paste');
    p.apply(binding(), (_, m) => {
      m.merges = [];
      m.headerRows = [0];
    });
    await wait();
    root = await menu({ r0: 0, r1: 0, c0: 0, c1: 1 }, 'row');
    names = own(root);
    assert(
      names.includes(p.t('clearTitle')) &&
        names.includes(p.t('background')) &&
        names.includes(p.t('color')) &&
        !names.includes(p.t('format')),
      'Title-only menu exposes unsupported commands',
    );
    root.hide();
    root = await menu({ r0: 0, r1: 1, c0: 0, c1: 0 });
    assert(!own(root).includes(p.t('merge')), 'Title-crossing merge visible');
    root.hide();
    results.push('title colors remain available and title-crossing merges remain hidden');
    p.apply(binding(), (_, m) => {
      m.cells[1][0].format = { kind: 'rating', group: 'qa', scope: 'cell' };
    });
    await wait();
    root = await menu(pair);
    assert(
      root.items
        .find((item) => name(item) === p.t('format'))
        ?.submenu.items.some((item) => item.section === 'good-tables'),
      'Partially formatted range should offer replacement formats',
    );
    root.hide();
    results.push('partially formatted ranges offer all eligible replacement formats');
    p.apply(binding(), (_, m) => {
      delete m.cells[1][0].format;
      m.cells[1][0].background = '#e5607a';
      m.cells[1][0].color = '#004d1a';
    });
    await wait();
    binding().element.closest('.cm-table-widget').cmTile.widget.setCellFocus(1, 0);
    await wait();
    const cell = binding().element.rows[1].cells[0],
      content = cell.querySelector('.cm-content');
    assert(content, 'Native focused editor missing');
    const style = window.getComputedStyle(content);
    assert(
      style.backgroundColor === 'rgb(229, 96, 122)' && style.color === 'rgb(0, 77, 26)',
      'Native editing lost color: ' +
        JSON.stringify({
          bg: style.backgroundColor,
          color: style.color,
          cellClass: cell.className,
          connected: content.isConnected,
          source: binding().source.slice(0, 120),
          style: cell.getAttribute('style'),
        }),
    );
    results.push('focused native editor retains the background and text colors');
    root = await menu(one);
    root.items.find((item) => name(item) === p.t('background')).dom.click();
    await wait();
    let modal = document.querySelector('.gt-modal'),
      previews = modal.querySelectorAll('.gt-color-preview-swatch');
    assert(
      previews.length === 2 && previews[0].style.backgroundColor === 'rgb(229, 96, 122)',
      'Current color preview missing',
    );
    const hex = modal.querySelector('.gt-hex input');
    hex.value = '#123456';
    hex.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert(
      previews[1].style.backgroundColor === 'rgb(18, 52, 86)' &&
        modal.querySelector('.gt-color-preview-card:last-child').textContent.includes('#123456'),
      'Selected color preview out of sync',
    );
    modal.querySelector('.mod-cta').click();
    await wait();
    results.push('color dialog compares current and selected colors with live HEX synchronization');
    root = await menu(pair);
    root.items.find((item) => name(item) === p.t('background')).dom.click();
    await wait();
    modal = document.querySelector('.gt-modal');
    assert(
      modal.querySelector('.gt-color-preview-card').textContent.includes(p.t('mixedColors')),
      'Mixed selection incorrectly claims a single current color',
    );
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    results.push('mixed-color selections show an explicit multiple-colors preview state');
    return JSON.stringify({ pass: results.length, results });
  } catch (error) {
    return JSON.stringify({
      pass: results.length,
      results,
      error: error.message,
      stack: error.stack,
    });
  } finally {
    p.settings = saved;
    await p.saveSettings();
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }
})();
