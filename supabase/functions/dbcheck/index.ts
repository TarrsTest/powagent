// dbcheck — end-to-end pipeline smoke test. Unlike ping/health/echo (which
// touch no DB), this reads the marker row created by migration 003. A 200 with
// the row proves BOTH the migrate phase and the functions phase deployed and
// that the function can reach the DB. Public (verify_jwt=off in config.toml).
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected by Supabase into
// every deployed edge function — no manual secrets needed.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async () => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data, error } = await supabase
      .from('pipeline_smoke')
      .select('marker, deployed_at')
      .order('deployed_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    return new Response(
      JSON.stringify({
        ok: true,
        fn: 'dbcheck',
        migrationApplied: !!data,
        row: data,
        now: new Date().toISOString(),
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, fn: 'dbcheck', error: String(e) }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    );
  }
});
