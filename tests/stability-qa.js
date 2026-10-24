// Official CLI regression: only edits the generated QA note and restores settings.
(async () => {
  const p = app.plugins.plugins['good-tables'];
  const saved = structuredClone(p.settings);
  const view = app.workspace.activeLeaf.view;
  if (view.file?.path !== 'qa-vault/Good Tables QA.md') throw Error('Open generated QA note first');
  const document = view.containerEl.ownerDocument,
    window = document.defaultView;
  const wait = (ms = 250) => new Promise((resolve) => window.setTimeout(resolve, ms));
  const assert = (ok, message) => {
    if (!ok) throw Error(message);
  };
  const binding = () =>
    [...p.controllers].flatMap((c) => c.bindings).find((b) => b.editor === view.editor);
  const results = [],
    samples = [];
  const widget = () => binding().element.closest('.cm-table-widget').cmTile.widget;
  const probe = async (name, action) => {
    const baseline = binding().element.getBoundingClientRect();
    const frames = [];
    let running = true,
      raf;
    const sample = () => {
      const table = view.containerEl.querySelector('.cm-table-widget table');
      const rect = table?.getBoundingClientRect();
      frames.push({
        width: rect?.width,
        height: rect?.height,
        formats: table?.querySelectorAll('.gt-display').length,
        decorated: table?.classList.contains('gt-table'),
      });
      if (running) raf = window.requestAnimationFrame(sample);
    };
    raf = window.requestAnimationFrame(sample);
    try {
      action();
      await wait(350);
    } finally {
      running = false;
      window.cancelAnimationFrame(raf);
    }
    assert(frames.length > 1, name + ': No visible frames captured');
    assert(
      frames.every((frame) => frame.decorated && frame.formats === 3),
      name + ': Plain/undecorated frame ' + JSON.stringify(frames),
    );
    assert(
      frames.every(
        (frame) =>
          Math.abs(frame.width - baseline.width) < 2 &&
          Math.abs(frame.height - baseline.height) < 2,
      ),
      name + ': Transient size change ' + JSON.stringify(frames),
    );
    samples.push({ name, frames: frames.length, width: baseline.width, height: baseline.height });
    results.push(name);
  };
  try {
    p.settings.warned = true;
    p.settings.fullWidth = false;
    await p.saveSettings();
    view.editor.setValue(
      '# Good Tables QA\n\n| Item | Rating | Value |\n| --- | --- | --- |\n| A | 1.64 | 10 |\n| B | 3 | 20 |\n| C | 4.5 | 30 |\n\nOutside.\n',
    );
    view.editor.setCursor(0, 0);
    await wait();
    p.apply(binding(), (_rows, m) => {
      for (let r = 0; r < 4; r++) {
        m.heights[r] = 44;
        for (let c = 0; c < 3; c++) m.cells[r][c].background = '#123456';
      }
      for (let c = 0; c < 3; c++) m.widths[c] = 144;
      for (let r = 1; r < 4; r++)
        m.cells[r][1].format = { kind: 'rating', group: 'stability', scope: 'column' };
    });
    await wait();
    const displays = [...binding().element.querySelectorAll('.gt-display')];
    await probe('layout refresh keeps width, height and format nodes', () => {
      for (let i = 0; i < 50; i++) binding().controller.schedule();
    });
    assert(
      displays.every((node, i) => binding().element.querySelectorAll('.gt-display')[i] === node),
      'Refresh recreated format elements',
    );
    await probe('native column move has no plain or shrunken frame', () =>
      widget().moveColumn(1, 2, 1),
    );
    await probe('native row move has no plain or shrunken frame', () => widget().moveRow(1, 3, 0));
    await probe('native undo has no plain or shrunken frame', () => view.editor.undo());
    await probe('native redo has no plain or shrunken frame', () => view.editor.redo());
    await probe('color edit has no plain or shrunken frame', () =>
      p.apply(binding(), (_rows, m) => {
        m.cells[1][0].background = '#654321';
      }),
    );
    p.apply(binding(), (rows, m) => {
      m.diagonal = { lower: '아래', upper: '위' };
      rows[0][0] = '아래위';
    });
    await wait();
    const lower = view.containerEl.querySelector('.gt-diagonal-lower');
    lower.focus();
    lower.value = '한글 | 입력\n둘째 줄';
    lower.setSelectionRange(3, 3);
    lower.dispatchEvent(new window.InputEvent('input', { bubbles: true }));
    await wait();
    assert(
      view.containerEl.querySelector('.gt-diagonal-lower') === lower &&
        document.activeElement === lower,
      'Native rebuild lost inline node/focus',
    );
    assert(
      lower.selectionStart === 3 && lower.value === '한글 | 입력\n둘째 줄',
      'Inline input/caret changed',
    );
    lower.value += ' 계속';
    lower.dispatchEvent(new window.InputEvent('input', { bubbles: true }));
    await wait();
    assert(
      document.activeElement === lower && lower.value.endsWith(' 계속'),
      'Second edit lost focus or input',
    );
    lower.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }),
    );
    await wait();
    assert(
      document.activeElement === lower && !lower.value.endsWith(' 계속'),
      'Inline undo failed',
    );
    lower.dispatchEvent(
      new window.KeyboardEvent('keydown', {
        key: 'z',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    );
    await wait();
    assert(document.activeElement === lower && lower.value.endsWith(' 계속'), 'Inline redo failed');
    results.push('inline diagonal edits preserve DOM, focus, pipes, newlines, undo and redo');
    const preset = { id: crypto.randomUUID(), name: 'QA currency', prefix: '$', suffix: ' USD' };
    p.settings.presets = [preset];
    p.settings.formatOrder = [`preset:${preset.id}`, 'rating'];
    await p.saveSettings();
    const b = binding();
    b.rect = { r0: 1, r1: 1, c0: 0, c1: 0 };
    b.axis = 'cell';
    p.active = b;
    b.element.rows[1].cells[0].dispatchEvent(
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
    const format = [...document.querySelectorAll('.menu-item-title')].find(
      (el) => el.textContent === p.t('format'),
    );
    assert(format, 'Format menu missing');
    format.parentElement.click();
    await wait(30);
    const submenu = [...document.querySelectorAll('.menu')].find((menu) =>
      [...menu.querySelectorAll('.menu-item-title')].some((el) => el.textContent === 'QA currency'),
    );
    const titles = [
      ...(submenu?.querySelectorAll('.menu-item[data-section="good-tables"] .menu-item-title') ??
        []),
    ].map((el) => el.textContent);
    assert(
      titles[0] === 'QA currency',
      'Saved format did not become first standalone item: ' + JSON.stringify(titles),
    );
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    results.push('saved format appears as its own menu item in the chosen order');
    return JSON.stringify({ pass: results.length, results, samples });
  } catch (error) {
    return JSON.stringify({
      pass: results.length,
      results,
      samples,
      error: error.message,
      stack: error.stack,
    });
  } finally {
    p.settings = saved;
    await p.saveSettings();
  }
})();
