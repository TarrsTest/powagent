import { describe, expect, it } from 'vitest';
import { normalizeText } from '../normalize';

describe('normalizeText', () => {
  it('decomposes compatibility characters using NFKD', () => {
    expect(normalizeText('Ｆｕｌｌ ﬃ ①')).toBe('Full ffi 1');
  });

  it('strips precomposed and combining diacritics', () => {
    expect(normalizeText('Crème Bru\u0302le\u0301e')).toBe('Creme Brulee');
  });

  it('maps German sharp s to ss', () => {
    expect(normalizeText('Straße')).toBe('Strasse');
  });

  it('collapses whitespace and trims the edges', () => {
    expect(normalizeText(' \t hello\n\r world\u00a0 ')).toBe('hello world');
  });

  it('returns an empty string for empty or whitespace-only input', () => {
    expect(normalizeText('')).toBe('');
    expect(normalizeText(' \n\t ')).toBe('');
  });

  it('preserves case, CJK letters, numbers, and emoji', () => {
    expect(normalizeText('Hello 你好 123 😀')).toBe('Hello 你好 123 😀');
  });
});
