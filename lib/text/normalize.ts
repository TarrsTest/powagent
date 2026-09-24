/** Apply NFKD, strip combining marks, map ß to ss, and collapse and trim whitespace. */
export function normalizeText(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/ß/g, 'ss')
    .replace(/\s+/g, ' ')
    .trim();
}
