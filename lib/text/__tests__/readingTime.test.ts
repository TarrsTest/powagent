import { describe, expect, it } from 'vitest';
import { readingTime } from '../readingTime';

describe('readingTime', () => {
  it('returns zero for an empty string', () => {
    expect(readingTime('')).toEqual({ minutes: 0, words: 0 });
  });

  it('returns zero for whitespace', () => {
    expect(readingTime(' \t\n  \r\n ')).toEqual({ minutes: 0, words: 0 });
  });

  it('returns one minute for one word', () => {
    expect(readingTime('hello')).toEqual({ minutes: 1, words: 1 });
  });

  it('returns one minute for 200 words', () => {
    expect(readingTime(Array(200).fill('word').join(' '))).toEqual({ minutes: 1, words: 200 });
  });

  it('rounds up to two minutes for 201 words', () => {
    expect(readingTime(Array(201).fill('word').join(' '))).toEqual({ minutes: 2, words: 201 });
  });

  it('counts words after compatibility normalization', () => {
    expect(readingTime(Array(101).fill('ﷺ').join(' '))).toEqual({ minutes: 3, words: 404 });
  });

  it('uses 200 wpm when options omit wpm', () => {
    expect(readingTime(Array(201).fill('word').join(' '), {})).toEqual({ minutes: 2, words: 201 });
  });

  it('rounds up using a custom wpm', () => {
    expect(readingTime(Array(201).fill('word').join(' '), { wpm: 100 })).toEqual({ minutes: 3, words: 201 });
  });

  it('keeps a minimum of one minute for non-empty text at a high wpm', () => {
    expect(readingTime('hello', { wpm: Infinity })).toEqual({ minutes: 1, words: 1 });
  });

  it('returns zero minutes and words for blank text with custom wpm', () => {
    expect(readingTime(' \t\n ', { wpm: 100 })).toEqual({ minutes: 0, words: 0 });
  });

  it('counts mixed whitespace after normalization', () => {
    expect(readingTime(' hello\tworld\nagain ')).toEqual({ minutes: 1, words: 3 });
  });

  it.each([0, -1, -200])('throws RangeError for wpm %s, including empty text', (wpm) => {
    expect(() => readingTime('hello', { wpm })).toThrow(RangeError);
    expect(() => readingTime('', { wpm })).toThrow(RangeError);
  });
});
