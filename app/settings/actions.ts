'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { generateKey, normalizeScopes } from '@/lib/apikey';

/**
 * Onboarding, org membership and API-key management.
 *
 * Split by design (PRD §11 D1):
 *  · Ordinary writes (inviteMember / revokeInvite) run on the SESSION client —
 *    the `invites: recruiter manage own org` policy is the auth check.
 *  · PRIVILEGED writes run on the service-role client, because RLS deliberately
 *    forbids the user to do them to themselves: role promotion is blocked by
 *    `users: update self`, and api_keys has no INSERT/UPDATE policy so a key's
 *    scopes can never be chosen by the browser. Each of those has an explicit
 *    in-code auth check directly above the privileged call.
 */

// PRIVILEGED — creates an org and promotes the caller to recruiter.
export const createOrg = async (formData: FormData) => {
  const name = String(formData.get('name') ?? '').slice(0, 200).trim();
  if (!name) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const db = createServiceClient();
  const { data: org, error } = await db
    .from('organizations')
    .insert({ name })
    .select('id')
    .single();
  if (error || !org) return;

  await db.from('users').update({ role: 'recruiter', org_id: org.id }).eq('id', user.id);
  revalidatePath('/settings');
};

// A4 — invite a teammate by email. Session client: the policy checks that the
// caller is a recruiter and that org_id is their own.
export const inviteMember = async (formData: FormData) => {
  const email = String(formData.get('email') ?? '').slice(0, 320).trim().toLowerCase();
  if (!email || !email.includes('@')) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  // org_id must be supplied on insert; the policy's WITH CHECK verifies it.
  const { data: me } = await supabase.from('users').select('org_id').eq('id', user.id).maybeSingle();
  if (!me?.org_id) return;

  await supabase.from('org_invites').insert({ org_id: me.org_id, email, invited_by: user.id });
  revalidatePath('/settings');
};

export const revokeInvite = async (formData: FormData) => {
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  const supabase = await createClient();
  await supabase.from('org_invites').update({ status: 'revoked' }).eq('id', id);
  revalidatePath('/settings');
};

// PRIVILEGED — accepting an invite is a role promotion, which the session
// client cannot perform. The check below is what authorizes it: the invite must
// be pending AND addressed to this user's own verified email.
export const acceptInvite = async (formData: FormData) => {
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return;

  const db = createServiceClient();
  const { data: invite } = await db
    .from('org_invites')
    .select('id, org_id, email, status')
    .eq('id', id)
    .eq('status', 'pending')
    .maybeSingle();
  if (!invite) return;
  if (invite.email.toLowerCase() !== user.email.toLowerCase()) return;

  await db.from('users').update({ role: 'recruiter', org_id: invite.org_id }).eq('id', user.id);
  await db
    .from('org_invites')
    .update({ status: 'accepted', accepted_at: new Date().toISOString() })
    .eq('id', invite.id);
  revalidatePath('/settings');
};

// PRIVILEGED — issues a key and returns the raw value ONCE (shown via
// useActionState in the client form); only the hash is persisted.
//
// The scope selection is the only part of this that comes from the browser, and
// it is treated as a request rather than an instruction: `normalizeScopes`
// checks every value against what THIS owner type may hold, and the owner type
// itself is still derived from the stored profile below — never from the form.
// So the worst a crafted POST can do is name a scope it is not entitled to and
// be refused.
export const issueKey = async (
  _prev: { rawKey?: string; scopes?: string[]; error?: string } | null,
  formData: FormData,
): Promise<{ rawKey?: string; scopes?: string[]; error?: string }> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'not signed in' };

  const db = createServiceClient();
  const { data: profile } = await db
    .from('users')
    .select('role, org_id')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile) return { error: 'no profile' };

  const isOrg = profile.role === 'recruiter';
  if (isOrg && !profile.org_id) return { error: 'create an organization first' };

  const ownerType = isOrg ? 'org' : 'candidate';
  const ownerId = isOrg ? (profile.org_id as string) : user.id;

  const selection = normalizeScopes(ownerType, formData.getAll('scopes').map(String));
  if (!selection.ok) return { error: selection.error };

  const { raw, key_hash, key_prefix, scopes } = generateKey(ownerType, selection.scopes);
  const { error } = await db
    .from('api_keys')
    .insert({ owner_type: ownerType, owner_id: ownerId, key_hash, key_prefix, scopes });
  if (error) return { error: error.message };

  revalidatePath('/settings');
  return { rawKey: raw, scopes };
};

// PRIVILEGED — revoke a key the caller owns. api_keys has no UPDATE policy, so
// the ownership check below is the authorization.
//
// A caller can own keys under TWO identities: their own candidate keys (issued
// before they created or joined an org) and their org's keys. The settings list
// shows both, because `api_keys: candidate own` and `api_keys: org own` are
// permissive and OR together. Deriving a single owner from the current role
// would therefore leave an ex-candidate's old key visible with a revoke button
// that silently did nothing — an active key the UI claims you can turn off.
// Revocation has to be immediate (PRD §9.3), so accept either identity.
export const revokeKey = async (formData: FormData) => {
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const db = createServiceClient();
  const { data: profile } = await db
    .from('users')
    .select('role, org_id')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile) return;

  const { data: key } = await db
    .from('api_keys')
    .select('id, owner_type, owner_id')
    .eq('id', id)
    .maybeSingle();
  if (!key) return;

  const ownsAsCandidate = key.owner_type === 'candidate' && key.owner_id === user.id;
  const ownsAsOrg =
    key.owner_type === 'org' &&
    profile.role === 'recruiter' &&
    !!profile.org_id &&
    key.owner_id === profile.org_id;
  if (!ownsAsCandidate && !ownsAsOrg) return;

  await db
    .from('api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', key.id);
  revalidatePath('/settings');
};
