// Only the generated QA note is edited; plugin settings and the original active leaf are restored.
(async () => {
  const p = app.plugins.plugins['good-tables'],
    saved = structuredClone(p.settings),
    returnLeaf = app.workspace.activeLeaf,
    path = 'qa-vault/Good Tables QA.md',
    file = app.vault.getFileByPath(path);
  if (!file) throw Error('Prepare generated QA note first');
  const leaf =
    app.workspace.getLeavesOfType('markdown').find((l) => l.view.file?.path === path) ??
    app.workspace.getLeaf('tab');
  await leaf.openFile(file);
  await leaf.setViewState({
    type: 'markdown',
    state: { file: path, mode: 'source', source: false },
  });
  app.workspace.setActiveLeaf(leaf, { focus: true });
  const view = leaf.view,
    doc = view.containerEl.ownerDocument,
    win = doc.defaultView;
  const wait = (ms = 180) => new Promise((resolve) => win.setTimeout(resolve, ms)),
    assert = (ok, message) => {
      if (!ok) throw Error(message);
    };
  const binding = () =>
      [...p.controllers].flatMap((c) => c.bindings).find((b) => b.editor === view.editor),
    overlays = () => [...binding().element.parentElement.querySelectorAll('.gt-merge-overlay')];
  const fits = () =>
    overlays().forEach((e) =>
      assert(
        e.scrollHeight <= e.clientHeight && e.scrollWidth <= e.clientWidth,
        'Merged content overflow: ' +
          JSON.stringify({
            text: e.textContent,
            h: e.clientHeight,
            sh: e.scrollHeight,
            w: e.clientWidth,
            sw: e.scrollWidth,
          }),
      ),
    );
  const results = [],
    sizes = [];
  try {
    p.settings.warned = true;
    await p.saveSettings();
    view.editor.setValue(
      '# Good Tables QA\n\n| A | B | C |\n| --- | --- | --- |\n| **short** | hidden | note |\n| second | value | stored |\n| third | value | free |\n\nOutside.\n',
    );
    view.editor.setCursor(0, 0);
    await wait();
    p.apply(binding(), (_, m) => {
      m.heights[1] = 24;
      m.merges = [
        { r0: 1, r1: 1, c0: 0, c1: 1 },
        { r0: 1, r1: 2, c0: 2, c1: 2 },
      ];
    });
    await wait();
    fits();
    const initial = overlays()[0].getBoundingClientRect().height;
    p.apply(binding(), (rows) => {
      rows[1][0] = '**first line**<br>second line<br>third line<br>fourth line';
    });
    await wait();
    fits();
    const tall = overlays()[0].getBoundingClientRect().height;
    assert(tall > initial, 'Multiline content did not grow');
    p.apply(binding(), (rows) => {
      rows[1][0] = 'short';
    });
    await wait();
    fits();
    assert(overlays()[0].getBoundingClientRect().height < tall, 'Shorter text did not shrink');
    results.push(
      'horizontal merges grow for multiline content and shrink back without rewriting stored minimum heights',
    );
    p.apply(binding(), (rows) => {
      rows[1][2] = '**Vertical merge**<br>one<br>two<br>three<br>four<br>five';
    });
    await wait();
    fits();
    assert(
      overlays()[1].getBoundingClientRect().height >=
        overlays()[1].querySelector('.gt-merge-content').getBoundingClientRect().height,
      'Vertical merge too short',
    );
    results.push(
      'vertical merges include the other rows instead of adding the full content height to each row',
    );
    p.apply(binding(), (rows) => {
      rows[1][2] = 'note';
    });
    await wait();
    const overlay = overlays()[0],
      before = overlay.getBoundingClientRect().height,
      block = doc.createElement('div');
    block.setCssStyles({ height: '180px' });
    overlay.querySelector('.gt-merge-content').append(block);
    await wait();
    fits();
    assert(
      overlay.getBoundingClientRect().height > before + 100,
      'Late-rendered content did not grow its row',
    );
    block.remove();
    await wait();
    fits();
    assert(
      overlay.getBoundingClientRect().height <= before + 2,
      'Removed content left excess height',
    );
    results.push('asynchronously inserted and removed content automatically resizes its row');
    p.apply(binding(), (rows) => {
      rows[1][0] = Array(12).fill('wrap').join(' ');
    });
    await wait();
    let table = binding().element;
    table.setCssStyles({ tableLayout: 'fixed', width: '480px' });
    await wait();
    const wide = overlays()[0].getBoundingClientRect().height;
    table = binding().element;
    table.setCssStyles({ width: '300px' });
    await wait();
    fits();
    const narrow = overlays()[0].getBoundingClientRect().height;
    assert(narrow >= wide, 'Narrowing did not preserve required height');
    table.setCssStyles({ width: '480px' });
    await wait();
    fits();
    assert(
      overlays()[0].getBoundingClientRect().height <= narrow,
      'Widening retained the taller height',
    );
    results.push('column-width changes reflow text and recalculate required height');
    const content = overlays()[0].querySelector('.gt-merge-content'),
      normal = overlays()[0].getBoundingClientRect().height;
    content.setCssStyles({ fontSize: '24px' });
    await wait();
    fits();
    assert(overlays()[0].getBoundingClientRect().height >= normal, 'Larger font was clipped');
    content.setCssStyles({ fontSize: '' });
    await wait();
    fits();
    results.push('font-size changes trigger a new content measurement');
    const source = view.editor.getValue();
    for (let i = 0; i < 12; i++) {
      binding().controller.schedule();
      await wait(25);
      sizes.push(overlays()[0].getBoundingClientRect().height);
    }
    assert(
      Math.max(...sizes) - Math.min(...sizes) < 2,
      'Layout repeatedly grew or oscillated: ' + sizes,
    );
    assert(view.editor.getValue() === source, 'Sizing changed Markdown');
    assert(binding().table.metadata.heights[1] === 24, 'Sizing rewrote stored height');
    results.push(
      'repeated refreshes settle at one height and leave Markdown and saved heights unchanged',
    );
    p.apply(binding(), (_, m) => {
      m.merges = [];
    });
    await wait();
    assert(!binding().element.querySelector('.gt-merge-anchor'), 'Unmerge retained sizing classes');
    assert(
      ![...binding().element.querySelectorAll('td,th')].some((e) =>
        e.style.getPropertyValue('--gt-merge-content-height'),
      ),
      'Unmerge retained sizing properties',
    );
    view.editor.undo();
    await wait();
    fits();
    assert(overlays().length === 2, 'Undo did not restore merges');
    view.editor.redo();
    await wait();
    assert(!overlays().length, 'Redo did not remove merges');
    results.push('unmerge releases sizing and native undo/redo restores the correct state');
    const text = view.editor.getValue();
    await app.vault.modify(view.file, text);
    await leaf.setViewState({ type: 'markdown', state: { file: path, mode: 'preview' } });
    view.previewMode.rerender(true);
    await wait();
    await leaf.setViewState({
      type: 'markdown',
      state: { file: path, mode: 'source', source: false },
    });
    await wait();
    p.apply(binding(), (_, m) => {
      m.merges = [{ r0: 1, r1: 1, c0: 0, c1: 1 }];
    });
    await wait();
    await app.vault.modify(view.file, view.editor.getValue());
    await leaf.setViewState({ type: 'markdown', state: { file: path, mode: 'preview' } });
    view.previewMode.rerender(true);
    for (let i = 0; i < 20 && !view.previewMode.containerEl.querySelector('.gt-merge-overlay'); i++)
      await wait();
    const reading = view.previewMode.containerEl.querySelector('.gt-merge-overlay');
    assert(reading && reading.scrollHeight <= reading.clientHeight, 'Reading view overflow');
    results.push('reading view also fits merged Markdown content automatically');
    return JSON.stringify({ pass: results.length, results, sizes });
  } catch (error) {
    return JSON.stringify({
      pass: results.length,
      results,
      sizes,
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
    if (returnLeaf?.parent) app.workspace.setActiveLeaf(returnLeaf, { focus: true });
  }
})();
