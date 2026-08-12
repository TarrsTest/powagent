import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getProfile, type Profile, type ProfileStore } from '../lib/profile.ts';

/**
 * Role resolution decides which pages a signed-in user reaches, so the branch
 * that matters most is the one where the `users` row is absent — every recruiter
 * page gates on the role and org this function returns.
 */
const store = (
  user: { id: string; email?: string | null } | null,
  row: Profile | null,
): ProfileStore => ({
  auth: { getUser: async () => ({ data: { user } }) },
  from: () => ({
    select: () => ({
      eq: () => ({ maybeSingle: async () => ({ data: row }) }),
    }),
  }),
});

describe('getProfile', () => {
  test('signed out is null, not an anonymous profile', async () => {
    assert.equal(await getProfile(store(null, null)), null);
  });

  test('returns the users row verbatim for a recruiter', async () => {
    const row: Profile = { id: 'u1', email: 'r@example.com', role: 'recruiter', org_id: 'org1' };
    assert.deepEqual(await getProfile(store({ id: 'u1', email: 'r@example.com' }, row)), {
      userId: 'u1',
      profile: row,
    });
  });

  test('returns the users row verbatim for a candidate', async () => {
    const row: Profile = { id: 'u2', email: 'c@example.com', role: 'candidate', org_id: null };
    assert.deepEqual(await getProfile(store({ id: 'u2', email: 'c@example.com' }, row)), {
      userId: 'u2',
      profile: row,
    });
  });

  test('a missing users row falls back to an in-memory candidate', async () => {
    assert.deepEqual(await getProfile(store({ id: 'u3', email: 'new@example.com' }, null)), {
      userId: 'u3',
      profile: { id: 'u3', email: 'new@example.com', role: 'candidate', org_id: null },
    });
  });

  test('the fallback fails closed — never a recruiter, never an org', async () => {
    // If the trigger-provisioned row is ever missing for someone who WAS a
    // recruiter, the safe answer is the lowest privilege. `role: 'recruiter'`
    // or a non-null org_id here would walk them straight into the recruiter
    // pages with an org they may not belong to.
    const s = await getProfile(store({ id: 'u4', email: 'ghost@example.com' }, null));
    assert.equal(s?.profile.role, 'candidate');
    assert.equal(s?.profile.org_id, null);
  });

  test('a user with no email address yields a null email, not undefined', async () => {
    // The column is nullable and the UI renders it directly; undefined would
    // serialise differently and read as "unknown" rather than "none".
    const s = await getProfile(store({ id: 'u5' }, null));
    assert.equal(s?.profile.email, null);
  });
});
