import { normalizeText } from './normalize';

/** Count normalized words and round reading minutes up; non-positive wpm throws RangeError. */
export function readingTime(text: string, opts?: { wpm?: number }): number {
  const wpm = opts?.wpm ?? 200;
  if (wpm <= 0) throw new RangeError('wpm must be greater than zero');

  const trimmed = normalizeText(text);
  if (!trimmed) return 0;
  const words = trimmed.split(/\s+/).length;
  return Math.max(1, Math.ceil(words / wpm));
}
