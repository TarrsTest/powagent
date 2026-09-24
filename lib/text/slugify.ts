/**
 * URL-safe slug from a free-text title: lowercased, diacritics stripped, every
 * run of non-alphanumerics collapsed to one `-`, capped at `maxLength` and
 * never starting or ending with `-`.
 */
export const slugify = (title: string, maxLength = 60): string =>
  title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/, '');
