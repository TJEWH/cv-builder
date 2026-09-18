// Follow the actual item column, including left/deferred sidebars. One rail per
// section bridges both timeline wrappers, item gaps and PDF page-break spacers.
export function timelineRailPath(items: { x: number; top: number; bottom: number }[]) {
  if (!items.length) return '';
  const first = items[0];
  const commands = [`M ${first.x} ${first.top}`];
  let previousX = first.x;
  for (const item of items) {
    // A new column starts a new rail; a horizontal join would cross the sidebar.
    if (item.x !== previousX) commands.push(`M ${item.x} ${item.top}`);
    commands.push(`L ${item.x} ${item.bottom}`);
    previousX = item.x;
  }
  return commands.join(' ');
}

export function updateTimelineRails(root: HTMLElement | null) {
  if (!root) return;
  const view = root.ownerDocument.defaultView!;
  for (const rail of root.querySelectorAll('.timeline-rail')) {
    const section = rail.parentElement!;
    const bounds = section.getBoundingClientRect();
    const items = bounds.width && bounds.height ? [...section.querySelectorAll('.timeline > .item')].map((item) => {
      const title = item.querySelector<HTMLElement>('.item-title')!;
      const titleBounds = title.getBoundingClientRect();
      const dot = view.getComputedStyle(title, '::before');
      const itemBounds = item.getBoundingClientRect();
      return {
        x: titleBounds.left - bounds.left + parseFloat(dot.left) + parseFloat(dot.width) / 2,
        top: titleBounds.top - bounds.top + titleBounds.height / 2,
        bottom: itemBounds.bottom - bounds.top,
      };
    }) : [];
    rail.setAttribute('width', String(bounds.width));
    rail.setAttribute('height', String(bounds.height));
    rail.setAttribute('viewBox', `0 0 ${bounds.width || 1} ${bounds.height || 1}`);
    rail.querySelector('path')!.setAttribute('d', timelineRailPath(items));
  }
}
