// Minimal edge function — reports service health. Part of the smoke-test
// set that exercises the Tarrs Supabase Edge Functions deploy pipeline.
// No DB access, no secrets. Public (verify_jwt=off in ../../config.toml).
Deno.serve(() => {
  return new Response(
    JSON.stringify({
      ok: true,
      service: 'powagent',
      fn: 'health',
      status: 'healthy',
      now: new Date().toISOString(),
    }),
    { headers: { 'content-type': 'application/json' } },
  );
});
