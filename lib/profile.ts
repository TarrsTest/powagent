import { createClient } from '@/lib/supabase/server';

export type Profile = {
  id: string;
  email: string | null;
  role: 'recruiter' | 'candidate';
  org_id: string | null;
};

/**
 * Current Supabase user + their powagent profile row (role/org). Returns null
 * when signed out. The users row is auto-created on signup by a DB trigger, but
 * we upsert defensively in case a session predates the trigger.
 */
export const getProfile = async (): Promise<{ userId: string; profile: Profile } | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  let { data: row } = await supabase
    .from('users')
    .select('id, email, role, org_id')
    .eq('id', user.id)
    .maybeSingle();

  if (!row) {
    await supabase.from('users').upsert({ id: user.id, email: user.email }).select();
    row = { id: user.id, email: user.email ?? null, role: 'candidate', org_id: null };
  }
  return { userId: user.id, profile: row as Profile };
};
