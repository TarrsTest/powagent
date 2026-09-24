import { normalizeText } from './normalize';

export function slugify(title: string, maxLength = 60): string {
  return normalizeText(title.toLowerCase())
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, Math.max(0, maxLength))
    .replace(/-+$/g, '');
}
