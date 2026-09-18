import type { CustomFont, CvDesign } from '../types';
import { DEFAULT_DESIGN, FULL_PAGE_SIDEBAR_PADDING, SYSTEM_FONT_STACK, resolveDesign } from '../defaults';
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

function percentage(value: unknown, fallback = DEFAULT_DESIGN.graphicOpacity) {
  const parsed = Number.parseFloat(String(value));
  return `${Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : fallback}%`;
}

function sidebarColumnWidth(value: unknown) {
  const sidebarFraction = Number.parseFloat(String(value));
  const normalizedFraction = Number.isFinite(sidebarFraction) ? Math.min(3, Math.max(0.1, sidebarFraction)) : Number.parseFloat(DEFAULT_DESIGN.sidebarWidth);
  const ratio = normalizedFraction / (1.5 + normalizedFraction);
  const percent = ratio * 100;
  const gap = ratio * Number.parseFloat(DEFAULT_DESIGN.bodySidebarSpacing);
  return `calc(${percent}% - ${gap}mm)`;
}

function colorWithOpacity(color: unknown, opacity = DEFAULT_DESIGN.graphicOpacity) {
  const normalized = String(color || DEFAULT_DESIGN.ink).trim();
  const hex = normalized.startsWith('#') ? normalized.slice(1) : '';
  const expanded = hex.length === 3 ? hex.split('').map((part) => part + part).join('') : hex;
  const validHex = /^[\da-f]{6}$/i.test(expanded) ? expanded : DEFAULT_DESIGN.ink.slice(1);
  const alpha = Number.parseFloat(percentage(opacity)) / 100;
  const red = Number.parseInt(validHex.slice(0, 2), 16);
  const green = Number.parseInt(validHex.slice(2, 4), 16);
  const blue = Number.parseInt(validHex.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export function applyCvDesign(input: CvDesign = {}) {
  const design = resolveDesign(input);
  const root = document.documentElement.style;
  root.setProperty('--h1-size', design.h1);
  root.setProperty('--h2-size', design.h2);
  root.setProperty('--h3-size', design.h3);
  root.setProperty('--bullet-size', design.bullets);
  const fontColor = design.ink;
  root.setProperty('--ink', fontColor);
  root.setProperty('--accent', fontColor);
  root.setProperty('--subtitle', fontColor);
  root.setProperty('--graphic', colorWithOpacity(fontColor, design.graphicOpacity));
  root.setProperty('--date-color', colorWithOpacity(fontColor, design.dateOpacity));
  root.setProperty('--accent-soft', colorWithOpacity(fontColor, 12));
  root.setProperty('--accent-fade', colorWithOpacity(fontColor, 15));
  root.setProperty('--bg', '#ffffff');
  root.setProperty('--page-margin-top', millimeters(design.pageMarginTop, DEFAULT_DESIGN.pageMarginTop));
  root.setProperty('--page-margin-right', millimeters(design.pageMarginRight, DEFAULT_DESIGN.pageMarginRight));
  root.setProperty('--page-margin-bottom', millimeters(design.pageMarginBottom, DEFAULT_DESIGN.pageMarginBottom));
  root.setProperty('--page-margin-left', millimeters(design.pageMarginLeft, DEFAULT_DESIGN.pageMarginLeft));
  root.setProperty('--header-padding-bottom', millimeters(design.headerPaddingBottom, DEFAULT_DESIGN.headerPaddingBottom));
  root.setProperty('--header-bottom-margin', millimeters(design.headerBottomMargin, DEFAULT_DESIGN.headerBottomMargin));
  root.setProperty('--separator-width', pixels(design.separatorWidth, DEFAULT_DESIGN.separatorWidth));
  root.setProperty('--badge-border-width', pixels(design.badgeBorderWidth, DEFAULT_DESIGN.badgeBorderWidth));
  root.setProperty('--badge-border-radius', design.badgeBorderRadius);
  root.setProperty('--section-spacing-body', design.sectionSpacingBody);
  root.setProperty('--section-spacing-sidebar', design.sectionSpacingSidebar);
  root.setProperty('--section-item-spacing', millimeters(design.itemSpacing, DEFAULT_DESIGN.itemSpacing));
  root.setProperty('--body-sidebar-spacing', millimeters(design.bodySidebarSpacing, DEFAULT_DESIGN.bodySidebarSpacing));
  root.setProperty('--sidebar-bottom-padding', design.sidebarHeightMode === 'full-page' ? FULL_PAGE_SIDEBAR_PADDING : millimeters(design.sidebarBottomPadding, DEFAULT_DESIGN.sidebarBottomPadding));
  root.setProperty('--sidebar-column-width', sidebarColumnWidth(design.sidebarWidth));
  const badgeMode = design.badgeMode;
  root.setProperty('--badge-bg', badgeMode === 'solid' ? 'var(--graphic)' : 'transparent');
  root.setProperty('--badge-color', badgeMode === 'solid' ? '#ffffff' : 'var(--graphic)');
  root.setProperty('--badge-border-color', 'var(--graphic)');
  root.setProperty('--box-shadow', 'none');
  const bodyFont = design.fontBody ? selectedFont(design.fontBody, design) : undefined;
  const headFont = design.fontHead ? selectedFont(design.fontHead, design) : undefined;
  root.setProperty('--font-body', `${bodyFont ? `${JSON.stringify(bodyFont.name)}, ` : ''}${SYSTEM_FONT_STACK}`);
  root.setProperty('--font-head', `${headFont ? `${JSON.stringify(headFont.name)}, ` : ''}var(--font-body)`);

  ensureFontLink('body', bodyFont);
  ensureFontLink('head', headFont);
  document.documentElement.setAttribute('data-show-timeline', String(design.showTimeline));
  document.documentElement.setAttribute('data-hstyle', design.hstyle);
  document.documentElement.setAttribute('data-sidebar-align', design.sidebarAlign);
  document.documentElement.setAttribute('data-header-layout-style', design.headerLayoutStyle);
  document.documentElement.setAttribute('data-sidebar-layout-style', design.sidebarLayoutStyle);
  document.documentElement.setAttribute('data-contact-layout', design.contactLayout);
}

export function useCvDesign(getDesign: () => CvDesign) {
  watch(getDesign, applyCvDesign, { deep: true, immediate: true });
}
