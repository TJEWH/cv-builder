import type { CustomFont, CvDesign } from '../types';
import { watch } from 'vue';
import { fontStylesheetUrl, selectedFont } from './webFonts';

function ensureFontLink(id: string, font?: CustomFont) {
  const elementId = `cv-font-${id}`;
  let link = document.getElementById(elementId) as HTMLLinkElement | null;

  if (!font) {
    link?.remove();
    return;
  }

  if (!link) {
    link = document.createElement('link');
    link.id = elementId;
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }
  const href = fontStylesheetUrl(font);
  if (link.href !== href) link.href = href;
}

function millimeters(value: unknown, fallback: string) {
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) && parsed >= 0 ? `${Math.min(30, parsed)}mm` : fallback;
}

function pixels(value: unknown, fallback: string) {
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) && parsed >= 0.5 ? `${Math.min(5, parsed)}px` : fallback;
}

function percentage(value: unknown, fallback = 100) {
  const parsed = Number.parseFloat(String(value));
  return `${Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : fallback}%`;
}

function sidebarColumnWidth(value: unknown) {
  const sidebarFraction = Number.parseFloat(String(value));
  const normalizedFraction = Number.isFinite(sidebarFraction) ? Math.min(3, Math.max(0.1, sidebarFraction)) : 0.7;
  const ratio = normalizedFraction / (1.5 + normalizedFraction);
  const percent = ratio * 100;
  const gap = ratio * 10;
  return `calc(${percent}% - ${gap}mm)`;
}

function colorWithOpacity(color: unknown, opacity = 100) {
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

export function applyCvDesign(design: CvDesign = {}) {
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
  root.setProperty('--page-margin-top', millimeters(design.pageMarginTop, '12mm'));
  root.setProperty('--page-margin-right', millimeters(design.pageMarginRight, '12mm'));
  root.setProperty('--page-margin-bottom', millimeters(design.pageMarginBottom, '12mm'));
  root.setProperty('--page-margin-left', millimeters(design.pageMarginLeft, '12mm'));
  root.setProperty('--header-padding-bottom', millimeters(design.headerPaddingBottom, '12mm'));
  root.setProperty('--header-bottom-margin', millimeters(design.headerBottomMargin, '12mm'));
  root.setProperty('--separator-width', pixels(design.separatorWidth, '1px'));
  root.setProperty('--badge-border-width', pixels(design.badgeBorderWidth, '1px'));
  root.setProperty('--badge-border-radius', design.badgeBorderRadius || '6px');
  root.setProperty('--section-spacing-body', design.sectionSpacingBody || '6mm');
  root.setProperty('--section-spacing-sidebar', design.sectionSpacingSidebar || '6mm');
  root.setProperty('--section-item-spacing', millimeters(design.itemSpacing, '3.5mm'));
  root.setProperty('--body-sidebar-spacing', millimeters(design.bodySidebarSpacing, '10mm'));
  root.setProperty('--sidebar-bottom-padding', design.sidebarHeightMode === 'full-page' ? '6mm' : millimeters(design.sidebarBottomPadding, '6mm'));
  root.setProperty('--sidebar-column-width', sidebarColumnWidth(design.sidebarWidth));
  const badgeMode = design.badgeMode === 'border' ? 'border' : 'solid';
  root.setProperty('--badge-bg', badgeMode === 'solid' ? 'var(--graphic)' : 'transparent');
  root.setProperty('--badge-color', badgeMode === 'solid' ? '#ffffff' : 'var(--graphic)');
  root.setProperty('--badge-border-color', 'var(--graphic)');
  root.setProperty('--box-shadow', 'none');
  const bodyFont = design.fontBody ? selectedFont(design.fontBody, design) : undefined;
  const headFont = design.fontHead ? selectedFont(design.fontHead, design) : undefined;
  root.setProperty('--font-body', `${bodyFont ? `${JSON.stringify(bodyFont.name)}, ` : ''}ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif`);
  root.setProperty('--font-head', `${headFont ? `${JSON.stringify(headFont.name)}, ` : ''}var(--font-body)`);

  ensureFontLink('body', bodyFont);
  ensureFontLink('head', headFont);
  document.documentElement.setAttribute('data-hstyle', design.hstyle || 'clean');
  document.documentElement.setAttribute('data-sidebar-align', design.sidebarAlign || 'right');
  document.documentElement.setAttribute('data-header-layout-style', design.headerLayoutStyle === 'separator' ? 'separator' : 'boxed');
  document.documentElement.setAttribute('data-sidebar-layout-style', design.sidebarLayoutStyle === 'separator' ? 'separator' : 'boxed');
  document.documentElement.setAttribute('data-contact-layout', design.contactLayout === 'below' ? 'below' : 'side');
}

export function useCvDesign(getDesign: () => CvDesign) {
  watch(getDesign, applyCvDesign, { deep: true, immediate: true });
}
