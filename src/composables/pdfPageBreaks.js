// CSS page-break placement retained independently of the removed html2pdf
// worker. Only the private snapshot is changed; canceled work is disposable.
export async function applyPdfPageBreaks(root, pageHeight, task, onLayoutChange) {
  if (!(pageHeight > 0)) throw new Error('PDF margins leave no space for content');
  const origin = root.getBoundingClientRect().top;
  const forced = new Set(['always', 'page', 'left', 'right']);
  for (const element of root.querySelectorAll('*')) {
    const pause = task.checkpoint();
    if (pause) await pause;
    const style = root.ownerDocument.defaultView.getComputedStyle(element);
    let before = forced.has(style.breakBefore || style.pageBreakBefore);
    const after = forced.has(style.breakAfter || style.pageBreakAfter);
    const avoid = ['avoid', 'avoid-page'].includes(style.breakInside || style.pageBreakInside);
    const bounds = element.getBoundingClientRect();
    const top = bounds.top - origin, bottom = bounds.bottom - origin;
    if (avoid && !before && Math.floor(top / pageHeight) !== Math.floor(bottom / pageHeight) && bottom - top <= pageHeight) before = true;
    const insert = (position, next) => {
      const spacer = root.ownerDocument.createElement('div');
      spacer.style.cssText = `display:block;height:${pageHeight - (position % pageHeight)}px`;
      element.parentNode.insertBefore(spacer, next);
      onLayoutChange?.();
    };
    if (before) insert(top, element);
    if (after) insert(bottom, element.nextSibling);
  }
}
