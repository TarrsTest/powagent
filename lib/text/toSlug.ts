import { normalizeText } from './normalize';

/** Cap at maxLength UTF-16 units (default 60), keeping whole code points and no edge hyphens. */
export function toSlug(title: string, maxLength = 60): string {
  return normalizeText(title.toLowerCase())
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, Math.max(0, maxLength))
    // A UTF-16 cut can leave the first half of a supplementary letter or number.
    .replace(/[\uD800-\uDBFF]$/, '')
    .replace(/-+$/g, '');
}
