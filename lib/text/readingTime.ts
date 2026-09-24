import { normalizeText } from './normalize';

/** Estimate minutes at 200 normalized whitespace-separated words per minute, rounding up; empty text returns 0. */
export function readingTime(text: string): number {
  const trimmed = normalizeText(text);
  if (!trimmed) return 0;
  return Math.ceil(trimmed.split(/\s+/).length / 200);
}
