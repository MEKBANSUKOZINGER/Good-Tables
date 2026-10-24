// Run with the official CLI. Only the generated QA note and temporary settings are changed.
(async () => {
  const p = app.plugins.plugins['good-tables'],
    view = app.workspace.activeLeaf.view;
  if (view.file?.path !== 'qa-vault/Good Tables QA.md') throw Error('Open generated QA note first');
  const saved = structuredClone(p.settings),
    doc = view.containerEl.ownerDocument,
    win = doc.defaultView;
  const wait = (ms = 180) => new Promise((resolve) => win.setTimeout(resolve, ms));
  const assert = (ok, message) => {
    if (!ok) throw Error(message);
  };
  const results = (globalThis.gt023Results = []);
  const binding = () =>
    [...p.controllers].flatMap((c) => c.bindings).find((b) => b.editor === view.editor);
  const meta = () => binding().table.metadata;
  const name = (item) =>
    item.titleEl?.textContent ?? item.dom?.querySelector('.menu-item-title')?.textContent;
  const escape = () =>
    doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  const rect = { r0: 1, r1: 1, c0: 0, c1: 0 };
  const fixture = async (raw) => {
    escape();
    view.editor.setValue(
      '# Good Tables QA\n\n| Value | Other |\n| --- | --- |\n| ' +
        raw +
        ' | 3 |\n| 2 | 4 |\n\nOutside.\n',
    );
    view.editor.setCursor(0, 0);
    await wait();
  };
  const open = async (range = true, a = rect) => {
    escape();
    const b = binding(),
      w = b.element.closest('.cm-table-widget').cmTile.widget;
    w.deselectCells();
    if (range) w.selectCells(w.rows[a.r0][a.c0], w.rows[a.r1][a.c1]);
    else {
      w.setCellFocus(a.r0, a.c0);
      const cm = w.editor.tableCell.editor.cm;
      cm.dispatch({ selection: { anchor: 0, head: cm.state.doc.length } });
      cm.focus();
    }
    await wait(50);
    const current = binding();
    current.controller.select(current, a, 'cell');
    let root;
    const original = p.menu;
    p.menu = function (menu, editor, context) {
      root = menu;
      return original.call(this, menu, editor, context);
    };
    try {
      const cell = current.element.rows[a.r0].cells[a.c0];
      (cell.querySelector('.cm-content') ?? cell).dispatchEvent(
        new win.PointerEvent('contextmenu', {
          view: win,
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: 450,
          clientY: 270,
        }),
      );
      await wait();
      assert(root, 'Missing native menu');
      const owner = root.items.find(
        (i) => i.submenu && (i.section === 'selection' || i.section === 'selection.format'),
      );
      assert(owner, 'Native Format missing');
      root.selectElement(owner.dom, true);
      await wait(35);
      return { root, sub: owner.submenu };
    } finally {
      p.menu = original;
    }
  };
  const choose = async (label) => {
    const { sub } = await open(false);
    const item = sub.items.find((i) => name(i) === label);
    assert(item, 'Missing choice: ' + label);
    item.dom.click();
    await wait();
  };
  try {
    p.settings.warned = true;
    p.settings.language = 'ko';
    p.settings.ratingMax = 100;
    await p.saveSettings();
    await fixture('10');
    for (const range of [true, false]) {
      const { root, sub } = await open(range),
        items = sub.items.filter((i) => i.titleEl),
        labels = items.map(name);
      const first = items.findIndex((i) => i.section === 'good-tables'),
        last = items.findLastIndex((i) => i.section === 'good-tables');
      assert(
        first > 0 && labels[first - 1] === '주석' && labels[last + 1] === '서식 지우기',
        'Wrong group order: ' + JSON.stringify(labels),
      );
      const domLabels = [...sub.dom.querySelectorAll('.menu-item-title')].map(
        (el) => el.textContent,
      );
      assert(
        JSON.stringify(labels) === JSON.stringify(domLabels),
        'Rendered menu order differs: ' + JSON.stringify(domLabels),
      );
      assert(
        !root.items.some((i) => i.section === 'good-tables' && i.submenu),
        'Duplicate root Format',
      );
      root.hide();
    }
    results.push(
      'native Format contains table formats after Code/Math/Comment and before Clear, in single/range menus',
    );
    for (const [label, marker] of [
      ['볼드체', '**'],
      ['기울이기', '*'],
      ['취소선', '~~'],
    ]) {
      await fixture('10');
      await choose(p.t('rating'));
      await choose(label);
      assert(
        meta().cells[1][0].format?.kind === 'rating',
        'Native emphasis removed rating: ' + label,
      );
      const raw = meta().snapshot[1][0];
      assert(raw.includes(marker), 'Native emphasis was not applied: ' + raw);
      const cell = binding().element.rows[1].cells[0],
        display = cell.querySelector('.gt-display');
      assert(
        display?.textContent === '★★★★★★★★★★',
        'Rating failed after ' + label + ': ' + display?.textContent,
      );
      const tag = label === '볼드체' ? 'strong' : label === '기울이기' ? 'em' : 's';
      assert(display.querySelector(tag), 'Presentation missing: ' + tag);
      results.push(label + ' coexists with rating and preserves raw Markdown');
    }
    for (const [index, color] of [
      undefined,
      'red',
      'orange',
      'yellow',
      'green',
      'blue',
      'purple',
    ].entries()) {
      await fixture('10');
      await choose(p.t('rating'));
      const { sub } = await open(false),
        highlight = sub.items.find((i) => name(i) === '하이라이트');
      if (highlight.submenu) {
        sub.selectElement(highlight.dom, true);
        await wait(35);
        highlight.submenu.items.filter((i) => i.titleEl)[index].dom.click();
      } else {
        assert(index === 0, 'Native color submenu missing');
        highlight.dom.click();
      }
      await wait();
      const display = binding().element.rows[1].cells[0].querySelector('.gt-display'),
        mark = display?.querySelector('mark');
      assert(
        display?.textContent === '★★★★★★★★★★' && mark,
        'Highlight changed numeric output: ' + meta().snapshot[1][0],
      );
      assert(
        mark.getAttribute('data-highlight') === (color ?? null),
        'Highlight color lost: ' + color,
      );
    }
    results.push('default and all six native highlight colors coexist with table formatting');
    for (const [label, wrapper] of [
      ['코드', '`'],
      ['수식', '$'],
      ['주석', '%%'],
    ]) {
      await fixture('3');
      await choose(p.t('rating'));
      const before = view.editor.getValue();
      await choose(label);
      const formatted = view.editor.getValue();
      assert(!meta().cells[1][0].format, 'Exclusive native format kept table format: ' + label);
      assert(meta().snapshot[1][0].includes(wrapper), 'Native wrapper missing: ' + label);
      const historyEditor =
        binding().element.closest('.cm-table-widget').cmTile.widget.editor.tableCell?.editor ??
        view.editor;
      historyEditor.undo();
      await wait();
      assert(
        meta().cells[1][0].format?.kind === 'rating' && meta().snapshot[1][0] === '3',
        'Undo did not restore both: ' + label,
      );
      historyEditor.redo();
      await wait();
      assert(
        !meta().cells[1][0].format && meta().snapshot[1][0].includes(wrapper),
        'Redo failed: ' + label,
      );
      results.push(label + ' removes table format atomically; undo/redo restore both states');
      if (view.editor.getValue() !== formatted)
        globalThis.gt023RedoDifference = { before, formatted, after: view.editor.getValue() };
    }
    await fixture('10');
    await choose(p.t('rating'));
    for (const range of [true, false]) {
      const { root, sub } = await open(range),
        own = sub.items.filter((i) => i.section === 'good-tables');
      assert(
        own.some((i) => name(i) === p.t('percent')) && own.some((i) => name(i) === p.t('bar')),
        'Replacement choices hidden',
      );
      assert(
        own.find((i) => name(i) === p.t('rating')).dom.classList.contains('mod-checked'),
        'Active format not checked: ' + own.find((i) => name(i) === p.t('rating')).dom.outerHTML,
      );
      root.hide();
    }
    await choose(p.t('percent'));
    assert(meta().cells[1][0].format.kind === 'percent', 'Replacement failed');
    await choose(p.t('percent'));
    assert(!meta().cells[1][0].format, 'Toggle off failed');
    results.push(
      'applied format stays checked, all applicable replacements remain visible, same choice toggles off',
    );
    await fixture('==***10***==');
    await choose(p.t('rating'));
    escape();
    view.editor.setCursor(0, 0);
    const outsideInput = doc.createElement('input');
    doc.body.append(outsideInput);
    outsideInput.focus();
    await wait();
    const cell = binding().element.rows[1].cells[0],
      display = cell.querySelector('.gt-display'),
      text = doc.createRange();
    text.selectNodeContents(display);
    const content = text.getBoundingClientRect(),
      box = cell.getBoundingClientRect();
    assert(
      content.right <= box.right && content.width > 0,
      'Stars overflow: ' + JSON.stringify({ content: content.toJSON(), box: box.toJSON() }),
    );
    const min = cell.style.minWidth;
    outsideInput.remove();
    binding().element.closest('.cm-table-widget').cmTile.widget.setCellFocus(1, 0);
    await wait();
    assert(binding().element.rows[1].cells[0].style.minWidth === min, 'Editing lost star width');
    results.push(
      'ten bold/italic/highlighted stars fit within the cell border and retain width during editing',
    );

    await fixture('3');
    p.apply(binding(), (_, m) => {
      m.headerRows = [0];
      m.cells[0][0].background = '#010203';
    });
    await wait();
    const color = async (key, value, a = rect) => {
      const { root } = await open(false, a);
      const item = root.items.find((i) => name(i) === p.t(key));
      assert(item, 'Missing color action: ' + key);
      item.dom.click();
      await wait();
      const modal = doc.querySelector('.gt-modal'),
        hex = modal.querySelector('.gt-hex input');
      hex.value = value;
      hex.dispatchEvent(new win.Event('input', { bubbles: true }));
      modal.querySelector('.mod-cta').click();
      await wait();
    };
    const corner = { r0: 0, r1: 0, c0: 0, c1: 0 };
    await color('background', '#abcdef', corner);
    await color('color', '#123456', corner);
    assert(
      meta().cells[0][0].titleBackground === '#abcdef' &&
        meta().cells[0][0].titleColor === '#123456',
      'Title colors not saved',
    );
    assert(meta().cells[0][0].background === '#010203', 'Underlying color lost');
    results.push(
      'title cells expose color pickers, save individual colors, and preserve ordinary colors',
    );
    p.settings.barColor = '#aabbcc';
    await p.saveSettings();
    await choose(p.t('bar'));
    await color('barColor', '#ee5500');
    escape();
    const bar = binding().element.rows[1].cells[0].querySelector('.gt-bar');
    assert(
      meta().cells[1][0].barColor === '#ee5500' &&
        bar.style.getPropertyValue('--gt-bar-color') === '#ee5500',
      'Individual bar color not applied',
    );
    assert(
      /25%|0\.25/.test(win.getComputedStyle(bar).backgroundImage),
      'Bar opacity changed: ' + win.getComputedStyle(bar).backgroundImage,
    );
    view.editor.undo();
    await wait();
    assert(!meta().cells[1][0].barColor, 'Bar color undo failed');
    assert(
      binding()
        .element.rows[1].cells[0].querySelector('.gt-bar')
        .style.getPropertyValue('--gt-bar-color') === '#aabbcc',
      'Global bar color fallback failed',
    );
    results.push(
      'bar colors use global defaults or cell overrides and always retain 25% opacity; color edits undo',
    );
    return JSON.stringify({ pass: results.length, results });
  } catch (error) {
    return JSON.stringify({
      pass: results.length,
      results,
      error: error.message,
      stack: error.stack,
      source: view.editor.getValue().slice(0, 600),
    });
  } finally {
    escape();
    p.settings = saved;
    await p.saveSettings();
  }
})();
