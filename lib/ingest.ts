import { lookup } from 'dns/promises';
import { isIP } from 'net';

/**
 * Agent-conversation ingest (spec §7). Two sources:
 *  - markdown: candidate pastes the transcript → stored verbatim (canonical).
 *  - url: server fetches a public share link → best-effort text extraction.
 *
 * url fetching is a first-class SSRF surface (spec §9.2). Guards here:
 *   https-only · block private/loopback/link-local/metadata IPs · resolve &
 *   re-validate every redirect hop · request timeout · response size cap.
 *
 * Residual limitation (documented, acceptable for MVP): there's a small
 * DNS-rebind TOCTOU window between our lookup() and fetch()'s own resolution.
 * A hardened deploy would pin the socket to the vetted IP or route through an
 * egress proxy with an allowlist.
 */

const FETCH_TIMEOUT_MS = 8000;
const MAX_BYTES = 512 * 1024; // 512 KB cap on a transcript
const MAX_REDIRECTS = 3;

const isPrivateIp = (ip: string): boolean => {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 10) return true;
    if (a === 127) return true; // loopback
    if (a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }
  if (v === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true; // loopback / unspecified
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // ULA
    if (lower.startsWith('fe80')) return true; // link-local
    if (lower.startsWith('::ffff:')) {
      // IPv4-mapped — validate the embedded v4
      return isPrivateIp(lower.replace('::ffff:', ''));
    }
    return false;
  }
  return true; // unparseable → treat as unsafe
};

/** Throws if the URL is not a safe public https target. Returns the URL. */
const assertSafeUrl = async (raw: string): Promise<URL> => {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('invalid url');
  }
  if (u.protocol !== 'https:') throw new Error('only https urls are allowed');
  if (!u.hostname) throw new Error('invalid host');

  // If the host is a literal IP, check it directly; else resolve all records.
  if (isIP(u.hostname)) {
    if (isPrivateIp(u.hostname)) throw new Error('blocked non-public address');
    return u;
  }
  const records = await lookup(u.hostname, { all: true });
  if (records.length === 0) throw new Error('host did not resolve');
  for (const r of records) {
    if (isPrivateIp(r.address)) throw new Error('blocked non-public address');
  }
  return u;
};

/** Crude HTML→text: drop script/style, strip tags, collapse whitespace. */
const htmlToText = (html: string): string =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<\/(p|div|br|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

export type IngestResult = {
  fetch_status: 'ok' | 'failed';
  raw_md: string | null;
  error?: string;
};

/**
 * Fetch a public transcript URL with SSRF guards + manual redirect vetting.
 * Best-effort: on any failure returns { fetch_status: 'failed' } rather than
 * throwing, so a bad link never blocks the submission (spec §7).
 */
export const ingestUrl = async (rawUrl: string): Promise<IngestResult> => {
  let current = rawUrl;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const u = await assertSafeUrl(current);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(u, {
          redirect: 'manual',
          signal: ctrl.signal,
          headers: { accept: 'text/markdown, text/plain, text/html' },
        });
      } finally {
        clearTimeout(timer);
      }

      // Follow redirects manually so each hop is re-vetted.
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) return { fetch_status: 'failed', raw_md: null, error: 'redirect without location' };
        current = new URL(loc, u).toString();
        continue;
      }
      if (!res.ok) {
        return { fetch_status: 'failed', raw_md: null, error: `upstream ${res.status}` };
      }

      // Size-capped read.
      const buf = await res.arrayBuffer();
      if (buf.byteLength > MAX_BYTES) {
        return { fetch_status: 'failed', raw_md: null, error: 'transcript too large' };
      }
      const body = new TextDecoder().decode(buf);
      const ctype = res.headers.get('content-type') ?? '';
      const text = ctype.includes('html') ? htmlToText(body) : body.trim();
      if (!text) return { fetch_status: 'failed', raw_md: null, error: 'empty transcript' };
      return { fetch_status: 'ok', raw_md: text };
    }
    return { fetch_status: 'failed', raw_md: null, error: 'too many redirects' };
  } catch (e) {
    return { fetch_status: 'failed', raw_md: null, error: (e as Error).message };
  }
};

/** Normalize a submitted conversation into a persisted artifact shape. */
export const ingestConversation = async (conv: {
  type: 'url' | 'markdown';
  url?: string;
  md?: string;
}): Promise<{
  source_type: 'url' | 'markdown';
  source_url: string | null;
  raw_md: string | null;
  fetch_status: 'pending' | 'ok' | 'failed';
  fetched_at: string | null;
}> => {
  if (conv.type === 'markdown') {
    const md = (conv.md ?? '').trim();
    return {
      source_type: 'markdown',
      source_url: null,
      raw_md: md || null,
      fetch_status: md ? 'ok' : 'failed',
      fetched_at: new Date().toISOString(),
    };
  }
  const result = await ingestUrl(conv.url ?? '');
  return {
    source_type: 'url',
    source_url: conv.url ?? null,
    raw_md: result.raw_md,
    fetch_status: result.fetch_status,
    fetched_at: new Date().toISOString(),
  };
};
