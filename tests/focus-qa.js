// Regression checks against real Obsidian menus. Run after opening the generated QA note.
(async () => {
  const p = app.plugins.plugins['good-tables'];
  const view = app.workspace
    .getLeavesOfType('markdown')
    .map((leaf) => leaf.view)
    .find((view) => /(^|\/)qa-vault\/Good Tables QA\.md$/.test(view.file?.path ?? ''));
  if (!view) throw Error('Open the generated QA note first.');
  const wait = () => new Promise((resolve) => setTimeout(resolve, 250));
  const assert = (condition, message) => {
    if (!condition) throw Error(message);
  };
  const binding = () =>
    [...p.controllers].flatMap((c) => c.bindings).find((b) => b.editor === view.editor);
  const b = binding();
  assert(b, 'No QA table binding');
  const source = view.editor.getValue();
  const results = [];
  const original = p.menu;
  let root;
  p.menu = function (menu, editor, contextBinding) {
    root = menu;
    return original.call(this, menu, editor, contextBinding);
  };
  try {
    b.controller.select(b, { r0: 1, r1: 2, c0: 0, c1: 1 }, 'cell');
    b.element.rows[1].cells[1].dispatchEvent(
      new PointerEvent('contextmenu', {
        pointerType: 'mouse',
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: 550,
        clientY: 300,
      }),
    );
    await wait();
  } finally {
    p.menu = original;
  }
  assert(root?.dom.isConnected, 'Root menu missing');
  const item = root.items.find(
    (item) => item.submenu && item.dom.dataset.section === 'good-tables',
  );
  assert(item, 'Good Tables submenu missing');
  const child = item.submenu;
  const command = child.items[0].dom;
  item.dom.dispatchEvent(new MouseEvent('mouseenter'));
  root.selectElement(item.dom, true);
  assert(child.dom.isConnected, 'Submenu failed to open');
  item.dom.dispatchEvent(new MouseEvent('mouseleave', { relatedTarget: child.dom }));
  child.dom.dispatchEvent(new MouseEvent('mouseenter', { relatedTarget: item.dom }));
  command.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
  await wait();
  assert(child.dom.isConnected, 'Submenu closed while pointer was inside');
  results.push('pointer moves into submenu without closing');
  child.dom.dispatchEvent(new MouseEvent('mouseleave', { relatedTarget: document.body }));
  document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
  await wait();
  assert(
    !child.dom.isConnected && root.currentSubmenu == null,
    'Submenu remained after pointer exit',
  );
  assert(root.dom.isConnected, 'Parent menu was unexpectedly dismissed');
  results.push('pointer outside owner and submenu closes only the submenu');
  item.dom.dispatchEvent(new MouseEvent('mouseenter'));
  root.selectElement(item.dom, true);
  assert(child.dom.isConnected, 'Closed submenu could not reopen');
  results.push('submenu reopens normally');
  root.hide();
  await wait();
  assert(p.submenuDisposers.size === 0, 'Menu listeners survived root dismissal');
  results.push('menu dismissal disposes hover listeners');
  // Changing focus to a modal clears the visual range but its command retains
  // the captured rectangle, so multi-cell commands still act on every cell.
  b.controller.select(binding(), { r0: 1, r1: 2, c0: 0, c1: 1 }, 'cell');
  const captured = p.active;
  const modalInput = document.createElement('input');
  document.body.append(modalInput);
  try {
    modalInput.focus();
    await wait();
    assert(
      !p.active && !binding().element.querySelector('.gt-selected'),
      'Outside keyboard focus retained selection',
    );
    assert(
      captured.rect.r1 === 2 && captured.rect.c1 === 1,
      'Modal command lost its captured range',
    );
    results.push('outside focus clears highlight and preserves command range');
  } finally {
    modalInput.remove();
  }
  assert(view.editor.getValue() === source, 'Interaction checks changed the document');
  return JSON.stringify({ pass: results.length, results });
})();
