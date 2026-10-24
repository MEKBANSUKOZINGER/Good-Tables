// Official Obsidian CLI QA: only modifies the explicitly named generated QA note.
(async () => {
  const p = app.plugins.plugins['good-tables'];
  const path = globalThis.goodTablesQAPath ?? app.workspace.getActiveFile()?.path;
  if (!path || !/(^|\/)qa-vault\/Good Tables QA\.md$/.test(path))
    throw Error('Open the generated qa-vault/Good Tables QA.md note first.');
  const file = app.vault.getFileByPath(path);
  if (!file) throw Error('Prepare the generated QA note first.');
  const wait = () =>
    new Promise((resolve) => setTimeout(resolve, globalThis.goodTablesQADelay ?? 300));
  const assert = (condition, message) => {
    if (!condition) throw Error(message);
  };
  const savedSettings = structuredClone(p.settings);
  const results = [];
  globalThis.gtNativeQAResults = results;
  let leaf;
  try {
    const previous = app.workspace
      .getLeavesOfType('markdown')
      .filter((l) => l.view.file?.path === path);
    const text =
      '# Good Tables QA\n\nGenerated native compatibility note.\n\n| Item | Amount | Note |\n| --- | ---: | --- |\n| A | 1 | first |\n| B | 3 | second |\n| C | 5 | third |\n\nOutside paragraph.\n';
    for (const old of previous) old.view.editor.setValue(text);
    await app.vault.modify(file, text);
    leaf = app.workspace.getLeaf('tab');
    await leaf.openFile(file, { state: { mode: 'source', source: false } });
    for (const old of previous) old.detach();
    app.workspace.setActiveLeaf(leaf, { focus: true });
    const view = leaf.view;
    globalThis.gtNativeView = view;
    const binding = () =>
      [...p.controllers].flatMap((c) => c.bindings).find((b) => b.editor === view.editor);
    for (let i = 0; i < 20 && !binding(); i++) await wait();
    const b = binding();
    assert(b, 'Missing native QA table');
    const widget = b.element.closest('.cm-table-widget').cmTile.widget;
    assert(!b.element.querySelector('.gt-row-handle,.gt-column-handle'), 'Number handles remain');
    assert(
      b.element.querySelector('.table-row-drag-handle') &&
        b.element.querySelector('.table-col-drag-handle'),
      'Native handles missing',
    );
    results.push('number handles removed, original native handles retained');
    widget.selectCells(widget.rows[1][0], widget.rows[2][2]);
    await wait();
    assert(
      b.element.querySelectorAll('.is-selected').length === 6,
      'Native selection classes missing',
    );
    assert(
      binding().axis === 'row' && binding().rect.r0 === 1 && binding().rect.r1 === 2,
      'Native rows did not reach Good Tables',
    );
    b.controller.refresh();
    assert(
      binding().element.querySelectorAll('.is-selected').length === 6,
      'Refresh removed native selection',
    );
    results.push('native row range synchronizes and survives refresh');
    const signature = (menu) =>
      menu.items
        .filter((i) => i.titleEl)
        .map((i) => ({
          title: i.titleEl.textContent,
          section: i.section,
          disabled: i.disabled,
          children: i.submenu
            ? signature(i.submenu).filter((child) => child.section !== 'good-tables')
            : undefined,
        }));
    const original = p.menu;
    const open = async (enhance) => {
      let root;
      p.menu = function (menu, editor, contextBinding) {
        root = menu;
        if (enhance) {
          p.active = undefined;
          return original.call(this, menu, editor, contextBinding);
        }
      };
      try {
        const cell = binding().element.rows[1].cells[0];
        (cell.querySelector('.cm-content') ?? cell).dispatchEvent(
          new PointerEvent('contextmenu', {
            pointerType: 'mouse',
            button: 2,
            bubbles: true,
            cancelable: true,
            clientX: 550,
            clientY: 300,
          }),
        );
        await wait();
        assert(root?.dom.isConnected, 'Native menu not captured');
        return root;
      } finally {
        p.menu = original;
      }
    };
    const baseline = await open(false);
    const native = signature(baseline);
    // Read the installed provider's actual commands, rather than duplicating
    // Good Tables' filtering rules in this compatibility check.
    const provider = app.plugins.plugins.fileclass?._children?.find(
      (child) => typeof child.build === 'function' && 'fileMenuOpen' in child,
    );
    const noteCommands = new Set();
    if (app.plugins.plugins.fileclass?.settings.enableContextMenu)
      assert(provider, 'Fileclass menu provider missing');
    if (provider && app.plugins.plugins.fileclass.settings.enableContextMenu) {
      const propertyMenu = new baseline.constructor();
      provider.build(propertyMenu, view.file);
      for (const item of signature(propertyMenu)) noteCommands.add(item.title);
      propertyMenu.hide();
    }
    const expectedEditing = (items) => items.filter((item) => !noteCommands.has(item.title));
    baseline.hide();
    await wait();
    const enhanced = await open(true);
    const actual = signature(enhanced);
    assert(
      JSON.stringify(actual.filter((i) => i.section !== 'good-tables')) ===
        JSON.stringify(expectedEditing(native)),
      'Native menu items/children changed',
    );
    const first = actual.findIndex((i) => i.section === 'good-tables');
    assert(
      first === expectedEditing(native).length &&
        actual.slice(first).every((i) => i.section === 'good-tables'),
      'Good Tables is not below every native item',
    );
    const firstOwn = enhanced.items.find((i) => i.section === 'good-tables');
    assert(
      firstOwn.dom.parentElement.previousElementSibling?.classList.contains('menu-separator'),
      'Section separator missing',
    );
    assert(
      actual.some((i) => i.section === 'table-align'),
      'Native alignment menu missing',
    );
    assert(
      native.some((i) => i.children?.length) || native.some((i) => i.section === 'selection'),
      'Native text formatting menu missing',
    );
    results.push(
      'native text formatting, clipboard and alignment entries unchanged; Good Tables below separator',
    );
    enhanced.hide();
    await wait();
    view.editor.focus();
    widget.selectCells(widget.rows[0][1], widget.rows[3][1]);
    await wait();
    assert(
      binding().axis === 'column' && binding().rect.c0 === 1,
      'Native column did not reach Good Tables',
    );
    results.push('native full-column range synchronizes');
    widget.deselectCells();
    await wait();
    assert(
      !binding().element.querySelector('.gt-selected'),
      'Native deselect left Good Tables highlights',
    );
    results.push('native deselect clears matching Good Tables highlights');
    const compareCurrentMenu = async (label) => {
      const baseline = await open(false);
      const expected = signature(baseline);
      baseline.hide();
      await wait();
      const enhanced = await open(true);
      const actual = signature(enhanced);
      assert(
        JSON.stringify(actual.filter((i) => i.section !== 'good-tables')) ===
          JSON.stringify(expectedEditing(expected)),
        label + ': native menu changed',
      );
      const first = actual.findIndex((i) => i.section === 'good-tables');
      assert(
        first === expectedEditing(expected).length && first >= 0,
        label + ': Good Tables section order changed',
      );
      enhanced.hide();
      await wait();
      results.push(label);
    };
    await compareCurrentMenu('ordinary cell menu preserved with Good Tables appended');
    widget.setCellFocus(1, 0);
    await wait();
    await compareCurrentMenu('focused cell editor menu preserved with Good Tables appended');
    // Table-only filtering must leave the ordinary note editor's menus alone.
    view.editor.setCursor(0, 0);
    view.editor.focus();
    await wait();
    let outsideMenu;
    const outsideRef = app.workspace.on('editor-menu', (menu) => {
      outsideMenu = menu;
    });
    try {
      binding()
        .cm.contentDOM.querySelector('.cm-line')
        .dispatchEvent(
          new PointerEvent('contextmenu', {
            view: window,
            bubbles: true,
            cancelable: true,
            button: 2,
            clientX: 500,
            clientY: 200,
          }),
        );
      await wait();
      assert(outsideMenu, 'Outside editor menu missing');
      const outsideTitles = new Set(signature(outsideMenu).map((item) => item.title));
      assert(
        [...noteCommands].every((title) => outsideTitles.has(title)),
        'Note-property menus changed outside the table',
      );
      results.push('Fileclass note-property menus stay available outside table cells');
    } finally {
      app.workspace.offref(outsideRef);
      outsideMenu?.hide();
    }
    const normalized = (source) =>
      source.replace(
        /^\|.*$/gm,
        (line) =>
          '|' +
          line
            .split('|')
            .slice(1, -1)
            .map((cell) => {
              const value = cell.trim();
              return /^:?-+:?$/.test(value) ? value.replace(/-+/g, '-') : value;
            })
            .join('|') +
          '|',
      );
    assert(
      normalized(view.editor.getValue()) === normalized(text),
      'Selection/menu checks changed cell values, alignment or surrounding text',
    );
    globalThis.gtNativeQAResults = results;
    return JSON.stringify({
      pass: results.length,
      results,
      nativeMenu: native.map((i) => i.title),
    });
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
