'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { generateKey, SCOPES } from '@/lib/apikey';

/**
 * Onboarding + API-key management. These use the service-role client for the
 * privileged bits (org creation, role promotion, key rows), each guarded by an
 * explicit getUser() check directly above the write — the pattern the repo
 * CLAUDE.md prescribes for service-role operations.
 */

// Create an organization and promote the current user to recruiter.
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

// Issue an API key for the current user. Returns the raw key ONCE (shown via
// useActionState in the client form); only the hash is persisted.
export const issueKey = async (
  _prev: { rawKey?: string; error?: string } | null,
  _formData: FormData,
): Promise<{ rawKey?: string; error?: string }> => {
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
  const scopes = isOrg ? [...SCOPES.org] : [...SCOPES.candidate];

  const { raw, key_hash, key_prefix } = generateKey(ownerType);
  const { error } = await db
    .from('api_keys')
    .insert({ owner_type: ownerType, owner_id: ownerId, key_hash, key_prefix, scopes });
  if (error) return { error: error.message };

  revalidatePath('/settings');
  return { rawKey: raw };
};

// Revoke a key the current user owns.
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

  // Scope the revoke to keys the caller actually owns.
  const ownerId = profile.role === 'recruiter' ? profile.org_id : user.id;
  const ownerType = profile.role === 'recruiter' ? 'org' : 'candidate';
  if (!ownerId) return;

  await db
    .from('api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .eq('owner_id', ownerId)
    .eq('owner_type', ownerType);
  revalidatePath('/settings');
};
