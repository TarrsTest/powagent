import { describe, expect, it } from 'vitest';
import { slugify } from '../slugify.ts';

describe('slugify', () => {
  it('converts plain ASCII to a lowercase slug', () => {
    expect(slugify('Hello World 123')).toBe('hello-world-123');
  });

  it('removes accents', () => {
    expect(slugify('Crème Brûlée')).toBe('creme-brulee');
  });

  it('collapses repeated punctuation', () => {
    expect(slugify('hello...,,,world!!!again')).toBe('hello-world-again');
  });

  it('removes leading and trailing symbols', () => {
    expect(slugify('***Hello World!!!')).toBe('hello-world');
  });

  it('cuts at maxLength without leaving a trailing dash', () => {
    expect(slugify('Hello World', 6)).toBe('hello');
  });

  it('returns an empty string for an empty title', () => {
    expect(slugify('')).toBe('');
  });

  it('transliterates German sharp s', () => {
    expect(slugify('Straße')).toBe('strasse');
  });

  it('preserves CJK letters', () => {
    expect(slugify('你好 世界')).toBe('你好-世界');
  });

  it('returns an empty string for an emoji-only title', () => {
    expect(slugify('😀🚀🎉')).toBe('');
  });
});
