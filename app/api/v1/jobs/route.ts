import { requireScope, isResponse } from '@/lib/guard';
import { createServiceClient } from '@/lib/supabase/service';
import { json, err, readJson } from '@/lib/http';

type Body = { title?: string; description?: string; status?: 'draft' | 'open' | 'closed' };

// POST /v1/jobs — org creates a job under its own organization.
export async function POST(req: Request) {
  const key = await requireScope(req, 'org', 'jobs:write');
  if (isResponse(key)) return key;

  const body = await readJson<Body>(req);
  if (!body) return err(400, 'invalid json body');
  const title = String(body.title ?? '').slice(0, 200).trim();
  if (!title) return err(400, 'title is required');
  const status = body.status ?? 'draft';
  if (!['draft', 'open', 'closed'].includes(status)) return err(400, 'invalid status');

  const db = createServiceClient();
  const { data, error } = await db
    .from('jobs')
    .insert({
      org_id: key.ownerId, // scope: always the caller's org
      title,
      description: body.description ? String(body.description).slice(0, 5000) : null,
      status,
    })
    .select('id, title, status, created_at')
    .single();
  if (error) return err(500, error.message);
  return json({ job: data }, 201);
}

// GET /v1/jobs — org lists its own jobs.
export async function GET(req: Request) {
  const key = await requireScope(req, 'org', 'jobs:write');
  if (isResponse(key)) return key;
  const db = createServiceClient();
  const { data, error } = await db
    .from('jobs')
    .select('id, title, description, status, created_at')
    .eq('org_id', key.ownerId)
    .order('created_at', { ascending: false });
  if (error) return err(500, error.message);
  return json({ jobs: data ?? [] });
}
