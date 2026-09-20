import type { SavedConfiguration } from '../types';
import { isBuiltinDocument } from './builtinConfigurations';

/** Older flat libraries remain valid. Invalid relationships are detached, never discarded. */
export function normalizeVariantIndex(value: unknown): SavedConfiguration[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const entries: SavedConfiguration[] = value.flatMap((item) => {
    if (!item || typeof item.id !== 'string' || !item.id || typeof item.name !== 'string' || seen.has(item.id)) return [];
    seen.add(item.id);
    return [{ id: item.id, name: item.name,
      ...(typeof item.mtime === 'number' ? { mtime: item.mtime } : {}),
      ...(typeof item.parentId === 'string' && item.parentId ? { parentId: item.parentId } : {}) }];
  });
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  return entries.map((entry) => {
    if (!entry.parentId) return entry;
    const parent = byId.get(entry.parentId);
    if (parent && !parent.parentId && parent.id !== entry.id && !isBuiltinDocument(parent.id)) return entry;
    const { parentId: _, ...detached } = entry;
    return detached;
  });
}

export function rootVariantId(id: string, variants: SavedConfiguration[]): string {
  const variant = variants.find((entry) => entry.id === id);
  return variant?.parentId || id;
}

/** Creating from a subvariant makes a sibling, so the library never gains a third level. */
export function subvariantParent(id: string, variants: SavedConfiguration[]): string {
  const variant = variants.find((entry) => entry.id === id);
  const parent = variants.find((entry) => entry.id === (variant?.parentId || id));
  if (!variant || !parent || parent.parentId || isBuiltinDocument(parent.id)) throw new Error('Choose a saved career variant first.');
  return parent.id;
}
