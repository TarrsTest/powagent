export function readingTime(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return Math.ceil(trimmed.split(/\s+/).length / 200);
}
