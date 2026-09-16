import { watch } from 'vue';

const googleFontAlternatives = {
  'Browallia New': 'Noto Sans Thai',
  'Century Gothic': 'Montserrat',
};

const resolvedFontFamily = (family) => googleFontAlternatives[family] || family;

function ensureFontLink(id, family) {
  const elementId = `gf-${id}`;
  let link = document.getElementById(elementId);

  if (!family) {
    link?.remove();
    return;
  }

  const fontFamily = resolvedFontFamily(family).replace(/\s+/g, '+');
  if (!link) {
    link = document.createElement('link');
    link.id = elementId;
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }
  link.href = `https://fonts.googleapis.com/css2?family=${fontFamily}:wght@300;400;600;700&display=swap`;
}

function millimeters(value, fallback) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? `${Math.min(30, parsed)}mm` : fallback;
}

function pixels(value, fallback) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0.5 ? `${Math.min(5, parsed)}px` : fallback;
}

function percentage(value, fallback = 100) {
  const parsed = Number.parseFloat(value);
  return `${Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : fallback}%`;
}

function sidebarColumnWidth(value) {
  const sidebarFraction = Number.parseFloat(value);
  const normalizedFraction = Number.isFinite(sidebarFraction) ? Math.min(3, Math.max(0.1, sidebarFraction)) : 0.7;
  const ratio = normalizedFraction / (1.5 + normalizedFraction);
  const percent = ratio * 100;
  const gap = ratio * 10;
  return `calc(${percent}% - ${gap}mm)`;
}

function colorWithOpacity(color, opacity = 100) {
  const normalized = String(color || '#111827').trim();
  const hex = normalized.startsWith('#') ? normalized.slice(1) : '';
  const expanded = hex.length === 3 ? hex.split('').map((part) => part + part).join('') : hex;
  const validHex = /^[\da-f]{6}$/i.test(expanded) ? expanded : '111827';
  const alpha = Number.parseFloat(percentage(opacity)) / 100;
  const red = Number.parseInt(validHex.slice(0, 2), 16);
  const green = Number.parseInt(validHex.slice(2, 4), 16);
  const blue = Number.parseInt(validHex.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export function applyCvDesign(design = {}) {
  const root = document.documentElement.style;
  root.setProperty('--h1-size', design.h1 || '22pt');
  root.setProperty('--h2-size', design.h2 || '12pt');
  root.setProperty('--h3-size', design.h3 || '10pt');
  root.setProperty('--bullet-size', design.bullets || '10.5pt');
  const fontColor = design.ink || '#111827';
  root.setProperty('--ink', fontColor);
  root.setProperty('--accent', fontColor);
  root.setProperty('--subtitle', fontColor);
  root.setProperty('--graphic', colorWithOpacity(fontColor, design.graphicOpacity));
  root.setProperty('--date-color', colorWithOpacity(fontColor, design.dateOpacity));
  root.setProperty('--accent-soft', colorWithOpacity(fontColor, 12));
  root.setProperty('--accent-fade', colorWithOpacity(fontColor, 15));
  root.setProperty('--bg', '#ffffff');
  root.setProperty('--header-bg', '#ffffff');
  root.setProperty('--sidebar-bg', '#ffffff');
  root.setProperty('--page-margin-top', millimeters(design.pageMarginTop, '0mm'));
  root.setProperty('--page-margin-right', millimeters(design.pageMarginRight, '0mm'));
  root.setProperty('--page-margin-bottom', millimeters(design.pageMarginBottom, '0mm'));
  root.setProperty('--page-margin-left', millimeters(design.pageMarginLeft, '0mm'));
  root.setProperty('--header-padding-vertical', millimeters(design.headerPaddingVertical, '12mm'));
  root.setProperty('--header-padding-horizontal', millimeters(design.headerPaddingHorizontal, '12mm'));
  root.setProperty('--content-padding-vertical', millimeters(design.contentPaddingVertical, '10mm'));
  root.setProperty('--content-padding-horizontal', millimeters(design.contentPaddingHorizontal, '12mm'));
  root.setProperty('--separator-width', pixels(design.separatorWidth, '1px'));
  root.setProperty('--radius', design.radius || '10px');
  root.setProperty('--badge-border-width', pixels(design.badgeBorderWidth, '1px'));
  root.setProperty('--badge-border-radius', design.badgeBorderRadius || '6px');
  root.setProperty('--item-border-width', design.itemBorderWidth || '1px');
  root.setProperty('--section-spacing', design.sectionSpacing || '6mm');
  root.setProperty('--section-spacing-body', design.sectionSpacingBody || design.sectionSpacing || '6mm');
  root.setProperty('--section-spacing-sidebar', design.sectionSpacingSidebar || design.sectionSpacing || '6mm');
  root.setProperty('--sidebar-width', design.sidebarWidth || '0.7fr');
  root.setProperty('--sidebar-column-width', sidebarColumnWidth(design.sidebarWidth));
  root.setProperty('--sidebar-align', design.sidebarAlign || 'right');
  const badgeMode = design.badgeMode === 'border' ? 'border' : 'solid';
  root.setProperty('--badge-bg', badgeMode === 'solid' ? 'var(--graphic)' : 'transparent');
  root.setProperty('--badge-color', badgeMode === 'solid' ? '#ffffff' : 'var(--graphic)');
  root.setProperty('--badge-border-color', 'var(--graphic)');
  root.setProperty('--box-shadow', 'none');
  const bodyFont = design.fontBody ? resolvedFontFamily(design.fontBody) : '';
  const headFont = design.fontHead ? resolvedFontFamily(design.fontHead) : '';
  root.setProperty('--font-body', `${bodyFont ? `'${bodyFont}', ` : ''}ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif`);
  root.setProperty('--font-head', `${headFont ? `'${headFont}', ` : ''}var(--font-body)`);

  ensureFontLink('body', design.fontBody);
  ensureFontLink('head', design.fontHead);
  document.documentElement.setAttribute('data-hstyle', design.hstyle || 'clean');
  document.documentElement.setAttribute('data-sidebar-align', design.sidebarAlign || 'right');
  document.documentElement.setAttribute('data-header-layout-style', design.headerLayoutStyle === 'separator' ? 'separator' : 'boxed');
  document.documentElement.setAttribute('data-sidebar-layout-style', design.sidebarLayoutStyle === 'separator' ? 'separator' : 'boxed');
  document.documentElement.setAttribute('data-contact-layout', design.contactLayout === 'below' ? 'below' : 'side');
}

export function useCvDesign(getDesign) {
  watch(getDesign, applyCvDesign, { deep: true, immediate: true });
}
