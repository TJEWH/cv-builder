// Follow the actual item column, including left/deferred sidebars. One rail per
// section bridges both timeline wrappers, item gaps and PDF page-break spacers.
export function timelineRailPath(items: { x: number; top: number; bottom: number }[]) {
  if (!items.length) return '';
  // Draw upwards from the actual bottom entry, never from a page boundary or
  // a wrapper whose height includes pagination whitespace.
  const last = items[items.length - 1];
  const commands = [`M ${last.x} ${last.bottom}`];
  let previousX = last.x;
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index];
    // A new column starts a new rail; a horizontal join would cross the sidebar.
    if (item.x !== previousX) commands.push(`M ${item.x} ${item.bottom}`);
    commands.push(`L ${item.x} ${item.top}`);
    previousX = item.x;
  }
  return commands.join(' ');
}

export function updateTimelineRails(root: HTMLElement | null) {
  if (!root || root.ownerDocument.documentElement.getAttribute('data-show-timeline') === 'false') return;
  const view = root.ownerDocument.defaultView!;
  // Read every section first; interleaving SVG writes with geometry reads forces
  // the browser to lay out the CV again for each section.
  const measurements = [...root.querySelectorAll<SVGSVGElement>('.timeline-rail')].map((rail) => {
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
    // Tight, explicitly positioned SVG bounds prevent intrinsic SVG sizing from
    // lifting or clipping the rail when a section gains page-break spacers.
    const top = items.length ? Math.min(...items.map((item) => item.top)) - 2 : 0;
    const bottom = items.length ? Math.max(...items.map((item) => item.bottom)) + 2 : 0;
    const height = bottom - top;
    return { rail, top, height, width: bounds.width, path: timelineRailPath(items) };
  });
  const setAttribute = (element: Element, name: string, value: string) => {
    if (element.getAttribute(name) !== value) element.setAttribute(name, value);
  };
  for (const { rail, top, height, width, path } of measurements) {
    if (rail.style.top !== `${top}px`) rail.style.top = `${top}px`;
    setAttribute(rail, 'preserveAspectRatio', 'none');
    setAttribute(rail, 'width', String(width));
    setAttribute(rail, 'height', String(height));
    setAttribute(rail, 'viewBox', `0 ${top} ${width || 1} ${height || 1}`);
    setAttribute(rail.querySelector('path')!, 'd', path);
  }
}
