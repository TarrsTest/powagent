import { createClient as createSupabaseClient } from '@supabase/supabase-js';

/**
 * Service-role Supabase client — BYPASSES RLS.
 *
 * Since PRD §11 D1, RLS is the authoritative authorization layer for every
 * browser-session path, so this client has exactly two legitimate callers:
 *
 *  1. The programmatic REST API (app/api/v1/*). Those requests carry an API
 *     key, not a Supabase session, so there is no auth.uid() for a policy to
 *     act on — authorization is API-key scope, enforced in lib/guard.ts.
 *
 *  2. A closed list of PRIVILEGED server operations that RLS deliberately
 *     forbids a user to perform on themselves, each with an explicit in-code
 *     auth check directly above the call (repo CLAUDE.md, "When to reach for
 *     the service-role client"):
 *       · app/settings/actions.ts  createOrg     — role promotion + org insert
 *       · app/settings/actions.ts  acceptInvite  — role promotion
 *       · app/settings/actions.ts  issueKey      — writes a key hash
 *       · app/settings/actions.ts  revokeKey     — revokes a key hash
 *       · lib/evaluateSubmission.ts              — system-owned evaluation writes
 *
 * Anything else on a browser path goes through lib/supabase/server.ts so the
 * policies stay in force. If you find yourself importing this to make a query
 * "just work", the missing piece is a policy, not this client.
 */
export const createServiceClient = () =>
  createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
