// Execute through the official CLI in the local development vault, after installing the build.
// Only the explicitly named, generated QA note is changed. No other note is edited.
(async () => {
  const path = globalThis.goodTablesQAPath ?? app.workspace.getActiveFile()?.path;
  if (!path || !/(^|\/)qa-vault\/Good Tables QA\.md$/.test(path))
    throw Error('Open the generated qa-vault/Good Tables QA.md note first.');
  let view = app.workspace
    .getLeavesOfType('markdown')
    .map((leaf) => leaf.view)
    .find((v) => v.file?.path === path);
  if (!view) throw Error('Open the generated Good Tables QA note before running live QA.');
  const p = app.plugins.plugins['good-tables'];
  if (!p) throw Error('Good Tables is not loaded');
  const savedSettings = structuredClone(p.settings);
  try {
    const wait = () =>
      new Promise((resolve) => setTimeout(resolve, globalThis.goodTablesQADelay ?? 300));
    const assert = (condition, message) => {
      if (!condition) throw Error(message);
    };
    const results = [];
    globalThis.__goodTablesQAResults = results;
    const fixture =
      '# Good Tables QA\n\nGenerated test note.\n\n| Item | Amount | Note |\n| --- | ---: | --- |\n| A | 1 | first |\n| B | 3 | second |\n| C | 0 | third |\n\nOutside text must remain intact.\n';
    const binding = () => {
      const b = [...p.controllers].flatMap((c) => c.bindings).find((b) => b.editor === view.editor);
      assert(b, 'Missing QA table binding');
      return b;
    };
    const metas = () => {
      const groups = new Map();
      for (const match of view.editor
        .getValue()
        .matchAll(/^\[good-tables-([\da-f-]+)-(\d+)-(\d+)\]: good-tables:(\S+)$/gm)) {
        if (!groups.has(match[1])) groups.set(match[1], []);
        groups.get(match[1])[Number(match[2])] = match[4];
      }
      return [...groups.values()].map((parts) => JSON.parse(decodeURIComponent(parts.join(''))));
    };
    const meta = () => metas()[0];
    const titles = () =>
      [...document.querySelectorAll('.menu-item-title')].map((el) => el.textContent);
    const click = async (label) => {
      const el = [...document.querySelectorAll('.menu-item-title')].find(
        (el) => el.textContent === label,
      );
      assert(el, `Missing menu: ${label}; available: ${titles().join(', ')}`);
      el.parentElement.click();
      await wait();
    };
    const closeMenus = () =>
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }),
      );
    const menu = async (a, axis = 'cell', r = a.r0, c = a.c0) => {
      closeMenus();
      const b = binding();
      b.rect = a;
      b.axis = axis;
      p.active = b;
      b.decorated.select(a);
      const cell = b.element.rows[r].cells[c];
      (cell.querySelector('.cm-content') ?? cell).dispatchEvent(
        new PointerEvent('contextmenu', {
          pointerType: 'mouse',
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: 500,
          clientY: 360,
        }),
      );
      await wait();
    };
    const test = async (name, fn) => {
      try {
        await fn();
        const m = meta();
        if (m)
          assert(
            m.snapshot.length === m.cells.length &&
              m.snapshot.every((row, r) => row.length === m.cells[r].length),
            'Metadata geometry mismatch after ' + name,
          );
        results.push({ name, pass: true });
      } catch (error) {
        results.push({ name, pass: false, error: error.message });
        throw error;
      }
    };
    const previousLeaf = view.leaf,
      file = view.file;
    for (const leaf of app.workspace.getLeavesOfType('markdown'))
      if (leaf !== previousLeaf && leaf.view.file?.path === path) leaf.detach();
    view.editor.setValue(fixture);
    await app.vault.modify(file, fixture);
    const freshLeaf = app.workspace.getLeaf('tab');
    await freshLeaf.openFile(file, { state: { mode: 'source', source: false } });
    previousLeaf.detach();
    view = freshLeaf.view;
    view.editor.setCursor(0, 0);
    view.editor.focus();
    await wait();
    // A freshly opened leaf can finish creating its native table after the first frame.
    for (let attempt = 0; attempt < 20; attempt++) {
      if ([...p.controllers].some((c) => c.bindings.some((b) => b.editor === view.editor))) break;
      await wait();
    }
    p.settings.language = 'ko';
    p.settings.warned = false;
    await test('native and extension context-menu coexist', async () => {
      await menu({ r0: 0, r1: 0, c0: 0, c1: 2 }, 'row', 0, 0);
      assert(
        titles().includes('행') && titles().includes('서식 설정'),
        'Native and extension items did not coexist',
      );
      await click('제목 행 / 열 설정');
      assert(meta().headerRows.includes(0), 'Title row not saved');
      assert(
        document.querySelector('.modal-title')?.textContent === 'Good Tables 표시 호환성',
        'First-use warning was not displayed',
      );
      document.querySelector('.gt-modal .mod-cta').click();
      await wait();
    });
    await test('Calc format displays values while Markdown retains raw numbers', async () => {
      await menu({ r0: 0, r1: 3, c0: 1, c1: 1 }, 'column', 1, 1);
      await click('서식 설정');
      await click('비율(Calc%)');
      const b = binding();
      const displayed = [...b.element.querySelectorAll('.gt-display')].map((el) => el.textContent);
      assert(
        displayed.includes('25%') && displayed.includes('75%') && displayed.includes('0%'),
        'Calculated display is missing: ' + displayed.join(','),
      );
      assert(
        meta().snapshot[1][1] === '1' && meta().snapshot[2][1] === '3',
        'Original numbers changed',
      );
    });
    await test('native undo and redo restore formatting atomically', async () => {
      const before = view.editor.getValue();
      view.editor.undo();
      await wait();
      assert(!meta().cells[1][1].format, 'Undo did not remove exactly the last format');
      assert(meta().headerRows.includes(0), 'Undo unexpectedly removed title');
      view.editor.redo();
      await wait();
      assert(view.editor.getValue() === before, 'Redo did not restore exact source');
    });
    await test('same format toggles off and selecting another format is blocked', async () => {
      const before = view.editor.getValue();
      await menu({ r0: 0, r1: 3, c0: 1, c1: 1 }, 'column', 1, 1);
      await click('서식 설정');
      await click('별점');
      assert(view.editor.getValue() === before, 'Overlapping format changed source');
      await menu({ r0: 0, r1: 3, c0: 1, c1: 1 }, 'column', 1, 1);
      await click('서식 설정');
      await click('비율(Calc%)');
      assert(!meta().cells[1][1].format, 'Format toggle failed');
    });
    await test('merge/unmerge retains hidden original values and styles', async () => {
      const a = { r0: 1, r1: 2, c0: 0, c1: 0 };
      await menu(a, 'cell', 2, 0);
      await click('칸 병합');
      assert(meta().merges.length === 1, 'Merge not saved');
      assert(
        binding().element.parentElement.querySelector('.gt-merge-overlay'),
        'Merge overlay missing',
      );
      await menu(a, 'cell', 2, 0);
      await click('원본 값 편집');
      const area = document.querySelector('.gt-modal textarea');
      assert(area?.value === 'A', 'Merged editor did not show anchor');
      area.value = '**Merged anchor**';
      document.querySelector('.gt-modal .mod-cta').click();
      await wait();
      assert(
        meta().snapshot[1][0] === '**Merged anchor**' && meta().snapshot[2][0] === 'B',
        'Hidden original changed',
      );
      assert(
        binding().element.parentElement.querySelector('.gt-merge-overlay strong')?.textContent ===
          'Merged anchor',
        'Merged Markdown formatting was lost',
      );
      await menu(a, 'cell', 1, 0);
      await click('병합 취소');
      assert(meta().merges.length === 0 && meta().snapshot[2][0] === 'B', 'Unmerge lost data');
    });
    await test('diagonal cell stores both originals and concatenates on disable', async () => {
      await menu({ r0: 0, r1: 0, c0: 0, c1: 0 }, 'cell', 0, 0);
      await click('첫 칸 대각선');
      assert(meta().diagonal, 'Diagonal not enabled');
      await menu({ r0: 0, r1: 0, c0: 0, c1: 0 }, 'cell', 0, 0);
      await click('원본 값 편집');
      const fields = document.querySelectorAll('.gt-diagonal-overlay textarea');
      assert(fields.length === 2, 'Diagonal inputs missing');
      fields[0].value = '아래';
      fields[0].dispatchEvent(new InputEvent('input', { bubbles: true }));
      fields[1].value = '위';
      fields[1].dispatchEvent(new InputEvent('input', { bubbles: true }));
      await wait();
      assert(
        meta().snapshot[0][0] === '아래위',
        'Diagonal plain Markdown fallback did not contain both values',
      );
      await menu({ r0: 0, r1: 0, c0: 0, c1: 0 }, 'cell', 0, 0);
      await click('첫 칸 대각선');
      assert(
        !meta().diagonal && meta().snapshot[0][0] === '아래위',
        'Diagonal toggle did not concatenate',
      );
    });
    await test('color picker has RGB inputs and applies color in the native table', async () => {
      await menu({ r0: 1, r1: 1, c0: 2, c1: 2 }, 'cell', 1, 2);
      await click('배경색 설정');
      const picker = document.querySelector('.gt-color-picker');
      assert(picker, 'Color picker missing');
      assert(document.querySelectorAll('.gt-rgb input').length === 3, 'RGB inputs missing');
      const hex = document.querySelector('.gt-hex input');
      hex.value = '#234567';
      hex.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('.gt-modal .mod-cta').click();
      await wait();
      assert(meta().cells[1][2].background === '#234567', 'Color not saved');
      assert(
        binding().element.rows[1].cells[2].style.backgroundColor === 'rgb(35, 69, 103)',
        'Color not rendered',
      );
    });
    await test('row insertion preserves original cells and title information', async () => {
      await menu({ r0: 2, r1: 2, c0: 0, c1: 2 }, 'row', 2, 0);
      await click('행·열 편집');
      await click('위에 행 추가');
      assert(binding().element.rows.length === 5, 'Inserted row missing');
      assert(meta().snapshot[3][0] === 'B', 'Original row displaced incorrectly');
      assert(meta().headerRows.includes(0), 'Title changed');
    });
    await test('existing-table settings update immediately without rewriting source', async () => {
      const before = view.editor.getValue(),
        original = p.settings.titleBackground;
      p.settings.titleBackground = '#345678';
      await p.saveSettings();
      await wait();
      assert(
        binding().element.rows[0].cells[0].style.backgroundColor === 'rgb(52, 86, 120)',
        'Existing title style did not update',
      );
      assert(view.editor.getValue() === before, 'A settings change rewrote the note');
      p.settings.titleBackground = original;
      await p.saveSettings();
      await wait();
    });
    await test('multi-cell clipboard paste escapes pipes and stays inside the table', async () => {
      const b = binding();
      b.rect = { r0: 1, r1: 1, c0: 0, c1: 1 };
      b.axis = 'cell';
      p.active = b;
      const clipboard = new DataTransfer();
      clipboard.setData('text/plain', 'literal|pipe\t12');
      b.element.rows[1].cells[0].dispatchEvent(
        new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: clipboard }),
      );
      await wait();
      assert(
        meta().snapshot[1][0] === 'literal\\|pipe' && meta().snapshot[1][1] === '12',
        'Clipboard paste corrupted table cells',
      );
    });
    await test('table selection never intercepts paste into an outside paragraph', async () => {
      const b = binding();
      b.rect = { r0: 1, r1: 2, c0: 0, c1: 0 };
      p.active = b;
      const outside = [...b.cm.contentDOM.querySelectorAll('.cm-line')].find((el) =>
        el.textContent.includes('Outside text must remain intact.'),
      );
      assert(outside, 'Outside paragraph missing');
      let prevented;
      outside.addEventListener(
        'paste',
        (event) => {
          prevented = event.defaultPrevented;
          event.preventDefault();
          event.stopPropagation();
        },
        { once: true },
      );
      const clipboard = new DataTransfer();
      clipboard.setData('text/plain', 'do not insert');
      outside.dispatchEvent(
        new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: clipboard }),
      );
      assert(prevented === false, 'Good Tables intercepted paste outside its table');
    });
    await test('creation dialog respects total dimensions and does not assign title rows', async () => {
      closeMenus();
      view.editor.setCursor(view.editor.lastLine(), 0);
      p.create(view.editor);
      await wait();
      const numbers = document.querySelectorAll('.gt-modal input[type=number]');
      assert(numbers.length === 2, 'Creation inputs missing');
      numbers[0].value = '3';
      numbers[1].value = '4';
      document.querySelector('.gt-modal .mod-cta').click();
      await wait();
      const saved = metas();
      assert(saved.length === 2, 'New table not saved');
      const last = saved[saved.length - 1];
      const fresh = [...p.controllers]
        .flatMap((c) => c.bindings)
        .find((b) => b.editor === view.editor && b.table.metadata?.id === last.id);
      assert(fresh, 'New table not rendered');
      assert(
        fresh.element.rows.length === 3 && fresh.element.rows[0].cells.length === 4,
        'Wrong total table dimensions',
      );
      assert(
        last.headerRows.length === 0 && last.headerCols.length === 0,
        'Automatic title assignment occurred',
      );
    });
    assert(
      view.editor.getValue().includes('Outside text must remain intact.'),
      'Outside text was modified',
    );
    await app.vault.modify(view.file, view.editor.getValue());
    await test('reading view renders enhancements and reacts to settings changes', async () => {
      await view.leaf.setViewState({ type: 'markdown', state: { file: path, mode: 'preview' } });
      await wait();
      const container = view.leaf.view.contentEl.querySelector('.markdown-reading-view');
      assert(
        container.querySelectorAll('.gt-table').length === 2,
        'Reading view did not enhance both tables',
      );
      const original = p.settings.titleColor;
      p.settings.titleColor = '#fedcba';
      await p.saveSettings();
      await wait();
      assert(
        container.querySelector('.gt-title')?.style.color === 'rgb(254, 220, 186)',
        'Reading view did not update title settings',
      );
      p.settings.titleColor = original;
      await p.saveSettings();
      await view.leaf.setViewState({ type: 'markdown', state: { file: path, mode: 'source' } });
      await wait();
    });
    return JSON.stringify({ pass: results.length, results });
  } finally {
    p.settings = savedSettings;
    await p.saveSettings();
  }
})();
