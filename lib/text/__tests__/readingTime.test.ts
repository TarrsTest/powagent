import { describe, expect, it } from 'vitest';
import { readingTime } from '../readingTime.ts';

describe('readingTime', () => {
  it('returns zero for an empty string', () => {
    expect(readingTime('')).toBe(0);
  });

  it('returns zero for whitespace', () => {
    expect(readingTime(' \t\n  \r\n ')).toBe(0);
  });

  it('returns one minute for one word', () => {
    expect(readingTime('hello')).toBe(1);
  });

  it('returns one minute for 200 words', () => {
    expect(readingTime(Array(200).fill('word').join(' '))).toBe(1);
  });

  it('rounds up to two minutes for 201 words', () => {
    expect(readingTime(Array(201).fill('word').join(' '))).toBe(2);
  });
});
