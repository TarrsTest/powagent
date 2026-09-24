import { describe, expect, it } from 'vitest';
import { readingTime } from '../readingTime';

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

  it('counts words after compatibility normalization', () => {
    expect(readingTime(Array(101).fill('ﷺ').join(' '))).toBe(3);
  });

  it('uses 200 wpm when options omit wpm', () => {
    expect(readingTime(Array(201).fill('word').join(' '), {})).toBe(2);
  });

  it('rounds up using a custom wpm', () => {
    expect(readingTime(Array(201).fill('word').join(' '), { wpm: 100 })).toBe(3);
  });

  it('keeps a minimum of one minute for non-empty text at a high wpm', () => {
    expect(readingTime('hello', { wpm: Infinity })).toBe(1);
  });

  it('returns zero minutes for blank text with custom wpm', () => {
    expect(readingTime(' \t\n ', { wpm: 100 })).toBe(0);
  });

  it('counts mixed whitespace after normalization', () => {
    expect(readingTime(' hello\tworld\nagain ')).toBe(1);
  });

  it.each([0, -1, -200])('throws RangeError for wpm %s, including empty text', (wpm) => {
    expect(() => readingTime('hello', { wpm })).toThrow(RangeError);
    expect(() => readingTime('', { wpm })).toThrow(RangeError);
  });
});
