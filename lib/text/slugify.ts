export function slugify(title: string, maxLength = 60): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, Math.max(0, maxLength))
    .replace(/-+$/g, '');
}
