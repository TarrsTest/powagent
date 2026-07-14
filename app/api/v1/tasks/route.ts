import { requireScope, isResponse } from '@/lib/guard';
import { createServiceClient } from '@/lib/supabase/service';
import { json, err } from '@/lib/http';

// GET /v1/tasks?status=open&q=... — candidate lists acceptable (open) tasks.
export async function GET(req: Request) {
  const key = await requireScope(req, 'candidate', 'tasks:read');
  if (isResponse(key)) return key;

  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q');

  const db = createServiceClient();
  // Only tasks whose parent job is 'open' are visible to candidates.
  let query = db
    .from('tasks')
    .select('id, title, brief_md, agent_allowed, deadline_at, created_at, job_id, jobs!inner(title, status, org_id)')
    .eq('jobs.status', 'open')
    .order('created_at', { ascending: false })
    .limit(100);
  if (q) query = query.ilike('title', `%${q}%`);

  const { data, error } = await query;
  if (error) return err(500, error.message);
  return json({ tasks: data ?? [] });
}
