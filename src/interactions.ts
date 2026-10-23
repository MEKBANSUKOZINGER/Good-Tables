/** Clear a table range when interaction moves to another pane or out of the app.
 * Native context menus retain the range so their commands can act on it. */
export function watchSelectionBoundary(
  document: Document,
  contains: (target: Node) => boolean,
  clear: () => void,
): () => void {
  let disposed = false;
  let pointerInside = false;
  const inside = (target: EventTarget | null) =>
    !!target && (contains(target as Node) || !!(target as Element).closest?.('.menu'));
  const pointer = (event: Event) => {
    pointerInside = inside(event.target);
    if (!pointerInside) clear();
  };
  const focus = () => {
    if (disposed) return;
    const active = document.activeElement;
    // Obsidian briefly blurs the cell editor while replacing it during a drag.
    // Outside clicks/focus and window blur still clear the range explicitly.
    if (active === document.body && (pointerInside || document.querySelector('.menu'))) return;
    if (!inside(active)) clear();
  };
  const blur = () => queueMicrotask(focus);
  const windowBlur = () => clear();
  document.addEventListener('mousedown', pointer, true);
  document.addEventListener('focusin', focus);
  document.addEventListener('focusout', blur);
  document.defaultView?.addEventListener('blur', windowBlur);
  return () => {
    disposed = true;
    document.removeEventListener('mousedown', pointer, true);
    document.removeEventListener('focusin', focus);
    document.removeEventListener('focusout', blur);
    document.defaultView?.removeEventListener('blur', windowBlur);
  };
}

/** A short grace period lets the pointer cross the gap to the adjacent menu. */
export function closeSubmenuOnExit(
  owner: HTMLElement,
  submenu: HTMLElement,
  close: () => void,
  delay = 150,
  onDispose: () => void = () => {},
): () => void {
  const document = owner.ownerDocument;
  const window = document.defaultView!;
  let timer: number | undefined;
  let watching = false;
  let disposed = false;
  const cancel = () => {
    window.clearTimeout(timer);
    timer = undefined;
  };
  const inside = (target: EventTarget | null) =>
    !!target && (owner.contains(target as Node) || submenu.contains(target as Node));
  const finish = () => {
    cancel();
    watching = false;
    document.removeEventListener('mousemove', move, true);
  };
  const leave = () => {
    if (timer !== undefined) return;
    timer = window.setTimeout(() => {
      finish();
      close();
    }, delay);
  };
  const move = (event: MouseEvent) => {
    if (inside(event.target)) cancel();
    else leave();
  };
  const enter = () => {
    cancel();
    if (!watching) document.addEventListener('mousemove', move, true);
    watching = true;
  };
  const exit = (event: MouseEvent) => {
    if (!inside(event.relatedTarget)) leave();
  };
  owner.addEventListener('mouseenter', enter);
  owner.addEventListener('mouseleave', exit);
  submenu.addEventListener('mouseenter', enter);
  submenu.addEventListener('mouseleave', exit);
  // Menus attach directly to body. Dispose when their parent menu is dismissed,
  // without replacing Obsidian's own onHide callback or menu lifecycle.
  let shown = owner.isConnected;
  const observer = new document.defaultView!.MutationObserver(() => {
    if (owner.isConnected) shown = true;
    else if (shown || owner.closest('.menu')) dispose();
  });
  observer.observe(document.body, { childList: true });
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    finish();
    observer.disconnect();
    owner.removeEventListener('mouseenter', enter);
    owner.removeEventListener('mouseleave', exit);
    submenu.removeEventListener('mouseenter', enter);
    submenu.removeEventListener('mouseleave', exit);
    onDispose();
  };
  return dispose;
}
