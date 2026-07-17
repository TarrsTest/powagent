// Minimal edge function — echoes the POSTed JSON body back. Part of the
// smoke-test set for the Tarrs Supabase Edge Functions deploy pipeline;
// exercises a function that reads request input. No DB access, no secrets.
// Public (verify_jwt=off in ../../config.toml).
Deno.serve(async (req) => {
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  return new Response(
    JSON.stringify({
      ok: true,
      service: 'powagent',
      fn: 'echo',
      method: req.method,
      received: body,
      now: new Date().toISOString(),
    }),
    { headers: { 'content-type': 'application/json' } },
  );
});
