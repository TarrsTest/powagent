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
