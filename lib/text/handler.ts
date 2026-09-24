import { readingTime } from './readingTime';
import { toSlug } from './toSlug';

export function handleTextRequest(params: URLSearchParams): { status: number; body: unknown } {
  const title = params.get('title');
  if (!title?.trim()) {
    return { status: 400, body: { error: 'title is required' } };
  }

  return {
    status: 200,
    body: {
      slug: toSlug(title),
      minutes: readingTime(params.get('body') ?? ''),
    },
  };
}
