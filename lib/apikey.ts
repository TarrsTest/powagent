import { randomBytes, createHash, timingSafeEqual } from 'crypto';

/**
 * API-key auth for the two-sided REST API (spec §6). Keys are stored as a
 * sha256 hash — the raw key is shown exactly once at creation and never again.
 * Scope isolation is enforced here + in each route: a candidate key can never
 * read another candidate's submissions or any evaluation; an org key only
 * touches data under its own organization.
 *
 * Scopes are CHOSEN at issue time. Until 2026-08-11 every key silently received
 * its owner type's full set, which made the scope system decorative — a key
 * minted to list tasks could also submit work (PRD §9.9 "Remaining gaps"). The
 * selection arrives from a browser form, so `normalizeScopes` is the server-side
 * gate: the client picks from a menu, it never defines the menu.
 *
 * This module deliberately imports nothing but `node:crypto`. The Supabase
 * client reaches `authenticate` as an injected argument, resolved lazily when
 * absent, because a top-level `@/lib/supabase/service` import makes the file
 * unloadable by Node's test runner (it does not resolve tsconfig path aliases)
 * — the same constraint that keeps lib/leaderboard.ts and lib/submissionRules.ts
 * import-free.
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

/**
 * What each scope lets a key do, in the words a person choosing one needs.
 * Keyed by `ownerType:scope` because `submissions:read` means different things
 * to the two owner types — a candidate reads their own submissions, an org
 * reads every submission to its tasks.
 */
const SCOPE_DETAILS: Record<string, { label: string; description: string }> = {
  'candidate:tasks:read': {
    label: 'Browse tasks',
    description: 'List open tasks and read their briefs.',
  },
  'candidate:tasks:accept': {
    label: 'Accept tasks',
    description: 'Signal that you are working on a task.',
  },
  'candidate:submissions:read': {
    label: 'Read own submissions',
    description: 'Read back your own submissions and any feedback shared with you.',
  },
  'candidate:submissions:write': {
    label: 'Submit work',
    description: 'Submit a deliverable and its agent transcript.',
  },
  'org:jobs:write': {
    label: 'Manage jobs',
    description: 'Create jobs and list the ones your org owns.',
  },
  'org:tasks:write': {
    label: 'Manage tasks',
    description: 'Add tasks under your org’s jobs.',
  },
  'org:rubrics:write': {
    label: 'Manage rubrics',
    description: 'Create the scoring rubrics evaluations run against.',
  },
  'org:submissions:read': {
    label: 'Read submissions',
    description: 'Read candidate deliverables and agent transcripts for your tasks.',
  },
  'org:evaluations:read': {
    label: 'Read evaluations',
    description: 'Read scores and the candidate ranking.',
  },
  'org:evaluations:write': {
    label: 'Run evaluations',
    description: 'Trigger an evaluation of a submission against a rubric.',
  },
};

/** Label + description for one scope, falling back to the raw string. */
export const describeScope = (ownerType: OwnerType, scope: string) =>
  SCOPE_DETAILS[`${ownerType}:${scope}`] ?? { label: scope, description: '' };

export type AuthedKey = {
  keyId: string;
  ownerType: OwnerType;
  ownerId: string;
  scopes: string[];
};

export type ScopeSelection =
  | { ok: true; scopes: string[] }
  | { ok: false; error: string };

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

const isOwnerScope = (ownerType: OwnerType, scope: string): boolean =>
  (SCOPES[ownerType] as readonly string[]).includes(scope);

/**
 * Validate a requested scope selection against what this owner type may hold.
 *
 * The rules, and why each is what it is:
 *  · Unknown or wrong-owner-type scopes REJECT the whole request rather than
 *    being dropped. Silently discarding one hands back a key that is missing a
 *    permission the caller believes it has, and they find out at the first 403.
 *    An org scope on a candidate key is called out separately from a typo,
 *    because they are different mistakes.
 *  · Duplicates are REJECTED. The checkbox UI cannot produce one, so a repeated
 *    value means the request was assembled by hand and does not say plainly what
 *    it wants — the same reason an unknown scope is refused rather than dropped.
 *    Collapsing it silently would also let a malformed client believe its
 *    request was understood exactly as sent.
 *  · An empty selection is refused. A key with no scopes authenticates but is
 *    forbidden everywhere, which reads as a broken key rather than a deliberate
 *    one. Note this is also what stops the old all-scopes default sneaking back
 *    in as "nothing selected means everything".
 *  · Output order follows SCOPES, not the caller's, so the stored array is
 *    deterministic and never reflects the shape of the request.
 */
export const normalizeScopes = (
  ownerType: OwnerType,
  requested: readonly string[],
): ScopeSelection => {
  const cleaned = requested.map((s) => String(s).trim()).filter((s) => s.length > 0);

  for (const scope of cleaned) {
    if (isOwnerScope(ownerType, scope)) continue;
    const other: OwnerType = ownerType === 'candidate' ? 'org' : 'candidate';
    if (isOwnerScope(other, scope)) {
      return { ok: false, error: `scope not available for a ${ownerType} key: ${scope}` };
    }
    return { ok: false, error: `unknown scope: ${scope}` };
  }

  // Validity is checked before duplication on purpose: ['nope', 'nope'] should
  // report the unknown scope, which is the actionable problem, not the repeat.
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const scope of cleaned) {
    if (seen.has(scope) && !duplicates.includes(scope)) duplicates.push(scope);
    seen.add(scope);
  }
  if (duplicates.length > 0) {
    return {
      ok: false,
      error: `duplicate scope${duplicates.length > 1 ? 's' : ''}: ${duplicates.join(', ')}`,
    };
  }

  const scopes = (SCOPES[ownerType] as readonly string[]).filter((s) => seen.has(s));
  if (scopes.length === 0) return { ok: false, error: 'select at least one scope' };

  return { ok: true, scopes };
};

export type GeneratedKey = {
  raw: string;
  key_hash: string;
  key_prefix: string;
  scopes: string[];
};

/**
 * Generate a fresh key. Returns the raw key (show once) + the fields to persist.
 *
 * Re-validates the scopes even though callers are expected to have run
 * `normalizeScopes` already: this is the only function that mints a key, so
 * making it the choke point means no future caller can create one carrying a
 * scope its owner may not hold. Throws rather than returning a result union
 * because by here an invalid selection is a caller bug, not user input — the
 * user-facing rejection happens in `normalizeScopes`.
 */
export const generateKey = (ownerType: OwnerType, requestedScopes: readonly string[]): GeneratedKey => {
  const selection = normalizeScopes(ownerType, requestedScopes);
  if (!selection.ok) throw new Error(`refusing to generate key: ${selection.error}`);

  const tag = ownerType === 'candidate' ? 'cand' : 'org';
  const raw = `pk_${tag}_${randomBytes(24).toString('hex')}`;
  return {
    raw,
    key_hash: sha256(raw),
    key_prefix: raw.slice(0, 12), // e.g. "pk_cand_ab12"
    scopes: selection.scopes,
  };
};

const extractRawKey = (req: Request): string | null => {
  const auth = req.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();
  const x = req.headers.get('x-api-key');
  return x?.trim() || null;
};

type ApiKeyRow = {
  id: string;
  owner_type: string;
  owner_id: string;
  key_hash: string;
  scopes: string[] | null;
  revoked_at: string | null;
};

/**
 * The slice of the Supabase client this module uses. Narrow on purpose: it is
 * what lets a test drive `authenticate` without a database, and it documents
 * exactly which query shapes the auth path depends on.
 */
export type ApiKeyStore = {
  from(table: 'api_keys'): {
    select(columns: string): {
      eq(column: string, value: string): {
        is(column: string, value: null): {
          maybeSingle(): Promise<{ data: ApiKeyRow | null; error: unknown }>;
        };
      };
    };
    update(values: { last_used_at: string }): {
      eq(column: string, value: string): PromiseLike<unknown>;
    };
  };
};

/**
 * Resolve the API key on a request to its owner + scopes, or null if missing/
 * invalid/revoked. Updates last_used_at best-effort.
 *
 * `store` defaults to the service-role client. It is a parameter so tests can
 * supply a fake; production callers pass nothing and behaviour is unchanged.
 */
export const authenticate = async (
  req: Request,
  store?: ApiKeyStore,
): Promise<AuthedKey | null> => {
  const raw = extractRawKey(req);
  if (!raw) return null;

  // Lazy import (see the module note) + a deliberate cast. Do not "simplify" the
  // cast away: createServiceClient() is generic-less, so its query results are
  // `any`, and without this the row below silently loses its type — `data.scopes`
  // would stop being checked at all. Casting to the narrow store is what keeps
  // the result pinned to ApiKeyRow.
  const db =
    store ??
    ((await import('@/lib/supabase/service')).createServiceClient() as unknown as ApiKeyStore);

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
    // A key predating selectable scopes carries its owner type's full set, and
    // a null column reads as no scopes — denied everywhere, never granted.
    scopes: data.scopes ?? [],
  };
};

export const hasScope = (key: AuthedKey, scope: string) =>
  key.scopes.includes(scope);
