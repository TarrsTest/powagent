import { describe, expect, it } from 'vitest';
import { handleTextRequest } from '../handler';

describe('handleTextRequest', () => {
  it('rejects a missing title', () => {
    expect(handleTextRequest(new URLSearchParams({ body: 'hello' }))).toEqual({
      status: 400,
      body: { error: 'title is required' },
    });
  });

  it.each(['', ' \t\n\u00a0 '])('rejects a blank title %j', (title) => {
    expect(handleTextRequest(new URLSearchParams({ title }))).toEqual({
      status: 400,
      body: { error: 'title is required' },
    });
  });

  it('returns a normalized slug and reading time', () => {
    const params = new URLSearchParams({ title: '  Crème Brûlée! ', body: 'hello world' });
    expect(handleTextRequest(params)).toEqual({
      status: 200,
      body: { slug: 'creme-brulee', minutes: 1, words: 2 },
    });
  });

  it('rounds reading time up for more than 200 words', () => {
    const params = new URLSearchParams({
      title: 'Long Read',
      body: Array(201).fill('word').join(' '),
    });
    expect(handleTextRequest(params)).toEqual({
      status: 200,
      body: { slug: 'long-read', minutes: 2, words: 201 },
    });
  });

  it('returns zero minutes when the body is missing', () => {
    expect(handleTextRequest(new URLSearchParams({ title: 'Hello' }))).toEqual({
      status: 200,
      body: { slug: 'hello', minutes: 0, words: 0 },
    });
  });

  it.each(['', ' \t\n '])('returns zero minutes for a blank body %j', (body) => {
    expect(handleTextRequest(new URLSearchParams({ title: 'Hello', body }))).toEqual({
      status: 200,
      body: { slug: 'hello', minutes: 0, words: 0 },
    });
  });
});
