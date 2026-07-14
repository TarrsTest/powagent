import { randomBytes, createHash, timingSafeEqual } from 'crypto';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * API-key auth for the two-sided REST API (spec §6). Keys are stored as a
 * sha256 hash — the raw key is shown exactly once at creation and never again.
 * Scope isolation is enforced here + in each route: a candidate key can never
 * read another candidate's submissions or any evaluation; an org key only
 * touches data under its own organization.
 */

export type OwnerType = 'candidate' | 'org';

// Canonical scope strings. Keep these two sets disjoint by owner type.
export const SCOPES = {
  candidate: ['tasks:read', 'tasks:accept', 'submissions:read', 'submissions:write'],
  org: [
    'jobs:write',
    'tasks:write',
    'rubrics:write',
    'submissions:read',
    'evaluations:read',
    'evaluations:write',
  ],
} as const;

export type AuthedKey = {
  keyId: string;
  ownerType: OwnerType;
  ownerId: string;
  scopes: string[];
};

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Generate a fresh key. Returns the raw key (show once) + fields to persist. */
export const generateKey = (ownerType: OwnerType) => {
  const tag = ownerType === 'candidate' ? 'cand' : 'org';
  const raw = `pk_${tag}_${randomBytes(24).toString('hex')}`;
  return {
    raw,
    key_hash: sha256(raw),
    key_prefix: raw.slice(0, 12), // e.g. "pk_cand_ab12"
  };
};

const extractRawKey = (req: Request): string | null => {
  const auth = req.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();
  const x = req.headers.get('x-api-key');
  return x?.trim() || null;
};

/**
 * Resolve the API key on a request to its owner + scopes, or null if missing/
 * invalid/revoked. Updates last_used_at best-effort.
 */
export const authenticate = async (req: Request): Promise<AuthedKey | null> => {
  const raw = extractRawKey(req);
  if (!raw) return null;

  const db = createServiceClient();
  const { data, error } = await db
    .from('api_keys')
    .select('id, owner_type, owner_id, key_hash, scopes, revoked_at')
    .eq('key_hash', sha256(raw))
    .is('revoked_at', null)
    .maybeSingle();

  if (error || !data) return null;

  // Constant-time confirm (the eq already matched the hash; this guards
  // against any storage-layer surprises without leaking timing).
  const a = Buffer.from(sha256(raw));
  const b = Buffer.from(data.key_hash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  // best-effort touch; ignore failure
  await db.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', data.id);

  return {
    keyId: data.id,
    ownerType: data.owner_type as OwnerType,
    ownerId: data.owner_id,
    scopes: data.scopes ?? [],
  };
};

export const hasScope = (key: AuthedKey, scope: string) =>
  key.scopes.includes(scope);
