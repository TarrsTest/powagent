import { createClient } from '@/lib/supabase/server';

export type Profile = {
  id: string;
  email: string | null;
  role: 'recruiter' | 'candidate';
  org_id: string | null;
};

/**
 * Current Supabase user + their powagent profile row (role/org). Returns null
 * when signed out.
 *
 * The users row is created by the on_auth_user_created trigger at signup. If it
 * is somehow absent we fall back to an in-memory candidate profile rather than
 * writing one: `users` has no INSERT policy by design (role/org are settable
 * only on the privileged path), so a self-insert here could never succeed.
 */
export const getProfile = async (): Promise<{ userId: string; profile: Profile } | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: row } = await supabase
    .from('users')
    .select('id, email, role, org_id')
    .eq('id', user.id)
    .maybeSingle();

  const profile: Profile = (row as Profile | null) ?? {
    id: user.id,
    email: user.email ?? null,
    role: 'candidate',
    org_id: null,
  };
  return { userId: user.id, profile };
};
