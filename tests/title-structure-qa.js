// Only the generated QA note and temporary settings are changed.
(async () => {
  const path = 'qa-vault/Good Tables QA.md',
    p = app.plugins.plugins['good-tables'],
    saved = structuredClone(p.settings),
    leaf = app.workspace.getLeavesOfType('markdown').find((l) => l.view.file?.path === path);
  if (!leaf) throw Error('Open generated QA note');
  await leaf.setViewState({
    type: 'markdown',
    state: { file: path, mode: 'source', source: false },
  });
  app.workspace.setActiveLeaf(leaf, { focus: true });
  const view = leaf.view,
    doc = view.containerEl.ownerDocument,
    win = doc.defaultView,
    wait = (ms = 180) => new Promise((r) => win.setTimeout(r, ms)),
    results = [];
  const assert = (ok, msg) => {
      if (!ok) throw Error(msg);
    },
    binding = () =>
      [...p.controllers].flatMap((c) => c.bindings).find((b) => b.editor === view.editor),
    meta = () => binding().table.metadata,
    widget = () => binding().element.closest('.cm-table-widget').cmTile.widget;
  const fixture = async (rows) => {
    view.editor.setValue(
      '# Good Tables QA\n\n' +
        rows
          .map(
            (row, r) =>
              '| ' +
              row.join(' | ') +
              ' |' +
              (r === 0 ? '\n| ' + row.map(() => '---').join(' | ') + ' |' : ''),
          )
          .join('\n') +
        '\n\nOutside.\n',
    );
    view.editor.setCursor(0, 0);
    view.editor.focus();
    await wait();
    assert(binding(), 'Missing table');
  };
  const blank = () => Array.from({ length: 3 }, () => ['', '', '']);
  const styleTitles = async () => {
    p.apply(binding(), (_, m) => {
      m.headerRows = [0, 2];
      m.headerCols = [0, 2];
      m.cells[1][1].color = '#abcdef';
      m.widths[2] = 130;
      m.heights[2] = 42;
    });
    await wait();
    return structuredClone(meta());
  };
  const check = () => {
    const m = meta();
    assert(
      m && m.snapshot.length === binding().element.rows.length,
      'Stale geometry after native insertion',
    );
    const count = m.cells.reduce(
      (n, row, r) =>
        n + row.filter((_, c) => m.headerRows.includes(r) || m.headerCols.includes(c)).length,
      0,
    );
    assert(
      binding().element.querySelectorAll('.gt-title').length === count,
      'Rendered title cells do not match saved title assignments',
    );
  };
  const weight = (el) => Number(win.getComputedStyle(el).fontWeight),
    first = () => binding().element.rows[0].cells[0];
  try {
    p.settings.warned = true;
    await p.saveSettings();
    // Actual creation dialog, then immediate native insertion.
    view.editor.setValue('# Good Tables QA\n\n');
    view.editor.setCursor(2, 0);
    p.create(view.editor);
    await wait();
    const modal = doc.querySelector('.gt-modal'),
      nums = modal.querySelectorAll('input[type=number]');
    nums[0].value = '3';
    nums[1].value = '3';
    modal.querySelector('.mod-cta').click();
    await wait();
    assert(!meta().headerRows.length && !meta().headerCols.length, 'Creation assigned titles');
    p.apply(binding(), (_, m) => {
      m.headerRows = [0];
      m.headerCols = [1];
    });
    await wait();
    widget().insertRow(3, 0);
    await wait();
    check();
    assert(meta().headerRows[0] === 0 && meta().headerCols[0] === 1, 'Created-table titles lost');
    results.push(
      'creation dialog followed by title assignment and native blank-row append retains title presentation',
    );
    for (const axis of ['row', 'column'])
      for (const index of [0, 1, 3]) {
        await fixture(blank());
        const before = await styleTitles();
        if (axis === 'row') widget().insertRow(index, 0);
        else widget().insertColumn(0, index, '---');
        await wait();
        check();
        const m = meta(),
          rs = (r) => (axis === 'row' && r >= index ? r + 1 : r),
          cs = (c) => (axis === 'column' && c >= index ? c + 1 : c);
        assert(
          JSON.stringify(m.headerRows) === JSON.stringify(before.headerRows.map(rs)),
          'Title rows changed: ' + axis + index,
        );
        assert(
          JSON.stringify(m.headerCols) === JSON.stringify(before.headerCols.map(cs)),
          'Title columns changed: ' + axis + index,
        );
        for (let r = 0; r < 3; r++)
          for (let c = 0; c < 3; c++)
            assert(
              m.cells[rs(r)][cs(c)].id === before.cells[r][c].id,
              'Duplicate blank cell identity changed',
            );
        assert(
          m.cells[rs(1)][cs(1)].color === '#abcdef' &&
            m.widths[cs(2)] === 130 &&
            m.heights[rs(2)] === 42,
          'Color/dimensions changed',
        );
        results.push(
          'native ' +
            axis +
            ' insertion at ' +
            index +
            ' preserves blank-cell identities, multiple title assignments, colors and dimensions',
        );
      }
    await fixture(blank());
    await styleTitles();
    await wait(600);
    const before = structuredClone(meta());
    widget().insertRow(1, 0);
    await wait(600);
    const rowAdded = structuredClone(meta());
    widget().insertColumn(1, 1, '---');
    await wait();
    check();
    const bothAdded = structuredClone(meta());
    view.editor.undo();
    await wait();
    assert(
      JSON.stringify(meta()) === JSON.stringify(rowAdded),
      'Undo column insertion did not restore exact metadata',
    );
    view.editor.undo();
    await wait();
    assert(JSON.stringify(meta()) === JSON.stringify(before), 'Undo row insertion failed');
    view.editor.redo();
    await wait();
    view.editor.redo();
    await wait();
    assert(JSON.stringify(meta()) === JSON.stringify(bothAdded), 'Redo insertions failed');
    results.push(
      'consecutive native row and column insertions undo/redo exact title and cell metadata',
    );
    await fixture(blank());
    p.apply(binding(), (_, m) => {
      m.headerRows = [0];
      m.headerCols = [1];
    });
    await wait();
    widget().setCellFocus(2, 2);
    await wait();
    widget().editor.tableCell.editor.cm.contentDOM.dispatchEvent(
      new win.KeyboardEvent('keydown', {
        key: 'Tab',
        code: 'Tab',
        bubbles: true,
        cancelable: true,
      }),
    );
    await wait();
    check();
    assert(
      meta().snapshot.length === 4 && meta().headerRows[0] === 0 && meta().headerCols[0] === 1,
      'Tab append lost titles',
    );
    results.push('Tab from the last native cell appends a row without losing title row or column');
    await fixture([
      ['Plain', '**Bold**'],
      ['Body', '**Bold body**'],
    ]);
    assert(
      weight(first()) === weight(binding().element.rows[1].cells[0]),
      'Plain Markdown header is automatically bold',
    );
    assert(
      weight(binding().element.rows[0].cells[1].querySelector('strong')) > weight(first()),
      'Explicit bold was suppressed',
    );
    results.push(
      'plain first-row text matches body weight while explicit Markdown bold remains bold',
    );
    widget().setCellFocus(0, 0);
    await wait();
    assert(
      weight(first().querySelector('.cm-content')) === weight(binding().element.rows[1].cells[0]),
      'Focused header editor is automatically bold',
    );
    results.push('native first-cell editor retains regular font weight');
    p.apply(binding(), (_, m) => {
      m.headerRows = [0];
    });
    await wait();
    assert(weight(first()) === 700, 'Explicit title row is not bold');
    p.apply(binding(), (_, m) => {
      m.headerRows = [];
      m.headerCols = [0];
    });
    await wait();
    assert(
      weight(first()) === 700 && weight(binding().element.rows[1].cells[0]) === 700,
      'Title column not bold',
    );
    p.apply(binding(), (_, m) => {
      m.headerCols = [];
    });
    await wait();
    assert(weight(first()) === 400, 'Clearing titles left first row bold');
    assert(meta().snapshot[0][1] === '**Bold**', 'Explicit Markdown was modified');
    results.push(
      'title row and title column still use bold, and clearing titles restores regular weight',
    );
    await app.vault.modify(view.file, view.editor.getValue());
    await leaf.setViewState({ type: 'markdown', state: { file: path, mode: 'preview' } });
    view.previewMode.rerender(true);
    for (let i = 0; i < 20 && !view.previewMode.containerEl.querySelector('.gt-table'); i++)
      await wait();
    const table = view.previewMode.containerEl.querySelector('.gt-table');
    assert(
      weight(table.rows[0].cells[0]) === weight(table.rows[1].cells[0]),
      'Reading-view header is automatically bold',
    );
    assert(
      weight(table.rows[0].cells[1].querySelector('strong')) > weight(table.rows[0].cells[0]),
      'Reading-view explicit bold lost',
    );
    results.push('reading view also renders plain headers normally and preserves explicit bold');
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
    await leaf.setViewState({
      type: 'markdown',
      state: { file: path, mode: 'source', source: false },
    });
  }
})();
