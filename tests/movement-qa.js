// Run with the official Obsidian CLI. Only the generated QA note is edited.
(async () => {
  const p = app.plugins.plugins['good-tables'];
  const savedSettings = structuredClone(p.settings);
  const path = globalThis.goodTablesQAPath ?? app.workspace.getActiveFile()?.path;
  if (!path || !/(^|\/)qa-vault\/Good Tables QA\.md$/.test(path))
    throw Error('Open the generated qa-vault/Good Tables QA.md note first.');
  const file = app.vault.getFileByPath(path);
  if (!file) throw Error('Prepare the generated QA note first.');
  const wait = (ms = globalThis.goodTablesQADelay ?? 250) =>
    new Promise((resolve) => setTimeout(resolve, ms));
  const assert = (ok, message) => {
    if (!ok) throw Error(message);
  };
  const results = [];
  let view;
  const binding = () =>
    [...p.controllers].flatMap((c) => c.bindings).find((b) => b.editor === view.editor);
  const widget = () => binding().element.closest('.cm-table-widget').cmTile.widget;
  const metadata = () => {
    const parts = [
      ...view.editor
        .getValue()
        .matchAll(/^\[good-tables-[\da-f-]+-(\d+)-\d+\]: good-tables:(\S+)$/gm),
    ]
      .map((m) => [Number(m[1]), m[2]])
      .sort((a, b) => a[0] - b[0]);
    return JSON.parse(decodeURIComponent(parts.map((p) => p[1]).join('')));
  };
  const prepare = async (rows) => {
    const old = app.workspace.getLeavesOfType('markdown').filter((l) => l.view.file?.path === path);
    const table = rows
      .map(
        (row, r) =>
          '| ' +
          row.join(' | ') +
          ' |' +
          (r === 0 ? '\n| ' + row.map(() => '---').join(' | ') + ' |' : ''),
      )
      .join('\n');
    const source = '# Good Tables QA\n\n' + table + '\n\nOutside.\n';
    for (const leaf of old) leaf.view.editor.setValue(source);
    await app.vault.modify(file, source);
    const leaf = app.workspace.getLeaf('tab');
    await leaf.openFile(file, { state: { mode: 'source', source: false } });
    for (const l of old) l.detach();
    view = leaf.view;
    app.workspace.setActiveLeaf(leaf, { focus: true });
    for (let i = 0; i < 20 && !binding(); i++) await wait();
    assert(binding(), 'No movement QA binding');
  };
  try {
    p.settings.warned = true;
    await prepare([
      ['Item', 'Rating', 'Value'],
      ['A', '1.64', '10'],
      ['B', '3', '20'],
      ['C', '4.5', '30'],
    ]);
    p.apply(binding(), (_rows, m) => {
      for (let r = 1; r < m.cells.length; r++) {
        m.cells[r][1].format = { kind: 'rating', group: 'movement-rating', scope: 'column' };
        m.cells[r][1].background = '#123456';
      }
      m.widths[1] = 144;
      m.heights[1] = 52;
      m.headerRows = [0];
      m.headerCols = [0];
    });
    await wait(650);
    const original = metadata(),
      id = original.cells[1][1].id;
    widget().moveColumn(1, 2, 1);
    await wait(650);
    let m = metadata();
    assert(m.cells[1][2].id === id && m.widths[2] === 144, 'Column move lost cell identity/width');
    assert(
      binding().element.rows[1].cells[2].querySelector('.gt-display')?.textContent === '★★',
      'Column move lost rating display',
    );
    results.push('native column move carries rating, color, width and persisted cell identity');
    widget().moveRow(1, 3, 0);
    await wait(650);
    m = metadata();
    assert(m.cells[3][2].id === id && m.heights[3] === 52, 'Following row move lost style/height');
    assert(
      binding().element.rows[3].cells[2].querySelector('.gt-display')?.textContent === '★★',
      'Alternating moves lost rating',
    );
    results.push('row move after column move keeps formatting and height');
    const before = view.editor.getValue();
    widget().moveColumn(2, 0, 1);
    await wait(650);
    m = metadata();
    assert(
      m.cells[3][0].id === id && m.headerCols[0] === 1,
      'Second column move lost style/title association',
    );
    const after = view.editor.getValue();
    results.push('repeated alternating moves keep title columns and cell formats');
    view.editor.undo();
    await wait();
    assert(view.editor.getValue() === before, 'Undo did not restore both table and metadata');
    view.editor.redo();
    await wait();
    assert(view.editor.getValue() === after, 'Redo did not restore both table and metadata');
    results.push('native undo/redo restores content and formatting together');
    await app.vault.modify(file, after);
    const old = view.leaf,
      newLeaf = app.workspace.getLeaf('tab');
    await newLeaf.openFile(file, { state: { mode: 'source', source: false } });
    old.detach();
    view = newLeaf.view;
    await wait();
    await wait();
    assert(
      metadata().cells[3][0].id === id &&
        binding().element.rows[3].cells[0].querySelector('.gt-display')?.textContent === '★★',
      'Reopen lost persisted format',
    );
    results.push('format survives saving and reopening the moved table');
    await prepare([
      ['H', 'V'],
      ['same', '1'],
      ['same', '1'],
    ]);
    p.apply(binding(), (_rows, m) => {
      m.cells[1][1].background = '#123456';
      m.cells[2][1].background = '#654321';
    });
    await wait(650);
    const duplicateRows = metadata();
    binding().controller.rememberMove(binding(), 1, 0);
    widget().moveRow(1, 2, 0);
    await wait();
    m = metadata();
    assert(
      m.cells[2][1].id === duplicateRows.cells[1][1].id &&
        m.cells[1][1].id === duplicateRows.cells[2][1].id,
      'Identical rows did not carry their distinct styles',
    );
    results.push('identical-value rows retain their distinct style identities when moved');
    await prepare([
      ['Item', '', ''],
      ['A', '', ''],
      ['B', '', ''],
    ]);
    p.apply(binding(), (_rows, m) => {
      for (let r = 0; r < m.cells.length; r++) {
        m.cells[r][1].background = '#123456';
        m.cells[r][2].background = '#654321';
      }
      m.widths[1] = 140;
      m.widths[2] = 80;
    });
    await wait(650);
    const duplicateColumns = metadata();
    binding().controller.rememberMove(binding(), 1, 1);
    widget().moveColumn(1, 2, 1);
    await wait();
    m = metadata();
    assert(
      m.cells[1][2].id === duplicateColumns.cells[1][1].id && m.widths[2] === 140,
      'Blank duplicate columns did not carry styles/width',
    );
    results.push('blank duplicate columns carry their own styles and widths');
    return JSON.stringify({ pass: results.length, results });
  } catch (error) {
    return JSON.stringify({
      pass: results.length,
      results,
      error: error.message,
      stack: error.stack,
    });
  } finally {
    p.settings = savedSettings;
    await p.saveSettings();
  }
})();
