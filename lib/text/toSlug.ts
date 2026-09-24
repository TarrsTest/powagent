import { normalizeText } from './normalize';

/** Create a lowercase Unicode slug capped at maxLength (default 60), without edge hyphens. */
export function toSlug(title: string, maxLength = 60): string {
  return normalizeText(title.toLowerCase())
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, Math.max(0, maxLength))
    .replace(/-+$/g, '');
}
