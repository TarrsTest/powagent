import { normalizeText } from './normalize';

export function readingTime(text: string): number {
  const trimmed = normalizeText(text);
  if (!trimmed) return 0;
  return Math.ceil(trimmed.split(/\s+/).length / 200);
}
