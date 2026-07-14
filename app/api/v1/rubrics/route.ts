import { requireScope, isResponse } from '@/lib/guard';
import { createServiceClient } from '@/lib/supabase/service';
import { json, err, readJson } from '@/lib/http';

type Body = { id?: string; name?: string; prompt_md?: string; schema_json?: object | null };

// POST /v1/rubrics — org creates a rubric (or updates one it owns when `id` given).
export async function POST(req: Request) {
  const key = await requireScope(req, 'org', 'rubrics:write');
  if (isResponse(key)) return key;

  const body = await readJson<Body>(req);
  if (!body) return err(400, 'invalid json body');
  const name = String(body.name ?? '').slice(0, 200).trim();
  const promptMd = String(body.prompt_md ?? '').slice(0, 20_000).trim();
  if (!name) return err(400, 'name is required');
  if (!promptMd) return err(400, 'prompt_md is required');

  const db = createServiceClient();

  if (body.id) {
    // Update — scope: rubric must belong to caller's org.
    const { data, error } = await db
      .from('rubrics')
      .update({ name, prompt_md: promptMd, schema_json: body.schema_json ?? null })
      .eq('id', body.id)
      .eq('org_id', key.ownerId)
      .select('id, name, created_at, updated_at')
      .maybeSingle();
    if (error) return err(500, error.message);
    if (!data) return err(404, 'rubric not found in your organization');
    return json({ rubric: data });
  }

  const { data, error } = await db
    .from('rubrics')
    .insert({ org_id: key.ownerId, name, prompt_md: promptMd, schema_json: body.schema_json ?? null })
    .select('id, name, created_at')
    .single();
  if (error) return err(500, error.message);
  return json({ rubric: data }, 201);
}

// GET /v1/rubrics — org lists its own rubrics.
export async function GET(req: Request) {
  const key = await requireScope(req, 'org', 'rubrics:write');
  if (isResponse(key)) return key;
  const db = createServiceClient();
  const { data, error } = await db
    .from('rubrics')
    .select('id, name, prompt_md, created_at, updated_at')
    .eq('org_id', key.ownerId)
    .order('created_at', { ascending: false });
  if (error) return err(500, error.message);
  return json({ rubrics: data ?? [] });
}
