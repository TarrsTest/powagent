import { readingTime } from './readingTime';
import { toSlug } from './toSlug';

/** Return a slug, body reading time, and word count, or a 400 error when title is missing or blank. */
export function handleTextRequest(params: URLSearchParams): { status: number; body: unknown } {
  const title = params.get('title');
  if (!title?.trim()) {
    return { status: 400, body: { error: 'title is required' } };
  }

  return {
    status: 200,
    body: {
      slug: toSlug(title),
      ...readingTime(params.get('body') ?? ''),
    },
  };
}
