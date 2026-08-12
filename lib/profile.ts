export type Profile = {
  id: string;
  email: string | null;
  role: 'recruiter' | 'candidate';
  org_id: string | null;
};

/**
 * The slice of the Supabase session client this module uses. Narrow on purpose:
 * it is what lets a test drive `getProfile` without a database, and it documents
 * exactly which query shapes role resolution depends on.
 *
 * This module deliberately has no top-level `@/lib/supabase/server` import — a
 * path alias makes the file unloadable by Node's test runner, which does not
 * resolve tsconfig paths. Same constraint, same fix as `lib/apikey.ts`.
 */
export type ProfileStore = {
  auth: {
    getUser(): Promise<{ data: { user: { id: string; email?: string | null } | null } }>;
  };
  from(table: 'users'): {
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): Promise<{ data: Profile | null }>;
      };
    };
  };
};

/**
 * Current Supabase user + their powagent profile row (role/org). Returns null
 * when signed out.
 *
 * The users row is created by the on_auth_user_created trigger at signup. If it
 * is somehow absent we fall back to an in-memory candidate profile rather than
 * writing one: `users` has no INSERT policy by design (role/org are settable
 * only on the privileged path), so a self-insert here could never succeed.
 * The fallback is deliberately the LEAST privileged shape — candidate, no org —
 * so a missing row fails closed.
 *
 * `store` defaults to the session client. It is a parameter so tests can supply
 * a fake; production callers pass nothing and behaviour is unchanged.
 */
export const getProfile = async (
  store?: ProfileStore,
): Promise<{ userId: string; profile: Profile } | null> => {
  // Lazy import (see the ProfileStore note) + a deliberate cast: createClient()
  // is generic-less, so its query results are `any` and the row below would
  // silently lose its type without this.
  const supabase =
    store ??
    ((await (await import('@/lib/supabase/server')).createClient()) as unknown as ProfileStore);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: row } = await supabase
    .from('users')
    .select('id, email, role, org_id')
    .eq('id', user.id)
    .maybeSingle();

  const profile: Profile = row ?? {
    id: user.id,
    email: user.email ?? null,
    role: 'candidate',
    org_id: null,
  };
  return { userId: user.id, profile };
};
