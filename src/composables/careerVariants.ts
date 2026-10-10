import type { SavedConfiguration } from '../types';

/** Legacy hierarchy metadata is ignored; every saved CV remains an independent variant. */
export function normalizeVariantIndex(value: unknown): SavedConfiguration[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item) => {
    if (!item || typeof item.id !== 'string' || !item.id || typeof item.name !== 'string' || seen.has(item.id)) return [];
    seen.add(item.id);
    return [{ id: item.id, name: item.name,
      ...(typeof item.mtime === 'number' ? { mtime: item.mtime } : {}) }];
  });
}
