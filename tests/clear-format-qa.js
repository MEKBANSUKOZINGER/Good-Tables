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
  const results = (globalThis.gtClearResults = []);
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
  const properties = ['format', 'background', 'color', 'titleBackground', 'titleColor', 'barColor'];
  const clean = (cell) => properties.every((key) => cell[key] === undefined);
  const decorate = async (kind = 'rating') => {
    p.apply({ ...binding(), rect }, (_, m) => {
      Object.assign(m.cells[1][0], {
        format: {
          kind,
          group: crypto.randomUUID(),
          scope: 'cell',
          ...(kind === 'custom' ? { prefix: '$', suffix: ' USD' } : {}),
        },
        color: '#abcdef',
        background: '#123456',
        titleColor: '#445566',
        titleBackground: '#778899',
        barColor: '#fedcba',
      });
      m.cells[1][1].format = { kind: 'percent', group: crypto.randomUUID(), scope: 'cell' };
      m.cells[1][1].color = '#aabbcc';
    });
    await wait();
  };
  const clear = async (range = true, a = rect) => {
    const { sub } = await open(range, a),
      item = sub.items.find((i) => /^selection(?:\.format)?\.danger$/.test(i.section ?? ''));
    assert(
      item && !item.disabled,
      'Native Clear formatting missing/disabled: ' +
        JSON.stringify({
          items: sub.items.map((i) => ({
            name: name(i),
            section: i.section,
            disabled: i.disabled,
          })),
          rect: binding().rect,
          cells: meta()?.cells,
          callback: String(item?.callback),
        }),
    );
    item.dom.click();
    await wait();
  };
  try {
    p.settings.warned = true;
    p.settings.language = 'ko';
    await p.saveSettings();
    await fixture('**4**');
    await decorate();
    const before = structuredClone(meta());
    await clear(false);
    assert(
      clean(meta().cells[1][0]) && meta().snapshot[1][0] === '4',
      'Focused native clear kept formats or Markdown emphasis',
    );
    assert(
      JSON.stringify(meta().cells[1][1]) === JSON.stringify(before.cells[1][1]),
      'Unselected cell changed',
    );
    results.push(
      'focused-cell Clear formatting removes native emphasis, all value formats and individual colors only in the selected cell',
    );
    const historyEditor =
      binding().element.closest('.cm-table-widget').cmTile.widget.editor.tableCell?.editor ??
      view.editor;
    historyEditor.undo();
    await wait();
    assert(
      meta().cells[1][0].format?.kind === 'rating' &&
        meta().cells[1][0].color === '#abcdef' &&
        meta().snapshot[1][0] === '**4**',
      'Focused undo failed',
    );
    historyEditor.redo();
    await wait();
    assert(clean(meta().cells[1][0]) && meta().snapshot[1][0] === '4', 'Focused redo failed');
    results.push(
      'native cell undo and redo restore and clear Markdown plus Good Tables formats and colors together',
    );
    for (const [kind, raw] of [
      ['percent', '4'],
      ['calc', '4'],
      ['bar', '4'],
      ['date', '20261024'],
      ['datetime', '202610241430'],
      ['time', '1430'],
      ['rating', '4.5'],
      ['custom', '12'],
    ]) {
      await fixture(raw);
      await decorate(kind);
      const baseline = structuredClone(meta()),
        source = view.editor.getValue();
      await clear(true);
      assert(clean(meta().cells[1][0]), 'Plain-value clear failed: ' + kind);
      assert(meta().snapshot[1][0] === raw, 'Raw value changed: ' + kind);
      assert(
        JSON.stringify(meta().cells[1][1]) === JSON.stringify(baseline.cells[1][1]),
        'Neighbor changed: ' + kind,
      );
      view.editor.undo();
      await wait();
      assert(
        meta().cells[1][0].format?.kind === kind && meta().cells[1][0].color === '#abcdef',
        'Document undo failed: ' + kind,
      );
      view.editor.redo();
      await wait();
      assert(clean(meta().cells[1][0]), 'Document redo failed: ' + kind);
      results.push(kind + ' clears without native text changes and supports document undo/redo');
    }
    await fixture('4');
    await decorate();
    await clear(false);
    assert(clean(meta().cells[1][0]), 'Focused plain-value clear failed');
    // An unchanged native cell has no inner text-history entry. Its unhandled
    // shortcut bubbles to the document editor, as in an actual user gesture.
    doc.activeElement.dispatchEvent(
      new win.KeyboardEvent('keydown', {
        key: 'z',
        code: 'KeyZ',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await wait();
    assert(meta()?.cells[1][0].format?.kind === 'rating', 'Focused plain-value undo failed');
    doc.activeElement.dispatchEvent(
      new win.KeyboardEvent('keydown', {
        key: 'y',
        code: 'KeyY',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await wait();
    assert(clean(meta().cells[1][0]), 'Focused plain-value redo failed');
    results.push(
      'focused display-only formatting supports native undo/redo even when there are no Markdown markers',
    );
    await fixture('4');
    await decorate();
    const a = { r0: 1, r1: 2, c0: 0, c1: 1 };
    p.apply({ ...binding(), rect: a }, (_, m) => {
      m.merges = [{ r0: 1, r1: 2, c0: 1, c1: 1 }];
      m.headerRows = [0];
      m.diagonal = { lower: 'Value', upper: 'View' };
      m.widths[0] = 140;
      m.heights[1] = 38;
      m.cells[2][0].color = '#ff0000';
      m.cells[0][0].color = '#00ff00';
    });
    await wait();
    const structural = structuredClone(meta());
    await clear(true, a);
    assert(
      a.r0 === 1 &&
        meta()
          .cells.slice(1)
          .every((row) => row.every(clean)),
      'Range clear left properties',
    );
    for (const key of ['merges', 'headerRows', 'headerCols', 'diagonal', 'widths', 'heights'])
      assert(
        JSON.stringify(meta()[key]) === JSON.stringify(structural[key]),
        'Structure changed: ' + key,
      );
    assert(meta().cells[0][0].color === '#00ff00', 'Unselected header color changed');
    results.push(
      'rectangular range clear preserves merge, diagonal, titles and dimensions while leaving unselected header styles intact',
    );
    await clear(true, { r0: 0, r1: 0, c0: 0, c1: 0 });
    assert(
      clean(meta().cells[0][0]) && meta().headerRows.includes(0) && meta().diagonal,
      'Title/diagonal colors did not clear independently of structure',
    );
    results.push(
      'title and diagonal cell colors can clear even when value-format options are unavailable',
    );
    assert(view.editor.getValue().includes('Outside.'), 'Outside text changed');
    return JSON.stringify({ pass: results.length, results });
  } catch (error) {
    return JSON.stringify({
      pass: results.length,
      results,
      error: error.message,
      stack: error.stack,
    });
  } finally {
    escape();
    p.settings = saved;
    await p.saveSettings();
  }
})();
