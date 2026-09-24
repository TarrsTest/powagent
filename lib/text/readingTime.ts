const WORDS_PER_MINUTE = 200;

/**
 * Whole minutes to read `text` at 200 wpm, rounded up. Any non-blank text is at
 * least 1 minute; blank or whitespace-only text is 0.
 */
export const readingTime = (text: string): number => {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.ceil(words / WORDS_PER_MINUTE);
};
