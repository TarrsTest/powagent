/**
 * Best-effort fixed-window rate limiter (spec §9.4 — throttle candidate-side
 * spam). In-memory + per-instance: on Vercel serverless each cold instance has
 * its own window, so this is a cheap first line, not a global guarantee. When
 * you need a hard global limit, swap this module for a Redis/Upstash-backed
 * counter — call sites only depend on rateLimit()'s boolean.
 */

type Window = { count: number; resetAt: number };
const buckets = new Map<string, Window>();

/**
 * @returns true if the call is ALLOWED, false if the limit is exceeded.
 */
export const rateLimit = (
  key: string,
  limit: number,
  windowMs: number,
): boolean => {
  const now = Date.now();
  const w = buckets.get(key);
  if (!w || now >= w.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (w.count >= limit) return false;
  w.count += 1;
  return true;
};
