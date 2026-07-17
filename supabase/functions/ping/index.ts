// Minimal edge function — smoke-tests the Tarrs Supabase Edge Functions
// deploy pipeline end-to-end. No DB access, no secrets. Public (verify_jwt=off
// in ../../config.toml) so it can be curled directly.
Deno.serve((req) => {
  return new Response(
    JSON.stringify({
      ok: true,
      service: 'powagent',
      fn: 'ping',
      method: req.method,
      now: new Date().toISOString(),
    }),
    { headers: { 'content-type': 'application/json' } },
  );
});
