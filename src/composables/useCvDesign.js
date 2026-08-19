import { watch } from 'vue';

function ensureFontLink(id, family) {
  const elementId = `gf-${id}`;
  let link = document.getElementById(elementId);

  if (!family) {
    link?.remove();
    return;
  }

  const fontFamily = family.replace(/\s+/g, '+');
  if (!link) {
    link = document.createElement('link');
    link.id = elementId;
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }
  link.href = `https://fonts.googleapis.com/css2?family=${fontFamily}:wght@300;400;600;700&display=swap`;
}

export function applyCvDesign(design = {}) {
  const root = document.documentElement.style;
  root.setProperty('--h1-size', design.h1 || '22pt');
  root.setProperty('--h2-size', design.h2 || '12pt');
  root.setProperty('--h3-size', design.h3 || '10pt');
  root.setProperty('--bullet-size', design.bullets || '10.5pt');
  root.setProperty('--ink', design.ink || '#111827');
  root.setProperty('--accent', design.accent || '#0f66d0');
  root.setProperty('--bg', design.bg || '#ffffff');
  root.setProperty('--header-bg', design.headerbg || '#ffffff');
  root.setProperty('--sidebar-bg', design.sidebarbg || '#ffffff');
  root.setProperty('--radius', design.radius || '10px');
  root.setProperty('--subtitle', design.subtitle || '#0a9c91');
  root.setProperty('--graphic', design.graphic || design.accent || '#4f46e5');
  root.setProperty('--date-color', design.dateColor || '#6b7280');
  root.setProperty('--badge-border-width', design.badgeBorderWidth || '1px');
  root.setProperty('--badge-border-radius', design.badgeBorderRadius || '6px');
  root.setProperty('--item-border-width', design.itemBorderWidth || '1px');
  root.setProperty('--section-spacing', design.sectionSpacing || '6mm');
  root.setProperty('--section-spacing-body', design.sectionSpacingBody || design.sectionSpacing || '6mm');
  root.setProperty('--section-spacing-sidebar', design.sectionSpacingSidebar || design.sectionSpacing || '6mm');
  root.setProperty('--sidebar-width', design.sidebarWidth || '0.7fr');
  root.setProperty('--sidebar-align', design.sidebarAlign || 'right');
  root.setProperty('--addexp-columns', design.addExpColumns || '2');
  root.setProperty('--bullet-style', design.bulletStyle || 'disc');
  root.setProperty('--badge-bg', design.invertBadge ? 'transparent' : (design.graphic || design.accent || '#4f46e5'));
  root.setProperty('--badge-color', design.invertBadge ? (design.graphic || design.accent || '#4f46e5') : '#ffffff');
  root.setProperty('--box-shadow', design.enableBoxShadow ? '0 2px 8px rgba(0,0,0,0.1)' : 'none');
  root.setProperty('--font-body', `${design.fontBody ? `'${design.fontBody}', ` : ''}ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif`);
  root.setProperty('--font-head', `${design.fontHead ? `'${design.fontHead}', ` : ''}var(--font-body)`);

  ensureFontLink('body', design.fontBody);
  ensureFontLink('head', design.fontHead);
  document.documentElement.setAttribute('data-hstyle', design.hstyle || 'clean');
  document.documentElement.setAttribute('data-sidebar-align', design.sidebarAlign || 'right');
  document.documentElement.setAttribute('data-sidebar-style', design.sidebarStyle || 'default');
}

export function useCvDesign(getDesign) {
  watch(getDesign, applyCvDesign, { deep: true, immediate: true });
}
