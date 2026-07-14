import { createClient as createSupabaseClient } from '@supabase/supabase-js';

/**
 * Service-role Supabase client — BYPASSES RLS. Use ONLY on the programmatic
 * REST API path (app/api/v1/*), where authorization is enforced by API-key
 * scope in app code (see lib/apikey.ts), not by Postgres RLS.
 *
 * Never import this from a Server Action / RSC that serves a browser session —
 * those go through lib/supabase/server.ts so RLS stays authoritative.
 */
export const createServiceClient = () =>
  createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
