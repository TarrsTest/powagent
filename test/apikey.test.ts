import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  SCOPES,
  authenticate,
  describeScope,
  generateKey,
  hasScope,
  normalizeScopes,
  type ApiKeyStore,
  type AuthedKey,
  type OwnerType,
} from '../lib/apikey.ts';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

type StoredKey = {
  id: string;
  owner_type: string;
  owner_id: string;
  key_hash: string;
  scopes: string[] | null;
  revoked_at: string | null;
};

const storedKey = (over: Partial<StoredKey> = {}): StoredKey => ({
  id: 'key-1',
  owner_type: 'candidate',
  owner_id: 'cand-1',
  key_hash: sha256('pk_cand_secret'),
  scopes: ['tasks:read'],
  revoked_at: null,
  ...over,
});

/**
 * An in-memory stand-in for the api_keys table that really applies the filters
 * `authenticate` asks for, rather than replaying a canned answer. That is the
 * point: if the `.is('revoked_at', null)` filter were ever dropped, a revoked
 * key would come back and the revocation test would fail — which is exactly the
 * regression worth catching. `filters` records what was asked so a test can
 * assert the query shape as well as its result.
 */
const fakeStore = (rows: StoredKey[]) => {
  const filters: { column: string; value: string | null }[] = [];
  const touched: { id: string; last_used_at: string }[] = [];

  const store: ApiKeyStore = {
    from: () => ({
      select: () => ({
        eq: (column: string, value: string) => {
          filters.push({ column, value });
          return {
            is: (isColumn: string, isValue: null) => {
              filters.push({ column: isColumn, value: isValue });
              return {
                maybeSingle: async () => {
                  const match = rows.find(
                    (r) =>
                      r[column as keyof StoredKey] === value &&
                      r[isColumn as keyof StoredKey] === isValue,
                  );
                  return { data: match ?? null, error: null };
                },
              };
            },
          };
        },
      }),
      update: (values: { last_used_at: string }) => ({
        eq: (_column: string, id: string) => {
          touched.push({ id, last_used_at: values.last_used_at });
          return Promise.resolve({});
        },
      }),
    }),
  };

  return { store, filters, touched };
};

const req = (headers: Record<string, string> = {}) =>
  new Request('https://powagent.test/api/v1/tasks', { headers });

const authed = (scopes: string[]): AuthedKey => ({
  keyId: 'key-1',
  ownerType: 'candidate',
  ownerId: 'cand-1',
  scopes,
});

describe('normalizeScopes', () => {
  test('keeps exactly what was selected', () => {
    const r = normalizeScopes('candidate', ['tasks:read']);
    assert.deepEqual(r, { ok: true, scopes: ['tasks:read'] });
  });

  test('returns canonical order, not the caller’s order', () => {
    const r = normalizeScopes('candidate', ['submissions:write', 'tasks:read']);
    assert.equal(r.ok, true);
    assert.deepEqual(r.ok && r.scopes, ['tasks:read', 'submissions:write']);
  });

  test('rejects a duplicated valid scope', () => {
    const r = normalizeScopes('candidate', ['tasks:read', 'tasks:read']);
    assert.deepEqual(r, { ok: false, error: 'duplicate scope: tasks:read' });
  });

  test('rejects a scope repeated more than twice, naming it once', () => {
    const r = normalizeScopes('candidate', ['tasks:read', 'tasks:read', 'tasks:read']);
    assert.deepEqual(r, { ok: false, error: 'duplicate scope: tasks:read' });
  });

  test('rejects multiple duplicated scopes, naming each', () => {
    const r = normalizeScopes('org', [
      'jobs:write',
      'jobs:write',
      'rubrics:write',
      'rubrics:write',
    ]);
    assert.deepEqual(r, { ok: false, error: 'duplicate scopes: jobs:write, rubrics:write' });
  });

  test('a duplicate survives trimming — whitespace does not make it unique', () => {
    const r = normalizeScopes('candidate', ['tasks:read', '  tasks:read  ']);
    assert.deepEqual(r, { ok: false, error: 'duplicate scope: tasks:read' });
  });

  test('an unknown scope is reported ahead of its own repetition', () => {
    // Validity first: the actionable problem is the typo, not the repeat.
    const r = normalizeScopes('candidate', ['nope', 'nope']);
    assert.deepEqual(r, { ok: false, error: 'unknown scope: nope' });
  });

  test('a duplicate rejects the whole selection, valid siblings included', () => {
    const r = normalizeScopes('candidate', ['tasks:read', 'submissions:write', 'tasks:read']);
    assert.equal(r.ok, false);
  });

  test('distinct scopes are not mistaken for duplicates', () => {
    const r = normalizeScopes('candidate', ['tasks:read', 'tasks:accept', 'submissions:read']);
    assert.deepEqual(r.ok && r.scopes, ['tasks:read', 'tasks:accept', 'submissions:read']);
  });

  test('ignores blank and whitespace-only values, and trims', () => {
    const r = normalizeScopes('candidate', ['  tasks:read  ', '', '   ']);
    assert.deepEqual(r.ok && r.scopes, ['tasks:read']);
  });

  test('rejects an unknown scope by name', () => {
    const r = normalizeScopes('candidate', ['tasks:read', 'tasks:destroy']);
    assert.deepEqual(r, { ok: false, error: 'unknown scope: tasks:destroy' });
  });

  test('rejects a real scope belonging to the other owner type', () => {
    // Privilege escalation in its most likely form: a candidate hand-posting an
    // org scope. It is a real string, so "unknown scope" would be misleading.
    const r = normalizeScopes('candidate', ['evaluations:write']);
    assert.deepEqual(r, {
      ok: false,
      error: 'scope not available for a candidate key: evaluations:write',
    });
  });

  test('rejects an org key asking for a candidate-only scope', () => {
    const r = normalizeScopes('org', ['tasks:accept']);
    assert.deepEqual(r, {
      ok: false,
      error: 'scope not available for a org key: tasks:accept',
    });
  });

  test('one bad scope rejects the whole selection, it is not silently dropped', () => {
    const r = normalizeScopes('org', ['jobs:write', 'tasks:accept']);
    assert.equal(r.ok, false);
  });

  test('an empty selection is refused — not silently turned into everything', () => {
    assert.deepEqual(normalizeScopes('candidate', []), {
      ok: false,
      error: 'select at least one scope',
    });
    assert.deepEqual(normalizeScopes('org', ['', '  ']), {
      ok: false,
      error: 'select at least one scope',
    });
  });

  test('submissions:read is legal for both owner types', () => {
    assert.equal(normalizeScopes('candidate', ['submissions:read']).ok, true);
    assert.equal(normalizeScopes('org', ['submissions:read']).ok, true);
  });
});

describe('generateKey', () => {
  test('a single selected scope is the only scope on the key', () => {
    const key = generateKey('candidate', ['tasks:read']);
    assert.deepEqual(key.scopes, ['tasks:read']);
  });

  test('multiple selected scopes are all carried, in canonical order', () => {
    const key = generateKey('org', ['evaluations:write', 'jobs:write']);
    assert.deepEqual(key.scopes, ['jobs:write', 'evaluations:write']);
  });

  test('does NOT grant the owner type’s full set — the old behaviour', () => {
    const key = generateKey('org', ['jobs:write']);
    assert.equal(key.scopes.length, 1);
    assert.notDeepEqual(key.scopes, [...SCOPES.org]);
  });

  test('the full set is still grantable when it is genuinely selected', () => {
    const key = generateKey('org', [...SCOPES.org]);
    assert.deepEqual(key.scopes, [...SCOPES.org]);
  });

  test('refuses an invalid scope instead of minting a key', () => {
    assert.throws(() => generateKey('candidate', ['tasks:read', 'nope']), /unknown scope: nope/);
  });

  test('refuses a scope the owner type may not hold', () => {
    assert.throws(
      () => generateKey('candidate', ['evaluations:write']),
      /not available for a candidate key/,
    );
  });

  test('refuses to mint a scopeless key', () => {
    assert.throws(() => generateKey('candidate', []), /select at least one scope/);
  });

  test('cannot be used to bypass the duplicate rule when called directly', () => {
    // generateKey is the only key-minting path, so it re-runs the same
    // validation rather than trusting that a caller already did.
    assert.throws(
      () => generateKey('candidate', ['tasks:read', 'tasks:read']),
      /duplicate scope: tasks:read/,
    );
    assert.throws(
      () => generateKey('org', ['jobs:write', 'jobs:write', 'rubrics:write', 'rubrics:write']),
      /duplicate scopes: jobs:write, rubrics:write/,
    );
  });

  test('stores only a hash — the raw key is not recoverable from the row', () => {
    const key = generateKey('candidate', ['tasks:read']);
    assert.equal(key.key_hash, sha256(key.raw));
    assert.notEqual(key.key_hash, key.raw);
    assert.ok(!JSON.stringify({ ...key, raw: undefined }).includes(key.raw));
  });

  test('prefix identifies the key without revealing it', () => {
    const key = generateKey('candidate', ['tasks:read']);
    assert.equal(key.key_prefix, key.raw.slice(0, 12));
    assert.ok(key.key_prefix.length < key.raw.length);
  });

  test('owner type is tagged in the raw key', () => {
    assert.match(generateKey('candidate', ['tasks:read']).raw, /^pk_cand_[0-9a-f]{48}$/);
    assert.match(generateKey('org', ['jobs:write']).raw, /^pk_org_[0-9a-f]{48}$/);
  });

  test('every key is distinct', () => {
    const raws = new Set(
      Array.from({ length: 50 }, () => generateKey('candidate', ['tasks:read']).raw),
    );
    assert.equal(raws.size, 50);
  });
});

describe('the server-side validation path (the shape issueKey submits)', () => {
  /**
   * issueKey does exactly this with the posted form before it mints anything:
   *
   *   const selection = normalizeScopes(ownerType, formData.getAll('scopes').map(String));
   *   if (!selection.ok) return { error: selection.error };
   *
   * Reproducing that pipeline — real FormData, real getAll — is what shows the
   * rejection happens on the server against the raw request, not in the browser
   * component that can be bypassed entirely.
   */
  const validateAsAction = (ownerType: OwnerType, form: FormData) =>
    normalizeScopes(ownerType, form.getAll('scopes').map(String));

  const form = (...scopes: string[]) => {
    const f = new FormData();
    for (const s of scopes) f.append('scopes', s);
    return f;
  };

  test('a hand-crafted POST repeating a scope is refused', () => {
    const r = validateAsAction('candidate', form('tasks:read', 'tasks:read'));
    assert.deepEqual(r, { ok: false, error: 'duplicate scope: tasks:read' });
  });

  test('a POST repeating several scopes is refused', () => {
    const r = validateAsAction('org', form('jobs:write', 'jobs:write', 'tasks:write', 'tasks:write'));
    assert.deepEqual(r, { ok: false, error: 'duplicate scopes: jobs:write, tasks:write' });
  });

  test('a POST naming another owner type’s scope is refused', () => {
    const r = validateAsAction('candidate', form('tasks:read', 'evaluations:write'));
    assert.deepEqual(r, {
      ok: false,
      error: 'scope not available for a candidate key: evaluations:write',
    });
  });

  test('a POST with no scopes field at all is refused', () => {
    assert.deepEqual(validateAsAction('candidate', form()), {
      ok: false,
      error: 'select at least one scope',
    });
  });

  test('an honest submission from the checkbox UI passes through', () => {
    const r = validateAsAction('candidate', form('submissions:write', 'tasks:read'));
    assert.deepEqual(r, { ok: true, scopes: ['tasks:read', 'submissions:write'] });
  });

  test('a rejected selection never reaches key generation', () => {
    const bad = form('tasks:read', 'tasks:read');
    const selection = validateAsAction('candidate', bad);

    assert.equal(selection.ok, false);
    // The action returns here. If it did not, generateKey would refuse anyway.
    assert.throws(() => generateKey('candidate', bad.getAll('scopes').map(String)), /duplicate/);
  });
});

describe('authenticate', () => {
  test('a valid active key resolves to its owner and its stored scopes', async () => {
    const { store } = fakeStore([storedKey({ scopes: ['tasks:read', 'submissions:write'] })]);
    const key = await authenticate(req({ authorization: 'Bearer pk_cand_secret' }), store);

    assert.ok(key);
    assert.equal(key.keyId, 'key-1');
    assert.equal(key.ownerType, 'candidate');
    assert.equal(key.ownerId, 'cand-1');
    assert.deepEqual(key.scopes, ['tasks:read', 'submissions:write']);
  });

  test('returns the scopes actually on the key, not the owner type’s full set', async () => {
    const { store } = fakeStore([storedKey({ scopes: ['tasks:read'] })]);
    const key = await authenticate(req({ 'x-api-key': 'pk_cand_secret' }), store);

    assert.deepEqual(key?.scopes, ['tasks:read']);
    assert.notDeepEqual(key?.scopes, [...SCOPES.candidate]);
  });

  test('accepts the key via X-API-Key as well as Bearer', async () => {
    const { store } = fakeStore([storedKey()]);
    assert.ok(await authenticate(req({ 'x-api-key': 'pk_cand_secret' }), store));
    assert.ok(await authenticate(req({ authorization: 'Bearer pk_cand_secret' }), store));
  });

  test('no credentials at all is null, and never reaches the database', async () => {
    const { store, filters } = fakeStore([storedKey()]);
    assert.equal(await authenticate(req(), store), null);
    assert.equal(filters.length, 0);
  });

  test('an unknown key is null', async () => {
    const { store } = fakeStore([storedKey()]);
    assert.equal(await authenticate(req({ authorization: 'Bearer pk_cand_wrong' }), store), null);
  });

  test('a revoked key cannot authenticate, even holding a valid scope', async () => {
    const { store } = fakeStore([
      storedKey({ scopes: ['tasks:read'], revoked_at: '2026-08-01T00:00:00Z' }),
    ]);
    assert.equal(await authenticate(req({ authorization: 'Bearer pk_cand_secret' }), store), null);
  });

  test('revocation is enforced by the query, not by chance', async () => {
    // Guards the mechanism itself: authenticate must ASK for revoked_at is null.
    const { store, filters } = fakeStore([storedKey()]);
    await authenticate(req({ authorization: 'Bearer pk_cand_secret' }), store);

    assert.ok(filters.some((f) => f.column === 'revoked_at' && f.value === null));
  });

  test('looks the key up by hash — the raw key never hits the query', async () => {
    const { store, filters } = fakeStore([storedKey()]);
    await authenticate(req({ authorization: 'Bearer pk_cand_secret' }), store);

    const lookup = filters.find((f) => f.column === 'key_hash');
    assert.equal(lookup?.value, sha256('pk_cand_secret'));
    assert.ok(!filters.some((f) => f.value === 'pk_cand_secret'));
  });

  test('a database error is a denial, not a crash', async () => {
    const store: ApiKeyStore = {
      from: () => ({
        select: () => ({
          eq: () => ({
            is: () => ({
              maybeSingle: async () => ({ data: null, error: { message: 'connection lost' } }),
            }),
          }),
        }),
        update: () => ({ eq: () => Promise.resolve({}) }),
      }),
    };
    assert.equal(await authenticate(req({ authorization: 'Bearer pk_cand_secret' }), store), null);
  });

  test('a legacy row with null scopes grants nothing rather than everything', async () => {
    const { store } = fakeStore([storedKey({ scopes: null })]);
    const key = await authenticate(req({ authorization: 'Bearer pk_cand_secret' }), store);

    assert.deepEqual(key?.scopes, []);
    assert.equal(hasScope(key as AuthedKey, 'tasks:read'), false);
  });

  test('a pre-existing full-scope key keeps working (backward compatibility)', async () => {
    // Keys issued before scopes were selectable carry the full set. Nothing
    // migrated them, so they must still authenticate and still hold it.
    const { store } = fakeStore([
      storedKey({ owner_type: 'org', owner_id: 'org-1', scopes: [...SCOPES.org] }),
    ]);
    const key = await authenticate(req({ authorization: 'Bearer pk_cand_secret' }), store);

    assert.equal(key?.ownerType, 'org');
    assert.deepEqual(key?.scopes, [...SCOPES.org]);
    assert.ok(SCOPES.org.every((s) => hasScope(key as AuthedKey, s)));
  });

  test('touches last_used_at on a successful authentication', async () => {
    const { store, touched } = fakeStore([storedKey()]);
    await authenticate(req({ authorization: 'Bearer pk_cand_secret' }), store);

    assert.equal(touched.length, 1);
    assert.equal(touched[0].id, 'key-1');
    assert.ok(!Number.isNaN(Date.parse(touched[0].last_used_at)));
  });

  test('a bare Authorization header without the Bearer prefix is not a key', async () => {
    const { store } = fakeStore([storedKey()]);
    assert.equal(await authenticate(req({ authorization: 'pk_cand_secret' }), store), null);
  });

  test('an end-to-end issue → authenticate round trip carries the chosen scopes', async () => {
    const issued = generateKey('org', ['jobs:write', 'evaluations:read']);
    const { store } = fakeStore([
      storedKey({
        id: 'key-2',
        owner_type: 'org',
        owner_id: 'org-1',
        key_hash: issued.key_hash,
        scopes: issued.scopes,
      }),
    ]);

    const key = await authenticate(req({ authorization: `Bearer ${issued.raw}` }), store);

    assert.deepEqual(key?.scopes, ['jobs:write', 'evaluations:read']);
    assert.equal(hasScope(key as AuthedKey, 'jobs:write'), true);
    // Never selected, so the route guard must refuse it.
    assert.equal(hasScope(key as AuthedKey, 'rubrics:write'), false);
  });
});

describe('hasScope', () => {
  test('permits a scope the key holds', () => {
    assert.equal(hasScope(authed(['tasks:read', 'submissions:write']), 'tasks:read'), true);
  });

  test('refuses a scope the key does not hold', () => {
    assert.equal(hasScope(authed(['tasks:read']), 'submissions:write'), false);
  });

  test('refuses everything on a scopeless key', () => {
    const key = authed([]);
    for (const scope of [...SCOPES.candidate, ...SCOPES.org]) {
      assert.equal(hasScope(key, scope), false);
    }
  });

  test('matches exactly — no prefix or substring leniency', () => {
    const key = authed(['tasks:read']);
    assert.equal(hasScope(key, 'tasks'), false);
    assert.equal(hasScope(key, 'tasks:'), false);
    assert.equal(hasScope(key, 'tasks:read:all'), false);
    assert.equal(hasScope(key, 'TASKS:READ'), false);
  });
});

describe('SCOPES and their descriptions', () => {
  test('every scope has a human-readable label and explanation', () => {
    for (const ownerType of ['candidate', 'org'] as OwnerType[]) {
      for (const scope of SCOPES[ownerType]) {
        const { label, description } = describeScope(ownerType, scope);
        assert.ok(label.length > 0, `${ownerType}:${scope} needs a label`);
        assert.ok(description.length > 0, `${ownerType}:${scope} needs a description`);
        assert.notEqual(label, scope, `${ownerType}:${scope} label is just the raw scope`);
      }
    }
  });

  test('an unknown scope degrades to the raw string instead of throwing', () => {
    assert.deepEqual(describeScope('candidate', 'mystery:scope'), {
      label: 'mystery:scope',
      description: '',
    });
  });

  test('submissions:read is described differently for each side', () => {
    assert.notEqual(
      describeScope('candidate', 'submissions:read').description,
      describeScope('org', 'submissions:read').description,
    );
  });
});
