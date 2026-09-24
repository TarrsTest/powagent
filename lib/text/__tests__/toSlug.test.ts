import { describe, expect, it } from 'vitest';
import { toSlug } from '../toSlug';

describe('toSlug', () => {
  it('converts plain ASCII to a lowercase slug', () => {
    expect(toSlug('Hello World 123')).toBe('hello-world-123');
  });

  it('removes accents', () => {
    expect(toSlug('Crème Brûlée')).toBe('creme-brulee');
  });

  it('collapses repeated punctuation', () => {
    expect(toSlug('hello...,,,world!!!again')).toBe('hello-world-again');
  });

  it('removes leading and trailing symbols', () => {
    expect(toSlug('***Hello World!!!')).toBe('hello-world');
  });

  it('cuts at maxLength without leaving a trailing dash', () => {
    expect(toSlug('Hello World', 6)).toBe('hello');
  });

  it.each([
    ['𠀀abc', 1, ''],
    ['𠀀abc', 2, '𠀀'],
    ['a𠀀b', 2, 'a'],
    ['a𠀀b', 3, 'a𠀀'],
    ['a-𠀀b', 3, 'a'],
    ['你好世界', 3, '你好世'],
  ])('keeps whole Unicode characters in %s at limit %i', (title, limit, expected) => {
    const slug = toSlug(title, limit);
    expect(slug).toBe(expected);
    expect(slug.length).toBeLessThanOrEqual(limit);
    expect(() => encodeURIComponent(slug)).not.toThrow();
  });

  it('keeps the default boundary valid for very long Unicode input', () => {
    const slug = toSlug('a'.repeat(59) + '𠀀'.repeat(100_000));
    expect(slug).toBe('a'.repeat(59));
    expect(() => encodeURIComponent(slug)).not.toThrow();
  });

  it.each([
    ['𝑨𝑩𝑪', 'abc'], ['ᴬᴮ', 'ab'], ['ϒ', 'υ'], ['İ', 'i'], ['ẞ', 'ss'],
  ])('lowercases normalized compatibility letters in %s', (title, expected) => {
    expect(toSlug(title)).toBe(expected);
  });

  it('returns an empty string for an empty title', () => {
    expect(toSlug('')).toBe('');
  });

  it('transliterates German sharp s', () => {
    expect(toSlug('Straße')).toBe('strasse');
  });

  it('preserves CJK letters', () => {
    expect(toSlug('你好 世界')).toBe('你好-世界');
  });

  it('normalizes compatibility characters', () => {
    expect(toSlug('Ｆｕｌｌ ﬃ ①')).toBe('full-ffi-1');
  });

  it('returns an empty string for an emoji-only title', () => {
    expect(toSlug('😀🚀🎉')).toBe('');
  });
});
